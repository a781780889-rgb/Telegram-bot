/**
 * pgCompat.js — PostgreSQL wrapper يحاكي better-sqlite3 API (sync)
 *
 * يستخدم worker_threads + Atomics.wait لتنفيذ PostgreSQL queries
 * بشكل متزامن حقيقي بدون حجب event loop.
 *
 * FIX: PgSyncClient يُنشأ مرة واحدة فقط (singleton) لتجنب
 *      timeout عند كل callback query.
 */

'use strict';

const { Worker, receiveMessageOnPort, MessageChannel } = require('worker_threads');

// ─── SQL Conversion ───────────────────────────────────────────────────────────

const convertSql = (sql) => String(sql)
  .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY')
  .replace(/\bINT\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi,     'BIGSERIAL PRIMARY KEY')
  .replace(/\bDATETIME\b/gi,  'TIMESTAMPTZ')
  .replace(/\bBLOB\b/gi,      'BYTEA')
  .replace(/\bREAL\b/gi,      'DOUBLE PRECISION')
  .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
  .replace(/\bWITHOUT\s+ROWID\b/gi, '')
  .replace(/DATE\s*\(\s*'now'\s*\)/gi,      'CURRENT_DATE')
  .replace(/datetime\s*\(\s*'now'\s*\)/gi,  'CURRENT_TIMESTAMP')
  .replace(
    /datetime\s*\(\s*'now'\s*,\s*'(-?\d+)\s+day'\s*\)/gi,
    (_, d) => `CURRENT_TIMESTAMP ${Number(d) >= 0 ? '+' : '-'} INTERVAL '${Math.abs(Number(d))} day'`
  )
  .replace(/julianday\s*\(([^)]+)\)/gi, 'EXTRACT(EPOCH FROM ($1::timestamptz)) / 86400.0');

const placeholders = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

// ─── Worker Code (inline) ─────────────────────────────────────────────────────

const WORKER_CODE = `
'use strict';
const { workerData, parentPort, receiveMessageOnPort } = require('worker_threads');
const { Client } = require('pg');

(async () => {
  const sharedCmd    = new Int32Array(workerData.sharedCmd);
  const sharedResult = new Int32Array(workerData.sharedResult);
  const { port }     = workerData;

  const client = new Client({
    connectionString: workerData.connectionString,
    ssl: workerData.ssl,
  });

  try {
    await client.connect();
  } catch (err) {
    port.postMessage({ type: 'fatal', message: err.message });
    return;
  }

  // إشعار main thread بأن الاتصال جاهز
  port.postMessage({ type: 'ready' });

  // حلقة معالجة الـ queries
  while (true) {
    // انتظر أمر من main thread
    Atomics.wait(sharedCmd, 0, 0);
    Atomics.store(sharedCmd, 0, 0);

    const incoming = receiveMessageOnPort(port);
    if (!incoming) continue;

    const msg = incoming.message;
    if (msg.type === 'close') { await client.end().catch(() => {}); process.exit(0); }

    let response;
    try {
      const result = await client.query(msg.sql, msg.params || []);
      response = { type: 'result', id: msg.id, rows: result.rows, rowCount: result.rowCount };
    } catch (err) {
      response = { type: 'error', id: msg.id, message: err.message, code: err.code };
    }

    port.postMessage(response);
    Atomics.store(sharedResult, 0, 1);
    Atomics.notify(sharedResult, 0);
  }
})();
`;

// ─── PgSyncClient ─────────────────────────────────────────────────────────────

class PgSyncClient {
  constructor(connectionString, ssl) {
    const sabCmd    = new SharedArrayBuffer(4);
    const sabResult = new SharedArrayBuffer(4);
    this._sharedCmd    = new Int32Array(sabCmd);
    this._sharedResult = new Int32Array(sabResult);
    this._msgId = 0;

    const { port1, port2 } = new MessageChannel();
    this._port = port1;

    this._worker = new Worker(WORKER_CODE, {
      eval: true,
      workerData: {
        connectionString,
        ssl: ssl === false ? false : { rejectUnauthorized: false },
        port: port2,
        sharedCmd:    sabCmd,
        sharedResult: sabResult,
      },
      transferList: [port2],
    });

    // انتظر ready بـ polling (max 15 ثانية)
    let ready = false;
    this._worker.on('message', (m) => { if (m.type === 'ready') ready = true; });

    const deadline = Date.now() + 15000;
    while (!ready && Date.now() < deadline) {
      Atomics.wait(this._sharedResult, 0, 0, 100);
    }

    if (!ready) throw new Error('PgSyncClient: connection timeout after 15s');
  }

  query(sql, params = []) {
    const id = ++this._msgId;

    // إعادة تعيين result signal
    Atomics.store(this._sharedResult, 0, 0);

    // إرسال الـ query
    this._port.postMessage({ type: 'query', id, sql, params });

    // إيقاظ الـ worker
    Atomics.store(this._sharedCmd, 0, 1);
    Atomics.notify(this._sharedCmd, 0);

    // انتظر الرد (max 30 ثانية)
    const waited = Atomics.wait(this._sharedResult, 0, 0, 30000);
    if (waited === 'timed-out') throw new Error(`PgSyncClient: query timeout — ${sql.substring(0, 80)}`);

    const msg = receiveMessageOnPort(this._port);
    if (!msg) throw new Error('PgSyncClient: no response message');

    const { type, rows, rowCount, message, code } = msg.message;
    if (type === 'error') {
      const err = new Error(message);
      err.code = code;
      throw err;
    }

    return { rows: rows || [], rowCount: rowCount || 0 };
  }

  end() {
    try {
      this._port.postMessage({ type: 'close' });
      Atomics.store(this._sharedCmd, 0, 1);
      Atomics.notify(this._sharedCmd, 0);
      setTimeout(() => this._worker.terminate(), 500);
    } catch (_) {}
  }
}

// ─── PgStatement ─────────────────────────────────────────────────────────────

class PgStatement {
  constructor(client, sql) {
    this._client = client;
    this._sql    = placeholders(convertSql(sql));
  }

  _execute(params) {
    try {
      return this._client.query(this._sql, params);
    } catch (err) {
      // INSERT OR IGNORE → duplicate-key no-op
      if (err.code === '23505' && /INSERT\s+INTO/i.test(this._sql)) {
        return { rows: [], rowCount: 0 };
      }
      throw err;
    }
  }

  get(...params) { return this._execute(params).rows[0]; }
  all(...params) { return this._execute(params).rows; }
  run(...params) {
    const result   = this._execute(params);
    const returned = result.rows[0] || {};
    return { changes: result.rowCount || 0, lastInsertRowid: returned.id ?? null };
  }
}

// ─── PgCompat ─────────────────────────────────────────────────────────────────

// FIX: Singleton — اتصال واحد فقط طوال عمر البوت
let _singletonClient = null;

class PgCompat {
  constructor(connectionString, options = {}) {
    // إعادة استخدام نفس الـ client إذا كان موجوداً بنفس الـ connectionString
    if (!_singletonClient) {
      _singletonClient = new PgSyncClient(connectionString, options.ssl);
    }
    this._client = _singletonClient;
  }

  pragma() { return undefined; }

  prepare(sql) {
    const trimmed = String(sql).trim();

    // PRAGMA table_info → information_schema
    if (/^PRAGMA\s+table_info\s*\(/i.test(trimmed)) {
      const match = trimmed.match(/^PRAGMA\s+table_info\s*\(([^)]+)\)/i);
      const table = String(match?.[1] || '').replace(/["'`]/g, '');
      return {
        all: () => this._client.query(
          `SELECT ordinal_position AS cid, column_name AS name, data_type AS type,
                  (is_nullable = 'NO')::int AS notnull
           FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = $1
           ORDER BY ordinal_position`,
          [table]
        ).rows,
      };
    }

    return new PgStatement(this._client, sql);
  }

  exec(sql) {
    const statements = String(sql)
      .split(/;\s*(?=CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|PRAGMA|--|$)/i)
      .map((s) => s.replace(/--.*$/gm, '').trim())
      .filter(Boolean);

    for (const stmt of statements) {
      if (/^PRAGMA\b/i.test(stmt)) continue;
      this._client.query(convertSql(stmt));
    }
  }

  transaction(fn) {
    return (...args) => {
      this._client.query('BEGIN');
      try {
        const value = fn(...args);
        this._client.query('COMMIT');
        return value;
      } catch (err) {
        try { this._client.query('ROLLBACK'); } catch (_) {}
        throw err;
      }
    };
  }

  close() {
    // لا تُغلق الـ singleton — البوت لا يزال يعمل
  }
}

module.exports = { PgCompat, convertSql, placeholders };
