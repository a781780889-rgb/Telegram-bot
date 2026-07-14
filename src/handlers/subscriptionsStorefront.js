/**
 * Subscriptions — Storefront Handler (subscriber-facing side of 💎 الاشتراكات)
 */

const {
  packageQueries, subscriberQueries, subscriberHistoryQueries, paymentQueries, offerQueries,
  activationCodeQueries, activationCodeUseQueries, operationsLogQueries, settingsQueries,
} = require('../database/subscriptionsDb');
const wiz = require('../services/subscriptionsWizardState');
const svc = require('../services/subscriptionsService');
const kb = require('../utils/subscriptionsKeyboards');
const msg = require('../utils/subscriptionsMessages');
const logger = require('../utils/logger');

const ensureSubscriber = (ctx) => subscriberQueries.ensure(ctx.from.id, ctx.from.username, ctx.from.first_name);

// ─── Menu / My subscription ────────────────────────────────────────────────────

const handleStoreMenu = async (ctx) => {
  try {
    ensureSubscriber(ctx);
    const settings = settingsQueries.getAll();
    const noAdmin = !svc.hasAnyAdminConfigured();
    await svc.safeEdit(ctx, msg.storeMenuMessage(settings.welcome_message, ctx.from.id, noAdmin), kb.subStoreMenuKeyboard());
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleStoreMenu error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleStoreMySubscription = async (ctx) => {
  try {
    const subscriber = ensureSubscriber(ctx);
    if (!subscriber.package_id || subscriber.status === 'none' || subscriber.status === 'cancelled') {
      await svc.safeEdit(ctx, msg.storeNoSubscriptionMessage, kb.subStorePackagesKeyboard(packageQueries.getAllActive()));
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      return;
    }
    const pkg = packageQueries.getById(subscriber.package_id);
    await svc.safeEdit(ctx, msg.storeMySubscriptionMessage(subscriber, pkg), kb.subStoreBackKeyboard());
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleStoreMySubscription error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Browse packages ────────────────────────────────────────────────────────────

const handleStorePackages = async (ctx) => {
  try {
    const packages = packageQueries.getAllActive();
    if (!packages.length) {
      await svc.safeEdit(ctx, msg.storeNoPackagesMessage, kb.subStoreBackKeyboard());
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      return;
    }
    await svc.safeEdit(ctx, msg.storePackagesHeaderMessage, kb.subStorePackagesKeyboard(packages));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleStorePackages error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleStorePackageView = async (ctx, pkgId) => {
  try {
    const pkg = packageQueries.getById(pkgId);
    if (!pkg || !pkg.is_active || pkg.is_deleted) {
      await ctx.answerCbQuery('⚠️ هذه الباقة غير متاحة حاليًا');
      return handleStorePackages(ctx);
    }
    const priceInfo = svc.applyOfferToPrice(pkg);
    await svc.safeEdit(ctx, msg.storePackageDetailMessage(pkg, priceInfo), kb.subStorePackageDetailKeyboard(pkgId));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleStorePackageView error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Subscribe flow ─────────────────────────────────────────────────────────────

const handleStoreSubscribeStart = async (ctx) => {
  const pkgId = parseInt(ctx.match[1], 10);
  try {
    const pkg = packageQueries.getById(pkgId);
    if (!pkg || !pkg.is_active || pkg.is_deleted) {
      await ctx.answerCbQuery('⚠️ هذه الباقة غير متاحة حاليًا');
      return;
    }
    const pending = paymentQueries.getPendingForUserAndPackage(ctx.from.id, pkgId);
    if (pending) {
      await svc.safeEdit(ctx, msg.storeAlreadyPendingMessage(pending), kb.subStoreBackKeyboard());
      await ctx.answerCbQuery();
      return;
    }
    await svc.safeEdit(ctx, msg.storeCouponPromptMessage, kb.subStoreCouponPromptKeyboard(pkgId));
    await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleStoreSubscribeStart error:', error);
    await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleStoreCouponYes = async (ctx) => {
  const pkgId = parseInt(ctx.match[1], 10);
  wiz.startWizard(ctx.from.id, wiz.STEPS.STORE_COUPON_CODE, { packageId: pkgId });
  await svc.safeEdit(ctx, msg.storeCouponEnterMessage, kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

const handleStoreCouponNo = async (ctx) => {
  const pkgId = parseInt(ctx.match[1], 10);
  return showConfirmScreen(ctx, pkgId, null);
};

const showConfirmScreen = async (ctx, pkgId, couponCode) => {
  const pkg = packageQueries.getById(pkgId);
  if (!pkg) {
    if (ctx.callbackQuery) await ctx.answerCbQuery('⚠️ الباقة غير موجودة');
    return;
  }
  const priceInfo = svc.applyOfferToPrice(pkg);
  let couponResult = null;
  if (couponCode) {
    couponResult = svc.validateAndApplyCoupon(couponCode, { userId: ctx.from.id, packageId: pkgId, price: priceInfo.finalPrice });
    if (!couponResult.valid) {
      await ctx.reply(msg.storeCouponInvalidMessage(couponResult.reason), kb.subStoreCouponPromptKeyboard(pkgId));
      return;
    }
    await ctx.reply(msg.storeCouponAppliedMessage(couponResult, pkg.currency));
  }

  wiz.startWizard(ctx.from.id, wiz.STEPS.STORE_REVIEW, { packageId: pkgId, couponCode: couponResult?.valid ? couponCode : null });
  const finalPrice = couponResult?.valid ? couponResult.finalPrice : priceInfo.finalPrice;

  await svc.safeEdit(ctx, msg.storeConfirmMessage(pkg, finalPrice, couponResult), kb.subStoreConfirmKeyboard(pkgId));
  if (ctx.callbackQuery) await ctx.answerCbQuery();
};

/** sub_store_confirm_(\d+) */
const handleStoreConfirm = async (ctx) => {
  const pkgId = parseInt(ctx.match[1], 10);
  const userId = ctx.from.id;

  try {
    const { data } = wiz.getWizardState(userId);
    if (data.packageId !== pkgId) {
      await ctx.answerCbQuery('⚠️ انتهت صلاحية هذا الطلب، ابدأ من جديد');
      return handleStorePackageView(ctx, pkgId);
    }

    const pkg = packageQueries.getById(pkgId);
    if (!pkg || !pkg.is_active) {
      await ctx.answerCbQuery('⚠️ الباقة غير متاحة');
      return;
    }

    const pending = paymentQueries.getPendingForUserAndPackage(userId, pkgId);
    if (pending) {
      wiz.resetWizard(userId);
      await svc.safeEdit(ctx, msg.storeAlreadyPendingMessage(pending), kb.subStoreBackKeyboard());
      await ctx.answerCbQuery();
      return;
    }

    const priceInfo = svc.applyOfferToPrice(pkg);
    let couponResult = null;
    if (data.couponCode) {
      couponResult = svc.validateAndApplyCoupon(data.couponCode, { userId, packageId: pkgId, price: priceInfo.finalPrice });
    }
    const finalPrice = couponResult?.valid ? couponResult.finalPrice : priceInfo.finalPrice;

    const payment = paymentQueries.create({
      telegram_user_id: userId,
      username: ctx.from.username,
      package_id: pkg.id,
      package_name: pkg.name,
      amount: finalPrice,
      original_amount: pkg.price,
      currency: pkg.currency,
      coupon_code: couponResult?.valid ? couponResult.coupon.code : null,
      coupon_id: couponResult?.valid ? couponResult.coupon.id : null,
      discount_amount: (pkg.price - finalPrice),
    });

    operationsLogQueries.log({
      actionType: 'payment_accepted', actorId: userId, actorRole: 'subscriber', actorName: ctx.from.username,
      targetType: 'payment', targetId: payment.id, status: 'success',
      details: { reference: payment.reference_code, note: 'طلب جديد بانتظار مراجعة الإدارة' },
    });

    wiz.resetWizard(userId);
    ensureSubscriber(ctx);

    const settings = settingsQueries.getAll();
    if (settings.notify_admin_on_new_payment === '1') {
      await svc.notifyAdmins({ telegram: ctx.telegram }, msg.adminNewPaymentNotification(paymentQueries.getById(payment.id)));
    }

    await svc.safeEdit(ctx, msg.storeRequestCreatedMessage(payment), kb.subStoreBackKeyboard());
    await ctx.answerCbQuery('✅ تم الإرسال');
  } catch (error) {
    logger.error('handleStoreConfirm error:', error);
    await ctx.answerCbQuery('حدث خطأ أثناء إرسال الطلب').catch(() => {});
  }
};

// ─── Redeem an activation code (🔑 لدي كود تفعيل) ──────────────────────────────

const handleStoreRedeemStart = async (ctx) => {
  wiz.startWizard(ctx.from.id, wiz.STEPS.STORE_REDEEM_CODE, {});
  await svc.safeEdit(ctx, msg.storeRedeemPromptMessage, kb.subCancelKeyboard());
  if (ctx.callbackQuery) await ctx.answerCbQuery();
};

const redeemActivationCode = async (ctx, rawCode) => {
  const userId = ctx.from.id;
  const result = svc.validateActivationCode(rawCode);

  if (!result.valid) {
    await ctx.reply(msg.storeRedeemInvalidMessage(result.reason), kb.subCancelKeyboard());
    return; // wizard step stays active so the subscriber can just try another code
  }

  const { codeRow } = result;
  const pkg = packageQueries.getById(codeRow.package_id);
  if (!pkg || !pkg.is_active) {
    await ctx.reply(msg.storeRedeemInvalidMessage('الباقة المرتبطة بهذا الكود لم تعد متاحة.'), kb.subCancelKeyboard());
    return;
  }

  wiz.resetWizard(userId);
  ensureSubscriber(ctx);

  const existing = subscriberQueries.getByTelegramId(userId);
  const wasActive = existing?.status === 'active';
  const newExpiry = svc.calculateExpiryDate(pkg.duration_days);

  subscriberQueries.activate(userId, pkg.id, newExpiry);
  subscriberHistoryQueries.add(userId, wasActive ? 'renewed' : 'subscribed', pkg.id, userId, JSON.stringify({ activationCode: codeRow.code }));

  activationCodeQueries.incrementUse(codeRow.id);
  activationCodeUseQueries.add(codeRow.id, userId);

  const payment = paymentQueries.create({
    telegram_user_id: userId,
    username: ctx.from.username,
    package_id: pkg.id,
    package_name: pkg.name,
    amount: pkg.price,
    original_amount: pkg.price,
    currency: pkg.currency,
    payment_method: 'activation_code',
  });
  paymentQueries.updateStatus(payment.id, 'accepted', null, `تفعيل ذاتي عبر كود: ${codeRow.code}`);

  operationsLogQueries.log({
    actionType: 'activation_code_redeemed', actorId: userId, actorRole: 'subscriber', actorName: ctx.from.username,
    targetType: 'activation_code', targetId: codeRow.id, details: { code: codeRow.code, package: pkg.name },
  });

  const settings = settingsQueries.getAll();
  if (settings.notify_admin_on_new_payment === '1') {
    await svc.notifyAdmins(
      { telegram: ctx.telegram },
      `🔑 *تفعيل عبر كود*\n\n👤 ${ctx.from.username ? `@${ctx.from.username}` : userId} (\`${userId}\`)\n📦 ${pkg.name}\n🔖 الكود: \`${codeRow.code}\``
    );
  }

  await svc.safeEdit(ctx, msg.storeRedeemSuccessMessage(pkg, newExpiry), kb.subStoreBackKeyboard());
  if (ctx.callbackQuery) await ctx.answerCbQuery('✅ تم التفعيل');
};

// ─── Offers / History ───────────────────────────────────────────────────────────

const handleStoreOffers = async (ctx) => {
  try {
    const offers = offerQueries.getActive();
    if (!offers.length) {
      await svc.safeEdit(ctx, msg.storeNoOffersMessage, kb.subStoreBackKeyboard());
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      return;
    }
    const lines = offers.map((o) => {
      const pkg = o.package_id ? packageQueries.getById(o.package_id) : null;
      return msg.storeOfferCard(o, pkg?.name);
    });
    await svc.safeEdit(ctx, `${msg.storeOffersHeaderMessage}\n\n${lines.join('\n\n')}`, kb.subStoreBackKeyboard());
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleStoreOffers error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleStoreHistory = async (ctx) => {
  try {
    const payments = paymentQueries.getAllByUser(ctx.from.id, 15);
    if (!payments.length) {
      await svc.safeEdit(ctx, msg.storeHistoryEmptyMessage, kb.subStoreBackKeyboard());
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      return;
    }
    const lines = payments.map(msg.storePaymentLine);
    await svc.safeEdit(ctx, `${msg.storeHistoryHeaderMessage}\n\n${lines.join('\n')}`, kb.subStoreBackKeyboard());
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleStoreHistory error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Text input dispatcher ──────────────────────────────────────────────────────

const handleStorefrontTextInput = async (ctx, wizardState) => {
  const { step, data } = wizardState;

  if (step === wiz.STEPS.STORE_COUPON_CODE) {
    await showConfirmScreen(ctx, data.packageId, ctx.message.text.trim());
    return true;
  }

  if (step === wiz.STEPS.STORE_REDEEM_CODE) {
    await redeemActivationCode(ctx, ctx.message.text.trim());
    return true;
  }

  return false;
};

module.exports = {
  handleStoreMenu,
  handleStoreMySubscription,
  handleStorePackages,
  handleStorePackageView,
  handleStoreSubscribeStart,
  handleStoreCouponYes,
  handleStoreCouponNo,
  handleStoreConfirm,
  handleStoreRedeemStart,
  handleStoreOffers,
  handleStoreHistory,
  handleStorefrontTextInput,
};
