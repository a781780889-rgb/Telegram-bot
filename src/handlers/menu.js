const { botUserQueries } = require('../database/db');
const sessionState = require('../services/sessionState');
const { mainMenuKeyboard, backToMenuKeyboard } = require('../utils/keyboards');
const { welcomeMessage, helpMessage } = require('../utils/messages');
const logger = require('../utils/logger');

/**
 * /start command handler
 */
const handleStart = async (ctx) => {
  try {
    const { id, username, first_name } = ctx.from;

    // Register/update user in DB
    botUserQueries.upsert(id, username, first_name);

    // Reset any pending state
    sessionState.resetState(String(id));

    await ctx.reply(welcomeMessage(first_name), {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  } catch (error) {
    logger.error('handleStart error:', error);
    await ctx.reply('مرحبًا! اضغط /start لبدء البوت.', mainMenuKeyboard());
  }
};

/**
 * Main menu callback handler
 */
const handleMainMenu = async (ctx) => {
  try {
    const { first_name } = ctx.from;
    await ctx.editMessageText(welcomeMessage(first_name), {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    });
  } catch (error) {
    logger.error('handleMainMenu error:', error);
    await ctx.reply('القائمة الرئيسية:', mainMenuKeyboard());
  }
};

/**
 * Help callback handler
 */
const handleHelp = async (ctx) => {
  try {
    const { Markup } = require('telegraf');
    await ctx.editMessageText(helpMessage, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 القائمة الرئيسية', 'main_menu')],
      ]),
    });
  } catch (error) {
    logger.error('handleHelp error:', error);
    await ctx.reply(helpMessage, { parse_mode: 'Markdown', ...backToMenuKeyboard() });
  }
};

module.exports = { handleStart, handleMainMenu, handleHelp };
