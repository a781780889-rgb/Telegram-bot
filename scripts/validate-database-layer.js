const fs = require('fs');
const path = require('path');
const dbPath = process.env.DB_PATH || '/tmp/telegram-bot-validation.db';
try { fs.rmSync(dbPath, { force: true }); } catch (_) {}
const { getDb, accountQueries, botUserQueries } = require('../src/database/db');
const db = getDb();
botUserQueries.upsert('validation-user', 'tester', 'Test');
const id = accountQueries.insert('validation-user', '+10000000000');
const row = accountQueries.getById(id);
if (!row || row.user_id !== 'validation-user') throw new Error('Account round-trip failed');
console.log(JSON.stringify({ driver: process.env.DATABASE_URL ? 'postgres' : 'sqlite', accountId: id, status: row.status }));
if (typeof db.close === 'function') db.close();
