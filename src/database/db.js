const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const dbPath = process.env.DB_PATH || './data/accounts.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

const getDb = () => {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema();
  }
  return db;
};

const initializeSchema = () => {
  const database = db;

  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      username TEXT,
      telegram_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      session_file TEXT,
      encrypted_session TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, phone)
    );

    CREATE TABLE IF NOT EXISTS bot_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id TEXT NOT NULL UNIQUE,
      username TEXT,
      first_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
    CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts(phone);
    CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);
  `);

  logger.info('Database schema initialized');

  // Initialize links schema (lazy import to avoid circular dep)
  try {
    const { initLinksSchema } = require('./linksDb');
    initLinksSchema();
  } catch (_) {}
};

// ─── Account Queries ──────────────────────────────────────────────────────────

const accountQueries = {
  insert: (userId, phone) => {
    const stmt = getDb().prepare(`
      INSERT OR REPLACE INTO accounts (user_id, phone, status, updated_at)
      VALUES (?, ?, 'connecting', CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(userId, phone);
    return result.lastInsertRowid;
  },

  updateStatus: (id, status, extra = {}) => {
    const fields = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [status];

    const allowedExtras = [
      'error_message',
      'first_name',
      'last_name',
      'username',
      'telegram_id',
      'session_file',
      'encrypted_session',
    ];

    for (const key of allowedExtras) {
      if (extra[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(extra[key]);
      }
    }

    values.push(id);

    const stmt = getDb().prepare(
      `UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`
    );
    return stmt.run(...values);
  },

  getByUserIdAndPhone: (userId, phone) => {
    return getDb()
      .prepare('SELECT * FROM accounts WHERE user_id = ? AND phone = ?')
      .get(userId, phone);
  },

  getById: (id) => {
    return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  },

  getAllByUserId: (userId) => {
    return getDb()
      .prepare(
        'SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at DESC'
      )
      .all(userId);
  },

  deleteById: (id, userId) => {
    const stmt = getDb().prepare(
      'DELETE FROM accounts WHERE id = ? AND user_id = ?'
    );
    return stmt.run(id, userId);
  },

  // ─── Statistics Queries ───────────────────────────────────────────────────

  getStatsByUserId: (userId) => {
    const database = getDb();

    const total = database
      .prepare('SELECT COUNT(*) as count FROM accounts WHERE user_id = ?')
      .get(userId)?.count || 0;

    const connected = database
      .prepare(
        "SELECT COUNT(*) as count FROM accounts WHERE user_id = ? AND status = 'connected'"
      )
      .get(userId)?.count || 0;

    const disconnected = database
      .prepare(
        "SELECT COUNT(*) as count FROM accounts WHERE user_id = ? AND status IN ('disconnected', 'error', 'banned')"
      )
      .get(userId)?.count || 0;

    const needsRelogin = database
      .prepare(
        "SELECT COUNT(*) as count FROM accounts WHERE user_id = ? AND status IN ('needs_password', 'otp_sent', 'error', 'disconnected')"
      )
      .get(userId)?.count || 0;

    const addedToday = database
      .prepare(
        "SELECT COUNT(*) as count FROM accounts WHERE user_id = ? AND DATE(created_at) = DATE('now')"
      )
      .get(userId)?.count || 0;

    return { total, connected, disconnected, needsRelogin, addedToday };
  },
};

// ─── Bot User Queries ─────────────────────────────────────────────────────────

const botUserQueries = {
  upsert: (telegramUserId, username, firstName) => {
    const stmt = getDb().prepare(`
      INSERT INTO bot_users (telegram_user_id, username, first_name, last_seen)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_seen = CURRENT_TIMESTAMP
    `);
    return stmt.run(String(telegramUserId), username || null, firstName || null);
  },
};

module.exports = { getDb, accountQueries, botUserQueries };
