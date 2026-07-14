/**
 * Subscriptions — Payments Handler (💳 إدارة المدفوعات)
 */

const {
  paymentQueries, subscriberQueries, subscriberHistoryQueries, packageQueries,
  couponQueries, couponUseQueries, operationsLogQueries, settingsQueries,
} = require('../database/subscriptionsDb');
const wiz = require('../services/subscriptionsWizardState');
const svc = require('../services/subscriptionsService');
const kb = require('../utils/subscriptionsKeyboards');
const msg = require('../utils/subscriptionsMessages');
const logger = require('../utils/logger');

const PAGE_SIZE = 8;

const listView = new Map(); // userId -> { filter, page }
const getView = (userId) => listView.get(String(userId)) || { filter: 'all', page: 1 };
const setView = (userId, patch) => listView.set(String(userId), { ...getView(userId), ...patch });

const actorName = (ctx) => ctx.from.first_name || ctx.from.username || String(ctx.from.id);
const tgShim = (ctx) => ({ telegram: ctx.telegram });

// ─── List / Filter / Detail ────────────────────────────────────────────────────

const handlePaymentsList = async (ctx) => {
  try {
    const userId = ctx.from.id;
    const view = getView(userId);
    const status = view.filter === 'all' ? null : view.filter;
    const result = paymentQueries.getPage({ status, page: view.page, pageSize: PAGE_SIZE });

    if (!result.total) {
      await svc.safeEdit(ctx, msg.payNoPaymentsMessage, kb.payListKeyboard([], 1, 1, view.filter));
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      return;
    }

    await svc.safeEdit(
      ctx,
      msg.payListHeaderMessage(result.total, msg.PAY_FILTER_LABELS[view.filter]),
      kb.payListKeyboard(result.rows, result.page, result.totalPages, view.filter)
    );
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handlePaymentsList error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handlePaymentsPage = async (ctx) => {
  setView(ctx.from.id, { page: parseInt(ctx.match[1], 10) });
  return handlePaymentsList(ctx);
};

const handlePaymentsFilter = async (ctx) => {
  setView(ctx.from.id, { filter: ctx.match[1], page: 1 });
  return handlePaymentsList(ctx);
};

const handlePaymentView = async (ctx, id) => {
  try {
    const payment = paymentQueries.getById(id);
    if (!payment) {
      await ctx.answerCbQuery('⚠️ العملية غير موجودة');
      return handlePaymentsList(ctx);
    }
    await svc.safeEdit(ctx, msg.payDetailMessage(payment), kb.payDetailKeyboard(payment));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handlePaymentView error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Accept ─────────────────────────────────────────────────────────────────────

const acceptPayment = async (ctx, paymentId) => {
  const payment = paymentQueries.getById(paymentId);
  if (!payment || payment.status !== 'pending') {
    await ctx.answerCbQuery('⚠️ لا يمكن قبول هذه العملية');
    return;
  }
  const pkg = packageQueries.getById(payment.package_id);
  if (!pkg) {
    await ctx.answerCbQuery('⚠️ الباقة غير موجودة');
    return;
  }

  const uid = payment.telegram_user_id;
  const existing = subscriberQueries.getByTelegramId(uid);
  const wasActive = existing?.status === 'active';

  paymentQueries.updateStatus(paymentId, 'accepted', ctx.from.id);

  const newExpiry = svc.calculateExpiryDate(pkg.duration_days);
  subscriberQueries.activate(uid, pkg.id, newExpiry);
  subscriberHistoryQueries.add(uid, wasActive ? 'renewed' : 'subscribed', pkg.id, ctx.from.id, JSON.stringify({ paymentId }));

  if (payment.coupon_id) {
    couponQueries.incrementUse(payment.coupon_id);
    couponUseQueries.add(payment.coupon_id, uid, paymentId);
    operationsLogQueries.log({
      actionType: 'coupon_used', actorId: uid, actorRole: 'subscriber', actorName: payment.username,
      targetType: 'coupon', targetId: payment.coupon_id, details: { code: payment.coupon_code },
    });
  }

  operationsLogQueries.log({
    actionType: 'payment_accepted', actorId: ctx.from.id, actorName: actorName(ctx),
    targetType: 'payment', targetId: paymentId, details: { reference: payment.reference_code, amount: payment.amount },
  });

  const settings = settingsQueries.getAll();
  if (settings.notify_payment_success === '1') {
    await svc.notifySubscriber(tgShim(ctx), uid, msg.payAcceptedMessage(payment) + `\n\n${svc.renderTemplate(settings.welcome_message, { name: '' })}`);
  }

  await svc.safeEdit(ctx, msg.payAcceptedMessage(payment), kb.payDetailKeyboard(paymentQueries.getById(paymentId)));
  if (ctx.callbackQuery) await ctx.answerCbQuery('✅ تم القبول والتفعيل');
};

// ─── Reject ─────────────────────────────────────────────────────────────────────

const finalizeReject = async (ctx, paymentId, reason) => {
  const payment = paymentQueries.getById(paymentId);
  if (!payment || payment.status !== 'pending') {
    if (ctx.callbackQuery) await ctx.answerCbQuery('⚠️ لا يمكن رفض هذه العملية');
    return;
  }
  paymentQueries.updateStatus(paymentId, 'rejected', ctx.from.id, reason || null);
  operationsLogQueries.log({
    actionType: 'payment_rejected', actorId: ctx.from.id, actorName: actorName(ctx),
    targetType: 'payment', targetId: paymentId, reason, details: { reference: payment.reference_code },
  });

  const settings = settingsQueries.getAll();
  if (settings.notify_payment_failed === '1') {
    const text = msg.payRejectedMessage(payment) + (reason ? `\n\nالسبب: ${reason}` : '');
    await svc.notifySubscriber(tgShim(ctx), payment.telegram_user_id, text);
  }

  await svc.safeEdit(ctx, msg.payRejectedMessage(payment), kb.payDetailKeyboard(paymentQueries.getById(paymentId)));
  if (ctx.callbackQuery) await ctx.answerCbQuery('❌ تم الرفض');
};

// ─── Refund ─────────────────────────────────────────────────────────────────────

const refundPayment = async (ctx, paymentId) => {
  const payment = paymentQueries.getById(paymentId);
  if (!payment || payment.status !== 'accepted') {
    await ctx.answerCbQuery('⚠️ لا يمكن استرداد هذه العملية');
    return;
  }
  paymentQueries.updateStatus(paymentId, 'refunded', ctx.from.id);
  operationsLogQueries.log({
    actionType: 'payment_refunded', actorId: ctx.from.id, actorName: actorName(ctx),
    targetType: 'payment', targetId: paymentId, details: { reference: payment.reference_code, amount: payment.amount },
  });
  await svc.safeEdit(ctx, msg.payRefundedMessage(payment), kb.payDetailKeyboard(paymentQueries.getById(paymentId)));
  await ctx.answerCbQuery('↩️ تم الاسترداد');
};

// ─── Action dispatcher ──────────────────────────────────────────────────────────

/** sub_pay_(view|accept|reject|rejectnow|refund|refundyes)_(\d+) */
const handlePaymentAction = async (ctx) => {
  const action = ctx.match[1];
  const id = parseInt(ctx.match[2], 10);

  try {
    const payment = paymentQueries.getById(id);
    if (!payment) {
      await ctx.answerCbQuery('⚠️ العملية غير موجودة');
      return handlePaymentsList(ctx);
    }

    switch (action) {
      case 'accept':
        return acceptPayment(ctx, id);

      case 'reject': {
        wiz.startWizard(ctx.from.id, wiz.STEPS.PAY_REJECT_REASON, { paymentId: id });
        await svc.safeEdit(ctx, msg.payRejectReasonPromptMessage, kb.paySkipReasonKeyboard(id));
        await ctx.answerCbQuery();
        return;
      }

      case 'rejectnow': {
        wiz.resetWizard(ctx.from.id);
        return finalizeReject(ctx, id, null);
      }

      case 'refund': {
        await svc.safeEdit(ctx, msg.payConfirmRefundMessage(payment), kb.payConfirmRefundKeyboard(id));
        await ctx.answerCbQuery();
        return;
      }

      case 'refundyes':
        return refundPayment(ctx, id);

      default:
        await ctx.answerCbQuery();
    }
  } catch (error) {
    logger.error('handlePaymentAction error:', error);
    await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Search ─────────────────────────────────────────────────────────────────────

const handlePaymentsSearchStart = async (ctx) => {
  wiz.startWizard(ctx.from.id, wiz.STEPS.PAY_SEARCH, {});
  await svc.safeEdit(ctx, msg.paySearchPromptMessage, kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

// ─── Text input dispatcher ──────────────────────────────────────────────────────

const handlePaymentsTextInput = async (ctx, wizardState) => {
  const { step, data } = wizardState;
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  switch (step) {
    case wiz.STEPS.PAY_REJECT_REASON: {
      wiz.resetWizard(userId);
      await finalizeReject(ctx, data.paymentId, text.slice(0, 300));
      return true;
    }

    case wiz.STEPS.PAY_SEARCH: {
      wiz.resetWizard(userId);
      const result = paymentQueries.getPage({ search: text, page: 1, pageSize: PAGE_SIZE });
      setView(userId, { filter: 'all', page: 1 });
      if (!result.total) {
        await ctx.reply(`🔍 لا توجد نتائج مطابقة لـ "${text}".`, kb.payListKeyboard([], 1, 1, 'all'));
        return true;
      }
      await ctx.reply(`🔍 نتائج البحث عن "${text}" (${result.total}):`, {
        parse_mode: 'Markdown',
        ...kb.payListKeyboard(result.rows, 1, result.totalPages, 'all'),
      });
      return true;
    }

    default:
      return false;
  }
};

module.exports = {
  handlePaymentsList,
  handlePaymentsPage,
  handlePaymentsFilter,
  handlePaymentView,
  handlePaymentAction,
  handlePaymentsSearchStart,
  handlePaymentsTextInput,
};
