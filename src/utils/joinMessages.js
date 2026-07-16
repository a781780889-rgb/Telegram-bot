const { stateLabel } = require('./joinKeyboards');
const { fromSqliteUtc } = require('../database/joinDb');

const DIVIDER = '─'.repeat(25);

/** Format a SQLite UTC timestamp as a short human time for display. */
const formatWhen = (sqliteTimestamp) => {
  const d = fromSqliteUtc(sqliteTimestamp);
  if (!d) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

// ─── Main Menu ────────────────────────────────────────────────────────────────

const joinMenuMessage =
  `🔗 *قسم إدارة الانضمام للروابط*\n` +
  `${DIVIDER}\n\n` +
  `إدارة انضمام حساباتك المضافة إلى مجموعات تيليجرام عبر الروابط،\n` +
  `مع طابور مستقل لكل حساب، فواصل زمنية عشوائية، حماية تلقائية من\n` +
  `FloodWait، وإعادة محاولة ذكية للأخطاء المؤقتة.\n\n` +
  `اختر أحد الخيارات أدناه:`;

// ─── Accounts ─────────────────────────────────────────────────────────────────

const joinNoAccountsMessage =
  `⚠️ *لا توجد حسابات متصلة*\n\n` +
  `يجب إضافة حساب تيليجرام متصل أولًا من قسم "📂 الحسابات".`;

const joinAccountsListMessage =
  `👤 *إدارة حسابات الانضمام*\n` +
  `${DIVIDER}\n\n` +
  `اضغط على أي حساب لعرض تفاصيله والتحكم به:`;

const joinAccountDetailMessage = (acc) => {
  const name = [acc.first_name, acc.last_name].filter(Boolean).join(' ') || acc.phone;
  const lines = [
    `👤 *${name}*`,
    DIVIDER,
    '',
    `الحالة: ${stateLabel(acc)}`,
    `عدد المجموعات المنضم إليها: ${acc.joined_count}`,
    `الحد الأقصى الكلي: ${acc.max_joins || '∞'}`,
    `هذه الساعة: ${acc.joined_hour_count}${acc.max_joins_per_hour ? ` / ${acc.max_joins_per_hour}` : ''}`,
    `اليوم: ${acc.joined_day_count}${acc.max_joins_per_day ? ` / ${acc.max_joins_per_day}` : ''}`,
    `هذه الجلسة: ${acc.joined_session_count}${acc.max_joins_per_session ? ` / ${acc.max_joins_per_session}` : ''}`,
  ];
  if (acc.ban_reason) lines.push(`سبب التوقف: ${acc.ban_reason}`);
  if (acc.cooldown_until) lines.push(`⏳ حتى: ${formatWhen(acc.cooldown_until)}`);
  return lines.join('\n');
};

// ─── Add Links ────────────────────────────────────────────────────────────────

const joinAddLinksPromptMessage =
  `🔗 *إضافة روابط للانضمام*\n` +
  `${DIVIDER}\n\n` +
  `يمكنك إضافة الروابط بطريقتين:\n\n` +
  `1️⃣ أرسل الروابط مباشرة كنص (رابط في كل سطر).\n` +
  `2️⃣ أرسل ملف نصي \`.txt\` يحتوي على الروابط (رابط في كل سطر).\n\n` +
  `يدعم روابط:\n` +
  `• العامة: \`t.me/username\`\n` +
  `• الدعوة الخاصة: \`t.me/joinchat/xxxx\` أو \`t.me/+xxxx\`\n\n` +
  `الروابط المكررة مع ما هو موجود بالفعل في قائمة الانتظار يتم تجاهلها تلقائيًا.`;

const joinAddLinksResultMessage = (addedCount, invalidCount, duplicateQueuedCount) => {
  const lines = [
    `✅ *تمت إضافة الروابط*`,
    DIVIDER,
    '',
    `عدد الروابط المضافة إلى قائمة الانتظار: ${addedCount}`,
  ];
  if (invalidCount) lines.push(`روابط غير صالحة تم تجاهلها: ${invalidCount}`);
  if (duplicateQueuedCount) lines.push(`روابط مكررة (موجودة مسبقًا في القائمة) تم تجاهلها: ${duplicateQueuedCount}`);
  return lines.join('\n');
};

const joinFileWrongTypeMessage =
  `⚠️ *نوع الملف غير مدعوم*\n\n` +
  `يجب أن يكون الملف نصيًا بصيغة \`.txt\` فقط.`;

const joinFileTooLargeMessage =
  `⚠️ *حجم الملف كبير جدًا*\n\n` +
  `الحد الأقصى المسموح به هو 2 ميجابايت.`;

const joinFileEmptyMessage =
  `⚠️ *الملف لا يحتوي على أي روابط صالحة.*`;

const joinFileReadErrorMessage =
  `⚠️ *تعذر قراءة الملف.* تأكد من أنه ملف نصي سليم وحاول مرة أخرى.`;

// ─── Start / Stop ─────────────────────────────────────────────────────────────

const joinStartConfirmMessage = (pendingCount, accountsCount) =>
  `▶️ *بدء عملية الانضمام*\n` +
  `${DIVIDER}\n\n` +
  `الروابط في الانتظار: ${pendingCount}\n` +
  `الحسابات المتاحة: ${accountsCount}\n\n` +
  `سيتم توزيع الروابط تلقائيًا على طابور مستقل لكل حساب، بفاصل زمني\n` +
  `عشوائي مختلف لكل حساب، مع منع أي تكرار للمجموعات ومنع تنفيذ أكثر\n` +
  `من عملية انضمام واحدة بنفس اللحظة لنفس الحساب.\n\n` +
  `هل تريد المتابعة؟`;

const joinNoPendingLinksMessage =
  `⚠️ *لا توجد روابط في قائمة الانتظار*\n\n` +
  `أضف روابط أولًا من "🔗 إضافة روابط".`;

const joinNoAvailableAccountsMessage =
  `⚠️ *لا توجد حسابات متاحة للانضمام*\n\n` +
  `تأكد من وجود حساب متصل ومفعّل ضمن قسم "👤 إدارة الحسابات".`;

const joinAlreadyRunningMessage =
  `⚠️ *عملية الانضمام تعمل بالفعل*\n\n` +
  `يمكنك متابعة التقدم من الإحصائيات، أو إيقافها أولًا قبل بدء عملية جديدة.`;

const joinQueueDisabledMessage =
  `⚠️ *نظام الانضمام معطّل حاليًا من الإعدادات*\n\n` +
  `فعّله من "⚙️ الإعدادات ← 🛡 الحماية والتوزيع" قبل البدء.`;

const joinStartedMessage = (accountsUsed, queued) =>
  `✅ *تم بدء عملية الانضمام*\n` +
  `${DIVIDER}\n\n` +
  `عدد الحسابات العاملة: ${accountsUsed}\n` +
  `عدد الروابط في قائمة الانتظار: ${queued}\n\n` +
  `يمكنك متابعة التقدم من "📊 الإحصائيات" أو إيقاف العملية في أي وقت.`;

const joinStoppedMessage =
  `⏹ *تم إرسال أمر الإيقاف*\n\n` +
  `سيتوقف النظام عن بدء مهام جديدة خلال لحظات مع الحفاظ على كل ما تم إنجازه ` +
  `— أي رابط قيد التنفيذ حاليًا يعود تلقائيًا لقائمة الانتظار.`;

// ─── Statistics / Performance Dashboard (بند عاشراً) ───────────────────────────

const joinStatisticsMessage = (linkStats, groupsCount, running, accountCounts, perf) => {
  const lines = [
    `📊 *إحصائيات ومراقبة الأداء*`,
    DIVIDER,
    '',
    `الحالة العامة: ${running ? '🟢 يعمل الآن' : '⚪️ متوقف'}`,
    '',
    `*الحسابات*`,
    `🟢 عاملة: ${accountCounts.working}`,
    `⏸ متوقفة: ${accountCounts.stopped}`,
    `🔴 محظورة مؤقتًا (Flood/حد): ${accountCounts.banned}`,
    `🟠 وصلت للحد الأقصى: ${accountCounts.full}`,
    '',
    `*الروابط*`,
    `✅ تم الانضمام: ${linkStats.joined}`,
    `⏭ تم التخطي (مكرر): ${linkStats.skipped}`,
    `⏳ في الانتظار: ${linkStats.pending}`,
    `⏳ قيد التنفيذ الآن: ${linkStats.in_progress}`,
    `🌊 متوقفة بسبب Flood حاليًا: ${linkStats.failed_flood}`,
    `🕓 بانتظار موافقة المشرف: ${linkStats.needs_approval}`,
    `🚫 غير صالحة: ${linkStats.invalid}`,
    `⌛ منتهية الصلاحية: ${linkStats.expired}`,
    `🔒 خاصة/غير متاحة: ${linkStats.private}`,
    `🔐 فشل بسبب الخصوصية: ${linkStats.failed_privacy}`,
    `❌ مرفوضة: ${linkStats.rejected}`,
    `❌ فشل نهائي: ${linkStats.failed}`,
    '',
    `*الأداء*`,
    `عمليات الانضمام اليوم: ${perf.todayJoins}`,
    `معدل النجاح: ${perf.successRate}%`,
    `معدل الفشل: ${perf.failureRate}%`,
    `متوسط زمن الانضمام: ${perf.avgDurationSeconds} ث`,
    '',
    `إجمالي المجموعات المسجلة (بدون تكرار): ${groupsCount}`,
  ];
  return lines.join('\n');
};

// ─── Needs-approval review ─────────────────────────────────────────────────────

const joinNoNeedsApprovalMessage = `✅ *لا توجد طلبات بانتظار الموافقة حاليًا.*`;

const joinNeedsApprovalMessage = (links) => {
  const lines = [
    `🕓 *طلبات بانتظار موافقة المشرف*`,
    DIVIDER,
    '',
    `هذه الروابط أرسلت طلب انضمام يحتاج موافقة إدارة المجموعة. راجعها يدويًا ثم حدد النتيجة:`,
    '',
  ];
  for (const l of links.slice(0, 8)) {
    lines.push(`#${l.id} — ${l.url}`);
  }
  return lines.join('\n');
};

const joinApprovalDecidedMessage = (accepted) =>
  accepted
    ? `✅ تم تعليم الطلب كمقبول (تم الانضمام).`
    : `❌ تم تعليم الطلب كمرفوض.`;

// ─── Cleanup ──────────────────────────────────────────────────────────────────

const joinCleanupConfirmMessage = (count) =>
  `🧹 *تنظيف الروابط الفاشلة*\n` +
  `${DIVIDER}\n\n` +
  `سيتم نقل ${count} رابطًا (غير صالحة / منتهية / خاصة / مرفوضة / فشلت نهائيًا) ` +
  `إلى الحالة "🗑️ محذوف" وإخراجها من الإحصائيات النشطة.\n\n` +
  `هذا الإجراء لا يحذف السجلات (Logs) الخاصة بها. هل تريد المتابعة؟`;

const joinCleanupNothingToDoMessage = `✅ *لا توجد روابط فاشلة يمكن تنظيفها حاليًا.*`;

const joinCleanupDoneMessage = (count) => `🧹 تم نقل ${count} رابطًا إلى الحالة "محذوف".`;

// ─── Banned Accounts ──────────────────────────────────────────────────────────

const joinNoBannedAccountsMessage = `✅ *لا توجد حسابات محظورة أو متوقفة حاليًا.*`;

const joinBannedAccountsMessage = (accounts) => {
  const lines = [`🚫 *الحسابات المحظورة / المتوقفة*`, DIVIDER, ''];
  for (const acc of accounts) {
    const name = [acc.first_name, acc.last_name].filter(Boolean).join(' ') || acc.phone;
    lines.push(`• *${name}* — ${acc.ban_reason || 'سبب غير محدد'}`);
    if (acc.cooldown_until) lines.push(`  ⏳ يُستأنف تلقائيًا الساعة: ${formatWhen(acc.cooldown_until)}`);
  }
  return lines.join('\n');
};

// ─── Logs (بند حادي عشر) ────────────────────────────────────────────────────────

const RESULT_LABELS = {
  joined: '✅ تم الانضمام',
  skipped: '⏭ تم التخطي (مكرر)',
  invalid: '🚫 رابط غير صالح',
  expired: '⌛ منتهي الصلاحية',
  private: '🔒 خاص / غير متاح',
  needs_approval: '🕓 بانتظار الموافقة',
  rejected: '❌ مرفوض',
  failed_privacy: '🔐 فشل بسبب الخصوصية',
  failed: '❌ فشل',
  account_full: '🟠 الحساب وصل للحد الأقصى',
  account_needs_login: '⚪️ الحساب يحتاج تسجيل دخول',
  rest_start: '🛑 بداية استراحة',
  rest_end: '▶️ نهاية استراحة',
  floodwait_start: '🌊 بداية FloodWait',
  floodwait_end: '✅ انتهاء FloodWait',
  retry_scheduled: '🔁 مجدولة لإعادة المحاولة',
  limit_hour_reached: '🕐 وصل الحد الساعي',
  limit_day_reached: '📅 وصل الحد اليومي',
  limit_session_reached: '📌 وصل حد الجلسة',
};

const joinNoLogsMessage = `📜 *لا يوجد سجل عمليات بعد.*`;

const joinLogsMessage = (logs) => {
  const lines = [`📜 *سجل عمليات الانضمام (الأحدث أولًا)*`, DIVIDER, ''];
  for (const log of logs) {
    const label = RESULT_LABELS[log.result] || log.result;
    const phone = log.phone ? ` (${log.phone})` : '';
    const duration = log.duration_ms != null ? ` — ${(log.duration_ms / 1000).toFixed(1)}ث` : '';
    lines.push(`${label}${phone}${duration}`);
    if (log.group_title) lines.push(`  📌 ${log.group_title}`);
    if (log.link) lines.push(`  🔗 ${log.link}`);
    if (log.detail) lines.push(`  ℹ️ ${log.detail}`);
    lines.push('');
  }
  return lines.join('\n').trim();
};

// ─── Settings (بند ثاني عشر) ────────────────────────────────────────────────────

const joinSettingsHubMessage =
  `⚙️ *إعدادات الانضمام*\n` +
  `${DIVIDER}\n\n` +
  `اختر القسم الذي تريد تعديله:`;

const joinSettingsTimingMessage = (s) =>
  `⏱ *التوقيت بين العمليات*\n` +
  `${DIVIDER}\n\n` +
  `الفاصل الزمني الحالي بين كل عملية انضمام: من ${s.join_delay_min_seconds} إلى ${s.join_delay_max_seconds} ثانية (عشوائي، مختلف لكل حساب في كل مرة).\n\n` +
  `اختر ما تريد تعديله:`;

const joinSettingsBreaksMessage = (s) =>
  `🛑 *الاستراحات*\n` +
  `${DIVIDER}\n\n` +
  `عدد الروابط قبل أخذ استراحة: ${s.batch_size}\n` +
  `مدة الاستراحة: من ${s.rest_min_seconds} إلى ${s.rest_max_seconds} ثانية (عشوائية)\n\n` +
  `اختر ما تريد تعديله:`;

const joinSettingsLimitsMessage = (s) =>
  `📈 *حدود الانضمام*\n` +
  `${DIVIDER}\n\n` +
  `الحد الأقصى الكلي لكل حساب: ${s.max_joins_per_account}\n` +
  `الحد الأقصى بالساعة: ${s.max_joins_per_hour || 'بدون حد'}\n` +
  `الحد الأقصى باليوم: ${s.max_joins_per_day || 'بدون حد'}\n` +
  `الحد الأقصى للجلسة الواحدة: ${s.max_joins_per_session || 'بدون حد'}\n\n` +
  `اختر ما تريد تعديله (أرسل 0 لإلغاء الحد):`;

const joinSettingsRetryMessage = (s) =>
  `🔁 *إعادة المحاولة*\n` +
  `${DIVIDER}\n\n` +
  `الحالة: ${s.retry_enabled ? '✅ مفعّلة' : '❌ معطّلة'}\n` +
  `الحد الأقصى لعدد المحاولات: ${s.max_retries}\n` +
  `الفاصل قبل إعادة المحاولة: ${s.retry_delay_seconds} ثانية (يتضاعف مع كل محاولة)\n\n` +
  `الأخطاء المؤقتة فقط (كالمهلة الزمنية) يعاد فيها المحاولة — الأخطاء الدائمة ` +
  `(رابط غير صالح، منتهي، خاص...) لا يعاد فيها المحاولة أبدًا.`;

const joinSettingsProtectionMessage = (s) =>
  `🛡 *الحماية والتوزيع*\n` +
  `${DIVIDER}\n\n` +
  `الحماية الذكية: ${s.smart_protection_enabled ? '✅ مفعّلة' : '❌ معطّلة'} — اكتشاف FloodWait تلقائيًا وإيقاف الحساب مؤقتًا ثم استئنافه تلقائيًا بعد انتهاء المهلة.\n` +
  `التوزيع التلقائي: ${s.auto_distribute ? '✅ مفعّل' : '❌ معطّل'} — توزيع الروابط تلقائيًا بالتساوي بين الحسابات عند البدء.\n` +
  `تفعيل نظام الانضمام: ${s.queue_enabled ? '✅ مفعّل' : '❌ معطّل'} — عند التعطيل لا يمكن بدء عملية انضمام جديدة.\n\n` +
  `ملاحظة: منع تنفيذ أكثر من عملية انضمام واحدة بنفس اللحظة لكل حساب مطبّق دائمًا ولا يمكن تعطيله.`;

const joinEditPromptMessages = {
  batch_size: 'أرسل عدد الروابط المطلوب قبل أخذ استراحة (رقم صحيح أكبر من صفر، مثال: `10`):',
  join_delay_range: 'أرسل الحد الأدنى والأقصى للفاصل الزمني بالثواني، مفصولين بشرطة (مثال: `20-45`):',
  rest_range: 'أرسل الحد الأدنى والأقصى لمدة الاستراحة بالثواني، مفصولين بشرطة (مثال: `300-900`):',
  max_joins: 'أرسل الحد الأقصى الكلي لعدد المجموعات لكل حساب (مثال: `50`):',
  max_joins_hour: 'أرسل الحد الأقصى لعدد عمليات الانضمام بالساعة لكل حساب (أرسل `0` لإلغاء الحد):',
  max_joins_day: 'أرسل الحد الأقصى لعدد عمليات الانضمام باليوم لكل حساب (أرسل `0` لإلغاء الحد):',
  max_joins_session: 'أرسل الحد الأقصى لعدد عمليات الانضمام في الجلسة الواحدة (أرسل `0` لإلغاء الحد):',
  max_retries: 'أرسل الحد الأقصى لعدد محاولات إعادة المحاولة عند الأخطاء المؤقتة (مثال: `2`):',
  retry_delay: 'أرسل عدد الثواني قبل إعادة المحاولة الأولى (مثال: `90`):',
};

module.exports = {
  joinMenuMessage,
  joinNoAccountsMessage,
  joinAccountsListMessage,
  joinAccountDetailMessage,
  joinAddLinksPromptMessage,
  joinAddLinksResultMessage,
  joinFileWrongTypeMessage,
  joinFileTooLargeMessage,
  joinFileEmptyMessage,
  joinFileReadErrorMessage,
  joinStartConfirmMessage,
  joinNoPendingLinksMessage,
  joinNoAvailableAccountsMessage,
  joinAlreadyRunningMessage,
  joinQueueDisabledMessage,
  joinStartedMessage,
  joinStoppedMessage,
  joinStatisticsMessage,
  joinNoNeedsApprovalMessage,
  joinNeedsApprovalMessage,
  joinApprovalDecidedMessage,
  joinCleanupConfirmMessage,
  joinCleanupNothingToDoMessage,
  joinCleanupDoneMessage,
  joinNoBannedAccountsMessage,
  joinBannedAccountsMessage,
  joinNoLogsMessage,
  joinLogsMessage,
  joinSettingsHubMessage,
  joinSettingsTimingMessage,
  joinSettingsBreaksMessage,
  joinSettingsLimitsMessage,
  joinSettingsRetryMessage,
  joinSettingsProtectionMessage,
  joinEditPromptMessages,
};
