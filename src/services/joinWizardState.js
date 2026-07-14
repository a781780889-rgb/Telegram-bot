/**
 * Join-to-Links Wizard State Manager
 * Manages the multi-step "إضافة روابط" wizard state per user, separate
 * from other wizard state maps (same pattern as linksWizardState.js).
 */

const wizardStates = new Map();

const WIZARD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const WIZARD_STEPS = {
  IDLE: 'IDLE',
  AWAITING_LINKS: 'AWAITING_LINKS',
  AWAITING_BATCH_SIZE: 'AWAITING_BATCH_SIZE',
  AWAITING_JOIN_DELAY: 'AWAITING_JOIN_DELAY',
  AWAITING_REST_SECONDS: 'AWAITING_REST_SECONDS',
  AWAITING_MAX_JOINS: 'AWAITING_MAX_JOINS',
};

const getWizardState = (userId) => {
  const state = wizardStates.get(String(userId));
  if (!state) return { step: WIZARD_STEPS.IDLE };

  if (Date.now() - state.updatedAt > WIZARD_TIMEOUT_MS) {
    wizardStates.delete(String(userId));
    return { step: WIZARD_STEPS.IDLE, timedOut: true };
  }
  return state;
};

const setWizardState = (userId, patch) => {
  const current = wizardStates.get(String(userId)) || { step: WIZARD_STEPS.IDLE };
  wizardStates.set(String(userId), { ...current, ...patch, updatedAt: Date.now() });
};

const resetWizard = (userId) => {
  wizardStates.delete(String(userId));
};

/**
 * Check if user is in a join wizard step that requires text input
 * (same pattern as linksWizardState.isAwaitingTextInput)
 * @param {string} userId
 * @returns {boolean}
 */
const isAwaitingTextInput = (userId) => {
  const { step } = getWizardState(userId);
  return [
    WIZARD_STEPS.AWAITING_LINKS,
    WIZARD_STEPS.AWAITING_BATCH_SIZE,
    WIZARD_STEPS.AWAITING_JOIN_DELAY,
    WIZARD_STEPS.AWAITING_REST_SECONDS,
    WIZARD_STEPS.AWAITING_MAX_JOINS,
  ].includes(step);
};

module.exports = {
  WIZARD_STEPS,
  getWizardState,
  setWizardState,
  resetWizard,
  isAwaitingTextInput,
};
