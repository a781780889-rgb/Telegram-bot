const { Client } = require('pg');
const deasync = require('deasync');

const wait = (promise) => {
  let done = false;
  let result;
  let error;
  promise.then((value) => { result = value; done = true; }, (reason) => { error = reason; done = true; });
  deasync.loopWhile(() => !done);
  if (error) throw error;
  return result;
};

const convertSql = (sql) => String(sql)
  .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY')
  .replace(/\bINT\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY')
  .replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ')
  .replace(/\bBLOB\b/gi, 'BYTEA')
  .replace(/\bREAL\b/gi, 'DOUBLE PRECISION')
  .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
  .replace(/\bWITHOUT\s+ROWID\b/gi, '')
  .replace(/DATE\s*\(\s*'now'\s*\)/gi, 'CURRENT_DATE')
  .replace(/datetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP')
  .replace(/datetime\s*\(\s*'now'\s*,\s*'(-?\d+)\s+day'\s*\)/gi, (_, days) => `CURRENT_TIMESTAMP ${Number(days) >= 0 ? '+' : '-'} INTERVAL '${Math.abs(Number(days))} day'`)
  .replace(/julianday\s*\(([^)]+)\)/gi, 'EXTRACT(EPOCH FROM ($1::timestamptz)) / 86400.0');

const placeholders = (sql) => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
};

class PgStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = placeholders(convertSql(sql));
  }

  execute(params) {
    try {
      return wait(this.database.client.query(this.sql, params));
    } catch (error) {
      // SQLite's INSERT OR IGNORE semantics are represented by a duplicate-key no-op.
      if (error.code === '23505' && /INSERT\s+INTO/i.test(this.sql)) return { rows: [], rowCount: 0 };
      throw error;
    }
  }

  get(...params) { return this.execute(params).rows[0]; }
  all(...params) { return this.execute(params).rows; }
  run(...params) {
    const result = this.execute(params);
    const returned = result.rows[0] || {};
    return { changes: result.rowCount || 0, lastInsertRowid: returned.id ?? null };
  }
}

class PgCompat {
  constructor(connectionString, options = {}) {
    this.client = new Client({
      connectionString,
      ssl: options.ssl === false ? false : { rejectUnauthorized: false },
    });
    wait(this.client.connect());
  }

  pragma() { return undefined; }

  prepare(sql) {
    const trimmed = String(sql).trim();
    if (/^PRAGMA\s+table_info\s*\(/i.test(trimmed)) {
      const match = trimmed.match(/^PRAGMA\s+table_info\s*\(([^)]+)\)/i);
      const table = String(match?.[1] || '').replace(/["'`]/g, '');
      return {
        all: () => wait(this.client.query(
          `SELECT ordinal_position AS cid, column_name AS name, data_type AS type, (is_nullable = 'NO')::int AS notnull FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`, [table]
        )).rows,
      };
    }
    return new PgStatement(this, sql);
  }

  exec(sql) {
    const statements = String(sql).split(/;\s*(?=CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|PRAGMA|--|$)/i)
      .map((item) => item.replace(/--.*$/gm, '').trim()).filter(Boolean);
    for (const statement of statements) {
      if (/^PRAGMA\b/i.test(statement)) continue;
      wait(this.client.query(convertSql(statement)));
    }
  }

  transaction(fn) {
    return (...args) => {
      wait(this.client.query('BEGIN'));
      try {
        const value = fn(...args);
        wait(this.client.query('COMMIT'));
        return value;
      } catch (error) {
        wait(this.client.query('ROLLBACK'));
        throw error;
      }
    };
  }

  close() { wait(this.client.end()); }
}

module.exports = { PgCompat, convertSql, placeholders };
