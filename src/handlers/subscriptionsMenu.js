/**
 * Subscriptions — Menu Shell (💎 الاشتراكات)
 *
 * The entry point + cross-cutting screens (stats, operations log, alerts,
 * settings) and the central dispatcher that routes free-text wizard input to
 * the right domain handler. Also exports requireAdmin, used in index.js to
 * gate every admin-only route.
 */

const { operationsLogQueries, settingsQueries, statsQueries } = require('../database/subscriptionsDb');
const wiz = require('../services/subscriptionsWizardState');
const svc = require('../services/subscriptionsService');
const kb = require('../utils/subscriptionsKeyboards');
const msg = require('../utils/subscriptionsMessages');
const logger = require('../utils/logger');

const packagesHandler = require('./subscriptionsPackages');
const subscribersHandler = require('./subscriptionsSubscribers');
const paymentsHandler = require('./subscriptionsPayments');
const couponsHandler = require('./subscriptionsCoupons');
const offersHandler = require('./subscriptionsOffers');
const storefrontHandler = require('./subscriptionsStorefront');

const actorName = (ctx) => ctx.from.first_name || ctx.from.username || String(ctx.from.id);

// ─── Admin guard ────────────────────────────────────────────────────────────────

/**
 * Wraps an admin-only handler so it can never run for a non-admin caller,
 * even if triggered directly via a stale/guessed callback_data.
 * @param {Function} handler
 */
const requireAdmin = (handler) => async (ctx, ...args) => {
  if (!svc.isAdmin(ctx.from.id)) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('⛔️ هذا القسم مخصص للمشرفين فقط', { show_alert: true }).catch(() => {});
    } else {
      await ctx.reply(msg.subNoPermissionMessage);
    }
    return;
  }
  return handler(ctx, ...args);
};

// ─── Root menu ──────────────────────────────────────────────────────────────────

const handleSubscriptionsMenu = async (ctx) => {
  try {
    wiz.resetWizard(ctx.from.id);

    if (!svc.isAdmin(ctx.from.id)) {
      await storefrontHandler.handleStoreMenu(ctx);
      return;
    }

    await svc.safeEdit(ctx, msg.subAdminMenuMessage, kb.subAdminMenuKeyboard());
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleSubscriptionsMenu error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleSubCancel = async (ctx) => {
  wiz.resetWizard(ctx.from.id);
  await svc.safeEdit(ctx, msg.cancelledMessage, kb.subBackToMenuKeyboard());
  if (ctx.callbackQuery) await ctx.answerCbQuery();
};

const handleSubNoop = async (ctx) => {
  await ctx.answerCbQuery();
};

// ─── Statistics ─────────────────────────────────────────────────────────────────

const handleSubscriptionsStats = async (ctx) => {
  try {
    const stats = statsQueries.getDashboard();
    await svc.safeEdit(ctx, msg.statsDashboardMessage(stats), kb.statsKeyboard());
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleSubscriptionsStats error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Operations log ─────────────────────────────────────────────────────────────

const handleSubscriptionsLog = async (ctx, page = 1) => {
  try {
    const result = operationsLogQueries.getPage(page, 10);
    if (!result.total) {
      await svc.safeEdit(ctx, msg.logEmptyMessage, kb.subBackToMenuKeyboard());
    } else {
      await svc.safeEdit(ctx, msg.logListMessage(result), kb.logKeyboard(result.page, result.totalPages));
    }
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleSubscriptionsLog error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleSubscriptionsLogPage = (ctx) => handleSubscriptionsLog(ctx, parseInt(ctx.match[1], 10));

// ─── Alerts (quick toggles) ──────────────────────────────────────────────────────

const handleSubscriptionsAlerts = async (ctx) => {
  try {
    const settings = settingsQueries.getAll();
    await svc.safeEdit(ctx, msg.alertsHeaderMessage, kb.alertsKeyboard(settings));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleSubscriptionsAlerts error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

/** sub_alerts_toggle_(\w+) */
const handleAlertsToggle = async (ctx) => {
  const key = ctx.match[1];
  settingsQueries.toggle(key);
  operationsLogQueries.log({ actionType: 'settings_updated', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'settings', targetId: key });
  return handleSubscriptionsAlerts(ctx);
};

// ─── Settings ───────────────────────────────────────────────────────────────────

const handleSubscriptionsSettings = async (ctx) => {
  try {
    const settings = settingsQueries.getAll();
    await svc.safeEdit(ctx, msg.settingsHeaderMessage, kb.settingsKeyboard(settings));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleSubscriptionsSettings error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleSettingsCurrencyMenu = async (ctx) => {
  await svc.safeEdit(ctx, '💱 اختر العملة الافتراضية:', kb.settingsCurrencyKeyboard());
  await ctx.answerCbQuery();
};

/** sub_settings_setcur_(\w+) */
const handleSettingsSetCurrency = async (ctx) => {
  const code = ctx.match[1];
  settingsQueries.set('default_currency', code);
  operationsLogQueries.log({ actionType: 'settings_updated', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'settings', targetId: 'default_currency', details: { value: code } });
  await ctx.answerCbQuery('✅ تم التحديث');
  return handleSubscriptionsSettings(ctx);
};

const handleSettingsTaxStart = async (ctx) => {
  const settings = settingsQueries.getAll();
  wiz.startWizard(ctx.from.id, wiz.STEPS.SET_TAX, {});
  await svc.safeEdit(ctx, msg.settingsTaxPromptMessage(settings.tax_percent), kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

/** sub_settings_msg_(\w+) */
const handleSettingsMessageEditStart = async (ctx) => {
  const key = ctx.match[1];
  const settings = settingsQueries.getAll();
  if (!msg.SETTINGS_MESSAGE_LABELS[key]) {
    await ctx.answerCbQuery('⚠️ غير متاح');
    return;
  }
  wiz.startWizard(ctx.from.id, wiz.STEPS.SET_MESSAGE_EDIT, { settingKey: key });
  await svc.safeEdit(ctx, msg.settingsMessageEditPromptMessage(key, settings[key]), kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

/** sub_settings_toggle_(\w+) */
const handleSettingsToggle = async (ctx) => {
  const key = ctx.match[1];
  settingsQueries.toggle(key);
  operationsLogQueries.log({ actionType: 'settings_updated', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'settings', targetId: key });
  await ctx.answerCbQuery();
  return handleSubscriptionsSettings(ctx);
};

const handleSettingsTextInput = async (ctx, wizardState) => {
  const { step, data } = wizardState;
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  if (step === wiz.STEPS.SET_TAX) {
    const val = parseFloat(text.replace(',', '.'));
    if (isNaN(val) || val < 0 || val > 100) {
      await ctx.reply(msg.settingsTaxInvalidMessage, kb.subCancelKeyboard());
      return true;
    }
    settingsQueries.set('tax_percent', val);
    operationsLogQueries.log({ actionType: 'settings_updated', actorId: userId, actorName: actorName(ctx), targetType: 'settings', targetId: 'tax_percent', details: { value: val } });
    wiz.resetWizard(userId);
    await ctx.reply(msg.settingsUpdatedMessage);
    await ctx.reply(msg.settingsHeaderMessage, { parse_mode: 'Markdown', ...kb.settingsKeyboard(settingsQueries.getAll()) });
    return true;
  }

  if (step === wiz.STEPS.SET_MESSAGE_EDIT) {
    const key = data.settingKey;
    settingsQueries.set(key, text.slice(0, 1000));
    operationsLogQueries.log({ actionType: 'settings_updated', actorId: userId, actorName: actorName(ctx), targetType: 'settings', targetId: key });
    wiz.resetWizard(userId);
    await ctx.reply(msg.settingsUpdatedMessage);
    await ctx.reply(msg.settingsHeaderMessage, { parse_mode: 'Markdown', ...kb.settingsKeyboard(settingsQueries.getAll()) });
    return true;
  }

  return false;
};

// ─── Central text-input dispatcher (called from middlewares/textRouter.js) ────

/**
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<boolean>} true if a subscriptions wizard consumed this text message
 */
const handleSubscriptionsTextInput = async (ctx) => {
  const userId = ctx.from.id;
  const wizardState = wiz.getWizardState(userId);
  const { step } = wizardState;

  if (step === wiz.STEPS.IDLE) return false;

  if (wizardState.timedOut) {
    await ctx.reply('⌛️ انتهت مهلة العملية. ابدأ من جديد.', kb.subBackToMenuKeyboard());
    return true;
  }

  try {
    if (step.startsWith('PKG_')) return await packagesHandler.handlePackagesTextInput(ctx, wizardState);
    if (step.startsWith('SUBR_')) return await subscribersHandler.handleSubscribersTextInput(ctx, wizardState);
    if (step.startsWith('PAY_')) return await paymentsHandler.handlePaymentsTextInput(ctx, wizardState);
    if (step.startsWith('CPN_')) return await couponsHandler.handleCouponsTextInput(ctx, wizardState);
    if (step.startsWith('OFR_')) return await offersHandler.handleOffersTextInput(ctx, wizardState);
    if (step.startsWith('SET_')) return await handleSettingsTextInput(ctx, wizardState);
    if (step.startsWith('STORE_')) return await storefrontHandler.handleStorefrontTextInput(ctx, wizardState);
  } catch (error) {
    logger.error('handleSubscriptionsTextInput dispatch error:', error);
    wiz.resetWizard(userId);
    await ctx.reply('⚠️ حدث خطأ غير متوقع، تم إلغاء العملية الحالية.', kb.subBackToMenuKeyboard());
    return true;
  }

  return false;
};

module.exports = {
  requireAdmin,
  handleSubscriptionsMenu,
  handleSubCancel,
  handleSubNoop,
  handleSubscriptionsStats,
  handleSubscriptionsLog,
  handleSubscriptionsLogPage,
  handleSubscriptionsAlerts,
  handleAlertsToggle,
  handleSubscriptionsSettings,
  handleSettingsCurrencyMenu,
  handleSettingsSetCurrency,
  handleSettingsTaxStart,
  handleSettingsMessageEditStart,
  handleSettingsToggle,
  handleSubscriptionsTextInput,
  // re-exported so index.js has a single place to import every subscriptions handler from
  packagesHandler,
  subscribersHandler,
  paymentsHandler,
  couponsHandler,
  offersHandler,
  storefrontHandler,
};
