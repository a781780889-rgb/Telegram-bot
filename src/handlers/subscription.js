const sessionState = require('../services/sessionState');
const subscriptionService = require('../services/subscriptionService');
const { Markup } = require('telegraf');

const adminIds = new Set(String(process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));
const isAdmin = (userId) => adminIds.has(String(userId));
const backKeyboard = () => Markup.inlineKeyboard([[Markup.button.callback('⬅️ القائمة الرئيسية', 'main_menu')]]);
const subscriptionKeyboard = (admin = false) => Markup.inlineKeyboard([
  [Markup.button.callback('🎟 تفعيل كود الاشتراك', 'subscription_activate')],
  [Markup.button.callback('📋 اشتراكي', 'subscription_details')],
  ...(admin ? [[Markup.button.callback('🛠 لوحة الأدمن', 'subscription_admin')]] : []),
  [Markup.button.callback('⬅️ رجوع', 'main_menu')],
]);
const adminKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('➕ إنشاء كود', 'admin_create_code')],
  [Markup.button.callback('📊 إحصائيات الاشتراكات', 'admin_subscription_stats')],
  [Markup.button.callback('⬅️ رجوع للاشتراكات', 'subscriptions_menu')],
]);
const plansKeyboard = (quantity = 1) => Markup.inlineKeyboard([
  [Markup.button.callback(`عدد الأكواد: ${quantity}`, `admin_quantity_${quantity}`)],
  [Markup.button.callback('اختيار 1 كود', 'admin_quantity_1'), Markup.button.callback('اختيار 5 أكواد', 'admin_quantity_5')],
  [Markup.button.callback('اختيار 10 أكواد', 'admin_quantity_10'), Markup.button.callback('اختيار 50 كوداً', 'admin_quantity_50')],
  [Markup.button.callback(`30 يوم (${quantity} كود)`, `admin_plan_30d_${quantity}`)],
  [Markup.button.callback(`60 يوم (${quantity} كود)`, `admin_plan_60d_${quantity}`)],
  [Markup.button.callback(`90 يوم (${quantity} كود)`, `admin_plan_90d_${quantity}`)],
  [Markup.button.callback(`سنة (${quantity} كود)`, `admin_plan_1y_${quantity}`)],
  [Markup.button.callback(`Lifetime (${quantity} كود)`, `admin_plan_lifetime_${quantity}`)],
  [Markup.button.callback('⬅️ رجوع', 'subscription_admin')],
]);

const render = async (ctx, text, keyboard) => {
  if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(() => ctx.reply(text, { parse_mode: 'Markdown', ...keyboard }));
  else await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
};

const handleSubscriptions = async (ctx) => {
  const access = subscriptionService.getAccess(ctx.from.id);
  const summary = access.subscription ? `\n\n${subscriptionService.formatSubscription(access.subscription, access.used)}` : '\n\nلا يوجد اشتراك فعال. فعّل كودًا للبدء بإضافة الحسابات.';
  await render(ctx, `💳 *الاشتراكات*${summary}`, subscriptionKeyboard(isAdmin(ctx.from.id)));
};
const handleSubscriptionDetails = async (ctx) => {
  const subscription = subscriptionService.getSubscription(ctx.from.id);
  await render(ctx, subscription ? subscriptionService.formatSubscription(subscription) : '📋 *اشتراكي*\n\nلا يوجد اشتراك فعال حالياً.', subscriptionKeyboard(isAdmin(ctx.from.id)));
};
const handleActivateStart = async (ctx) => {
  sessionState.setAwaitingActivationCode(String(ctx.from.id));
  await render(ctx, '🎟 أرسل كود التفعيل الآن:', Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'cancel_flow')]]));
};
const handleActivationCodeInput = async (ctx) => {
  const result = subscriptionService.activateCode(ctx.from.id, ctx.message.text);
  sessionState.resetState(String(ctx.from.id));
  if (!result.ok) {
    const messages = { invalid: '❌ الكود غير صحيح.', used: '⚠️ هذا الكود مستخدم مسبقاً.', cancelled: '🚫 هذا الكود ملغى.' };
    await ctx.reply(messages[result.reason] || '❌ تعذر تفعيل الكود.', subscriptionKeyboard(isAdmin(ctx.from.id)));
    return;
  }
  const subscription = result.subscription;
  await ctx.reply(`✅ *تم تفعيل الاشتراك بنجاح*\n\n${subscriptionService.formatSubscription(subscription, subscriptionService.getAccountCount(ctx.from.id))}`, { parse_mode: 'Markdown', ...subscriptionKeyboard(isAdmin(ctx.from.id)) });
};
const handleAdminMenu = async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('غير مصرح لك.', { show_alert: true });
  await render(ctx, '🛠 *لوحة إدارة الاشتراكات*\n\nاختر العملية المطلوبة:', adminKeyboard());
};
const handleAdminCreateCode = async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('غير مصرح لك.', { show_alert: true });
  await render(ctx, 'اختر مدة الكود وعدد الأكواد:', plansKeyboard(1));
};
const handleAdminQuantity = async (ctx, quantity) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('غير مصرح لك.', { show_alert: true });
  await render(ctx, `تم اختيار إنشاء ${quantity} كود. اختر المدة:`, plansKeyboard(quantity));
};
const handleAdminPlan = async (ctx, planKey, quantity) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('غير مصرح لك.', { show_alert: true });
  sessionState.setAwaitingAdminLimit(String(ctx.from.id), planKey, quantity);
  await render(ctx, `أرسل الآن عدد الحسابات المسموح بها لكل كود (${quantity} كود).\nمثال: 10`, Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'subscription_admin')]]));
};
const handleAdminLimitInput = async (ctx) => {
  const state = sessionState.getState(String(ctx.from.id));
  const limit = Number(String(ctx.message.text).trim());
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) {
    await ctx.reply('❌ أدخل رقمًا صحيحًا أكبر من صفر وأقل من 100000.');
    return;
  }
  try {
    const codes = subscriptionService.createCodes({ planKey: state.planKey, maxAccounts: limit, quantity: state.quantity, adminId: ctx.from.id });
    sessionState.resetState(String(ctx.from.id));
    await ctx.reply(`✅ تم إنشاء ${codes.length} كود بنجاح:\n\n\`${codes.join('\n')}\``, { parse_mode: 'Markdown', ...adminKeyboard() });
  } catch (error) {
    await ctx.reply('❌ تعذر إنشاء الكود. تحقق من البيانات وحاول مرة أخرى.', adminKeyboard());
  }
};
const handleAdminStats = async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('غير مصرح لك.', { show_alert: true });
  const stats = subscriptionService.getStats();
  await render(ctx, `📊 *إحصائيات الاشتراكات*\n\nالمستخدمون: ${stats.users}\nالاشتراكات النشطة: ${stats.active}\nالاشتراكات المنتهية: ${stats.expired}\nالأكواد المتاحة: ${stats.unusedCodes}\nالأكواد المستخدمة: ${stats.usedCodes}\nإجمالي الحسابات: ${stats.accounts}`, adminKeyboard());
};

module.exports = { isAdmin, handleSubscriptions, handleSubscriptionDetails, handleActivateStart, handleActivationCodeInput, handleAdminMenu, handleAdminCreateCode, handleAdminQuantity, handleAdminPlan, handleAdminStats, subscriptionKeyboard };
