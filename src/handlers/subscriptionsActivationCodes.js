/**
 * Subscriptions — Activation Codes Handler (🔑 أكواد التفعيل)
 *
 * Self-service redemption codes: admin generates a batch tied to one package,
 * distributes them externally (WhatsApp, resellers, storefronts, etc.), and a
 * subscriber instantly activates their subscription by redeeming a code from
 * 🔑 "لدي كود تفعيل" in the storefront — no manual admin approval needed,
 * unlike the payment-request flow in subscriptionsPayments.js.
 */

const {
  activationCodeQueries, activationCodeUseQueries, packageQueries, operationsLogQueries,
} = require('../database/subscriptionsDb');
const wiz = require('../services/subscriptionsWizardState');
const svc = require('../services/subscriptionsService');
const kb = require('../utils/subscriptionsKeyboards');
const msg = require('../utils/subscriptionsMessages');
const logger = require('../utils/logger');

const PAGE_SIZE = 8;
const actorName = (ctx) => ctx.from.first_name || ctx.from.username || String(ctx.from.id);
const isValidDate = (str) => /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());

const listView = new Map(); // userId -> { filter, page }
const getView = (userId) => listView.get(String(userId)) || { filter: 'all', page: 1 };
const setView = (userId, patch) => listView.set(String(userId), { ...getView(userId), ...patch });

// ─── List / Filter / Detail ────────────────────────────────────────────────────

const handleCodesList = async (ctx) => {
  try {
    const userId = ctx.from.id;
    const view = getView(userId);
    const result = activationCodeQueries.getPage({ status: view.filter, page: view.page, pageSize: PAGE_SIZE });

    if (!result.total) {
      await svc.safeEdit(ctx, msg.codeNoCodesMessage, kb.codeListKeyboard([], 1, 1, view.filter));
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      return;
    }

    await svc.safeEdit(ctx, msg.codeListHeaderMessage(result.total), kb.codeListKeyboard(result.rows, result.page, result.totalPages, view.filter));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleCodesList error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleCodesPage = async (ctx) => {
  setView(ctx.from.id, { page: parseInt(ctx.match[1], 10) });
  return handleCodesList(ctx);
};

const handleCodesFilter = async (ctx) => {
  setView(ctx.from.id, { filter: ctx.match[1], page: 1 });
  return handleCodesList(ctx);
};

const handleCodeView = async (ctx, id) => {
  try {
    const code = activationCodeQueries.getById(id);
    if (!code) {
      await ctx.answerCbQuery('⚠️ الكود غير موجود');
      return handleCodesList(ctx);
    }
    const pkg = packageQueries.getById(code.package_id);
    const uses = activationCodeUseQueries.getByCode(id);
    await svc.safeEdit(ctx, msg.codeDetailMessage(code, pkg, uses), kb.codeDetailKeyboard(code));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleCodeView error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

/** sub_code_(toggle|del|delyes)_(\d+) */
const handleCodeAction = async (ctx) => {
  const action = ctx.match[1];
  const id = parseInt(ctx.match[2], 10);

  try {
    const code = activationCodeQueries.getById(id);
    if (!code) {
      await ctx.answerCbQuery('⚠️ الكود غير موجود');
      return handleCodesList(ctx);
    }

    switch (action) {
      case 'toggle': {
        activationCodeQueries.toggleActive(id);
        const updated = activationCodeQueries.getById(id);
        operationsLogQueries.log({ actionType: 'activation_code_toggled', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'activation_code', targetId: id, details: { is_active: updated.is_active } });
        await svc.safeEdit(ctx, msg.codeToggledMessage(updated), kb.codeDetailKeyboard(updated));
        await ctx.answerCbQuery();
        return;
      }
      case 'del': {
        await svc.safeEdit(ctx, msg.codeConfirmDeleteMessage(code), kb.codeConfirmDeleteKeyboard(id));
        await ctx.answerCbQuery();
        return;
      }
      case 'delyes': {
        activationCodeQueries.softDelete(id);
        operationsLogQueries.log({ actionType: 'activation_code_deleted', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'activation_code', targetId: id, details: { code: code.code } });
        await svc.safeEdit(ctx, msg.codeDeletedMessage(code), kb.subBackToMenuKeyboard());
        await ctx.answerCbQuery('🗑 تم الحذف');
        return;
      }
      default:
        await ctx.answerCbQuery();
    }
  } catch (error) {
    logger.error('handleCodeAction error:', error);
    await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Batch-generation wizard ────────────────────────────────────────────────────

const handleCodeAddStart = async (ctx) => {
  const packages = packageQueries.getAllActive();
  if (!packages.length) {
    await svc.safeEdit(ctx, '⚠️ لا توجد باقات مفعّلة بعد. أنشئ باقة أولًا من "📋 إدارة الباقات".', kb.subBackToMenuKeyboard());
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    return;
  }
  wiz.startWizard(ctx.from.id, wiz.STEPS.CODE_PACKAGE, {});
  await svc.safeEdit(ctx, msg.codeWizardPackageMessage, kb.codePackageKeyboard(packages));
  if (ctx.callbackQuery) await ctx.answerCbQuery();
};

/** sub_codew_pkg_(\d+) */
const handleCodePackagePick = async (ctx) => {
  const pkgId = parseInt(ctx.match[1], 10);
  const pkg = packageQueries.getById(pkgId);
  if (!pkg) {
    await ctx.answerCbQuery('⚠️ الباقة غير موجودة');
    return;
  }
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.CODE_QUANTITY, data: { packageId: pkgId, packageName: pkg.name } });
  await svc.safeEdit(ctx, msg.codeWizardQuantityMessage(pkg.name), kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

const generateAndShow = async (ctx) => {
  const userId = ctx.from.id;
  try {
    const { data } = wiz.getWizardState(userId);
    const pkg = packageQueries.getById(data.packageId);
    if (!pkg) {
      await ctx.reply('⚠️ الباقة لم تعد موجودة.', kb.subBackToMenuKeyboard());
      wiz.resetWizard(userId);
      return;
    }

    const codes = activationCodeQueries.generateBatch({
      packageId: pkg.id,
      quantity: data.quantity,
      maxUses: 1,
      expiresAt: data.expiresAt || null,
      batchLabel: `${pkg.name} - ${new Date().toISOString().slice(0, 10)}`,
      createdBy: String(userId),
    });

    operationsLogQueries.log({
      actionType: 'activation_codes_generated', actorId: userId, actorName: actorName(ctx),
      targetType: 'package', targetId: pkg.id, details: { quantity: codes.length, package: pkg.name },
    });

    wiz.resetWizard(userId);
    await svc.safeEdit(ctx, msg.codeBatchGeneratedMessage(codes, pkg, data.expiresAt), kb.codeBatchDoneKeyboard());
    if (ctx.callbackQuery) await ctx.answerCbQuery('✅ تم التوليد');
  } catch (error) {
    logger.error('generateAndShow error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ أثناء التوليد').catch(() => {});
  }
};

const handleCodeNoExpiry = async (ctx) => {
  wiz.setWizardState(ctx.from.id, { data: { expiresAt: null } });
  await generateAndShow(ctx);
};

const handleCodeSetExpiryStart = async (ctx) => {
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.CODE_EXPIRY_DATE });
  await svc.safeEdit(ctx, msg.codeWizardDateInputMessage, kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

// ─── Text input dispatcher ──────────────────────────────────────────────────────

const handleActivationCodesTextInput = async (ctx, wizardState) => {
  const { step } = wizardState;
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  switch (step) {
    case wiz.STEPS.CODE_QUANTITY: {
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty < 1 || qty > 100) {
        await ctx.reply(msg.codeWizardQuantityInvalidMessage, kb.subCancelKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.CODE_EXPIRY, data: { quantity: qty } });
      await ctx.reply(msg.codeWizardExpiryMessage, { parse_mode: 'Markdown', ...kb.codeExpiryKeyboard() });
      return true;
    }

    case wiz.STEPS.CODE_EXPIRY_DATE: {
      if (!isValidDate(text)) {
        await ctx.reply(msg.codeWizardDateInvalidMessage, kb.subCancelKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { data: { expiresAt: new Date(`${text}T23:59:59`).toISOString() } });
      await generateAndShow(ctx);
      return true;
    }

    default:
      return false;
  }
};

module.exports = {
  handleCodesList,
  handleCodesPage,
  handleCodesFilter,
  handleCodeView,
  handleCodeAction,
  handleCodeAddStart,
  handleCodePackagePick,
  handleCodeNoExpiry,
  handleCodeSetExpiryStart,
  handleActivationCodesTextInput,
};
