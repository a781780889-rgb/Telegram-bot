/**
 * Subscriptions — Offers Handler (🎁 العروض والباقات الخاصة)
 */

const { offerQueries, packageQueries, operationsLogQueries } = require('../database/subscriptionsDb');
const wiz = require('../services/subscriptionsWizardState');
const svc = require('../services/subscriptionsService');
const kb = require('../utils/subscriptionsKeyboards');
const msg = require('../utils/subscriptionsMessages');
const logger = require('../utils/logger');

const actorName = (ctx) => ctx.from.first_name || ctx.from.username || String(ctx.from.id);
const isValidDate = (str) => /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());

// ─── List / Detail ─────────────────────────────────────────────────────────────

const handleOffersList = async (ctx) => {
  try {
    const offers = offerQueries.getAll();
    if (!offers.length) {
      await svc.safeEdit(ctx, msg.ofrNoOffersMessage, kb.ofrListKeyboard([]));
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      return;
    }
    await svc.safeEdit(ctx, msg.ofrListHeaderMessage(offers.length), kb.ofrListKeyboard(offers));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleOffersList error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

const handleOfferView = async (ctx, id) => {
  try {
    const offer = offerQueries.getById(id);
    if (!offer) {
      await ctx.answerCbQuery('⚠️ العرض غير موجود');
      return handleOffersList(ctx);
    }
    const pkg = offer.package_id ? packageQueries.getById(offer.package_id) : null;
    await svc.safeEdit(ctx, msg.ofrDetailMessage(offer, pkg?.name), kb.ofrDetailKeyboard(offer));
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch (error) {
    logger.error('handleOfferView error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

/** sub_ofr_(view|toggle|del|delyes)_(\d+) */
const handleOfferAction = async (ctx) => {
  const action = ctx.match[1];
  const id = parseInt(ctx.match[2], 10);

  try {
    const offer = offerQueries.getById(id);
    if (!offer) {
      await ctx.answerCbQuery('⚠️ العرض غير موجود');
      return handleOffersList(ctx);
    }

    switch (action) {
      case 'toggle': {
        offerQueries.toggleActive(id);
        const updated = offerQueries.getById(id);
        operationsLogQueries.log({ actionType: 'package_toggled', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'offer', targetId: id, details: { is_active: updated.is_active } });
        await svc.safeEdit(ctx, msg.ofrToggledMessage(updated), kb.ofrDetailKeyboard(updated));
        await ctx.answerCbQuery();
        return;
      }
      case 'del': {
        await svc.safeEdit(ctx, msg.ofrConfirmDeleteMessage(offer), kb.ofrConfirmDeleteKeyboard(id));
        await ctx.answerCbQuery();
        return;
      }
      case 'delyes': {
        offerQueries.softDelete(id);
        operationsLogQueries.log({ actionType: 'offer_deleted', actorId: ctx.from.id, actorName: actorName(ctx), targetType: 'offer', targetId: id, details: { title: offer.title } });
        await svc.safeEdit(ctx, msg.ofrDeletedMessage(offer), kb.subBackToMenuKeyboard());
        await ctx.answerCbQuery('🗑 تم الحذف');
        return;
      }
      default:
        await ctx.answerCbQuery();
    }
  } catch (error) {
    logger.error('handleOfferAction error:', error);
    await ctx.answerCbQuery('حدث خطأ').catch(() => {});
  }
};

// ─── Add-offer wizard ───────────────────────────────────────────────────────────

const handleOfferAddStart = async (ctx) => {
  wiz.startWizard(ctx.from.id, wiz.STEPS.OFR_TITLE, {});
  await svc.safeEdit(ctx, msg.ofrWizardTitleMessage, kb.subCancelKeyboard());
  if (ctx.callbackQuery) await ctx.answerCbQuery();
};

const handleOfrSkipDescription = async (ctx) => {
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.OFR_TYPE, data: { description: null } });
  await svc.safeEdit(ctx, msg.ofrWizardTypeMessage, kb.ofrTypeKeyboard());
  await ctx.answerCbQuery();
};

/** sub_ofrw_type_(discount|bogo|free_extension|free_upgrade|limited_time) */
const handleOfrTypePick = async (ctx) => {
  const type = ctx.match[1];
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.OFR_VALUE, data: { offer_type: type } });
  await svc.safeEdit(ctx, msg.ofrWizardValueMessage(type), kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

const goToPackageStep = async (ctx) => {
  const packages = packageQueries.getAllActive();
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.OFR_PACKAGE });
  await svc.safeEdit(ctx, msg.ofrWizardPackageMessage, kb.ofrPackageKeyboard(packages));
};

/** sub_ofrw_pkg_(\d+|all) */
const handleOfrPackagePick = async (ctx) => {
  const value = ctx.match[1];
  const packageId = value === 'all' ? null : parseInt(value, 10);
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.OFR_END_DATE, data: { package_id: packageId } });
  await svc.safeEdit(ctx, msg.ofrWizardEndDateMessage, kb.ofrEndDateKeyboard());
  await ctx.answerCbQuery();
};

const saveOffer = async (ctx) => {
  const userId = ctx.from.id;
  try {
    const { data } = wiz.getWizardState(userId);
    const value = data.offer_type === 'discount' ? { percent: data.discountPercent } : { description: data.rawValue };
    const offerId = offerQueries.create({ ...data, value, created_by: String(userId) });
    const offer = offerQueries.getById(offerId);
    operationsLogQueries.log({ actionType: 'offer_created', actorId: userId, actorName: actorName(ctx), targetType: 'offer', targetId: offerId, details: { title: offer.title } });
    wiz.resetWizard(userId);

    await svc.safeEdit(ctx, msg.ofrSavedMessage(offer), kb.ofrDetailKeyboard(offer));
    if (ctx.callbackQuery) await ctx.answerCbQuery('✅ تم الحفظ');
  } catch (error) {
    logger.error('saveOffer error:', error);
    if (ctx.callbackQuery) await ctx.answerCbQuery('حدث خطأ أثناء الحفظ').catch(() => {});
  }
};

const handleOfrNoDate = async (ctx) => {
  wiz.setWizardState(ctx.from.id, { data: { ends_at: null } });
  await saveOffer(ctx);
};

const handleOfrSetDateStart = async (ctx) => {
  wiz.setWizardState(ctx.from.id, { step: wiz.STEPS.OFR_END_DATE_DATE });
  await svc.safeEdit(ctx, msg.ofrWizardDateInputMessage, kb.subCancelKeyboard());
  await ctx.answerCbQuery();
};

// ─── Text input dispatcher ──────────────────────────────────────────────────────

const handleOffersTextInput = async (ctx, wizardState) => {
  const { step, data } = wizardState;
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  switch (step) {
    case wiz.STEPS.OFR_TITLE: {
      if (!text || text.length > 100) {
        await ctx.reply('⚠️ العنوان مطلوب ويجب ألا يتجاوز 100 حرف.', kb.subCancelKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { step: wiz.STEPS.OFR_DESCRIPTION, data: { title: text } });
      await ctx.reply(msg.ofrWizardDescriptionMessage, { parse_mode: 'Markdown', ...kb.skipKeyboard('sub_ofrw_skip_desc') });
      return true;
    }

    case wiz.STEPS.OFR_DESCRIPTION: {
      wiz.setWizardState(userId, { step: wiz.STEPS.OFR_TYPE, data: { description: text } });
      await ctx.reply(msg.ofrWizardTypeMessage, { parse_mode: 'Markdown', ...kb.ofrTypeKeyboard() });
      return true;
    }

    case wiz.STEPS.OFR_VALUE: {
      if (data.offer_type === 'discount') {
        const percent = parseFloat(text.replace(',', '.'));
        if (isNaN(percent) || percent <= 0 || percent > 100) {
          await ctx.reply('⚠️ الرجاء إدخال نسبة صحيحة بين 1 و100.', kb.subCancelKeyboard());
          return true;
        }
        wiz.setWizardState(userId, { data: { discountPercent: percent } });
      } else {
        wiz.setWizardState(userId, { data: { rawValue: text.slice(0, 300) } });
      }
      await goToPackageStep(ctx);
      return true;
    }

    case wiz.STEPS.OFR_END_DATE_DATE: {
      if (!isValidDate(text)) {
        await ctx.reply(msg.cpnWizardDateInvalidMessage, kb.subCancelKeyboard());
        return true;
      }
      wiz.setWizardState(userId, { data: { ends_at: new Date(`${text}T23:59:59`).toISOString() } });
      await saveOffer(ctx);
      return true;
    }

    default:
      return false;
  }
};

module.exports = {
  handleOffersList,
  handleOfferView,
  handleOfferAction,
  handleOfferAddStart,
  handleOfrSkipDescription,
  handleOfrTypePick,
  handleOfrPackagePick,
  handleOfrNoDate,
  handleOfrSetDateStart,
  handleOffersTextInput,
};
