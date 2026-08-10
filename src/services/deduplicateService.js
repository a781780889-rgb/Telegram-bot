/**
 * deduplicateService.js — محرك نظام إزالة المكرر
 *
 * التدفق:
 *  1. جمع بيانات المجموعات/القنوات من جميع الحسابات المحددة
 *  2. اكتشاف التكرار باستخدام Entity ID فقط (لا الاسم)
 *  3. تحديد الحساب المحتفظ (الأعلى أولوية)
 *  4. إنشاء Queue لعمليات الخروج
 *  5. تنفيذ الخروج تدريجياً مع احترام FloodWait
 *  6. تسجيل كل عملية
 *  7. إعادة الفحص النهائي
 */

const { Api } = require('telegram');
const logger = require('../utils/logger');
const { accountQueries } = require('../database/db');
const {
  taskQueries,
  taskAccountQueries,
  entityQueries,
  operationQueries,
  settingsQueries,
} = require('../database/deduplicateDb');
const { loadSession } = require('./telegramClient');

// ─── In-memory run state ───────────────────────────────────────────────────────

/**
 * userId → { taskId, paused, stopping, phase }
 */
const activeRuns = new Map();

const isRunning = (userId) => !!activeRuns.get(String(userId))?.taskId;
const isPaused  = (userId) => !!activeRuns.get(String(userId))?.paused;

const requestPause  = (userId) => { const r = activeRuns.get(String(userId)); if (r) r.paused   = true; };
const requestResume = (userId) => { const r = activeRuns.get(String(userId)); if (r) r.paused   = false; };
const requestStop   = (userId) => { const r = activeRuns.get(String(userId)); if (r) r.stopping = true; };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** انتظار مع احترام الإيقاف المؤقت */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const waitIfPaused = async (userId) => {
  while (isPaused(userId)) {
    await sleep(1000);
  }
};

/** تحديد نوع الكيان */
const getEntityType = (dialog) => {
  if (!dialog?.entity) return null;
  const e = dialog.entity;
  if (e.className === 'Channel' && e.megagroup) return 'supergroup';
  if (e.className === 'Channel') return 'channel';
  if (e.className === 'Chat') return 'group';
  return null;
};

/** الحصول على Entity ID بالصيغة الموحدة */
const getEntityId = (entity) => {
  if (!entity) return null;
  const raw = entity.id;
  if (!raw) return null;
  const num = typeof raw === 'bigint' ? raw : BigInt(raw);
  // تحويل لصيغة Telegram الكاملة السالبة
  if (entity.className === 'Channel') {
    return String(-1000000000000n - num < 0 ? -1000000000000n - num : num);
  }
  return String(num);
};

/** جلب كل مجموعات/قنوات حساب معين */
const fetchAccountDialogs = async (client, accountId, taskId, priority, settings) => {
  const entities = [];
  try {
    let offsetDate = 0;
    let offsetId = 0;
    let offsetPeer = new Api.InputPeerEmpty();
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      let result;
      try {
        result = await client.invoke(new Api.messages.GetDialogs({
          offsetDate,
          offsetId,
          offsetPeer,
          limit,
          hash: BigInt(0),
        }));
      } catch (err) {
        if (err.errorMessage === 'FLOOD_WAIT_X' || String(err).includes('FLOOD_WAIT')) {
          const waitSec = err.seconds || 30;
          logger.warn(`[DEDUP] fetchDialogs FloodWait ${waitSec}s for account ${accountId}`);
          await sleep(waitSec * 1000 + 1000);
          continue;
        }
        throw err;
      }

      if (!result || !result.dialogs || result.dialogs.length === 0) {
        hasMore = false;
        break;
      }

      const dialogs = result.dialogs;
      const chats = new Map();
      if (result.chats) {
        for (const c of result.chats) chats.set(String(c.id), c);
      }

      for (const dialog of dialogs) {
        const peer = dialog.peer;
        let entityId = null;
        let entityObj = null;
        let entityType = null;

        if (peer?.className === 'PeerChannel') {
          const ch = chats.get(String(peer.channelId));
          if (ch) {
            entityObj = ch;
            entityId = ch.megagroup
              ? String(-(1000000000000n + BigInt(peer.channelId)))
              : String(-(1000000000000n + BigInt(peer.channelId)));
            entityType = ch.megagroup ? 'supergroup' : 'channel';
          }
        } else if (peer?.className === 'PeerChat') {
          const ch = chats.get(String(peer.chatId));
          if (ch) {
            entityObj = ch;
            entityId = String(-peer.chatId);
            entityType = 'group';
          }
        }

        if (!entityId || !entityType) continue;
        // تأكد من أن المستخدم عضو فعلي (لا متروك أو محظور)
        if (dialog.left) continue;

        entities.push({
          entityId,
          entityName: entityObj?.title || entityObj?.username || entityId,
          entityType,
          accountId,
          priority,
        });
      }

      // pagination
      const last = dialogs[dialogs.length - 1];
      if (dialogs.length < limit || result.dialogs.length === 0) {
        hasMore = false;
      } else {
        const lastPeer = last.peer;
        offsetPeer = lastPeer?.className === 'PeerChannel'
          ? new Api.InputPeerChannel({ channelId: lastPeer.channelId, accessHash: BigInt(0) })
          : lastPeer?.className === 'PeerChat'
            ? new Api.InputPeerChat({ chatId: lastPeer.chatId })
            : new Api.InputPeerEmpty();
        offsetId  = last.topMessage || 0;
        offsetDate = last.date || 0;
        await sleep(500); // تأخير بسيط بين الطلبات
      }
    }
  } catch (err) {
    logger.error(`[DEDUP] Error fetching dialogs for account ${accountId}: ${err.message}`);
  }
  return entities;
};

/** التحقق من أن الحساب ما زال عضواً في المجموعة/القناة */
const verifyMembership = async (client, entityId) => {
  try {
    const numId = BigInt(entityId);
    let inputPeer;

    if (numId < -1000000000000n) {
      // channel or supergroup
      const channelId = -(numId + 1000000000000n);
      inputPeer = new Api.InputPeerChannel({ channelId, accessHash: BigInt(0) });
    } else if (numId < 0n) {
      const chatId = -numId;
      inputPeer = new Api.InputPeerChat({ chatId });
    } else {
      return false;
    }

    await client.invoke(new Api.channels.GetFullChannel({ channel: inputPeer }));
    return true;
  } catch (_) {
    return false;
  }
};

/** تنفيذ عملية الخروج من مجموعة/قناة واحدة */
const leaveEntity = async (client, entityId, entityType) => {
  const numId = BigInt(entityId);

  if (numId < -1000000000000n) {
    // channel or supergroup
    const channelId = -(numId + 1000000000000n);
    await client.invoke(new Api.channels.LeaveChannel({
      channel: new Api.InputChannel({ channelId, accessHash: BigInt(0) }),
    }));
  } else if (numId < 0n) {
    // basic group
    const chatId = -numId;
    await client.invoke(new Api.messages.DeleteChatUser({
      chatId,
      userId: new Api.InputUserSelf(),
      revokeHistory: false,
    }));
  }
};

// ─── Main Engine ──────────────────────────────────────────────────────────────

/**
 * بدء مهمة إزالة المكرر
 * @param {string} userId
 * @param {number[]} selectedAccountIds
 * @param {Function} onProgress callback(taskId, eventType, data)
 * @returns {number} taskId
 */
const startDeduplication = async (userId, selectedAccountIds, onProgress) => {
  const uid = String(userId);

  // منع تشغيل مهمتين متعارضتين
  if (taskQueries.hasConflict(uid, selectedAccountIds)) {
    const active = taskQueries.getActiveByUserId(uid);
    throw new Error(`CONFLICT:${active.id}`);
  }

  const settings = settingsQueries.get(uid);
  const delayMs = settings.delay_between_ops_ms || 2000;
  const maxRetries = settings.max_retries || 2;

  // تحديد أولويات الحسابات
  let priorityOrder = [];
  try {
    priorityOrder = JSON.parse(settings.priority_order || '[]');
  } catch (_) {}

  const accountsWithPriority = selectedAccountIds.map((id) => {
    const idx = priorityOrder.indexOf(id);
    return { accountId: id, priority: idx >= 0 ? idx + 1 : 999 };
  }).sort((a, b) => a.priority - b.priority);

  // إعادة ترقيم الأولويات
  accountsWithPriority.forEach((a, i) => { a.priority = i + 1; });

  // إنشاء المهمة
  const taskId = taskQueries.create(uid, selectedAccountIds.length);
  taskAccountQueries.addAccounts(taskId, accountsWithPriority);

  // تسجيل الـ run
  activeRuns.set(uid, { taskId, paused: false, stopping: false, phase: 'scanning' });

  logger.info(`[DEDUP] Task ${taskId} started for user ${uid} with ${selectedAccountIds.length} accounts`);

  // تشغيل بشكل غير متزامن
  runDeduplication(uid, taskId, accountsWithPriority, settings, delayMs, maxRetries, onProgress)
    .catch((err) => {
      logger.error(`[DEDUP] Task ${taskId} crashed: ${err.message}`);
      taskQueries.updateStatus(taskId, 'failed');
      activeRuns.delete(uid);
    });

  return taskId;
};

const runDeduplication = async (uid, taskId, accountsWithPriority, settings, delayMs, maxRetries, onProgress) => {
  try {
    // ── المرحلة 1: جمع البيانات ───────────────────────────────────────────────
    taskQueries.updateStatus(taskId, 'scanning');
    onProgress && onProgress(taskId, 'phase_start', { phase: 'scanning' });

    const accounts = accountQueries.getAllByUserId(uid);
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    let totalEntityCount = 0;

    for (const { accountId, priority } of accountsWithPriority) {
      const run = activeRuns.get(uid);
      if (!run || run.stopping) break;
      await waitIfPaused(uid);

      const account = accountMap.get(accountId);
      if (!account || account.status !== 'connected') {
        taskAccountQueries.updateStatus(taskId, accountId, 'error', 0);
        onProgress && onProgress(taskId, 'account_skip', { accountId, reason: 'disconnected' });
        taskQueries.incrementField(taskId, 'scanned_accounts');
        continue;
      }

      taskQueries.setCurrentOperation(taskId, accountId, null);
      onProgress && onProgress(taskId, 'account_scan_start', { accountId });

      let client;
      try {
        client = await loadSession(uid, accountId);
        if (!client) throw new Error('no_session');
      } catch (err) {
        taskAccountQueries.updateStatus(taskId, accountId, 'error', 0);
        onProgress && onProgress(taskId, 'account_error', { accountId, error: err.message });
        taskQueries.incrementField(taskId, 'scanned_accounts');
        const task = taskQueries.getById(taskId);
        taskQueries.updateStatus(taskId, task.status, { scanned_accounts: (task.scanned_accounts || 0) + 1 });
        continue;
      }

      // جلب الحوارات
      const entities = await fetchAccountDialogs(client, accountId, taskId, priority, settings);
      totalEntityCount += entities.length;

      // تسجيل الكيانات في قاعدة البيانات
      for (const e of entities) {
        entityQueries.upsert(taskId, e.entityId, e.entityName, e.entityType, e.accountId, e.priority);
      }

      taskAccountQueries.updateStatus(taskId, accountId, 'done', entities.length);
      const task = taskQueries.getById(taskId);
      taskQueries.updateStatus(taskId, task.status, {
        scanned_accounts: (task.scanned_accounts || 0) + 1,
        total_entities: totalEntityCount,
      });

      onProgress && onProgress(taskId, 'account_scanned', { accountId, entityCount: entities.length });
    }

    const run = activeRuns.get(uid);
    if (!run || run.stopping) {
      taskQueries.updateStatus(taskId, 'stopped', { completed_at: new Date().toISOString() });
      activeRuns.delete(uid);
      onProgress && onProgress(taskId, 'stopped', {});
      return;
    }

    // ── المرحلة 2: تحديد المكررات وتحديد الحسابات المحتفظة ───────────────────
    entityQueries.finalizeKeepAccounts(taskId);
    const duplicates = entityQueries.getDuplicates(taskId);
    const duplicateCount = duplicates.length;

    taskQueries.updateStatus(taskId, 'deduplicating', {
      duplicate_count: duplicateCount,
      remaining_dupes: duplicateCount,
    });

    onProgress && onProgress(taskId, 'duplicates_found', { count: duplicateCount });

    if (duplicateCount === 0) {
      // لا يوجد مكرر
      await finalizeTask(uid, taskId, onProgress);
      return;
    }

    // إنشاء عمليات الخروج
    for (const entity of duplicates) {
      let accounts = [];
      try { accounts = JSON.parse(entity.accounts_json || '[]'); } catch (_) {}
      const toLeave = accounts.filter((a) => a.account_id !== entity.keep_account_id);
      for (const acc of toLeave) {
        operationQueries.create(
          taskId, entity.entity_id, entity.entity_name, entity.entity_type,
          acc.account_id, entity.keep_account_id, entity.duplicate_count
        );
      }
    }

    // ── المرحلة 3: تنفيذ عمليات الخروج ──────────────────────────────────────
    if (activeRuns.get(uid)) activeRuns.get(uid).phase = 'deduplicating';

    const operations = operationQueries.getByTaskId(taskId, 10000, 0).reverse(); // الأقدم أولاً

    for (const op of operations) {
      const runState = activeRuns.get(uid);
      if (!runState || runState.stopping) break;
      await waitIfPaused(uid);

      if (op.status === 'success') continue; // تم مسبقاً

      const account = accountMap.get(op.account_id);
      if (!account || account.status !== 'connected') {
        operationQueries.updateStatus(op.id, 'failed', { error_type: 'account_disconnected', error_message: 'الحساب غير متصل' });
        taskQueries.incrementField(taskId, 'leave_failed');
        taskQueries.incrementField(taskId, 'error_count');
        continue;
      }

      taskQueries.setCurrentOperation(taskId, op.account_id, op.entity_name);

      let client;
      try {
        client = await loadSession(uid, op.account_id);
        if (!client) throw new Error('no_session');
      } catch (err) {
        operationQueries.updateStatus(op.id, 'failed', { error_type: 'session_error', error_message: err.message });
        taskQueries.incrementField(taskId, 'leave_failed');
        taskQueries.incrementField(taskId, 'error_count');
        continue;
      }

      let success = false;
      let lastError = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const runStateNow = activeRuns.get(uid);
        if (!runStateNow || runStateNow.stopping) break;
        await waitIfPaused(uid);

        try {
          await leaveEntity(client, op.entity_id, op.entity_type);
          success = true;
          break;
        } catch (err) {
          const msg = String(err.message || err);
          lastError = err;

          if (msg.includes('FLOOD_WAIT')) {
            const waitSec = err.seconds || 30;
            operationQueries.updateStatus(op.id, 'pending', {
              error_type: 'flood_wait',
              flood_wait_sec: waitSec,
              retries: attempt,
            });
            logger.warn(`[DEDUP] FloodWait ${waitSec}s for account ${op.account_id}`);
            onProgress && onProgress(taskId, 'flood_wait', { accountId: op.account_id, seconds: waitSec });
            await sleep(Math.min(waitSec * 1000, 3 * 60 * 60 * 1000));
            continue;
          }

          if (msg.includes('USER_NOT_PARTICIPANT') || msg.includes('CHANNEL_INVALID') || msg.includes('CHAT_ID_INVALID')) {
            // ليس عضواً أصلاً — نعتبرها ناجحة
            success = true;
            break;
          }

          if (attempt < maxRetries) {
            await sleep(2000);
            continue;
          }
        }
      }

      if (success) {
        operationQueries.updateStatus(op.id, 'success', {});
        taskQueries.incrementField(taskId, 'leave_success');
        onProgress && onProgress(taskId, 'leave_success', {
          accountId: op.account_id, entityName: op.entity_name, entityId: op.entity_id,
        });
      } else {
        const errMsg = lastError?.message || 'unknown';
        operationQueries.updateStatus(op.id, 'failed', {
          error_type: 'leave_failed',
          error_message: errMsg,
          retries: maxRetries,
        });
        taskQueries.incrementField(taskId, 'leave_failed');
        taskQueries.incrementField(taskId, 'error_count');
        onProgress && onProgress(taskId, 'leave_failed', {
          accountId: op.account_id, entityName: op.entity_name, error: errMsg,
        });
      }

      await sleep(delayMs);
    }

    const runFinal = activeRuns.get(uid);
    if (!runFinal || runFinal.stopping) {
      taskQueries.updateStatus(taskId, 'stopped', { completed_at: new Date().toISOString() });
      activeRuns.delete(uid);
      onProgress && onProgress(taskId, 'stopped', {});
      return;
    }

    // ── المرحلة 4: الفحص النهائي ─────────────────────────────────────────────
    await finalizeTask(uid, taskId, onProgress);

  } catch (err) {
    logger.error(`[DEDUP] Fatal error in task ${taskId}: ${err.stack || err.message}`);
    taskQueries.updateStatus(taskId, 'failed', { completed_at: new Date().toISOString() });
    activeRuns.delete(uid);
    onProgress && onProgress(taskId, 'failed', { error: err.message });
  }
};

const finalizeTask = async (uid, taskId, onProgress) => {
  onProgress && onProgress(taskId, 'phase_start', { phase: 'reverify' });

  // إعادة الفحص: هل بقيت مكررات بسبب أخطاء؟
  const failedOps = operationQueries.getFailedByTaskId(taskId);
  const remainingDupes = failedOps.length;

  const opCounts = operationQueries.countByStatus(taskId);
  const task = taskQueries.getById(taskId);

  const finalReport = {
    taskId,
    totalAccounts: task.total_accounts,
    totalEntities: task.total_entities,
    duplicateCount: task.duplicate_count,
    leaveSuccess: opCounts.success || 0,
    leaveFailed: opCounts.failed || 0,
    remainingDupes,
    duration: task.started_at
      ? Math.floor((Date.now() - new Date(task.started_at).getTime()) / 1000)
      : 0,
  };

  taskQueries.updateStatus(taskId, 'completed', {
    completed_at: new Date().toISOString(),
    remaining_dupes: remainingDupes,
    final_report: JSON.stringify(finalReport),
    leave_success: opCounts.success || 0,
    leave_failed: opCounts.failed || 0,
  });

  activeRuns.delete(uid);
  onProgress && onProgress(taskId, 'completed', finalReport);
  logger.info(`[DEDUP] Task ${taskId} completed. Success: ${finalReport.leaveSuccess}, Failed: ${finalReport.leaveFailed}, Remaining: ${remainingDupes}`);
};

// ─── Exported API ─────────────────────────────────────────────────────────────

module.exports = {
  startDeduplication,
  isRunning,
  isPaused,
  requestPause,
  requestResume,
  requestStop,
  activeRuns,
};
