/**
 * pgCompat.js — PostgreSQL wrapper يحاكي better-sqlite3 API (sync)
 *
 * يستخدم worker_threads + Atomics.wait لتنفيذ PostgreSQL queries
 * بشكل متزامن حقيقي بدون حجب event loop.
 *
 * FIX v2:
 *  1. singleton على مستوى الـ module (لا يُنشأ client جديد بعد الأول)
 *  2. timeout الاتصال مرفوع لـ 30 ثانية (Railway cold start)
 *  3. إعادة المحاولة التلقائية 3 مرات عند فشل الاتصال
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

  // Railway PostgreSQL: نُجبر SSL مع rejectUnauthorized:false
  // ونُزيل sslmode من الـ URL إذا كان موجوداً (يتعارض مع خيار ssl)
  const connStr = (workerData.connectionString || '')
    .replace(/[?&]sslmode=[^&]*/g, '');

  const client = new Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
    statement_timeout: 30000,
  });

  try {
    await client.connect();
  } catch (err) {
    port.postMessage({ type: 'fatal', message: err.message });
    return;
  }

  port.postMessage({ type: 'ready' });

  while (true) {
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
    this._connectionString = connectionString;
    this._ssl = ssl;
    this._connect();
  }

  _connect() {
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
        connectionString: this._connectionString,
        ssl: this._ssl === false ? false : { rejectUnauthorized: false },
        port: port2,
        sharedCmd:    sabCmd,
        sharedResult: sabResult,
      },
      transferList: [port2],
    });

    // انتظر ready — مرفوع لـ 30 ثانية لاستيعاب Railway cold start
    let ready = false;
    let fatalError = null;
    this._worker.on('message', (m) => {
      if (m.type === 'ready') ready = true;
      if (m.type === 'fatal') fatalError = m.message;
    });

    const deadline = Date.now() + 30000;
    while (!ready && !fatalError && Date.now() < deadline) {
      Atomics.wait(this._sharedResult, 0, 0, 200);
    }

    if (fatalError) throw new Error(`PgSyncClient: ${fatalError}`);
    if (!ready) throw new Error('PgSyncClient: connection timeout after 30s');
  }

  query(sql, params = []) {
    const id = ++this._msgId;

    Atomics.store(this._sharedResult, 0, 0);
    this._port.postMessage({ type: 'query', id, sql, params });
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

// ─── Module-level singleton ───────────────────────────────────────────────────
// PgSyncClient واحد فقط لكل process — يُعاد الاتصال تلقائياً عند الفشل

let _sharedClient = null;
let _lastConnStr  = null;
let _connecting   = false; // منع التزامن

/**
 * يُعيد الـ singleton، وينشئه إذا لم يكن موجوداً.
 * إذا فشل الاتصال السابق (_sharedClient === null) يُعيد المحاولة.
 * عند فشل كل المحاولات يرمي الخطأ — المُستدعي يُقرر ماذا يفعل.
 */
function getSharedClient(connectionString, ssl) {
  if (_sharedClient && _lastConnStr === connectionString) {
    return _sharedClient;
  }

  // إذا كان هناك اتصال جارٍ في نفس الـ process، انتظر
  if (_connecting) {
    const wait = Date.now() + 35000;
    while (_connecting && Date.now() < wait) {
      const p = Date.now() + 100;
      while (Date.now() < p) { /* busy-wait */ }
    }
    if (_sharedClient) return _sharedClient;
  }

  _connecting = true;
  const MAX_RETRIES = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[pgCompat] Connecting to PostgreSQL… attempt ${attempt}/${MAX_RETRIES}`);
      const client = new PgSyncClient(connectionString, ssl);
      _sharedClient = client;
      _lastConnStr  = connectionString;
      _connecting   = false;
      console.log('[pgCompat] Connected ✓');
      return _sharedClient;
    } catch (err) {
      lastErr = err;
      console.error(`[pgCompat] Connection attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        const pause = Date.now() + 3000;
        while (Date.now() < pause) { /* wait 3s */ }
      }
    }
  }

  _connecting = false;
  throw lastErr;
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

class PgCompat {
  constructor(connectionString, options = {}) {
    this._client = getSharedClient(connectionString, options.ssl);
  }

  pragma() { return undefined; }

  prepare(sql) {
    const trimmed = String(sql).trim();

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

  // لا تُغلق الـ shared client — البوت لا يزال يعمل
  close() {}
}

module.exports = { PgCompat, convertSql, placeholders };
