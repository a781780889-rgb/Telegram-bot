/**
 * deduplicateMenu.js — معالج قسم 🧹 نظام إزالة المكرر
 *
 * يتكامل مع:
 *  - accountQueries  : للحصول على الحسابات
 *  - deduplicateDb   : حفظ المهام والعمليات
 *  - deduplicateService: المحرك الأساسي
 */

const logger = require('../utils/logger');
const { accountQueries } = require('../database/db');
const {
  taskQueries,
  taskAccountQueries,
  entityQueries,
  operationQueries,
  settingsQueries,
} = require('../database/deduplicateDb');
const deduplicateService = require('../services/deduplicateService');

const {
  deduplicateMenuKeyboard,
  deduplicateSelectAccountsKeyboard,
  deduplicateConfirmKeyboard,
  deduplicateRunningKeyboard,
  deduplicateStopConfirmKeyboard,
  deduplicateCompletedKeyboard,
  deduplicateStatisticsKeyboard,
  deduplicateDuplicatesKeyboard,
  deduplicateLogsKeyboard,
  deduplicateSettingsKeyboard,
  deduplicateReportKeyboard,
} = require('../utils/deduplicateKeyboards');

const {
  deduplicateMenuMessage,
  deduplicateSelectAccountsMessage,
  deduplicateConfirmMessage,
  deduplicateLiveDashboard,
  deduplicateStatisticsMessage,
  deduplicateDuplicatesMessage,
  deduplicateLogsMessage,
  deduplicateSettingsMessage,
  deduplicateReportMessage,
  deduplicateConflictMessage,
  deduplicateNoAccountsMessage,
} = require('../utils/deduplicateMessages');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safeEdit = async (ctx, text, extra = {}) => {
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...extra });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
    }
  } catch (_) {
    try {
      await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
    } catch (err) {
      logger.error('safeEdit error:', err.message);
    }
  }
};

const ack = async (ctx) => {
  try { if (ctx.callbackQuery) await ctx.answerCbQuery(); } catch (_) {}
};

const uid = (ctx) => String(ctx.from.id);

// حالة انتقائية في الذاكرة لاختيار الحسابات
const selectionState = new Map(); // userId → Set<accountId>

const getSelected = (userId) => selectionState.get(userId) || new Set();
const setSelected = (userId, set) => selectionState.set(userId, set);
const clearSelected = (userId) => selectionState.delete(userId);

// ─── القائمة الرئيسية ─────────────────────────────────────────────────────────

const handleDeduplicateMenu = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);
  const activeTask = taskQueries.getActiveByUserId(userId);
  const hasActive = !!activeTask;

  await safeEdit(ctx, deduplicateMenuMessage(activeTask), {
    reply_markup: deduplicateMenuKeyboard(hasActive).reply_markup,
  });
};

// ─── بدء الفحص — اختيار الحسابات ─────────────────────────────────────────────

const handleDeduplicateStartSelect = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);

  const accounts = accountQueries.getAllByUserId(userId);
  if (!accounts || accounts.length === 0) {
    await safeEdit(ctx, deduplicateNoAccountsMessage());
    return;
  }

  // التحقق من وجود مهمة نشطة
  const activeTask = taskQueries.getActiveByUserId(userId);
  if (activeTask) {
    await safeEdit(ctx, deduplicateConflictMessage(activeTask.id), {
      reply_markup: deduplicateMenuKeyboard(true).reply_markup,
    });
    return;
  }

  // إعادة تعيين الاختيار
  clearSelected(userId);

  const selected = getSelected(userId);
  await safeEdit(ctx, deduplicateSelectAccountsMessage(accounts, [...selected]), {
    reply_markup: deduplicateSelectAccountsKeyboard(accounts, [...selected]).reply_markup,
  });
};

// ─── تبديل اختيار حساب ───────────────────────────────────────────────────────

const handleDeduplicateToggleAccount = async (ctx, accountId) => {
  await ack(ctx);
  const userId = uid(ctx);
  const accounts = accountQueries.getAllByUserId(userId);
  const selected = new Set(getSelected(userId));

  if (selected.has(accountId)) {
    selected.delete(accountId);
  } else {
    selected.add(accountId);
  }
  setSelected(userId, selected);

  await safeEdit(ctx, deduplicateSelectAccountsMessage(accounts, [...selected]), {
    reply_markup: deduplicateSelectAccountsKeyboard(accounts, [...selected]).reply_markup,
  });
};

// ─── تحديد/إلغاء الكل ────────────────────────────────────────────────────────

const handleDeduplicateSelectAll = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);
  const accounts = accountQueries.getAllByUserId(userId);
  const selected = new Set(accounts.map((a) => a.id));
  setSelected(userId, selected);

  await safeEdit(ctx, deduplicateSelectAccountsMessage(accounts, [...selected]), {
    reply_markup: deduplicateSelectAccountsKeyboard(accounts, [...selected]).reply_markup,
  });
};

const handleDeduplicateDeselectAll = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);
  const accounts = accountQueries.getAllByUserId(userId);
  clearSelected(userId);

  await safeEdit(ctx, deduplicateSelectAccountsMessage(accounts, []), {
    reply_markup: deduplicateSelectAccountsKeyboard(accounts, []).reply_markup,
  });
};

// ─── تأكيد البدء ─────────────────────────────────────────────────────────────

const handleDeduplicateConfirmStart = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);
  const selected = [...getSelected(userId)];

  if (selected.length === 0) {
    await ctx.answerCbQuery('⚠️ يجب اختيار حساب واحد على الأقل', { show_alert: true });
    return;
  }

  const accounts = accountQueries.getAllByUserId(userId);
  const selectedAccounts = accounts.filter((a) => selected.includes(a.id));

  await safeEdit(ctx, deduplicateConfirmMessage(selected.length, selectedAccounts), {
    reply_markup: deduplicateConfirmKeyboard().reply_markup,
  });
};

// ─── تنفيذ البدء الفعلي ───────────────────────────────────────────────────────

const handleDeduplicateExecuteStart = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);
  const selected = [...getSelected(userId)];

  if (selected.length === 0) {
    await ctx.answerCbQuery('⚠️ لا توجد حسابات محددة', { show_alert: true });
    return;
  }

  let taskId;
  try {
    taskId = await deduplicateService.startDeduplication(
      userId,
      selected,
      (tId, eventType, data) => onProgressCallback(ctx, userId, tId, eventType, data)
    );
  } catch (err) {
    if (err.message.startsWith('CONFLICT:')) {
      const conflictTaskId = err.message.split(':')[1];
      await safeEdit(ctx, deduplicateConflictMessage(conflictTaskId), {
        reply_markup: deduplicateMenuKeyboard(true).reply_markup,
      });
      return;
    }
    logger.error('[DEDUP] Failed to start:', err.message);
    await safeEdit(ctx, `❌ فشل بدء المهمة: ${err.message}`);
    return;
  }

  clearSelected(userId);

  // عرض اللوحة المباشرة
  const task = taskQueries.getById(taskId);
  await safeEdit(ctx, deduplicateLiveDashboard(task, null), {
    reply_markup: deduplicateRunningKeyboard(false).reply_markup,
  });
};

// ─── Callback لتحديثات التقدم ──────────────────────────────────────────────────

const onProgressCallback = async (ctx, userId, taskId, eventType, data) => {
  try {
    if (eventType === 'completed') {
      const task = taskQueries.getById(taskId);
      await ctx.telegram.sendMessage(
        ctx.from.id,
        deduplicateReportMessage(task),
        {
          parse_mode: 'Markdown',
          reply_markup: deduplicateCompletedKeyboard().reply_markup,
        }
      ).catch(() => {});
    } else if (eventType === 'duplicates_found') {
      const settings = settingsQueries.get(userId);
      if (settings.notifications_enabled) {
        await ctx.telegram.sendMessage(
          ctx.from.id,
          `🔔 *تم اكتشاف ${data.count} مجموعة/قناة مكررة بين الحسابات المحددة.*`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    }
  } catch (_) {}
};

// ─── اللوحة المباشرة ──────────────────────────────────────────────────────────

const handleDeduplicateLiveDashboard = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);
  const task = taskQueries.getActiveByUserId(userId) || taskQueries.getLastByUserId(userId);

  if (!task) {
    await safeEdit(ctx, '❌ لا توجد مهمة نشطة.', {
      reply_markup: deduplicateMenuKeyboard(false).reply_markup,
    });
    return;
  }

  const ops = operationQueries.getByTaskId(task.id, 1, 0);
  const lastOp = ops[0] || null;
  const isActive = ['scanning', 'deduplicating'].includes(task.status);
  const isPaused = task.status === 'paused' || deduplicateService.isPaused(userId);

  await safeEdit(ctx, deduplicateLiveDashboard(task, lastOp), {
    reply_markup: isActive || isPaused
      ? deduplicateRunningKeyboard(isPaused).reply_markup
      : deduplicateCompletedKeyboard().reply_markup,
  });
};

// ─── إيقاف مؤقت ──────────────────────────────────────────────────────────────

const handleDeduplicatePause = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);

  if (!deduplicateService.isRunning(userId)) {
    await ctx.answerCbQuery('لا توجد مهمة تعمل حالياً', { show_alert: true });
    return;
  }

  deduplicateService.requestPause(userId);
  const task = taskQueries.getActiveByUserId(userId);
  if (task) taskQueries.updateStatus(task.id, 'paused');

  await safeEdit(ctx, deduplicateLiveDashboard(taskQueries.getById(task?.id), null), {
    reply_markup: deduplicateRunningKeyboard(true).reply_markup,
  });
};

// ─── استكمال ─────────────────────────────────────────────────────────────────

const handleDeduplicateResume = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);

  deduplicateService.requestResume(userId);
  const task = taskQueries.getActiveByUserId(userId) || taskQueries.getLastByUserId(userId);
  if (task && task.status === 'paused') {
    taskQueries.updateStatus(task.id, 'deduplicating');
  }

  await safeEdit(ctx, deduplicateLiveDashboard(task, null), {
    reply_markup: deduplicateRunningKeyboard(false).reply_markup,
  });
};

// ─── تأكيد الإيقاف النهائي ───────────────────────────────────────────────────

const handleDeduplicateStopConfirm = async (ctx) => {
  await ack(ctx);
  await safeEdit(ctx, '⚠️ *هل أنت متأكد من إيقاف عملية إزالة المكرر؟*\n\nستُحفظ جميع العمليات التي تمت.', {
    reply_markup: deduplicateStopConfirmKeyboard().reply_markup,
  });
};

// ─── تنفيذ الإيقاف النهائي ───────────────────────────────────────────────────

const handleDeduplicateStopExecute = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);

  deduplicateService.requestStop(userId);
  const task = taskQueries.getActiveByUserId(userId);
  if (task) {
    taskQueries.updateStatus(task.id, 'stopped', { completed_at: new Date().toISOString() });
  }

  const lastTask = task || taskQueries.getLastByUserId(userId);
  await safeEdit(ctx, deduplicateReportMessage(lastTask), {
    reply_markup: deduplicateCompletedKeyboard().reply_markup,
  });
};

// ─── الإحصائيات ───────────────────────────────────────────────────────────────

const handleDeduplicateStatistics = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);
  const task = taskQueries.getActiveByUserId(userId) || taskQueries.getLastByUserId(userId);
  const opCounts = task ? operationQueries.countByStatus(task.id) : {};

  await safeEdit(ctx, deduplicateStatisticsMessage(task, opCounts), {
    reply_markup: deduplicateStatisticsKeyboard().reply_markup,
  });
};

// ─── المكررات ────────────────────────────────────────────────────────────────

const handleDeduplicateDuplicates = async (ctx, page = 0) => {
  await ack(ctx);
  const userId = uid(ctx);
  const task = taskQueries.getActiveByUserId(userId) || taskQueries.getLastByUserId(userId);

  if (!task) {
    await safeEdit(ctx, '♻️ *المكررات*\n\n_لا توجد بيانات حتى الآن._', {
      reply_markup: deduplicateMenuKeyboard(false).reply_markup,
    });
    return;
  }

  const PAGE_SIZE = 5;
  const duplicates = entityQueries.getDuplicates(task.id);

  await safeEdit(ctx, deduplicateDuplicatesMessage(duplicates, page, PAGE_SIZE), {
    reply_markup: deduplicateDuplicatesKeyboard(task.id, page, duplicates.length, PAGE_SIZE).reply_markup,
  });
};

// ─── سجل العمليات ─────────────────────────────────────────────────────────────

const handleDeduplicateLogs = async (ctx, page = 0) => {
  await ack(ctx);
  const userId = uid(ctx);
  const task = taskQueries.getActiveByUserId(userId) || taskQueries.getLastByUserId(userId);

  if (!task) {
    await safeEdit(ctx, '📋 *سجل العمليات*\n\n_لا توجد عمليات مسجلة._', {
      reply_markup: deduplicateMenuKeyboard(false).reply_markup,
    });
    return;
  }

  const PAGE_SIZE = 8;
  const ops = operationQueries.getByTaskId(task.id, 1000, 0);

  await safeEdit(ctx, deduplicateLogsMessage(ops, page, PAGE_SIZE), {
    reply_markup: deduplicateLogsKeyboard(page, ops.length, PAGE_SIZE).reply_markup,
  });
};

// ─── الإعدادات ────────────────────────────────────────────────────────────────

const handleDeduplicateSettings = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);
  const settings = settingsQueries.get(userId);

  await safeEdit(ctx, deduplicateSettingsMessage(settings), {
    reply_markup: deduplicateSettingsKeyboard().reply_markup,
  });
};

const handleDeduplicateToggleSetting = async (ctx, setting) => {
  await ack(ctx);
  const userId = uid(ctx);
  const settings = settingsQueries.get(userId);

  const toggleMap = {
    notifications: 'notifications_enabled',
    reverify:      'auto_reverify',
    confirm:       'confirm_before_leave',
  };

  const field = toggleMap[setting];
  if (!field) return;

  settingsQueries.update(userId, { [field]: settings[field] ? 0 : 1 });
  const updated = settingsQueries.get(userId);

  await safeEdit(ctx, deduplicateSettingsMessage(updated), {
    reply_markup: deduplicateSettingsKeyboard().reply_markup,
  });
};

// ─── التقرير النهائي ──────────────────────────────────────────────────────────

const handleDeduplicateReport = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);
  const task = taskQueries.getLastByUserId(userId);

  if (!task) {
    await safeEdit(ctx, '📄 لا يوجد تقرير. ابدأ مهمة جديدة أولاً.');
    return;
  }

  await safeEdit(ctx, deduplicateReportMessage(task), {
    reply_markup: deduplicateReportKeyboard().reply_markup,
  });
};

// ─── العمليات الفاشلة ────────────────────────────────────────────────────────

const handleDeduplicateFailedOps = async (ctx) => {
  await ack(ctx);
  const userId = uid(ctx);
  const task = taskQueries.getLastByUserId(userId);

  if (!task) {
    await safeEdit(ctx, '📋 لا توجد عمليات.', { reply_markup: deduplicateMenuKeyboard(false).reply_markup });
    return;
  }

  const failed = operationQueries.getFailedByTaskId(task.id);
  if (failed.length === 0) {
    await safeEdit(ctx, '✅ *لا توجد عمليات فاشلة!*\n\nتمت جميع عمليات الخروج بنجاح.', {
      reply_markup: deduplicateMenuKeyboard(false).reply_markup,
    });
    return;
  }

  let msg = `❌ *العمليات الفاشلة — ${failed.length}*\n\n`;
  for (const op of failed.slice(0, 15)) {
    msg += `• ${op.entity_name || op.entity_id} (حساب #${op.account_id})\n`;
    if (op.error_message) msg += `  ↳ ${op.error_message}\n`;
  }
  if (failed.length > 15) msg += `\n_... و ${failed.length - 15} أخرى_`;

  await safeEdit(ctx, msg, { reply_markup: deduplicateReportKeyboard().reply_markup });
};

module.exports = {
  handleDeduplicateMenu,
  handleDeduplicateStartSelect,
  handleDeduplicateToggleAccount,
  handleDeduplicateSelectAll,
  handleDeduplicateDeselectAll,
  handleDeduplicateConfirmStart,
  handleDeduplicateExecuteStart,
  handleDeduplicateLiveDashboard,
  handleDeduplicatePause,
  handleDeduplicateResume,
  handleDeduplicateStopConfirm,
  handleDeduplicateStopExecute,
  handleDeduplicateStatistics,
  handleDeduplicateDuplicates,
  handleDeduplicateLogs,
  handleDeduplicateSettings,
  handleDeduplicateToggleSetting,
  handleDeduplicateReport,
  handleDeduplicateFailedOps,
};
