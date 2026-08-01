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
 * 1. Proxy Support: Added SOCKS5 proxy support via PROXY_ environment variables.
 * 2. Railway Stability: Optimized connection settings for cloud environments.
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
 */
const pendingSessions = new Map();

/**
 * Composite key → timestamp of last sendOtp() call.
 */
const lastSendAt = new Map();
const MIN_RESEND_GAP_MS = 60 * 1000;

/**
 * Composite key → timestamp of last resendOtp() call (button press).
 */
const lastResendAt = new Map();
const MIN_RESEND_BUTTON_GAP_MS = 30 * 1000;

// ─── Composite key helper ─────────────────────────────────────────────────────

const pendingKey = (userId, phone) => `${userId}:${phone}`;

// ─── Auth logging helpers ─────────────────────────────────────────────────────

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
  if (msg.includes('NETWORK') || msg.includes('ECONNREFUSED')) return 'خطأ في الاتصال بتيليجرام. قد يكون بسبب حظر IP الخادم، جرب استخدام بروكسي.';
  if (msg.includes('TOO_MANY_REQUESTS'))       return 'طلبات كثيرة جدًا. انتظر قليلًا ثم حاول.';
  if (msg.includes('TIMEOUT'))                 return 'انتهت مهلة الاتصال بتيليجرام. حاول مرة أخرى.';
  
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

  // Proxy Configuration
  let proxy = undefined;
  if (process.env.PROXY_HOST && process.env.PROXY_PORT) {
    proxy = {
      ip: process.env.PROXY_HOST,
      port: parseInt(process.env.PROXY_PORT, 10),
      socksType: 5,
      timeout: 10,
    };
    if (process.env.PROXY_USER && process.env.PROXY_PASS) {
      proxy.username = process.env.PROXY_USER;
      proxy.password = process.env.PROXY_PASS;
    }
    logger.info(`Using SOCKS5 proxy: ${proxy.ip}:${proxy.port}`);
  }

  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries:   forSearch ? 2 : 10,
    retryDelay:          forSearch ? 1000 : 3000,
    autoReconnect:       !forSearch,
    floodSleepThreshold: 60,
    requestRetries:      3,
    deviceModel:         'Desktop',
    systemVersion:       'Linux',
    appVersion:          '1.0.0',
    langCode:            'ar',
    systemLangCode:      'en',
    proxy:               proxy,
  });

  return { client, session };
};

// ─── OTP Flow ─────────────────────────────────────────────────────────────────

const sendOtp = async (userId, phone, accountId, { skipThrottle = false } = {}) => {
  const key = pendingKey(userId, phone);
  authLog('AUTH_START', userId, phone, { accountId });

  if (!skipThrottle) {
    const lastAt = lastSendAt.get(key);
    if (lastAt && Date.now() - lastAt < MIN_RESEND_GAP_MS) {
      const waitSec = Math.ceil((MIN_RESEND_GAP_MS - (Date.now() - lastAt)) / 1000);
      throw new Error(`LOCAL_RESEND_THROTTLED:${waitSec}`);
    }
  }

  if (pendingSessions.has(key)) {
    const old = pendingSessions.get(key);
    try { await old.client.disconnect(); } catch (_) {}
    pendingSessions.delete(key);
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

  lastSendAt.set(key, Date.now());
  return { isCodeViaApp: result.isCodeViaApp };
};

const resendOtp = async (userId, phone) => {
  const key = pendingKey(userId, phone);
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
    const result = await client.invoke(
      new Api.auth.ResendCode({ phoneNumber: phone, phoneCodeHash })
    );

    pending.phoneCodeHash = result.phoneCodeHash;
    pending.isCodeViaApp  = result.isCodeViaApp;
    pendingSessions.set(key, pending);
    lastResendAt.set(key, Date.now());

    return { isCodeViaApp: result.isCodeViaApp };
  } catch (error) {
    const isUnavailable = error?.message?.includes('SEND_CODE_UNAVAILABLE');
    if (!isUnavailable) throw error;

    return await sendOtp(userId, phone, accountId, { skipThrottle: true });
  }
};

const verifyOtp = async (userId, phone, code) => {
  const key = pendingKey(userId, phone);
  const pending = pendingSessions.get(key);
  if (!pending) throw new Error('NO_PENDING_SESSION');

  const { client, phoneCodeHash } = pending;
  authLog('OTP_VERIFY', userId, phone, {});

  try {
    await client.signIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code });
  } catch (error) {
    if (error.message?.includes('SESSION_PASSWORD_NEEDED')) {
      pending.isPasswordRequired = true;
      pendingSessions.set(key, pending);
      return { needsPassword: true };
    }
    throw error;
  }

  const me = await client.getMe();
  const sessionString = client.session.save();
  
  return {
    userInfo: {
      telegramId: String(me.id),
      username: me.username,
      firstName: me.firstName,
      lastName: me.lastName,
    },
    sessionString,
    client,
  };
};

const verifyPassword = async (userId, phone, password) => {
  const key = pendingKey(userId, phone);
  const pending = pendingSessions.get(key);
  if (!pending) throw new Error('NO_PENDING_SESSION');

  const { client } = pending;
  authLog('PASSWORD_VERIFY', userId, phone, {});

  await client.signIn({ phoneNumber: phone, password });

  const me = await client.getMe();
  const sessionString = client.session.save();

  return {
    userInfo: {
      telegramId: String(me.id),
      username: me.username,
      firstName: me.firstName,
      lastName: me.lastName,
    },
    sessionString,
    client,
  };
};

const saveSession = (accountId, phone, sessionString) => {
  const encrypted = encrypt(sessionString);
  const fileName = `session_${accountId}.json`;
  const filePath = path.join(sessionsDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify({
    accountId,
    phone,
    session: encrypted,
    updatedAt: new Date().toISOString(),
  }, null, 2));

  return { sessionFile: fileName, encryptedSession: encrypted };
};

const loadSession = async (sessionFileName, { longLived = false } = {}) => {
  const filePath = path.join(sessionsDir, sessionFileName);
  if (!fs.existsSync(filePath)) return null;

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const sessionString = decrypt(data.session);

  const { client } = buildClient(sessionString);
  await client.connect();
  return client;
};

const registerActiveClient = (accountId, client, phone) => {
  activeClients.set(accountId, { client, phone, connectedAt: Date.now() });
};

const disconnectClient = async (accountId) => {
  const active = activeClients.get(accountId);
  if (active) {
    try { await active.client.disconnect(); } catch (_) {}
    activeClients.delete(accountId);
  }
};

const cleanupPending = async (userId, phone) => {
  const key = pendingKey(userId, phone);
  const pending = pendingSessions.get(key);
  if (pending) {
    try { await pending.client.disconnect(); } catch (_) {}
    pendingSessions.delete(key);
  }
};

const restoreSessionFile = (account) => {
  if (!account.encrypted_session) return null;
  const fileName = `session_${account.id}.json`;
  const filePath = path.join(sessionsDir, fileName);

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({
      accountId: account.id,
      phone: account.phone,
      session: account.encrypted_session,
      updatedAt: new Date().toISOString(),
    }, null, 2));
  }
  return fileName;
};

module.exports = {
  sendOtp,
  resendOtp,
  verifyOtp,
  verifyPassword,
  saveSession,
  loadSession,
  registerActiveClient,
  disconnectClient,
  cleanupPending,
  restoreSessionFile,
  translateTelegramError,
  activeClients,
};
