/**
 * Subscriptions — Packages Handler (📋 إدارة الباقات / ➕ إضافة باقة)
 */

const { packageQueries, operationsLogQueries } = require('../database/subscriptionsDb');
const wiz = require('../services/subscriptionsWizardState');
const svc = require('../services/subscriptionsService');
const kb = require('../utils/subscriptionsKeyboards');
const msg = require('../utils/subscriptionsMessages');
const logger = require('../utils/logger');

const PAGE_SIZE = 8;

const FIELD_LABELS = {
  name: 'الاسم', description: 'الوصف', price: 'السعر', currency: 'العملة',
  duration_days: 'المدة (أيام)', features: 'المميزات', max_accounts: 'حد الحسابات',
  max_operations: 'حد العمليات', max_users: 'حد المستخدمين',
};

const actorName = (ctx) => ctx.from.first_name || ctx.from.username || String(ctx.from.id);

// ─── List / Detail ─────────────────────────────────────────────────────────────

const handlePackagesList = async (ctx, page = 1) => {
  try {
    const all = packageQueries.getAllForAdmin();
    if (!all.length) {
      await svc.safeEdit(ctx, msg.pkgNoPackagesMessage, kb.subBackToMenuKeyboard());
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      return;
    }
    const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const slice = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    await svc.safeEdit(ctx, msg.pkgListHeaderMessage(all.length), kb.pkgListKeyboard(slice, safePage, totalPages));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handlePackagesList error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handlePackageView = async (ctx, pkgId) => {
  try {
    const pkg = packageQueries.getById(pkgId);
    if (!pkg) {
      await ctx.answerCbQuery('⚠️ الباقة غير موجودة');
      return handlePackagesList(ctx, 1);
    }
    await svc.safeEdit(ctx, msg.pkgDetailMessage(pkg), kb.pkgDetailKeyboard(pkg));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handlePackageView error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Actions: toggle / special / dup / del / delyes / up / down / edit ────────

const handlePackageAction = async (ctx) => {
  const action = ctx.match[1];
  const pkgId = parseInt(ctx.match[2], 10);

  try {
    const pkg = packageQueries.getById(pkgId);
    if (!pkg) {
      await ctx.answerCbQuery('⚠️ الباقة غير موجودة');
      return handlePackagesList(ctx, 1);
    }

    switch (action) {
      case 'toggle': {
        packageQueries.toggleActive(pkgId);
        const updated = packageQueries.getById(pkgId);
        operationsLogQueries.log({
          actionType: 'package_toggled', actorId: ctx.from.id, actorName: actorName(ctx),
          targetType: 'package', targetId: pkgId, details: { is_active: updated.is_active },
        });
        await ctx.answerCbQuery(updated.is_active ? '✅ تم التفعيل' : '⏸ تم التعطيل');
        return handlePackageView(ctx, pkgId);
      }
      case 'special': {
        packageQueries.toggleSpecial(pkgId);
        await ctx.answerCbQuery();
        return handlePackageView(ctx, pkgId);
      }
      case 'dup': {
        const newId = packageQueries.duplicate(pkgId);
        operationsLogQueries.log({
          actionType: 'package_created', actorId: ctx.from.id, actorName: actorName(ctx),
          targetType: 'package', targetId: newId, details: { duplicatedFrom: pkgId },
        });
        await ctx.answerCbQuery('📄 تم النسخ');
        return handlePackageView(ctx, newId);
      }
      case 'del': {
        await svc.safeEdit(ctx, msg.pkgConfirmDeleteMessage(pkg), kb.pkgConfirmDeleteKeyboard(pkgId));
        await ctx.answerCbQuery();
        return;
      }
      case 'delyes': {
        packageQueries.softDelete(pkgId);
        operationsLogQueries.log({
          actionType: 'package_deleted', actorId: ctx.from.id, actorName: actorName(ctx),
          targetType: 'package', targetId: pkgId, details: { name: pkg.name },
        });
        await svc.safeEdit(ctx, msg.pkgDeletedMessage(pkg), kb.subBackToMenuKeyboard());
        await ctx.answerCbQuery('🗑 تم الحذف');
        return;
      }
      case 'up':
      case 'down': {
        const moved = packageQueries.move(pkgId, action);
        await ctx.answerCbQuery(moved ? '✅' : msg.pkgCannotMoveMessage);
        return handlePackageView(ctx, pkgId);
      }
      case 'edit': {
        await svc.safeEdit(ctx, `✏️ *تعديل الباقة: ${pkg.name}*\n\nاختر الحقل الذي تريد تعديله:`, kb.pkgEditFieldKeyboard(pkgId));
        await ctx.answerCbQuery();
        return;
      }
      default:
        await ctx.answerCbQuery();
    }
  } catch (error) {
    logger.error('handlePackageAction error:', error);
    await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Single-field edit ──────────────────────────────────────────────────────────

const handlePackageFieldEditStart = async (ctx) => {
  const field = ctx.match[1];
  const pkgId = parseInt(ctx.match[2], 10);

  try {
    const pkg = packageQueries.getById(pkgId);
    if (!pkg || !FIELD_LABELS[field]) {
      await ctx.answerCbQuery('⚠️ غير متاح');
      return;
    }
    wiz.startWizard(ctx.from.id, wiz.STEPS.PKG_EDIT_FIELD, { field, packageId: pkgId });

    let currentValue = pkg[field];
    if (field === 'features') currentValue = (pkg.features || []).join(', ') || 'لا توجد';

    await svc.safeEdit(ctx, msg.pkgEditFieldPromptMessage(FIELD_LABELS[field], currentValue), kb.subCancelKeyboard());
    await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handlePackageFieldEditStart error:', error);
    await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Add-package wizard ──────────────────────────────────────────────────────────

const handlePackageAddStart = async (ctx) => {
  wiz.startWizard(ctx.from.id, wiz.STEPS.PKG_NAME, {});
  await svc.safeEdit(ctx, msg.pkgWizardNameMessage, kb.subCancelKeyboard());
  if (ctx.callbackQuery) await ctx.answerCbQuery();
};

/** sub_pkgw_cur_(.+) — either a fixed currency code, or "custom". */
const handlePkgCurrencyPick = async (ctx) => {
  const value = ctx.match[1];
  if (value === 'custom') {
    wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.PKG_CUSTOM_CURRENCY });
    await svc.safeEdit(ctx, msg.pkgWizardCustomCurrencyMessage, kb.subCancelKeyboard());
  } else {
    wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.PKG_DURATION, data: { currency: value } });
    await svc.safeEdit(ctx, msg.pkgWizardDurationMessage, kb.pkgDurationKeyboard());
  }
  await ctx.answerCbQuery();
};

/** sub_pkgw_dur_(\d+|custom) */
const handlePkgDurationPick = async (ctx) => {
  const value = ctx.match[1];
  if (value === 'custom') {
    wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.PKG_CUSTOM_DURATION });
    await svc.safeEdit(ctx, msg.pkgWizardCustomDurationMessage, kb.subCancelKeyboard());
  } else {
    wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.PKG_MAX_ACCOUNTS, data: { duration_days: parseInt(value, 10) } });
    await svc.safeEdit(ctx, msg.pkgWizardMaxAccountsMessage, kb.pkgUnlimitedOrTextKeyboard('accounts'));
  }
  await ctx.answerCbQuery();
};

/** sub_pkgw_unlim_(accounts|operations|users) */
const handlePkgUnlimited = async (ctx) => {
  const field = ctx.match[1];
  const userId = ctx.from.id;

  if (field === 'accounts') {
    wiz.setWizardState(userId, { step: wiz.STEPS.PKG_MAX_OPERATIONS, data: { max_accounts: 0 } });
    await svc.safeEdit(ctx, msg.pkgWizardMaxOperationsMessage, kb.pkgUnlimitedOrTextKeyboard('operations'));
  } else if (field === 'operations') {
    wiz.setWizardState(userId, { step: wiz.STEPS.PKG_MAX_USERS, data: { max_operations: 0 } });
    await svc.safeEdit(ctx, msg.pkgWizardMaxUsersMessage, kb.pkgUnlimitedOrTextKeyboard('users'));
  } else if (field === 'users') {
    wiz.setWizardState(userId, { step: wiz.STEPS.PKG_FEATURES, data: { max_users: 0 } });
    await svc.safeEdit(ctx, msg.pkgWizardFeaturesMessage, kb.pkgSkipKeyboard('sub_pkgw_skip_features'));
  }
  await ctx.answerCbQuery();
};

const handlePkgSkipDescription = async (ctx) => {
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.PKG_PRICE, data: { description: null } });
  await svc.safeEdit(ctx, msg.pkgWizardPriceMessage, kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

const handlePkgSkipFeatures = async (ctx) => {
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.PKG_SPECIAL_BADGE, data: { features: [] } });
  await svc.safeEdit(ctx, msg.pkgWizardSpecialMessage, kb.pkgSpecialBadgeKeyboard());
  await ctx.answerCbQuery();
};

/** sub_pkgw_special_(yes|no) */
const handlePkgSpecial = async (ctx) => {
  const value = ctx.match[1];
  const userId = ctx.from.id;

  if (value === 'yes') {
    wiz.setWizardState(userId, { step: wiz.STEPS.PKG_BADGE_LABEL, data: { is_special: true } });
    await svc.safeEdit(ctx, msg.pkgWizardBadgeLabelMessage, kb.pkgSkipKeyboard('sub_pkgw_skip_badge'));
  } else {
    const state = wiz.setWizardState(userId, { step: wiz.STEPS.PKG_REVIEW, data: { is_special: false, badge_label: null } });
    await svc.safeEdit(ctx, msg.pkgWizardReviewMessage(state.data), kb.pkgReviewKeyboard());
  }
  await ctx.answerCbQuery();
};

const handlePkgSkipBadge = async (ctx) => {
  const state = wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.PKG_REVIEW, data: { badge_label: null } });
  await svc.safeEdit(ctx, msg.pkgWizardReviewMessage(state.data), kb.pkgReviewKeyboard());
  await ctx.answerCbQuery();
};

const handlePkgConfirm = async (ctx) => {
  const userId = ctx.from.id;
  try {
    const { data } = wiz.getWizardState(userId);

    if (packageQueries.existsByName(data.name)) {
      await ctx.answerCbQuery('⚠️ الاسم مستخدم بالفعل');
      await svc.safeEdit(ctx, msg.pkgDuplicateNameErrorMessage(data.name), kb.subCancelKeyboard());
      return;
    }

    const pkgId = packageQueries.create({ ...data, created_by: String(userId) });
    const pkg = packageQueries.getById(pkgId);
    operationsLogQueries.log({
      actionType: 'package_created', actorId: userId, actorName: actorName(ctx),
      targetType: 'package', targetId: pkgId, details: { name: pkg.name, price: pkg.price },
    });
    wiz.resetWizard(userId);

    await svc.safeEdit(ctx, msg.pkgSavedMessage(pkg), kb.pkgDetailKeyboard(pkg));
    await ctx.answerCbQuery('✅ تم الحفظ');
  } catch (error) {
    logger.error('handlePkgConfirm error:', error);
    await ctx.answerCbQuery('حدث خطأ أثناء الحفظ').catch(() => {});
  }
};

// ─── Text input dispatcher (called from the central subscriptions router) ────

/**
 * @param {import('telegraf').Context} ctx
 * @param {{step: string, data: object}} wizardState
 * @returns {Promise<boolean>} true if this module handled the input
 */
const handlePackagesTextInput = async (ctx, wizardState) => {
  const { step, data } = wizardState;
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  switch (step) {
    case wiz.STEPS.PKG_NAME: {
      if (!text || text.length > 100) {
        await ctx.reply('⚠️ الاسم مطلوب ويجب ألا يتجاوز 100 حرف.', kb.subCancelKeyboard());
        return true;
      }
      if (packageQueries.existsByName(text)) {
        await ctx.reply(msg.pkgDuplicateNameErrorMessage(text), kb.subCancelKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.PKG_DESCRIPTION, data: { name: text } });
      await ctx.reply(msg.pkgWizardDescriptionMessage(text), { parse_mode: 'Markdown', ...kb.pkgSkipKeyboard('sub_pkgw_skip_desc') });
      return true;
    }

    case wiz.STEPS.PKG_DESCRIPTION: {
      wiz.setWizardState(userId, { step: wiz.STEPS.PKG_PRICE, data: { description: text } });
      await ctx.reply(msg.pkgWizardPriceMessage, { parse_mode: 'Markdown', ...kb.subCancelKeyboard() });
      return true;
    }

    case wiz.STEPS.PKG_PRICE: {
      const price = parseFloat(text.replace(',', '.'));
      if (isNaN(price) || price < 0) {
        await ctx.reply(msg.pkgWizardPriceInvalidMessage, kb.subCancelKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.PKG_CURRENCY, data: { price } });
      await ctx.reply(msg.pkgWizardCurrencyMessage, { parse_mode: 'Markdown', ...kb.pkgCurrencyKeyboard() });
      return true;
    }

    case wiz.STEPS.PKG_CUSTOM_CURRENCY: {
      const currency = text.toUpperCase().slice(0, 10);
      wiz.setWizardState(userId, { step: wiz.STEPS.PKG_DURATION, data: { currency } });
      await ctx.reply(msg.pkgWizardDurationMessage, { parse_mode: 'Markdown', ...kb.pkgDurationKeyboard() });
      return true;
    }

    case wiz.STEPS.PKG_CUSTOM_DURATION: {
      const days = parseInt(text, 10);
      if (isNaN(days) || days <= 0) {
        await ctx.reply(msg.pkgWizardDurationInvalidMessage, kb.subCancelKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.PKG_MAX_ACCOUNTS, data: { duration_days: days } });
      await ctx.reply(msg.pkgWizardMaxAccountsMessage, { parse_mode: 'Markdown', ...kb.pkgUnlimitedOrTextKeyboard('accounts') });
      return true;
    }

    case wiz.STEPS.PKG_MAX_ACCOUNTS: {
      const n = parseInt(text, 10);
      if (isNaN(n) || n < 0) {
        await ctx.reply(msg.pkgWizardNumberInvalidMessage, kb.pkgUnlimitedOrTextKeyboard('accounts'));
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.PKG_MAX_OPERATIONS, data: { max_accounts: n } });
      await ctx.reply(msg.pkgWizardMaxOperationsMessage, { parse_mode: 'Markdown', ...kb.pkgUnlimitedOrTextKeyboard('operations') });
      return true;
    }

    case wiz.STEPS.PKG_MAX_OPERATIONS: {
      const n = parseInt(text, 10);
      if (isNaN(n) || n < 0) {
        await ctx.reply(msg.pkgWizardNumberInvalidMessage, kb.pkgUnlimitedOrTextKeyboard('operations'));
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.PKG_MAX_USERS, data: { max_operations: n } });
      await ctx.reply(msg.pkgWizardMaxUsersMessage, { parse_mode: 'Markdown', ...kb.pkgUnlimitedOrTextKeyboard('users') });
      return true;
    }

    case wiz.STEPS.PKG_MAX_USERS: {
      const n = parseInt(text, 10);
      if (isNaN(n) || n < 0) {
        await ctx.reply(msg.pkgWizardNumberInvalidMessage, kb.pkgUnlimitedOrTextKeyboard('users'));
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.PKG_FEATURES, data: { max_users: n } });
      await ctx.reply(msg.pkgWizardFeaturesMessage, { parse_mode: 'Markdown', ...kb.pkgSkipKeyboard('sub_pkgw_skip_features') });
      return true;
    }

    case wiz.STEPS.PKG_FEATURES: {
      const features = text.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 20);
      wiz.setWizardState(userId, { step: wiz.STEPS.PKG_SPECIAL_BADGE, data: { features } });
      await ctx.reply(msg.pkgWizardSpecialMessage, { parse_mode: 'Markdown', ...kb.pkgSpecialBadgeKeyboard() });
      return true;
    }

    case wiz.STEPS.PKG_BADGE_LABEL: {
      const state = wiz.setWizardState(userId, { step: wiz.STEPS.PKG_REVIEW, data: { badge_label: text.slice(0, 40) } });
      await ctx.reply(msg.pkgWizardReviewMessage(state.data), { parse_mode: 'Markdown', ...kb.pkgReviewKeyboard() });
      return true;
    }

    case wiz.STEPS.PKG_EDIT_FIELD: {
      const { field, packageId } = data;
      let value = text;

      if (['price'].includes(field)) {
        value = parseFloat(text.replace(',', '.'));
        if (isNaN(value) || value < 0) {
          await ctx.reply(msg.pkgWizardPriceInvalidMessage, kb.subCancelKeyboard());
          return true;
        }
      } else if (['duration_days', 'max_accounts', 'max_operations', 'max_users'].includes(field)) {
        value = parseInt(text, 10);
        if (isNaN(value) || value < 0) {
          await ctx.reply(msg.pkgWizardNumberInvalidMessage, kb.subCancelKeyboard());
          return true;
        }
      } else if (field === 'features') {
        value = text.split(',').map((f) => f.trim()).filter(Boolean).slice(0, 20);
      } else if (field === 'name') {
        if (!text || text.length > 100) {
          await ctx.reply('⚠️ الاسم مطلوب ويجب ألا يتجاوز 100 حرف.', kb.subCancelKeyboard());
          return true;
        }
        if (packageQueries.existsByName(text, packageId)) {
          await ctx.reply(msg.pkgDuplicateNameErrorMessage(text), kb.subCancelKeyboard());
          return true;
        }
      }

      packageQueries.updateField(packageId, field, value);
      const pkg = packageQueries.getById(packageId);
      operationsLogQueries.log({
        actionType: 'package_updated', actorId: userId, actorName: actorName(ctx),
        targetType: 'package', targetId: packageId, details: { field, value },
      });
      wiz.resetWizard(userId);

      await ctx.reply(msg.pkgFieldUpdatedMessage, { parse_mode: 'Markdown' });
      await ctx.reply(msg.pkgDetailMessage(pkg), { parse_mode: 'Markdown', ...kb.pkgDetailKeyboard(pkg) });
      return true;
    }

    default:
      return false;
  }
};

module.exports = {
  handlePackagesList,
  handlePackageView,
  handlePackageAction,
  handlePackageFieldEditStart,
  handlePackageAddStart,
  handlePkgCurrencyPick,
  handlePkgDurationPick,
  handlePkgUnlimited,
  handlePkgSkipDescription,
  handlePkgSkipFeatures,
  handlePkgSpecial,
  handlePkgSkipBadge,
  handlePkgConfirm,
  handlePackagesTextInput,
};
