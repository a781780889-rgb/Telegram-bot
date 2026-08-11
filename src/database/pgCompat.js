/**
 * pgCompat.js — PostgreSQL wrapper يحاكي better-sqlite3 API (sync)
 *
 * يستخدم deasync لتشغيل PostgreSQL queries بشكل synchronous
 * بدون حجب event loop — هذا هو الأسلوب الصحيح في Node.js.
 *
 * السبب: Atomics.wait محظور في main thread في Node.js 18+
 *         deasync يحل هذه المشكلة تماماً.
 */

'use strict';

const { Client } = require('pg');
const deasync    = require('deasync');

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

// ─── Sync wrapper باستخدام deasync ───────────────────────────────────────────

/**
 * تحويل دالة async إلى sync باستخدام deasync
 * @param {Function} asyncFn - دالة async تعيد Promise
 * @returns {*} نتيجة الدالة
 */
function runSync(asyncFn) {
  let done = false;
  let result;
  let error;

  asyncFn()
    .then((r) => { result = r; done = true; })
    .catch((e) => { error = e;  done = true; });

  // deasync يُشغّل event loop حتى تكتمل العملية
  deasync.loopWhile(() => !done);

  if (error) throw error;
  return result;
}

// ─── PgSyncClient ─────────────────────────────────────────────────────────────

class PgSyncClient {
  constructor(connectionString, ssl) {
    // Railway internal hostname لا يدعم SSL
    const connStr = (connectionString || '')
      .replace(/[?&]sslmode=[^&]*/g, '');

    const isInternal = connStr.includes('.railway.internal') ||
                       connStr.includes('.internal:');
    const sslConfig  = isInternal ? false : { rejectUnauthorized: false };

    this._client = new Client({
      connectionString: connStr,
      ssl: sslConfig,
      connectionTimeoutMillis: 30000,
    });

    // اتصال synchronous
    runSync(() => this._client.connect());
    console.log('[pgCompat] Connected to PostgreSQL ✓');
  }

  query(sql, params = []) {
    return runSync(() => this._client.query(sql, params || []));
  }

  end() {
    try { runSync(() => this._client.end()); } catch (_) {}
  }
}

// ─── Module-level singleton ───────────────────────────────────────────────────

let _sharedClient = null;
let _lastConnStr  = null;

function getSharedClient(connectionString, ssl) {
  if (_sharedClient && _lastConnStr === connectionString) {
    return _sharedClient;
  }

  const MAX_RETRIES = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[pgCompat] Connecting to PostgreSQL… attempt ${attempt}/${MAX_RETRIES}`);
      _sharedClient = new PgSyncClient(connectionString, ssl);
      _lastConnStr  = connectionString;
      return _sharedClient;
    } catch (err) {
      lastErr = err;
      console.error(`[pgCompat] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        // انتظر 3 ثوانٍ قبل إعادة المحاولة
        let waited = false;
        setTimeout(() => { waited = true; }, 3000);
        deasync.loopWhile(() => !waited);
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
      // INSERT OR IGNORE → duplicate-key no-op
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
  constructor(connectionString, options = {}) {
    this._client = getSharedClient(connectionString, options.ssl);
  }

  pragma() { return undefined; }

  prepare(sql) {
    const trimmed = String(sql).trim();

    // PRAGMA table_info → information_schema
    if (/^PRAGMA\s+table_info\s*\(/i.test(trimmed)) {
      const match = trimmed.match(/^PRAGMA\s+table_info\s*\(([^)]+)\)/i);
      const table = String(match?.[1] || '').replace(/["'`]/g, '');
      return {
        all: () => {
          const result = this._client.query(
            `SELECT ordinal_position AS cid, column_name AS name, data_type AS type,
                    (is_nullable = 'NO')::int AS notnull
             FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = $1
             ORDER BY ordinal_position`,
            [table]
          );
          return result.rows || [];
        },
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

  // لا تُغلق الـ shared client
  close() {}
}

module.exports = { PgCompat, convertSql, placeholders };
