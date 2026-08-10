/**
 * deduplicateDb.js — قاعدة بيانات نظام إزالة المكرر
 *
 * الجداول:
 *  - dedup_tasks        : مهام إزالة المكرر (task_id, accounts, status…)
 *  - dedup_task_accounts: الحسابات المحددة في كل مهمة + أولويتها
 *  - dedup_entities     : كل عنصر (مجموعة/قناة) مكتشف مع بيانات التكرار
 *  - dedup_operations   : سجل كل عملية خروج (نجاح/فشل)
 *  - dedup_settings     : إعدادات النظام لكل مستخدم
 */

const { getDb } = require('./db');
const logger = require('../utils/logger');

// ─── Migration helper ─────────────────────────────────────────────────────────

const columnExists = (database, table, column) => {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
};

// ─── Schema Initialization ────────────────────────────────────────────────────

const initDeduplicateSchema = () => {
  const db = getDb();

  db.exec(`
    -- مهام إزالة المكرر الرئيسية
    CREATE TABLE IF NOT EXISTS dedup_tasks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             TEXT    NOT NULL,
      status              TEXT    NOT NULL DEFAULT 'pending',
      -- pending | scanning | deduplicating | paused | completed | stopped | failed
      total_accounts      INTEGER DEFAULT 0,
      scanned_accounts    INTEGER DEFAULT 0,
      total_entities      INTEGER DEFAULT 0,
      scanned_entities    INTEGER DEFAULT 0,
      duplicate_count     INTEGER DEFAULT 0,
      leave_success       INTEGER DEFAULT 0,
      leave_failed        INTEGER DEFAULT 0,
      remaining_dupes     INTEGER DEFAULT 0,
      error_count         INTEGER DEFAULT 0,
      started_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at        DATETIME,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      final_report        TEXT,    -- JSON للتقرير النهائي
      current_account_id  INTEGER, -- الحساب الذي يجري فحصه الآن
      current_entity_name TEXT     -- آخر عنصر جرى معالجته
    );

    -- الحسابات المحددة في كل مهمة
    CREATE TABLE IF NOT EXISTS dedup_task_accounts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL REFERENCES dedup_tasks(id),
      account_id  INTEGER NOT NULL,
      priority    INTEGER NOT NULL DEFAULT 1,
      status      TEXT    NOT NULL DEFAULT 'pending',
      -- pending | scanning | done | error
      entity_count INTEGER DEFAULT 0,
      scanned_at  DATETIME,
      UNIQUE(task_id, account_id)
    );

    -- كل عنصر (مجموعة/قناة) مكتشف في المهمة
    CREATE TABLE IF NOT EXISTS dedup_entities (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id         INTEGER NOT NULL REFERENCES dedup_tasks(id),
      entity_id       TEXT    NOT NULL,     -- Telegram peer/entity ID (السالب)
      entity_name     TEXT,
      entity_type     TEXT,                  -- group | supergroup | channel
      duplicate_count INTEGER NOT NULL DEFAULT 1,
      keep_account_id INTEGER,               -- الحساب الذي سيُحتفظ فيه
      keep_priority   INTEGER,
      accounts_json   TEXT,                  -- JSON: [{account_id, priority, status}]
      status          TEXT    NOT NULL DEFAULT 'pending',
      -- pending | processing | done | partial | skipped
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(task_id, entity_id)
    );

    -- سجل كل عملية خروج فردية
    CREATE TABLE IF NOT EXISTS dedup_operations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id         INTEGER NOT NULL REFERENCES dedup_tasks(id),
      entity_id       TEXT    NOT NULL,
      entity_name     TEXT,
      entity_type     TEXT,
      account_id      INTEGER NOT NULL,
      keep_account_id INTEGER,
      duplicate_count INTEGER,
      status          TEXT    NOT NULL DEFAULT 'pending',
      -- pending | success | failed | skipped
      error_message   TEXT,
      error_type      TEXT,
      flood_wait_sec  INTEGER,
      retries         INTEGER DEFAULT 0,
      executed_at     DATETIME,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- إعدادات نظام إزالة المكرر لكل مستخدم
    CREATE TABLE IF NOT EXISTS dedup_settings (
      user_id                   TEXT PRIMARY KEY,
      concurrent_ops            INTEGER DEFAULT 1,   -- عمليات متزامنة
      auto_reverify             INTEGER DEFAULT 1,   -- فحص نهائي تلقائي
      notifications_enabled     INTEGER DEFAULT 1,   -- إشعارات
      keep_logs_days            INTEGER DEFAULT 30,  -- مدة حفظ السجل
      confirm_before_leave      INTEGER DEFAULT 1,   -- تأكيد قبل الخروج
      max_retries               INTEGER DEFAULT 2,   -- أقصى محاولات إعادة
      delay_between_ops_ms      INTEGER DEFAULT 2000, -- تأخير بين العمليات
      priority_order            TEXT,                -- JSON: [account_id, ...]
      updated_at                DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes للبحث السريع
    CREATE INDEX IF NOT EXISTS idx_dedup_tasks_user_id     ON dedup_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_dedup_tasks_status      ON dedup_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_dedup_task_accs_task    ON dedup_task_accounts(task_id);
    CREATE INDEX IF NOT EXISTS idx_dedup_entities_task     ON dedup_entities(task_id);
    CREATE INDEX IF NOT EXISTS idx_dedup_entities_id       ON dedup_entities(entity_id);
    CREATE INDEX IF NOT EXISTS idx_dedup_ops_task          ON dedup_operations(task_id);
    CREATE INDEX IF NOT EXISTS idx_dedup_ops_account       ON dedup_operations(account_id);
    CREATE INDEX IF NOT EXISTS idx_dedup_ops_entity        ON dedup_operations(entity_id);
    CREATE INDEX IF NOT EXISTS idx_dedup_ops_status        ON dedup_operations(status);
  `);

  logger.info('deduplicateDb: schema initialized ✓');
};

// ─── Task Queries ─────────────────────────────────────────────────────────────

const taskQueries = {
  create: (userId, accountCount) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO dedup_tasks (user_id, total_accounts, status)
      VALUES (?, ?, 'pending')
    `);
    const result = stmt.run(userId, accountCount);
    return result.lastInsertRowid;
  },

  getById: (taskId) => getDb().prepare('SELECT * FROM dedup_tasks WHERE id = ?').get(taskId),

  getActiveByUserId: (userId) => getDb().prepare(`
    SELECT * FROM dedup_tasks
    WHERE user_id = ? AND status NOT IN ('completed', 'stopped', 'failed')
    ORDER BY id DESC LIMIT 1
  `).get(userId),

  getLastByUserId: (userId) => getDb().prepare(`
    SELECT * FROM dedup_tasks WHERE user_id = ? ORDER BY id DESC LIMIT 1
  `).get(userId),

  updateStatus: (taskId, status, extra = {}) => {
    const db = getDb();
    const allowed = [
      'scanned_accounts', 'total_entities', 'scanned_entities',
      'duplicate_count', 'leave_success', 'leave_failed',
      'remaining_dupes', 'error_count', 'completed_at',
      'final_report', 'current_account_id', 'current_entity_name',
      'total_accounts',
    ];
    const fields = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [status];
    for (const key of allowed) {
      if (extra[key] !== undefined) { fields.push(`${key} = ?`); values.push(extra[key]); }
    }
    values.push(taskId);
    db.prepare(`UPDATE dedup_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  incrementField: (taskId, field) => {
    const allowed = ['leave_success', 'leave_failed', 'error_count', 'scanned_entities'];
    if (!allowed.includes(field)) return;
    getDb().prepare(`UPDATE dedup_tasks SET ${field} = ${field} + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(taskId);
  },

  setCurrentOperation: (taskId, accountId, entityName) => {
    getDb().prepare(`
      UPDATE dedup_tasks SET current_account_id = ?, current_entity_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(accountId, entityName, taskId);
  },

  hasConflict: (userId, accountIds) => {
    const active = taskQueries.getActiveByUserId(userId);
    if (!active) return false;
    const taskAccounts = taskAccountQueries.getByTaskId(active.id);
    const activeAccountIds = new Set(taskAccounts.map((a) => a.account_id));
    return accountIds.some((id) => activeAccountIds.has(id));
  },
};

// ─── Task Accounts Queries ────────────────────────────────────────────────────

const taskAccountQueries = {
  addAccounts: (taskId, accountsWithPriority) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO dedup_task_accounts (task_id, account_id, priority) VALUES (?, ?, ?)
    `);
    db.transaction(() => {
      for (const { accountId, priority } of accountsWithPriority) {
        stmt.run(taskId, accountId, priority);
      }
    })();
  },

  getByTaskId: (taskId) => getDb().prepare(
    'SELECT * FROM dedup_task_accounts WHERE task_id = ? ORDER BY priority ASC'
  ).all(taskId),

  updateStatus: (taskId, accountId, status, entityCount) => {
    const db = getDb();
    if (entityCount !== undefined) {
      db.prepare(`
        UPDATE dedup_task_accounts SET status = ?, entity_count = ?, scanned_at = CURRENT_TIMESTAMP
        WHERE task_id = ? AND account_id = ?
      `).run(status, entityCount, taskId, accountId);
    } else {
      db.prepare(`
        UPDATE dedup_task_accounts SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE task_id = ? AND account_id = ?
      `).run(status, taskId, accountId);
    }
  },
};

// ─── Entity Queries ───────────────────────────────────────────────────────────

const entityQueries = {
  upsert: (taskId, entityId, entityName, entityType, accountId, priority) => {
    const db = getDb();
    const existing = db.prepare(
      'SELECT * FROM dedup_entities WHERE task_id = ? AND entity_id = ?'
    ).get(taskId, entityId);

    if (!existing) {
      const accounts = [{ account_id: accountId, priority, status: 'pending' }];
      db.prepare(`
        INSERT INTO dedup_entities (task_id, entity_id, entity_name, entity_type, duplicate_count, accounts_json)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(taskId, String(entityId), entityName, entityType, JSON.stringify(accounts));
    } else {
      let accounts = [];
      try { accounts = JSON.parse(existing.accounts_json || '[]'); } catch (_) {}
      if (!accounts.find((a) => a.account_id === accountId)) {
        accounts.push({ account_id: accountId, priority, status: 'pending' });
        accounts.sort((a, b) => a.priority - b.priority);
        db.prepare(`
          UPDATE dedup_entities SET
            duplicate_count = duplicate_count + 1,
            entity_name = COALESCE(?, entity_name),
            accounts_json = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE task_id = ? AND entity_id = ?
        `).run(entityName, JSON.stringify(accounts), taskId, String(entityId));
      }
    }
  },

  finalizeKeepAccounts: (taskId) => {
    const db = getDb();
    const entities = db.prepare(
      'SELECT * FROM dedup_entities WHERE task_id = ? AND duplicate_count > 1'
    ).all(taskId);

    db.transaction(() => {
      for (const entity of entities) {
        let accounts = [];
        try { accounts = JSON.parse(entity.accounts_json || '[]'); } catch (_) {}
        if (accounts.length === 0) continue;
        accounts.sort((a, b) => a.priority - b.priority);
        const keeper = accounts[0];
        db.prepare(`
          UPDATE dedup_entities SET keep_account_id = ?, keep_priority = ? WHERE id = ?
        `).run(keeper.account_id, keeper.priority, entity.id);
      }
    })();
  },

  getDuplicates: (taskId) => getDb().prepare(`
    SELECT * FROM dedup_entities WHERE task_id = ? AND duplicate_count > 1 ORDER BY duplicate_count DESC
  `).all(taskId),

  getAll: (taskId) => getDb().prepare(
    'SELECT * FROM dedup_entities WHERE task_id = ? ORDER BY id'
  ).all(taskId),

  getById: (taskId, entityId) => getDb().prepare(
    'SELECT * FROM dedup_entities WHERE task_id = ? AND entity_id = ?'
  ).get(taskId, String(entityId)),

  updateStatus: (id, status) => getDb().prepare(
    'UPDATE dedup_entities SET status = ? WHERE id = ?'
  ).run(status, id),

  countDuplicates: (taskId) => (getDb().prepare(
    'SELECT COUNT(*) as cnt FROM dedup_entities WHERE task_id = ? AND duplicate_count > 1'
  ).get(taskId) || {}).cnt || 0,
};

// ─── Operations Queries ───────────────────────────────────────────────────────

const operationQueries = {
  create: (taskId, entityId, entityName, entityType, accountId, keepAccountId, duplicateCount) => {
    const db = getDb();
    // منع تكرار نفس العملية إذا نجحت مسبقاً
    const existing = db.prepare(`
      SELECT * FROM dedup_operations WHERE task_id = ? AND entity_id = ? AND account_id = ? AND status = 'success'
    `).get(taskId, String(entityId), accountId);
    if (existing) return null; // عملية مكتملة مسبقاً

    const result = db.prepare(`
      INSERT INTO dedup_operations (task_id, entity_id, entity_name, entity_type, account_id, keep_account_id, duplicate_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(taskId, String(entityId), entityName, entityType, accountId, keepAccountId, duplicateCount);
    return result.lastInsertRowid;
  },

  updateStatus: (id, status, extra = {}) => {
    const db = getDb();
    const allowed = ['error_message', 'error_type', 'flood_wait_sec', 'retries'];
    const fields = ['status = ?', 'executed_at = CURRENT_TIMESTAMP'];
    const values = [status];
    for (const key of allowed) {
      if (extra[key] !== undefined) { fields.push(`${key} = ?`); values.push(extra[key]); }
    }
    values.push(id);
    db.prepare(`UPDATE dedup_operations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  getByTaskId: (taskId, limit = 50, offset = 0) => getDb().prepare(`
    SELECT * FROM dedup_operations WHERE task_id = ? ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(taskId, limit, offset),

  getFailedByTaskId: (taskId) => getDb().prepare(
    "SELECT * FROM dedup_operations WHERE task_id = ? AND status = 'failed' ORDER BY id DESC"
  ).all(taskId),

  countByStatus: (taskId) => {
    const db = getDb();
    const rows = db.prepare(
      'SELECT status, COUNT(*) as cnt FROM dedup_operations WHERE task_id = ? GROUP BY status'
    ).all(taskId);
    const result = {};
    for (const r of rows) result[r.status] = r.cnt;
    return result;
  },

  isDuplicate: (taskId, entityId, accountId) => !!getDb().prepare(`
    SELECT 1 FROM dedup_operations WHERE task_id = ? AND entity_id = ? AND account_id = ? AND status = 'success'
  `).get(taskId, String(entityId), accountId),
};

// ─── Settings Queries ─────────────────────────────────────────────────────────

const settingsQueries = {
  get: (userId) => {
    const db = getDb();
    let s = db.prepare('SELECT * FROM dedup_settings WHERE user_id = ?').get(userId);
    if (!s) {
      db.prepare(`INSERT OR IGNORE INTO dedup_settings (user_id) VALUES (?)`).run(userId);
      s = db.prepare('SELECT * FROM dedup_settings WHERE user_id = ?').get(userId);
    }
    return s;
  },

  update: (userId, fields) => {
    const allowed = [
      'concurrent_ops', 'auto_reverify', 'notifications_enabled',
      'keep_logs_days', 'confirm_before_leave', 'max_retries',
      'delay_between_ops_ms', 'priority_order',
    ];
    const db = getDb();
    const setClauses = [];
    const values = [];
    for (const key of allowed) {
      if (fields[key] !== undefined) { setClauses.push(`${key} = ?`); values.push(fields[key]); }
    }
    if (setClauses.length === 0) return;
    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);
    db.prepare(`UPDATE dedup_settings SET ${setClauses.join(', ')} WHERE user_id = ?`).run(...values);
  },
};

module.exports = {
  initDeduplicateSchema,
  taskQueries,
  taskAccountQueries,
  entityQueries,
  operationQueries,
  settingsQueries,
};
