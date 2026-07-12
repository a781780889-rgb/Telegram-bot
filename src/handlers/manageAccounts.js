const logger = require('../utils/logger');
const { accountQueries } = require('../database/db');
const telegramClient = require('../services/telegramClient');
const sessionState = require('../services/sessionState');
const {
  mainMenuKeyboard,
  accountActionsKeyboard,
  confirmDeleteKeyboard,
  backToMenuKeyboard,
  cancelKeyboard,
} = require('../utils/keyboards');
const {
  accountCardMessage,
  noAccountsMessage,
  statusEmoji,
  statusText,
} = require('../utils/messages');
const { maskPhone } = require('../utils/encryption');
const { Markup } = require('telegraf');

/**
 * Show all accounts for the user
 */
const handleListAccounts = async (ctx) => {
  const userId = String(ctx.from.id);

  try {
    const accounts = accountQueries.getAllByUserId(userId);

    if (!accounts.length) {
      const text = noAccountsMessage;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ إضافة حساب', 'add_account')],
        [Markup.button.callback('🔙 القائمة الرئيسية', 'main_menu')],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
      } else {
        await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
      }
      return;
    }

    let headerText = `📋 *قائمة الحسابات* (${accounts.length})\n\n`;
    headerText += accounts
      .map((acc, i) => accountCardMessage(acc, i + 1))
      .join('\n\n');
    headerText += '\n\n*اختر حسابًا لإدارته:*';

    const accountButtons = accounts.map((acc, i) => {
      const emoji = statusEmoji[acc.status] || '⚪️';
      const name =
        [acc.first_name, acc.last_name].filter(Boolean).join(' ') ||
        maskPhone(acc.phone);
      return [
        Markup.button.callback(
          `${emoji} ${i + 1}. ${name.slice(0, 25)}`,
          `account_detail_${acc.id}`
        ),
      ];
    });

    accountButtons.push([
      Markup.button.callback('➕ إضافة حساب', 'add_account'),
      Markup.button.callback('🔙 القائمة', 'main_menu'),
    ]);

    const keyboard = Markup.inlineKeyboard(accountButtons);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(headerText, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
    } else {
      await ctx.reply(headerText, { parse_mode: 'Markdown', ...keyboard });
    }
  } catch (error) {
    logger.error('handleListAccounts error:', error);
    await ctx.reply('حدث خطأ أثناء تحميل الحسابات.', backToMenuKeyboard());
  }
};

/**
 * Show account detail and actions
 */
const handleAccountDetail = async (ctx, accountId) => {
  const userId = String(ctx.from.id);

  try {
    const account = accountQueries.getById(accountId);

    if (!account || String(account.user_id) !== userId) {
      await ctx.answerCbQuery('⚠️ الحساب غير موجود');
      return;
    }

    const emoji = statusEmoji[account.status] || '⚪️';
    const statusLabel = statusText[account.status] || account.status;
    const name =
      [account.first_name, account.last_name].filter(Boolean).join(' ') ||
      'غير محدد';
    const username = account.username ? `@${account.username}` : 'لا يوجد';

    const text =
      `👤 *تفاصيل الحساب*\n\n` +
      `*الاسم:* ${name}\n` +
      `*اسم المستخدم:* ${username}\n` +
      `*الهاتف:* \`${maskPhone(account.phone)}\`\n` +
      `*الحالة:* ${emoji} ${statusLabel}\n` +
      (account.error_message && account.status === 'error'
        ? `*الخطأ:* ${account.error_message.slice(0, 100)}\n`
        : '') +
      `*أُضيف في:* ${new Date(account.created_at).toLocaleDateString('ar-SA')}`;

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...accountActionsKeyboard(account.id, account.status),
    });
  } catch (error) {
    logger.error('handleAccountDetail error:', error);
    await ctx.answerCbQuery('حدث خطأ');
  }
};

/**
 * Check live status of an account
 */
const handleCheckStatus = async (ctx, accountId) => {
  const userId = String(ctx.from.id);

  try {
    await ctx.answerCbQuery('⏳ جارٍ فحص الحالة...');

    const account = accountQueries.getById(accountId);
    if (!account || String(account.user_id) !== userId) return;

    let isAlive = false;

    if (account.session_file) {
      try {
        const client = await telegramClient.loadSession(account.session_file);
        isAlive = true;
        telegramClient.registerActiveClient(accountId, client, account.phone);
        accountQueries.updateStatus(accountId, 'connected', { error_message: null });
      } catch (sessionError) {
        logger.warn(`Session check failed for account ${accountId}:`, sessionError);
        accountQueries.updateStatus(accountId, 'disconnected', {
          error_message: sessionError.message,
        });
      }
    }

    const statusMsg = isAlive
      ? '🟢 الحساب متصل وفعّال'
      : '🔴 الجلسة منتهية أو غير متصلة. يُنصح بإعادة تسجيل الدخول.';

    await ctx.reply(statusMsg, accountActionsKeyboard(accountId, isAlive ? 'connected' : 'disconnected'));
  } catch (error) {
    logger.error('handleCheckStatus error:', error);
    await ctx.reply('حدث خطأ أثناء فحص الحالة.', backToMenuKeyboard());
  }
};

/**
 * Show delete confirmation
 */
const handleDeleteConfirm = async (ctx, accountId) => {
  const userId = String(ctx.from.id);

  try {
    const account = accountQueries.getById(accountId);
    if (!account || String(account.user_id) !== userId) {
      await ctx.answerCbQuery('⚠️ الحساب غير موجود');
      return;
    }

    const name =
      [account.first_name, account.last_name].filter(Boolean).join(' ') ||
      maskPhone(account.phone);

    await ctx.editMessageText(
      `🗑️ *تأكيد الحذف*\n\nهل أنت متأكد من حذف الحساب:\n*${name}*\n\`${maskPhone(account.phone)}\`\n\n⚠️ لا يمكن التراجع عن هذا الإجراء.`,
      {
        parse_mode: 'Markdown',
        ...confirmDeleteKeyboard(accountId),
      }
    );
  } catch (error) {
    logger.error('handleDeleteConfirm error:', error);
    await ctx.answerCbQuery('حدث خطأ');
  }
};

/**
 * Execute account deletion
 */
const handleDeleteAccount = async (ctx, accountId) => {
  const userId = String(ctx.from.id);

  try {
    const account = accountQueries.getById(accountId);
    if (!account || String(account.user_id) !== userId) {
      await ctx.answerCbQuery('⚠️ الحساب غير موجود');
      return;
    }

    // Disconnect active client if any
    await telegramClient.disconnectClient(accountId);

    // Delete session file
    if (account.session_file) {
      telegramClient.deleteSessionFile(account.session_file);
    }

    // Delete from DB
    accountQueries.deleteById(accountId, userId);

    logger.info(`Account ${accountId} deleted by user ${userId}`);

    await ctx.editMessageText(
      '✅ تم حذف الحساب بنجاح.',
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  } catch (error) {
    logger.error('handleDeleteAccount error:', error);
    await ctx.reply('حدث خطأ أثناء الحذف.', backToMenuKeyboard());
  }
};

/**
 * Initiate re-login for an existing account
 */
const handleRelogin = async (ctx, accountId) => {
  const userId = String(ctx.from.id);

  try {
    const account = accountQueries.getById(accountId);
    if (!account || String(account.user_id) !== userId) {
      await ctx.answerCbQuery('⚠️ الحساب غير موجود');
      return;
    }

    // Disconnect if active
    await telegramClient.disconnectClient(accountId);

    // Update status
    accountQueries.updateStatus(accountId, 'connecting', { error_message: null });

    const sendingMsg = await ctx.editMessageText(
      '⏳ جارٍ إرسال رمز التحقق...',
      cancelKeyboard()
    );

    try {
      await telegramClient.sendOtp(account.phone);
      accountQueries.updateStatus(accountId, 'otp_sent');
      sessionState.setAwaitingOtp(userId, account.phone, accountId);

      const { otpRequestMessage } = require('../utils/messages');
      await ctx.reply(otpRequestMessage(account.phone), {
        parse_mode: 'Markdown',
        ...cancelKeyboard(),
      });
    } catch (error) {
      logger.error('Relogin sendOtp error:', error);
      accountQueries.updateStatus(accountId, 'error', { error_message: error.message });
      const friendlyError = telegramClient.translateTelegramError(error);
      await ctx.reply(
        `❌ فشل إرسال رمز التحقق\n\n${friendlyError}`,
        backToMenuKeyboard()
      );
    }
  } catch (error) {
    logger.error('handleRelogin error:', error);
    await ctx.reply('حدث خطأ. حاول مرة أخرى.', backToMenuKeyboard());
  }
};

module.exports = {
  handleListAccounts,
  handleAccountDetail,
  handleCheckStatus,
  handleDeleteConfirm,
  handleDeleteAccount,
  handleRelogin,
};
