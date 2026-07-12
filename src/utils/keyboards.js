const { Markup } = require('telegraf');

/**
 * Main menu keyboard
 */
const mainMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('➕ إضافة حساب تيليجرام', 'add_account')],
    [Markup.button.callback('📋 قائمة الحسابات', 'list_accounts')],
    [Markup.button.callback('ℹ️ المساعدة', 'help')],
  ]);

/**
 * Cancel keyboard shown during multi-step flows
 */
const cancelKeyboard = () =>
  Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'cancel_flow')]]);

/**
 * Account actions keyboard
 * @param {number} accountId
 * @param {string} status
 */
const accountActionsKeyboard = (accountId, status) => {
  const buttons = [];

  if (status !== 'connected') {
    buttons.push(
      Markup.button.callback('🔄 إعادة تسجيل الدخول', `relogin_${accountId}`)
    );
  }

  buttons.push(
    Markup.button.callback('📊 فحص الحالة', `check_status_${accountId}`)
  );
  buttons.push(
    Markup.button.callback('🗑️ حذف الحساب', `delete_confirm_${accountId}`)
  );

  const rows = [];
  if (buttons.length === 3) {
    rows.push([buttons[0], buttons[1]]);
    rows.push([buttons[2]]);
  } else {
    rows.push([buttons[0], buttons[1]]);
  }

  rows.push([Markup.button.callback('🔙 القائمة الرئيسية', 'main_menu')]);

  return Markup.inlineKeyboard(rows);
};

/**
 * Delete confirmation keyboard
 * @param {number} accountId
 */
const confirmDeleteKeyboard = (accountId) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ نعم، احذف', `delete_yes_${accountId}`),
      Markup.button.callback('❌ لا، إلغاء', 'list_accounts'),
    ],
  ]);

/**
 * Back to menu keyboard
 */
const backToMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🔙 القائمة الرئيسية', 'main_menu')],
  ]);

/**
 * Retry keyboard (for errors)
 */
const retryKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🔁 إعادة المحاولة', 'add_account')],
    [Markup.button.callback('🔙 القائمة الرئيسية', 'main_menu')],
  ]);

module.exports = {
  mainMenuKeyboard,
  cancelKeyboard,
  accountActionsKeyboard,
  confirmDeleteKeyboard,
  backToMenuKeyboard,
  retryKeyboard,
};
