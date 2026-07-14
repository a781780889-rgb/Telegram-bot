/**
 * Subscriptions — Coupons Handler (🎟 إنشاء كوبون خصم)
 */

const { couponQueries, packageQueries, operationsLogQueries, generateCode } = require('../database/subscriptionsDb');
const wiz = require('../services/subscriptionsWizardState');
const svc = require('../services/subscriptionsService');
const kb = require('../utils/subscriptionsKeyboards');
const msg = require('../utils/subscriptionsMessages');
const logger = require('../utils/logger');

const PAGE_SIZE = 8;
const actorName = (ctx) => ctx.from.first_name || ctx.from.username || String(ctx.from.id);

const isValidDate = (str) => /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());

// ─── List / Detail ─────────────────────────────────────────────────────────────

const handleCouponsList = async (ctx, page = 1) => {
  try {
    const result = couponQueries.getPage({ page, pageSize: PAGE_SIZE });
    if (!result.total) {
      await svc.safeEdit(ctx, msg.cpnNoCouponsMessage, kb.cpnListKeyboard([], 1, 1));
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      return;
    }
    await svc.safeEdit(ctx, msg.cpnListHeaderMessage(result.total), kb.cpnListKeyboard(result.rows, result.page, result.totalPages));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleCouponsList error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleCouponView = async (ctx, id) => {
  try {
    const coupon = couponQueries.getById(id);
    if (!coupon) {
      await ctx.answerCbQuery('⚠️ الكوبون غير موجود');
      return handleCouponsList(ctx);
    }
    await svc.safeEdit(ctx, msg.cpnDetailMessage(coupon), kb.cpnDetailKeyboard(coupon));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleCouponView error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

/** sub_cpn_(view|toggle|del|delyes)_(\d+) */
const handleCouponAction = async (ctx) => {
  const action = ctx.match[1];
  const id = parseInt(ctx.match[2], 10);

  try {
    const coupon = couponQueries.getById(id);
    if (!coupon) {
      await ctx.answerCbQuery('⚠️ الكوبون غير موجود');
      return handleCouponsList(ctx);
    }

    switch (action) {
      case 'toggle': {
        couponQueries.toggleActive(id);
        const updated = couponQueries.getById(id);
        operationsLogQueries.log({ actionType: 'package_toggled', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'coupon', targetId: id, details: { is_active: updated.is_active } });
        await svc.safeEdit(ctx, msg.cpnToggledMessage(updated), kb.cpnDetailKeyboard(updated));
        await ctx.answerCbQuery();
        return;
      }
      case 'del': {
        await svc.safeEdit(ctx, msg.cpnConfirmDeleteMessage(coupon), kb.cpnConfirmDeleteKeyboard(id));
        await ctx.answerCbQuery();
        return;
      }
      case 'delyes': {
        couponQueries.softDelete(id);
        operationsLogQueries.log({ actionType: 'coupon_deleted', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'coupon', targetId: id, details: { code: coupon.code } });
        await svc.safeEdit(ctx, msg.cpnDeletedMessage(coupon), kb.subBackToMenuKeyboard());
        await ctx.answerCbQuery('🗑 تم الحذف');
        return;
      }
      default:
        await ctx.answerCbQuery();
    }
  } catch (error) {
    logger.error('handleCouponAction error:', error);
    await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Add-coupon wizard ──────────────────────────────────────────────────────────

const handleCouponAddStart = async (ctx) => {
  wiz.startWizard(ctx.from.id, wiz.STEPS.CPN_CODE, {});
  await svc.safeEdit(ctx, msg.cpnWizardCodeMessage, kb.cpnCodeEntryKeyboard());
  if (ctx.callbackQuery) await ctx.answerCbQuery();
};

const handleCpnAutoCode = async (ctx) => {
  let code = generateCode(8);
  while (couponQueries.existsByCode(code)) code = generateCode(8);
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.CPN_NAME, data: { code } });
  await svc.safeEdit(ctx, `✅ الكود: \`${code}\`\n\n${msg.cpnWizardNameMessage}`, { parse_mode: 'Markdown', ...kb.pkgSkipKeyboard('sub_cpnw_skip_name') });
  await ctx.answerCbQuery();
};

const handleCpnSkipName = async (ctx) => {
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.CPN_TYPE, data: { name: null } });
  await svc.safeEdit(ctx, msg.cpnWizardTypeMessage, kb.cpnTypeKeyboard());
  await ctx.answerCbQuery();
};

/** sub_cpnw_type_(percent|fixed) */
const handleCpnTypePick = async (ctx) => {
  const type = ctx.match[1];
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.CPN_VALUE, data: { discount_type: type } });
  await svc.safeEdit(ctx, msg.cpnWizardValueMessage(type), kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

const handleCpnUnlimitedUses = async (ctx) => {
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.CPN_VALID_UNTIL, data: { max_uses: 0 } });
  await svc.safeEdit(ctx, msg.cpnWizardValidUntilMessage, kb.cpnValidUntilKeyboard());
  await ctx.answerCbQuery();
};

const handleCpnNoLimitDate = async (ctx) => {
  const userId = ctx.from.id;
  wiz.setWizardState(userId, { step: wiz.STEPS.CPN_PACKAGES, data: { valid_until: null } });
  const packages = packageQueries.getAllActive();
  await svc.safeEdit(ctx, msg.cpnWizardPackagesMessage, kb.cpnPackagesKeyboard(packages, []));
  await ctx.answerCbQuery();
};

const handleCpnSetDateStart = async (ctx) => {
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.CPN_VALID_UNTIL_DATE });
  await svc.safeEdit(ctx, msg.cpnWizardDateInputMessage, kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

/** sub_cpnw_pkg_(\d+) — toggles a package in/out of the allowed list */
const handleCpnTogglePackage = async (ctx) => {
  const pkgId = parseInt(ctx.match[1], 10);
  const userId = ctx.from.id;
  const state = wiz.getWizardState(userId);
  const current = state.data.allowed_package_ids || [];
  const next = current.includes(pkgId) ? current.filter((x) => x !== pkgId) : [...current, pkgId];
  wiz.setWizardState(userId, { data: { allowed_package_ids: next } });

  const packages = packageQueries.getAllActive();
  await svc.safeEdit(ctx, msg.cpnWizardPackagesMessage, kb.cpnPackagesKeyboard(packages, next));
  await ctx.answerCbQuery();
};

const handleCpnPackagesConfirm = async (ctx) => {
  const userId = ctx.from.id;
  const state = wiz.setWizardState(userId, { step: wiz.STEPS.CPN_REVIEW });
  await svc.safeEdit(ctx, msg.cpnWizardReviewMessage(state.data), kb.cpnReviewKeyboard());
  await ctx.answerCbQuery();
};

const handleCpnConfirm = async (ctx) => {
  const userId = ctx.from.id;
  try {
    const { data } = wiz.getWizardState(userId);
    if (couponQueries.existsByCode(data.code)) {
      await ctx.answerCbQuery('⚠️ الكود مستخدم بالفعل');
      await svc.safeEdit(ctx, msg.cpnWizardCodeExistsMessage, kb.subCancelKeyboard());
      wiz.setWizardState(userId, { step: wiz.STEPS.CPN_CODE });
      return;
    }
    const couponId = couponQueries.create({ ...data, created_by: String(userId) });
    const coupon = couponQueries.getById(couponId);
    operationsLogQueries.log({ actionType: 'coupon_created', actorId: userId, actorName: actorName(ctx), targetType: 'coupon', targetId: couponId, details: { code: coupon.code } });
    wiz.resetWizard(userId);

    await svc.safeEdit(ctx, msg.cpnSavedMessage(coupon), kb.cpnDetailKeyboard(coupon));
    await ctx.answerCbQuery('✅ تم الحفظ');
  } catch (error) {
    logger.error('handleCpnConfirm error:', error);
    await ctx.answerCbQuery('حدث خطأ أثناء الحفظ').catch(() => {});
  }
};

// ─── Text input dispatcher ──────────────────────────────────────────────────────

const handleCouponsTextInput = async (ctx, wizardState) => {
  const { step, data } = wizardState;
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  switch (step) {
    case wiz.STEPS.CPN_CODE: {
      const code = text.toUpperCase().replace(/\s+/g, '');
      if (!code || code.length > 30 || !/^[A-Z0-9_-]+$/.test(code)) {
        await ctx.reply('⚠️ الكود يجب أن يحتوي على حروف/أرقام إنجليزية فقط (بدون مسافات).', kb.cpnCodeEntryKeyboard());
        return true;
      }
      if (couponQueries.existsByCode(code)) {
        await ctx.reply(msg.cpnWizardCodeExistsMessage, kb.cpnCodeEntryKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.CPN_NAME, data: { code } });
      await ctx.reply(msg.cpnWizardNameMessage, { parse_mode: 'Markdown', ...kb.pkgSkipKeyboard('sub_cpnw_skip_name') });
      return true;
    }

    case wiz.STEPS.CPN_NAME: {
      wiz.setWizardState(userId, { step: wiz.STEPS.CPN_TYPE, data: { name: text.slice(0, 60) } });
      await ctx.reply(msg.cpnWizardTypeMessage, { parse_mode: 'Markdown', ...kb.cpnTypeKeyboard() });
      return true;
    }

    case wiz.STEPS.CPN_VALUE: {
      const value = parseFloat(text.replace(',', '.'));
      if (isNaN(value) || value <= 0) {
        await ctx.reply(msg.cpnWizardValueInvalidMessage, kb.subCancelKeyboard());
        return true;
      }
      if (data.discount_type === 'percent' && (value < 1 || value > 100)) {
        await ctx.reply(msg.cpnWizardPercentRangeMessage, kb.subCancelKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.CPN_MAX_USES, data: { discount_value: value } });
      await ctx.reply(msg.cpnWizardMaxUsesMessage, { parse_mode: 'Markdown', ...kb.cpnMaxUsesKeyboard() });
      return true;
    }

    case wiz.STEPS.CPN_MAX_USES: {
      const n = parseInt(text, 10);
      if (isNaN(n) || n < 0) {
        await ctx.reply(msg.pkgWizardNumberInvalidMessage, kb.cpnMaxUsesKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.CPN_VALID_UNTIL, data: { max_uses: n } });
      await ctx.reply(msg.cpnWizardValidUntilMessage, { parse_mode: 'Markdown', ...kb.cpnValidUntilKeyboard() });
      return true;
    }

    case wiz.STEPS.CPN_VALID_UNTIL_DATE: {
      if (!isValidDate(text)) {
        await ctx.reply(msg.cpnWizardDateInvalidMessage, kb.subCancelKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.CPN_PACKAGES, data: { valid_until: new Date(`${text}T23:59:59`).toISOString() } });
      const packages = packageQueries.getAllActive();
      await ctx.reply(msg.cpnWizardPackagesMessage, { parse_mode: 'Markdown', ...kb.cpnPackagesKeyboard(packages, []) });
      return true;
    }

    default:
      return false;
  }
};

module.exports = {
  handleCouponsList,
  handleCouponView,
  handleCouponAction,
  handleCouponAddStart,
  handleCpnAutoCode,
  handleCpnSkipName,
  handleCpnTypePick,
  handleCpnUnlimitedUses,
  handleCpnNoLimitDate,
  handleCpnSetDateStart,
  handleCpnTogglePackage,
  handleCpnPackagesConfirm,
  handleCpnConfirm,
  handleCouponsTextInput,
};
