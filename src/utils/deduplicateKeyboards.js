/**
 * deduplicateKeyboards.js — لوحات المفاتيح لنظام إزالة المكرر
 */

const { Markup } = require('telegraf');

// ─── حالات الحسابات ───────────────────────────────────────────────────────────

const accountStatusEmoji = (status) => {
  switch (status) {
    case 'connected':    return '🟢';
    case 'disconnected': return '🔴';
    case 'error':        return '🔴';
    case 'banned':       return '🔴';
    case 'needs_password':
    case 'otp_sent':     return '⚠️';
    default:             return '🔴';
  }
};

// ─── القائمة الرئيسية ─────────────────────────────────────────────────────────

const deduplicateMenuKeyboard = (hasActiveTask = false) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('▶️ بدء الفحص', 'dedup_start_select')],
    [
      Markup.button.callback('📊 الإحصائيات', 'dedup_statistics'),
      Markup.button.callback('♻️ المكررات', 'dedup_duplicates'),
    ],
    [
      Markup.button.callback('📋 سجل العمليات', 'dedup_logs'),
      Markup.button.callback('⚙️ الإعدادات', 'dedup_settings'),
    ],
    ...(hasActiveTask ? [
      [Markup.button.callback('📊 اللوحة المباشرة', 'dedup_live_dashboard')],
    ] : []),
    [Markup.button.callback('🔙 القائمة الرئيسية', 'main_menu')],
  ]);

// ─── اختيار الحسابات ─────────────────────────────────────────────────────────

const deduplicateSelectAccountsKeyboard = (accounts, selectedIds = []) => {
  const rows = accounts.map((acc) => {
    const isSelected = selectedIds.includes(acc.id);
    const check = isSelected ? '☑️' : '⬜';
    const status = accountStatusEmoji(acc.status);
    const name = acc.first_name
      ? `${acc.first_name}${acc.last_name ? ' ' + acc.last_name : ''}`
      : acc.phone;
    return [Markup.button.callback(
      `${check} ${status} ${name}`,
      `dedup_toggle_account_${acc.id}`
    )];
  });

  rows.push([
    Markup.button.callback('☑️ تحديد الكل', 'dedup_select_all'),
    Markup.button.callback('❌ إلغاء الكل', 'dedup_deselect_all'),
  ]);

  if (selectedIds.length > 0) {
    rows.push([Markup.button.callback(`▶️ بدء الفحص (${selectedIds.length})`, 'dedup_confirm_start')]);
  }

  rows.push([Markup.button.callback('🔙 رجوع', 'dedup_menu')]);

  return Markup.inlineKeyboard(rows);
};

// ─── تأكيد البدء ─────────────────────────────────────────────────────────────

const deduplicateConfirmKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ تأكيد وبدء', 'dedup_execute_start'),
      Markup.button.callback('❌ إلغاء', 'dedup_start_select'),
    ],
  ]);

// ─── لوحة التحكم أثناء التشغيل ───────────────────────────────────────────────

const deduplicateRunningKeyboard = (paused = false) =>
  Markup.inlineKeyboard([
    [
      paused
        ? Markup.button.callback('▶️ استكمال', 'dedup_resume')
        : Markup.button.callback('⏸️ إيقاف مؤقت', 'dedup_pause'),
      Markup.button.callback('⏹️ إيقاف نهائي', 'dedup_stop_confirm'),
    ],
    [
      Markup.button.callback('🔄 تحديث', 'dedup_live_dashboard'),
      Markup.button.callback('📋 آخر العمليات', 'dedup_logs'),
    ],
    [Markup.button.callback('🔙 رجوع للقائمة', 'dedup_menu')],
  ]);

// ─── تأكيد الإيقاف النهائي ───────────────────────────────────────────────────

const deduplicateStopConfirmKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ نعم، أوقف', 'dedup_stop_execute'),
      Markup.button.callback('❌ لا، استكمال', 'dedup_live_dashboard'),
    ],
  ]);

// ─── بعد الانتهاء ────────────────────────────────────────────────────────────

const deduplicateCompletedKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 تقرير العملية', 'dedup_report'),
      Markup.button.callback('♻️ المكررات', 'dedup_duplicates'),
    ],
    [
      Markup.button.callback('📋 سجل العمليات', 'dedup_logs'),
      Markup.button.callback('🔄 فحص جديد', 'dedup_start_select'),
    ],
    [Markup.button.callback('🔙 القائمة الرئيسية', 'dedup_menu')],
  ]);

// ─── إحصائيات ────────────────────────────────────────────────────────────────

const deduplicateStatisticsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🔄 تحديث', 'dedup_statistics')],
    [Markup.button.callback('🔙 رجوع', 'dedup_menu')],
  ]);

// ─── المكررات ────────────────────────────────────────────────────────────────

const deduplicateDuplicatesKeyboard = (taskId, page = 0, total = 0, pageSize = 10) => {
  const rows = [];
  const totalPages = Math.ceil(total / pageSize);

  if (total > pageSize) {
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('◀️ السابق', `dedup_dupes_page_${page - 1}`));
    nav.push(Markup.button.callback(`📄 ${page + 1}/${totalPages}`, 'dedup_noop'));
    if (page < totalPages - 1) nav.push(Markup.button.callback('▶️ التالي', `dedup_dupes_page_${page + 1}`));
    rows.push(nav);
  }

  rows.push([Markup.button.callback('🔙 رجوع', 'dedup_menu')]);
  return Markup.inlineKeyboard(rows);
};

// ─── سجل العمليات ────────────────────────────────────────────────────────────

const deduplicateLogsKeyboard = (page = 0, total = 0, pageSize = 10) => {
  const rows = [];
  const totalPages = Math.ceil(total / pageSize);

  if (total > pageSize) {
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('◀️ السابق', `dedup_logs_page_${page - 1}`));
    nav.push(Markup.button.callback(`📄 ${page + 1}/${totalPages}`, 'dedup_noop'));
    if (page < totalPages - 1) nav.push(Markup.button.callback('▶️ التالي', `dedup_logs_page_${page + 1}`));
    rows.push(nav);
  }

  rows.push([
    Markup.button.callback('🔄 تحديث', 'dedup_logs'),
    Markup.button.callback('🔙 رجوع', 'dedup_menu'),
  ]);
  return Markup.inlineKeyboard(rows);
};

// ─── الإعدادات ────────────────────────────────────────────────────────────────

const deduplicateSettingsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📋 ترتيب أولوية الحسابات', 'dedup_settings_priority')],
    [Markup.button.callback('🔔 تفعيل/تعطيل الإشعارات', 'dedup_settings_toggle_notifications')],
    [Markup.button.callback('🔍 الفحص التلقائي بعد الانتهاء', 'dedup_settings_toggle_reverify')],
    [Markup.button.callback('✅ تأكيد قبل الخروج', 'dedup_settings_toggle_confirm')],
    [Markup.button.callback('🔄 عدد المحاولات عند الخطأ', 'dedup_settings_retries')],
    [Markup.button.callback('⏱️ التأخير بين العمليات', 'dedup_settings_delay')],
    [Markup.button.callback('🔙 رجوع', 'dedup_menu')],
  ]);

// ─── تقرير العملية ───────────────────────────────────────────────────────────

const deduplicateReportKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📋 تفاصيل الفاشلة', 'dedup_failed_ops')],
    [Markup.button.callback('🔄 فحص جديد', 'dedup_start_select')],
    [Markup.button.callback('🔙 رجوع', 'dedup_menu')],
  ]);

module.exports = {
  accountStatusEmoji,
  deduplicateMenuKeyboard,
  deduplicateSelectAccountsKeyboard,
  deduplicateConfirmKeyboard,
  deduplicateRunningKeyboard,
  deduplicateStopConfirmKeyboard,
  deduplicateCompletedKeyboard,
  deduplicateStatisticsKeyboard,
  deduplicateDuplicatesKeyboard,
  deduplicateLogsKeyboard,
  deduplicateSettingsKeyboard,
  deduplicateReportKeyboard,
};
