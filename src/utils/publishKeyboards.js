const { Markup } = require('telegraf');
const button = (text, callback_data) => ({ text, callback_data });
const publishMenuKeyboard = () => Markup.inlineKeyboard([
  [button('▶️ بدء النشر', 'publish_direct_start'), button('📅 جدولة النشر', 'publish_schedule_start')],
  [button('📚 مكتبة الإعلانات', 'publish_ads_library'), button('📂 نشر روابط المجلدات', 'publish_folders_start')],
  [button('📱 اختيار الحسابات', 'publish_accounts_select'), button('📊 لوحة المتابعة', 'publish_dashboard')],
  [button('⚙️ إعدادات النشر', 'publish_settings'), button('📜 سجل العمليات', 'publish_logs')],
  [button('⬅️ رجوع', 'main_menu')],
]);
const adsLibraryKeyboard = (ads = []) => Markup.inlineKeyboard([
  ...ads.map((ad) => [button(`${ad.type === 'text' ? '📝' : '🖼'} ${(ad.text_content || `إعلان #${ad.id}`).slice(0, 20)}`, `publish_ad_view_${ad.id}`)]),
  [button('➕ إضافة إعلان جديد', 'publish_ad_add')], [button('⬅️ رجوع', 'publish_menu')],
]);
const adViewKeyboard = (id) => Markup.inlineKeyboard([[button('⬅️ رجوع للمكتبة', 'publish_ads_library')]]);
const dashboardKeyboard = () => Markup.inlineKeyboard([[button('🔄 تحديث', 'publish_dashboard_refresh')], [button('⬅️ رجوع', 'publish_menu')]]);
const selectAccountsKeyboard = (accounts, selected = [], done = 'publish_direct_accounts_done') => Markup.inlineKeyboard([
  ...accounts.map((a) => [button(`${selected.includes(a.id) ? '✅' : '☑️'} ${a.phone || a.username || a.id}`, `publish_account_toggle_${a.id}`)]),
  [button('✅ متابعة', done)], [button('❌ إلغاء', 'publish_cancel')],
]);
const selectTargetsKeyboard = (targets, selected = []) => Markup.inlineKeyboard([
  ...targets.slice(0, 40).map((t) => [button(`${selected.includes(String(t.id)) ? '✅' : '☑️'} ${t.title || t.link || t.telegram_id || t.id}`, `publish_target_toggle_${t.id}`)]),
  [button('✍️ إدخال وجهة يدويًا', 'publish_target_manual')], [button('✅ متابعة', 'publish_direct_targets_done')], [button('❌ إلغاء', 'publish_cancel')],
]);
const selectAdsKeyboard = (ads, callback = 'publish_ad_select_') => Markup.inlineKeyboard([
  ...ads.slice(0, 40).map((ad) => [button(`📚 ${(ad.text_content || `إعلان #${ad.id}`).slice(0, 28)}`, `${callback}${ad.id}`)]),
  [button('➕ إضافة إعلان', 'publish_ad_add')], [button('❌ إلغاء', 'publish_cancel')],
]);
const foldersKeyboard = (folders) => Markup.inlineKeyboard([
  ...folders.map((f) => [button(`${f.invite_link ? '✅' : '⚠️'} ${f.name} (${f.groups_count || 0})`, `publish_folder_select_${f.id}`)]),
  [button('⬅️ رجوع', 'publish_menu')],
]);
const settingsKeyboard = (settings) => Markup.inlineKeyboard([
  [button(`${settings.enabled ? '⏸️ إيقاف' : '▶️ تشغيل'} المحرك`, 'publish_settings_toggle_enabled')],
  [button(`التأخير الافتراضي: ${settings.default_delay_seconds}ث`, 'publish_settings_cycle_delay')],
  [button('⬅️ رجوع', 'publish_menu')],
]);
module.exports = { publishMenuKeyboard, adsLibraryKeyboard, adViewKeyboard, dashboardKeyboard, selectAccountsKeyboard, selectTargetsKeyboard, selectAdsKeyboard, foldersKeyboard, settingsKeyboard };
