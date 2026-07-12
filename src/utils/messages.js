const { maskPhone } = require('./encryption');

const statusEmoji = {
  connected: '🟢',
  connecting: '🔄',
  pending: '⏳',
  otp_sent: '📱',
  needs_password: '🔐',
  error: '🔴',
  banned: '🚫',
  disconnected: '⚪️',
};

const statusText = {
  connected: 'متصل',
  connecting: 'جارٍ الاتصال',
  pending: 'في الانتظار',
  otp_sent: 'بانتظار رمز التحقق',
  needs_password: 'يحتاج كلمة مرور',
  error: 'خطأ',
  banned: 'محظور',
  disconnected: 'غير متصل',
};

const welcomeMessage = (firstName) => `
مرحبًا ${firstName || ''} 👋

أنا بوت إدارة حسابات تيليجرام.
يمكنني مساعدتك في إضافة وإدارة حسابات تيليجرام متعددة.

اختر أحد الخيارات أدناه:
`;

const helpMessage = `
📖 *دليل الاستخدام*

*إضافة حساب:*
1. اضغط على ➕ إضافة حساب
2. أدخل رقم هاتفك بالصيغة الدولية
   مثال: \`+967771234567\`
3. أدخل رمز التحقق المُرسَل لتطبيق تيليجرام
4. إذا كان لديك تحقق بخطوتين، أدخل كلمة المرور

*ملاحظات:*
• يجب أن يكون رقم الهاتف مُسجَّلًا في تيليجرام
• رمز التحقق صالح لمدة 5 دقائق فقط
• لن يتم تخزين كلمة مرورك
• جلساتك محمية بتشفير قوي
`;

const phoneRequestMessage = `
📱 *إضافة حساب تيليجرام*

أدخل رقم هاتفك بالصيغة الدولية:

مثال: \`+967771234567\`

⚠️ تأكد من وجود تطبيق تيليجرام على الهاتف لاستقبال رمز التحقق.
`;

const otpRequestMessage = (phone) => `
✉️ *تم إرسال رمز التحقق*

تم إرسال رمز التحقق إلى تطبيق تيليجرام على الرقم:
\`${maskPhone(phone)}\`

الرجاء إدخال الرمز المكون من 5 أرقام:
`;

const passwordRequestMessage = `
🔐 *التحقق بخطوتين مُفعَّل*

هذا الحساب يحتاج إلى كلمة مرور التحقق بخطوتين.

أدخل كلمة المرور:
`;

const successMessage = (account) => `
✅ *تم تسجيل الدخول بنجاح!*

👤 *الاسم:* ${[account.first_name, account.last_name].filter(Boolean).join(' ') || 'غير محدد'}
🔹 *اسم المستخدم:* ${account.username ? `@${account.username}` : 'لا يوجد'}
📱 *الهاتف:* \`${maskPhone(account.phone)}\`
🟢 *الحالة:* متصل

تمت إضافة الحساب إلى قائمتك بنجاح.
`;

const accountCardMessage = (account, index) => {
  const emoji = statusEmoji[account.status] || '⚪️';
  const text = statusText[account.status] || account.status;
  const name =
    [account.first_name, account.last_name].filter(Boolean).join(' ') ||
    'غير محدد';
  const username = account.username ? `@${account.username}` : 'لا يوجد';

  return (
    `*${index}. ${name}*\n` +
    `   📱 \`${maskPhone(account.phone)}\`\n` +
    `   👤 ${username}\n` +
    `   ${emoji} ${text}`
  );
};

const noAccountsMessage = `
📋 *قائمة الحسابات*

لا توجد حسابات مضافة بعد.
اضغط على ➕ لإضافة حساب جديد.
`;

const errorOtpExpired = `
⏱ *انتهت صلاحية رمز التحقق*

انتهت صلاحية الرمز. سيتم إرسال رمز جديد.
`;

const errorTooManyAttempts = `
🚫 *محاولات كثيرة جدًا*

لقد تجاوزت الحد الأقصى لمحاولات إدخال الرمز.
الرجاء البدء من جديد.
`;

module.exports = {
  welcomeMessage,
  helpMessage,
  phoneRequestMessage,
  otpRequestMessage,
  passwordRequestMessage,
  successMessage,
  accountCardMessage,
  noAccountsMessage,
  errorOtpExpired,
  errorTooManyAttempts,
  statusEmoji,
  statusText,
};
