const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/encryption');

const sessionsDir = process.env.SESSIONS_DIR || './sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// Active clients map: accountId -> { client, phone }
const activeClients = new Map();

// Pending sessions awaiting OTP: phone -> { client, session, resolve, reject }
const pendingSessions = new Map();

/**
 * Translate Telegram API errors to Arabic user-friendly messages
 */
const translateTelegramError = (error) => {
  const msg = error?.message || error?.toString() || '';

  if (msg.includes('PHONE_NUMBER_INVALID'))
    return 'رقم الهاتف غير صالح. تحقق من الصيغة الدولية.';
  if (msg.includes('PHONE_NUMBER_BANNED'))
    return 'هذا الرقم محظور من تيليجرام.';
  if (msg.includes('PHONE_CODE_INVALID'))
    return 'رمز التحقق غير صحيح. حاول مرة أخرى.';
  if (msg.includes('PHONE_CODE_EXPIRED'))
    return 'انتهت صلاحية رمز التحقق. أعد طلب رمز جديد.';
  if (msg.includes('PASSWORD_HASH_INVALID'))
    return 'كلمة المرور غير صحيحة. حاول مرة أخرى.';
  if (msg.includes('SESSION_PASSWORD_NEEDED'))
    return 'يحتاج الحساب إلى كلمة مرور التحقق بخطوتين.';
  if (msg.includes('FLOOD_WAIT'))
    return `تجاوزت حد الطلبات. انتظر ${msg.match(/\d+/)?.[0] || 'بضع'} ثوانٍ ثم حاول.`;
  if (msg.includes('AUTH_KEY_UNREGISTERED'))
    return 'انتهت صلاحية الجلسة. أعد تسجيل الدخول.';
  if (msg.includes('USER_DEACTIVATED'))
    return 'هذا الحساب معطل أو محذوف.';
  if (msg.includes('NETWORK') || msg.includes('ECONNREFUSED'))
    return 'خطأ في الاتصال بتيليجرام. تحقق من الإنترنت.';
  if (msg.includes('TOO_MANY_REQUESTS'))
    return 'طلبات كثيرة جدًا. انتظر قليلًا ثم حاول.';

  logger.warn('Unmapped Telegram error:', msg);
  return `خطأ غير متوقع: ${msg.slice(0, 100)}`;
};

/**
 * Build a new TelegramClient instance
 */
const buildClient = (sessionString = '') => {
  const apiId = parseInt(process.env.API_ID, 10);
  const apiHash = process.env.API_HASH;

  if (!apiId || !apiHash) {
    throw new Error('API_ID and API_HASH must be set in environment variables');
  }

  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
    retryDelay: 1000,
    autoReconnect: true,
    useWSS: false,
    deviceModel: 'Desktop',
    systemVersion: 'Linux',
    appVersion: '1.0.0',
    langCode: 'ar',
  });

  return { client, session };
};

/**
 * Send OTP to phone number — returns a pending session key
 * @param {string} phone
 * @returns {Promise<{ pendingKey: string }>}
 */
const sendOtp = async (phone) => {
  // Cleanup any previous pending session for this phone
  if (pendingSessions.has(phone)) {
    const old = pendingSessions.get(phone);
    try {
      await old.client.disconnect();
    } catch (_) {}
    pendingSessions.delete(phone);
  }

  const { client, session } = buildClient();

  await client.connect();

  const result = await client.sendCode(
    {
      apiId: parseInt(process.env.API_ID, 10),
      apiHash: process.env.API_HASH,
    },
    phone
  );

  pendingSessions.set(phone, {
    client,
    session,
    phoneCodeHash: result.phoneCodeHash,
    isPasswordRequired: false,
  });

  logger.info(`OTP sent to ${phone}`);
  return { pendingKey: phone };
};

/**
 * Verify OTP code
 * @param {string} phone
 * @param {string} code
 * @returns {Promise<{ needsPassword: boolean, userInfo?: object, sessionString?: string }>}
 */
const verifyOtp = async (phone, code) => {
  const pending = pendingSessions.get(phone);
  if (!pending) {
    throw new Error('NO_PENDING_SESSION');
  }

  const { client, session, phoneCodeHash } = pending;

  try {
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code,
      })
    );

    const me = await client.getMe();
    const sessionString = session.save();

    pendingSessions.delete(phone);

    return {
      needsPassword: false,
      userInfo: {
        firstName: me.firstName || '',
        lastName: me.lastName || '',
        username: me.username || '',
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
      pending.isPasswordRequired = true;
      pendingSessions.set(phone, pending);
      return { needsPassword: true };
    }
    throw error;
  }
};

/**
 * Verify 2FA password
 * @param {string} phone
 * @param {string} password
 * @returns {Promise<{ userInfo: object, sessionString: string, client: object }>}
 */
const verifyPassword = async (phone, password) => {
  const pending = pendingSessions.get(phone);
  if (!pending) {
    throw new Error('NO_PENDING_SESSION');
  }

  const { client, session } = pending;

  const passwordInfo = await client.invoke(new Api.account.GetPassword());
  const { computeCheck } = require('telegram/Password');
  const passwordCheck = await computeCheck(passwordInfo, password);

  await client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));

  const me = await client.getMe();
  const sessionString = session.save();

  pendingSessions.delete(phone);

  return {
    userInfo: {
      firstName: me.firstName || '',
      lastName: me.lastName || '',
      username: me.username || '',
      telegramId: String(me.id),
    },
    sessionString,
    client,
  };
};

/**
 * Save session string encrypted to disk and DB field
 * @param {number} accountId
 * @param {string} phone
 * @param {string} sessionString
 * @returns {{ sessionFile: string, encryptedSession: string }}
 */
const saveSession = (accountId, phone, sessionString) => {
  const encryptedSession = encrypt(sessionString);
  const safePhone = phone.replace(/[^0-9]/g, '');
  const sessionFile = path.join(sessionsDir, `${safePhone}_${accountId}.enc`);

  fs.writeFileSync(sessionFile, encryptedSession, 'utf-8');
  logger.info(`Session saved for account ${accountId}`);

  return { sessionFile, encryptedSession };
};

/**
 * Load and restore a session from disk
 * @param {string} sessionFile
 * @returns {Promise<TelegramClient>}
 */
const loadSession = async (sessionFile) => {
  if (!fs.existsSync(sessionFile)) {
    throw new Error('Session file not found');
  }

  const encryptedData = fs.readFileSync(sessionFile, 'utf-8');
  const sessionString = decrypt(encryptedData);
  const { client } = buildClient(sessionString);

  await client.connect();

  const isAuthorized = await client.isUserAuthorized();
  if (!isAuthorized) {
    throw new Error('Session expired or unauthorized');
  }

  return client;
};

/**
 * Register a connected client in the active map
 * @param {number} accountId
 * @param {object} client
 * @param {string} phone
 */
const registerActiveClient = (accountId, client, phone) => {
  activeClients.set(accountId, { client, phone, connectedAt: new Date() });
};

/**
 * Disconnect and remove a client
 * @param {number} accountId
 */
const disconnectClient = async (accountId) => {
  const entry = activeClients.get(accountId);
  if (entry) {
    try {
      await entry.client.disconnect();
    } catch (_) {}
    activeClients.delete(accountId);
    logger.info(`Client ${accountId} disconnected`);
  }
};

/**
 * Cleanup pending session for a phone (on cancel/timeout)
 * @param {string} phone
 */
const cleanupPending = async (phone) => {
  const pending = pendingSessions.get(phone);
  if (pending) {
    try {
      await pending.client.disconnect();
    } catch (_) {}
    pendingSessions.delete(phone);
  }
};

/**
 * Delete session file from disk
 * @param {string} sessionFile
 */
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

module.exports = {
  sendOtp,
  verifyOtp,
  verifyPassword,
  saveSession,
  loadSession,
  registerActiveClient,
  disconnectClient,
  cleanupPending,
  deleteSessionFile,
  translateTelegramError,
  activeClients,
};
