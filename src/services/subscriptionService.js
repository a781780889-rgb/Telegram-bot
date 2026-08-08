const crypto = require('crypto');
const { getDb } = require('../database/db');

const PLAN_TYPES = {
  DAYS_30: { key: '30d', label: '30 يوم', days: 30 },
  DAYS_60: { key: '60d', label: '60 يوم', days: 60 },
  DAYS_90: { key: '90d', label: '90 يوم', days: 90 },
  YEAR: { key: '1y', label: 'سنة واحدة', days: 365 },
  LIFETIME: { key: 'lifetime', label: 'مفتوح / Lifetime', days: null },
};

const normalizeCode = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const nowIso = () => new Date().toISOString();
const futureIso = (days, base = new Date()) => {
  if (days === null) return null;
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString();
};
const isExpired = (subscription) => Boolean(subscription?.expires_at && new Date(subscription.expires_at).getTime() <= Date.now());

const getSubscription = (userId) => {
  const db = getDb();
  const subscription = db.prepare(`
    SELECT * FROM subscriptions
    WHERE user_id = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).get(String(userId));
  if (subscription && isExpired(subscription)) {
    db.prepare(`UPDATE subscriptions SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'`).run(subscription.id);
    subscription.status = 'expired';
  }
  return subscription;
};

const getAccountCount = (userId) => getDb().prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?').get(String(userId)).count || 0;

const getAccess = (userId) => {
  const subscription = getSubscription(userId);
  const used = getAccountCount(userId);
  if (!subscription || subscription.status !== 'active') {
    return { allowed: false, reason: 'no_subscription', subscription: null, used, remaining: 0 };
  }
  const remaining = Math.max(0, Number(subscription.max_accounts) - used);
  if (remaining <= 0) return { allowed: false, reason: 'limit_reached', subscription, used, remaining: 0 };
  return { allowed: true, reason: null, subscription, used, remaining };
};

const formatDate = (value) => value ? new Intl.DateTimeFormat('ar-SA', { calendar: 'gregory', dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : 'غير محدد';
const formatSubscription = (subscription, used = getAccountCount(subscription?.user_id)) => {
  if (!subscription) return 'لا يوجد اشتراك فعال حالياً.';
  const lifetime = !subscription.expires_at;
  const daysLeft = lifetime ? '∞' : Math.max(0, Math.ceil((new Date(subscription.expires_at).getTime() - Date.now()) / 86400000));
  const remaining = Math.max(0, Number(subscription.max_accounts) - used);
  return [
    '💳 *اشتراكي*',
    '',
    `الحالة: ${subscription.status === 'active' ? '✅ فعال' : '⚠️ منتهي'}`,
    `النوع: ${subscription.plan_label}`,
    `تاريخ التفعيل: ${formatDate(subscription.started_at)}`,
    `تاريخ الانتهاء: ${lifetime ? '♾ مفتوح / Lifetime' : formatDate(subscription.expires_at)}`,
    `الأيام المتبقية: ${daysLeft}`,
    `الحسابات: ${used}/${subscription.max_accounts}`,
    `المتبقي: ${remaining}`,
  ].join('\n');
};

const generateCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
  return `${part()}-${part()}-${part()}`;
};

const createCodes = ({ planKey, maxAccounts, quantity = 1, adminId }) => {
  const plan = Object.values(PLAN_TYPES).find((item) => item.key === planKey);
  if (!plan) throw new Error('INVALID_PLAN');
  const limit = Number(maxAccounts);
  const count = Number(quantity);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) throw new Error('INVALID_ACCOUNT_LIMIT');
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('INVALID_QUANTITY');
  const db = getDb();
  const insert = db.prepare(`INSERT INTO activation_codes (code, plan_key, plan_label, duration_days, max_accounts, status, created_by) VALUES (?, ?, ?, ?, ?, 'unused', ?)`);
  const result = db.transaction(() => {
    const codes = [];
    for (let i = 0; i < count; i += 1) {
      let code;
      do { code = generateCode(); } while (db.prepare('SELECT 1 FROM activation_codes WHERE code = ?').get(code));
      insert.run(code, plan.key, plan.label, plan.days, limit, String(adminId));
      codes.push(code);
    }
    db.prepare('INSERT INTO admin_actions (admin_id, action, target, metadata) VALUES (?, ?, ?, ?)')
      .run(String(adminId), 'create_activation_codes', null, JSON.stringify({ planKey, maxAccounts: limit, quantity: count }));
    return codes;
  })();
  return result;
};

const activateCode = (userId, rawCode) => {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: 'invalid' };
  const db = getDb();
  return db.transaction(() => {
    const activation = db.prepare('SELECT * FROM activation_codes WHERE code = ?').get(code);
    if (!activation) return { ok: false, reason: 'invalid' };
    if (activation.status === 'cancelled') return { ok: false, reason: 'cancelled' };
    if (activation.status !== 'unused') return { ok: false, reason: 'used' };

    const current = getSubscription(userId);
    const currentIsLifetime = current && current.status === 'active' && !current.expires_at;
    const started = current && current.status === 'active' && current.expires_at && new Date(current.expires_at) > new Date()
      ? new Date(current.expires_at) : new Date();
    const durationDays = currentIsLifetime ? null : activation.duration_days;
    const planKey = currentIsLifetime ? current.plan_key : activation.plan_key;
    const planLabel = currentIsLifetime ? current.plan_label : activation.plan_label;
    const maxAccounts = currentIsLifetime ? Math.max(Number(current.max_accounts), Number(activation.max_accounts)) : activation.max_accounts;
    const expires = durationDays === null ? null : futureIso(durationDays, started);
    const subscription = db.prepare(`
      INSERT INTO subscriptions (user_id, activation_code_id, plan_key, plan_label, duration_days, max_accounts, started_at, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'active')
    `).run(String(userId), activation.id, planKey, planLabel, durationDays, maxAccounts, expires);
    if (current && current.status === 'active') {
      db.prepare(`UPDATE subscriptions SET status = 'replaced', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(current.id);
    }
    db.prepare(`UPDATE activation_codes SET status = 'used', used_by = ?, activated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'unused'`).run(String(userId), activation.id);
    db.prepare(`INSERT INTO subscription_events (user_id, subscription_id, event_type, metadata) VALUES (?, ?, 'activated', ?)`)
      .run(String(userId), subscription.lastInsertRowid, JSON.stringify({ code, previousSubscriptionId: current?.id || null }));
    return { ok: true, subscription: db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscription.lastInsertRowid) };
  })();
};

const cancelCode = (code, adminId) => getDb().prepare(`UPDATE activation_codes SET status = 'cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP WHERE code = ? AND status = 'unused'`).run(String(adminId), normalizeCode(code));
const getStats = () => {
  const db = getDb();
  return {
    users: db.prepare('SELECT COUNT(DISTINCT user_id) AS count FROM subscriptions').get().count,
    active: db.prepare("SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'active' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)").get().count,
    expired: db.prepare("SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'expired' OR (status = 'active' AND expires_at <= CURRENT_TIMESTAMP)").get().count,
    unusedCodes: db.prepare("SELECT COUNT(*) AS count FROM activation_codes WHERE status = 'unused'").get().count,
    usedCodes: db.prepare("SELECT COUNT(*) AS count FROM activation_codes WHERE status = 'used'").get().count,
    accounts: db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count,
  };
};

module.exports = { PLAN_TYPES, normalizeCode, getSubscription, getAccess, getAccountCount, formatSubscription, createCodes, activateCode, cancelCode, getStats, formatDate };

if (require.main === module) {
  // Intentionally empty: service is exercised by the repository test suite.
}
