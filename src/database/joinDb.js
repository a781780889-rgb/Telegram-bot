/**
 * Join-to-Links Database Module
 *
 * Provides the schema and all queries for the "الانضمام للروابط" feature:
 *   - join_groups    : central registry of every Telegram group ever handled
 *                      (dedup key = telegram_id, NOT the raw link)
 *   - join_links     : queued/processed links submitted by the user
 *   - join_tasks     : one row per join attempt (account × link)
 *   - join_accounts  : per-account join settings/state (enabled, limits, ban info)
 *   - join_settings  : per-user speed / interval / batch settings
 *   - join_logs      : full operations log for the Logs page
 *
 * Shares the SQLite file that db.js owns; imported lazily from db.js
 * during initializeSchema() to avoid a circular-require issue — same
 * pattern as linksDb.js / subscriptionsDb.js.
 */

const { getDb } = require('./db');
const logger = require('../utils/logger');

// ─── Schema ───────────────────────────────────────────────────────────────────

const initJoinSchema = () => {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS join_groups (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        TEXT    NOT NULL,
      telegram_id    TEXT    NOT NULL,
      title          TEXT,
      joined_by_account_id INTEGER,
      first_link     TEXT,
      status         TEXT    NOT NULL DEFAULT 'joined',
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, telegram_id)
    );

    CREATE TABLE IF NOT EXISTS join_links (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        TEXT    NOT NULL,
      url            TEXT    NOT NULL,
      url_type       TEXT    NOT NULL DEFAULT 'public',
      telegram_id    TEXT,
      status         TEXT    NOT NULL DEFAULT 'pending',
      assigned_account_id INTEGER,
      skip_reason    TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at   DATETIME
    );

    CREATE TABLE IF NOT EXISTS join_accounts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             TEXT    NOT NULL,
      account_id          INTEGER NOT NULL,
      enabled             INTEGER NOT NULL DEFAULT 1,
      state               TEXT    NOT NULL DEFAULT 'idle',
      joined_count        INTEGER NOT NULL DEFAULT 0,
      max_joins           INTEGER NOT NULL DEFAULT 50,
      batch_size          INTEGER NOT NULL DEFAULT 3,
      join_delay_seconds  INTEGER NOT NULL DEFAULT 30,
      rest_seconds        INTEGER NOT NULL DEFAULT 600,
      batch_progress      INTEGER NOT NULL DEFAULT 0,
      cooldown_until       DATETIME,
      ban_reason          TEXT,
      last_joined_at      DATETIME,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, account_id)
    );

    CREATE TABLE IF NOT EXISTS join_settings (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            TEXT    NOT NULL UNIQUE,
      batch_size         INTEGER NOT NULL DEFAULT 3,
      join_delay_seconds INTEGER NOT NULL DEFAULT 30,
      rest_seconds       INTEGER NOT NULL DEFAULT 600,
      max_joins_per_account INTEGER NOT NULL DEFAULT 50,
      auto_distribute    INTEGER NOT NULL DEFAULT 1,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS join_logs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        TEXT    NOT NULL,
      account_id     INTEGER,
      link           TEXT,
      group_title    TEXT,
      result         TEXT    NOT NULL,
      detail         TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_join_groups_user_tid  ON join_groups(user_id, telegram_id);
    CREATE INDEX IF NOT EXISTS idx_join_links_user_id    ON join_links(user_id);
    CREATE INDEX IF NOT EXISTS idx_join_links_status     ON join_links(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_join_accounts_user_id ON join_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_join_logs_user_id     ON join_logs(user_id, created_at);
  `);

  logger.info('Join-to-links schema initialised.');
};

// ─── Groups (dedup registry, keyed by Telegram ID) ─────────────────────────────

const joinGroupQueries = {
  exists: (userId, telegramId) => {
    return !!getDb()
      .prepare('SELECT 1 FROM join_groups WHERE user_id = ? AND telegram_id = ?')
      .get(userId, String(telegramId));
  },

  register: (userId, telegramId, title, accountId, link) => {
    const stmt = getDb().prepare(`
      INSERT INTO join_groups (user_id, telegram_id, title, joined_by_account_id, first_link, status)
      VALUES (?, ?, ?, ?, ?, 'joined')
      ON CONFLICT(user_id, telegram_id) DO NOTHING
    `);
    return stmt.run(userId, String(telegramId), title || null, accountId, link || null);
  },

  getAllByUserId: (userId) => {
    return getDb()
      .prepare('SELECT * FROM join_groups WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId);
  },

  countByUserId: (userId) => {
    return getDb()
      .prepare('SELECT COUNT(*) as count FROM join_groups WHERE user_id = ?')
      .get(userId)?.count || 0;
  },
};

// ─── Links queue ────────────────────────────────────────────────────────────────

const joinLinkQueries = {
  insertMany: (userId, urls) => {
    const insert = getDb().prepare(
      `INSERT INTO join_links (user_id, url, status) VALUES (?, ?, 'pending')`
    );
    const tx = getDb().transaction((rows) => {
      for (const url of rows) insert.run(userId, url);
    });
    tx(urls);
    return urls.length;
  },

  getPendingByUserId: (userId, limit = 500) => {
    return getDb()
      .prepare(
        `SELECT * FROM join_links WHERE user_id = ? AND status = 'pending' ORDER BY id ASC LIMIT ?`
      )
      .all(userId, limit);
  },

  countByStatus: (userId) => {
    const rows = getDb()
      .prepare(
        `SELECT status, COUNT(*) as count FROM join_links WHERE user_id = ? GROUP BY status`
      )
      .all(userId);
    const out = { pending: 0, joined: 0, skipped: 0, failed: 0, invalid: 0 };
    for (const r of rows) out[r.status] = r.count;
    return out;
  },

  updateStatus: (id, status, extra = {}) => {
    const fields = ['status = ?', 'processed_at = CURRENT_TIMESTAMP'];
    const values = [status];
    const allowed = ['telegram_id', 'assigned_account_id', 'skip_reason', 'url_type'];
    for (const key of allowed) {
      if (extra[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(extra[key]);
      }
    }
    values.push(id);
    return getDb()
      .prepare(`UPDATE join_links SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  deleteAllByUserId: (userId) => {
    return getDb().prepare('DELETE FROM join_links WHERE user_id = ?').run(userId);
  },
};

// ─── Per-account join state ──────────────────────────────────────────────────────

const joinAccountQueries = {
  ensure: (userId, accountId) => {
    getDb()
      .prepare(
        `INSERT INTO join_accounts (user_id, account_id) VALUES (?, ?)
         ON CONFLICT(user_id, account_id) DO NOTHING`
      )
      .run(userId, accountId);
    return joinAccountQueries.get(userId, accountId);
  },

  get: (userId, accountId) => {
    return getDb()
      .prepare('SELECT * FROM join_accounts WHERE user_id = ? AND account_id = ?')
      .get(userId, accountId);
  },

  getAllByUserId: (userId) => {
    return getDb()
      .prepare(
        `SELECT ja.*, a.phone, a.first_name, a.last_name, a.status as account_status
         FROM join_accounts ja
         JOIN accounts a ON a.id = ja.account_id
         WHERE ja.user_id = ?
         ORDER BY ja.id ASC`
      )
      .all(userId);
  },

  setEnabled: (userId, accountId, enabled) => {
    return getDb()
      .prepare(
        `UPDATE join_accounts SET enabled = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND account_id = ?`
      )
      .run(enabled ? 1 : 0, userId, accountId);
  },

  updateState: (userId, accountId, state, extra = {}) => {
    const fields = ['state = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [state];
    const allowed = [
      'joined_count', 'max_joins', 'batch_size', 'join_delay_seconds',
      'rest_seconds', 'batch_progress', 'cooldown_until', 'ban_reason', 'last_joined_at',
    ];
    for (const key of allowed) {
      if (extra[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(extra[key]);
      }
    }
    values.push(userId, accountId);
    return getDb()
      .prepare(
        `UPDATE join_accounts SET ${fields.join(', ')} WHERE user_id = ? AND account_id = ?`
      )
      .run(...values);
  },

  incrementJoined: (userId, accountId) => {
    return getDb()
      .prepare(
        `UPDATE join_accounts
         SET joined_count = joined_count + 1,
             batch_progress = batch_progress + 1,
             last_joined_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND account_id = ?`
      )
      .run(userId, accountId);
  },

  resetBatchProgress: (userId, accountId) => {
    return getDb()
      .prepare(
        `UPDATE join_accounts SET batch_progress = 0, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND account_id = ?`
      )
      .run(userId, accountId);
  },
};

// ─── Settings ─────────────────────────────────────────────────────────────────

const joinSettingsQueries = {
  get: (userId) => {
    let row = getDb()
      .prepare('SELECT * FROM join_settings WHERE user_id = ?')
      .get(userId);
    if (!row) {
      getDb()
        .prepare('INSERT INTO join_settings (user_id) VALUES (?)')
        .run(userId);
      row = getDb()
        .prepare('SELECT * FROM join_settings WHERE user_id = ?')
        .get(userId);
    }
    return row;
  },

  update: (userId, patch) => {
    joinSettingsQueries.get(userId); // ensure row exists
    const allowed = [
      'batch_size', 'join_delay_seconds', 'rest_seconds',
      'max_joins_per_account', 'auto_distribute',
    ];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(patch[key]);
      }
    }
    if (!fields.length) return;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);
    getDb()
      .prepare(`UPDATE join_settings SET ${fields.join(', ')} WHERE user_id = ?`)
      .run(...values);
  },
};

// ─── Logs ─────────────────────────────────────────────────────────────────────

const joinLogQueries = {
  add: (userId, accountId, link, groupTitle, result, detail) => {
    return getDb()
      .prepare(
        `INSERT INTO join_logs (user_id, account_id, link, group_title, result, detail)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(userId, accountId || null, link || null, groupTitle || null, result, detail || null);
  },

  getRecentByUserId: (userId, limit = 30) => {
    return getDb()
      .prepare(
        `SELECT jl.*, a.phone FROM join_logs jl
         LEFT JOIN accounts a ON a.id = jl.account_id
         WHERE jl.user_id = ? ORDER BY jl.id DESC LIMIT ?`
      )
      .all(userId, limit);
  },

  clearByUserId: (userId) => {
    return getDb().prepare('DELETE FROM join_logs WHERE user_id = ?').run(userId);
  },
};

module.exports = {
  initJoinSchema,
  joinGroupQueries,
  joinLinkQueries,
  joinAccountQueries,
  joinSettingsQueries,
  joinLogQueries,
};
