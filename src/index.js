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

const {
  handleLinksMenu,
  handleLinksStartSearch,
  handleLinksAccountsAll,
  handleLinksAccountsOne,
  handleLinksAccountsTwo,
  handleLinksAccountsMultiple,
  handleLinksToggleAccount,
  handleLinksConfirmAccounts,
  handleLinksTypeBoth,
  handleLinksTypeTelegram,
  handleLinksTypeWhatsapp,
  handleLinksPeriodWeek,
  handleLinksPeriodMonth,
  handleLinksPeriod3Months,
  handleLinksPeriodYear,
  handleLinksPeriodCustom,
  handleLinksDepthFast,
  handleLinksDepthMedium,
  handleLinksDepthDeep,
  handleLinksExecuteSearch,
  handleLinksPauseSearch,
  handleLinksResumeSearch,
  handleLinksStopSearch,
  handleLinksBackToStep1,
  handleLinksBackToStep2,
  handleLinksBackToStep3,
  handleLinksBackToStep4,
  handleLinksExtractedFiles,
  handleLinksViewOperation,
  handleLinksDownloadOperation,
  handleLinksRenameOperation,
  handleLinksDeleteOperationPrompt,
  handleLinksConfirmDeleteOperation,
  handleLinksExportOperation,
  handleLinksStatistics,
  handleLinksSettings,
  handleLinksToggleSetting,
  handleLinksHistory,
  handleLinksCleanFiles,
  handleLinksConfirmClean,
} = require('./handlers/linksMenu');

const { restoreAllAccounts } = require('./services/sessionRestoreService');

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

// ─── Links Section Callbacks ──────────────────────────────────────────────────

bot.action('links_menu', handleLinksMenu);
bot.action('links_start_search', handleLinksStartSearch);

// Step 1 — account selection
bot.action('links_accounts_all', handleLinksAccountsAll);
bot.action('links_accounts_one', handleLinksAccountsOne);
bot.action('links_accounts_two', handleLinksAccountsTwo);
bot.action('links_accounts_multiple', handleLinksAccountsMultiple);
bot.action('links_confirm_accounts', handleLinksConfirmAccounts);

// Step 2 — link type
bot.action('links_type_both', handleLinksTypeBoth);
bot.action('links_type_telegram', handleLinksTypeTelegram);
bot.action('links_type_whatsapp', handleLinksTypeWhatsapp);

// Step 3 — period
bot.action('links_period_week', handleLinksPeriodWeek);
bot.action('links_period_month', handleLinksPeriodMonth);
bot.action('links_period_3months', handleLinksPeriod3Months);
bot.action('links_period_year', handleLinksPeriodYear);
bot.action('links_period_custom', handleLinksPeriodCustom);

// Step 4 — depth
bot.action('links_depth_fast', handleLinksDepthFast);
bot.action('links_depth_medium', handleLinksDepthMedium);
bot.action('links_depth_deep', handleLinksDepthDeep);

// Step 5 — execute
bot.action('links_execute_search', handleLinksExecuteSearch);

// Search controls
bot.action('links_pause_search', handleLinksPauseSearch);
bot.action('links_resume_search', handleLinksResumeSearch);
bot.action('links_stop_search', handleLinksStopSearch);

// Back navigation
bot.action('links_back_to_step1', handleLinksBackToStep1);
bot.action('links_back_to_step2', handleLinksBackToStep2);
bot.action('links_back_to_step3', handleLinksBackToStep3);
bot.action('links_back_to_step4', handleLinksBackToStep4);

// Extracted files
bot.action('links_extracted_files', handleLinksExtractedFiles);
bot.action('links_clean_files', handleLinksCleanFiles);
bot.action('links_confirm_clean', handleLinksConfirmClean);

// Statistics & settings & history
bot.action('links_statistics', handleLinksStatistics);
bot.action('links_settings', handleLinksSettings);
bot.action('links_history', handleLinksHistory);

// Dynamic links callbacks
bot.action(/^links_toggle_account_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleLinksToggleAccount(ctx, accountId);
});

bot.action(/^links_view_op_(\d+)$/, async (ctx) => {
  await handleLinksViewOperation(ctx, parseInt(ctx.match[1], 10));
});

bot.action(/^links_op_view_(\d+)$/, async (ctx) => {
  await handleLinksViewOperation(ctx, parseInt(ctx.match[1], 10));
});

bot.action(/^links_op_download_(\d+)$/, async (ctx) => {
  await handleLinksDownloadOperation(ctx, parseInt(ctx.match[1], 10));
});

bot.action(/^links_op_rename_(\d+)$/, async (ctx) => {
  await handleLinksRenameOperation(ctx, parseInt(ctx.match[1], 10));
});

bot.action(/^links_op_delete_(\d+)$/, async (ctx) => {
  await handleLinksDeleteOperationPrompt(ctx, parseInt(ctx.match[1], 10));
});

bot.action(/^links_op_confirm_delete_(\d+)$/, async (ctx) => {
  await handleLinksConfirmDeleteOperation(ctx, parseInt(ctx.match[1], 10));
});

bot.action(/^links_op_export_(\d+)$/, async (ctx) => {
  await handleLinksExportOperation(ctx, parseInt(ctx.match[1], 10));
});

bot.action(/^links_toggle_setting_(.+)$/, async (ctx) => {
  await handleLinksToggleSetting(ctx, ctx.match[1]);
});

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

bot.action(/^account_detail_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleAccountDetail(ctx, accountId);
});

bot.action(/^edit_account_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleEditAccount(ctx, accountId);
});

bot.action(/^check_status_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleCheckStatus(ctx, accountId);
});

bot.action(/^delete_confirm_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleDeleteConfirm(ctx, accountId);
});

bot.action(/^delete_yes_(\d+)$/, async (ctx) => {
  const accountId = parseInt(ctx.match[1], 10);
  await handleDeleteAccount(ctx, accountId);
});

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

    // Restore all saved accounts after the bot is fully online.
    // Running in setImmediate ensures the bot's polling loop has started
    // before we attempt to send notification messages to users.
    setImmediate(() => {
      restoreAllAccounts(bot).catch((err) => {
        logger.error('Session Restore: unexpected error during startup restoration:', err);
      });
    });
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
};

startBot();
