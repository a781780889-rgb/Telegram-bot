const logger = require('../utils/logger');
const { validatePhoneNumber, validateOtpCode, sanitizeInput } = require('../utils/validators');
const { accountQueries } = require('../database/db');
const { subscriberQueries } = require('../database/subscriptionsDb');
const subscriptionsService = require('../services/subscriptionsService');
const telegramClient = require('../services/telegramClient');
const sessionState = require('../services/sessionState');
const {
  mainMenuKeyboard,
  cancelKeyboard,
  backToMenuKeyboard,
  retryKeyboard,
} = require('../utils/keyboards');
const {
  phoneRequestMessage,
  otpRequestMessage,
  passwordRequestMessage,
  successMessage,
  errorOtpExpired,
  errorTooManyAttempts,
} = require('../utils/messages');

const MAX_OTP_ATTEMPTS = 3;

/**
 * Handle "add_account" button press
 *
 * Enforces the max-accounts limit granted by the subscriber's activation
 * code (via its package). Admins are exempt (unlimited). A subscriber
 * without an active subscription/package is blocked at 0 by
 * subscriptionsService.getMaxAccountsForUser, but in practice the global
 * accessGate middleware already prevents unactivated users from reaching
 * this handler at all — this check exists specifically to enforce the
 * *count* limit for already-activated users.
 */
const handleAddAccountStart = async (ctx) => {
  try {
    const userId = String(ctx.from.id);

    if (!subscriptionsService.isAdmin(ctx.from.id)) {
      const subscriber = subscriberQueries.getByTelegramId(ctx.from.id);
      const maxAccounts = subscriptionsService.getMaxAccountsForUser(subscriber);
      const currentCount = accountQueries.getAllByUserId(userId).length;

      if (currentCount >= maxAccounts) {
        const text =
          maxAccounts > 0
            ? `🚫 لقد وصلت للحد الأقصى المسموح به من الحسابات (${maxAccounts}) وفقًا لباقتك الحالية.\n\nللتمكن من إضافة المزيد، يرجى تفعيل كود بباقة أعلى.`
            : '🚫 باقتك الحالية لا تسمح بإضافة أي حسابات. يرجى تفعيل كود صالح للحصول على صلاحية إضافة الحسابات.';
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...backToMenuKeyboard() }).catch(async () => {
          await ctx.reply(text, { parse_mode: 'Markdown', ...backToMenuKeyboard() });
        });
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery('🚫 وصلت للحد الأقصى من الحسابات', { show_alert: true }).catch(() => {});
        }
        return;
      }
    }

    sessionState.setAwaitingPhone(userId);

    await ctx.editMessageText(phoneRequestMessage, {
      parse_mode: 'Markdown',
      ...cancelKeyboard(),
    });
  } catch (error) {
    logger.error('handleAddAccountStart error:', error);
    await ctx.reply('حدث خطأ. حاول مرة أخرى.', backToMenuKeyboard());
  }
};

/**
 * Handle phone number input
 */
const handlePhoneInput = async (ctx) => {
  const userId = String(ctx.from.id);
  const rawPhone = sanitizeInput(ctx.message.text);

  const { valid, normalized, error } = validatePhoneNumber(rawPhone);

  if (!valid) {
    await ctx.reply(`❌ ${error}`, cancelKeyboard());
    return;
  }

  // Check if phone already added for this user
  const existing = accountQueries.getByUserIdAndPhone(userId, normalized);
  if (existing && existing.status === 'connected') {
    await ctx.reply(
      `⚠️ هذا الرقم مضاف بالفعل وحالته: متصل.\n\nلإعادة تسجيل الدخول اذهب إلى قائمة الحسابات.`,
      backToMenuKeyboard()
    );
    sessionState.resetState(userId);
    return;
  }

  // Create/update account record in DB
  const accountId = accountQueries.insert(userId, normalized);

  try {
    const sendingMsg = await ctx.reply('⏳ جارٍ إرسال رمز التحقق...', cancelKeyboard());

    await telegramClient.sendOtp(normalized);

    // Update status in DB
    accountQueries.updateStatus(accountId, 'otp_sent');

    // Transition state
    sessionState.setAwaitingOtp(userId, normalized, accountId);

    await ctx.reply(otpRequestMessage(normalized), {
      parse_mode: 'Markdown',
      ...cancelKeyboard(),
    });

    // Delete the "sending..." message
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, sendingMsg.message_id);
    } catch (_) {}
  } catch (error) {
    logger.error('sendOtp error:', error);
    accountQueries.updateStatus(accountId, 'error', {
      error_message: error.message,
    });
    sessionState.resetState(userId);

    const friendlyError = telegramClient.translateTelegramError(error);
    await ctx.reply(`❌ فشل إرسال رمز التحقق\n\n${friendlyError}`, retryKeyboard());
  }
};

/**
 * Handle OTP code input
 */
const handleOtpInput = async (ctx) => {
  const userId = String(ctx.from.id);
  const state = sessionState.getState(userId);
  const rawCode = sanitizeInput(ctx.message.text);

  const { valid, cleaned, error } = validateOtpCode(rawCode);

  if (!valid) {
    await ctx.reply(`❌ ${error}\n\nأدخل الرمز المكون من 5 أرقام:`, cancelKeyboard());
    return;
  }

  // Attempt increment
  sessionState.incrementAttempts(userId);
  const attempts = sessionState.getAttempts(userId);

  if (attempts > MAX_OTP_ATTEMPTS) {
    sessionState.resetState(userId);
    await telegramClient.cleanupPending(state.phone);
    accountQueries.updateStatus(state.accountId, 'error', {
      error_message: 'Max OTP attempts exceeded',
    });
    await ctx.reply(errorTooManyAttempts, retryKeyboard());
    return;
  }

  try {
    const verifyingMsg = await ctx.reply('⏳ جارٍ التحقق من الرمز...');
    const result = await telegramClient.verifyOtp(state.phone, cleaned);

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, verifyingMsg.message_id);
    } catch (_) {}

    if (result.needsPassword) {
      sessionState.setAwaitingPassword(userId, state.phone, state.accountId);
      accountQueries.updateStatus(state.accountId, 'needs_password');
      await ctx.reply(passwordRequestMessage, {
        parse_mode: 'Markdown',
        ...cancelKeyboard(),
      });
      return;
    }

    // Success — save session
    await finalizeLogin(ctx, userId, state.accountId, state.phone, result);
  } catch (error) {
    logger.error('verifyOtp error:', error);

    const friendlyError = telegramClient.translateTelegramError(error);

    if (
      error.message?.includes('PHONE_CODE_EXPIRED') ||
      error.errorMessage === 'PHONE_CODE_EXPIRED'
    ) {
      // Auto-resend
      sessionState.resetState(userId);
      await telegramClient.cleanupPending(state.phone);
      await ctx.reply(errorOtpExpired);

      try {
        await telegramClient.sendOtp(state.phone);
        sessionState.setAwaitingOtp(userId, state.phone, state.accountId);
        await ctx.reply(otpRequestMessage(state.phone), {
          parse_mode: 'Markdown',
          ...cancelKeyboard(),
        });
      } catch (resendError) {
        logger.error('Resend OTP error:', resendError);
        await ctx.reply(
          `❌ فشل إرسال رمز جديد\n\n${telegramClient.translateTelegramError(resendError)}`,
          retryKeyboard()
        );
      }
      return;
    }

    await ctx.reply(
      `❌ رمز التحقق غير صحيح (المحاولة ${attempts}/${MAX_OTP_ATTEMPTS})\n\n${friendlyError}\n\nأعد إدخال الرمز:`,
      cancelKeyboard()
    );
  }
};

/**
 * Handle 2FA password input
 */
const handlePasswordInput = async (ctx) => {
  const userId = String(ctx.from.id);
  const state = sessionState.getState(userId);
  const password = sanitizeInput(ctx.message.text);

  if (!password) {
    await ctx.reply('❌ كلمة المرور لا يمكن أن تكون فارغة. أدخل كلمة المرور:', cancelKeyboard());
    return;
  }

  // Delete the password message immediately for security
  try {
    await ctx.deleteMessage();
  } catch (_) {}

  sessionState.incrementAttempts(userId);
  const attempts = sessionState.getAttempts(userId);

  if (attempts > MAX_OTP_ATTEMPTS) {
    sessionState.resetState(userId);
    await telegramClient.cleanupPending(state.phone);
    accountQueries.updateStatus(state.accountId, 'error', {
      error_message: 'Max password attempts exceeded',
    });
    await ctx.reply(errorTooManyAttempts, retryKeyboard());
    return;
  }

  try {
    const checkingMsg = await ctx.reply('⏳ جارٍ التحقق من كلمة المرور...');
    const result = await telegramClient.verifyPassword(state.phone, password);

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, checkingMsg.message_id);
    } catch (_) {}

    await finalizeLogin(ctx, userId, state.accountId, state.phone, result);
  } catch (error) {
    logger.error('verifyPassword error:', error);
    const friendlyError = telegramClient.translateTelegramError(error);

    await ctx.reply(
      `❌ كلمة المرور غير صحيحة (المحاولة ${attempts}/${MAX_OTP_ATTEMPTS})\n\n${friendlyError}\n\nأعد إدخال كلمة المرور:`,
      cancelKeyboard()
    );
  }
};

/**
 * Finalize login: save session, update DB, show success
 */
const finalizeLogin = async (ctx, userId, accountId, phone, result) => {
  const { userInfo, sessionString, client } = result;

  // Save session encrypted
  const { sessionFile, encryptedSession } = telegramClient.saveSession(
    accountId,
    phone,
    sessionString
  );

  // Update DB with full user info
  accountQueries.updateStatus(accountId, 'connected', {
    first_name: userInfo.firstName,
    last_name: userInfo.lastName,
    username: userInfo.username,
    telegram_id: userInfo.telegramId,
    session_file: sessionFile,
    encrypted_session: encryptedSession,
    error_message: null,
  });

  // Register active client
  telegramClient.registerActiveClient(accountId, client, phone);

  // Reset conversation state
  sessionState.resetState(userId);

  // Fetch fresh account data for display
  const account = accountQueries.getById(accountId);

  await ctx.reply(successMessage(account), {
    parse_mode: 'Markdown',
    ...mainMenuKeyboard(),
  });

  logger.info(`Account ${accountId} (${phone}) successfully connected`);
};

/**
 * Handle cancel button during flow
 */
const handleCancelFlow = async (ctx) => {
  const userId = String(ctx.from.id);
  const state = sessionState.getState(userId);

  if (state.phone) {
    await telegramClient.cleanupPending(state.phone);

    if (state.accountId) {
      accountQueries.updateStatus(state.accountId, 'error', {
        error_message: 'Cancelled by user',
      });
    }
  }

  sessionState.resetState(userId);

  await ctx.editMessageText('❌ تم الإلغاء.\n\nاختر أحد الخيارات:', {
    parse_mode: 'Markdown',
    ...mainMenuKeyboard(),
  });
};

module.exports = {
  handleAddAccountStart,
  handlePhoneInput,
  handleOtpInput,
  handlePasswordInput,
  handleCancelFlow,
};
