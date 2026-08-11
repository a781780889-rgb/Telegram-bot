/**
 * Telegram Client Service
 *
 * Handles all low-level MTProto interactions:
 *  - OTP login flow (sendOtp → resendOtp → verifyOtp → optional verifyPassword)
 *  - Session persistence (encrypted on disk + DB backup)
 *  - Loading / restoring saved sessions
 *  - Managing active client lifecycle
 *
 * KEY FIXES in this version:
 *
 * 1. pendingSessions keyed by `${userId}:${phone}` — eliminates cross-user collisions.
 *
 * 2. resendOtp throttle SEPARATED from sendOtp throttle:
 *    - sendOtp uses lastSendAt (MIN_RESEND_GAP_MS=60s) to prevent creating
 *      brand-new sessions too quickly (avoids Telegram silent-drop of duplicate
 *      sendCode calls).
 *    - resendOtp uses lastResendAt (MIN_RESEND_BUTTON_GAP_MS=30s) as a separate
 *      counter so pressing "لم يصلني الرمز" immediately after the first OTP is
 *      no longer blocked by the sendOtp throttle. The button gets its own,
 *      shorter cooldown.
 *
 * 3. resendOtp NEVER deletes the pending session before creating the new one.
 *    - If auth.ResendCode succeeds → update phoneCodeHash in-place (atomic).
 *    - If SEND_CODE_UNAVAILABLE → fall back to fresh sendCode BUT keep the
 *      old client alive until the new one is fully ready, then swap.
 *    - verifyOtp never sees an empty session window.
 *
 * 4. phoneCodeHash always updated to the latest value after every sendCode /
 *    resendCode call.
 *
 * 5. SESSION_PASSWORD_NEEDED (2FA): the same client is kept in pendingSessions
 *    between OTP verification and password submission.
 *
 * 6. Timeout cleanup: cleanupPending() accepts composite key or (userId, phone).
 *    Disconnects client and removes all references.
 *
 * 7. Logging: structured [AUTH] lines, never logs OTP/password/session/hash.
 */

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { Api }            = require('telegram');
const path               = require('path');
const fs                 = require('fs');
const logger             = require('../utils/logger');
const { encrypt, decrypt, maskPhone } = require('../utils/encryption');

// ─── Directory bootstrap ──────────────────────────────────────────────────────

const sessionsDir = process.env.SESSIONS_DIR || './sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// ─── In-memory state maps ─────────────────────────────────────────────────────

/** accountId → { client, phone, connectedAt } */
const activeClients = new Map();

/**
 * Composite key `${userId}:${phone}` → pending login session.
 * Value: {
 *   client, session, phoneCodeHash, isCodeViaApp,
 *   isPasswordRequired, phone, userId, accountId, createdAt
 * }
 */
const pendingSessions = new Map();

/**
 * Composite key → timestamp of last sendOtp() call.
 * Controls creation of brand-new login sessions.
 * MIN gap: 60 s (avoids Telegram silent-drop of duplicate sendCode).
 */
const lastSendAt = new Map();
const MIN_RESEND_GAP_MS = 60 * 1000;

/**
 * Composite key → timestamp of last resendOtp() call (button press).
 * Separate from lastSendAt so the first "لم يصلني الرمز" press is
 * never blocked by the initial sendCode throttle.
 * MIN gap: 30 s (short Telegram-side cooldown for auth.ResendCode).
 */
const lastResendAt = new Map();
const MIN_RESEND_BUTTON_GAP_MS = 30 * 1000;
const APP_ONLY_OTP_ERROR = 'OTP_APP_ONLY_REQUIRED';

// ─── Composite key helper ─────────────────────────────────────────────────────

const pendingKey = (userId, phone) => `${userId}:${phone}`;

// ─── Auth logging helpers ─────────────────────────────────────────────────────

/**
 * Structured auth-flow log line. Never logs raw OTP / password / session / hash.
 */
const authLog = (step, userId, phone, extra = {}) => {
  const masked = maskPhone(phone);
  const ts     = new Date().toISOString();
  const base   = `[AUTH] step=${step} userId=${userId} phone=${masked} ts=${ts}`;
  const extras = Object.entries(extra)
    .filter(([k]) => !['hash', 'password', 'code', 'session', 'token'].includes(k.toLowerCase()))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  logger.info(extras ? `${base} ${extras}` : base);
};

/**
 * Cancel a code that was delivered through a channel the bot does not accept.
 * Never log the phone-code hash.
 */
const cancelPendingCode = async (client, phone, phoneCodeHash) => {
  if (!phoneCodeHash) return;
  try {
    await client.invoke(new Api.auth.CancelCode({ phoneNumber: phone, phoneCodeHash }));
  } catch (error) {
    logger.warn('Failed to cancel non-app OTP:', error?.message?.slice(0, 100));
  }
};

const isAppDelivery = (result) =>
  result?.isCodeViaApp === true || result?.type instanceof Api.auth.SentCodeTypeApp;

// ─── Error translation ────────────────────────────────────────────────────────

const translateTelegramError = (error) => {
  const msg = error?.message ?? error?.toString() ?? '';

  if (msg.includes('PHONE_NUMBER_INVALID'))    return 'رقم الهاتف غير صالح. تحقق من الصيغة الدولية.';
  if (msg.includes('PHONE_NUMBER_BANNED'))     return 'هذا الرقم محظور من تيليجرام.';
  if (msg.includes('PHONE_CODE_INVALID'))      return 'رمز التحقق غير صحيح. حاول مرة أخرى.';
  if (msg.includes('PHONE_CODE_EXPIRED'))      return 'انتهت صلاحية رمز التحقق. أعد طلب رمز جديد.';
  if (msg.includes('PASSWORD_HASH_INVALID'))   return 'كلمة المرور غير صحيحة. حاول مرة أخرى.';
  if (msg.includes('SESSION_PASSWORD_NEEDED')) return 'يحتاج الحساب إلى كلمة مرور التحقق بخطوتين.';
  if (msg.includes('FLOOD_WAIT')) {
    const secs = msg.match(/\d+/)?.[0] ?? 'بضع';
    return `⏱ تجاوزت حد الطلبات. انتظر ${secs} ثانية ثم حاول مرة أخرى.`;
  }
  if (msg.includes('AUTH_KEY_UNREGISTERED'))   return 'انتهت صلاحية الجلسة. أعد تسجيل الدخول.';
  if (msg.includes('USER_DEACTIVATED'))        return 'هذا الحساب معطل أو محذوف.';
  if (msg.includes('NETWORK') || msg.includes('ECONNREFUSED')) return 'خطأ في الاتصال بتيليجرام. تحقق من الإنترنت.';
  if (msg.includes('TOO_MANY_REQUESTS'))       return 'طلبات كثيرة جدًا. انتظر قليلًا ثم حاول.';
  if (msg.includes('TIMEOUT'))                 return 'انتهت مهلة الاتصال بتيليجرام. حاول مرة أخرى.';
  if (msg.includes('LOCAL_RESEND_THROTTLED')) {
    const sec = msg.split(':')[1] || 'بضع';
    return `⏱ الرجاء الانتظار ${sec} ثانية قبل طلب رمز جديد لنفس الرقم (منعًا من تجاهل تيليجرام للطلب المتكرر).`;
  }
  if (msg.includes(APP_ONLY_OTP_ERROR)) {
    return '⚠️ لم يرسل تيليجرام الرمز داخل التطبيق هذه المرة، لذلك لم يتم قبول SMS أو المكالمة. افتح الحساب في تطبيق تيليجرام على جهاز تملكه، ثم ابدأ إضافة الحساب من جديد.';
  }
  if (msg.includes('SEND_CODE_UNAVAILABLE')) {
    return 'تيليجرام لا يتيح تغيير طريقة إرسال الرمز لهذا الرقم حاليًا. إذا كان الرقم مسجَّلاً في تطبيق تيليجرام على جهاز آخر، افتح الإعدادات ← الأجهزة النشطة وأنهِ الجلسات الأخرى، ثم اضغط "لم يصلني الرمز" مرة أخرى.';
  }

  logger.warn('Unmapped Telegram error:', msg);
  return `خطأ غير متوقع: ${msg.slice(0, 100)}`;
};

// ─── Client factory ───────────────────────────────────────────────────────────

const buildClient = (sessionString = '', forSearch = false) => {
  const apiId   = parseInt(process.env.API_ID, 10);
  const apiHash = process.env.API_HASH;

  if (!apiId || !apiHash) {
    throw new Error('API_ID and API_HASH must be set in environment variables');
  }

  const session = new StringSession(sessionString);

  const client = new TelegramClient(session, apiId, apiHash, {
    // NOTE: useWSS is intentionally omitted (default = false → TCP).
    // Forcing useWSS:true breaks long-lived connections on Railway/Docker because
    // their load-balancers drop idle WebSocket connections after ~60 s, which causes
    // the MTProto update-loop to TIMEOUT every ~40 s and never recover without
    // a full reconnect.  TCP (the GramJS default for Node.js) is stable on all
    // cloud platforms and avoids this entire class of TIMEOUT errors.
    connectionRetries:   forSearch ? 2 : 5,
    retryDelay:          forSearch ? 1000 : 2000,
    autoReconnect:       !forSearch,
    floodSleepThreshold: 60,   // auto-sleep up to 60 s on FLOOD_WAIT instead of throwing
    requestRetries:      3,    // retry individual MTProto requests on transient failure
    deviceModel:         'Desktop',
    systemVersion:       'Linux',
    appVersion:          '1.0.0',
    langCode:            'ar',
    systemLangCode:      'en',
  });

  return { client, session };
};

// ─── OTP Flow ─────────────────────────────────────────────────────────────────

/**
 * Initiate a login by sending an OTP to the given phone number.
 *
 * Throttled by lastSendAt (60s) to prevent Telegram silent-drop of duplicate
 * sendCode calls within the same composite key (userId:phone).
 *
 * @param {string} userId
 * @param {string} phone
 * @param {number} accountId
 * @param {object} [opts]
 * @param {boolean} [opts.skipThrottle]  Internal use: bypass local throttle
 *                                       when called from the resend fallback.
 */
const sendOtp = async (userId, phone, accountId, { skipThrottle = false } = {}) => {
  const key = pendingKey(userId, phone);

  authLog('AUTH_START', userId, phone, { accountId });

  // Throttle: prevent creating brand-new sessions too quickly.
  // This is separate from the resend button throttle.
  if (!skipThrottle) {
    const lastAt = lastSendAt.get(key);
    if (lastAt && Date.now() - lastAt < MIN_RESEND_GAP_MS) {
      const waitSec = Math.ceil((MIN_RESEND_GAP_MS - (Date.now() - lastAt)) / 1000);
      throw new Error(`LOCAL_RESEND_THROTTLED:${waitSec}`);
    }
  }

  // Tear down any previous session for THIS (user, phone) pair only.
  if (pendingSessions.has(key)) {
    const old = pendingSessions.get(key);
    try { await old.client.disconnect(); } catch (_) {}
    pendingSessions.delete(key);
    authLog('PREV_SESSION_CLEANED', userId, phone, {});
  }

  const { client, session } = buildClient();

  try {
    await client.connect();
    authLog('CLIENT_CONNECTED', userId, phone, {});
  } catch (connErr) {
    try { await client.disconnect(); } catch (_) {}
    throw connErr;
  }

  let result;
  try {
    result = await client.sendCode(
      { apiId: parseInt(process.env.API_ID, 10), apiHash: process.env.API_HASH },
      phone,
    );
  } catch (error) {
    try { await client.disconnect(); } catch (_) {}
    authLog('OTP_REQUEST_FAILED', userId, phone, { error: error.message?.slice(0, 60) });
    throw error;
  }

  const channel = result.isCodeViaApp ? 'telegram-app' : 'sms/call';
  if (!result.isCodeViaApp) {
    await cancelPendingCode(client, phone, result.phoneCodeHash);
    try { await client.disconnect(); } catch (_) {}
    authLog('OTP_REJECTED_NON_APP', userId, phone, { channel, accountId });
    throw new Error(APP_ONLY_OTP_ERROR);
  }
  authLog('OTP_REQUESTED', userId, phone, { channel, accountId });

  pendingSessions.set(key, {
    client,
    session,
    phoneCodeHash:      result.phoneCodeHash,
    isCodeViaApp:       result.isCodeViaApp,
    isPasswordRequired: false,
    phone,
    userId,
    accountId,
    createdAt:          Date.now(),
  });

  // Update ONLY sendOtp throttle; do NOT touch lastResendAt here.
  lastSendAt.set(key, Date.now());

  authLog('PHONE_CODE_HASH_UPDATED', userId, phone, { channel });

  return { isCodeViaApp: result.isCodeViaApp };
};

/**
 * Re-send the OTP code for a (userId, phone) pair that already has a
 * pending session.
 *
 * FIX: Uses its own throttle counter (lastResendAt, 30s) that is SEPARATE
 * from the sendOtp throttle (lastSendAt, 60s). This means pressing the
 * "لم يصلني الرمز" button right after the first OTP is no longer blocked
 * by LOCAL_RESEND_THROTTLED.
 *
 * FIX: Never deletes the pending session before getting the new phoneCodeHash.
 * If auth.ResendCode succeeds → update phoneCodeHash in-place (atomic).
 * If SEND_CODE_UNAVAILABLE → create new client first, then swap, then
 * disconnect old — so verifyOtp never sees an empty session.
 *
 * @param {string} userId
 * @param {string} phone
 */
const resendOtp = async (userId, phone) => {
  const key = pendingKey(userId, phone);

  // Use the RESEND button's own throttle, not the sendOtp throttle.
  const lastAt = lastResendAt.get(key);
  if (lastAt && Date.now() - lastAt < MIN_RESEND_BUTTON_GAP_MS) {
    const waitSec = Math.ceil((MIN_RESEND_BUTTON_GAP_MS - (Date.now() - lastAt)) / 1000);
    throw new Error(`LOCAL_RESEND_THROTTLED:${waitSec}`);
  }

  const pending = pendingSessions.get(key);
  if (!pending) throw new Error('NO_PENDING_SESSION');

  const { client, phoneCodeHash, accountId } = pending;

  authLog('OTP_RESEND', userId, phone, { accountId });

  try {
    // Use official auth.ResendCode — asks Telegram to try next delivery channel.
    const result = await client.invoke(
      new Api.auth.ResendCode({ phoneNumber: phone, phoneCodeHash })
    );

    const deliveredViaApp = isAppDelivery(result);
    const channel = deliveredViaApp ? 'telegram-app' : 'sms/call';
    if (!deliveredViaApp) {
      await cancelPendingCode(client, phone, result.phoneCodeHash);
      await cleanupPending(userId, phone);
      authLog('OTP_REJECTED_NON_APP', userId, phone, { channel, via: 'resend' });
      throw new Error(APP_ONLY_OTP_ERROR);
    }

    // ATOMIC UPDATE: update phoneCodeHash in the existing session.
    // verifyOtp will always find a valid session with the latest hash.
    pending.phoneCodeHash = result.phoneCodeHash;
    pending.isCodeViaApp  = deliveredViaApp;
    pendingSessions.set(key, pending);

    // Update resend throttle only (not sendOtp throttle).
    lastResendAt.set(key, Date.now());

    authLog('PHONE_CODE_HASH_UPDATED', userId, phone, { channel, via: 'resend' });

    return { isCodeViaApp: deliveredViaApp };

  } catch (error) {
    const isUnavailable =
      error?.message?.includes('SEND_CODE_UNAVAILABLE') ||
      error?.errorMessage === 'SEND_CODE_UNAVAILABLE';

    if (!isUnavailable) {
      authLog('OTP_RESEND_FAILED', userId, phone, { error: error.message?.slice(0, 60) });
      throw error;
    }

    // SEND_CODE_UNAVAILABLE fallback: Telegram refused to advance to next channel.
    // We do a fresh sendCode BUT keep the old session alive until the new one is
    // fully ready, then swap atomically — so verifyOtp never sees an empty slot.
    authLog('OTP_RESEND_UNAVAILABLE_FALLBACK', userId, phone, { accountId });

    // Build new client.
    const { client: newClient, session: newSession } = buildClient();

    try {
      await newClient.connect();
    } catch (connErr) {
      try { await newClient.disconnect(); } catch (_) {}
      authLog('OTP_RESEND_FALLBACK_CONNECT_FAILED', userId, phone, { error: connErr.message?.slice(0, 60) });
      throw connErr;
    }

    let newResult;
    try {
      newResult = await newClient.sendCode(
        { apiId: parseInt(process.env.API_ID, 10), apiHash: process.env.API_HASH },
        phone,
      );
    } catch (sendErr) {
      try { await newClient.disconnect(); } catch (_) {}
      authLog('OTP_RESEND_FALLBACK_SEND_FAILED', userId, phone, { error: sendErr.message?.slice(0, 60) });
      throw sendErr;
    }

    const fallbackDeliveredViaApp = isAppDelivery(newResult);
    const fallbackChannel = fallbackDeliveredViaApp ? 'telegram-app' : 'sms/call';
    if (!fallbackDeliveredViaApp) {
      await cancelPendingCode(newClient, phone, newResult.phoneCodeHash);
      try { await newClient.disconnect(); } catch (_) {}
      await cleanupPending(userId, phone);
      authLog('OTP_REJECTED_NON_APP', userId, phone, { channel: fallbackChannel, via: 'resend-fallback' });
      throw new Error(APP_ONLY_OTP_ERROR);
    }

    // New session ready — disconnect old client THEN swap.
    const oldClient = pending.client;
    pendingSessions.set(key, {
      client:             newClient,
      session:            newSession,
      phoneCodeHash:      newResult.phoneCodeHash,
      isCodeViaApp:       fallbackDeliveredViaApp,
      isPasswordRequired: false,
      phone,
      userId,
      accountId,
      createdAt:          pending.createdAt, // keep original start time
    });

    // Update BOTH throttles after a full sendCode.
    lastSendAt.set(key, Date.now());
    lastResendAt.set(key, Date.now());

    // Disconnect old client after session is swapped.
    try { await oldClient.disconnect(); } catch (_) {}

    authLog('PHONE_CODE_HASH_UPDATED', userId, phone, { channel: fallbackChannel, via: 'resend-fallback' });

    return { isCodeViaApp: fallbackDeliveredViaApp };
  }
};

/**
 * Verify the OTP code the user entered.
 *
 * @param {string} userId
 * @param {string} phone
 * @param {string} code
 */
const verifyOtp = async (userId, phone, code) => {
  const key = pendingKey(userId, phone);
  const pending = pendingSessions.get(key);
  if (!pending) throw new Error('NO_PENDING_SESSION');

  const { client, session, phoneCodeHash, accountId } = pending;

  authLog('OTP_VERIFICATION_STARTED', userId, phone, { accountId });

  try {
    await client.invoke(
      new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }),
    );

    const me            = await client.getMe();
    const sessionString = session.save();

    // Clean up throttle maps only after successful login.
    pendingSessions.delete(key);
    lastSendAt.delete(key);
    lastResendAt.delete(key);

    authLog('OTP_VERIFIED', userId, phone, { accountId });

    return {
      needsPassword: false,
      userInfo: {
        firstName:  me.firstName  ?? '',
        lastName:   me.lastName   ?? '',
        username:   me.username   ?? '',
        telegramId: String(me.id),
      },
      sessionString,
      client,
    };
  } catch (error) {
    if (
      error?.message?.includes('SESSION_PASSWORD_NEEDED') ||
      error?.errorMessage === 'SESSION_PASSWORD_NEEDED'
    ) {
      // Keep the same client alive for 2FA step — do NOT delete pending session.
      pending.isPasswordRequired = true;
      pendingSessions.set(key, pending);
      authLog('2FA_REQUIRED', userId, phone, { accountId });
      return { needsPassword: true };
    }
    authLog('OTP_VERIFICATION_FAILED', userId, phone, { error: error.message?.slice(0, 60) });
    throw error;
  }
};

/**
 * Verify the 2FA password. Uses the SAME client kept from verifyOtp.
 *
 * @param {string} userId
 * @param {string} phone
 * @param {string} password  — NEVER logged
 */
const verifyPassword = async (userId, phone, password) => {
  const key = pendingKey(userId, phone);
  const pending = pendingSessions.get(key);
  if (!pending) throw new Error('NO_PENDING_SESSION');

  const { client, session, accountId } = pending;

  authLog('2FA_CHECK_STARTED', userId, phone, { accountId });

  const passwordInfo  = await client.invoke(new Api.account.GetPassword());
  const { computeCheck } = require('telegram/Password');
  const passwordCheck = await computeCheck(passwordInfo, password);

  await client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));

  const me            = await client.getMe();
  const sessionString = session.save();

  pendingSessions.delete(key);
  lastSendAt.delete(key);
  lastResendAt.delete(key);

  authLog('SESSION_SAVED', userId, phone, { accountId });

  return {
    userInfo: {
      firstName:  me.firstName  ?? '',
      lastName:   me.lastName   ?? '',
      username:   me.username   ?? '',
      telegramId: String(me.id),
    },
    sessionString,
    client,
  };
};

// ─── Session persistence ──────────────────────────────────────────────────────

const saveSession = (accountId, phone, sessionString) => {
  const encryptedSession = encrypt(sessionString);
  const safePhone        = phone.replace(/[^0-9]/g, '');
  const sessionFile      = path.join(sessionsDir, `${safePhone}_${accountId}.enc`);

  fs.writeFileSync(sessionFile, encryptedSession, 'utf-8');
  logger.info(`Session saved for account ${accountId} → ${sessionFile}`);

  return { sessionFile, encryptedSession };
};

const restoreSessionFile = (account) => {
  if (!account.encrypted_session) return null;

  const safePhone     = account.phone.replace(/[^0-9]/g, '');
  const canonicalPath = path.join(sessionsDir, `${safePhone}_${account.id}.enc`);

  if (fs.existsSync(canonicalPath)) return canonicalPath;

  try {
    fs.writeFileSync(canonicalPath, account.encrypted_session, 'utf-8');
    logger.info(
      `Session Restore: file recreated from DB backup for account ${account.id} (${maskPhone(account.phone)})`
    );
    return canonicalPath;
  } catch (error) {
    logger.error(
      `Session Restore: failed to recreate session file for account ${account.id}:`,
      error
    );
    return null;
  }
};

const loadSession = async (sessionFile, options = {}) => {
  const { longLived = false } = options;

  if (!fs.existsSync(sessionFile)) {
    throw new Error('Session file not found');
  }

  const encryptedData = fs.readFileSync(sessionFile, 'utf-8');
  const sessionString = decrypt(encryptedData);
  const { client }    = buildClient(sessionString, !longLived);

  await client.connect();

  const isAuthorized = await client.isUserAuthorized();
  if (!isAuthorized) {
    await client.disconnect().catch(() => {});
    throw new Error('Session expired or unauthorized');
  }

  return client;
};

// ─── Active client registry ───────────────────────────────────────────────────

const registerActiveClient = (accountId, client, phone) => {
  activeClients.set(accountId, { client, phone, connectedAt: new Date() });
};

const disconnectClient = async (accountId) => {
  const entry = activeClients.get(accountId);
  if (entry) {
    try { await entry.client.disconnect(); } catch (_) {}
    activeClients.delete(accountId);
    logger.info(`Client ${accountId} disconnected`);
  }
};

/**
 * Cancel / clean up a pending OTP session.
 * Accepts composite key `${userId}:${phone}` or (userId, phone) pair.
 *
 * @param {string} userIdOrKey
 * @param {string} [phone]
 */
const cleanupPending = async (userIdOrKey, phone) => {
  const keys = [];

  if (phone !== undefined) {
    keys.push(pendingKey(userIdOrKey, phone));
  } else if (userIdOrKey.includes(':')) {
    keys.push(userIdOrKey);
  } else {
    // Legacy fallback: scan by plain phone
    for (const k of pendingSessions.keys()) {
      if (k.endsWith(`:${userIdOrKey}`)) keys.push(k);
    }
  }

  for (const k of keys) {
    const pending = pendingSessions.get(k);
    if (pending) {
      try { await pending.client.disconnect(); } catch (_) {}
      pendingSessions.delete(k);
      logger.info(`[AUTH] step=CLEANUP key=${k}`);
    }
    lastSendAt.delete(k);
    lastResendAt.delete(k);
  }
};

const deleteSessionFile = (sessionFile) => {
  try {
    if (sessionFile && fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
      logger.info(`Session file deleted: ${sessionFile}`);
    }
  } catch (error) {
    logger.error('Failed to delete session file:', error);
  }
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  sendOtp,
  resendOtp,
  verifyOtp,
  verifyPassword,
  saveSession,
  loadSession,
  restoreSessionFile,
  registerActiveClient,
  disconnectClient,
  cleanupPending,
  deleteSessionFile,
  translateTelegramError,
  activeClients,
  pendingKey,
};
