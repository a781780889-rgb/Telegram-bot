/**
 * Subscriptions Database Module
 *
 * Provides the schema and all queries for the 💎 نظام الاشتراكات feature:
 *   - sub_packages           : subscription packages (باقات)
 *   - sub_subscribers        : current subscription state per bot user
 *   - sub_subscriber_history : full audit trail per subscriber
 *   - sub_payments           : every payment attempt (pending/accepted/rejected/refunded)
 *   - sub_coupons            : discount coupons
 *   - sub_coupon_uses        : one row per successful coupon redemption
 *   - sub_offers             : seasonal/limited offers
 *   - sub_activation_codes   : self-service activation/redemption codes (أكواد التفعيل)
 *   - sub_activation_code_uses : one row per successful code redemption
 *   - sub_operations_log     : full admin/system operations audit log
 *   - sub_settings           : key/value store for module-wide settings
 *
 * Shares the SQLite file that db.js owns; imported lazily from db.js
 * during initializeSchema() to avoid a circular-require issue (exact same
 * pattern already used by linksDb.js).
 *
 * DATA-SAFETY GUARANTEE: every statement below is CREATE TABLE IF NOT EXISTS /
 * additive ALTER TABLE guarded by columnExists(). Nothing here ever DROPs or
 * DELETEs existing data on startup. "Delete" actions exposed to the admin are
 * implemented as soft-deletes (is_deleted flag) so historical payments,
 * subscriber history and coupon redemptions always stay intact and consistent.
 */

const crypto = require('crypto');
const { getDb } = require('./db');
const logger = require('../utils/logger');

// ─── Schema ───────────────────────────────────────────────────────────────────

const columnExists = (database, table, column) => {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
};

const initSubscriptionsSchema = () => {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS sub_packages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      description     TEXT,
      price           REAL    NOT NULL DEFAULT 0,
      currency        TEXT    NOT NULL DEFAULT 'SAR',
      duration_days   INTEGER NOT NULL DEFAULT 30,
      features        TEXT    NOT NULL DEFAULT '[]',
      max_accounts    INTEGER NOT NULL DEFAULT 0,
      max_operations  INTEGER NOT NULL DEFAULT 0,
      max_users       INTEGER NOT NULL DEFAULT 1,
      is_active       INTEGER NOT NULL DEFAULT 1,
      is_deleted      INTEGER NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      badge_label     TEXT,
      badge_color     TEXT,
      is_special      INTEGER NOT NULL DEFAULT 0,
      created_by      TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sub_subscribers (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id        TEXT    NOT NULL UNIQUE,
      username                TEXT,
      first_name              TEXT,
      package_id              INTEGER,
      status                  TEXT    NOT NULL DEFAULT 'none',
      subscribed_at           DATETIME,
      expires_at              DATETIME,
      last_activity           DATETIME DEFAULT CURRENT_TIMESTAMP,
      auto_renew              INTEGER NOT NULL DEFAULT 0,
      pre_expiry_alert_sent   INTEGER NOT NULL DEFAULT 0,
      notes                   TEXT,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (package_id) REFERENCES sub_packages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sub_subscriber_history (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id  TEXT    NOT NULL,
      event_type        TEXT    NOT NULL,
      package_id        INTEGER,
      actor_id          TEXT,
      details           TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sub_payments (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_code    TEXT    NOT NULL UNIQUE,
      telegram_user_id  TEXT    NOT NULL,
      username          TEXT,
      package_id        INTEGER,
      package_name      TEXT,
      amount            REAL    NOT NULL DEFAULT 0,
      original_amount   REAL    NOT NULL DEFAULT 0,
      currency          TEXT    NOT NULL DEFAULT 'SAR',
      payment_method    TEXT    NOT NULL DEFAULT 'manual',
      status            TEXT    NOT NULL DEFAULT 'pending',
      coupon_code       TEXT,
      coupon_id         INTEGER,
      discount_amount   REAL    NOT NULL DEFAULT 0,
      admin_id          TEXT,
      admin_note        TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at      DATETIME,
      FOREIGN KEY (package_id) REFERENCES sub_packages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sub_coupons (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      code                  TEXT    NOT NULL UNIQUE,
      name                  TEXT,
      discount_type         TEXT    NOT NULL DEFAULT 'percent',
      discount_value        REAL    NOT NULL DEFAULT 0,
      max_uses              INTEGER NOT NULL DEFAULT 0,
      used_count            INTEGER NOT NULL DEFAULT 0,
      valid_from            DATETIME,
      valid_until           DATETIME,
      allowed_package_ids   TEXT    NOT NULL DEFAULT '[]',
      allowed_user_ids      TEXT    NOT NULL DEFAULT '[]',
      is_active             INTEGER NOT NULL DEFAULT 1,
      is_deleted            INTEGER NOT NULL DEFAULT 0,
      created_by            TEXT,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sub_coupon_uses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      coupon_id         INTEGER NOT NULL,
      telegram_user_id  TEXT    NOT NULL,
      payment_id        INTEGER,
      used_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (coupon_id) REFERENCES sub_coupons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sub_offers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT    NOT NULL,
      description   TEXT,
      offer_type    TEXT    NOT NULL DEFAULT 'discount',
      value         TEXT    NOT NULL DEFAULT '{}',
      package_id    INTEGER,
      starts_at     DATETIME,
      ends_at       DATETIME,
      is_active     INTEGER NOT NULL DEFAULT 1,
      is_deleted    INTEGER NOT NULL DEFAULT 0,
      created_by    TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (package_id) REFERENCES sub_packages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sub_activation_codes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      code          TEXT    NOT NULL UNIQUE,
      package_id    INTEGER NOT NULL,
      batch_label   TEXT,
      max_uses      INTEGER NOT NULL DEFAULT 1,
      used_count    INTEGER NOT NULL DEFAULT 0,
      expires_at    DATETIME,
      is_active     INTEGER NOT NULL DEFAULT 1,
      is_deleted    INTEGER NOT NULL DEFAULT 0,
      created_by    TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (package_id) REFERENCES sub_packages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sub_activation_code_uses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      code_id           INTEGER NOT NULL,
      telegram_user_id  TEXT    NOT NULL,
      payment_id        INTEGER,
      used_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (code_id) REFERENCES sub_activation_codes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sub_operations_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type   TEXT    NOT NULL,
      actor_id      TEXT,
      actor_name    TEXT,
      actor_role    TEXT    NOT NULL DEFAULT 'admin',
      target_type   TEXT,
      target_id     TEXT,
      status        TEXT    NOT NULL DEFAULT 'success',
      reason        TEXT,
      details       TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sub_settings (
      key           TEXT PRIMARY KEY,
      value         TEXT,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sub_packages_active      ON sub_packages(is_deleted, is_active, sort_order);
    CREATE INDEX IF NOT EXISTS idx_sub_subscribers_status    ON sub_subscribers(status);
    CREATE INDEX IF NOT EXISTS idx_sub_subscribers_expires   ON sub_subscribers(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sub_subscriber_hist_user  ON sub_subscriber_history(telegram_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub_payments_status       ON sub_payments(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sub_payments_user         ON sub_payments(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_sub_coupons_code          ON sub_coupons(code);
    CREATE INDEX IF NOT EXISTS idx_sub_coupon_uses_coupon    ON sub_coupon_uses(coupon_id);
    CREATE INDEX IF NOT EXISTS idx_sub_offers_active         ON sub_offers(is_deleted, is_active);
    CREATE INDEX IF NOT EXISTS idx_sub_act_codes_code         ON sub_activation_codes(code);
    CREATE INDEX IF NOT EXISTS idx_sub_act_codes_pkg          ON sub_activation_codes(package_id, is_deleted);
    CREATE INDEX IF NOT EXISTS idx_sub_act_code_uses_code     ON sub_activation_code_uses(code_id);
    CREATE INDEX IF NOT EXISTS idx_sub_ops_log_created        ON sub_operations_log(created_at);
  `);

  // Additive column guards (safe to re-run; mirrors db.js's columnExists pattern)
  if (!columnExists(db, 'sub_subscribers', 'pre_expiry_alert_sent')) {
    db.exec('ALTER TABLE sub_subscribers ADD COLUMN pre_expiry_alert_sent INTEGER NOT NULL DEFAULT 0');
  }

  logger.info('Subscriptions database schema initialized');
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

const safeJsonParse = (str, fallback) => {
  if (str === null || str === undefined || str === '') return fallback;
  try {
    return JSON.parse(str);
  } catch (_) {
    return fallback;
  }
};

/**
 * Generate a short, human-friendly unique code (coupon codes / reference codes).
 * @param {number} length
 * @returns {string}
 */
const generateCode = (length = 8) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
};

const generatePaymentReference = () => `PAY-${generateCode(6)}`;

/** Distinct "license key" look (e.g. A7K9-XM3P-QR2T) so it reads differently from coupon codes. */
const generateActivationCode = () => `${generateCode(4)}-${generateCode(4)}-${generateCode(4)}`;

const _parsePackageRow = (row) => {
  if (!row) return null;
  return { ...row, features: safeJsonParse(row.features, []) };
};

const _parseCouponRow = (row) => {
  if (!row) return null;
  return {
    ...row,
    allowed_package_ids: safeJsonParse(row.allowed_package_ids, []),
    allowed_user_ids: safeJsonParse(row.allowed_user_ids, []),
  };
};

const _parseOfferRow = (row) => {
  if (!row) return null;
  return { ...row, value: safeJsonParse(row.value, {}) };
};

const _parseLogRow = (row) => {
  if (!row) return null;
  return { ...row, details: safeJsonParse(row.details, null) };
};

// ─── Package Queries ──────────────────────────────────────────────────────────

const packageQueries = {
  /**
   * @param {object} data
   * @returns {number} new package id
   */
  create: (data) => {
    const stmt = getDb().prepare(`
      INSERT INTO sub_packages
        (name, description, price, currency, duration_days, features,
         max_accounts, max_operations, max_users, is_active, sort_order,
         badge_label, badge_color, is_special, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const maxOrderRow = getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM sub_packages')
      .get();
    const result = stmt.run(
      data.name,
      data.description || null,
      data.price || 0,
      data.currency || 'SAR',
      data.duration_days || 30,
      JSON.stringify(data.features || []),
      data.max_accounts || 0,
      data.max_operations || 0,
      data.max_users || 1,
      data.is_active === undefined ? 1 : data.is_active,
      data.sort_order !== undefined ? data.sort_order : (maxOrderRow?.m || 0) + 1,
      data.badge_label || null,
      data.badge_color || null,
      data.is_special ? 1 : 0,
      data.created_by || null
    );
    return result.lastInsertRowid;
  },

  getById: (id) => _parsePackageRow(getDb().prepare('SELECT * FROM sub_packages WHERE id = ?').get(id)),

  /** Non-deleted packages ordered for display, admin view (includes disabled). */
  getAllForAdmin: () =>
    getDb()
      .prepare('SELECT * FROM sub_packages WHERE is_deleted = 0 ORDER BY sort_order ASC, id ASC')
      .all()
      .map(_parsePackageRow),

  /** Only active + non-deleted, for the subscriber-facing storefront. */
  getAllActive: () =>
    getDb()
      .prepare(
        'SELECT * FROM sub_packages WHERE is_deleted = 0 AND is_active = 1 ORDER BY sort_order ASC, id ASC'
      )
      .all()
      .map(_parsePackageRow),

  existsByName: (name, excludeId = null) => {
    const row = excludeId
      ? getDb()
          .prepare(
            'SELECT 1 FROM sub_packages WHERE is_deleted = 0 AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ? LIMIT 1'
          )
          .get(name, excludeId)
      : getDb()
          .prepare('SELECT 1 FROM sub_packages WHERE is_deleted = 0 AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1')
          .get(name);
    return !!row;
  },

  updateField: (id, field, value) => {
    const ALLOWED = [
      'name', 'description', 'price', 'currency', 'duration_days', 'features',
      'max_accounts', 'max_operations', 'max_users', 'badge_label', 'badge_color',
      'sort_order',
    ];
    if (!ALLOWED.includes(field)) {
      logger.warn(`packageQueries.updateField: field "${field}" not allowed`);
      return;
    }
    const val = field === 'features' ? JSON.stringify(value || []) : value;
    getDb()
      .prepare(`UPDATE sub_packages SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(val, id);
  },

  toggleActive: (id) => {
    getDb()
      .prepare(
        'UPDATE sub_packages SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      )
      .run(id);
  },

  toggleSpecial: (id) => {
    getDb()
      .prepare(
        'UPDATE sub_packages SET is_special = CASE WHEN is_special = 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      )
      .run(id);
  },

  softDelete: (id) => {
    getDb()
      .prepare('UPDATE sub_packages SET is_deleted = 1, is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(id);
  },

  duplicate: (id) => {
    const original = packageQueries.getById(id);
    if (!original) return null;
    return packageQueries.create({
      ...original,
      name: `${original.name} (نسخة)`,
      is_active: 0,
    });
  },

  /** Swap sort_order with the neighbouring package (direction: 'up' | 'down'). */
  move: (id, direction) => {
    const db = getDb();
    const all = packageQueries.getAllForAdmin();
    const idx = all.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= all.length) return false;

    const a = all[idx];
    const b = all[swapIdx];
    const txn = db.transaction(() => {
      db.prepare('UPDATE sub_packages SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id);
      db.prepare('UPDATE sub_packages SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id);
    });
    txn();
    return true;
  },

  countActive: () =>
    getDb().prepare('SELECT COUNT(*) c FROM sub_packages WHERE is_deleted = 0 AND is_active = 1').get().c,
};

// ─── Subscriber Queries ───────────────────────────────────────────────────────

const subscriberQueries = {
  /** Ensure a subscriber row exists; refresh username/first_name. */
  ensure: (telegramUserId, username, firstName) => {
    const uid = String(telegramUserId);
    getDb()
      .prepare(`
        INSERT INTO sub_subscribers (telegram_user_id, username, first_name, status)
        VALUES (?, ?, ?, 'none')
        ON CONFLICT(telegram_user_id) DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name,
          last_activity = CURRENT_TIMESTAMP
      `)
      .run(uid, username || null, firstName || null);
    return subscriberQueries.getByTelegramId(uid);
  },

  getByTelegramId: (telegramUserId) =>
    getDb().prepare('SELECT * FROM sub_subscribers WHERE telegram_user_id = ?').get(String(telegramUserId)) ||
    null,

  getById: (id) => getDb().prepare('SELECT * FROM sub_subscribers WHERE id = ?').get(id) || null,

  /**
   * Paginated subscriber list, newest activity first.
   * @param {object} opts { status, page, pageSize, search }
   */
  getPage: (opts = {}) => {
    const { status = null, page = 1, pageSize = 8, search = null } = opts;
    const db = getDb();
    const clauses = [];
    const params = [];

    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (search) {
      clauses.push('(telegram_user_id LIKE ? OR username LIKE ? OR first_name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM sub_subscribers ${where}`).get(...params).c;
    const rows = db
      .prepare(
        `SELECT * FROM sub_subscribers ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize);

    return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  },

  /** Activate/renew a subscription (used after a payment is accepted, or by admin). */
  activate: (telegramUserId, packageId, expiresAt) => {
    getDb()
      .prepare(`
        UPDATE sub_subscribers
        SET package_id = ?, status = 'active', subscribed_at = CURRENT_TIMESTAMP,
            expires_at = ?, pre_expiry_alert_sent = 0, updated_at = CURRENT_TIMESTAMP
        WHERE telegram_user_id = ?
      `)
      .run(packageId, expiresAt, String(telegramUserId));
  },

  extend: (telegramUserId, newExpiresAt) => {
    getDb()
      .prepare(`
        UPDATE sub_subscribers
        SET expires_at = ?, pre_expiry_alert_sent = 0, status = 'active', updated_at = CURRENT_TIMESTAMP
        WHERE telegram_user_id = ?
      `)
      .run(newExpiresAt, String(telegramUserId));
  },

  changePackage: (telegramUserId, packageId, expiresAt) => {
    getDb()
      .prepare(`
        UPDATE sub_subscribers
        SET package_id = ?, expires_at = COALESCE(?, expires_at),
            pre_expiry_alert_sent = 0, updated_at = CURRENT_TIMESTAMP
        WHERE telegram_user_id = ?
      `)
      .run(packageId, expiresAt, String(telegramUserId));
  },

  setStatus: (telegramUserId, status) => {
    getDb()
      .prepare('UPDATE sub_subscribers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_user_id = ?')
      .run(status, String(telegramUserId));
  },

  /** "حذف الاشتراك" — cancels the current subscription; the subscriber row & history stay intact. */
  cancel: (telegramUserId) => {
    getDb()
      .prepare(`
        UPDATE sub_subscribers
        SET status = 'cancelled', package_id = NULL, expires_at = NULL,
            pre_expiry_alert_sent = 0, updated_at = CURRENT_TIMESTAMP
        WHERE telegram_user_id = ?
      `)
      .run(String(telegramUserId));
  },

  setNotes: (telegramUserId, notes) => {
    getDb()
      .prepare('UPDATE sub_subscribers SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_user_id = ?')
      .run(notes, String(telegramUserId));
  },

  toggleAutoRenew: (telegramUserId) => {
    getDb()
      .prepare(
        'UPDATE sub_subscribers SET auto_renew = CASE WHEN auto_renew = 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE telegram_user_id = ?'
      )
      .run(String(telegramUserId));
  },

  touchActivity: (telegramUserId) => {
    getDb()
      .prepare('UPDATE sub_subscribers SET last_activity = CURRENT_TIMESTAMP WHERE telegram_user_id = ?')
      .run(String(telegramUserId));
  },

  /** Active subscriptions whose expiry is within `withinHours` and haven't been alerted yet. */
  getExpiringSoon: (withinHours = 72) =>
    getDb()
      .prepare(`
        SELECT * FROM sub_subscribers
        WHERE status = 'active'
          AND expires_at IS NOT NULL
          AND pre_expiry_alert_sent = 0
          AND datetime(expires_at) <= datetime('now', '+' || ? || ' hours')
          AND datetime(expires_at) > datetime('now')
      `)
      .all(withinHours),

  /** Active subscriptions that already passed their expiry date. */
  getNewlyExpired: () =>
    getDb()
      .prepare(`
        SELECT * FROM sub_subscribers
        WHERE status = 'active' AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')
      `)
      .all(),

  markPreExpiryAlertSent: (telegramUserId) => {
    getDb()
      .prepare('UPDATE sub_subscribers SET pre_expiry_alert_sent = 1 WHERE telegram_user_id = ?')
      .run(String(telegramUserId));
  },

  markExpired: (telegramUserId) => {
    getDb()
      .prepare("UPDATE sub_subscribers SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE telegram_user_id = ?")
      .run(String(telegramUserId));
  },

  countByStatus: () => {
    const rows = getDb()
      .prepare('SELECT status, COUNT(*) c FROM sub_subscribers GROUP BY status')
      .all();
    const out = { none: 0, active: 0, expired: 0, suspended: 0, cancelled: 0 };
    rows.forEach((r) => { out[r.status] = r.c; });
    return out;
  },

  countTotalEverSubscribed: () =>
    getDb().prepare("SELECT COUNT(*) c FROM sub_subscribers WHERE subscribed_at IS NOT NULL").get().c,
};

const subscriberHistoryQueries = {
  add: (telegramUserId, eventType, packageId = null, actorId = null, details = null) => {
    getDb()
      .prepare(`
        INSERT INTO sub_subscriber_history (telegram_user_id, event_type, package_id, actor_id, details)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(String(telegramUserId), eventType, packageId, actorId ? String(actorId) : null, details);
  },

  getByTelegramId: (telegramUserId, limit = 20) =>
    getDb()
      .prepare(
        'SELECT * FROM sub_subscriber_history WHERE telegram_user_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(String(telegramUserId), limit),

  countRenewals: () =>
    getDb().prepare("SELECT COUNT(*) c FROM sub_subscriber_history WHERE event_type = 'renewed'").get().c,
};

// ─── Payment Queries ──────────────────────────────────────────────────────────

const paymentQueries = {
  create: (data) => {
    const reference = generatePaymentReference();
    const stmt = getDb().prepare(`
      INSERT INTO sub_payments
        (reference_code, telegram_user_id, username, package_id, package_name,
         amount, original_amount, currency, payment_method, status,
         coupon_code, coupon_id, discount_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `);
    const result = stmt.run(
      reference,
      String(data.telegram_user_id),
      data.username || null,
      data.package_id,
      data.package_name,
      data.amount,
      data.original_amount,
      data.currency || 'SAR',
      data.payment_method || 'manual',
      data.coupon_code || null,
      data.coupon_id || null,
      data.discount_amount || 0
    );
    return { id: result.lastInsertRowid, reference_code: reference };
  },

  getById: (id) => getDb().prepare('SELECT * FROM sub_payments WHERE id = ?').get(id) || null,

  getByReferenceCode: (code) =>
    getDb().prepare('SELECT * FROM sub_payments WHERE reference_code = ?').get(code) || null,

  /** An already-pending request for the same user+package, to avoid duplicate spam requests. */
  getPendingForUserAndPackage: (telegramUserId, packageId) =>
    getDb()
      .prepare(
        "SELECT * FROM sub_payments WHERE telegram_user_id = ? AND package_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
      )
      .get(String(telegramUserId), packageId) || null,

  getPage: (opts = {}) => {
    const { status = null, page = 1, pageSize = 8, search = null } = opts;
    const db = getDb();
    const clauses = [];
    const params = [];

    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (search) {
      clauses.push('(telegram_user_id LIKE ? OR username LIKE ? OR reference_code LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM sub_payments ${where}`).get(...params).c;
    const rows = db
      .prepare(`SELECT * FROM sub_payments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);

    return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  },

  getAllByUser: (telegramUserId, limit = 15) =>
    getDb()
      .prepare('SELECT * FROM sub_payments WHERE telegram_user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(String(telegramUserId), limit),

  updateStatus: (id, status, adminId = null, adminNote = null) => {
    getDb()
      .prepare(`
        UPDATE sub_payments
        SET status = ?, admin_id = ?, admin_note = COALESCE(?, admin_note), processed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(status, adminId ? String(adminId) : null, adminNote, id);
  },

  countByStatus: () => {
    const rows = getDb().prepare('SELECT status, COUNT(*) c FROM sub_payments GROUP BY status').all();
    const out = { pending: 0, accepted: 0, rejected: 0, refunded: 0 };
    rows.forEach((r) => { out[r.status] = r.c; });
    return out;
  },

  sumAccepted: (sinceSql = null) => {
    const where = sinceSql
      ? `WHERE status = 'accepted' AND date(processed_at) ${sinceSql}`
      : "WHERE status = 'accepted'";
    return getDb().prepare(`SELECT COALESCE(SUM(amount), 0) s FROM sub_payments ${where}`).get().s;
  },

  revenueToday: () =>
    getDb()
      .prepare("SELECT COALESCE(SUM(amount), 0) s FROM sub_payments WHERE status = 'accepted' AND date(processed_at) = date('now')")
      .get().s,

  revenueThisMonth: () =>
    getDb()
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) s FROM sub_payments WHERE status = 'accepted' AND strftime('%Y-%m', processed_at) = strftime('%Y-%m', 'now')"
      )
      .get().s,

  revenueThisYear: () =>
    getDb()
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) s FROM sub_payments WHERE status = 'accepted' AND strftime('%Y', processed_at) = strftime('%Y', 'now')"
      )
      .get().s,

  topPackages: (limit = 3) =>
    getDb()
      .prepare(`
        SELECT package_id, package_name, COUNT(*) as sales, COALESCE(SUM(amount), 0) as revenue
        FROM sub_payments
        WHERE status = 'accepted' AND package_id IS NOT NULL
        GROUP BY package_id
        ORDER BY sales DESC
        LIMIT ?
      `)
      .all(limit),
};

// ─── Coupon Queries ───────────────────────────────────────────────────────────

const couponQueries = {
  create: (data) => {
    const stmt = getDb().prepare(`
      INSERT INTO sub_coupons
        (code, name, discount_type, discount_value, max_uses, valid_from, valid_until,
         allowed_package_ids, allowed_user_ids, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.code.toUpperCase(),
      data.name || null,
      data.discount_type || 'percent',
      data.discount_value || 0,
      data.max_uses || 0,
      data.valid_from || null,
      data.valid_until || null,
      JSON.stringify(data.allowed_package_ids || []),
      JSON.stringify(data.allowed_user_ids || []),
      data.created_by || null
    );
    return result.lastInsertRowid;
  },

  getById: (id) => _parseCouponRow(getDb().prepare('SELECT * FROM sub_coupons WHERE id = ?').get(id)),

  getByCode: (code) =>
    _parseCouponRow(
      getDb().prepare('SELECT * FROM sub_coupons WHERE UPPER(code) = UPPER(?) AND is_deleted = 0').get(code)
    ),

  existsByCode: (code) =>
    !!getDb().prepare('SELECT 1 FROM sub_coupons WHERE UPPER(code) = UPPER(?) AND is_deleted = 0').get(code),

  getPage: (opts = {}) => {
    const { page = 1, pageSize = 8 } = opts;
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) c FROM sub_coupons WHERE is_deleted = 0').get().c;
    const rows = db
      .prepare('SELECT * FROM sub_coupons WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(pageSize, (page - 1) * pageSize)
      .map(_parseCouponRow);
    return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  },

  toggleActive: (id) => {
    getDb()
      .prepare(
        'UPDATE sub_coupons SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      )
      .run(id);
  },

  softDelete: (id) => {
    getDb()
      .prepare('UPDATE sub_coupons SET is_deleted = 1, is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(id);
  },

  incrementUse: (id) => {
    getDb().prepare('UPDATE sub_coupons SET used_count = used_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  },

  hasUserUsedCoupon: (couponId, telegramUserId) =>
    !!getDb()
      .prepare('SELECT 1 FROM sub_coupon_uses WHERE coupon_id = ? AND telegram_user_id = ? LIMIT 1')
      .get(couponId, String(telegramUserId)),

  countTotalUses: () => getDb().prepare('SELECT COALESCE(SUM(used_count), 0) c FROM sub_coupons').get().c,
};

const couponUseQueries = {
  add: (couponId, telegramUserId, paymentId) => {
    getDb()
      .prepare('INSERT INTO sub_coupon_uses (coupon_id, telegram_user_id, payment_id) VALUES (?, ?, ?)')
      .run(couponId, String(telegramUserId), paymentId || null);
  },
};

// ─── Offer Queries ────────────────────────────────────────────────────────────

const offerQueries = {
  create: (data) => {
    const stmt = getDb().prepare(`
      INSERT INTO sub_offers (title, description, offer_type, value, package_id, starts_at, ends_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.title,
      data.description || null,
      data.offer_type || 'discount',
      JSON.stringify(data.value || {}),
      data.package_id || null,
      data.starts_at || null,
      data.ends_at || null,
      data.created_by || null
    );
    return result.lastInsertRowid;
  },

  getById: (id) => _parseOfferRow(getDb().prepare('SELECT * FROM sub_offers WHERE id = ?').get(id)),

  getAll: () =>
    getDb()
      .prepare('SELECT * FROM sub_offers WHERE is_deleted = 0 ORDER BY created_at DESC')
      .all()
      .map(_parseOfferRow),

  getActive: () =>
    getDb()
      .prepare(`
        SELECT * FROM sub_offers
        WHERE is_deleted = 0 AND is_active = 1
          AND (starts_at IS NULL OR datetime(starts_at) <= datetime('now'))
          AND (ends_at IS NULL OR datetime(ends_at) >= datetime('now'))
        ORDER BY created_at DESC
      `)
      .all()
      .map(_parseOfferRow),

  toggleActive: (id) => {
    getDb()
      .prepare(
        'UPDATE sub_offers SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      )
      .run(id);
  },

  softDelete: (id) => {
    getDb().prepare('UPDATE sub_offers SET is_deleted = 1, is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  },
};

// ─── Activation Code Queries (أكواد التفعيل) ──────────────────────────────────

const activationCodeQueries = {
  /**
   * Generate a batch of unique single-purpose codes for one package.
   * @param {object} opts { packageId, quantity, maxUses, expiresAt, batchLabel, createdBy }
   * @returns {string[]} the generated codes
   */
  generateBatch: ({ packageId, quantity, maxUses = 1, expiresAt = null, batchLabel = null, createdBy = null }) => {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO sub_activation_codes (code, package_id, batch_label, max_uses, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const codes = [];
    const txn = db.transaction(() => {
      for (let i = 0; i < quantity; i++) {
        let code = generateActivationCode();
        // Practically never collides given the alphabet/length, but guard anyway.
        while (db.prepare('SELECT 1 FROM sub_activation_codes WHERE code = ?').get(code)) {
          code = generateActivationCode();
        }
        insert.run(code, packageId, batchLabel, maxUses, expiresAt, createdBy);
        codes.push(code);
      }
    });
    txn();
    return codes;
  },

  getById: (id) => getDb().prepare('SELECT * FROM sub_activation_codes WHERE id = ?').get(id) || null,

  getByCode: (code) =>
    getDb()
      .prepare('SELECT * FROM sub_activation_codes WHERE UPPER(code) = UPPER(?) AND is_deleted = 0')
      .get((code || '').trim()) || null,

  /**
   * Paginated list, optionally filtered by package and/or status.
   * status: 'all' | 'unused' | 'used' | 'expired'
   */
  getPage: (opts = {}) => {
    const { packageId = null, status = 'all', page = 1, pageSize = 8 } = opts;
    const db = getDb();
    const clauses = ['is_deleted = 0'];
    const params = [];

    if (packageId) {
      clauses.push('package_id = ?');
      params.push(packageId);
    }
    if (status === 'unused') clauses.push('used_count < max_uses', "(expires_at IS NULL OR datetime(expires_at) > datetime('now'))");
    if (status === 'used') clauses.push('used_count >= max_uses');
    if (status === 'expired') clauses.push("expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')", 'used_count < max_uses');

    const where = `WHERE ${clauses.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) c FROM sub_activation_codes ${where}`).get(...params).c;
    const rows = db
      .prepare(`SELECT * FROM sub_activation_codes ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);

    return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  },

  toggleActive: (id) => {
    getDb()
      .prepare('UPDATE sub_activation_codes SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?')
      .run(id);
  },

  softDelete: (id) => {
    getDb().prepare('UPDATE sub_activation_codes SET is_deleted = 1, is_active = 0 WHERE id = ?').run(id);
  },

  incrementUse: (id) => {
    getDb().prepare('UPDATE sub_activation_codes SET used_count = used_count + 1 WHERE id = ?').run(id);
  },

  countActiveUnused: () =>
    getDb()
      .prepare(`
        SELECT COUNT(*) c FROM sub_activation_codes
        WHERE is_deleted = 0 AND is_active = 1 AND used_count < max_uses
          AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      `)
      .get().c,

  countTotalRedeemed: () => getDb().prepare('SELECT COALESCE(SUM(used_count), 0) c FROM sub_activation_codes').get().c,
};

const activationCodeUseQueries = {
  add: (codeId, telegramUserId, paymentId = null) => {
    getDb()
      .prepare('INSERT INTO sub_activation_code_uses (code_id, telegram_user_id, payment_id) VALUES (?, ?, ?)')
      .run(codeId, String(telegramUserId), paymentId);
  },

  getByCode: (codeId) =>
    getDb().prepare('SELECT * FROM sub_activation_code_uses WHERE code_id = ? ORDER BY used_at DESC').all(codeId),

  /** Has this specific telegram user already redeemed this specific code? Prevents re-use by the same user. */
  hasUserUsedCode: (codeId, telegramUserId) =>
    !!getDb()
      .prepare('SELECT 1 FROM sub_activation_code_uses WHERE code_id = ? AND telegram_user_id = ? LIMIT 1')
      .get(codeId, String(telegramUserId)),
};

// ─── Operations Log Queries ───────────────────────────────────────────────────

const operationsLogQueries = {
  log: ({ actionType, actorId, actorName, actorRole = 'admin', targetType = null, targetId = null, status = 'success', reason = null, details = null }) => {
    try {
      getDb()
        .prepare(`
          INSERT INTO sub_operations_log
            (action_type, actor_id, actor_name, actor_role, target_type, target_id, status, reason, details)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          actionType,
          actorId ? String(actorId) : null,
          actorName || null,
          actorRole,
          targetType,
          targetId ? String(targetId) : null,
          status,
          reason || null,
          details ? JSON.stringify(details) : null
        );
    } catch (error) {
      // Logging must never break the calling operation.
      logger.error('operationsLogQueries.log error:', error);
    }
  },

  getPage: (page = 1, pageSize = 10) => {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) c FROM sub_operations_log').get().c;
    const rows = db
      .prepare('SELECT * FROM sub_operations_log ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(pageSize, (page - 1) * pageSize)
      .map(_parseLogRow);
    return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  },
};

// ─── Settings (key/value) ─────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  default_currency: 'SAR',
  tax_percent: '0',
  welcome_message: 'مرحبًا بك في نظام الاشتراكات! اختر الباقة المناسبة لك.',
  expiry_message: 'انتهى اشتراكك. جدد الآن للاستمرار في الاستفادة من جميع المميزات.',
  pre_expiry_message: 'سينتهي اشتراكك خلال 3 أيام. جدد الآن لتجنب انقطاع الخدمة.',
  renewal_message: 'تم تجديد اشتراكك بنجاح. نتمنى لك تجربة رائعة!',
  auto_renew_policy: '0',
  offers_enabled: '1',
  coupons_enabled: '1',
  notify_before_expiry: '1',
  notify_after_expiry: '1',
  notify_payment_success: '1',
  notify_payment_failed: '1',
  notify_package_change: '1',
  notify_coupon_used: '1',
  notify_admin_on_new_payment: '1',
  notify_admin_on_expiry: '1',
};

const settingsQueries = {
  get: (key) => {
    const row = getDb().prepare('SELECT value FROM sub_settings WHERE key = ?').get(key);
    if (row && row.value !== null && row.value !== undefined) return row.value;
    return DEFAULT_SETTINGS[key] !== undefined ? DEFAULT_SETTINGS[key] : null;
  },

  getAll: () => {
    const rows = getDb().prepare('SELECT key, value FROM sub_settings').all();
    const stored = {};
    rows.forEach((r) => { stored[r.key] = r.value; });
    return { ...DEFAULT_SETTINGS, ...stored };
  },

  set: (key, value) => {
    getDb()
      .prepare(`
        INSERT INTO sub_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `)
      .run(key, String(value));
  },

  toggle: (key) => {
    const current = settingsQueries.get(key);
    const next = current === '1' ? '0' : '1';
    settingsQueries.set(key, next);
    return next;
  },
};

// ─── Dashboard Statistics ─────────────────────────────────────────────────────

const statsQueries = {
  getDashboard: () => {
    const byStatus = subscriberQueries.countByStatus();
    const payStatus = paymentQueries.countByStatus();
    return {
      totalSubscribers: subscriberQueries.countTotalEverSubscribed(),
      activeSubscriptions: byStatus.active,
      expiredSubscriptions: byStatus.expired,
      renewedCount: subscriberHistoryQueries.countRenewals(),
      totalRevenue: paymentQueries.sumAccepted(),
      revenueToday: paymentQueries.revenueToday(),
      revenueThisMonth: paymentQueries.revenueThisMonth(),
      revenueThisYear: paymentQueries.revenueThisYear(),
      topPackages: paymentQueries.topPackages(3),
      successfulPayments: payStatus.accepted,
      rejectedPayments: payStatus.rejected,
      pendingPayments: payStatus.pending,
      couponsUsed: couponQueries.countTotalUses(),
      activationCodesAvailable: activationCodeQueries.countActiveUnused(),
      activationCodesRedeemed: activationCodeQueries.countTotalRedeemed(),
      renewalRate:
        byStatus.active + byStatus.expired > 0
          ? Math.round((subscriberHistoryQueries.countRenewals() / (byStatus.active + byStatus.expired)) * 100)
          : 0,
    };
  },
};

module.exports = {
  initSubscriptionsSchema,
  generateCode,
  generateActivationCode,
  nowIso,
  packageQueries,
  subscriberQueries,
  subscriberHistoryQueries,
  paymentQueries,
  couponQueries,
  couponUseQueries,
  offerQueries,
  activationCodeQueries,
  activationCodeUseQueries,
  operationsLogQueries,
  settingsQueries,
  statsQueries,
  DEFAULT_SETTINGS,
};
