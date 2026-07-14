/**
 * Subscriptions Service
 *
 * Business logic for the 💎 نظام الاشتراكات module: admin permission checks,
 * price/coupon/offer calculations, formatting helpers, and the background
 * scheduler that sends expiry alerts. Kept fully independent from the
 * existing telegramClient / linksService business logic.
 */

const logger = require('../utils/logger');
const {
  subscriberQueries,
  subscriberHistoryQueries,
  couponQueries,
  offerQueries,
  activationCodeQueries,
  operationsLogQueries,
  settingsQueries,
} = require('../database/subscriptionsDb');

// ─── Telegram UI helper ───────────────────────────────────────────────────────

/**
 * Edit the current message in place, falling back to a fresh reply when the
 * message can't be edited (e.g. it's too old, or came from a plain text
 * message rather than a callback). Mirrors the safeEdit pattern already used
 * in handlers/manageAccounts.js and handlers/linksMenu.js.
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {object} extra
 */
const safeEdit = async (ctx, text, extra = {}) => {
  const payload = { parse_mode: 'Markdown', ...extra };
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, payload);
      return;
    }
    await ctx.reply(text, payload);
  } catch (error) {
    if (error.description && error.description.includes('message is not modified')) return;
    try {
      await ctx.reply(text, payload);
    } catch (innerError) {
      logger.error('subscriptionsService.safeEdit: failed to send message:', innerError);
    }
  }
};

// ─── Admin permissions ────────────────────────────────────────────────────────

/**
 * Reads ADMIN_IDS from env on every call (cheap) so a runtime env change
 * (e.g. Railway redeploy with a new value) is always respected.
 * @returns {string[]}
 */
const getAdminIds = () =>
  (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * @param {string|number} userId
 * @returns {boolean}
 */
const isAdmin = (userId) => getAdminIds().includes(String(userId));

const hasAnyAdminConfigured = () => getAdminIds().length > 0;

// ─── Formatting helpers ───────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = {
  SAR: 'ر.س', USD: '$', AED: 'د.إ', EGP: 'ج.م', YER: 'ر.ي',
  KWD: 'د.ك', QAR: 'ر.ق', BHD: 'د.ب', OMR: 'ر.ع', EUR: '€', GBP: '£',
};

const formatMoney = (amount, currency = 'SAR') => {
  const num = Number(amount) || 0;
  const rounded = Number.isInteger(num) ? num : Math.round(num * 100) / 100;
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `${rounded} ${symbol}`;
};

const formatDuration = (days) => {
  const n = Number(days) || 0;
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  if (n === 7) return 'أسبوع واحد';
  if (n === 14) return 'أسبوعان';
  if (n === 30) return 'شهر واحد';
  if (n === 60) return 'شهران';
  if (n === 90) return '3 أشهر';
  if (n === 180) return '6 أشهر';
  if (n === 365) return 'سنة واحدة';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
};

const formatDate = (isoString) => {
  if (!isoString) return 'غير محدد';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'غير محدد';
  return d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
};

const formatDateTime = (isoString) => {
  if (!isoString) return 'غير محدد';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'غير محدد';
  return `${d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })} - ${d.toLocaleTimeString(
    'ar-SA',
    { hour: '2-digit', minute: '2-digit' }
  )}`;
};

/**
 * Days remaining until an ISO expiry date (can be negative if already expired).
 * @param {string} expiresAt
 * @returns {number}
 */
const daysRemaining = (expiresAt) => {
  if (!expiresAt) return 0;
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diffMs / (24 * 3600 * 1000));
};

const calculateExpiryDate = (durationDays, fromIso = null) => {
  const base = fromIso ? new Date(fromIso) : new Date();
  const from = isNaN(base.getTime()) ? new Date() : base;
  return new Date(from.getTime() + Number(durationDays || 0) * 24 * 3600 * 1000).toISOString();
};

/**
 * Fill {placeholders} inside a settings message template.
 * @param {string} template
 * @param {object} vars
 */
const renderTemplate = (template, vars = {}) => {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined ? String(vars[key]) : match));
};

const STATUS_LABELS = {
  none: 'بدون اشتراك',
  active: 'نشط ✅',
  expired: 'منتهي ⛔️',
  suspended: 'موقوف ⏸',
  cancelled: 'ملغي ❌',
};

const PAYMENT_STATUS_LABELS = {
  pending: 'قيد الانتظار ⏳',
  accepted: 'مقبولة ✅',
  rejected: 'مرفوضة ❌',
  refunded: 'مستردة ↩️',
};

// ─── Offers & pricing ─────────────────────────────────────────────────────────

/**
 * The single best active "discount"-type offer for a package (global offers,
 * i.e. package_id IS NULL, also apply). Other offer types (bogo / free
 * extension / free upgrade / limited-time) are informational and are honoured
 * manually by the admin (e.g. via the "extend" subscriber action).
 * @param {number} packageId
 */
const getActiveDiscountOffer = (packageId) => {
  const offers = offerQueries.getActive().filter((o) => o.offer_type === 'discount');
  const forPackage = offers.find((o) => o.package_id === packageId);
  return forPackage || offers.find((o) => !o.package_id) || null;
};

/**
 * Compute the displayed/charged price for a package after any active
 * discount-type offer.
 * @param {object} pkg
 * @returns {{ finalPrice: number, offer: object|null, offerDiscount: number }}
 */
const applyOfferToPrice = (pkg) => {
  const offer = getActiveDiscountOffer(pkg.id);
  if (!offer) return { finalPrice: pkg.price, offer: null, offerDiscount: 0 };

  const val = offer.value || {};
  let discount = 0;
  if (val.percent) discount = (pkg.price * Number(val.percent)) / 100;
  else if (val.amount) discount = Number(val.amount);

  discount = Math.max(0, Math.min(discount, pkg.price));
  return { finalPrice: Math.round((pkg.price - discount) * 100) / 100, offer, offerDiscount: discount };
};

/**
 * Validate a coupon code for a given user + package + price, and compute
 * the resulting discount. Never throws.
 * @returns {{ valid: boolean, reason?: string, coupon?: object, discountAmount: number, finalPrice: number }}
 */
const validateAndApplyCoupon = (code, { userId, packageId, price }) => {
  const coupon = couponQueries.getByCode((code || '').trim());

  if (!coupon) return { valid: false, reason: 'كود الخصم غير صحيح أو غير موجود.', discountAmount: 0, finalPrice: price };
  if (!coupon.is_active) return { valid: false, reason: 'كود الخصم غير مُفعّل حاليًا.', discountAmount: 0, finalPrice: price };

  const now = Date.now();
  if (coupon.valid_from && now < new Date(coupon.valid_from).getTime()) {
    return { valid: false, reason: 'لم يبدأ سريان هذا الكود بعد.', discountAmount: 0, finalPrice: price };
  }
  if (coupon.valid_until && now > new Date(coupon.valid_until).getTime()) {
    return { valid: false, reason: 'انتهت صلاحية هذا الكود.', discountAmount: 0, finalPrice: price };
  }
  if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) {
    return { valid: false, reason: 'تم استنفاد عدد مرات استخدام هذا الكود.', discountAmount: 0, finalPrice: price };
  }
  if (coupon.allowed_package_ids?.length && !coupon.allowed_package_ids.includes(packageId)) {
    return { valid: false, reason: 'هذا الكود غير صالح لهذه الباقة.', discountAmount: 0, finalPrice: price };
  }
  if (coupon.allowed_user_ids?.length && !coupon.allowed_user_ids.includes(String(userId))) {
    return { valid: false, reason: 'هذا الكود غير مخصص لحسابك.', discountAmount: 0, finalPrice: price };
  }

  let discountAmount =
    coupon.discount_type === 'percent' ? (price * Number(coupon.discount_value)) / 100 : Number(coupon.discount_value);
  discountAmount = Math.max(0, Math.min(discountAmount, price));
  const finalPrice = Math.round((price - discountAmount) * 100) / 100;

  return { valid: true, coupon, discountAmount: Math.round(discountAmount * 100) / 100, finalPrice };
};

/**
 * Validate an activation code for redemption. Never throws.
 * @param {string} code
 * @returns {{ valid: boolean, reason?: string, codeRow?: object }}
 */
const validateActivationCode = (code) => {
  const codeRow = activationCodeQueries.getByCode((code || '').trim());

  if (!codeRow) return { valid: false, reason: 'كود التفعيل غير صحيح أو غير موجود.' };
  if (!codeRow.is_active) return { valid: false, reason: 'كود التفعيل غير مُفعّل حاليًا.' };
  if (codeRow.expires_at && Date.now() > new Date(codeRow.expires_at).getTime()) {
    return { valid: false, reason: 'انتهت صلاحية كود التفعيل.' };
  }
  if (codeRow.used_count >= codeRow.max_uses) {
    return { valid: false, reason: 'تم استخدام كود التفعيل بالكامل.' };
  }

  return { valid: true, codeRow };
};

// ─── Notifications ────────────────────────────────────────────────────────────

/**
 * Best-effort broadcast to every configured admin. A blocked/invalid admin
 * chat never stops delivery to the others.
 * @param {import('telegraf').Telegraf} bot
 * @param {string} text
 * @param {object} extra
 */
const notifyAdmins = async (bot, text, extra = {}) => {
  const ids = getAdminIds();
  await Promise.allSettled(
    ids.map((id) =>
      bot.telegram.sendMessage(id, text, { parse_mode: 'Markdown', ...extra }).catch((err) => {
        logger.warn(`notifyAdmins: failed to reach admin ${id}: ${err.message}`);
      })
    )
  );
};

/**
 * Best-effort DM to a subscriber. Never throws (user may have blocked the bot).
 * @param {import('telegraf').Telegraf} bot
 * @param {string} telegramUserId
 * @param {string} text
 */
const notifySubscriber = async (bot, telegramUserId, text, extra = {}) => {
  try {
    await bot.telegram.sendMessage(telegramUserId, text, { parse_mode: 'Markdown', ...extra });
    return true;
  } catch (err) {
    logger.warn(`notifySubscriber: failed to reach user ${telegramUserId}: ${err.message}`);
    return false;
  }
};

// ─── Background scheduler ─────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const INITIAL_DELAY_MS = 15 * 1000; // let the bot settle after launch first

let schedulerHandle = null;

/**
 * Scans for subscriptions about to expire / already expired and sends the
 * relevant alerts. Designed to never throw — a single bad row cannot stop
 * the rest of the batch, and the whole run is wrapped defensively.
 * @param {import('telegraf').Telegraf} bot
 */
const runExpiryCheck = async (bot) => {
  try {
    const settings = settingsQueries.getAll();

    // ── Pre-expiry warnings (within 72h) ──
    if (settings.notify_before_expiry === '1') {
      const soon = subscriberQueries.getExpiringSoon(72);
      for (const s of soon) {
        const days = Math.max(0, daysRemaining(s.expires_at));
        const text = renderTemplate(settings.pre_expiry_message, {
          name: s.first_name || s.username || 'عزيزي المشترك',
          days,
        });
        // eslint-disable-next-line no-await-in-loop
        await notifySubscriber(bot, s.telegram_user_id, `🔔 ${text}`);
        subscriberQueries.markPreExpiryAlertSent(s.telegram_user_id);
        operationsLogQueries.log({
          actionType: 'alert_pre_expiry_sent',
          actorId: 'system',
          actorRole: 'system',
          targetType: 'subscriber',
          targetId: s.telegram_user_id,
          status: 'success',
        });
      }
      if (soon.length) logger.info(`Subscriptions scheduler: sent ${soon.length} pre-expiry alert(s)`);
    }

    // ── Newly expired ──
    const expired = subscriberQueries.getNewlyExpired();
    for (const s of expired) {
      subscriberQueries.markExpired(s.telegram_user_id);
      subscriberHistoryQueries.add(s.telegram_user_id, 'expired', s.package_id, 'system');

      if (settings.notify_after_expiry === '1') {
        const text = renderTemplate(settings.expiry_message, {
          name: s.first_name || s.username || 'عزيزي المشترك',
        });
        // eslint-disable-next-line no-await-in-loop
        await notifySubscriber(bot, s.telegram_user_id, `⛔️ ${text}`);
      }
      if (settings.notify_admin_on_expiry === '1') {
        // eslint-disable-next-line no-await-in-loop
        await notifyAdmins(
          bot,
          `⛔️ *انتهى اشتراك مشترك*\n\nالمستخدم: ${s.first_name || s.username || s.telegram_user_id} (\`${s.telegram_user_id}\`)`
        );
      }
      operationsLogQueries.log({
        actionType: 'subscription_expired',
        actorId: 'system',
        actorRole: 'system',
        targetType: 'subscriber',
        targetId: s.telegram_user_id,
        status: 'success',
      });
    }
    if (expired.length) logger.info(`Subscriptions scheduler: processed ${expired.length} newly-expired subscription(s)`);
  } catch (error) {
    logger.error('Subscriptions scheduler: runExpiryCheck error:', error);
  }
};

/**
 * Starts the periodic background scheduler. Safe to call once at startup.
 * @param {import('telegraf').Telegraf} bot
 */
const startSubscriptionScheduler = (bot) => {
  if (schedulerHandle) return; // already running

  setTimeout(() => {
    runExpiryCheck(bot).catch((err) => logger.error('Subscriptions scheduler initial run failed:', err));
  }, INITIAL_DELAY_MS);

  schedulerHandle = setInterval(() => {
    runExpiryCheck(bot).catch((err) => logger.error('Subscriptions scheduler run failed:', err));
  }, CHECK_INTERVAL_MS);

  logger.info('Subscriptions scheduler started (expiry checks every 6h)');
};

module.exports = {
  isAdmin,
  getAdminIds,
  hasAnyAdminConfigured,
  safeEdit,
  formatMoney,
  formatDuration,
  formatDate,
  formatDateTime,
  daysRemaining,
  calculateExpiryDate,
  renderTemplate,
  STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  CURRENCY_SYMBOLS,
  getActiveDiscountOffer,
  applyOfferToPrice,
  validateAndApplyCoupon,
  validateActivationCode,
  notifyAdmins,
  notifySubscriber,
  startSubscriptionScheduler,
  runExpiryCheck,
};
