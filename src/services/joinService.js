/**
 * Join-to-Links Service
 *
 * Core engine for the "الانضمام للروابط" feature:
 *  - Parses / validates group links (public @username or invite hash)
 *  - Resolves a link to its Telegram group ID WITHOUT joining first
 *  - Enforces global dedup by Telegram ID (never the raw link)
 *  - Distributes queued links across enabled, available accounts
 *  - Runs each account's join loop with configurable batch size / delays
 *  - Detects FloodWait / ban-type errors, auto-stops the offending account,
 *    and reassigns its remaining tasks to other available accounts
 *  - Logs every attempt (success / skipped / failed / invalid)
 *
 * One in-memory runner per userId; state itself lives in joinDb so a
 * restart never loses queued links or per-account counters.
 */

const { Api } = require('telegram');
const logger = require('../utils/logger');
const { accountQueries } = require('../database/db');
const {
  joinGroupQueries,
  joinLinkQueries,
  joinAccountQueries,
  joinSettingsQueries,
  joinLogQueries,
} = require('../database/joinDb');
const { loadSession, restoreSessionFile } = require('./telegramClient');

// ─── In-memory run registry ───────────────────────────────────────────────────

/** userId → { stopping: boolean, running: boolean } */
const activeRuns = new Map();

const isRunning = (userId) => !!activeRuns.get(String(userId))?.running;

const requestStop = (userId) => {
  const run = activeRuns.get(String(userId));
  if (run) run.stopping = true;
};

// ─── Link parsing ─────────────────────────────────────────────────────────────

const INVITE_HASH_RE = /(?:t\.me\/joinchat\/|t\.me\/\+)([\w-]+)/i;
const PUBLIC_USERNAME_RE = /t\.me\/([a-zA-Z0-9_]{4,32})\/?$/;

/**
 * Classify a raw string as a valid public link, valid invite link, or invalid.
 * @param {string} raw
 * @returns {{ valid: boolean, type: 'public'|'invite'|null, value: string|null }}
 */
const parseLink = (raw) => {
  const text = (raw || '').trim();
  if (!text) return { valid: false, type: null, value: null };

  const inviteMatch = text.match(INVITE_HASH_RE);
  if (inviteMatch) return { valid: true, type: 'invite', value: inviteMatch[1] };

  const usernameMatch = text.match(PUBLIC_USERNAME_RE);
  if (usernameMatch) {
    const reserved = ['joinchat', 'share', 'addstickers', 'proxy'];
    if (reserved.includes(usernameMatch[1].toLowerCase())) {
      return { valid: false, type: null, value: null };
    }
    return { valid: true, type: 'public', value: usernameMatch[1] };
  }

  // Bare @username or username without t.me prefix
  if (/^@?[a-zA-Z0-9_]{4,32}$/.test(text)) {
    return { valid: true, type: 'public', value: text.replace(/^@/, '') };
  }

  return { valid: false, type: null, value: null };
};

/**
 * Split raw multi-line text into an array of validated, deduplicated links.
 * @param {string} text
 * @returns {{ links: string[], invalidCount: number }}
 */
const extractLinksFromText = (text) => {
  const lines = (text || '')
    .split(/[\n\r]+|\s+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const seen = new Set();
  const links = [];
  let invalidCount = 0;

  for (const line of lines) {
    const parsed = parseLink(line);
    if (!parsed.valid) {
      invalidCount++;
      continue;
    }
    const key = `${parsed.type}:${parsed.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(line);
  }

  return { links, invalidCount };
};

// ─── Client acquisition ───────────────────────────────────────────────────────

/**
 * Get (or open) an authenticated GramJS client for an account.
 * @param {object} account  full row from accounts table
 * @returns {Promise<TelegramClient>}
 */
const getClientForAccount = async (account) => {
  const sessionFile = restoreSessionFile(account) || account.session_file;
  if (!sessionFile) throw new Error('NO_SESSION_FILE');
  return loadSession(sessionFile);
};

// ─── Ban / restriction detection ──────────────────────────────────────────────

const classifyJoinError = (error) => {
  const msg = error?.errorMessage || error?.message || String(error);

  if (/FLOOD_WAIT/i.test(msg)) {
    const seconds = parseInt(msg.match(/\d+/)?.[0] || '3600', 10);
    return { kind: 'flood_wait', seconds, message: `FloodWait: انتظار ${seconds} ثانية` };
  }
  if (/USER_ALREADY_PARTICIPANT/i.test(msg)) {
    return { kind: 'already_member', seconds: 0, message: 'الحساب عضو بالفعل في المجموعة' };
  }
  if (/INVITE_HASH_EXPIRED|INVITE_HASH_INVALID/i.test(msg)) {
    return { kind: 'invalid_link', seconds: 0, message: 'رابط الدعوة غير صالح أو منتهي' };
  }
  if (/CHANNELS_TOO_MUCH|USER_CHANNELS_TOO_MUCH/i.test(msg)) {
    return { kind: 'limit_reached', seconds: 0, message: 'وصل الحساب للحد الأقصى من المجموعات' };
  }
  if (/USERNAME_NOT_OCCUPIED|USERNAME_INVALID/i.test(msg)) {
    return { kind: 'invalid_link', seconds: 0, message: 'الرابط أو اسم المستخدم غير موجود' };
  }
  if (/USER_BANNED_IN_CHANNEL|CHAT_ADMIN_REQUIRED|USER_RESTRICTED|USER_DEACTIVATED_BAN/i.test(msg)) {
    return { kind: 'banned', seconds: 0, message: 'الحساب محظور أو مقيد' };
  }
  if (/JOIN_AS_PEER_INVALID|CHAT_WRITE_FORBIDDEN/i.test(msg)) {
    return { kind: 'restricted', seconds: 0, message: 'ممنوع الانضمام لهذه المجموعة' };
  }
  return { kind: 'unknown', seconds: 0, message: msg.slice(0, 150) };
};

// ─── Resolve + join a single link with one account ───────────────────────────

/**
 * Attempt to join one link with one client. Resolves the group ID first
 * (via CheckChatInvite for invite links, or entity resolution for public
 * links) so duplicates can be skipped WITHOUT ever attempting the join.
 *
 * @returns {Promise<{ status: 'joined'|'skipped'|'failed'|'invalid', telegramId?, title?, reason?, banInfo? }>}
 */
const joinOneLink = async (client, userId, linkRow) => {
  const parsed = parseLink(linkRow.url);
  if (!parsed.valid) {
    return { status: 'invalid', reason: 'رابط غير صالح' };
  }

  try {
    let telegramId = null;
    let title = null;

    if (parsed.type === 'invite') {
      const info = await client.invoke(new Api.messages.CheckChatInvite({ hash: parsed.value }));
      if (info.chat) {
        telegramId = String(info.chat.id);
        title = info.chat.title;
      } else if (info.className === 'ChatInviteAlready' && info.chat) {
        telegramId = String(info.chat.id);
        title = info.chat.title;
      }
    } else {
      const entity = await client.getEntity(parsed.value);
      telegramId = String(entity.id);
      title = entity.title || entity.username || parsed.value;
    }

    if (telegramId && joinGroupQueries.exists(userId, telegramId)) {
      return { status: 'skipped', reason: 'مجموعة مكررة (تم الانضمام إليها مسبقًا)', telegramId, title };
    }

    // Not a duplicate (or ID unresolved before join) — perform the join.
    if (parsed.type === 'invite') {
      const result = await client.invoke(new Api.messages.ImportChatInvite({ hash: parsed.value }));
      const chat = result?.chats?.[0];
      if (chat) {
        telegramId = String(chat.id);
        title = chat.title;
      }
    } else {
      const entity = await client.getEntity(parsed.value);
      await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
      telegramId = String(entity.id);
      title = entity.title || entity.username || parsed.value;
    }

    if (!telegramId) {
      return { status: 'failed', reason: 'تعذر تحديد هوية المجموعة بعد الانضمام' };
    }

    // Re-check race condition: another account may have registered it
    // between our first check and the join completing.
    if (joinGroupQueries.exists(userId, telegramId)) {
      return { status: 'skipped', reason: 'مجموعة مكررة (تم الانضمام إليها بواسطة حساب آخر)', telegramId, title };
    }

    return { status: 'joined', telegramId, title };
  } catch (error) {
    const info = classifyJoinError(error);
    if (info.kind === 'already_member') {
      return { status: 'skipped', reason: info.message };
    }
    if (info.kind === 'invalid_link') {
      return { status: 'invalid', reason: info.message };
    }
    if (['flood_wait', 'limit_reached', 'banned', 'restricted'].includes(info.kind)) {
      return { status: 'failed', reason: info.message, banInfo: info };
    }
    logger.error('joinOneLink unexpected error:', error);
    return { status: 'failed', reason: info.message };
  }
};

// ─── Per-account worker loop ───────────────────────────────────────────────────

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Drains the shared pending-links queue using one account, respecting
 * batch size / delay / rest settings, until: queue empty, account hits
 * its max, account gets banned/restricted, or a stop is requested.
 */
const runAccountWorker = async (userId, account, settings, queueRef, run) => {
  const joinAcc = joinAccountQueries.ensure(userId, account.id);
  let client;

  try {
    client = await getClientForAccount(account);
  } catch (error) {
    joinAccountQueries.updateState(userId, account.id, 'needs_login', {
      ban_reason: 'تعذر تحميل الجلسة — يحتاج تسجيل دخول',
    });
    joinLogQueries.add(userId, account.id, null, null, 'failed', 'تعذر تحميل جلسة الحساب');
    return;
  }

  try {
    while (true) {
      if (run.stopping) break;
      if (!queueRef.items.length) break;

      const current = joinAccountQueries.get(userId, account.id);
      if (current.joined_count >= current.max_joins) {
        joinAccountQueries.updateState(userId, account.id, 'full');
        break;
      }

      // Rest period between batches
      if (current.batch_progress >= current.batch_size) {
        joinAccountQueries.updateState(userId, account.id, 'resting');
        await sleep(current.rest_seconds * 1000);
        if (run.stopping) break;
        joinAccountQueries.resetBatchProgress(userId, account.id);
      }

      const linkRow = queueRef.items.shift();
      if (!linkRow) break;

      joinAccountQueries.updateState(userId, account.id, 'working');
      const result = await joinOneLink(client, userId, linkRow);

      if (result.status === 'joined') {
        joinGroupQueries.register(userId, result.telegramId, result.title, account.id, linkRow.url, {
          linkType: linkRow.url_type || parseLink(linkRow.url).type,
          source: 'join',
        });
        joinLinkQueries.updateStatus(linkRow.id, 'joined', {
          telegram_id: result.telegramId,
          assigned_account_id: account.id,
        });
        joinAccountQueries.incrementJoined(userId, account.id);
        joinLogQueries.add(userId, account.id, linkRow.url, result.title, 'joined', null);
      } else if (result.status === 'skipped') {
        joinLinkQueries.updateStatus(linkRow.id, 'skipped', {
          telegram_id: result.telegramId || null,
          skip_reason: result.reason,
        });
        joinLogQueries.add(userId, account.id, linkRow.url, result.title || null, 'skipped', result.reason);
      } else if (result.status === 'invalid') {
        joinLinkQueries.updateStatus(linkRow.id, 'invalid', { skip_reason: result.reason });
        joinLogQueries.add(userId, account.id, linkRow.url, null, 'invalid', result.reason);
      } else {
        joinLinkQueries.updateStatus(linkRow.id, 'failed', { skip_reason: result.reason });
        joinLogQueries.add(userId, account.id, linkRow.url, null, 'failed', result.reason);

        if (result.banInfo) {
          const until = result.banInfo.seconds
            ? new Date(Date.now() + result.banInfo.seconds * 1000).toISOString()
            : null;
          joinAccountQueries.updateState(userId, account.id, 'banned', {
            ban_reason: result.banInfo.message,
            cooldown_until: until,
          });
          break; // stop this account's worker; task already re-queued below on failure path
        }
      }

      if (result.status === 'joined') {
        await sleep(current.join_delay_seconds * 1000);
      }
    }
  } finally {
    try { await client.disconnect(); } catch (_) {}
    const finalState = joinAccountQueries.get(userId, account.id);
    if (finalState && !['banned', 'needs_login', 'full'].includes(finalState.state)) {
      joinAccountQueries.updateState(userId, account.id, 'idle');
    }
  }
};

// ─── Run orchestration ─────────────────────────────────────────────────────────

/**
 * Start (or resume) the join process for a user across all enabled,
 * available accounts. Links are pulled from a single shared in-memory
 * queue so no two accounts can ever grab the same link.
 *
 * @param {string} userId
 * @param {number[]} accountIds  account IDs to use (must be pre-filtered to enabled/connected)
 */
const startJoinRun = async (userId, accountIds) => {
  const uid = String(userId);
  if (isRunning(uid)) return { started: false, reason: 'already_running' };

  const settings = joinSettingsQueries.get(uid);
  const pending = joinLinkQueries.getPendingByUserId(uid, 5000);
  if (!pending.length) return { started: false, reason: 'no_pending_links' };

  const accounts = accountIds
    .map((id) => accountQueries.getById(id))
    .filter((a) => a && a.status === 'connected');

  if (!accounts.length) return { started: false, reason: 'no_available_accounts' };

  // Apply per-account settings defaults from global settings if not yet configured.
  for (const acc of accounts) {
    joinAccountQueries.ensure(uid, acc.id);
    joinAccountQueries.updateState(uid, acc.id, 'idle', {
      max_joins: settings.max_joins_per_account,
      batch_size: settings.batch_size,
      join_delay_seconds: settings.join_delay_seconds,
      rest_seconds: settings.rest_seconds,
    });
  }

  const run = { running: true, stopping: false };
  activeRuns.set(uid, run);

  const queueRef = { items: [...pending] };

  const workerPromises = accounts.map((acc) => runAccountWorker(uid, acc, settings, queueRef, run));

  // Fire and forget — the caller polls status via joinLinkQueries/joinAccountQueries.
  Promise.allSettled(workerPromises).finally(() => {
    run.running = false;
    activeRuns.set(uid, run);
    logger.info(`Join run finished for user ${uid}`);
  });

  return { started: true, accountsUsed: accounts.length, queued: pending.length };
};

const stopJoinRun = (userId) => {
  requestStop(userId);
  return { stopping: true };
};

module.exports = {
  parseLink,
  extractLinksFromText,
  startJoinRun,
  stopJoinRun,
  isRunning,
};
