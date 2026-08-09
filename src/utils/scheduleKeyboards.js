const { Markup } = require('telegraf');

const back = (callback = 'schedule_menu') => [Markup.button.callback('🔙 رجوع', callback)];
const scheduleMenuKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('➕ إنشاء جدولة جديدة', 'schedule_new')],
  [Markup.button.callback('📋 الجدولات الحالية', 'schedule_list'), Markup.button.callback('⏳ المنشورات القادمة', 'schedule_upcoming')],
  [Markup.button.callback('▶️ تشغيل / ⏸️ إيقاف', 'schedule_toggle_list')],
  [Markup.button.callback('✏️ تعديل جدولة', 'schedule_edit_list'), Markup.button.callback('🗑️ حذف جدولة', 'schedule_delete_list')],
  [Markup.button.callback('📊 الإحصائيات', 'schedule_stats'), Markup.button.callback('📜 سجل العمليات', 'schedule_logs')],
  [Markup.button.callback('⚙️ إعدادات الجدولة', 'schedule_settings')],
  back('publish_menu'),
]);
const wizardAccountsKeyboard = (accounts, selected = []) => Markup.inlineKeyboard([
  ...accounts.map((a) => [Markup.button.callback(`${selected.includes(a.id) ? '✅' : '☑️'} ${a.phone || a.username || a.id}`, `schedule_account_${a.id}`)]),
  [Markup.button.callback('✅ متابعة', 'schedule_accounts_done')],
  [Markup.button.callback('❌ إلغاء', 'schedule_cancel')],
]);
const wizardTargetsKeyboard = (targets, selected = []) => Markup.inlineKeyboard([
  ...targets.slice(0, 40).map((t) => [Markup.button.callback(`${selected.includes(String(t.id)) ? '✅' : '☑️'} ${t.title || t.link || t.telegram_id || t.id}`, `schedule_target_${t.id}`)]),
  [Markup.button.callback('✍️ إدخال وجهة يدويًا', 'schedule_target_manual')],
  [Markup.button.callback('✅ متابعة', 'schedule_targets_done')],
  [Markup.button.callback('🔙 رجوع', 'schedule_new')],
]);
const wizardContentKeyboard = (ads) => Markup.inlineKeyboard([
  ...ads.slice(0, 40).map((ad) => [Markup.button.callback(`📚 ${ad.text_content?.slice(0, 28) || `إعلان #${ad.id}`}`, `schedule_ad_${ad.id}`)]),
  [Markup.button.callback('✍️ كتابة منشور جديد', 'schedule_content_new')],
  [Markup.button.callback('🔙 رجوع', 'schedule_accounts_done')],
]);
const recurrenceKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('مرة واحدة', 'schedule_repeat_once'), Markup.button.callback('يوميًا', 'schedule_repeat_daily')],
  [Markup.button.callback('أسبوعيًا', 'schedule_repeat_weekly'), Markup.button.callback('مخصصة', 'schedule_repeat_custom')],
  [Markup.button.callback('🔙 رجوع', 'schedule_content_back')],
]);
const delayKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('بدون تأخير', 'schedule_delay_0'), Markup.button.callback('5 ثوانٍ', 'schedule_delay_5')],
  [Markup.button.callback('15 ثانية', 'schedule_delay_15'), Markup.button.callback('60 ثانية', 'schedule_delay_60')],
  [Markup.button.callback('✍️ تأخير مخصص', 'schedule_delay_custom')],
]);
const rowKeyboard = (row, mode = 'list') => Markup.inlineKeyboard([
  [Markup.button.callback(row.status === 'running' ? '⏸️ إيقاف' : '▶️ تشغيل', `schedule_toggle_${row.id}`), Markup.button.callback('📋 التفاصيل', `schedule_detail_${row.id}`)],
  [Markup.button.callback('✏️ تعديل', `schedule_edit_${row.id}`), Markup.button.callback('🗑️ حذف', `schedule_delete_${row.id}`)],
  [Markup.button.callback('🔙 رجوع', mode === 'list' ? 'schedule_menu' : 'schedule_list')],
]);
module.exports = { scheduleMenuKeyboard, wizardAccountsKeyboard, wizardTargetsKeyboard, wizardContentKeyboard, recurrenceKeyboard, delayKeyboard, rowKeyboard };
