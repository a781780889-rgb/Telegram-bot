/**
 * Links Wizard State Manager
 * Manages the multi-step wizard state for each user separately from the main session state
 */

// userId -> wizard state object
const wizardStates = new Map();

const WIZARD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── Wizard States ────────────────────────────────────────────────────────────

const WIZARD_STEPS = {
  IDLE: 'IDLE',
  SELECT_ACCOUNTS: 'SELECT_ACCOUNTS',
  PICK_ACCOUNTS: 'PICK_ACCOUNTS',
  SELECT_LINK_TYPE: 'SELECT_LINK_TYPE',
  SELECT_PERIOD: 'SELECT_PERIOD',
  AWAITING_CUSTOM_START: 'AWAITING_CUSTOM_START',
  AWAITING_CUSTOM_END: 'AWAITING_CUSTOM_END',
  SELECT_DEPTH: 'SELECT_DEPTH',
  REVIEW: 'REVIEW',
  SEARCHING: 'SEARCHING',
  AWAITING_RENAME: 'AWAITING_RENAME',
};

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Get wizard state for a user; returns IDLE state if expired or not started
 * @param {string} userId
 */
const getWizardState = (userId) => {
  const state = wizardStates.get(String(userId));
  if (!state) return { step: WIZARD_STEPS.IDLE };

  if (Date.now() - state.updatedAt > WIZARD_TIMEOUT_MS) {
    wizardStates.delete(String(userId));
    return { step: WIZARD_STEPS.IDLE, timedOut: true };
  }

  return state;
};

/**
 * Set / update wizard state
 * @param {string} userId
 * @param {object} patch - fields to merge into current state
 */
const setWizardState = (userId, patch) => {
  const current = wizardStates.get(String(userId)) || { step: WIZARD_STEPS.IDLE };
  wizardStates.set(String(userId), { ...current, ...patch, updatedAt: Date.now() });
};

/**
 * Start a fresh wizard
 * @param {string} userId
 */
const startWizard = (userId) => {
  wizardStates.set(String(userId), {
    step: WIZARD_STEPS.SELECT_ACCOUNTS,
    accountMode: null,
    selectedAccountIds: [],
    linkType: null,
    period: null,
    customStart: null,
    customEnd: null,
    searchDepth: null,
    renameTargetId: null,
    updatedAt: Date.now(),
  });
};

/**
 * Reset wizard to IDLE
 * @param {string} userId
 */
const resetWizard = (userId) => {
  wizardStates.delete(String(userId));
};

/**
 * Check if user is in a links wizard step that requires text input
 * @param {string} userId
 * @returns {boolean}
 */
const isAwaitingTextInput = (userId) => {
  const { step } = getWizardState(userId);
  return [
    WIZARD_STEPS.AWAITING_CUSTOM_START,
    WIZARD_STEPS.AWAITING_CUSTOM_END,
    WIZARD_STEPS.AWAITING_RENAME,
  ].includes(step);
};

module.exports = {
  WIZARD_STEPS,
  getWizardState,
  setWizardState,
  startWizard,
  resetWizard,
  isAwaitingTextInput,
};
