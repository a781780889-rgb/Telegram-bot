/**
 * Subscriptions Keyboards
 * All inline keyboards for the 💎 الاشتراكات module — admin console screens
 * and the subscriber-facing storefront. Mirrors utils/linksKeyboards.js style.
 */

const { Markup } = require('telegraf');

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Standard prev/page-indicator/next row used by every paginated list screen.
 * @param {string} prefix e.g. 'sub_pkg_page'
 * @param {number} page
 * @param {number} totalPages
 */
const paginationRow = (prefix, page, totalPages) => {
  if (totalPages <= 1) return [];
  const row = [];
  row.push(
    page > 1
      ? Markup.button.callback('◀️', `${prefix}_${page - 1}`)
      : Markup.button.callback(' ', 'sub_noop')
  );
  row.push(Markup.button.callback(`📄 ${page}/${totalPages}`, 'sub_noop'));
  row.push(
    page < totalPages
      ? Markup.button.callback('▶️', `${prefix}_${page + 1}`)
      : Markup.button.callback(' ', 'sub_noop')
  );
  return [row];
};

const yesNoRow = (yesData, noData, yesLabel = '✅ نعم', noLabel = '❌ لا') =>
  Markup.inlineKeyboard([[Markup.button.callback(yesLabel, yesData), Markup.button.callback(noLabel, noData)]]);

// ─── Root Menu ────────────────────────────────────────────────────────────────

const subAdminMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('➕ إضافة باقة', 'sub_pkg_add')],
    [Markup.button.callback('📋 إدارة الباقات', 'sub_pkg_list')],
    [Markup.button.callback('👤 إدارة المشتركين', 'sub_subr_list')],
    [Markup.button.callback('💳 إدارة المدفوعات', 'sub_pay_list')],
    [Markup.button.callback('🎟 إنشاء كوبون خصم', 'sub_cpn_add')],
    [Markup.button.callback('🎁 العروض والباقات الخاصة', 'sub_ofr_list')],
    [Markup.button.callback('🔑 أكواد التفعيل', 'sub_code_list')],
    [Markup.button.callback('🔔 تنبيهات الاشتراكات', 'sub_alerts')],
    [Markup.button.callback('📊 الإحصائيات', 'sub_stats')],
    [Markup.button.callback('📜 سجل العمليات', 'sub_log')],
    [Markup.button.callback('⚙️ إعدادات الاشتراكات', 'sub_settings')],
    [Markup.button.callback('⬅️ رجوع', 'main_menu')],
  ]);

const subBackToMenuKeyboard = () =>
  Markup.inlineKeyboard([[Markup.button.callback('⬅️ رجوع لقائمة الاشتراكات', 'sub_menu')]]);

const subCancelKeyboard = () => Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'sub_cancel')]]);

// ─── Packages ─────────────────────────────────────────────────────────────────

const CURRENCIES = ['SAR', 'USD', 'AED', 'EGP', 'YER', 'KWD', 'QAR'];

const pkgCurrencyKeyboard = () => {
  const rows = [];
  for (let i = 0; i < CURRENCIES.length; i += 3) {
    rows.push(
      CURRENCIES.slice(i, i + 3).map((c) => Markup.button.callback(c, `sub_pkgw_cur_${c}`))
    );
  }
  rows.push([Markup.button.callback('✏️ عملة أخرى', 'sub_pkgw_cur_custom')]);
  rows.push([Markup.button.callback('❌ إلغاء', 'sub_cancel')]);
  return Markup.inlineKeyboard(rows);
};

const pkgDurationKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('7 أيام', 'sub_pkgw_dur_7'),
      Markup.button.callback('30 يوم', 'sub_pkgw_dur_30'),
    ],
    [
      Markup.button.callback('90 يوم', 'sub_pkgw_dur_90'),
      Markup.button.callback('365 يوم', 'sub_pkgw_dur_365'),
    ],
    [Markup.button.callback('✏️ مدة مخصصة', 'sub_pkgw_dur_custom')],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const pkgUnlimitedOrTextKeyboard = (field) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('♾ غير محدود', `sub_pkgw_unlim_${field}`)],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const pkgSkipKeyboard = (skipData) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('⏭ تخطي', skipData)],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

/** Generic alias of pkgSkipKeyboard — used by coupon/offer text prompts too. */
const skipKeyboard = pkgSkipKeyboard;

const pkgSpecialBadgeKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('⭐ نعم، باقة مميزة', 'sub_pkgw_special_yes'),
      Markup.button.callback('عادية', 'sub_pkgw_special_no'),
    ],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const pkgReviewKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✅ حفظ الباقة', 'sub_pkgw_confirm')],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const pkgListKeyboard = (packages, page, totalPages) => {
  const rows = packages.map((p) => {
    const stateIcon = p.is_active ? '🟢' : '⚪️';
    const specialIcon = p.is_special ? '⭐ ' : '';
    return [Markup.button.callback(`${stateIcon} ${specialIcon}${p.name.slice(0, 28)}`, `sub_pkg_view_${p.id}`)];
  });
  rows.push(...paginationRow('sub_pkg_page', page, totalPages));
  rows.push([Markup.button.callback('➕ إضافة باقة', 'sub_pkg_add')]);
  rows.push([Markup.button.callback('⬅️ رجوع', 'sub_menu')]);
  return Markup.inlineKeyboard(rows);
};

const pkgDetailKeyboard = (pkg) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('✏️ تعديل', `sub_pkg_edit_${pkg.id}`),
      Markup.button.callback(pkg.is_active ? '⏸ تعطيل' : '▶️ تفعيل', `sub_pkg_toggle_${pkg.id}`),
    ],
    [
      Markup.button.callback('⬆️', `sub_pkg_up_${pkg.id}`),
      Markup.button.callback('⬇️', `sub_pkg_down_${pkg.id}`),
      Markup.button.callback('📄 نسخ', `sub_pkg_dup_${pkg.id}`),
    ],
    [Markup.button.callback(pkg.is_special ? '⭐ إلغاء التمييز' : '⭐ جعلها مميزة', `sub_pkg_special_${pkg.id}`)],
    [Markup.button.callback('🗑 حذف', `sub_pkg_del_${pkg.id}`)],
    [Markup.button.callback('⬅️ رجوع للقائمة', 'sub_pkg_list')],
  ]);

const pkgEditFieldKeyboard = (pkgId) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('الاسم', `sub_pkg_field_name_${pkgId}`),
      Markup.button.callback('الوصف', `sub_pkg_field_description_${pkgId}`),
    ],
    [
      Markup.button.callback('السعر', `sub_pkg_field_price_${pkgId}`),
      Markup.button.callback('العملة', `sub_pkg_field_currency_${pkgId}`),
    ],
    [
      Markup.button.callback('المدة (أيام)', `sub_pkg_field_duration_days_${pkgId}`),
      Markup.button.callback('المميزات', `sub_pkg_field_features_${pkgId}`),
    ],
    [
      Markup.button.callback('حد الحسابات', `sub_pkg_field_max_accounts_${pkgId}`),
      Markup.button.callback('حد العمليات', `sub_pkg_field_max_operations_${pkgId}`),
    ],
    [Markup.button.callback('حد المستخدمين', `sub_pkg_field_max_users_${pkgId}`)],
    [Markup.button.callback('⬅️ رجوع', `sub_pkg_view_${pkgId}`)],
  ]);

const pkgConfirmDeleteKeyboard = (pkgId) =>
  yesNoRow(`sub_pkg_delyes_${pkgId}`, `sub_pkg_view_${pkgId}`, '✅ نعم، احذف', '❌ لا، إلغاء');

// ─── Subscribers ──────────────────────────────────────────────────────────────

const SUBR_FILTERS = [
  ['الكل', 'all'], ['نشط', 'active'], ['منتهي', 'expired'],
  ['موقوف', 'suspended'], ['ملغي', 'cancelled'],
];

const subrListKeyboard = (subscribers, page, totalPages, currentFilter = 'all') => {
  const rows = [];
  const filterRow = SUBR_FILTERS.map(([label, val]) =>
    Markup.button.callback(val === currentFilter ? `• ${label}` : label, `sub_subr_filter_${val}`)
  );
  rows.push(filterRow.slice(0, 3));
  if (filterRow.length > 3) rows.push(filterRow.slice(3));

  subscribers.forEach((s) => {
    const icon = { active: '🟢', expired: '🔴', suspended: '⏸', cancelled: '⚪️', none: '⚫️' }[s.status] || '⚫️';
    const name = s.first_name || (s.username ? `@${s.username}` : s.telegram_user_id);
    rows.push([Markup.button.callback(`${icon} ${name.slice(0, 28)}`, `sub_subr_view_${s.id}`)]);
  });

  rows.push(...paginationRow('sub_subr_page', page, totalPages));
  rows.push([Markup.button.callback('🔍 بحث', 'sub_subr_search')]);
  rows.push([Markup.button.callback('⬅️ رجوع', 'sub_menu')]);
  return Markup.inlineKeyboard(rows);
};

const subrDetailKeyboard = (subscriber) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('🔄 تغيير الباقة', `sub_subr_changepkg_${subscriber.id}`),
      Markup.button.callback('⏱ تمديد', `sub_subr_extend_${subscriber.id}`),
    ],
    [
      Markup.button.callback('♻️ تجديد', `sub_subr_renew_${subscriber.id}`),
      subscriber.status === 'suspended'
        ? Markup.button.callback('▶️ إعادة تفعيل', `sub_subr_reactivate_${subscriber.id}`)
        : Markup.button.callback('⏸ إيقاف', `sub_subr_suspend_${subscriber.id}`),
    ],
    [
      Markup.button.callback('✉️ رسالة خاصة', `sub_subr_msg_${subscriber.id}`),
      Markup.button.callback('📜 سجل الاشتراك', `sub_subr_history_${subscriber.id}`),
    ],
    [Markup.button.callback('📝 ملاحظة إدارية', `sub_subr_notes_${subscriber.id}`)],
    [Markup.button.callback(subscriber.auto_renew ? '🔁 إلغاء التجديد التلقائي' : '🔁 تفعيل التجديد التلقائي', `sub_subr_autorenew_${subscriber.id}`)],
    [Markup.button.callback('🗑 حذف الاشتراك', `sub_subr_cancel_${subscriber.id}`)],
    [Markup.button.callback('⬅️ رجوع للقائمة', 'sub_subr_list')],
  ]);

/** Package picker used both by "change package" (admin) and storefront subscribe. */
const packagePickerKeyboard = (packages, callbackPrefix, backData) => {
  const rows = packages.map((p) => [
    Markup.button.callback(`${p.is_special ? '⭐ ' : ''}${p.name} — ${p.price} ${p.currency}`, `${callbackPrefix}_${p.id}`),
  ]);
  rows.push([Markup.button.callback('⬅️ رجوع', backData)]);
  return Markup.inlineKeyboard(rows);
};

const subrExtendKeyboard = (id) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('+7 أيام', `sub_subr_extenddays_${id}_7`),
      Markup.button.callback('+30 يوم', `sub_subr_extenddays_${id}_30`),
      Markup.button.callback('+90 يوم', `sub_subr_extenddays_${id}_90`),
    ],
    [Markup.button.callback('✏️ عدد أيام مخصص', `sub_subr_extendcustom_${id}`)],
    [Markup.button.callback('⬅️ رجوع', `sub_subr_view_${id}`)],
  ]);

const subrConfirmCancelKeyboard = (id) =>
  yesNoRow(`sub_subr_cancelyes_${id}`, `sub_subr_view_${id}`, '✅ نعم، احذف الاشتراك', '❌ تراجع');

const subrHistoryKeyboard = (id) =>
  Markup.inlineKeyboard([[Markup.button.callback('⬅️ رجوع', `sub_subr_view_${id}`)]]);

// ─── Payments ─────────────────────────────────────────────────────────────────

const PAY_FILTERS = [['الكل', 'all'], ['قيد الانتظار', 'pending'], ['مقبولة', 'accepted'], ['مرفوضة', 'rejected'], ['مستردة', 'refunded']];

const payListKeyboard = (payments, page, totalPages, currentFilter = 'all') => {
  const rows = [];
  const filterRow = PAY_FILTERS.map(([label, val]) =>
    Markup.button.callback(val === currentFilter ? `• ${label}` : label, `sub_pay_filter_${val}`)
  );
  rows.push(filterRow.slice(0, 3));
  rows.push(filterRow.slice(3));

  const statusIcon = { pending: '⏳', accepted: '✅', rejected: '❌', refunded: '↩️' };
  payments.forEach((p) => {
    const label = `${statusIcon[p.status] || ''} ${p.reference_code} — ${p.amount} ${p.currency}`;
    rows.push([Markup.button.callback(label, `sub_pay_view_${p.id}`)]);
  });

  rows.push(...paginationRow('sub_pay_page', page, totalPages));
  rows.push([Markup.button.callback('🔍 بحث', 'sub_pay_search')]);
  rows.push([Markup.button.callback('⬅️ رجوع', 'sub_menu')]);
  return Markup.inlineKeyboard(rows);
};

const payDetailKeyboard = (payment) => {
  const rows = [];
  if (payment.status === 'pending') {
    rows.push([
      Markup.button.callback('✅ قبول الدفع', `sub_pay_accept_${payment.id}`),
      Markup.button.callback('❌ رفض الدفع', `sub_pay_reject_${payment.id}`),
    ]);
  }
  if (payment.status === 'accepted') {
    rows.push([Markup.button.callback('↩️ استرداد الدفع', `sub_pay_refund_${payment.id}`)]);
  }
  rows.push([Markup.button.callback('⬅️ رجوع للقائمة', 'sub_pay_list')]);
  return Markup.inlineKeyboard(rows);
};

const payConfirmRefundKeyboard = (id) =>
  yesNoRow(`sub_pay_refundyes_${id}`, `sub_pay_view_${id}`, '✅ نعم، استرداد', '❌ إلغاء');

const paySkipReasonKeyboard = (id) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('⏭ رفض بدون سبب', `sub_pay_rejectnow_${id}`)],
    [Markup.button.callback('❌ إلغاء', `sub_pay_view_${id}`)],
  ]);

// ─── Coupons ──────────────────────────────────────────────────────────────────

const cpnCodeEntryKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🎲 توليد كود تلقائي', 'sub_cpnw_autocode')],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const cpnTypeKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('نسبة %', 'sub_cpnw_type_percent'),
      Markup.button.callback('قيمة ثابتة', 'sub_cpnw_type_fixed'),
    ],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const cpnMaxUsesKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('♾ غير محدود', 'sub_cpnw_unlim_uses')],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const cpnValidUntilKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('♾ بدون تاريخ انتهاء', 'sub_cpnw_nolimit_date')],
    [Markup.button.callback('✏️ تحديد تاريخ', 'sub_cpnw_setdate')],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const cpnPackagesKeyboard = (packages, selectedIds = []) => {
  const rows = packages.map((p) => {
    const selected = selectedIds.includes(p.id);
    return [Markup.button.callback(`${selected ? '✅' : '◻️'} ${p.name}`, `sub_cpnw_pkg_${p.id}`)];
  });
  rows.push([Markup.button.callback('✅ تأكيد (الكل إن لم يُحدد شيء)', 'sub_cpnw_pkg_confirm')]);
  rows.push([Markup.button.callback('❌ إلغاء', 'sub_cancel')]);
  return Markup.inlineKeyboard(rows);
};

const cpnReviewKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✅ حفظ الكوبون', 'sub_cpnw_confirm')],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const cpnListKeyboard = (coupons, page, totalPages) => {
  const rows = coupons.map((c) => {
    const icon = c.is_active ? '🟢' : '⚪️';
    return [Markup.button.callback(`${icon} ${c.code} (${c.used_count}/${c.max_uses || '∞'})`, `sub_cpn_view_${c.id}`)];
  });
  rows.push(...paginationRow('sub_cpn_page', page, totalPages));
  rows.push([Markup.button.callback('🎟 إنشاء كوبون جديد', 'sub_cpn_add')]);
  rows.push([Markup.button.callback('⬅️ رجوع', 'sub_menu')]);
  return Markup.inlineKeyboard(rows);
};

const cpnDetailKeyboard = (coupon) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(coupon.is_active ? '⏸ تعطيل' : '▶️ تفعيل', `sub_cpn_toggle_${coupon.id}`)],
    [Markup.button.callback('🗑 حذف', `sub_cpn_del_${coupon.id}`)],
    [Markup.button.callback('⬅️ رجوع للقائمة', 'sub_cpn_list')],
  ]);

const cpnConfirmDeleteKeyboard = (id) => yesNoRow(`sub_cpn_delyes_${id}`, `sub_cpn_view_${id}`, '✅ نعم، احذف', '❌ إلغاء');

// ─── Offers ───────────────────────────────────────────────────────────────────

const ofrTypeKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('💸 خصم', 'sub_ofrw_type_discount')],
    [Markup.button.callback('🎁 اشترِ واحدة واحصل على أخرى', 'sub_ofrw_type_bogo')],
    [Markup.button.callback('⏱ تمديد مجاني', 'sub_ofrw_type_free_extension')],
    [Markup.button.callback('⬆️ ترقية مجانية', 'sub_ofrw_type_free_upgrade')],
    [Markup.button.callback('🕐 عرض لفترة محددة', 'sub_ofrw_type_limited_time')],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const ofrPackageKeyboard = (packages) => {
  const rows = packages.map((p) => [Markup.button.callback(p.name, `sub_ofrw_pkg_${p.id}`)]);
  rows.push([Markup.button.callback('🌐 كل الباقات', 'sub_ofrw_pkg_all')]);
  rows.push([Markup.button.callback('❌ إلغاء', 'sub_cancel')]);
  return Markup.inlineKeyboard(rows);
};

const ofrEndDateKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('♾ بدون تاريخ انتهاء', 'sub_ofrw_nodate')],
    [Markup.button.callback('✏️ تحديد تاريخ', 'sub_ofrw_setdate')],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const ofrListKeyboard = (offers) => {
  const rows = offers.map((o) => {
    const icon = o.is_active ? '🟢' : '⚪️';
    return [Markup.button.callback(`${icon} ${o.title}`, `sub_ofr_view_${o.id}`)];
  });
  rows.push([Markup.button.callback('🎁 إنشاء عرض جديد', 'sub_ofr_add')]);
  rows.push([Markup.button.callback('⬅️ رجوع', 'sub_menu')]);
  return Markup.inlineKeyboard(rows);
};

const ofrDetailKeyboard = (offer) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(offer.is_active ? '⏸ تعطيل' : '▶️ تفعيل', `sub_ofr_toggle_${offer.id}`)],
    [Markup.button.callback('🗑 حذف', `sub_ofr_del_${offer.id}`)],
    [Markup.button.callback('⬅️ رجوع للقائمة', 'sub_ofr_list')],
  ]);

const ofrConfirmDeleteKeyboard = (id) => yesNoRow(`sub_ofr_delyes_${id}`, `sub_ofr_view_${id}`, '✅ نعم، احذف', '❌ إلغاء');

// ─── Activation Codes (أكواد التفعيل) ─────────────────────────────────────────

const codePackageKeyboard = (packages) => {
  const rows = packages.map((p) => [Markup.button.callback(`${p.name} — ${p.price} ${p.currency}`, `sub_codew_pkg_${p.id}`)]);
  rows.push([Markup.button.callback('❌ إلغاء', 'sub_cancel')]);
  return Markup.inlineKeyboard(rows);
};

const codeExpiryKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('♾ بدون تاريخ انتهاء', 'sub_codew_nodate')],
    [Markup.button.callback('✏️ تحديد تاريخ', 'sub_codew_setdate')],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const CODE_FILTERS = [['الكل', 'all'], ['غير مستخدمة', 'unused'], ['مستخدمة', 'used'], ['منتهية', 'expired']];

const codeListKeyboard = (codes, page, totalPages, currentFilter = 'all') => {
  const rows = [];
  rows.push(CODE_FILTERS.map(([label, val]) => Markup.button.callback(val === currentFilter ? `• ${label}` : label, `sub_code_filter_${val}`)));

  const icon = (c) => {
    if (c.used_count >= c.max_uses) return '✅';
    if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return '⌛️';
    return '🔑';
  };
  codes.forEach((c) => {
    rows.push([Markup.button.callback(`${icon(c)} ${c.code}`, `sub_code_view_${c.id}`)]);
  });

  rows.push(...paginationRow('sub_code_page', page, totalPages));
  rows.push([Markup.button.callback('🔑 توليد أكواد جديدة', 'sub_code_add')]);
  rows.push([Markup.button.callback('⬅️ رجوع', 'sub_menu')]);
  return Markup.inlineKeyboard(rows);
};

const codeDetailKeyboard = (code) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(code.is_active ? '⏸ تعطيل' : '▶️ تفعيل', `sub_code_toggle_${code.id}`)],
    [Markup.button.callback('🗑 حذف', `sub_code_del_${code.id}`)],
    [Markup.button.callback('⬅️ رجوع للقائمة', 'sub_code_list')],
  ]);

const codeConfirmDeleteKeyboard = (id) => yesNoRow(`sub_code_delyes_${id}`, `sub_code_view_${id}`, '✅ نعم، احذف', '❌ إلغاء');

const codeBatchDoneKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📋 عرض كل الأكواد', 'sub_code_list')],
    [Markup.button.callback('⬅️ رجوع', 'sub_menu')],
  ]);

// ─── Alerts (quick toggle screen) ─────────────────────────────────────────────

const alertsKeyboard = (settings) => {
  const toggle = (key, label) =>
    Markup.button.callback(`${settings[key] === '1' ? '✅' : '❌'} ${label}`, `sub_alerts_toggle_${key}`);

  return Markup.inlineKeyboard([
    [toggle('notify_before_expiry', 'قبل انتهاء الاشتراك')],
    [toggle('notify_after_expiry', 'بعد انتهاء الاشتراك')],
    [toggle('notify_payment_success', 'بعد نجاح الدفع')],
    [toggle('notify_payment_failed', 'بعد فشل/رفض الدفع')],
    [toggle('notify_package_change', 'بعد تغيير الباقة')],
    [toggle('notify_coupon_used', 'بعد استخدام كوبون')],
    [toggle('notify_admin_on_new_payment', 'تنبيه المشرف بطلب دفع جديد')],
    [toggle('notify_admin_on_expiry', 'تنبيه المشرف بانتهاء اشتراك')],
    [Markup.button.callback('⬅️ رجوع', 'sub_menu')],
  ]);
};

// ─── Settings ─────────────────────────────────────────────────────────────────

const settingsKeyboard = (settings) =>
  Markup.inlineKeyboard([
    [Markup.button.callback(`💱 العملة الافتراضية: ${settings.default_currency}`, 'sub_settings_currency')],
    [Markup.button.callback(`💰 نسبة الضريبة: ${settings.tax_percent}%`, 'sub_settings_tax')],
    [Markup.button.callback('✏️ رسالة الترحيب', 'sub_settings_msg_welcome_message')],
    [Markup.button.callback('✏️ رسالة انتهاء الاشتراك', 'sub_settings_msg_expiry_message')],
    [Markup.button.callback('✏️ رسالة قبل الانتهاء', 'sub_settings_msg_pre_expiry_message')],
    [Markup.button.callback('✏️ رسالة التجديد', 'sub_settings_msg_renewal_message')],
    [
      Markup.button.callback(
        `🔁 التجديد التلقائي: ${settings.auto_renew_policy === '1' ? 'مفعّل' : 'متوقف'}`,
        'sub_settings_toggle_auto_renew_policy'
      ),
    ],
    [Markup.button.callback(`🎁 العروض: ${settings.offers_enabled === '1' ? 'مفعّلة' : 'متوقفة'}`, 'sub_settings_toggle_offers_enabled')],
    [Markup.button.callback(`🎟 الكوبونات: ${settings.coupons_enabled === '1' ? 'مفعّلة' : 'متوقفة'}`, 'sub_settings_toggle_coupons_enabled')],
    [Markup.button.callback('🔔 تنبيهات الاشتراكات', 'sub_alerts')],
    [Markup.button.callback('⬅️ رجوع', 'sub_menu')],
  ]);

const settingsCurrencyKeyboard = () => {
  const rows = [];
  for (let i = 0; i < CURRENCIES.length; i += 3) {
    rows.push(CURRENCIES.slice(i, i + 3).map((c) => Markup.button.callback(c, `sub_settings_setcur_${c}`)));
  }
  rows.push([Markup.button.callback('⬅️ رجوع', 'sub_settings')]);
  return Markup.inlineKeyboard(rows);
};

// ─── Operations Log ───────────────────────────────────────────────────────────

const logKeyboard = (page, totalPages) =>
  Markup.inlineKeyboard([...paginationRow('sub_log_page', page, totalPages), [Markup.button.callback('⬅️ رجوع', 'sub_menu')]]);

// ─── Statistics ───────────────────────────────────────────────────────────────

const statsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🔄 تحديث', 'sub_stats')],
    [Markup.button.callback('⬅️ رجوع', 'sub_menu')],
  ]);

// ─── Storefront (subscriber-facing) ───────────────────────────────────────────

const subStoreMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('💼 اشتراكي الحالي', 'sub_store_mysub')],
    [Markup.button.callback('📦 الباقات المتاحة', 'sub_store_packages')],
    [Markup.button.callback('🔑 لدي كود تفعيل', 'sub_store_redeem')],
    [Markup.button.callback('🎁 العروض الحالية', 'sub_store_offers')],
    [Markup.button.callback('📜 سجل اشتراكي ومدفوعاتي', 'sub_store_history')],
    [Markup.button.callback('⬅️ رجوع', 'main_menu')],
  ]);

const subStoreBackKeyboard = () => Markup.inlineKeyboard([[Markup.button.callback('⬅️ رجوع', 'sub_menu')]]);

const subStorePackagesKeyboard = (packages) => {
  const rows = packages.map((p) => [
    Markup.button.callback(`${p.is_special ? '⭐ ' : ''}${p.name} — ${p.price} ${p.currency}`, `sub_store_pkg_${p.id}`),
  ]);
  rows.push([Markup.button.callback('⬅️ رجوع', 'sub_menu')]);
  return Markup.inlineKeyboard(rows);
};

const subStorePackageDetailKeyboard = (pkgId) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🛒 اشترك الآن', `sub_store_subscribe_${pkgId}`)],
    [Markup.button.callback('⬅️ رجوع للباقات', 'sub_store_packages')],
  ]);

const subStoreCouponPromptKeyboard = (pkgId) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('🎟 لدي كود خصم', `sub_store_coupon_yes_${pkgId}`),
      Markup.button.callback('➡️ متابعة بدون كود', `sub_store_coupon_no_${pkgId}`),
    ],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

const subStoreConfirmKeyboard = (pkgId) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✅ تأكيد الطلب', `sub_store_confirm_${pkgId}`)],
    [Markup.button.callback('❌ إلغاء', 'sub_cancel')],
  ]);

module.exports = {
  // shared
  subAdminMenuKeyboard,
  subBackToMenuKeyboard,
  subCancelKeyboard,
  packagePickerKeyboard,
  // packages
  pkgCurrencyKeyboard,
  pkgDurationKeyboard,
  pkgUnlimitedOrTextKeyboard,
  pkgSkipKeyboard,
  skipKeyboard,
  pkgSpecialBadgeKeyboard,
  pkgReviewKeyboard,
  pkgListKeyboard,
  pkgDetailKeyboard,
  pkgEditFieldKeyboard,
  pkgConfirmDeleteKeyboard,
  // subscribers
  subrListKeyboard,
  subrDetailKeyboard,
  subrExtendKeyboard,
  subrConfirmCancelKeyboard,
  subrHistoryKeyboard,
  // payments
  payListKeyboard,
  payDetailKeyboard,
  payConfirmRefundKeyboard,
  paySkipReasonKeyboard,
  // coupons
  cpnCodeEntryKeyboard,
  cpnTypeKeyboard,
  cpnMaxUsesKeyboard,
  cpnValidUntilKeyboard,
  cpnPackagesKeyboard,
  cpnReviewKeyboard,
  cpnListKeyboard,
  cpnDetailKeyboard,
  cpnConfirmDeleteKeyboard,
  // offers
  ofrTypeKeyboard,
  ofrPackageKeyboard,
  ofrEndDateKeyboard,
  ofrListKeyboard,
  ofrDetailKeyboard,
  ofrConfirmDeleteKeyboard,
  // activation codes
  codePackageKeyboard,
  codeExpiryKeyboard,
  codeListKeyboard,
  codeDetailKeyboard,
  codeConfirmDeleteKeyboard,
  codeBatchDoneKeyboard,
  // alerts & settings
  alertsKeyboard,
  settingsKeyboard,
  settingsCurrencyKeyboard,
  // log & stats
  logKeyboard,
  statsKeyboard,
  // storefront
  subStoreMenuKeyboard,
  subStoreBackKeyboard,
  subStorePackagesKeyboard,
  subStorePackageDetailKeyboard,
  subStoreCouponPromptKeyboard,
  subStoreConfirmKeyboard,
  CURRENCIES,
};
