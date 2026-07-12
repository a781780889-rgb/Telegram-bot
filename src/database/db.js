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
  `);

  logger.info('Database schema initialized');
};

// ─── Account Queries ─────────────────────────────────────────────────────────

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

    if (extra.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(extra.error_message);
    }
    if (extra.first_name !== undefined) {
      fields.push('first_name = ?');
      values.push(extra.first_name);
    }
    if (extra.last_name !== undefined) {
      fields.push('last_name = ?');
      values.push(extra.last_name);
    }
    if (extra.username !== undefined) {
      fields.push('username = ?');
      values.push(extra.username);
    }
    if (extra.telegram_id !== undefined) {
      fields.push('telegram_id = ?');
      values.push(extra.telegram_id);
    }
    if (extra.session_file !== undefined) {
      fields.push('session_file = ?');
      values.push(extra.session_file);
    }
    if (extra.encrypted_session !== undefined) {
      fields.push('encrypted_session = ?');
      values.push(extra.encrypted_session);
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

  countByUserId: (userId) => {
    const row = getDb()
      .prepare(
        'SELECT COUNT(*) as count FROM accounts WHERE user_id = ? AND status = ?'
      )
      .get(userId, 'connected');
    return row ? row.count : 0;
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
