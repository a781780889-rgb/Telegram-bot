const states = new Map();
const TTL = 30 * 60 * 1000;
const touch = (userId, state) => { state.updatedAt = Date.now(); states.set(String(userId), state); return state; };
const get = (userId) => { const state = states.get(String(userId)); if (!state) return null; if (Date.now() - state.updatedAt > TTL) { states.delete(String(userId)); return null; } return state; };
const begin = (userId) => touch(userId, { step: 'accounts', accountIds: [], targetIds: [], adIds: [], contentText: null, contentType: 'text', mediaFile: null, name: `جدولة ${new Date().toLocaleString('ar')}`, scheduledAt: null, recurrence: 'once', recurrenceValue: null, delaySeconds: 0, updatedAt: Date.now() });
const update = (userId, patch) => touch(userId, { ...(get(userId) || {}), ...patch });
const reset = (userId) => states.delete(String(userId));
const isActive = (userId) => !!get(userId);
module.exports = { get, begin, update, reset, isActive };
