/**
 * Subscriptions — Subscribers Handler (👤 إدارة المشتركين)
 */

const {
  subscriberQueries, subscriberHistoryQueries, packageQueries, operationsLogQueries, settingsQueries,
} = require('../database/subscriptionsDb');
const wiz = require('../services/subscriptionsWizardState');
const svc = require('../services/subscriptionsService');
const kb = require('../utils/subscriptionsKeyboards');
const msg = require('../utils/subscriptionsMessages');
const logger = require('../utils/logger');

const PAGE_SIZE = 8;

// Lightweight per-admin UI state (current filter/page) — not a wizard flow, just view state.
const listView = new Map(); // userId -> { filter, page }
const getView = (userId) => listView.get(String(userId)) || { filter: 'all', page: 1 };
const setView = (userId, patch) => listView.set(String(userId), { ...getView(userId), ...patch });

const actorName = (ctx) => ctx.from.first_name || ctx.from.username || String(ctx.from.id);
const tgShim = (ctx) => ({ telegram: ctx.telegram });

// ─── List / Filter / Detail ────────────────────────────────────────────────────

const handleSubscribersList = async (ctx) => {
  try {
    const userId = ctx.from.id;
    const view = getView(userId);
    const status = view.filter === 'all' ? null : view.filter;
    const result = subscriberQueries.getPage({ status, page: view.page, pageSize: PAGE_SIZE });

    if (!result.total) {
      await svc.safeEdit(ctx, msg.subrNoSubscribersMessage, kb.subrListKeyboard([], 1, 1, view.filter));
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      return;
    }

    await svc.safeEdit(
      ctx,
      msg.subrListHeaderMessage(result.total, msg.FILTER_LABELS[view.filter]),
      kb.subrListKeyboard(result.rows, result.page, result.totalPages, view.filter)
    );
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleSubscribersList error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleSubscribersPage = async (ctx) => {
  setView(ctx.from.id, { page: parseInt(ctx.match[1], 10) });
  return handleSubscribersList(ctx);
};

const handleSubscribersFilter = async (ctx) => {
  setView(ctx.from.id, { filter: ctx.match[1], page: 1 });
  return handleSubscribersList(ctx);
};

const handleSubscriberView = async (ctx, id) => {
  try {
    const subscriber = subscriberQueries.getById(id);
    if (!subscriber) {
      await ctx.answerCbQuery(msg.subrNotFoundMessage);
      return handleSubscribersList(ctx);
    }
    const pkg = subscriber.package_id ? packageQueries.getById(subscriber.package_id) : null;
    await svc.safeEdit(ctx, msg.subrDetailMessage(subscriber, pkg), kb.subrDetailKeyboard(subscriber));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleSubscriberView error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Actions dispatcher ─────────────────────────────────────────────────────────

const handleSubscriberAction = async (ctx) => {
  const action = ctx.match[1];
  const id = parseInt(ctx.match[2], 10);

  try {
    const subscriber = subscriberQueries.getById(id);
    if (!subscriber) {
      await ctx.answerCbQuery(msg.subrNotFoundMessage);
      return handleSubscribersList(ctx);
    }
    const uid = subscriber.telegram_user_id;

    switch (action) {
      case 'changepkg': {
        const packages = packageQueries.getAllActive();
        await svc.safeEdit(ctx, msg.subrChangePackagePromptMessage, kb.packagePickerKeyboard(packages, `sub_subr_setpkg_${id}`, `sub_subr_view_${id}`));
        await ctx.answerCbQuery();
        return;
      }

      case 'extend': {
        await svc.safeEdit(ctx, msg.subrExtendPromptMessage, kb.subrExtendKeyboard(id));
        await ctx.answerCbQuery();
        return;
      }

      case 'renew': {
        if (!subscriber.package_id) {
          await ctx.answerCbQuery('⚠️ لا توجد باقة');
          await svc.safeEdit(ctx, msg.subrNoPackageForRenewMessage, kb.subrDetailKeyboard(subscriber));
          return;
        }
        const pkg = packageQueries.getById(subscriber.package_id);
        const newExpiry = svc.calculateExpiryDate(pkg.duration_days);
        subscriberQueries.activate(uid, pkg.id, newExpiry);
        subscriberHistoryQueries.add(uid, 'renewed', pkg.id, ctx.from.id);
        operationsLogQueries.log({
          actionType: 'subscriber_renewed', actorId: ctx.from.id, actorName: actorName(ctx),
          targetType: 'subscriber', targetId: uid, details: { package: pkg.name },
        });
        const settings = settingsQueries.getAll();
        if (settings.notify_payment_success === '1') {
          await svc.notifySubscriber(tgShim(ctx), uid, `♻️ ${svc.renderTemplate(settings.renewal_message, { name: subscriber.first_name || '' })}`);
        }
        await svc.safeEdit(ctx, msg.subrRenewedMessage(pkg.name, newExpiry), kb.subrDetailKeyboard(subscriberQueries.getById(id)));
        await ctx.answerCbQuery('✅ تم التجديد');
        return;
      }

      case 'suspend': {
        subscriberQueries.setStatus(uid, 'suspended');
        subscriberHistoryQueries.add(uid, 'suspended', subscriber.package_id, ctx.from.id);
        operationsLogQueries.log({ actionType: 'subscriber_suspended', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'subscriber', targetId: uid });
        await svc.safeEdit(ctx, msg.subrSuspendedMessage, kb.subrDetailKeyboard(subscriberQueries.getById(id)));
        await ctx.answerCbQuery();
        return;
      }

      case 'reactivate': {
        subscriberQueries.setStatus(uid, 'active');
        subscriberHistoryQueries.add(uid, 'reactivated', subscriber.package_id, ctx.from.id);
        operationsLogQueries.log({ actionType: 'subscriber_reactivated', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'subscriber', targetId: uid });
        await svc.safeEdit(ctx, msg.subrReactivatedMessage, kb.subrDetailKeyboard(subscriberQueries.getById(id)));
        await ctx.answerCbQuery();
        return;
      }

      case 'cancel': {
        const name = subscriber.first_name || subscriber.telegram_user_id;
        await svc.safeEdit(ctx, msg.subrConfirmCancelMessage(name), kb.subrConfirmCancelKeyboard(id));
        await ctx.answerCbQuery();
        return;
      }

      case 'cancelyes': {
        subscriberQueries.cancel(uid);
        subscriberHistoryQueries.add(uid, 'cancelled', subscriber.package_id, ctx.from.id);
        operationsLogQueries.log({ actionType: 'subscriber_cancelled', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'subscriber', targetId: uid });
        await svc.safeEdit(ctx, msg.subrCancelledMessage, kb.subrDetailKeyboard(subscriberQueries.getById(id)));
        await ctx.answerCbQuery('🗑 تم الإلغاء');
        return;
      }

      case 'autorenew': {
        subscriberQueries.toggleAutoRenew(uid);
        const updated = subscriberQueries.getById(id);
        await svc.safeEdit(ctx, msg.subrAutoRenewToggledMessage(!!updated.auto_renew), kb.subrDetailKeyboard(updated));
        await ctx.answerCbQuery();
        return;
      }

      case 'msg': {
        wiz.startWizard(ctx.from.id, wiz.STEPS.SUBR_MESSAGE, { subscriberId: id, telegramUserId: uid });
        await svc.safeEdit(ctx, msg.subrMessagePromptMessage, kb.subCancelKeyboard());
        await ctx.answerCbQuery();
        return;
      }

      case 'notes': {
        wiz.startWizard(ctx.from.id, wiz.STEPS.SUBR_NOTES, { subscriberId: id, telegramUserId: uid });
        await svc.safeEdit(ctx, `📝 الملاحظة الحالية: ${subscriber.notes || 'لا توجد'}\n\nأدخل الملاحظة الجديدة:`, kb.subCancelKeyboard());
        await ctx.answerCbQuery();
        return;
      }

      case 'history': {
        const history = subscriberHistoryQueries.getByTelegramId(uid);
        await svc.safeEdit(ctx, msg.subrHistoryMessage(subscriber, history), kb.subrHistoryKeyboard(id));
        await ctx.answerCbQuery();
        return;
      }

      default:
        await ctx.answerCbQuery();
    }
  } catch (error) {
    logger.error('handleSubscriberAction error:', error);
    await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Change package execution ──────────────────────────────────────────────────

/** sub_subr_setpkg_(\d+)_(\d+) */
const handleSubscriberSetPackage = async (ctx) => {
  const id = parseInt(ctx.match[1], 10);
  const pkgId = parseInt(ctx.match[2], 10);

  try {
    const subscriber = subscriberQueries.getById(id);
    const pkg = packageQueries.getById(pkgId);
    if (!subscriber || !pkg) {
      await ctx.answerCbQuery('⚠️ غير موجود');
      return;
    }
    const uid = subscriber.telegram_user_id;
    const newExpiry = svc.calculateExpiryDate(pkg.duration_days);
    subscriberQueries.activate(uid, pkg.id, newExpiry);
    subscriberHistoryQueries.add(uid, 'package_changed', pkg.id, ctx.from.id);
    operationsLogQueries.log({
      actionType: 'subscriber_package_changed', actorId: ctx.from.id, actorName: actorName(ctx),
      targetType: 'subscriber', targetId: uid, details: { newPackage: pkg.name },
    });

    const settings = settingsQueries.getAll();
    if (settings.notify_package_change === '1') {
      await svc.notifySubscriber(tgShim(ctx), uid, `🔄 تم تغيير باقتك إلى *${pkg.name}*.`);
    }

    await svc.safeEdit(ctx, msg.subrPackageChangedMessage(pkg.name), kb.subrDetailKeyboard(subscriberQueries.getById(id)));
    await ctx.answerCbQuery('✅ تم التغيير');
  } catch (error) {
    logger.error('handleSubscriberSetPackage error:', error);
    await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Extend ─────────────────────────────────────────────────────────────────────

/** sub_subr_extenddays_(\d+)_(\d+) */
const handleSubscriberExtendDays = async (ctx) => {
  const id = parseInt(ctx.match[1], 10);
  const days = parseInt(ctx.match[2], 10);
  return applyExtend(ctx, id, days);
};

/** sub_subr_extendcustom_(\d+) — starts text step for a custom number of days */
const handleSubscriberExtendCustomStart = async (ctx) => {
  const id = parseInt(ctx.match[1], 10);
  wiz.startWizard(ctx.from.id, wiz.STEPS.SUBR_EXTEND_DAYS, { subscriberId: id });
  await svc.safeEdit(ctx, msg.subrExtendCustomPromptMessage, kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

const applyExtend = async (ctx, id, days) => {
  try {
    const subscriber = subscriberQueries.getById(id);
    if (!subscriber) {
      await ctx.answerCbQuery(msg.subrNotFoundMessage);
      return;
    }
    const uid = subscriber.telegram_user_id;
    const base = subscriber.expires_at && new Date(subscriber.expires_at).getTime() > Date.now() ? subscriber.expires_at : null;
    const newExpiry = svc.calculateExpiryDate(days, base);
    subscriberQueries.extend(uid, newExpiry);
    subscriberHistoryQueries.add(uid, 'extended', subscriber.package_id, ctx.from.id, JSON.stringify({ days }));
    operationsLogQueries.log({
      actionType: 'subscriber_extended', actorId: ctx.from.id, actorName: actorName(ctx),
      targetType: 'subscriber', targetId: uid, details: { days },
    });

    await svc.safeEdit(ctx, msg.subrExtendedMessage(days, newExpiry), kb.subrDetailKeyboard(subscriberQueries.getById(id)));
    if (ctx.callbackQuery) await ctx.answerCbQuery('✅ تم التمديد');
  } catch (error) {
    logger.error('applyExtend error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Search ─────────────────────────────────────────────────────────────────────

const handleSubscribersSearchStart = async (ctx) => {
  wiz.startWizard(ctx.from.id, wiz.STEPS.SUBR_SEARCH, {});
  await svc.safeEdit(ctx, msg.subrSearchPromptMessage, kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

// ─── Text input dispatcher ──────────────────────────────────────────────────────

const handleSubscribersTextInput = async (ctx, wizardState) => {
  const { step, data } = wizardState;
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  switch (step) {
    case wiz.STEPS.SUBR_EXTEND_DAYS: {
      const days = parseInt(text, 10);
      if (isNaN(days) || days <= 0) {
        await ctx.reply('⚠️ الرجاء إدخال رقم صحيح أكبر من صفر.', kb.subCancelKeyboard());
        return true;
      }
      wiz.resetWizard(userId);
      await applyExtend(ctx, data.subscriberId, days);
      return true;
    }

    case wiz.STEPS.SUBR_MESSAGE: {
      const sent = await svc.notifySubscriber(tgShim(ctx), data.telegramUserId, text);
      operationsLogQueries.log({
        actionType: 'subscriber_message_sent', actorId: userId, actorName: actorName(ctx),
        targetType: 'subscriber', targetId: data.telegramUserId, status: sent ? 'success' : 'failed',
      });
      wiz.resetWizard(userId);
      await ctx.reply(sent ? msg.subrMessageSentMessage : msg.subrMessageFailedMessage);
      const subscriber = subscriberQueries.getById(data.subscriberId);
      if (subscriber) await ctx.reply(msg.subrDetailMessage(subscriber, subscriber.package_id ? packageQueries.getById(subscriber.package_id) : null), { parse_mode: 'Markdown', ...kb.subrDetailKeyboard(subscriber) });
      return true;
    }

    case wiz.STEPS.SUBR_NOTES: {
      subscriberQueries.setNotes(data.telegramUserId, text.slice(0, 500));
      wiz.resetWizard(userId);
      await ctx.reply('✅ تم حفظ الملاحظة.');
      const subscriber = subscriberQueries.getById(data.subscriberId);
      if (subscriber) await ctx.reply(msg.subrDetailMessage(subscriber, subscriber.package_id ? packageQueries.getById(subscriber.package_id) : null), { parse_mode: 'Markdown', ...kb.subrDetailKeyboard(subscriber) });
      return true;
    }

    case wiz.STEPS.SUBR_SEARCH: {
      wiz.resetWizard(userId);
      const result = subscriberQueries.getPage({ search: text, page: 1, pageSize: PAGE_SIZE });
      setView(userId, { filter: 'all', page: 1 });
      if (!result.total) {
        await ctx.reply(`🔍 لا توجد نتائج مطابقة لـ "${text}".`, kb.subrListKeyboard([], 1, 1, 'all'));
        return true;
      }
      await ctx.reply(`🔍 نتائج البحث عن "${text}" (${result.total}):`, {
        parse_mode: 'Markdown',
        ...kb.subrListKeyboard(result.rows, 1, result.totalPages, 'all'),
      });
      return true;
    }

    default:
      return false;
  }
};

module.exports = {
  handleSubscribersList,
  handleSubscribersPage,
  handleSubscribersFilter,
  handleSubscriberView,
  handleSubscriberAction,
  handleSubscriberSetPackage,
  handleSubscriberExtendDays,
  handleSubscriberExtendCustomStart,
  handleSubscribersSearchStart,
  handleSubscribersTextInput,
};
