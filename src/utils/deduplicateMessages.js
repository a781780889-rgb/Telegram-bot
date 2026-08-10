/**
 * deduplicateMessages.js — رسائل نظام إزالة المكرر
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDuration = (seconds) => {
  if (!seconds) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const progressBar = (current, total, width = 10) => {
  if (!total) return '░'.repeat(width);
  const filled = Math.round((current / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};

const pct = (current, total) => (total > 0 ? Math.round((current / total) * 100) : 0);

const statusLabel = (status) => {
  const labels = {
    pending:        '⏳ في الانتظار',
    scanning:       '🔍 جاري الفحص',
    deduplicating:  '♻️ جاري إزالة المكرر',
    paused:         '⏸️ متوقف مؤقتاً',
    completed:      '✅ اكتمل',
    stopped:        '⏹️ موقوف',
    failed:         '❌ فشل',
  };
  return labels[status] || status;
};

// ─── القائمة الرئيسية ─────────────────────────────────────────────────────────

const deduplicateMenuMessage = (activeTask) => {
  let msg = '🧹 *نظام إزالة المكرر*\n\n';
  msg += 'يكتشف النظام المجموعات والقنوات المكررة بين الحسابات المحددة ويخرج منها مع الإبقاء على نسخة واحدة فقط.\n\n';

  if (activeTask) {
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `📌 *مهمة نشطة:*\n`;
    msg += `🔖 الحالة: ${statusLabel(activeTask.status)}\n`;
    msg += `📊 الإنجاز: ${pct(activeTask.leave_success + activeTask.leave_failed, activeTask.duplicate_count)}%\n`;
    msg += `━━━━━━━━━━━━━━\n\n`;
  }

  msg += 'اختر ما تريد:';
  return msg;
};

// ─── اختيار الحسابات ─────────────────────────────────────────────────────────

const deduplicateSelectAccountsMessage = (accounts, selectedIds = []) => {
  let msg = '🧹 *نظام إزالة المكرر*\n\n';
  msg += 'اختر الحسابات التي تريد فحصها:\n\n';

  msg += `✅ محدد: ${selectedIds.length} / ${accounts.length}\n\n`;
  msg += '_يمكنك اختيار حساب واحد أو أكثر. الحسابات غير المحددة لن تُفحص ولن تتأثر._';
  return msg;
};

// ─── تأكيد البدء ─────────────────────────────────────────────────────────────

const deduplicateConfirmMessage = (selectedCount, accounts) => {
  const names = accounts.map((a) => {
    const name = a.first_name ? `${a.first_name}${a.last_name ? ' ' + a.last_name : ''}` : a.phone;
    return `• ${name}`;
  }).join('\n');

  return (
    `⚠️ *تأكيد بدء الفحص*\n\n` +
    `سيتم فحص جميع المجموعات والقنوات الموجودة في الحسابات المحددة:\n\n` +
    `${names}\n\n` +
    `واكتشاف العناصر المكررة بينها، ثم الخروج من النسخ المكررة والإبقاء على نسخة واحدة فقط.\n\n` +
    `*⚠️ ملاحظة:* لن يتم حذف أي مجموعة غير مكررة.\n\n` +
    `هل تريد المتابعة؟`
  );
};

// ─── اللوحة المباشرة ──────────────────────────────────────────────────────────

const deduplicateLiveDashboard = (task, lastOp) => {
  if (!task) return '❌ لا توجد مهمة نشطة.';

  const durationSec = task.started_at
    ? Math.floor((Date.now() - new Date(task.started_at + (task.started_at.includes('T') ? '' : 'Z')).getTime()) / 1000)
    : 0;

  const totalLeave = (task.leave_success || 0) + (task.leave_failed || 0);
  const totalDupes = task.duplicate_count || 0;
  const completedPct = pct(totalLeave, totalDupes);

  let msg = `🧹 *نظام إزالة المكرر*\n\n`;
  msg += `${statusLabel(task.status === 'paused' ? 'paused' : task.status)}\n`;
  msg += `━━━━━━━━━━━━━━\n`;
  msg += `👤 الحسابات المحددة: ${task.total_accounts || 0}\n`;
  msg += `✅ تم فحص الحسابات: ${task.scanned_accounts || 0} / ${task.total_accounts || 0}\n\n`;
  msg += `📊 إجمالي العناصر: ${(task.total_entities || 0).toLocaleString()}\n`;
  msg += `♻️ العناصر المكررة: ${(task.duplicate_count || 0).toLocaleString()}\n\n`;
  msg += `🚪 تم الخروج منها: ${task.leave_success || 0}\n`;
  msg += `❌ أخطاء: ${task.error_count || 0}\n\n`;
  msg += `📈 نسبة الإنجاز: ${completedPct}%\n`;
  msg += `${progressBar(totalLeave, Math.max(totalDupes, 1))} ${completedPct}%\n`;
  msg += `⏱️ مدة التشغيل: ${formatDuration(durationSec)}\n`;
  msg += `━━━━━━━━━━━━━━\n`;

  if (lastOp) {
    const statusIcon = lastOp.status === 'success' ? '✅' : lastOp.status === 'failed' ? '❌' : '⏳';
    msg += `\n*آخر عملية:*\n`;
    msg += `${statusIcon} ${lastOp.entity_name || lastOp.entity_id}\n`;
    msg += `👤 الحساب: #${lastOp.account_id}\n`;
    if (lastOp.executed_at) {
      const t = new Date(lastOp.executed_at + (lastOp.executed_at.includes('T') ? '' : 'Z'));
      msg += `🕐 ${t.toLocaleTimeString('ar-SA')}\n`;
    }
  }

  return msg;
};

// ─── الإحصائيات ───────────────────────────────────────────────────────────────

const deduplicateStatisticsMessage = (task, opCounts) => {
  if (!task) return '📊 *إحصائيات إزالة المكرر*\n\n_لا توجد بيانات حتى الآن._\n\nابدأ مهمة جديدة لعرض الإحصائيات.';

  const durationSec = task.started_at && task.completed_at
    ? Math.floor((new Date(task.completed_at + (task.completed_at.includes('T') ? '' : 'Z')).getTime() - new Date(task.started_at + (task.started_at.includes('T') ? '' : 'Z')).getTime()) / 1000)
    : task.started_at
      ? Math.floor((Date.now() - new Date(task.started_at + (task.started_at.includes('T') ? '' : 'Z')).getTime()) / 1000)
      : 0;

  let msg = `📊 *إحصائيات إزالة المكرر*\n\n`;
  msg += `━━━━━━━━━━━━━━\n`;
  msg += `🔖 الحالة: ${statusLabel(task.status)}\n`;
  msg += `👤 الحسابات: ${task.total_accounts || 0}\n`;
  msg += `📊 إجمالي العناصر: ${(task.total_entities || 0).toLocaleString()}\n`;
  msg += `♻️ المكررات: ${(task.duplicate_count || 0).toLocaleString()}\n\n`;
  msg += `✅ عمليات الخروج الناجحة: ${opCounts?.success || 0}\n`;
  msg += `❌ عمليات فاشلة: ${opCounts?.failed || 0}\n`;
  msg += `🔄 مكررات متبقية: ${task.remaining_dupes || 0}\n\n`;
  msg += `⏱️ مدة العملية: ${formatDuration(durationSec)}\n`;
  msg += `━━━━━━━━━━━━━━`;
  return msg;
};

// ─── قائمة المكررات ───────────────────────────────────────────────────────────

const deduplicateDuplicatesMessage = (duplicates, page = 0, pageSize = 5) => {
  if (!duplicates || duplicates.length === 0) {
    return '♻️ *المكررات*\n\n✅ لا توجد عناصر مكررة في آخر مهمة.';
  }

  const start = page * pageSize;
  const end = Math.min(start + pageSize, duplicates.length);
  const items = duplicates.slice(start, end);
  const totalPages = Math.ceil(duplicates.length / pageSize);

  let msg = `♻️ *المكررات — صفحة ${page + 1}/${totalPages}*\n`;
  msg += `إجمالي: ${duplicates.length} عنصر مكرر\n`;
  msg += `━━━━━━━━━━━━━━\n\n`;

  for (const e of items) {
    let accounts = [];
    try { accounts = JSON.parse(e.accounts_json || '[]'); } catch (_) {}

    const typeIcon = e.entity_type === 'channel' ? '📢' : e.entity_type === 'supergroup' ? '👥' : '💬';
    msg += `${typeIcon} *${e.entity_name || e.entity_id}*\n`;
    msg += `🆔 \`${e.entity_id}\`\n`;
    msg += `🔁 تكرار في: ${e.duplicate_count} حسابات\n`;

    if (e.keep_account_id) {
      msg += `⭐ محتفظ به في: #${e.keep_account_id}\n`;
    }

    const toLeave = accounts.filter((a) => a.account_id !== e.keep_account_id);
    if (toLeave.length > 0) {
      msg += `🚪 خروج من: ${toLeave.map((a) => `#${a.account_id}`).join(', ')}\n`;
    }
    msg += `\n`;
  }

  return msg;
};

// ─── سجل العمليات ─────────────────────────────────────────────────────────────

const deduplicateLogsMessage = (ops, page = 0, pageSize = 8) => {
  if (!ops || ops.length === 0) {
    return '📋 *سجل العمليات*\n\n_لا توجد عمليات مسجلة._';
  }

  const total = ops.length;
  const start = page * pageSize;
  const items = ops.slice(start, Math.min(start + pageSize, total));
  const totalPages = Math.ceil(total / pageSize);

  let msg = `📋 *سجل العمليات — صفحة ${page + 1}/${totalPages}*\n\n`;

  for (const op of items) {
    const icon = op.status === 'success' ? '✅' : op.status === 'failed' ? '❌' : '⏳';
    const time = op.executed_at
      ? new Date(op.executed_at + (op.executed_at.includes('T') ? '' : 'Z')).toLocaleTimeString('ar-SA')
      : '—';

    msg += `${icon} *${op.entity_name || op.entity_id}*\n`;
    msg += `👤 الحساب: #${op.account_id}`;
    if (op.keep_account_id) msg += ` | ⭐ #${op.keep_account_id}`;
    msg += `\n`;
    if (op.status === 'failed' && op.error_message) {
      msg += `⚠️ ${op.error_message}\n`;
    }
    msg += `🕐 ${time}\n\n`;
  }

  return msg;
};

// ─── إعدادات النظام ───────────────────────────────────────────────────────────

const deduplicateSettingsMessage = (settings) => {
  const s = settings || {};
  const on = '✅';
  const off = '❌';

  let msg = `⚙️ *إعدادات نظام إزالة المكرر*\n\n`;
  msg += `🔔 الإشعارات: ${s.notifications_enabled ? on : off}\n`;
  msg += `🔍 الفحص التلقائي بعد الانتهاء: ${s.auto_reverify ? on : off}\n`;
  msg += `✅ التأكيد قبل الخروج: ${s.confirm_before_leave ? on : off}\n`;
  msg += `🔄 أقصى محاولات إعادة: ${s.max_retries || 2}\n`;
  msg += `⏱️ التأخير بين العمليات: ${(s.delay_between_ops_ms || 2000) / 1000} ثانية\n\n`;
  msg += `_جميع الإعدادات تؤثر على عمليات الخروج المستقبلية فقط._`;
  return msg;
};

// ─── التقرير النهائي ──────────────────────────────────────────────────────────

const deduplicateReportMessage = (task) => {
  if (!task) return '📄 لا توجد بيانات تقرير.';

  let report = {};
  try { report = JSON.parse(task.final_report || '{}'); } catch (_) {}

  const durationSec = report.duration || 0;

  let msg = `📄 *تقرير إزالة المكرر*\n\n`;
  msg += `━━━━━━━━━━━━━━\n`;
  msg += `👤 الحسابات: ${task.total_accounts || 0}\n`;
  msg += `📊 إجمالي العناصر: ${(task.total_entities || 0).toLocaleString()}\n`;
  msg += `♻️ المكررات: ${(task.duplicate_count || 0).toLocaleString()}\n\n`;
  msg += `✅ عمليات الخروج الناجحة: ${task.leave_success || 0}\n`;
  msg += `❌ عمليات فاشلة: ${task.leave_failed || 0}\n`;
  msg += `🔄 مكررات متبقية: ${task.remaining_dupes || 0}\n\n`;
  msg += `⏱️ مدة العملية: ${formatDuration(durationSec)}\n`;
  msg += `━━━━━━━━━━━━━━\n`;
  msg += `📌 الحالة: `;

  if (task.remaining_dupes === 0 && task.status === 'completed') {
    msg += `✅ اكتملت بنجاح\nلا توجد مجموعات أو قنوات مكررة حالياً.`;
  } else if (task.remaining_dupes > 0) {
    msg += `⚠️ اكتملت مع أخطاء\nتبقّى ${task.remaining_dupes} مكرر بسبب أخطاء — انظر التفاصيل.`;
  } else {
    msg += statusLabel(task.status);
  }

  return msg;
};

// ─── تعارض مهمة ──────────────────────────────────────────────────────────────

const deduplicateConflictMessage = (activeTaskId) =>
  `⚠️ *تعارض في المهمة*\n\nتوجد مهمة إزالة مكرر تعمل حالياً على هذه الحسابات (رقم المهمة: ${activeTaskId}).\n\nلا يمكن تشغيل مهمتين متعارضتين في نفس الوقت.`;

// ─── لا توجد حسابات ──────────────────────────────────────────────────────────

const deduplicateNoAccountsMessage = () =>
  '⚠️ *لا توجد حسابات متاحة*\n\nلا توجد حسابات متصلة. أضف حسابات أولاً من قسم *📂 الحسابات*.';

module.exports = {
  formatDuration,
  progressBar,
  pct,
  statusLabel,
  deduplicateMenuMessage,
  deduplicateSelectAccountsMessage,
  deduplicateConfirmMessage,
  deduplicateLiveDashboard,
  deduplicateStatisticsMessage,
  deduplicateDuplicatesMessage,
  deduplicateLogsMessage,
  deduplicateSettingsMessage,
  deduplicateReportMessage,
  deduplicateConflictMessage,
  deduplicateNoAccountsMessage,
};
