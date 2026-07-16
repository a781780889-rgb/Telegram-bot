/**
 * Join-to-Links Handler
 * Handles all callbacks and text inputs for the 🔗 قسم الانضمام للروابط section
 */

const https = require('https');
const logger = require('../utils/logger');
const { accountQueries } = require('../database/db');
const {
  joinGroupQueries,
  joinLinkQueries,
  joinAccountQueries,
  joinSettingsQueries,
  joinLogQueries,
} = require('../database/joinDb');
const joinService = require('../services/joinService');
const wizardState = require('../services/joinWizardState');
const { WIZARD_STEPS } = require('../services/joinWizardState');

const {
  joinMenuKeyboard,
  joinAccountsListKeyboard,
  joinAccountDetailKeyboard,
  joinAddLinksKeyboard,
  joinAddLinksResultKeyboard,
  joinStartConfirmKeyboard,
  joinRunningKeyboard,
  joinStatisticsKeyboard,
  joinNeedsApprovalKeyboard,
  joinCleanupConfirmKeyboard,
  joinSettingsKeyboard,
  joinSettingsTimingKeyboard,
  joinSettingsBreaksKeyboard,
  joinSettingsLimitsKeyboard,
  joinSettingsRetryKeyboard,
  joinSettingsProtectionKeyboard,
  joinSettingsBackKeyboard,
  joinBackKeyboard,
} = require('../utils/joinKeyboards');

const {
  joinMenuMessage,
  joinNoAccountsMessage,
  joinAccountsListMessage,
  joinAccountDetailMessage,
  joinAddLinksPromptMessage,
  joinAddLinksResultMessage,
  joinFileWrongTypeMessage,
  joinFileTooLargeMessage,
  joinFileEmptyMessage,
  joinFileReadErrorMessage,
  joinStartConfirmMessage,
  joinNoPendingLinksMessage,
  joinNoAvailableAccountsMessage,
  joinAlreadyRunningMessage,
  joinQueueDisabledMessage,
  joinStartedMessage,
  joinStoppedMessage,
  joinStatisticsMessage,
  joinNoNeedsApprovalMessage,
  joinNeedsApprovalMessage,
  joinApprovalDecidedMessage,
  joinCleanupConfirmMessage,
  joinCleanupNothingToDoMessage,
  joinCleanupDoneMessage,
  joinNoBannedAccountsMessage,
  joinBannedAccountsMessage,
  joinNoLogsMessage,
  joinLogsMessage,
  joinSettingsHubMessage,
  joinSettingsTimingMessage,
  joinSettingsBreaksMessage,
  joinSettingsLimitsMessage,
  joinSettingsRetryMessage,
  joinSettingsProtectionMessage,
  joinEditPromptMessages,
} = require('../utils/joinMessages');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safeEdit = async (ctx, text, extra = {}) => {
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, extra);
    } else {
      await ctx.reply(text, extra);
    }
  } catch (_) {
    try {
      await ctx.reply(text, extra);
    } catch (err) {
      logger.error('safeEdit fallback error:', err);
    }
  }
};

const ack = async (ctx) => {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (_) {}
};

const userId = (ctx) => String(ctx.from.id);

/** Working / stopped / temporarily-banned / hit-limit counts for the dashboard. */
const computeAccountCounts = (joinAccounts) => {
  const counts = { working: 0, stopped: 0, banned: 0, full: 0 };
  for (const acc of joinAccounts) {
    if (!acc.enabled) { counts.stopped++; continue; }
    if (acc.state === 'banned' || acc.state === 'resting') { counts.banned++; continue; }
    if (acc.state === 'full' || acc.state === 'needs_login') { counts.full++; continue; }
    counts.working++;
  }
  return counts;
};

// ─── Main Menu ────────────────────────────────────────────────────────────────

const handleJoinMenu = async (ctx) => {
  try {
    wizardState.resetWizard(userId(ctx));
    await safeEdit(ctx, joinMenuMessage, { parse_mode: 'Markdown', ...joinMenuKeyboard() });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinMenu error:', error);
  }
};

// ─── Accounts Management ──────────────────────────────────────────────────────

const handleJoinAccountsMenu = async (ctx) => {
  try {
    const uid = userId(ctx);
    const accounts = accountQueries.getAllByUserId(uid);

    if (!accounts.length) {
      await safeEdit(ctx, joinNoAccountsMessage, { parse_mode: 'Markdown', ...joinBackKeyboard() });
      await ack(ctx);
      return;
    }

    // Ensure every account has a join_accounts row so it shows in the list.
    for (const acc of accounts) {
      joinAccountQueries.ensure(uid, acc.id);
    }
    const joinAccounts = joinAccountQueries.getAllByUserId(uid);

    await safeEdit(ctx, joinAccountsListMessage, {
      parse_mode: 'Markdown',
      ...joinAccountsListKeyboard(joinAccounts),
    });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinAccountsMenu error:', error);
  }
};

const handleJoinAccountDetail = async (ctx, accountId) => {
  try {
    const uid = userId(ctx);
    const joinAcc = joinAccountQueries.ensure(uid, accountId);
    const account = accountQueries.getById(accountId);
    const merged = {
      ...joinAcc,
      first_name: account?.first_name,
      last_name: account?.last_name,
      phone: account?.phone,
    };

    await safeEdit(ctx, joinAccountDetailMessage(merged), {
      parse_mode: 'Markdown',
      ...joinAccountDetailKeyboard(accountId, !!joinAcc.enabled),
    });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinAccountDetail error:', error);
  }
};

const handleJoinAccountEnable = async (ctx, accountId) => {
  const uid = userId(ctx);
  joinAccountQueries.setEnabled(uid, accountId, true);
  await handleJoinAccountDetail(ctx, accountId);
};

const handleJoinAccountDisable = async (ctx, accountId) => {
  const uid = userId(ctx);
  joinAccountQueries.setEnabled(uid, accountId, false);
  await handleJoinAccountDetail(ctx, accountId);
};

// ─── Add Links ────────────────────────────────────────────────────────────────

const handleJoinAddLinks = async (ctx) => {
  try {
    const uid = userId(ctx);
    wizardState.setWizardState(uid, { step: WIZARD_STEPS.AWAITING_LINKS });
    await safeEdit(ctx, joinAddLinksPromptMessage, {
      parse_mode: 'Markdown',
      ...joinAddLinksKeyboard(),
    });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinAddLinks error:', error);
  }
};

const handleJoinLinksTextInput = async (ctx) => {
  const uid = userId(ctx);
  const text = ctx.message?.text || '';

  try {
    const { links, invalidCount } = joinService.extractLinksFromText(text);
    let inserted = 0;
    let duplicateSkipped = 0;

    if (links.length) {
      ({ inserted, duplicateSkipped } = joinLinkQueries.insertMany(uid, links));
    }

    wizardState.resetWizard(uid);
    if (inserted) joinService.notifyLinksAdded(uid);

    await ctx.reply(joinAddLinksResultMessage(inserted, invalidCount, duplicateSkipped), {
      parse_mode: 'Markdown',
      ...joinAddLinksResultKeyboard(),
    });
  } catch (error) {
    logger.error('handleJoinLinksTextInput error:', error);
    await ctx.reply('⚠️ حدث خطأ أثناء معالجة الروابط. حاول مرة أخرى.');
  }
};

const MAX_LINKS_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

/**
 * Download a Telegram file URL into a UTF-8 string in memory.
 * Uses Node's built-in https module — no new dependency required.
 * @param {string} url
 * @returns {Promise<string>}
 */
const downloadFileAsText = (url) => {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP_${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_LINKS_FILE_SIZE) {
            reject(new Error('FILE_TOO_LARGE'));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      })
      .on('error', reject);
  });
};

/**
 * Called from index.js's bot.on('document', ...) when the user is in the
 * AWAITING_LINKS wizard step and sends a file instead of typing links.
 * Only .txt files are accepted; content is parsed with the same
 * extractLinksFromText() used for pasted text, so dedup/validation rules
 * are identical for both input methods.
 */
const handleJoinLinksFileInput = async (ctx) => {
  const uid = userId(ctx);
  const doc = ctx.message?.document;

  try {
    if (!doc) return;

    const fileName = doc.file_name || '';
    const isTxt = /\.txt$/i.test(fileName) || doc.mime_type === 'text/plain';
    if (!isTxt) {
      await ctx.reply(joinFileWrongTypeMessage, { parse_mode: 'Markdown' });
      return;
    }

    if (doc.file_size && doc.file_size > MAX_LINKS_FILE_SIZE) {
      await ctx.reply(joinFileTooLargeMessage, { parse_mode: 'Markdown' });
      return;
    }

    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const content = await downloadFileAsText(fileLink.href);

    const { links, invalidCount } = joinService.extractLinksFromText(content);

    if (!links.length) {
      await ctx.reply(joinFileEmptyMessage, { parse_mode: 'Markdown' });
      return;
    }

    const { inserted, duplicateSkipped } = joinLinkQueries.insertMany(uid, links);
    wizardState.resetWizard(uid);
    if (inserted) joinService.notifyLinksAdded(uid);

    await ctx.reply(joinAddLinksResultMessage(inserted, invalidCount, duplicateSkipped), {
      parse_mode: 'Markdown',
      ...joinAddLinksResultKeyboard(),
    });
  } catch (error) {
    logger.error('handleJoinLinksFileInput error:', error);
    await ctx.reply(joinFileReadErrorMessage, { parse_mode: 'Markdown' });
  }
};

/**
 * Whether the given user is currently in the AWAITING_LINKS step and thus
 * an incoming document should be routed to handleJoinLinksFileInput.
 * @param {string} uid
 */
const isAwaitingLinksFile = (uid) => {
  const wiz = wizardState.getWizardState(uid);
  return wiz.step === WIZARD_STEPS.AWAITING_LINKS;
};

// ─── Start / Stop ─────────────────────────────────────────────────────────────

const availableAccountIdsFor = (uid) => {
  // Make sure every one of the user's actual Telegram accounts has a
  // join_accounts row before filtering — otherwise an account that was
  // added but never opened via "👤 إدارة حسابات الانضمام" would be
  // invisible here and incorrectly reported as unavailable.
  const accounts = accountQueries.getAllByUserId(uid);
  for (const acc of accounts) {
    joinAccountQueries.ensure(uid, acc.id);
  }
  return joinAccountQueries.getAllByUserId(uid)
    .filter((a) => a.enabled && a.account_status === 'connected' && a.state !== 'banned' && a.state !== 'full')
    .map((a) => a.account_id);
};

const handleJoinStart = async (ctx) => {
  try {
    const uid = userId(ctx);

    if (joinService.isRunning(uid)) {
      await safeEdit(ctx, joinAlreadyRunningMessage, {
        parse_mode: 'Markdown',
        ...joinRunningKeyboard(),
      });
      await ack(ctx);
      return;
    }

    const linkStats = joinLinkQueries.countByStatus(uid);
    if (!linkStats.pending) {
      await safeEdit(ctx, joinNoPendingLinksMessage, { parse_mode: 'Markdown', ...joinBackKeyboard() });
      await ack(ctx);
      return;
    }

    const availableAccountIds = availableAccountIdsFor(uid);
    if (!availableAccountIds.length) {
      await safeEdit(ctx, joinNoAvailableAccountsMessage, {
        parse_mode: 'Markdown',
        ...joinBackKeyboard(),
      });
      await ack(ctx);
      return;
    }

    await safeEdit(ctx, joinStartConfirmMessage(linkStats.pending, availableAccountIds.length), {
      parse_mode: 'Markdown',
      ...joinStartConfirmKeyboard(),
    });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinStart error:', error);
  }
};

const handleJoinStartConfirm = async (ctx) => {
  try {
    const uid = userId(ctx);
    const availableAccountIds = availableAccountIdsFor(uid);
    const result = await joinService.startJoinRun(uid, availableAccountIds);

    if (!result.started) {
      const messages = {
        already_running: joinAlreadyRunningMessage,
        no_pending_links: joinNoPendingLinksMessage,
        no_available_accounts: joinNoAvailableAccountsMessage,
        queue_disabled: joinQueueDisabledMessage,
      };
      await safeEdit(ctx, messages[result.reason] || '⚠️ تعذر بدء العملية.', {
        parse_mode: 'Markdown',
        ...joinBackKeyboard(),
      });
      await ack(ctx);
      return;
    }

    await safeEdit(ctx, joinStartedMessage(result.accountsUsed, result.queued), {
      parse_mode: 'Markdown',
      ...joinRunningKeyboard(),
    });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinStartConfirm error:', error);
  }
};

const handleJoinStop = async (ctx) => {
  try {
    const uid = userId(ctx);
    joinService.stopJoinRun(uid);
    await safeEdit(ctx, joinStoppedMessage, { parse_mode: 'Markdown', ...joinBackKeyboard() });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinStop error:', error);
  }
};

// ─── Statistics / Performance Dashboard ────────────────────────────────────────

const handleJoinStatistics = async (ctx) => {
  try {
    const uid = userId(ctx);
    const linkStats = joinLinkQueries.countByStatus(uid);
    const groupsCount = joinGroupQueries.countByUserId(uid);
    const running = joinService.isRunning(uid);
    const accountCounts = computeAccountCounts(joinAccountQueries.getAllByUserId(uid));
    const perf = joinLogQueries.getPerformanceStats(uid);

    await safeEdit(ctx, joinStatisticsMessage(linkStats, groupsCount, running, accountCounts, perf), {
      parse_mode: 'Markdown',
      ...joinStatisticsKeyboard(running),
    });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinStatistics error:', error);
  }
};

// ─── Needs-approval review ─────────────────────────────────────────────────────

const handleJoinNeedsApproval = async (ctx) => {
  try {
    const uid = userId(ctx);
    const links = joinLinkQueries.getNeedsApproval(uid, 8);
    if (!links.length) {
      await safeEdit(ctx, joinNoNeedsApprovalMessage, { parse_mode: 'Markdown', ...joinBackKeyboard() });
    } else {
      await safeEdit(ctx, joinNeedsApprovalMessage(links), {
        parse_mode: 'Markdown',
        ...joinNeedsApprovalKeyboard(links),
      });
    }
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinNeedsApproval error:', error);
  }
};

const handleJoinApprovalDecision = async (ctx, linkId, accepted) => {
  try {
    const link = joinLinkQueries.getById(linkId);
    if (link && link.status === 'needs_approval') {
      joinLinkQueries.decideApproval(linkId, accepted);
      if (accepted && link.telegram_id) {
        const uid = userId(ctx);
        joinGroupQueries.register(uid, link.telegram_id, null, link.assigned_account_id, link.url, { source: 'join' });
      }
    }
    await ctx.reply(joinApprovalDecidedMessage(accepted));
    await handleJoinNeedsApproval(ctx);
  } catch (error) {
    logger.error('handleJoinApprovalDecision error:', error);
  }
};

const handleJoinApproveLink = (ctx, linkId) => handleJoinApprovalDecision(ctx, linkId, true);
const handleJoinRejectLink = (ctx, linkId) => handleJoinApprovalDecision(ctx, linkId, false);

// ─── Cleanup ──────────────────────────────────────────────────────────────────

const handleJoinCleanup = async (ctx) => {
  try {
    const uid = userId(ctx);
    const stats = joinLinkQueries.countByStatus(uid);
    const count = stats.invalid + stats.expired + stats.private + stats.rejected + stats.failed_privacy + stats.failed;

    if (!count) {
      await safeEdit(ctx, joinCleanupNothingToDoMessage, { parse_mode: 'Markdown', ...joinBackKeyboard() });
    } else {
      await safeEdit(ctx, joinCleanupConfirmMessage(count), {
        parse_mode: 'Markdown',
        ...joinCleanupConfirmKeyboard(),
      });
    }
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinCleanup error:', error);
  }
};

const handleJoinCleanupConfirm = async (ctx) => {
  try {
    const uid = userId(ctx);
    const count = joinLinkQueries.softDeleteTerminal(uid);
    await safeEdit(ctx, joinCleanupDoneMessage(count), { parse_mode: 'Markdown', ...joinBackKeyboard() });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinCleanupConfirm error:', error);
  }
};

// ─── Banned Accounts ──────────────────────────────────────────────────────────

const handleJoinBannedAccounts = async (ctx) => {
  try {
    const uid = userId(ctx);
    const joinAccounts = joinAccountQueries.getAllByUserId(uid);
    const banned = joinAccounts.filter((a) => a.state === 'banned' || a.state === 'needs_login');

    if (!banned.length) {
      await safeEdit(ctx, joinNoBannedAccountsMessage, { parse_mode: 'Markdown', ...joinBackKeyboard() });
    } else {
      await safeEdit(ctx, joinBannedAccountsMessage(banned), {
        parse_mode: 'Markdown',
        ...joinBackKeyboard(),
      });
    }
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinBannedAccounts error:', error);
  }
};

// ─── Logs ─────────────────────────────────────────────────────────────────────

const handleJoinLogs = async (ctx) => {
  try {
    const uid = userId(ctx);
    const logs = joinLogQueries.getRecentByUserId(uid, 25);

    if (!logs.length) {
      await safeEdit(ctx, joinNoLogsMessage, { parse_mode: 'Markdown', ...joinBackKeyboard() });
    } else {
      await safeEdit(ctx, joinLogsMessage(logs), { parse_mode: 'Markdown', ...joinBackKeyboard() });
    }
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinLogs error:', error);
  }
};

// ─── Settings ─────────────────────────────────────────────────────────────────

const SECTION_RENDERERS = {
  timing: (s) => [joinSettingsTimingMessage(s), joinSettingsTimingKeyboard()],
  breaks: (s) => [joinSettingsBreaksMessage(s), joinSettingsBreaksKeyboard()],
  limits: (s) => [joinSettingsLimitsMessage(s), joinSettingsLimitsKeyboard()],
  retry: (s) => [joinSettingsRetryMessage(s), joinSettingsRetryKeyboard(s)],
  protection: (s) => [joinSettingsProtectionMessage(s), joinSettingsProtectionKeyboard(s)],
};

const sendSettingsSection = async (ctx, uid, section, asReply) => {
  const settings = joinSettingsQueries.get(uid);
  const renderer = SECTION_RENDERERS[section] || SECTION_RENDERERS.timing;
  const [text, keyboard] = renderer(settings);
  if (asReply) {
    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  } else {
    await safeEdit(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  }
};

const handleJoinSettings = async (ctx) => {
  try {
    await safeEdit(ctx, joinSettingsHubMessage, { parse_mode: 'Markdown', ...joinSettingsKeyboard() });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinSettings error:', error);
  }
};

const handleJoinSettingsSection = async (ctx, section) => {
  try {
    await sendSettingsSection(ctx, userId(ctx), section, false);
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinSettingsSection error:', error);
  }
};

const TOGGLE_SECTION = {
  retry_enabled: 'retry',
  smart_protection_enabled: 'protection',
  auto_distribute: 'protection',
  queue_enabled: 'protection',
};

const handleJoinToggleSetting = async (ctx, key) => {
  try {
    if (!TOGGLE_SECTION[key]) return;
    const uid = userId(ctx);
    const settings = joinSettingsQueries.get(uid);
    joinSettingsQueries.update(uid, { [key]: settings[key] ? 0 : 1 });
    await sendSettingsSection(ctx, uid, TOGGLE_SECTION[key], false);
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinToggleSetting error:', error);
  }
};

/** callback-data suffix (e.g. "join_edit_<key>") → wizard step */
const SETTINGS_STEP_MAP = {
  batch_size: WIZARD_STEPS.AWAITING_BATCH_SIZE,
  join_delay_range: WIZARD_STEPS.AWAITING_JOIN_DELAY_RANGE,
  rest_range: WIZARD_STEPS.AWAITING_REST_RANGE,
  max_joins: WIZARD_STEPS.AWAITING_MAX_JOINS,
  max_joins_hour: WIZARD_STEPS.AWAITING_MAX_JOINS_HOUR,
  max_joins_day: WIZARD_STEPS.AWAITING_MAX_JOINS_DAY,
  max_joins_session: WIZARD_STEPS.AWAITING_MAX_JOINS_SESSION,
  max_retries: WIZARD_STEPS.AWAITING_MAX_RETRIES,
  retry_delay: WIZARD_STEPS.AWAITING_RETRY_DELAY,
};

/** wizard step → { keys: [dbColumn...], type: 'single'|'range', allowZero, section } */
const STEP_TO_SETTING = {
  [WIZARD_STEPS.AWAITING_BATCH_SIZE]: { keys: ['batch_size'], type: 'single', section: 'breaks' },
  [WIZARD_STEPS.AWAITING_JOIN_DELAY_RANGE]: { keys: ['join_delay_min_seconds', 'join_delay_max_seconds'], type: 'range', section: 'timing' },
  [WIZARD_STEPS.AWAITING_REST_RANGE]: { keys: ['rest_min_seconds', 'rest_max_seconds'], type: 'range', section: 'breaks' },
  [WIZARD_STEPS.AWAITING_MAX_JOINS]: { keys: ['max_joins_per_account'], type: 'single', section: 'limits' },
  [WIZARD_STEPS.AWAITING_MAX_JOINS_HOUR]: { keys: ['max_joins_per_hour'], type: 'single', allowZero: true, section: 'limits' },
  [WIZARD_STEPS.AWAITING_MAX_JOINS_DAY]: { keys: ['max_joins_per_day'], type: 'single', allowZero: true, section: 'limits' },
  [WIZARD_STEPS.AWAITING_MAX_JOINS_SESSION]: { keys: ['max_joins_per_session'], type: 'single', allowZero: true, section: 'limits' },
  [WIZARD_STEPS.AWAITING_MAX_RETRIES]: { keys: ['max_retries'], type: 'single', allowZero: true, section: 'retry' },
  [WIZARD_STEPS.AWAITING_RETRY_DELAY]: { keys: ['retry_delay_seconds'], type: 'single', section: 'retry' },
};

const handleJoinEditSetting = async (ctx, key) => {
  try {
    const uid = userId(ctx);
    const step = SETTINGS_STEP_MAP[key];
    if (!step) return;
    wizardState.setWizardState(uid, { step });
    await safeEdit(ctx, joinEditPromptMessages[key], {
      parse_mode: 'Markdown',
      ...joinSettingsBackKeyboard(),
    });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinEditSetting error:', error);
  }
};

const handleJoinSettingsTextInput = async (ctx) => {
  const uid = userId(ctx);
  const wiz = wizardState.getWizardState(uid);
  const spec = STEP_TO_SETTING[wiz.step];
  if (!spec) return;

  const text = (ctx.message?.text || '').trim();

  if (spec.type === 'range') {
    const match = text.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) {
      await ctx.reply('⚠️ الصيغة غير صحيحة. أرسل رقمين مفصولين بشرطة، مثال: `20-45`', { parse_mode: 'Markdown' });
      return;
    }
    let min = parseInt(match[1], 10);
    let max = parseInt(match[2], 10);
    if (min <= 0 || max <= 0) {
      await ctx.reply('⚠️ يجب أن تكون القيم أكبر من صفر.');
      return;
    }
    if (min > max) [min, max] = [max, min];
    joinSettingsQueries.update(uid, { [spec.keys[0]]: min, [spec.keys[1]]: max });
  } else {
    const value = parseInt(text, 10);
    const minAllowed = spec.allowZero ? 0 : 1;
    if (isNaN(value) || value < minAllowed) {
      await ctx.reply(
        spec.allowZero ? '⚠️ يرجى إدخال رقم صحيح (0 أو أكبر).' : '⚠️ يرجى إدخال رقم صحيح أكبر من صفر.'
      );
      return;
    }
    joinSettingsQueries.update(uid, { [spec.keys[0]]: value });
  }

  wizardState.resetWizard(uid);
  await sendSettingsSection(ctx, uid, spec.section, true);
};

// ─── Text Input Router ────────────────────────────────────────────────────────

/**
 * Called from textRouter when the user is in a join-wizard text-input step.
 */
const handleJoinTextInput = async (ctx) => {
  const uid = userId(ctx);
  const wiz = wizardState.getWizardState(uid);

  if (wiz.step === WIZARD_STEPS.AWAITING_LINKS) {
    return handleJoinLinksTextInput(ctx);
  }
  if (STEP_TO_SETTING[wiz.step]) {
    return handleJoinSettingsTextInput(ctx);
  }
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  handleJoinMenu,
  handleJoinAccountsMenu,
  handleJoinAccountDetail,
  handleJoinAccountEnable,
  handleJoinAccountDisable,
  handleJoinAddLinks,
  handleJoinLinksFileInput,
  isAwaitingLinksFile,
  handleJoinStart,
  handleJoinStartConfirm,
  handleJoinStop,
  handleJoinStatistics,
  handleJoinNeedsApproval,
  handleJoinApproveLink,
  handleJoinRejectLink,
  handleJoinCleanup,
  handleJoinCleanupConfirm,
  handleJoinBannedAccounts,
  handleJoinLogs,
  handleJoinSettings,
  handleJoinSettingsSection,
  handleJoinToggleSetting,
  handleJoinEditSetting,
  handleJoinTextInput,
};
