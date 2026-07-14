const { Markup } = require('telegraf');

// ─── Main Menu ────────────────────────────────────────────────────────────────

const joinMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('👤 إدارة الحسابات', 'join_accounts_menu')],
    [Markup.button.callback('🔗 إضافة روابط', 'join_add_links')],
    [Markup.button.callback('▶️ بدء الانضمام', 'join_start')],
    [Markup.button.callback('⏹ إيقاف الانضمام', 'join_stop')],
    [Markup.button.callback('⚙️ إعدادات السرعة', 'join_settings')],
    [Markup.button.callback('📊 الإحصائيات', 'join_statistics')],
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

// ─── Settings ─────────────────────────────────────────────────────────────────

const joinSettingsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✏️ عدد الروابط لكل دورة', 'join_edit_batch_size')],
    [Markup.button.callback('✏️ الفاصل بين كل انضمام', 'join_edit_join_delay')],
    [Markup.button.callback('✏️ وقت الراحة بين الدورات', 'join_edit_rest_seconds')],
    [Markup.button.callback('✏️ الحد الأقصى لكل حساب', 'join_edit_max_joins')],
    [Markup.button.callback('⬅️ رجوع', 'join_menu')],
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
  joinSettingsKeyboard,
  joinSettingsBackKeyboard,
  joinBackKeyboard,
  stateLabel,
};
