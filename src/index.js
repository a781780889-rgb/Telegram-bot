require('dotenv').config();

const { Telegraf } = require('telegraf');
const logger = require('./utils/logger');
const errorHandler = require('./middlewares/errorHandler');
const textRouter = require('./middlewares/textRouter');

const { handleStart, handleMainMenu, handleHelp } = require('./handlers/menu');
const { handleAccountsMenu } = require('./handlers/accountsMenu');
const {
  handleAddAccountStart,
  handleCancelFlow,
} = require('./handlers/addAccount');
const {
  handleListAccounts,
  handleAccountDetail,
  handleEditAccountList,
  handleEditAccount,
  handleCheckStatus,
  handleRefreshAllStatus,
  handleDeleteAccountList,
  handleDeleteConfirm,
  handleDeleteAccount,
  handleRelogin,
  handleAccountsStats,
} = require('./handlers/manageAccounts');

// ─── Validate required environment variables ──────────────────────────────────

const requiredEnvVars = ['BOT_TOKEN', 'API_ID', 'API_HASH', 'ENCRYPTION_KEY'];
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

if (missingVars.length > 0) {
  logger.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  logger.error('Please copy .env.example to .env and fill in all required values.');
  process.exit(1);
}

if (process.env.ENCRYPTION_KEY.length < 32) {
  logger.error('ENCRYPTION_KEY must be at least 32 characters long');
  process.exit(1);
}

// ─── Initialize Bot ───────────────────────────────────────────────────────────

const bot = new Telegraf(process.env.BOT_TOKEN);

// ─── Global Error Handler ─────────────────────────────────────────────────────

bot.catch(errorHandler);

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command('start', handleStart);
bot.command('menu', async (ctx) => {
  await ctx.reply('القائمة الرئيسية:', require('./utils/keyboards').mainMenuKeyboard());
});

// ─── Navigation Callbacks ─────────────────────────────────────────────────────

bot.action('main_menu', handleMainMenu);
bot.action('help', handleHelp);
bot.action('accounts_menu', handleAccountsMenu);

// ─── Add Account Callbacks ────────────────────────────────────────────────────

bot.action('add_account', handleAddAccountStart);
bot.action('cancel_flow', handleCancelFlow);

// ─── Account Management Callbacks ────────────────────────────────────────────

bot.action('list_accounts', handleListAccounts);
bot.action('edit_account_list', handleEditAccountList);
bot.action('delete_account_list', handleDeleteAccountList);
bot.action('refresh_all_status', handleRefreshAllStatus);
bot.action('accounts_stats', handleAccountsStats);

// ─── Dynamic Account Callbacks ────────────────────────────────────────────────

// Account detail
bot.action(/^account_detail_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleAccountDetail(ctx, accountId);
});

// Edit account
bot.action(/^edit_account_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleEditAccount(ctx, accountId);
});

// Check single account status
bot.action(/^check_status_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleCheckStatus(ctx, accountId);
});

// Delete confirmation
bot.action(/^delete_confirm_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleDeleteConfirm(ctx, accountId);
});

// Delete confirmed
bot.action(/^delete_yes_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleDeleteAccount(ctx, accountId);
});

// Re-login
bot.action(/^relogin_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleRelogin(ctx, accountId);
});

// ─── Text Message Router ──────────────────────────────────────────────────────

bot.on('text', textRouter);

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

const shutdown = async (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);

  try {
    const { activeClients, disconnectClient } = require('./services/telegramClient');
    const clientIds = [...activeClients.keys()];
    await Promise.allSettled(clientIds.map((id) => disconnectClient(id)));
    logger.info(`Disconnected ${clientIds.length} active client(s)`);
  } catch (error) {
    logger.error('Error during shutdown:', error);
  }

  bot.stop(signal);
  logger.info('Bot stopped');
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// ─── Start Bot ────────────────────────────────────────────────────────────────

const startBot = async () => {
  try {
    logger.info('Starting Telegram Account Manager Bot...');

    await bot.launch();

    const botInfo = await bot.telegram.getMe();
    logger.info(`Bot started successfully: @${botInfo.username} (ID: ${botInfo.id})`);
    logger.info('Bot is ready to receive messages.');
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
};

startBot();
