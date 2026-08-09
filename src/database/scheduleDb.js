const { getDb } = require('./db');

const initScheduleSchema = () => {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS publish_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      account_ids TEXT NOT NULL,
      target_ids TEXT NOT NULL,
      ad_ids TEXT,
      content_text TEXT,
      content_type TEXT NOT NULL DEFAULT 'ad',
      media_file TEXT,
      scheduled_at DATETIME NOT NULL,
      recurrence TEXT NOT NULL DEFAULT 'once',
      recurrence_value TEXT,
      delay_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'paused',
      next_run_at DATETIME,
      last_run_at DATETIME,
      run_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_publish_schedules_due ON publish_schedules(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_publish_schedules_user ON publish_schedules(user_id, status);
    CREATE TABLE IF NOT EXISTS publish_schedule_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      account_id INTEGER,
      target_id TEXT,
      ad_id INTEGER,
      result TEXT NOT NULL,
      detail TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON publish_schedule_runs(schedule_id, started_at);
  `);
};

const parseJson = (value, fallback = []) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const serialize = (value) => JSON.stringify(value || []);

const scheduleQueries = {
  create: (userId, data) => {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO publish_schedules
      (user_id, name, account_ids, target_ids, ad_ids, content_text, content_type, media_file,
       scheduled_at, recurrence, recurrence_value, delay_seconds, status, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paused', ?)
    `).run(
      String(userId), data.name, serialize(data.accountIds), serialize(data.targetIds),
      data.adIds?.length ? serialize(data.adIds) : null, data.contentText || null,
      data.contentType || 'ad', data.mediaFile || null, data.scheduledAt,
      data.recurrence || 'once', data.recurrenceValue || null,
      Number(data.delaySeconds || 0), data.scheduledAt,
    );
    return scheduleQueries.getById(result.lastInsertRowid, userId);
  },
  getById: (id, userId) => getDb().prepare('SELECT * FROM publish_schedules WHERE id = ? AND user_id = ?').get(id, String(userId)),
  list: (userId, status) => {
    const sql = status ? 'SELECT * FROM publish_schedules WHERE user_id = ? AND status = ? ORDER BY next_run_at ASC, id DESC' : 'SELECT * FROM publish_schedules WHERE user_id = ? ORDER BY next_run_at ASC, id DESC';
    return status ? getDb().prepare(sql).all(String(userId), status) : getDb().prepare(sql).all(String(userId));
  },
  due: (limit = 50) => getDb().prepare("SELECT * FROM publish_schedules WHERE status = 'running' AND next_run_at IS NOT NULL AND next_run_at <= CURRENT_TIMESTAMP ORDER BY next_run_at ASC LIMIT ?").all(limit),
  update: (id, userId, data) => {
    const allowed = ['name','account_ids','target_ids','ad_ids','content_text','content_type','media_file','scheduled_at','recurrence','recurrence_value','delay_seconds','status','next_run_at','last_run_at','run_count','success_count','failure_count','last_error'];
    const fields = [];
    const values = [];
    for (const key of allowed) if (data[key] !== undefined) { fields.push(`${key} = ?`); values.push(data[key]); }
    if (!fields.length) return { changes: 0 };
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, String(userId));
    return getDb().prepare(`UPDATE publish_schedules SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
  },
  setStatus: (id, userId, status) => scheduleQueries.update(id, userId, { status }),
  remove: (id, userId) => {
    const db = getDb();
    return db.transaction(() => {
      db.prepare('DELETE FROM publish_schedule_runs WHERE schedule_id = ?').run(id);
      return db.prepare('DELETE FROM publish_schedules WHERE id = ? AND user_id = ?').run(id, String(userId));
    })();
  },
  findConflict: (userId, scheduledAt, accountIds, targetIds, excludeId = null) => {
    const rows = getDb().prepare("SELECT * FROM publish_schedules WHERE user_id = ? AND status IN ('running','paused')").all(String(userId));
    const accounts = new Set(accountIds.map(String));
    const targets = new Set(targetIds.map(String));
    return rows.find((row) => {
      if (excludeId && Number(row.id) === Number(excludeId)) return false;
      const existingTime = row.next_run_at || row.scheduled_at;
      if (Math.abs(new Date(existingTime).getTime() - new Date(scheduledAt).getTime()) > 60000) return false;
      return parseJson(row.account_ids).some((id) => accounts.has(String(id))) && parseJson(row.target_ids).some((id) => targets.has(String(id)));
    });
  },
  addRun: (data) => getDb().prepare(`INSERT INTO publish_schedule_runs (schedule_id,user_id,account_id,target_id,ad_id,result,detail,finished_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(data.scheduleId, String(data.userId), data.accountId || null, data.targetId || null, data.adId || null, data.result, data.detail || null),
  recentRuns: (userId, limit = 50) => getDb().prepare('SELECT * FROM publish_schedule_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?').all(String(userId), limit),
  stats: (userId) => {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) c FROM publish_schedules WHERE user_id = ?').get(String(userId)).c,
      running: db.prepare("SELECT COUNT(*) c FROM publish_schedules WHERE user_id = ? AND status = 'running'").get(String(userId)).c,
      paused: db.prepare("SELECT COUNT(*) c FROM publish_schedules WHERE user_id = ? AND status = 'paused'").get(String(userId)).c,
      success: db.prepare("SELECT COUNT(*) c FROM publish_schedule_runs WHERE user_id = ? AND result = 'success'").get(String(userId)).c,
      failed: db.prepare("SELECT COUNT(*) c FROM publish_schedule_runs WHERE user_id = ? AND result = 'failed'").get(String(userId)).c,
    };
  },
  decode: (row) => row ? ({ ...row, account_ids: parseJson(row.account_ids), target_ids: parseJson(row.target_ids), ad_ids: parseJson(row.ad_ids), delay_seconds: Number(row.delay_seconds || 0) }) : null,
};

module.exports = { initScheduleSchema, scheduleQueries, serialize };
