/**
 * State manager for the publish engine wizards.
 */
const WIZARD_STEPS = {
  IDLE: 'IDLE',
  AWAITING_AD_CONTENT: 'AWAITING_AD_CONTENT',
  AWAITING_TASK_NAME: 'AWAITING_TASK_NAME',
  AWAITING_INTERVAL: 'AWAITING_INTERVAL',
  DIRECT_ACCOUNTS: 'DIRECT_ACCOUNTS',
  DIRECT_TARGETS: 'DIRECT_TARGETS',
  DIRECT_AD: 'DIRECT_AD',
  FOLDER_ACCOUNTS: 'FOLDER_ACCOUNTS',
  FOLDER_AD: 'FOLDER_AD',
  FOLDER_TARGETS: 'FOLDER_TARGETS',
  AWAITING_MANUAL_TARGET: 'AWAITING_MANUAL_TARGET',
};
const TEXT_INPUT_STEPS = new Set([
  WIZARD_STEPS.AWAITING_AD_CONTENT,
  WIZARD_STEPS.AWAITING_TASK_NAME,
  WIZARD_STEPS.AWAITING_INTERVAL,
  WIZARD_STEPS.AWAITING_MANUAL_TARGET,
]);
const states = new Map();
const TIMEOUT_MS = 30 * 60 * 1000;
const getWizardState = (userId) => {
  const state = states.get(String(userId));
  if (state && Date.now() - state.lastUpdate > TIMEOUT_MS) { states.delete(String(userId)); return null; }
  return state || null;
};
const setWizardState = (userId, step, data = {}) => {
  const current = getWizardState(userId) || { data: {} };
  states.set(String(userId), { step, data: { ...current.data, ...data }, lastUpdate: Date.now() });
  return states.get(String(userId));
};
const updateWizardState = (userId, data = {}) => {
  const current = getWizardState(userId) || { step: WIZARD_STEPS.IDLE, data: {} };
  return setWizardState(userId, current.step, data);
};
const resetWizard = (userId) => states.delete(String(userId));
const isAwaitingTextInput = (userId) => { const state = getWizardState(userId); return !!state && TEXT_INPUT_STEPS.has(state.step); };
module.exports = { WIZARD_STEPS, getWizardState, setWizardState, updateWizardState, resetWizard, isAwaitingTextInput };
