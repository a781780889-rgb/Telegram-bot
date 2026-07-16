const { Markup } = require('telegraf');

// ─── Main Menu ────────────────────────────────────────────────────────────────

const joinMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('👤 إدارة الحسابات', 'join_accounts_menu')],
    [Markup.button.callback('🔗 إضافة روابط', 'join_add_links')],
    [Markup.button.callback('▶️ بدء الانضمام', 'join_start')],
    [Markup.button.callback('⏹ إيقاف الانضمام', 'join_stop')],
    [Markup.button.callback('⚙️ الإعدادات', 'join_settings')],
    [Markup.button.callback('📊 الإحصائيات', 'join_statistics')],
    [Markup.button.callback('🕓 طلبات بانتظار الموافقة', 'join_needs_approval')],
    [Markup.button.callback('🚫 الحسابات المحظورة', 'join_banned_accounts')],
    [Markup.button.callback('📜 سجل العمليات', 'join_logs')],
    [Markup.button.callback('⬅️ رجوع', 'main_menu')],
  ]);

// ─── Accounts Management ──────────────────────────────────────────────────────

const STATE_LABELS = {
  idle: '🟢 يعمل',
  working: '🟢 يعمل',
  resting: '🟡 راحة',
  banned: '🔴 محظور',
  full: '🟠 وصل الحد الأقصى',
  needs_login: '⚪️ يحتاج تسجيل دخول',
};

const stateLabel = (joinAcc) => {
  if (!joinAcc.enabled) return '⏸ متوقف';
  return STATE_LABELS[joinAcc.state] || '⚪️ غير معروف';
};

/**
 * @param {Array} joinAccounts  rows from joinAccountQueries.getAllByUserId (joined with accounts)
 */
const joinAccountsListKeyboard = (joinAccounts) => {
  const rows = joinAccounts.map((acc) => {
    const name = [acc.first_name, acc.last_name].filter(Boolean).join(' ') || acc.phone;
    const label = `${name.slice(0, 20)} — ${stateLabel(acc)}`;
    return [Markup.button.callback(label, `join_account_detail_${acc.account_id}`)];
  });
  rows.push([Markup.button.callback('⬅️ رجوع', 'join_menu')]);
  return Markup.inlineKeyboard(rows);
};

const joinAccountDetailKeyboard = (accountId, enabled) =>
  Markup.inlineKeyboard([
    [
      enabled
        ? Markup.button.callback('⏸ إيقاف هذا الحساب', `join_account_disable_${accountId}`)
        : Markup.button.callback('▶️ تشغيل هذا الحساب', `join_account_enable_${accountId}`),
    ],
    [Markup.button.callback('⬅️ رجوع لقائمة الحسابات', 'join_accounts_menu')],
  ]);

// ─── Add Links ────────────────────────────────────────────────────────────────

const joinAddLinksKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('❌ إلغاء', 'join_menu')],
  ]);

const joinAddLinksResultKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('▶️ بدء الانضمام الآن', 'join_start')],
    [Markup.button.callback('🔗 إضافة روابط أخرى', 'join_add_links')],
    [Markup.button.callback('⬅️ رجوع', 'join_menu')],
  ]);

// ─── Start / Stop ─────────────────────────────────────────────────────────────

const joinStartConfirmKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✅ تأكيد البدء', 'join_start_confirm')],
    [Markup.button.callback('❌ إلغاء', 'join_menu')],
  ]);

const joinRunningKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('⏹ إيقاف الانضمام', 'join_stop')],
    [Markup.button.callback('📊 الإحصائيات', 'join_statistics')],
    [Markup.button.callback('⬅️ رجوع', 'join_menu')],
  ]);

// ─── Statistics ───────────────────────────────────────────────────────────────

const joinStatisticsKeyboard = (running) =>
  Markup.inlineKeyboard([
    ...(running ? [[Markup.button.callback('⏹ إيقاف الانضمام', 'join_stop')]] : []),
    [Markup.button.callback('🕓 طلبات بانتظار الموافقة', 'join_needs_approval')],
    [Markup.button.callback('🧹 تنظيف الروابط الفاشلة', 'join_cleanup')],
    [Markup.button.callback('⬅️ رجوع', 'join_menu')],
  ]);

// ─── Needs-approval review ─────────────────────────────────────────────────────

const joinNeedsApprovalKeyboard = (links) => {
  const rows = links.slice(0, 8).map((l) => [
    Markup.button.callback(`✅ قبول #${l.id}`, `join_approve_link_${l.id}`),
    Markup.button.callback(`❌ رفض #${l.id}`, `join_reject_link_${l.id}`),
  ]);
  rows.push([Markup.button.callback('⬅️ رجوع', 'join_menu')]);
  return Markup.inlineKeyboard(rows);
};

// ─── Cleanup ──────────────────────────────────────────────────────────────────

const joinCleanupConfirmKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✅ تأكيد الحذف', 'join_cleanup_confirm')],
    [Markup.button.callback('❌ إلغاء', 'join_statistics')],
  ]);

// ─── Settings ─────────────────────────────────────────────────────────────────

const onOff = (value) => (value ? '✅ مفعّل' : '❌ معطّل');

const joinSettingsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('⏱ التوقيت بين العمليات', 'join_settings_timing')],
    [Markup.button.callback('🛑 الاستراحات', 'join_settings_breaks')],
    [Markup.button.callback('📈 حدود الانضمام', 'join_settings_limits')],
    [Markup.button.callback('🔁 إعادة المحاولة', 'join_settings_retry')],
    [Markup.button.callback('🛡 الحماية والتوزيع', 'join_settings_protection')],
    [Markup.button.callback('⬅️ رجوع', 'join_menu')],
  ]);

const joinSettingsTimingKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✏️ تعديل الفاصل الزمني (عشوائي)', 'join_edit_join_delay_range')],
    [Markup.button.callback('⬅️ رجوع للإعدادات', 'join_settings')],
  ]);

const joinSettingsBreaksKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✏️ عدد الروابط قبل الاستراحة', 'join_edit_batch_size')],
    [Markup.button.callback('✏️ مدة الاستراحة (عشوائية)', 'join_edit_rest_range')],
    [Markup.button.callback('⬅️ رجوع للإعدادات', 'join_settings')],
  ]);

const joinSettingsLimitsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✏️ الحد الأقصى الكلي لكل حساب', 'join_edit_max_joins')],
    [Markup.button.callback('✏️ الحد الأقصى بالساعة', 'join_edit_max_joins_hour')],
    [Markup.button.callback('✏️ الحد الأقصى باليوم', 'join_edit_max_joins_day')],
    [Markup.button.callback('✏️ الحد الأقصى للجلسة الواحدة', 'join_edit_max_joins_session')],
    [Markup.button.callback('⬅️ رجوع للإعدادات', 'join_settings')],
  ]);

const joinSettingsRetryKeyboard = (settings) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(`إعادة المحاولة: ${onOff(settings.retry_enabled)}`, 'join_toggle_retry_enabled')],
    [Markup.button.callback('✏️ الحد الأقصى لعدد المحاولات', 'join_edit_max_retries')],
    [Markup.button.callback('✏️ الفاصل قبل إعادة المحاولة', 'join_edit_retry_delay')],
    [Markup.button.callback('⬅️ رجوع للإعدادات', 'join_settings')],
  ]);

const joinSettingsProtectionKeyboard = (settings) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(`الحماية الذكية (FloodWait): ${onOff(settings.smart_protection_enabled)}`, 'join_toggle_smart_protection_enabled')],
    [Markup.button.callback(`التوزيع التلقائي للروابط: ${onOff(settings.auto_distribute)}`, 'join_toggle_auto_distribute')],
    [Markup.button.callback(`تفعيل نظام الانضمام: ${onOff(settings.queue_enabled)}`, 'join_toggle_queue_enabled')],
    [Markup.button.callback('⬅️ رجوع للإعدادات', 'join_settings')],
  ]);

const joinSettingsBackKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ رجوع للإعدادات', 'join_settings')],
  ]);

// ─── Generic Back ─────────────────────────────────────────────────────────────

const joinBackKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ رجوع', 'join_menu')],
  ]);

module.exports = {
  joinMenuKeyboard,
  joinAccountsListKeyboard,
  joinAccountDetailKeyboard,
  joinAddLinksKeyboard,
  joinAddLinksResultKeyboard,
  joinStartConfirmKeyboard,
  joinRunningKeyboard,
  joinStatisticsKeyboard,
  joinNeedsApprovalKeyboard,
  joinCleanupConfirmKeyboard,
  joinSettingsKeyboard,
  joinSettingsTimingKeyboard,
  joinSettingsBreaksKeyboard,
  joinSettingsLimitsKeyboard,
  joinSettingsRetryKeyboard,
  joinSettingsProtectionKeyboard,
  joinSettingsBackKeyboard,
  joinBackKeyboard,
  stateLabel,
};
