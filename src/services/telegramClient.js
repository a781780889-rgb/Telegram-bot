/**
 * Telegram Client Service
 *
 * Handles all low-level MTProto interactions:
 *  - OTP login flow (sendOtp → verifyOtp → optional verifyPassword)
 *  - Session persistence (encrypted on disk + DB backup)
 *  - Loading / restoring saved sessions
 *  - Managing active client lifecycle
 *
 * TIMEOUT fix: use WebSocket (useWSS: true) so the MTProto connection
 * survives Railway's TCP-idle-kill policy.
 *
 * PERSISTENCE fix: restoreSessionFile() recreates the session file from
 * the encrypted_session stored in the DB when the file is missing (e.g.
 * after a container restart or a fresh deployment).
 *
 * LONG-LIVED CONNECTIONS fix: loadSession() defaults to the same
 * short-lived "forSearch" profile it always has (autoReconnect off, quick
 * retries) — unchanged for every existing caller. Pass
 * `{ longLived: true }` to get a profile with autoReconnect ON and more
 * generous retries, for callers that hold the connection open for a long
 * time (e.g. the join-to-links engine, which can run for many minutes
 * with rests/FloodWaits in between). Using the short-lived profile for
 * those long runs was the root cause of the continuous "Error: TIMEOUT"
 * spam seen in production: the connection gave up reconnecting after the
 * first network hiccup and the client's internal update loop then kept
 * retrying against a dead socket indefinitely.
 */

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { Api }            = require('telegram');
const path               = require('path');
const fs                 = require('fs');
const logger             = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/encryption');

// ─── Directory bootstrap ──────────────────────────────────────────────────────

const sessionsDir = process.env.SESSIONS_DIR || './sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// ─── In-memory state maps ─────────────────────────────────────────────────────

/** accountId → { client, phone, connectedAt } */
const activeClients = new Map();

/**
 * phone → { client, session, phoneCodeHash, isPasswordRequired }
 * Lives only during the OTP / 2FA wizard.
 */
const pendingSessions = new Map();

// ─── Error translation ────────────────────────────────────────────────────────

/**
 * Map common Telegram API error strings to human-readable Arabic messages.
 * @param {Error|any} error
 * @returns {string}
 */
const translateTelegramError = (error) => {
  const msg = error?.message ?? error?.toString() ?? '';

  if (msg.includes('PHONE_NUMBER_INVALID'))    return 'رقم الهاتف غير صالح. تحقق من الصيغة الدولية.';
  if (msg.includes('PHONE_NUMBER_BANNED'))     return 'هذا الرقم محظور من تيليجرام.';
  if (msg.includes('PHONE_CODE_INVALID'))      return 'رمز التحقق غير صحيح. حاول مرة أخرى.';
  if (msg.includes('PHONE_CODE_EXPIRED'))      return 'انتهت صلاحية رمز التحقق. أعد طلب رمز جديد.';
  if (msg.includes('PASSWORD_HASH_INVALID'))   return 'كلمة المرور غير صحيحة. حاول مرة أخرى.';
  if (msg.includes('SESSION_PASSWORD_NEEDED')) return 'يحتاج الحساب إلى كلمة مرور التحقق بخطوتين.';
  if (msg.includes('FLOOD_WAIT'))              return `تجاوزت حد الطلبات. انتظر ${msg.match(/\d+/)?.[0] ?? 'بضع'} ثوانٍ ثم حاول.`;
  if (msg.includes('AUTH_KEY_UNREGISTERED'))   return 'انتهت صلاحية الجلسة. أعد تسجيل الدخول.';
  if (msg.includes('USER_DEACTIVATED'))        return 'هذا الحساب معطل أو محذوف.';
  if (msg.includes('NETWORK') || msg.includes('ECONNREFUSED')) return 'خطأ في الاتصال بتيليجرام. تحقق من الإنترنت.';
  if (msg.includes('TOO_MANY_REQUESTS'))       return 'طلبات كثيرة جدًا. انتظر قليلًا ثم حاول.';
  if (msg.includes('TIMEOUT'))                 return 'انتهت مهلة الاتصال بتيليجرام. حاول مرة أخرى.';

  logger.warn('Unmapped Telegram error:', msg);
  return `خطأ غير متوقع: ${msg.slice(0, 100)}`;
};

// ─── Client factory ───────────────────────────────────────────────────────────

/**
 * Build a new TelegramClient instance.
 *
 * @param {string}  sessionString  Saved session string, or '' for a fresh session.
 * @param {boolean} forSearch      True ⇒ short-lived client for reading messages.
 * @returns {{ client: TelegramClient, session: StringSession }}
 */
const buildClient = (sessionString = '', forSearch = false) => {
  const apiId   = parseInt(process.env.API_ID, 10);
  const apiHash = process.env.API_HASH;

  if (!apiId || !apiHash) {
    throw new Error('API_ID and API_HASH must be set in environment variables');
  }

  const session = new StringSession(sessionString);

  const client = new TelegramClient(session, apiId, apiHash, {
    useWSS:            true,
    connectionRetries: forSearch ? 2 : 5,
    retryDelay:        forSearch ? 1000 : 2000,
    autoReconnect:     !forSearch,
    deviceModel:       'Desktop',
    systemVersion:     'Linux',
    appVersion:        '1.0.0',
    langCode:          'ar',
  });

  return { client, session };
};

// ─── OTP Flow ─────────────────────────────────────────────────────────────────

/**
 * Initiate a login by sending an OTP to the given phone number.
 * @param {string} phone  International format, e.g. "+966501234567"
 * @returns {Promise<{ pendingKey: string }>}
 */
const sendOtp = async (phone) => {
  if (pendingSessions.has(phone)) {
    const old = pendingSessions.get(phone);
    try { await old.client.disconnect(); } catch (_) {}
    pendingSessions.delete(phone);
  }

  const { client, session } = buildClient();
  await client.connect();

  const result = await client.sendCode(
    { apiId: parseInt(process.env.API_ID, 10), apiHash: process.env.API_HASH },
    phone,
  );

  pendingSessions.set(phone, {
    client,
    session,
    phoneCodeHash:      result.phoneCodeHash,
    isPasswordRequired: false,
  });

  logger.info(`OTP sent to ${phone}`);
  return { pendingKey: phone };
};

/**
 * Verify the OTP code the user entered.
 * @param {string} phone
 * @param {string} code
 * @returns {Promise<{
 *   needsPassword: boolean,
 *   userInfo?: object,
 *   sessionString?: string,
 *   client?: TelegramClient
 * }>}
 */
const verifyOtp = async (phone, code) => {
  const pending = pendingSessions.get(phone);
  if (!pending) throw new Error('NO_PENDING_SESSION');

  const { client, session, phoneCodeHash } = pending;

  try {
    await client.invoke(
      new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }),
    );

    const me            = await client.getMe();
    const sessionString = session.save();
    pendingSessions.delete(phone);

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
      pending.isPasswordRequired = true;
      pendingSessions.set(phone, pending);
      return { needsPassword: true };
    }
    throw error;
  }
};

/**
 * Verify the 2FA password for an account that requires it.
 * @param {string} phone
 * @param {string} password
 * @returns {Promise<{ userInfo: object, sessionString: string, client: TelegramClient }>}
 */
const verifyPassword = async (phone, password) => {
  const pending = pendingSessions.get(phone);
  if (!pending) throw new Error('NO_PENDING_SESSION');

  const { client, session } = pending;

  const passwordInfo  = await client.invoke(new Api.account.GetPassword());
  const { computeCheck } = require('telegram/Password');
  const passwordCheck = await computeCheck(passwordInfo, password);

  await client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));

  const me            = await client.getMe();
  const sessionString = session.save();
  pendingSessions.delete(phone);

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

/**
 * Encrypt and write the session string to disk.
 * Always uses the canonical path derived from sessionsDir + phone + id
 * so that the path stays valid even if the environment changes.
 *
 * @param {number} accountId
 * @param {string} phone
 * @param {string} sessionString
 * @returns {{ sessionFile: string, encryptedSession: string }}
 */
const saveSession = (accountId, phone, sessionString) => {
  const encryptedSession = encrypt(sessionString);
  const safePhone        = phone.replace(/[^0-9]/g, '');
  const sessionFile      = path.join(sessionsDir, `${safePhone}_${accountId}.enc`);

  fs.writeFileSync(sessionFile, encryptedSession, 'utf-8');
  logger.info(`Session saved for account ${accountId} → ${sessionFile}`);

  return { sessionFile, encryptedSession };
};

/**
 * Restore a session file from the encrypted_session stored in the database.
 *
 * Called on startup when the session file may be missing (e.g. after a
 * container restart or a fresh deployment to Railway / another host).
 * The canonical file path is always recomputed from the current
 * SESSIONS_DIR so that stale absolute paths in the DB are corrected.
 *
 * @param {object} account  Full account row from the database.
 *                          Must have: id, phone, encrypted_session.
 * @returns {string|null}   Absolute path to the session file,
 *                          or null if restoration is not possible.
 */
const restoreSessionFile = (account) => {
  if (!account.encrypted_session) {
    return null;
  }

  const safePhone       = account.phone.replace(/[^0-9]/g, '');
  const canonicalPath   = path.join(sessionsDir, `${safePhone}_${account.id}.enc`);

  // File already present at the canonical path — nothing to do.
  if (fs.existsSync(canonicalPath)) {
    return canonicalPath;
  }

  // File missing — recreate from the DB backup (encrypted_session column).
  try {
    fs.writeFileSync(canonicalPath, account.encrypted_session, 'utf-8');
    logger.info(
      `Session Restore: file recreated from DB backup for account ${account.id} (${account.phone})`
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

/**
 * Load a saved, encrypted session from disk and return an authenticated client.
 *
 * By default configured for short-lived use (forSearch = true), exactly as
 * before. Pass `{ longLived: true }` for callers that keep the connection
 * open for a long time — see the "LONG-LIVED CONNECTIONS fix" note above.
 *
 * Callers are responsible for calling client.disconnect() when done.
 *
 * @param {string} sessionFile  Absolute or relative path to the .enc file.
 * @param {{ longLived?: boolean }} [options]
 * @returns {Promise<TelegramClient>}
 */
const loadSession = async (sessionFile, options = {}) => {
  const { longLived = false } = options;

  if (!fs.existsSync(sessionFile)) {
    throw new Error('Session file not found');
  }

  const encryptedData = fs.readFileSync(sessionFile, 'utf-8');
  const sessionString = decrypt(encryptedData);
  const { client }    = buildClient(sessionString, /* forSearch */ !longLived);

  await client.connect();

  const isAuthorized = await client.isUserAuthorized();
  if (!isAuthorized) {
    await client.disconnect().catch(() => {});
    throw new Error('Session expired or unauthorized');
  }

  return client;
};

// ─── Active client registry ───────────────────────────────────────────────────

/**
 * Register a successfully connected client in the active-clients map.
 * @param {number} accountId
 * @param {TelegramClient} client
 * @param {string} phone
 */
const registerActiveClient = (accountId, client, phone) => {
  activeClients.set(accountId, { client, phone, connectedAt: new Date() });
};

/**
 * Gracefully disconnect and deregister an active client.
 * @param {number} accountId
 */
const disconnectClient = async (accountId) => {
  const entry = activeClients.get(accountId);
  if (entry) {
    try { await entry.client.disconnect(); } catch (_) {}
    activeClients.delete(accountId);
    logger.info(`Client ${accountId} disconnected`);
  }
};

/**
 * Cancel / clean up a pending OTP session (e.g. user pressed Cancel).
 * @param {string} phone
 */
const cleanupPending = async (phone) => {
  const pending = pendingSessions.get(phone);
  if (pending) {
    try { await pending.client.disconnect(); } catch (_) {}
    pendingSessions.delete(phone);
  }
};

/**
 * Remove an encrypted session file from disk.
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

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  sendOtp,
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
};
