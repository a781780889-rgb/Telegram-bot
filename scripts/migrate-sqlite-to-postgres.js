#!/usr/bin/env node

/**
 * One-time SQLite -> PostgreSQL migration.
 *
 * Usage:
 *   DATABASE_URL='postgres://...' SQLITE_PATH='./data/accounts.db' node scripts/migrate-sqlite-to-postgres.js
 *
 * The script is intentionally explicit and idempotent: it creates missing
 * tables, inserts rows with conflict-safe keys, and never deletes PostgreSQL data.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const sqlitePath = process.env.SQLITE_PATH || process.env.DB_PATH || './data/accounts.db';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite database not found: ${sqlitePath}`);

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const pgType = (type) => {
  const t = String(type || '').toUpperCase();
  if (t.includes('INT')) return 'BIGINT';
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'TEXT';
  if (t.includes('BLOB')) return 'BYTEA';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'DOUBLE PRECISION';
  if (t.includes('BOOL')) return 'BOOLEAN';
  if (t.includes('DATE') || t.includes('TIME')) return 'TIMESTAMPTZ';
  if (t.includes('JSON')) return 'JSONB';
  return 'TEXT';
};

const tableDefinitions = (sqlite) => sqlite.prepare(`
  SELECT name, sql FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY CASE WHEN name = 'schema_migrations' THEN 0 ELSE 1 END, name
`).all();

const columnsFor = (sqlite, table) => sqlite.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
const createTableSql = (table, columns) => {
  const primary = columns.filter((c) => c.pk).sort((a, b) => a.pk - b.pk);
  const definitions = columns.map((c) => {
    const isSingleIntegerPk = primary.length === 1 && c.pk === 1 && /INT/i.test(c.type || '');
    const type = isSingleIntegerPk ? 'BIGSERIAL' : pgType(c.type);
    const nullable = c.notnull || c.pk ? ' NOT NULL' : '';
    const defaultValue = c.dflt_value && !/CURRENT_TIMESTAMP/i.test(c.dflt_value)
      ? ` DEFAULT ${String(c.dflt_value).replace(/\bdatetime\s*\([^)]*\)/ig, 'CURRENT_TIMESTAMP')}` : '';
    return `${quoteIdent(c.name)} ${type}${nullable}${defaultValue}`;
  });
  if (primary.length > 1) definitions.push(`PRIMARY KEY (${primary.map((c) => quoteIdent(c.name)).join(', ')})`);
  else if (primary.length === 1 && !/INT/i.test(primary[0].type || '')) definitions.push(`PRIMARY KEY (${quoteIdent(primary[0].name)})`);
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${definitions.join(', ')})`;
};

const migrate = async () => {
  const sqlite = new Database(sqlitePath, { readonly: true });
  const client = new Client({ connectionString: databaseUrl, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const tables = tableDefinitions(sqlite);
    await client.query('BEGIN');
    for (const table of tables) {
      const columns = columnsFor(sqlite, table.name);
      await client.query(createTableSql(table.name, columns));
    }
    for (const table of tables) {
      const columns = columnsFor(sqlite, table.name);
      if (!columns.length) continue;
      const names = columns.map((c) => c.name);
      const rows = sqlite.prepare(`SELECT ${names.map(quoteIdent).join(', ')} FROM ${quoteIdent(table.name)}`).all();
      for (const row of rows) {
        const values = names.map((name) => row[name] instanceof Uint8Array ? Buffer.from(row[name]) : row[name]);
        const params = values.map((_, i) => `$${i + 1}`).join(', ');
        const columnsSql = names.map(quoteIdent).join(', ');
        const identity = columns.find((c) => c.pk)?.name || names[0];
        await client.query(`INSERT INTO ${quoteIdent(table.name)} (${columnsSql}) VALUES (${params}) ON CONFLICT (${quoteIdent(identity)}) DO NOTHING`, values);
      }
      const identity = columns.find((c) => c.pk);
      if (identity && /INT/i.test(identity.type || '')) {
        await client.query(`SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${quoteIdent(identity.name)}) FROM ${quoteIdent(table.name)}), 1), true)`, [`${table.name}`, identity.name]);
      }
      console.log(`${table.name}: ${rows.length} rows`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    sqlite.close();
    await client.end();
  }
};

migrate().then(() => console.log('SQLite -> PostgreSQL migration completed.')).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
