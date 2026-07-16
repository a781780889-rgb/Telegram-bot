/**
 * Access Gate — Mandatory Bot Activation
 *
 * Blocks every command, button, and text message for a user until they have
 * an active (non-expired) subscription, granted either by an admin or by
 * redeeming an activation code. This check happens as a `bot.use()`
 * middleware, i.e. before ANY handler runs — commands, callback buttons, and
 * plain text all pass through it first, so there is no route in the bot that
 * can be reached without first satisfying this check. Admins are exempt so
 * they can always manage the bot (including generating activation codes).
 *
 * All decisions are made from data read fresh from the database on every
 * single update — there is no caching of "is this user allowed in" — so a
 * code being disabled/deleted/expired, or a subscription expiring, takes
 * effect on the very next message from that user.
 */

const { subscriberQueries } = require('../database/subscriptionsDb');
const svc = require('./subscriptionsService');
const wiz = require('./subscriptionsWizardState');
const kb = require('../utils/subscriptionsKeyboards');
const msg = require('../utils/subscriptionsMessages');
const logger = require('./../utils/logger');

/**
 * Show the "you must activate the bot" screen and put the user into the
 * activation-code text-input step, re-using the exact same wizard step
 * already relied upon by the storefront's own redeem flow.
 * @param {import('telegraf').Context} ctx
 */
const showGateScreen = async (ctx) => {
  const userId = ctx.from.id;
  wiz.startWizard(userId, wiz.STEPS.STORE_REDEEM_CODE, {});

  const text =
    '🔒 *لاستخدام البوت يجب تفعيله أولاً.*\n\n' +
    'أدخل كود التفعيل الذي حصلت عليه لتتمكن من استخدام جميع خدمات البوت.\n\n' +
    '🔑 أرسل الكود الآن كرسالة نصية:';

  try {
    // Always a *fresh* message for the gate screen (never editMessageText),
    // so it can never be silently dismissed by editing an older message,
    // and it always appears at the bottom of the chat where the user is.
    await ctx.reply(text, { parse_mode: 'Markdown', ...kb.subCancelKeyboard() });
  } catch (error) {
    logger.error('accessGate.showGateScreen error:', error);
  }

  // Always acknowledge callback queries so Telegram doesn't show a loading
  // spinner on the button the user tapped while blocked.
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery('🔒 يجب تفعيل البوت أولاً', { show_alert: true }).catch(() => {});
  }
};

/**
 * The gate middleware itself. Registered with bot.use() before every command
 * / action / text handler in index.js.
 */
const accessGate = async (ctx, next) => {
  // Only gate real end-user interactions in private chats; never touch
  // updates without a `from` (e.g. channel posts) to avoid crashing on them.
  if (!ctx.from || ctx.chat?.type !== 'private') {
    return next();
  }

  const userId = ctx.from.id;

  // Admins always pass — otherwise they could lock themselves out of the
  // very panel used to create/manage activation codes.
  if (svc.isAdmin(userId)) {
    return next();
  }

  // The Cancel button and the activation-code text step must always be
  // reachable, or a gated user could never actually redeem a code.
  const isCancelAction = ctx.callbackQuery?.data === 'sub_cancel';
  const isStoreRedeemStartAction = ctx.callbackQuery?.data === 'sub_store_redeem';
  if (isCancelAction || isStoreRedeemStartAction) {
    return next();
  }

  const subscriber = subscriberQueries.getByTelegramId(userId);

  if (svc.isAccessActive(subscriber)) {
    return next();
  }

  // If the user is mid-way through entering their activation code, let the
  // text pass straight through to the redeem handler instead of re-showing
  // the gate screen on top of itself.
  const wizardState = wiz.getWizardState(userId);
  if (ctx.message?.text && wizardState.step === wiz.STEPS.STORE_REDEEM_CODE) {
    return next();
  }

  await showGateScreen(ctx);
  // Deliberately do NOT call next() — nothing downstream runs for a
  // non-activated, non-admin user.
};

module.exports = { accessGate, showGateScreen };
