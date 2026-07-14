const sessionState = require('../services/sessionState');
const { STATES } = require('../services/sessionState');
const linksWizardState = require('../services/linksWizardState');
const subscriptionsWizardState = require('../services/subscriptionsWizardState');
const joinWizardState = require('../services/joinWizardState');
const foldersWizardState = require('../services/foldersWizardState');
const {
  handlePhoneInput,
  handleOtpInput,
  handlePasswordInput,
} = require('../handlers/addAccount');
const { handleLinksTextInput } = require('../handlers/linksMenu');
const { handleSubscriptionsTextInput } = require('../handlers/subscriptionsMenu');
const { handleJoinTextInput } = require('../handlers/joinMenu');
const { handleFoldersTextInput } = require('../handlers/foldersMenu');
const { mainMenuKeyboard } = require('../utils/keyboards');
const logger = require('../utils/logger');

/**
 * Route incoming text messages to the appropriate handler
 * based on the user's current conversation state.
 */
const textRouter = async (ctx, next) => {
  // Only handle private text messages
  if (!ctx.message?.text || ctx.chat?.type !== 'private') {
    return next();
  }

  // Ignore commands
  if (ctx.message.text.startsWith('/')) {
    return next();
  }

  const userId = String(ctx.from.id);
  const { state, timedOut } = sessionState.getState(userId);

  if (timedOut) {
    await ctx.reply(
      '⏱ انتهت مهلة الجلسة. ابدأ من جديد.',
      mainMenuKeyboard()
    );
    return;
  }

  // ─── Links wizard takes priority when user is in a text-input step ──────────
  if (linksWizardState.isAwaitingTextInput(userId)) {
    await handleLinksTextInput(ctx);
    return;
  }

  // ─── Subscriptions wizard takes priority when user is in a text-input step ──
  if (subscriptionsWizardState.isAwaitingTextInput(userId)) {
    const handled = await handleSubscriptionsTextInput(ctx);
    if (handled) return;
  }

  // ─── Join-to-links wizard takes priority when user is in a text-input step ──
  if (joinWizardState.isAwaitingTextInput(userId)) {
    await handleJoinTextInput(ctx);
    return;
  }

  // ─── Folders wizard takes priority when user is in a text-input step ───────
  if (foldersWizardState.isAwaitingTextInput(userId)) {
    await handleFoldersTextInput(ctx);
    return;
  }

  switch (state) {
    case STATES.AWAITING_PHONE:
      await handlePhoneInput(ctx);
      break;

    case STATES.AWAITING_OTP:
      await handleOtpInput(ctx);
      break;

    case STATES.AWAITING_PASSWORD:
      await handlePasswordInput(ctx);
      break;

    case STATES.IDLE:
    default:
      // Unexpected text while idle
      await ctx.reply(
        'استخدم القائمة للتنقل بين الخيارات.',
        mainMenuKeyboard()
      );
      break;
  }
};

module.exports = textRouter;
