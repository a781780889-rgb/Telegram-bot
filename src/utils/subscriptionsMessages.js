/**
 * Subscriptions Messages
 * All message templates for the 💎 الاشتراكات module. Mirrors utils/messages.js
 * and utils/linksMessages.js style/conventions.
 */

const svc = require('../services/subscriptionsService');

const DIV = '─'.repeat(25);

// ─── Shared ───────────────────────────────────────────────────────────────────

const subNoPermissionMessage = '⛔️ هذا القسم مخصص للمشرفين فقط.';

const subAdminMenuMessage =
  `💎 *نظام الاشتراكات*\n${DIV}\n\n` + `لوحة تحكم كاملة لإدارة الباقات والمشتركين والمدفوعات.\n\n` + `اختر أحد الأقسام:`;

const cancelledMessage = '❌ تم إلغاء العملية.';

// ─── Package Wizard ───────────────────────────────────────────────────────────

const pkgWizardNameMessage = '➕ *إضافة باقة جديدة*\n\n*الخطوة 1/9:* أدخل اسم الباقة:';

const pkgWizardDescriptionMessage = (name) =>
  `✅ الاسم: *${name}*\n\n*الخطوة 2/9:* أدخل وصف الباقة (أو اضغط تخطي):`;

const pkgWizardPriceMessage = '*الخطوة 3/9:* أدخل سعر الباقة (رقم فقط، مثال: 49):';

const pkgWizardPriceInvalidMessage = '⚠️ السعر يجب أن يكون رقمًا صحيحًا أو عشريًا أكبر من أو يساوي صفر.';

const pkgWizardCurrencyMessage = '*الخطوة 4/9:* اختر عملة الباقة:';

const pkgWizardCustomCurrencyMessage = 'أدخل رمز العملة (مثال: KWD):';

const pkgWizardDurationMessage = '*الخطوة 5/9:* اختر مدة الاشتراك:';

const pkgWizardCustomDurationMessage = 'أدخل عدد أيام مدة الاشتراك (رقم صحيح):';

const pkgWizardDurationInvalidMessage = '⚠️ عدد الأيام يجب أن يكون رقمًا صحيحًا أكبر من صفر.';

const pkgWizardMaxAccountsMessage =
  '*الخطوة 6/9:* أدخل الحد الأقصى لعدد الحسابات المسموح بها، أو اضغط "غير محدود":';

const pkgWizardMaxOperationsMessage =
  '*الخطوة 7/9:* أدخل الحد الأقصى لعدد العمليات المسموح بها، أو اضغط "غير محدود":';

const pkgWizardMaxUsersMessage =
  '*الخطوة 8/9:* أدخل الحد الأقصى لعدد المستخدمين، أو اضغط "غير محدود":';

const pkgWizardNumberInvalidMessage = '⚠️ الرجاء إدخال رقم صحيح أكبر من أو يساوي صفر.';

const pkgWizardFeaturesMessage =
  '*الخطوة 9/9:* أدخل مميزات الباقة، كل ميزة في سطر منفصل (أو اضغط تخطي):\n\n' +
  'مثال:\n`دعم فني على مدار الساعة`\n`عدد غير محدود من الروابط`';

const pkgWizardSpecialMessage = 'هل هذه باقة مميزة (تظهر بشارة خاصة)؟';

const pkgWizardBadgeLabelMessage = 'أدخل نص الشارة المميزة (مثال: الأكثر طلبًا):';

/**
 * Final review screen before saving a new package.
 * @param {object} data - accumulated wizard data
 */
const pkgWizardReviewMessage = (data) => {
  const features = (data.features || []).length
    ? data.features.map((f) => `  • ${f}`).join('\n')
    : '  لا توجد';
  return (
    `📦 *مراجعة الباقة الجديدة*\n${DIV}\n\n` +
    `*الاسم:* ${data.name}\n` +
    `*الوصف:* ${data.description || 'لا يوجد'}\n` +
    `*السعر:* ${data.price} ${data.currency}\n` +
    `*المدة:* ${svc.formatDuration(data.duration_days)}\n` +
    `*حد الحسابات:* ${data.max_accounts === 0 ? 'غير محدود' : data.max_accounts}\n` +
    `*حد العمليات:* ${data.max_operations === 0 ? 'غير محدود' : data.max_operations}\n` +
    `*حد المستخدمين:* ${data.max_users === 0 ? 'غير محدود' : data.max_users}\n` +
    `*مميزة:* ${data.is_special ? `⭐ نعم (${data.badge_label || 'بدون نص'})` : 'لا'}\n` +
    `*المميزات:*\n${features}\n\n` +
    `تأكيد الحفظ؟`
  );
};

const pkgSavedMessage = (pkg) => `✅ *تم حفظ الباقة بنجاح*\n\n📦 ${pkg.name} — ${pkg.price} ${pkg.currency}`;

const pkgDuplicateNameErrorMessage = (name) =>
  `⚠️ توجد باقة أخرى بنفس الاسم "${name}" بالفعل. الرجاء اختيار اسم مختلف، أو استخدم "📄 نسخ" من قائمة الباقات.`;

// ─── Package List / Detail ────────────────────────────────────────────────────

const pkgNoPackagesMessage = '📋 *إدارة الباقات*\n\nلا توجد باقات بعد. اضغط ➕ لإضافة أول باقة.';

const pkgListHeaderMessage = (total) => `📋 *إدارة الباقات* (${total})\n${DIV}\n\nاختر باقة لعرض تفاصيلها وإدارتها:`;

const pkgDetailMessage = (pkg) => {
  const features = pkg.features?.length ? pkg.features.map((f) => `  • ${f}`).join('\n') : '  لا توجد';
  return (
    `📦 *${pkg.name}*${pkg.is_special ? ' ⭐' : ''}\n${DIV}\n\n` +
    `*الوصف:* ${pkg.description || 'لا يوجد'}\n` +
    `*السعر:* ${svc.formatMoney(pkg.price, pkg.currency)}\n` +
    `*المدة:* ${svc.formatDuration(pkg.duration_days)}\n` +
    `*حد الحسابات:* ${pkg.max_accounts === 0 ? 'غير محدود ♾' : pkg.max_accounts}\n` +
    `*حد العمليات:* ${pkg.max_operations === 0 ? 'غير محدود ♾' : pkg.max_operations}\n` +
    `*حد المستخدمين:* ${pkg.max_users === 0 ? 'غير محدود ♾' : pkg.max_users}\n` +
    `*الحالة:* ${pkg.is_active ? '🟢 مفعّلة' : '⚪️ معطّلة'}\n` +
    `*الترتيب:* ${pkg.sort_order}\n` +
    (pkg.is_special ? `*الشارة:* ${pkg.badge_label || '—'}\n` : '') +
    `*المميزات:*\n${features}\n\n` +
    `أُنشئت في: ${svc.formatDate(pkg.created_at)}`
  );
};

const pkgEditFieldPromptMessage = (fieldLabel, currentValue) =>
  `✏️ *تعديل ${fieldLabel}*\n\nالقيمة الحالية: ${currentValue}\n\nأدخل القيمة الجديدة:`;

const pkgFieldUpdatedMessage = '✅ تم تحديث الباقة بنجاح.\n\nملاحظة: لن يتأثر المشتركون الحاليون بهذا التعديل.';

const pkgToggledMessage = (pkg) => `${pkg.is_active ? '▶️' : '⏸'} الباقة *${pkg.name}* الآن ${pkg.is_active ? 'مفعّلة 🟢' : 'معطّلة ⚪️'}.`;

const pkgSpecialToggledMessage = (pkg) => `⭐ الباقة *${pkg.name}* الآن ${pkg.is_special ? 'مميزة' : 'عادية'}.`;

const pkgDeletedMessage = (pkg) => `🗑 تم حذف الباقة *${pkg.name}*.\n\nملاحظة: بيانات المشتركين والمدفوعات السابقة المرتبطة بها محفوظة بالكامل.`;

const pkgConfirmDeleteMessage = (pkg) =>
  `🗑 *حذف الباقة*\n\nهل تريد حذف الباقة *${pkg.name}*؟\n\nلن يتم حذف بيانات المشتركين أو المدفوعات المرتبطة بها.`;

const pkgDuplicatedMessage = (pkg) => `📄 تم نسخ الباقة إلى *${pkg.name}* (معطّلة افتراضيًا، يمكنك تفعيلها بعد المراجعة).`;

const pkgMovedMessage = '✅ تم تحديث ترتيب الباقة.';
const pkgCannotMoveMessage = '⚠️ لا يمكن تحريك الباقة في هذا الاتجاه.';

// ─── Subscribers ──────────────────────────────────────────────────────────────

const subrNoSubscribersMessage = '👤 *إدارة المشتركين*\n\nلا يوجد مشتركون مطابقون لهذا الفلتر بعد.';

const subrListHeaderMessage = (total, filterLabel) =>
  `👤 *إدارة المشتركين* (${total})\n${DIV}\n\nالفلتر الحالي: ${filterLabel}\n\nاختر مشتركًا لعرض تفاصيله:`;

const subrDetailMessage = (subscriber, pkg) => {
  const days = subscriber.expires_at ? svc.daysRemaining(subscriber.expires_at) : null;
  const name = subscriber.first_name || (subscriber.username ? `@${subscriber.username}` : 'غير معروف');
  return (
    `👤 *${name}*\n${DIV}\n\n` +
    `*معرّف تيليجرام:* \`${subscriber.telegram_user_id}\`\n` +
    `*اسم المستخدم:* ${subscriber.username ? `@${subscriber.username}` : 'لا يوجد'}\n` +
    `*الباقة الحالية:* ${pkg ? pkg.name : 'لا يوجد'}\n` +
    `*الحالة:* ${svc.STATUS_LABELS[subscriber.status] || subscriber.status}\n` +
    `*تاريخ الاشتراك:* ${svc.formatDate(subscriber.subscribed_at)}\n` +
    `*تاريخ الانتهاء:* ${svc.formatDate(subscriber.expires_at)}\n` +
    (days !== null ? `*الأيام المتبقية:* ${days >= 0 ? `${days} يوم` : `منتهي منذ ${Math.abs(days)} يوم`}\n` : '') +
    `*التجديد التلقائي:* ${subscriber.auto_renew ? '✅ مفعّل' : '❌ متوقف'}\n` +
    `*آخر نشاط:* ${svc.formatDateTime(subscriber.last_activity)}` +
    (subscriber.notes ? `\n\n*ملاحظات:* ${subscriber.notes}` : '')
  );
};

const subrHistoryMessage = (subscriber, history) => {
  const name = subscriber.first_name || subscriber.telegram_user_id;
  if (!history.length) return `📜 *سجل اشتراك ${name}*\n\nلا يوجد سجل بعد.`;
  const EVENT_LABELS = {
    subscribed: '🟢 اشتراك جديد', renewed: '♻️ تجديد', extended: '⏱ تمديد',
    package_changed: '🔄 تغيير باقة', suspended: '⏸ إيقاف', reactivated: '▶️ إعادة تفعيل',
    cancelled: '❌ إلغاء', expired: '⛔️ انتهاء',
  };
  const lines = history.map((h) => `${EVENT_LABELS[h.event_type] || h.event_type} — ${svc.formatDateTime(h.created_at)}`);
  return `📜 *سجل اشتراك ${name}*\n${DIV}\n\n${lines.join('\n')}`;
};

const subrChangePackagePromptMessage = 'اختر الباقة الجديدة للمشترك:';

const subrPackageChangedMessage = (pkgName) => `✅ تم تغيير الباقة إلى *${pkgName}*.`;

const subrExtendPromptMessage = 'اختر عدد الأيام لتمديد الاشتراك:';

const subrExtendCustomPromptMessage = 'أدخل عدد الأيام المراد إضافتها:';

const subrExtendedMessage = (days, newExpiry) => `✅ تم تمديد الاشتراك بمقدار ${days} يوم.\n\nتاريخ الانتهاء الجديد: ${svc.formatDate(newExpiry)}`;

const subrRenewedMessage = (pkgName, newExpiry) =>
  `✅ تم تجديد اشتراك *${pkgName}*.\n\nتاريخ الانتهاء الجديد: ${svc.formatDate(newExpiry)}`;

const subrNoPackageForRenewMessage = '⚠️ لا يمكن التجديد: لا توجد باقة مرتبطة بهذا المشترك حاليًا. استخدم "تغيير الباقة" أولًا.';

const subrSuspendedMessage = '⏸ تم إيقاف اشتراك المشترك.';
const subrReactivatedMessage = '▶️ تم إعادة تفعيل اشتراك المشترك.';

const subrConfirmCancelMessage = (name) => `🗑 *حذف الاشتراك*\n\nهل تريد إلغاء اشتراك *${name}* الحالي؟\n\nسيبقى سجل المشترك ومدفوعاته محفوظًا بالكامل.`;

const subrCancelledMessage = '🗑 تم إلغاء اشتراك المشترك. بياناته وسجله محفوظة بالكامل.';

const subrAutoRenewToggledMessage = (enabled) => `🔁 التجديد التلقائي الآن ${enabled ? 'مفعّل ✅' : 'متوقف ❌'}.`;

const subrMessagePromptMessage = 'أدخل نص الرسالة الخاصة التي تريد إرسالها لهذا المشترك:';

const subrMessageSentMessage = '✅ تم إرسال الرسالة بنجاح.';
const subrMessageFailedMessage = '⚠️ تعذّر إرسال الرسالة (قد يكون المستخدم قد أوقف البوت).';

const subrSearchPromptMessage = '🔍 أدخل الاسم أو اسم المستخدم أو معرّف تيليجرام للبحث:';

const subrNotFoundMessage = '⚠️ المشترك غير موجود.';

const FILTER_LABELS = { all: 'الكل', active: 'نشط', expired: 'منتهي', suspended: 'موقوف', cancelled: 'ملغي', none: 'بدون اشتراك' };

// ─── Payments ─────────────────────────────────────────────────────────────────

const payNoPaymentsMessage = '💳 *إدارة المدفوعات*\n\nلا توجد مدفوعات مطابقة لهذا الفلتر بعد.';

const payListHeaderMessage = (total, filterLabel) =>
  `💳 *إدارة المدفوعات* (${total})\n${DIV}\n\nالفلتر الحالي: ${filterLabel}\n\nاختر عملية لعرض تفاصيلها:`;

const payDetailMessage = (payment) => {
  return (
    `💳 *عملية الدفع #${payment.reference_code}*\n${DIV}\n\n` +
    `*العميل:* ${payment.username ? `@${payment.username}` : payment.telegram_user_id}\n` +
    `*معرّف تيليجرام:* \`${payment.telegram_user_id}\`\n` +
    `*الباقة:* ${payment.package_name || 'غير محدد'}\n` +
    `*القيمة الأصلية:* ${svc.formatMoney(payment.original_amount, payment.currency)}\n` +
    (payment.discount_amount > 0
      ? `*الخصم:* ${svc.formatMoney(payment.discount_amount, payment.currency)} ${payment.coupon_code ? `(كود: ${payment.coupon_code})` : ''}\n`
      : '') +
    `*المبلغ النهائي:* ${svc.formatMoney(payment.amount, payment.currency)}\n` +
    `*طريقة الدفع:* ${payment.payment_method}\n` +
    `*الحالة:* ${svc.PAYMENT_STATUS_LABELS[payment.status] || payment.status}\n` +
    `*وقت الطلب:* ${svc.formatDateTime(payment.created_at)}\n` +
    (payment.processed_at ? `*وقت المعالجة:* ${svc.formatDateTime(payment.processed_at)}\n` : '') +
    (payment.admin_note ? `*ملاحظة المشرف:* ${payment.admin_note}\n` : '')
  );
};

const payRejectReasonPromptMessage = 'أدخل سبب رفض عملية الدفع (أو اضغط رفض بدون سبب):';

const payAcceptedMessage = (payment) => `✅ تم قبول الدفعة *${payment.reference_code}* وتفعيل اشتراك المستخدم.`;

const payRejectedMessage = (payment) => `❌ تم رفض الدفعة *${payment.reference_code}*.`;

const payConfirmRefundMessage = (payment) => `↩️ *استرداد الدفع*\n\nهل تريد استرداد الدفعة *${payment.reference_code}* بقيمة ${svc.formatMoney(payment.amount, payment.currency)}؟`;

const payRefundedMessage = (payment) => `↩️ تم تسجيل استرداد الدفعة *${payment.reference_code}*.`;

const paySearchPromptMessage = '🔍 أدخل اسم المستخدم أو معرّف تيليجرام أو رقم مرجع العملية للبحث:';

const PAY_FILTER_LABELS = { all: 'الكل', pending: 'قيد الانتظار', accepted: 'مقبولة', rejected: 'مرفوضة', refunded: 'مستردة' };

// ─── Coupons ──────────────────────────────────────────────────────────────────

const cpnWizardCodeMessage = '🎟 *إنشاء كوبون خصم جديد*\n\n*الخطوة 1/6:* أدخل كود الكوبون، أو اضغط توليد تلقائي:';

const cpnWizardCodeExistsMessage = '⚠️ هذا الكود مستخدم بالفعل. اختر كودًا آخر:';

const cpnWizardNameMessage = '*الخطوة 2/6:* أدخل اسمًا وصفيًا للكوبون (أو اضغط تخطي):';

const cpnWizardTypeMessage = '*الخطوة 3/6:* اختر نوع الخصم:';

const cpnWizardValueMessage = (type) =>
  type === 'percent' ? 'أدخل نسبة الخصم % (مثال: 20):' : 'أدخل قيمة الخصم الثابتة (مثال: 15):';

const cpnWizardValueInvalidMessage = '⚠️ الرجاء إدخال رقم صحيح أكبر من صفر.';
const cpnWizardPercentRangeMessage = '⚠️ نسبة الخصم يجب أن تكون بين 1 و100.';

const cpnWizardMaxUsesMessage = '*الخطوة 4/6:* أدخل الحد الأقصى لعدد مرات الاستخدام، أو اضغط "غير محدود":';

const cpnWizardValidUntilMessage = '*الخطوة 5/6:* حدد تاريخ انتهاء صلاحية الكوبون:';

const cpnWizardDateInputMessage = 'أدخل تاريخ الانتهاء بصيغة YYYY-MM-DD (مثال: 2026-12-31):';

const cpnWizardDateInvalidMessage = '⚠️ صيغة التاريخ غير صحيحة. استخدم الصيغة: YYYY-MM-DD';

const cpnWizardPackagesMessage = '*الخطوة 6/6:* اختر الباقات التي يسري عليها الكوبون (اتركها فارغة ليشمل كل الباقات):';

const cpnWizardReviewMessage = (data) =>
  `🎟 *مراجعة الكوبون*\n${DIV}\n\n` +
  `*الكود:* \`${data.code}\`\n` +
  `*الاسم:* ${data.name || 'بدون اسم'}\n` +
  `*الخصم:* ${data.discount_type === 'percent' ? `${data.discount_value}%` : `${data.discount_value} (قيمة ثابتة)`}\n` +
  `*الحد الأقصى للاستخدام:* ${data.max_uses === 0 ? 'غير محدود' : data.max_uses}\n` +
  `*تاريخ الانتهاء:* ${data.valid_until ? svc.formatDate(data.valid_until) : 'بدون تاريخ انتهاء'}\n` +
  `*الباقات المشمولة:* ${data.allowed_package_ids?.length ? `${data.allowed_package_ids.length} باقة محددة` : 'كل الباقات'}`;

const cpnSavedMessage = (coupon) => `✅ *تم إنشاء الكوبون بنجاح*\n\nالكود: \`${coupon.code}\``;

const cpnNoCouponsMessage = '🎟 *الكوبونات*\n\nلا توجد كوبونات بعد. اضغط لإنشاء أول كوبون.';

const cpnListHeaderMessage = (total) => `🎟 *إدارة الكوبونات* (${total})\n${DIV}\n\nاختر كوبونًا لعرض تفاصيله:`;

const cpnDetailMessage = (coupon) => {
  const pkgScope = coupon.allowed_package_ids?.length ? `${coupon.allowed_package_ids.length} باقة محددة` : 'كل الباقات';
  const userScope = coupon.allowed_user_ids?.length ? `${coupon.allowed_user_ids.length} مستخدم محدد` : 'الجميع';
  return (
    `🎟 *${coupon.code}*\n${DIV}\n\n` +
    `*الاسم:* ${coupon.name || 'بدون اسم'}\n` +
    `*الخصم:* ${coupon.discount_type === 'percent' ? `${coupon.discount_value}%` : `${coupon.discount_value} (قيمة ثابتة)`}\n` +
    `*الاستخدام:* ${coupon.used_count} / ${coupon.max_uses === 0 ? 'غير محدود' : coupon.max_uses}\n` +
    `*صالح من:* ${coupon.valid_from ? svc.formatDate(coupon.valid_from) : 'فورًا'}\n` +
    `*صالح حتى:* ${coupon.valid_until ? svc.formatDate(coupon.valid_until) : 'بدون تاريخ انتهاء'}\n` +
    `*الباقات المشمولة:* ${pkgScope}\n` +
    `*المستخدمون المسموح لهم:* ${userScope}\n` +
    `*الحالة:* ${coupon.is_active ? '🟢 مفعّل' : '⚪️ معطّل'}\n` +
    `*أُنشئ في:* ${svc.formatDate(coupon.created_at)}`
  );
};

const cpnToggledMessage = (coupon) => `الكوبون *${coupon.code}* الآن ${coupon.is_active ? 'مفعّل 🟢' : 'معطّل ⚪️'}.`;

const cpnConfirmDeleteMessage = (coupon) => `🗑 هل تريد حذف الكوبون *${coupon.code}*؟\n\nسجل استخدامه السابق سيبقى محفوظًا.`;

const cpnDeletedMessage = (coupon) => `🗑 تم حذف الكوبون *${coupon.code}*.`;

// ─── Offers ───────────────────────────────────────────────────────────────────

const OFFER_TYPE_LABELS = {
  discount: '💸 خصم', bogo: '🎁 اشترِ واحدة واحصل على أخرى',
  free_extension: '⏱ تمديد مجاني', free_upgrade: '⬆️ ترقية مجانية', limited_time: '🕐 عرض لفترة محددة',
};

const ofrWizardTitleMessage = '🎁 *إنشاء عرض جديد*\n\n*الخطوة 1/5:* أدخل عنوان العرض:';

const ofrWizardDescriptionMessage = '*الخطوة 2/5:* أدخل وصف العرض (أو اضغط تخطي):';

const ofrWizardTypeMessage = '*الخطوة 3/5:* اختر نوع العرض:';

const ofrWizardValueMessage = (type) => {
  if (type === 'discount') return 'أدخل نسبة الخصم % (مثال: 15). سيُطبّق تلقائيًا على سعر الباقة في المتجر:';
  return 'أدخل تفاصيل العرض (نص حر يوضّح ما يحصل عليه المشترك):';
};

const ofrWizardPackageMessage = '*الخطوة 4/5:* اختر الباقة التي يسري عليها العرض:';

const ofrWizardEndDateMessage = '*الخطوة 5/5:* حدد نهاية سريان العرض:';

const ofrWizardDateInputMessage = 'أدخل تاريخ الانتهاء بصيغة YYYY-MM-DD:';

const ofrSavedMessage = (offer) => `✅ *تم إنشاء العرض بنجاح*\n\n🎁 ${offer.title}`;

const ofrNoOffersMessage = '🎁 *العروض والباقات الخاصة*\n\nلا توجد عروض بعد.';

const ofrListHeaderMessage = (total) => `🎁 *العروض والباقات الخاصة* (${total})\n${DIV}\n\nاختر عرضًا لعرض تفاصيله:`;

const ofrDetailMessage = (offer, pkgName) =>
  `🎁 *${offer.title}*\n${DIV}\n\n` +
  `*النوع:* ${OFFER_TYPE_LABELS[offer.offer_type] || offer.offer_type}\n` +
  `*الوصف:* ${offer.description || 'لا يوجد'}\n` +
  `*الباقة:* ${pkgName || 'كل الباقات'}\n` +
  (offer.offer_type === 'discount' && offer.value?.percent ? `*نسبة الخصم:* ${offer.value.percent}%\n` : '') +
  `*يبدأ:* ${offer.starts_at ? svc.formatDate(offer.starts_at) : 'فورًا'}\n` +
  `*ينتهي:* ${offer.ends_at ? svc.formatDate(offer.ends_at) : 'بدون تاريخ انتهاء'}\n` +
  `*الحالة:* ${offer.is_active ? '🟢 مفعّل' : '⚪️ معطّل'}`;

const ofrToggledMessage = (offer) => `العرض *${offer.title}* الآن ${offer.is_active ? 'مفعّل 🟢' : 'معطّل ⚪️'}.`;

const ofrConfirmDeleteMessage = (offer) => `🗑 هل تريد حذف العرض *${offer.title}*؟`;

const ofrDeletedMessage = (offer) => `🗑 تم حذف العرض *${offer.title}*.`;

// ─── Alerts & Settings ────────────────────────────────────────────────────────

const alertsHeaderMessage = '🔔 *تنبيهات الاشتراكات*\n\nاختر التنبيهات التي تريد تفعيلها أو إيقافها:';

const settingsHeaderMessage = '⚙️ *إعدادات الاشتراكات*\n\nاضغط على أي إعداد لتعديله:';

const settingsTaxPromptMessage = (current) => `💰 نسبة الضريبة الحالية: ${current}%\n\nأدخل النسبة الجديدة (رقم من 0 إلى 100):`;

const settingsTaxInvalidMessage = '⚠️ الرجاء إدخال رقم بين 0 و100.';

const SETTINGS_MESSAGE_LABELS = {
  welcome_message: 'رسالة الترحيب', expiry_message: 'رسالة انتهاء الاشتراك',
  pre_expiry_message: 'رسالة ما قبل الانتهاء', renewal_message: 'رسالة التجديد',
};

const settingsMessageEditPromptMessage = (key, current) =>
  `✏️ *تعديل ${SETTINGS_MESSAGE_LABELS[key] || key}*\n\nالنص الحالي:\n"${current}"\n\n` +
  `أدخل النص الجديد (يمكن استخدام {name} و{days} و{package} كمتغيرات):`;

const settingsUpdatedMessage = '✅ تم تحديث الإعداد بنجاح.';

// ─── Operations Log ───────────────────────────────────────────────────────────

const logEmptyMessage = '📜 *سجل العمليات*\n\nلا توجد عمليات مسجلة بعد.';

const LOG_ACTION_LABELS = {
  package_created: 'إنشاء باقة', package_updated: 'تعديل باقة', package_deleted: 'حذف باقة',
  package_toggled: 'تفعيل/تعطيل باقة', payment_accepted: 'قبول دفعة', payment_rejected: 'رفض دفعة',
  payment_refunded: 'استرداد دفعة', coupon_created: 'إنشاء كوبون', coupon_used: 'استخدام كوبون',
  coupon_deleted: 'حذف كوبون', offer_created: 'إنشاء عرض', offer_deleted: 'حذف عرض',
  subscriber_extended: 'تمديد اشتراك', subscriber_renewed: 'تجديد اشتراك', subscriber_suspended: 'إيقاف اشتراك',
  subscriber_reactivated: 'إعادة تفعيل اشتراك', subscriber_cancelled: 'إلغاء اشتراك',
  subscriber_package_changed: 'تغيير باقة مشترك', subscription_expired: 'انتهاء اشتراك',
  alert_pre_expiry_sent: 'تنبيه ما قبل الانتهاء', settings_updated: 'تعديل إعدادات',
};

const logHeaderMessage = (total) => `📜 *سجل العمليات* (${total})\n${DIV}\n`;

const logEntryLine = (entry) => {
  const label = LOG_ACTION_LABELS[entry.action_type] || entry.action_type;
  const statusIcon = entry.status === 'success' ? '✅' : '❌';
  const actor = entry.actor_role === 'system' ? '🤖 النظام' : entry.actor_name || entry.actor_id || 'مشرف';
  return (
    `${statusIcon} *${label}*\n` +
    `   👤 ${actor} — 🕐 ${svc.formatDateTime(entry.created_at)}` +
    (entry.reason ? `\n   💬 ${entry.reason}` : '')
  );
};

const logListMessage = (page) => `${logHeaderMessage(page.total)}\n${page.rows.map(logEntryLine).join('\n\n')}`;

// ─── Statistics ───────────────────────────────────────────────────────────────

const statsDashboardMessage = (stats) => {
  const topPackagesText = stats.topPackages.length
    ? stats.topPackages.map((p, i) => `  ${i + 1}. ${p.package_name || '—'} (${p.sales} عملية)`).join('\n')
    : '  لا توجد بيانات بعد';

  return (
    `📊 *لوحة إحصائيات الاشتراكات*\n${DIV}\n\n` +
    `👥 *إجمالي المشتركين:* ${stats.totalSubscribers}\n` +
    `🟢 *اشتراكات نشطة:* ${stats.activeSubscriptions}\n` +
    `🔴 *اشتراكات منتهية:* ${stats.expiredSubscriptions}\n` +
    `♻️ *اشتراكات مجدَّدة:* ${stats.renewedCount}\n` +
    `📈 *معدل التجديد:* ${stats.renewalRate}%\n\n` +
    `💰 *إجمالي الإيرادات:* ${svc.formatMoney(stats.totalRevenue)}\n` +
    `📅 *إيرادات اليوم:* ${svc.formatMoney(stats.revenueToday)}\n` +
    `🗓 *إيرادات الشهر:* ${svc.formatMoney(stats.revenueThisMonth)}\n` +
    `📆 *إيرادات السنة:* ${svc.formatMoney(stats.revenueThisYear)}\n\n` +
    `🏆 *أكثر الباقات مبيعًا:*\n${topPackagesText}\n\n` +
    `✅ *مدفوعات ناجحة:* ${stats.successfulPayments}\n` +
    `❌ *مدفوعات مرفوضة:* ${stats.rejectedPayments}\n` +
    `⏳ *مدفوعات قيد الانتظار:* ${stats.pendingPayments}\n` +
    `🎟 *كوبونات مُستخدمة:* ${stats.couponsUsed}`
  );
};

// ─── Storefront (subscriber-facing) ───────────────────────────────────────────

const storeMenuMessage = (welcomeMsg) => `💎 *الاشتراكات*\n${DIV}\n\n${welcomeMsg}`;

const storeNoSubscriptionMessage = '💼 *اشتراكي الحالي*\n\nلا يوجد لديك اشتراك نشط حاليًا.\n\nتصفّح الباقات المتاحة للاشتراك.';

const storeMySubscriptionMessage = (subscriber, pkg) => {
  const days = subscriber.expires_at ? svc.daysRemaining(subscriber.expires_at) : null;
  return (
    `💼 *اشتراكي الحالي*\n${DIV}\n\n` +
    `*الباقة:* ${pkg ? pkg.name : 'غير محدد'}\n` +
    `*الحالة:* ${svc.STATUS_LABELS[subscriber.status] || subscriber.status}\n` +
    `*تاريخ الانتهاء:* ${svc.formatDate(subscriber.expires_at)}\n` +
    (days !== null ? `*الأيام المتبقية:* ${days >= 0 ? `${days} يوم` : 'منتهي'}\n` : '') +
    (pkg
      ? `\n*مميزاتك:*\n${(pkg.features || []).map((f) => `  • ${f}`).join('\n') || '  لا توجد'}`
      : '')
  );
};

const storeNoPackagesMessage = '📦 لا توجد باقات متاحة للاشتراك حاليًا. تابعنا لاحقًا!';

const storePackagesHeaderMessage = '📦 *الباقات المتاحة*\n\nاختر الباقة المناسبة لك:';

const storePackageDetailMessage = (pkg, priceInfo) => {
  const features = pkg.features?.length ? pkg.features.map((f) => `  ✓ ${f}`).join('\n') : '  لا توجد تفاصيل إضافية';
  const priceLine =
    priceInfo.offer && priceInfo.finalPrice !== pkg.price
      ? `~${svc.formatMoney(pkg.price, pkg.currency)}~  ➜  *${svc.formatMoney(priceInfo.finalPrice, pkg.currency)}* 🎁 (${priceInfo.offer.title})`
      : `*${svc.formatMoney(pkg.price, pkg.currency)}*`;

  return (
    `📦 *${pkg.name}*${pkg.is_special ? ` ${pkg.badge_label ? `⭐ ${pkg.badge_label}` : '⭐'}` : ''}\n${DIV}\n\n` +
    `${pkg.description || ''}\n\n` +
    `💰 *السعر:* ${priceLine}\n` +
    `⏱ *المدة:* ${svc.formatDuration(pkg.duration_days)}\n\n` +
    `*المميزات:*\n${features}`
  );
};

const storeCouponPromptMessage = 'هل لديك كود خصم تريد استخدامه؟';

const storeCouponEnterMessage = '🎟 أدخل كود الخصم:';

const storeCouponInvalidMessage = (reason) => `❌ ${reason}\n\nيمكنك المتابعة بدون كود أو إدخال كود آخر.`;

const storeCouponAppliedMessage = (result, currency) =>
  `✅ تم تطبيق الكود بنجاح! خصم ${svc.formatMoney(result.discountAmount, currency)}.`;

const storeConfirmMessage = (pkg, finalPrice, couponResult) => {
  let text = `🧾 *مراجعة الطلب*\n${DIV}\n\n*الباقة:* ${pkg.name}\n*المدة:* ${svc.formatDuration(pkg.duration_days)}\n`;
  if (couponResult?.valid) {
    text += `*السعر الأصلي:* ${svc.formatMoney(pkg.price, pkg.currency)}\n`;
    text += `*الخصم:* ${svc.formatMoney(couponResult.discountAmount, pkg.currency)} (${couponResult.coupon.code})\n`;
  }
  text += `*المبلغ المطلوب:* ${svc.formatMoney(finalPrice, pkg.currency)}\n\n`;
  text += `بعد التأكيد سيتم إرسال طلبك للإدارة للمراجعة والتفعيل.`;
  return text;
};

const storeRequestCreatedMessage = (payment) =>
  `✅ *تم إرسال طلبك بنجاح*\n\nرقم المرجع: \`${payment.reference_code}\`\n\n` +
  `سيتم مراجعة طلبك وتفعيل اشتراكك في أقرب وقت. ستصلك رسالة فور المعالجة.`;

const storeAlreadyPendingMessage = (payment) =>
  `⏳ لديك طلب اشتراك قيد المراجعة بالفعل لهذه الباقة (رقم المرجع: \`${payment.reference_code}\`).\n\nالرجاء انتظار مراجعته من الإدارة.`;

const storeOffersHeaderMessage = '🎁 *العروض الحالية*';

const storeNoOffersMessage = '🎁 لا توجد عروض حالية. تابعنا لاحقًا!';

const storeOfferCard = (offer, pkgName) =>
  `🎁 *${offer.title}*\n${offer.description ? `${offer.description}\n` : ''}` +
  `${pkgName ? `📦 يسري على: ${pkgName}\n` : '📦 يسري على: كل الباقات\n'}` +
  `${offer.ends_at ? `⏰ ينتهي في: ${svc.formatDate(offer.ends_at)}` : '⏰ بدون تاريخ انتهاء'}`;

const storeHistoryHeaderMessage = '📜 *سجل اشتراكي ومدفوعاتي*';

const storeHistoryEmptyMessage = '📜 لا يوجد سجل مدفوعات بعد.';

const storePaymentLine = (p) =>
  `${svc.PAYMENT_STATUS_LABELS[p.status] || p.status} — ${p.package_name || ''} — ${svc.formatMoney(p.amount, p.currency)} — ${svc.formatDate(p.created_at)}`;

// ─── Admin notifications ──────────────────────────────────────────────────────

const adminNewPaymentNotification = (payment) =>
  `🔔 *طلب اشتراك جديد*\n${DIV}\n\n` +
  `👤 ${payment.username ? `@${payment.username}` : payment.telegram_user_id} (\`${payment.telegram_user_id}\`)\n` +
  `📦 الباقة: ${payment.package_name}\n` +
  `💰 المبلغ: ${svc.formatMoney(payment.amount, payment.currency)}\n` +
  (payment.coupon_code ? `🎟 كوبون مستخدم: ${payment.coupon_code}\n` : '') +
  `🔖 المرجع: \`${payment.reference_code}\`\n\n` +
  `يرجى المراجعة من قسم 💳 إدارة المدفوعات.`;

module.exports = {
  subNoPermissionMessage,
  subAdminMenuMessage,
  cancelledMessage,
  // package wizard
  pkgWizardNameMessage,
  pkgWizardDescriptionMessage,
  pkgWizardPriceMessage,
  pkgWizardPriceInvalidMessage,
  pkgWizardCurrencyMessage,
  pkgWizardCustomCurrencyMessage,
  pkgWizardDurationMessage,
  pkgWizardCustomDurationMessage,
  pkgWizardDurationInvalidMessage,
  pkgWizardMaxAccountsMessage,
  pkgWizardMaxOperationsMessage,
  pkgWizardMaxUsersMessage,
  pkgWizardNumberInvalidMessage,
  pkgWizardFeaturesMessage,
  pkgWizardSpecialMessage,
  pkgWizardBadgeLabelMessage,
  pkgWizardReviewMessage,
  pkgSavedMessage,
  pkgDuplicateNameErrorMessage,
  // packages list/detail
  pkgNoPackagesMessage,
  pkgListHeaderMessage,
  pkgDetailMessage,
  pkgEditFieldPromptMessage,
  pkgFieldUpdatedMessage,
  pkgToggledMessage,
  pkgSpecialToggledMessage,
  pkgDeletedMessage,
  pkgConfirmDeleteMessage,
  pkgDuplicatedMessage,
  pkgMovedMessage,
  pkgCannotMoveMessage,
  // subscribers
  subrNoSubscribersMessage,
  subrListHeaderMessage,
  subrDetailMessage,
  subrHistoryMessage,
  subrChangePackagePromptMessage,
  subrPackageChangedMessage,
  subrExtendPromptMessage,
  subrExtendCustomPromptMessage,
  subrExtendedMessage,
  subrRenewedMessage,
  subrNoPackageForRenewMessage,
  subrSuspendedMessage,
  subrReactivatedMessage,
  subrConfirmCancelMessage,
  subrCancelledMessage,
  subrAutoRenewToggledMessage,
  subrMessagePromptMessage,
  subrMessageSentMessage,
  subrMessageFailedMessage,
  subrSearchPromptMessage,
  subrNotFoundMessage,
  FILTER_LABELS,
  // payments
  payNoPaymentsMessage,
  payListHeaderMessage,
  payDetailMessage,
  payRejectReasonPromptMessage,
  payAcceptedMessage,
  payRejectedMessage,
  payConfirmRefundMessage,
  payRefundedMessage,
  paySearchPromptMessage,
  PAY_FILTER_LABELS,
  // coupons
  cpnWizardCodeMessage,
  cpnWizardCodeExistsMessage,
  cpnWizardNameMessage,
  cpnWizardTypeMessage,
  cpnWizardValueMessage,
  cpnWizardValueInvalidMessage,
  cpnWizardPercentRangeMessage,
  cpnWizardMaxUsesMessage,
  cpnWizardValidUntilMessage,
  cpnWizardDateInputMessage,
  cpnWizardDateInvalidMessage,
  cpnWizardPackagesMessage,
  cpnWizardReviewMessage,
  cpnSavedMessage,
  cpnNoCouponsMessage,
  cpnListHeaderMessage,
  cpnDetailMessage,
  cpnToggledMessage,
  cpnConfirmDeleteMessage,
  cpnDeletedMessage,
  // offers
  OFFER_TYPE_LABELS,
  ofrWizardTitleMessage,
  ofrWizardDescriptionMessage,
  ofrWizardTypeMessage,
  ofrWizardValueMessage,
  ofrWizardPackageMessage,
  ofrWizardEndDateMessage,
  ofrWizardDateInputMessage,
  ofrSavedMessage,
  ofrNoOffersMessage,
  ofrListHeaderMessage,
  ofrDetailMessage,
  ofrToggledMessage,
  ofrConfirmDeleteMessage,
  ofrDeletedMessage,
  // alerts & settings
  alertsHeaderMessage,
  settingsHeaderMessage,
  settingsTaxPromptMessage,
  settingsTaxInvalidMessage,
  SETTINGS_MESSAGE_LABELS,
  settingsMessageEditPromptMessage,
  settingsUpdatedMessage,
  // log
  logEmptyMessage,
  logListMessage,
  // stats
  statsDashboardMessage,
  // storefront
  storeMenuMessage,
  storeNoSubscriptionMessage,
  storeMySubscriptionMessage,
  storeNoPackagesMessage,
  storePackagesHeaderMessage,
  storePackageDetailMessage,
  storeCouponPromptMessage,
  storeCouponEnterMessage,
  storeCouponInvalidMessage,
  storeCouponAppliedMessage,
  storeConfirmMessage,
  storeRequestCreatedMessage,
  storeAlreadyPendingMessage,
  storeOffersHeaderMessage,
  storeNoOffersMessage,
  storeOfferCard,
  storeHistoryHeaderMessage,
  storeHistoryEmptyMessage,
  storePaymentLine,
  // admin notifications
  adminNewPaymentNotification,
};
