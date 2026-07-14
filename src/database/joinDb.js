/**
 * Join-to-Links Database Module
 *
 * Provides the schema and all queries for the "الانضمام للروابط" feature,
 * AND now doubles as the project's CENTRAL DATABASE for all Telegram
 * links/groups/folders (نظام إدارة قاعدة البيانات المركزية):
 *
 *   - join_groups    : CENTRAL registry of every Telegram group ever seen,
 *                      from ANY source (search / join / folders / manual add).
 *                      Dedup key = (user_id, telegram_id) — NEVER the raw link,
 *                      since one group can have many links.
 *   - join_links     : queued/processed links submitted by the user (join queue)
 *   - join_accounts  : per-account join settings/state (enabled, limits, ban info)
 *   - join_settings  : per-user speed / interval / batch settings
 *   - join_logs      : full operations log for the Logs page
 *   - tg_folders       : Telegram folders created to organize central groups
 *   - tg_folder_groups : which central group belongs to which folder (1:1 — a
 *                        group can only ever live in ONE folder, enforced by
 *                        UNIQUE(user_id, group_id))
 *   - tg_folder_settings : per-user folder configuration (group_per_folder, etc.)
 *
 * Shares the SQLite file that db.js owns; imported lazily from db.js
 * during initializeSchema() to avoid a circular-require issue — same
 * pattern as linksDb.js / subscriptionsDb.js.
 */

const { getDb } = require('./db');
const logger = require('../utils/logger');

// ─── Safe migration helper (additive-only, same pattern as db.js) ────────────

const columnExists = (database, table, column) => {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
};

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

  // ── Central-DB additive migrations on join_groups ──────────────────────────
  // All ADDITIVE ONLY (no data loss). Mirrors the safe-migration pattern in db.js.
  if (!columnExists(db, 'join_groups', 'link')) {
    db.exec(`ALTER TABLE join_groups ADD COLUMN link TEXT`);
  }
  if (!columnExists(db, 'join_groups', 'link_type')) {
    db.exec(`ALTER TABLE join_groups ADD COLUMN link_type TEXT`);
  }
  if (!columnExists(db, 'join_groups', 'source')) {
    db.exec(`ALTER TABLE join_groups ADD COLUMN source TEXT DEFAULT 'join'`);
  }
  if (!columnExists(db, 'join_groups', 'folder_id')) {
    db.exec(`ALTER TABLE join_groups ADD COLUMN folder_id INTEGER`);
  }
  if (!columnExists(db, 'join_groups', 'updated_at')) {
    db.exec(`ALTER TABLE join_groups ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
  }

  // ── Telegram Folders feature (قسم إنشاء مجلدات تيليجرام) ───────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS tg_folders (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           TEXT    NOT NULL,
      folder_number     INTEGER NOT NULL,
      name              TEXT    NOT NULL,
      tg_filter_id      INTEGER,
      capacity          INTEGER NOT NULL DEFAULT 100,
      groups_count      INTEGER NOT NULL DEFAULT 0,
      status            TEXT    NOT NULL DEFAULT 'building',
      invite_link       TEXT,
      account_id        INTEGER,
      error_message     TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, folder_number)
    );

    CREATE TABLE IF NOT EXISTS tg_folder_groups (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT    NOT NULL,
      folder_id    INTEGER NOT NULL,
      group_id     INTEGER NOT NULL,
      added_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES tg_folders(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id)  REFERENCES join_groups(id) ON DELETE CASCADE,
      UNIQUE(user_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS tg_folder_settings (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            TEXT    NOT NULL UNIQUE,
      groups_per_folder  INTEGER NOT NULL DEFAULT 100,
      default_account_id INTEGER,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tg_folders_user_id        ON tg_folders(user_id);
    CREATE INDEX IF NOT EXISTS idx_tg_folders_status         ON tg_folders(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_tg_folder_groups_folder   ON tg_folder_groups(folder_id);
    CREATE INDEX IF NOT EXISTS idx_tg_folder_groups_user     ON tg_folder_groups(user_id);
    CREATE INDEX IF NOT EXISTS idx_join_groups_folder_id     ON join_groups(folder_id);
  `);

  logger.info('Join-to-links + central groups/folders schema initialised.');
};

// ─── Groups (CENTRAL dedup registry, keyed by Telegram ID) ────────────────────
//
// This is the project's single source of truth for every Telegram group,
// regardless of which section discovered it (search / join / folders /
// manual add). All sections MUST check/register through these queries —
// never maintain a parallel groups table elsewhere.

const joinGroupQueries = {
  exists: (userId, telegramId) => {
    return !!getDb()
      .prepare('SELECT 1 FROM join_groups WHERE user_id = ? AND telegram_id = ?')
      .get(userId, String(telegramId));
  },

  /**
   * Fetch the full central row for a group, or null.
   */
  getByTelegramId: (userId, telegramId) => {
    return getDb()
      .prepare('SELECT * FROM join_groups WHERE user_id = ? AND telegram_id = ?')
      .get(userId, String(telegramId)) ?? null;
  },

  getById: (id) => {
    return getDb().prepare('SELECT * FROM join_groups WHERE id = ?').get(id) ?? null;
  },

  /**
   * Register a group in the central DB (idempotent — first writer wins).
   * Any section (search, join, folders, manual) can call this the same way.
   *
   * @param {string} userId
   * @param {string|number} telegramId
   * @param {string} title
   * @param {number} accountId
   * @param {string} link
   * @param {object} extra  { linkType, source }
   */
  register: (userId, telegramId, title, accountId, link, extra = {}) => {
    const stmt = getDb().prepare(`
      INSERT INTO join_groups
        (user_id, telegram_id, title, joined_by_account_id, first_link, status,
         link, link_type, source, updated_at)
      VALUES (?, ?, ?, ?, ?, 'joined', ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, telegram_id) DO NOTHING
    `);
    return stmt.run(
      userId,
      String(telegramId),
      title || null,
      accountId,
      link || null,
      link || null,
      extra.linkType || null,
      extra.source || 'join',
    );
  },

  /**
   * Groups not yet placed in any folder — candidates for folder building.
   * @param {string} userId
   * @param {number} limit
   */
  getUnfoldered: (userId, limit = 100) => {
    return getDb()
      .prepare(
        `SELECT * FROM join_groups
         WHERE user_id = ? AND folder_id IS NULL AND status != 'مكررة'
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(userId, limit);
  },

  /**
   * Mark a batch of groups as belonging to a folder.
   * @param {number[]} groupIds
   * @param {number} folderId
   */
  assignFolder: (groupIds, folderId) => {
    if (!groupIds.length) return;
    const stmt = getDb().prepare(
      `UPDATE join_groups SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    );
    const tx = getDb().transaction((ids) => {
      for (const id of ids) stmt.run(folderId, id);
    });
    tx(groupIds);
  },

  countUnfolderedByUserId: (userId) => {
    return getDb()
      .prepare(
        `SELECT COUNT(*) as count FROM join_groups WHERE user_id = ? AND folder_id IS NULL`
      )
      .get(userId)?.count || 0;
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

  /**
   * Full central-DB statistics block (used by the central stats screen).
   * @param {string} userId
   */
  getCentralStats: (userId) => {
    const db = getDb();
    const uid = String(userId);

    const totalGroups = db
      .prepare(`SELECT COUNT(*) c FROM join_groups WHERE user_id = ?`)
      .get(uid)?.c || 0;

    const inFolders = db
      .prepare(`SELECT COUNT(*) c FROM join_groups WHERE user_id = ? AND folder_id IS NOT NULL`)
      .get(uid)?.c || 0;

    const totalFolders = db
      .prepare(`SELECT COUNT(*) c FROM tg_folders WHERE user_id = ?`)
      .get(uid)?.c || 0;

    const completedFolders = db
      .prepare(`SELECT COUNT(*) c FROM tg_folders WHERE user_id = ? AND status IN ('مكتمل', 'جاهز للمشاركة')`)
      .get(uid)?.c || 0;

    const readyFolders = db
      .prepare(`SELECT COUNT(*) c FROM tg_folders WHERE user_id = ? AND status = 'جاهز للمشاركة'`)
      .get(uid)?.c || 0;

    const totalLinks = db
      .prepare(`SELECT COUNT(*) c FROM join_links WHERE user_id = ?`)
      .get(uid)?.c || 0;

    const duplicatesBlocked = db
      .prepare(`SELECT COUNT(*) c FROM join_links WHERE user_id = ? AND status = 'skipped'`)
      .get(uid)?.c || 0;

    const invalidLinks = db
      .prepare(`SELECT COUNT(*) c FROM join_links WHERE user_id = ? AND status = 'invalid'`)
      .get(uid)?.c || 0;

    return {
      totalLinks,
      totalGroups,
      groupsInFolders: inFolders,
      groupsUnfoldered: totalGroups - inFolders,
      duplicatesBlocked,
      invalidLinks,
      totalFolders,
      completedFolders,
      readyFolders,
    };
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

// ─── Folders (تنظيم المجموعات داخل مجلدات تيليجرام) ──────────────────────────

const DEFAULT_FOLDER_SETTINGS = {
  groups_per_folder: 100,
};

const folderSettingsQueries = {
  get: (userId) => {
    const db = getDb();
    const uid = String(userId);
    let row = db.prepare('SELECT * FROM tg_folder_settings WHERE user_id = ?').get(uid);
    if (!row) {
      db.prepare(
        `INSERT INTO tg_folder_settings (user_id, groups_per_folder) VALUES (?, ?)`
      ).run(uid, DEFAULT_FOLDER_SETTINGS.groups_per_folder);
      row = db.prepare('SELECT * FROM tg_folder_settings WHERE user_id = ?').get(uid);
    }
    return row ?? { ...DEFAULT_FOLDER_SETTINGS, user_id: uid };
  },

  update: (userId, patch) => {
    folderSettingsQueries.get(userId);
    const allowed = ['groups_per_folder', 'default_account_id'];
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
    values.push(String(userId));
    getDb()
      .prepare(`UPDATE tg_folder_settings SET ${fields.join(', ')} WHERE user_id = ?`)
      .run(...values);
  },
};

const folderQueries = {
  /**
   * Create a new folder row (status 'قيد الإنشاء' / building) with the next
   * sequential folder_number for this user.
   * @param {string} userId
   * @param {number} capacity
   */
  create: (userId, capacity = 100) => {
    const db = getDb();
    const uid = String(userId);
    const last = db
      .prepare('SELECT MAX(folder_number) as n FROM tg_folders WHERE user_id = ?')
      .get(uid)?.n || 0;
    const folderNumber = last + 1;
    const name = `مجلد رقم ${folderNumber}`;

    const result = db
      .prepare(
        `INSERT INTO tg_folders (user_id, folder_number, name, capacity, status)
         VALUES (?, ?, ?, ?, 'قيد الإنشاء')`
      )
      .run(uid, folderNumber, name, capacity);

    return folderQueries.getById(result.lastInsertRowid);
  },

  getById: (id) => getDb().prepare('SELECT * FROM tg_folders WHERE id = ?').get(id) ?? null,

  getAllByUserId: (userId) =>
    getDb()
      .prepare('SELECT * FROM tg_folders WHERE user_id = ? ORDER BY folder_number ASC')
      .all(String(userId)),

  /**
   * The current open (not-yet-full) folder for a user, if any.
   * @param {string} userId
   */
  getOpenFolder: (userId) =>
    getDb()
      .prepare(
        `SELECT * FROM tg_folders
         WHERE user_id = ? AND status = 'قيد الإنشاء'
         ORDER BY folder_number DESC LIMIT 1`
      )
      .get(String(userId)) ?? null,

  incrementGroupsCount: (folderId, by = 1) => {
    getDb()
      .prepare(
        `UPDATE tg_folders SET groups_count = groups_count + ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(by, folderId);
  },

  updateStatus: (folderId, status, extra = {}) => {
    const fields = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [status];
    const allowed = ['tg_filter_id', 'invite_link', 'account_id', 'error_message'];
    for (const key of allowed) {
      if (extra[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(extra[key]);
      }
    }
    values.push(folderId);
    getDb()
      .prepare(`UPDATE tg_folders SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  deleteById: (folderId, userId) => {
    const db = getDb();
    // Free up the groups so they can be re-assigned to a future folder.
    db.prepare(`UPDATE join_groups SET folder_id = NULL WHERE folder_id = ?`).run(folderId);
    db.prepare(`DELETE FROM tg_folder_groups WHERE folder_id = ?`).run(folderId);
    db.prepare(`DELETE FROM tg_folders WHERE id = ? AND user_id = ?`).run(folderId, String(userId));
  },
};

const folderGroupQueries = {
  /**
   * Link a central group to a folder. Enforced UNIQUE(user_id, group_id) at
   * the schema level guarantees a group can never live in more than one folder.
   */
  add: (userId, folderId, groupId) => {
    getDb()
      .prepare(
        `INSERT INTO tg_folder_groups (user_id, folder_id, group_id)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, group_id) DO NOTHING`
      )
      .run(String(userId), folderId, groupId);
  },

  getByFolderId: (folderId) =>
    getDb()
      .prepare(
        `SELECT fg.*, jg.title, jg.telegram_id, jg.link
         FROM tg_folder_groups fg
         JOIN join_groups jg ON jg.id = fg.group_id
         WHERE fg.folder_id = ?
         ORDER BY fg.added_at ASC`
      )
      .all(folderId),

  isGroupInAnyFolder: (userId, groupId) =>
    !!getDb()
      .prepare(`SELECT 1 FROM tg_folder_groups WHERE user_id = ? AND group_id = ?`)
      .get(String(userId), groupId),
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  initJoinSchema,
  joinGroupQueries,
  joinLinkQueries,
  joinAccountQueries,
  joinSettingsQueries,
  joinLogQueries,
  folderQueries,
  folderGroupQueries,
  folderSettingsQueries,
};
