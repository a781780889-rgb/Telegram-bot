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
  joinSettingsKeyboard,
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
  joinStartedMessage,
  joinStoppedMessage,
  joinStatisticsMessage,
  joinNoBannedAccountsMessage,
  joinBannedAccountsMessage,
  joinNoLogsMessage,
  joinLogsMessage,
  joinSettingsMessage,
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
    let addedCount = 0;

    if (links.length) {
      addedCount = joinLinkQueries.insertMany(uid, links);
    }

    wizardState.resetWizard(uid);
    await ctx.reply(joinAddLinksResultMessage(addedCount, invalidCount, 0), {
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

    const addedCount = joinLinkQueries.insertMany(uid, links);
    wizardState.resetWizard(uid);

    await ctx.reply(joinAddLinksResultMessage(addedCount, invalidCount, 0), {
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

    const joinAccounts = joinAccountQueries.getAllByUserId(uid);
    const availableAccountIds = joinAccounts
      .filter((a) => a.enabled && a.account_status === 'connected' && a.state !== 'banned' && a.state !== 'full')
      .map((a) => a.account_id);

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
    const joinAccounts = joinAccountQueries.getAllByUserId(uid);
    const availableAccountIds = joinAccounts
      .filter((a) => a.enabled && a.account_status === 'connected' && a.state !== 'banned' && a.state !== 'full')
      .map((a) => a.account_id);

    const result = await joinService.startJoinRun(uid, availableAccountIds);

    if (!result.started) {
      const messages = {
        already_running: joinAlreadyRunningMessage,
        no_pending_links: joinNoPendingLinksMessage,
        no_available_accounts: joinNoAvailableAccountsMessage,
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

// ─── Statistics ───────────────────────────────────────────────────────────────

const handleJoinStatistics = async (ctx) => {
  try {
    const uid = userId(ctx);
    const linkStats = joinLinkQueries.countByStatus(uid);
    const groupsCount = joinGroupQueries.countByUserId(uid);
    const running = joinService.isRunning(uid);

    await safeEdit(ctx, joinStatisticsMessage(linkStats, groupsCount, running), {
      parse_mode: 'Markdown',
      ...(running ? joinRunningKeyboard() : joinBackKeyboard()),
    });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinStatistics error:', error);
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

const handleJoinSettings = async (ctx) => {
  try {
    const uid = userId(ctx);
    const settings = joinSettingsQueries.get(uid);
    await safeEdit(ctx, joinSettingsMessage(settings), {
      parse_mode: 'Markdown',
      ...joinSettingsKeyboard(),
    });
    await ack(ctx);
  } catch (error) {
    logger.error('handleJoinSettings error:', error);
  }
};

const SETTINGS_STEP_MAP = {
  batch_size: WIZARD_STEPS.AWAITING_BATCH_SIZE,
  join_delay_seconds: WIZARD_STEPS.AWAITING_JOIN_DELAY,
  rest_seconds: WIZARD_STEPS.AWAITING_REST_SECONDS,
  max_joins_per_account: WIZARD_STEPS.AWAITING_MAX_JOINS,
};

const handleJoinEditSetting = async (ctx, key) => {
  try {
    const uid = userId(ctx);
    wizardState.setWizardState(uid, { step: SETTINGS_STEP_MAP[key], settingKey: key });
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
  const text = (ctx.message?.text || '').trim();
  const value = parseInt(text, 10);

  if (isNaN(value) || value <= 0) {
    await ctx.reply('⚠️ يرجى إدخال رقم صحيح أكبر من صفر.');
    return;
  }

  joinSettingsQueries.update(uid, { [wiz.settingKey]: value });
  wizardState.resetWizard(uid);

  const settings = joinSettingsQueries.get(uid);
  await ctx.reply(joinSettingsMessage(settings), {
    parse_mode: 'Markdown',
    ...joinSettingsKeyboard(),
  });
};

// ─── Text Input Router ────────────────────────────────────────────────────────

/**
 * Called from textRouter when the user is in a join-wizard text-input step.
 */
const handleJoinTextInput = async (ctx) => {
  const uid = userId(ctx);
  const wiz = wizardState.getWizardState(uid);

  switch (wiz.step) {
    case WIZARD_STEPS.AWAITING_LINKS:
      return handleJoinLinksTextInput(ctx);
    case WIZARD_STEPS.AWAITING_BATCH_SIZE:
    case WIZARD_STEPS.AWAITING_JOIN_DELAY:
    case WIZARD_STEPS.AWAITING_REST_SECONDS:
    case WIZARD_STEPS.AWAITING_MAX_JOINS:
      return handleJoinSettingsTextInput(ctx);
    default:
      break;
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
  handleJoinBannedAccounts,
  handleJoinLogs,
  handleJoinSettings,
  handleJoinEditSetting,
  handleJoinTextInput,
};
