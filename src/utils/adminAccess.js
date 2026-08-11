/**
 * Centralized administrator access checks.
 *
 * ADMIN_IDS accepts a comma-separated list. OWNER_ID and BOT_OWNER_ID are
 * supported as convenient aliases for deployments that configure one owner.
 */

const parseIds = (...values) => values
  .flatMap((value) => String(value || '').split(','))
  .map((id) => id.trim())
  .filter(Boolean);

const adminIds = new Set(parseIds(
  process.env.ADMIN_IDS,
  process.env.OWNER_ID,
  process.env.BOT_OWNER_ID,
));

const isAdmin = (userId) => adminIds.has(String(userId));

module.exports = { isAdmin, adminIds };
