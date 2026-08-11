/**
 * pg-worker.js — one-shot PostgreSQL query runner
 *
 * يستقبل mode من process.argv[2]:
 *   --init  : يتصل ويُعيد {"type":"ready"} أو {"type":"fatal","error":"..."}
 *   --query : يقرأ {"sql","params"} من stdin وينفّذ ويُعيد النتيجة
 */

'use strict';

const { Client } = require('pg');

const connStr    = process.env.PG_CONN_STR    || '';
const isInternal = process.env.PG_IS_INTERNAL === '1';
const sslConfig  = isInternal ? false : { rejectUnauthorized: false };
const mode       = process.argv[2]; // '--init' or '--query'

async function main() {
  const client = new Client({
    connectionString: connStr,
    ssl:              sslConfig,
    connectionTimeoutMillis: 25000,
    statement_timeout:       25000,
  });

  if (mode === '--init') {
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');
      process.exit(0);
    } catch (err) {
      process.stdout.write(JSON.stringify({ type: 'fatal', error: err.message }) + '\n');
      process.exit(0);
    }
    return;
  }

  if (mode === '--query') {
    // قراءة الـ input من stdin
    let raw = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;

    let msg;
    try { msg = JSON.parse(raw.trim()); } catch {
      process.stdout.write(JSON.stringify({ error: 'Invalid JSON', code: null }) + '\n');
      process.exit(0);
      return;
    }

    try {
      await client.connect();
      const result = await client.query(msg.sql, msg.params || []);
      await client.end();
      process.stdout.write(JSON.stringify({
        rows:     result.rows     || [],
        rowCount: result.rowCount || 0,
      }) + '\n');
      process.exit(0);
    } catch (err) {
      await client.end().catch(() => {});
      process.stdout.write(JSON.stringify({
        error: err.message,
        code:  err.code || null,
      }) + '\n');
      process.exit(0);
    }
    return;
  }

  process.stderr.write('Unknown mode: ' + mode + '\n');
  process.exit(1);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err.message, code: null }) + '\n');
  process.exit(0);
});
