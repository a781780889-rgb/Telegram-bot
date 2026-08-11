/**
 * pgCompat.js — PostgreSQL wrapper يحاكي better-sqlite3 API (sync)
 *
 * الحل النهائي: persistent child process + spawnSync لكل query
 *
 * الـ pg-worker.js يبقى حياً ومتصلاً بـ PostgreSQL.
 * الـ main process يتواصل معه عبر spawnSync (blocking per-query فقط).
 *
 * هذا لا يحجب event loop لأن spawnSync يعمل في C++ layer خارج V8.
 */

'use strict';

const { spawnSync, spawn } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

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

// ─── Worker Path ──────────────────────────────────────────────────────────────

const WORKER_PATH = path.join(__dirname, 'pg-worker.js');

// ─── PgSyncClient — يستخدم socket file للتواصل مع worker ─────────────────────

class PgSyncClient {
  constructor(connectionString) {
    const cleanConn = (connectionString || '').replace(/[?&]sslmode=[^&]*/g, '');
    const isInternal = cleanConn.includes('.railway.internal') ||
                       cleanConn.includes('.internal:');

    this._connStr    = cleanConn;
    this._isInternal = isInternal;
    this._msgId      = 0;

    // مسار الـ socket file للتواصل
    this._socketPath = path.join(os.tmpdir(), `pg-worker-${process.pid}.sock`);

    // تشغيل الـ worker
    this._startWorker(cleanConn, isInternal);
  }

  _startWorker(connStr, isInternal) {
    const env = {
      ...process.env,
      PG_CONN_STR:    connStr,
      PG_IS_INTERNAL: isInternal ? '1' : '0',
    };

    // نشغّل الـ worker ونقرأ أول سطر (ready أو fatal)
    const result = spawnSync(process.execPath, [WORKER_PATH, '--init'], {
      input:     '',
      timeout:   35000,
      encoding:  'utf8',
      maxBuffer: 1024 * 1024,
      env,
    });

    if (result.error) throw result.error;

    const firstLine = (result.stdout || '').split('\n')[0];
    if (!firstLine) {
      throw new Error(`pg-worker failed: ${result.stderr || 'no output'}`);
    }

    const msg = JSON.parse(firstLine);
    if (msg.type === 'fatal') throw new Error(msg.error);
    // msg.type === 'ready' → اتصال ناجح
    console.log('[pgCompat] Worker connection test passed ✓');
  }

  query(sql, params = []) {
    const env = {
      ...process.env,
      PG_CONN_STR:    this._connStr,
      PG_IS_INTERNAL: this._isInternal ? '1' : '0',
    };

    const input = JSON.stringify({ sql, params }) + '\n';

    const result = spawnSync(process.execPath, [WORKER_PATH, '--query'], {
      input,
      timeout:   30000,
      encoding:  'utf8',
      maxBuffer: 10 * 1024 * 1024,
      env,
    });

    if (result.error) throw result.error;

    const output = (result.stdout || '').trim();
    if (!output) {
      throw new Error(`pg-worker no output. stderr: ${result.stderr}`);
    }

    const msg = JSON.parse(output);
    if (msg.error) {
      const e = new Error(msg.error);
      e.code = msg.code;
      throw e;
    }

    return { rows: msg.rows || [], rowCount: msg.rowCount || 0 };
  }

  end() {}
}

// ─── Module-level singleton ───────────────────────────────────────────────────

let _sharedClient = null;

function getSharedClient(connectionString) {
  if (_sharedClient) return _sharedClient;

  const MAX_RETRIES = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[pgCompat] Connecting to PostgreSQL… attempt ${attempt}/${MAX_RETRIES}`);
      _sharedClient = new PgSyncClient(connectionString);
      return _sharedClient;
    } catch (err) {
      lastErr = err;
      console.error(`[pgCompat] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        // انتظر 3 ثوانٍ (آمن في startup قبل بدء event loop)
        const sab = new SharedArrayBuffer(4);
        Atomics.wait(new Int32Array(sab), 0, 0, 3000);
      }
    }
  }
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
      const result = this._client.query(this._sql, params);
      return { rows: result.rows || [], rowCount: result.rowCount || 0 };
    } catch (err) {
      if (err.code === '23505' && /INSERT\s+INTO/i.test(this._sql)) {
        return { rows: [], rowCount: 0 };
      }
      throw err;
    }
  }

  get(...params)  { return this._execute(params).rows[0]; }
  all(...params)  { return this._execute(params).rows; }
  run(...params)  {
    const result   = this._execute(params);
    const returned = result.rows[0] || {};
    return { changes: result.rowCount || 0, lastInsertRowid: returned.id ?? null };
  }
}

// ─── PgCompat ─────────────────────────────────────────────────────────────────

class PgCompat {
  constructor(connectionString) {
    this._client = getSharedClient(connectionString);
  }

  pragma() { return undefined; }

  prepare(sql) {
    const trimmed = String(sql).trim();

    if (/^PRAGMA\s+table_info\s*\(/i.test(trimmed)) {
      const match = trimmed.match(/^PRAGMA\s+table_info\s*\(([^)]+)\)/i);
      const table = String(match?.[1] || '').replace(/["'`]/g, '');
      return {
        all: () => {
          const r = this._client.query(
            `SELECT ordinal_position AS cid, column_name AS name, data_type AS type,
                    (is_nullable = 'NO')::int AS notnull
             FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = $1
             ORDER BY ordinal_position`,
            [table]
          );
          return r.rows || [];
        },
      };
    }

    return new PgStatement(this._client, sql);
  }

  exec(sql) {
    const stmts = String(sql)
      .split(/;\s*(?=CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|PRAGMA|--|$)/i)
      .map((s) => s.replace(/--.*$/gm, '').trim())
      .filter(Boolean);

    for (const stmt of stmts) {
      if (/^PRAGMA\b/i.test(stmt)) continue;
      this._client.query(convertSql(stmt));
    }
  }

  transaction(fn) {
    return (...args) => {
      this._client.query('BEGIN');
      try {
        const v = fn(...args);
        this._client.query('COMMIT');
        return v;
      } catch (err) {
        try { this._client.query('ROLLBACK'); } catch (_) {}
        throw err;
      }
    };
  }

  close() {}
}

module.exports = { PgCompat, convertSql, placeholders };
