const logger = require('../utils/logger');
const { accountQueries } = require('../database/db');
const { adQueries } = require('../database/publishDb');
const { scheduleQueries } = require('../database/scheduleDb');
const { getClientForAccount, sendAd } = require('./publishService');

const locks = new Set();
let interval = null;

const nextOccurrence = (row, from = new Date()) => {
  const base = new Date(from);
  if (row.recurrence === 'daily') base.setDate(base.getDate() + 1);
  else if (row.recurrence === 'weekly') base.setDate(base.getDate() + 7);
  else if (row.recurrence === 'custom') base.setDate(base.getDate() + Math.max(1, Number(row.recurrence_value || 1)));
  else return null;
  return base.toISOString();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const executeSchedule = async (rawRow) => {
  const row = scheduleQueries.decode(rawRow);
  if (!row || locks.has(row.id)) return;
  locks.add(row.id);
  const started = new Date();
  let successes = 0;
  let failures = 0;
  try {
    const ads = row.ad_ids.map((id) => adQueries.getById(id, row.user_id)).filter(Boolean);
    const ad = ads[0] || (row.content_text ? { type: row.content_type === 'image' ? 'image' : 'text', text_content: row.content_text, media_file: row.media_file } : null);
    if (!ad) throw new Error('CONTENT_NOT_FOUND');
    for (const accountId of row.account_ids) {
      const account = accountQueries.getById(accountId);
      if (!account || account.user_id !== String(row.user_id) || account.status !== 'connected') {
        failures += row.target_ids.length;
        for (const targetId of row.target_ids) scheduleQueries.addRun({ scheduleId: row.id, userId: row.user_id, accountId, targetId, adId: row.ad_ids[0], result: 'failed', detail: 'ACCOUNT_NOT_READY' });
        continue;
      }
      let client;
      try {
        client = await getClientForAccount(account);
        for (const targetId of row.target_ids) {
          const result = await sendAd(client, String(targetId), ad);
          if (result.success) successes += 1; else failures += 1;
          scheduleQueries.addRun({ scheduleId: row.id, userId: row.user_id, accountId, targetId, adId: row.ad_ids[0], result: result.success ? 'success' : 'failed', detail: result.success ? 'Published successfully' : result.error });
          if (row.delay_seconds > 0) await sleep(row.delay_seconds * 1000);
        }
      } catch (error) {
        failures += row.target_ids.length;
        for (const targetId of row.target_ids) scheduleQueries.addRun({ scheduleId: row.id, userId: row.user_id, accountId, targetId, adId: row.ad_ids[0], result: 'failed', detail: error.message });
      } finally {
        if (client) await client.disconnect().catch(() => {});
      }
    }
    const next = nextOccurrence(row, started);
    scheduleQueries.update(row.id, row.user_id, {
      last_run_at: started.toISOString(),
      next_run_at: next || null,
      status: next ? 'running' : 'completed',
      run_count: Number(row.run_count || 0) + 1,
      success_count: Number(row.success_count || 0) + successes,
      failure_count: Number(row.failure_count || 0) + failures,
      last_error: failures ? `${failures} operation(s) failed` : null,
    });
  } catch (error) {
    logger.error(`Schedule ${row.id} failed: ${error.message}`);
    const next = nextOccurrence(row, started);
    scheduleQueries.update(row.id, row.user_id, { last_run_at: started.toISOString(), next_run_at: next || null, status: next ? 'running' : 'failed', failure_count: Number(row.failure_count || 0) + 1, last_error: error.message });
  } finally {
    locks.delete(row.id);
  }
};

const tick = async () => {
  for (const row of scheduleQueries.due(50)) {
    executeSchedule(row).catch((error) => logger.error(`Unhandled schedule ${row.id} error: ${error.message}`));
  }
};

const startScheduleService = () => {
  if (interval) return;
  logger.info('Starting persistent publish schedule service...');
  tick().catch((error) => logger.error(`Initial schedule tick failed: ${error.message}`));
  interval = setInterval(() => tick().catch((error) => logger.error(`Schedule tick failed: ${error.message}`)), 5000);
};

const stopScheduleService = () => { if (interval) clearInterval(interval); interval = null; };

module.exports = { startScheduleService, stopScheduleService, executeSchedule, nextOccurrence };
