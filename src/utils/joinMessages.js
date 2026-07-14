const { stateLabel } = require('./joinKeyboards');

// ─── Main Menu ────────────────────────────────────────────────────────────────

const joinMenuMessage =
  `🔗 *قسم إدارة الانضمام للروابط*\n` +
  `${'─'.repeat(25)}\n\n` +
  `إدارة انضمام حساباتك المضافة إلى مجموعات تيليجرام عبر الروابط،\n` +
  `مع نظام ذكي لمنع التكرار وتوزيع المهام والحماية من الحظر.\n\n` +
  `اختر أحد الخيارات أدناه:`;

// ─── Accounts ─────────────────────────────────────────────────────────────────

const joinNoAccountsMessage =
  `⚠️ *لا توجد حسابات متصلة*\n\n` +
  `يجب إضافة حساب تيليجرام متصل أولًا من قسم "📂 الحسابات".`;

const joinAccountsListMessage =
  `👤 *إدارة حسابات الانضمام*\n` +
  `${'─'.repeat(25)}\n\n` +
  `اضغط على أي حساب لعرض تفاصيله والتحكم به:`;

const joinAccountDetailMessage = (acc) => {
  const name = [acc.first_name, acc.last_name].filter(Boolean).join(' ') || acc.phone;
  const lines = [
    `👤 *${name}*`,
    `${'─'.repeat(25)}`,
    '',
    `الحالة: ${stateLabel(acc)}`,
    `عدد المجموعات المنضم إليها: ${acc.joined_count}`,
    `الحد الأقصى: ${acc.max_joins}`,
  ];
  if (acc.ban_reason) lines.push(`سبب التوقف: ${acc.ban_reason}`);
  if (acc.cooldown_until) lines.push(`مدة الانتظار حتى: ${acc.cooldown_until}`);
  return lines.join('\n');
};

// ─── Add Links ────────────────────────────────────────────────────────────────

const joinAddLinksPromptMessage =
  `🔗 *إضافة روابط للانضمام*\n` +
  `${'─'.repeat(25)}\n\n` +
  `أرسل روابط المجموعات المراد الانضمام إليها (رابط في كل سطر).\n\n` +
  `يدعم روابط:\n` +
  `• العامة: \`t.me/username\`\n` +
  `• الدعوة الخاصة: \`t.me/joinchat/xxxx\` أو \`t.me/+xxxx\``;

const joinAddLinksResultMessage = (addedCount, invalidCount, alreadyQueuedSkipped) => {
  const lines = [
    `✅ *تمت إضافة الروابط*`,
    `${'─'.repeat(25)}`,
    '',
    `عدد الروابط المضافة إلى قائمة الانتظار: ${addedCount}`,
  ];
  if (invalidCount) lines.push(`روابط غير صالحة تم تجاهلها: ${invalidCount}`);
  if (alreadyQueuedSkipped) lines.push(`روابط مكررة داخل النص نفسه تم تجاهلها: ${alreadyQueuedSkipped}`);
  return lines.join('\n');
};

// ─── Start / Stop ─────────────────────────────────────────────────────────────

const joinStartConfirmMessage = (pendingCount, accountsCount) =>
  `▶️ *بدء عملية الانضمام*\n` +
  `${'─'.repeat(25)}\n\n` +
  `الروابط في الانتظار: ${pendingCount}\n` +
  `الحسابات المتاحة: ${accountsCount}\n\n` +
  `سيتم توزيع الروابط تلقائيًا بين الحسابات مع منع أي تكرار للمجموعات.\n` +
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

const joinStartedMessage = (accountsUsed, queued) =>
  `✅ *تم بدء عملية الانضمام*\n` +
  `${'─'.repeat(25)}\n\n` +
  `عدد الحسابات العاملة: ${accountsUsed}\n` +
  `عدد الروابط في قائمة الانتظار: ${queued}\n\n` +
  `يمكنك متابعة التقدم من "📊 الإحصائيات" أو إيقاف العملية في أي وقت.`;

const joinStoppedMessage =
  `⏹ *تم إرسال أمر الإيقاف*\n\n` +
  `سيتوقف النظام عن بدء مهام جديدة مع الحفاظ على كل ما تم إنجازه.`;

// ─── Statistics ───────────────────────────────────────────────────────────────

const joinStatisticsMessage = (linkStats, groupsCount, running) => {
  return (
    `📊 *إحصائيات الانضمام*\n` +
    `${'─'.repeat(25)}\n\n` +
    `الحالة العامة: ${running ? '🟢 يعمل الآن' : '⚪️ متوقف'}\n\n` +
    `✅ تم الانضمام: ${linkStats.joined}\n` +
    `⏭ تم التخطي (تكرار): ${linkStats.skipped}\n` +
    `❌ فشل: ${linkStats.failed}\n` +
    `🚫 روابط غير صالحة: ${linkStats.invalid}\n` +
    `⏳ في الانتظار: ${linkStats.pending}\n\n` +
    `إجمالي المجموعات المسجلة (بدون تكرار): ${groupsCount}`
  );
};

// ─── Banned Accounts ──────────────────────────────────────────────────────────

const joinNoBannedAccountsMessage = `✅ *لا توجد حسابات محظورة أو متوقفة حاليًا.*`;

const joinBannedAccountsMessage = (accounts) => {
  const lines = [`🚫 *الحسابات المحظورة / المتوقفة*`, `${'─'.repeat(25)}`, ''];
  for (const acc of accounts) {
    const name = [acc.first_name, acc.last_name].filter(Boolean).join(' ') || acc.phone;
    lines.push(`• *${name}* — ${acc.ban_reason || 'سبب غير محدد'}`);
    if (acc.cooldown_until) lines.push(`  ⏳ حتى: ${acc.cooldown_until}`);
  }
  return lines.join('\n');
};

// ─── Logs ─────────────────────────────────────────────────────────────────────

const RESULT_LABELS = {
  joined: '✅ تم الانضمام',
  skipped: '⏭ تم التخطي (تكرار)',
  failed: '❌ فشل',
  invalid: '🚫 رابط غير صالح',
};

const joinNoLogsMessage = `📜 *لا يوجد سجل عمليات بعد.*`;

const joinLogsMessage = (logs) => {
  const lines = [`📜 *سجل عمليات الانضمام*`, `${'─'.repeat(25)}`, ''];
  for (const log of logs) {
    const label = RESULT_LABELS[log.result] || log.result;
    const phone = log.phone ? ` (${log.phone})` : '';
    lines.push(`${label}${phone}`);
    if (log.group_title) lines.push(`  📌 ${log.group_title}`);
    if (log.detail) lines.push(`  ℹ️ ${log.detail}`);
    lines.push('');
  }
  return lines.join('\n').trim();
};

// ─── Settings ─────────────────────────────────────────────────────────────────

const joinSettingsMessage = (settings) =>
  `⚙️ *إعدادات السرعة والفواصل الزمنية*\n` +
  `${'─'.repeat(25)}\n\n` +
  `عدد الروابط لكل دورة: ${settings.batch_size}\n` +
  `الفاصل بين كل عملية انضمام: ${settings.join_delay_seconds} ثانية\n` +
  `وقت الراحة بين الدورات: ${settings.rest_seconds} ثانية\n` +
  `الحد الأقصى للمجموعات لكل حساب: ${settings.max_joins_per_account}\n\n` +
  `اختر الإعداد الذي تريد تعديله:`;

const joinEditPromptMessages = {
  batch_size: 'أرسل عدد الروابط المطلوب لكل دورة (رقم صحيح، مثال: `3`):',
  join_delay_seconds: 'أرسل الفاصل الزمني بالثواني بين كل عملية انضمام (مثال: `30`):',
  rest_seconds: 'أرسل وقت الراحة بالثواني بين كل دورة وأخرى (مثال: `600`):',
  max_joins_per_account: 'أرسل الحد الأقصى لعدد المجموعات لكل حساب (مثال: `50`):',
};

module.exports = {
  joinMenuMessage,
  joinNoAccountsMessage,
  joinAccountsListMessage,
  joinAccountDetailMessage,
  joinAddLinksPromptMessage,
  joinAddLinksResultMessage,
  joinStartConfirmMessage,
  joinNoPendingLinksMessage,
  joinNoAvailableAccountsMessage,
  joinAlreadyRunningMessage,
  joinStartedMessage,
  joinStoppedMessage,
  joinStatisticsMessage,
  joinNoBannedAccountsMessage,
  joinBannedAccountsMessage,
  joinNoLogsMessage,
  joinLogsMessage,
  joinSettingsMessage,
  joinEditPromptMessages,
};
