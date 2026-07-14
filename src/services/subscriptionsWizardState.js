/**
 * Subscriptions Wizard State Manager
 *
 * A single in-memory state machine (mirrors services/linksWizardState.js) that
 * covers every multi-step flow inside the 💎 الاشتراكات module: add/edit
 * package, create coupon, create offer, settings text edits, admin messages
 * to a subscriber, and the subscriber-facing "subscribe" flow.
 *
 * Kept completely separate from sessionState.js / linksWizardState.js so the
 * existing add-account and links flows are never touched or affected.
 */

// userId -> wizard state object
const wizardStates = new Map();

const WIZARD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const STEPS = {
  IDLE: 'IDLE',

  // ── Package add wizard ──
  PKG_NAME: 'PKG_NAME',
  PKG_DESCRIPTION: 'PKG_DESCRIPTION',
  PKG_PRICE: 'PKG_PRICE',
  PKG_CURRENCY: 'PKG_CURRENCY',
  PKG_CUSTOM_CURRENCY: 'PKG_CUSTOM_CURRENCY',
  PKG_DURATION: 'PKG_DURATION',
  PKG_CUSTOM_DURATION: 'PKG_CUSTOM_DURATION',
  PKG_MAX_ACCOUNTS: 'PKG_MAX_ACCOUNTS',
  PKG_MAX_OPERATIONS: 'PKG_MAX_OPERATIONS',
  PKG_MAX_USERS: 'PKG_MAX_USERS',
  PKG_FEATURES: 'PKG_FEATURES',
  PKG_SPECIAL_BADGE: 'PKG_SPECIAL_BADGE',
  PKG_BADGE_LABEL: 'PKG_BADGE_LABEL',
  PKG_REVIEW: 'PKG_REVIEW',

  // ── Package single-field edit ──
  PKG_EDIT_FIELD: 'PKG_EDIT_FIELD',

  // ── Subscriber management ──
  SUBR_EXTEND_DAYS: 'SUBR_EXTEND_DAYS',
  SUBR_MESSAGE: 'SUBR_MESSAGE',
  SUBR_NOTES: 'SUBR_NOTES',
  SUBR_SEARCH: 'SUBR_SEARCH',

  // ── Payments ──
  PAY_REJECT_REASON: 'PAY_REJECT_REASON',
  PAY_SEARCH: 'PAY_SEARCH',

  // ── Coupon add wizard ──
  CPN_CODE: 'CPN_CODE',
  CPN_NAME: 'CPN_NAME',
  CPN_TYPE: 'CPN_TYPE',                         // button step: percent vs fixed
  CPN_VALUE: 'CPN_VALUE',
  CPN_MAX_USES: 'CPN_MAX_USES',
  CPN_VALID_UNTIL: 'CPN_VALID_UNTIL',           // button step: unlimited vs pick a date
  CPN_VALID_UNTIL_DATE: 'CPN_VALID_UNTIL_DATE', // text step: the actual date, after "pick a date"
  CPN_PACKAGES: 'CPN_PACKAGES',                 // button step: multi-select applicable packages
  CPN_REVIEW: 'CPN_REVIEW',                     // button step: final confirm

  // ── Offer add wizard ──
  OFR_TITLE: 'OFR_TITLE',
  OFR_DESCRIPTION: 'OFR_DESCRIPTION',
  OFR_TYPE: 'OFR_TYPE',                   // button step: discount / bogo / free_extension / free_upgrade / limited_time
  OFR_VALUE: 'OFR_VALUE',
  OFR_PACKAGE: 'OFR_PACKAGE',             // button step: which package(s) it applies to
  OFR_END_DATE: 'OFR_END_DATE',           // button step: no end date vs pick a date
  OFR_END_DATE_DATE: 'OFR_END_DATE_DATE', // text step: the actual date, after "pick a date"

  // ── Settings text edits ──
  SET_TAX: 'SET_TAX',
  SET_MESSAGE_EDIT: 'SET_MESSAGE_EDIT',

  // ── Subscriber-facing storefront / subscribe flow ──
  STORE_COUPON_CODE: 'STORE_COUPON_CODE',
  STORE_REVIEW: 'STORE_REVIEW', // button step: final "confirm order" tap
};

// Steps that expect the next text message from the user.
const TEXT_INPUT_STEPS = new Set([
  STEPS.PKG_NAME, STEPS.PKG_DESCRIPTION, STEPS.PKG_PRICE, STEPS.PKG_CUSTOM_CURRENCY,
  STEPS.PKG_CUSTOM_DURATION, STEPS.PKG_MAX_ACCOUNTS, STEPS.PKG_MAX_OPERATIONS,
  STEPS.PKG_MAX_USERS, STEPS.PKG_FEATURES, STEPS.PKG_BADGE_LABEL, STEPS.PKG_EDIT_FIELD,
  STEPS.SUBR_EXTEND_DAYS, STEPS.SUBR_MESSAGE, STEPS.SUBR_NOTES, STEPS.SUBR_SEARCH,
  STEPS.PAY_REJECT_REASON, STEPS.PAY_SEARCH,
  STEPS.CPN_CODE, STEPS.CPN_NAME, STEPS.CPN_VALUE, STEPS.CPN_MAX_USES, STEPS.CPN_VALID_UNTIL_DATE,
  STEPS.OFR_TITLE, STEPS.OFR_DESCRIPTION, STEPS.OFR_VALUE, STEPS.OFR_END_DATE_DATE,
  STEPS.SET_TAX, STEPS.SET_MESSAGE_EDIT,
  STEPS.STORE_COUPON_CODE,
]);

/**
 * Get wizard state for a user; returns IDLE state if expired or not started.
 * @param {string} userId
 */
const getWizardState = (userId) => {
  const state = wizardStates.get(String(userId));
  if (!state) return { step: STEPS.IDLE, data: {} };

  if (Date.now() - state.updatedAt > WIZARD_TIMEOUT_MS) {
    wizardStates.delete(String(userId));
    return { step: STEPS.IDLE, data: {}, timedOut: true };
  }

  return state;
};

/**
 * Merge a patch into the current wizard state (creating it if needed).
 * @param {string} userId
 * @param {object} patch
 */
const setWizardState = (userId, patch) => {
  const current = wizardStates.get(String(userId)) || { step: STEPS.IDLE, data: {} };
  const merged = {
    ...current,
    ...patch,
    data: { ...current.data, ...(patch.data || {}) },
    updatedAt: Date.now(),
  };
  wizardStates.set(String(userId), merged);
  return merged;
};

/**
 * Start a brand-new wizard with a given first step and optional seed data.
 * @param {string} userId
 * @param {string} step
 * @param {object} seedData
 */
const startWizard = (userId, step, seedData = {}) => {
  const state = { step, data: seedData, updatedAt: Date.now() };
  wizardStates.set(String(userId), state);
  return state;
};

const resetWizard = (userId) => {
  wizardStates.delete(String(userId));
};

const isAwaitingTextInput = (userId) => {
  const { step } = getWizardState(userId);
  return TEXT_INPUT_STEPS.has(step);
};

module.exports = {
  STEPS,
  getWizardState,
  setWizardState,
  startWizard,
  resetWizard,
  isAwaitingTextInput,
};
