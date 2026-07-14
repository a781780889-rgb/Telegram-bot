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

const {
  handleJoinMenu,
  handleJoinAccountsMenu,
  handleJoinAccountDetail,
  handleJoinAccountEnable,
  handleJoinAccountDisable,
  handleJoinAddLinks,
  handleJoinStart,
  handleJoinStartConfirm,
  handleJoinStop,
  handleJoinStatistics,
  handleJoinBannedAccounts,
  handleJoinLogs,
  handleJoinSettings,
  handleJoinEditSetting,
  handleJoinLinksFileInput,
  isAwaitingLinksFile,
} = require('./handlers/joinMenu');

const {
  handleFoldersMenu,
  handleFoldersStats,
  handleFoldersOrganize,
  handleFoldersList,
  handleFolderDetail,
  handleFolderPush,
  handleFolderDeleteConfirm,
  handleFolderDeleteYes,
  handleFoldersSettings,
  handleFoldersEditGroupsPerFolder,
} = require('./handlers/foldersMenu');

const {
  handlePublishMenu,
  handleAdsLibrary,
  handleAdAddStart,
  handleAdView,
  handleDashboard,
  handlePublishLogs,
} = require('./handlers/publishMenu');
const { startPublishScheduler } = require('./services/publishService');

const { restoreAllAccounts } = require('./services/sessionRestoreService');

const subscriptionsMenu = require('./handlers/subscriptionsMenu');
const { startSubscriptionScheduler } = require('./services/subscriptionsService');
const {
  requireAdmin,
  handleSubscriptionsMenu,
  handleSubCancel,
  handleSubNoop,
  handleSubscriptionsStats,
  handleSubscriptionsLog,
  handleSubscriptionsLogPage,
  handleSubscriptionsAlerts,
  handleAlertsToggle,
  handleSubscriptionsSettings,
  handleSettingsCurrencyMenu,
  handleSettingsSetCurrency,
  handleSettingsTaxStart,
  handleSettingsMessageEditStart,
  handleSettingsToggle,
  packagesHandler,
  subscribersHandler,
  paymentsHandler,
  couponsHandler,
  offersHandler,
  activationCodesHandler,
  storefrontHandler,
} = subscriptionsMenu;

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

// ─── Join-to-Links Callbacks ───────────────────────────────────────────────────

bot.action('join_menu', handleJoinMenu);
bot.action('join_accounts_menu', handleJoinAccountsMenu);
bot.action('join_add_links', handleJoinAddLinks);
bot.action('join_start', handleJoinStart);
bot.action('join_start_confirm', handleJoinStartConfirm);
bot.action('join_stop', handleJoinStop);
bot.action('join_statistics', handleJoinStatistics);
bot.action('join_banned_accounts', handleJoinBannedAccounts);
bot.action('join_logs', handleJoinLogs);
bot.action('join_settings', handleJoinSettings);

bot.action(/^join_account_detail_(\d+)$/, async (ctx) => {
  await handleJoinAccountDetail(ctx, parseInt(ctx.match[1], 10));
});
bot.action(/^join_account_enable_(\d+)$/, async (ctx) => {
  await handleJoinAccountEnable(ctx, parseInt(ctx.match[1], 10));
});
bot.action(/^join_account_disable_(\d+)$/, async (ctx) => {
  await handleJoinAccountDisable(ctx, parseInt(ctx.match[1], 10));
});

bot.action('join_edit_batch_size', async (ctx) => {
  await handleJoinEditSetting(ctx, 'batch_size');
});
bot.action('join_edit_join_delay', async (ctx) => {
  await handleJoinEditSetting(ctx, 'join_delay_seconds');
});
bot.action('join_edit_rest_seconds', async (ctx) => {
  await handleJoinEditSetting(ctx, 'rest_seconds');
});
bot.action('join_edit_max_joins', async (ctx) => {
  await handleJoinEditSetting(ctx, 'max_joins_per_account');
});

// ─── Central Groups DB + Telegram Folders Callbacks ───────────────────────────

bot.action('folders_menu', handleFoldersMenu);
bot.action('folders_stats', handleFoldersStats);
bot.action('folders_organize', handleFoldersOrganize);
bot.action('folders_list', handleFoldersList);
bot.action('folders_settings', handleFoldersSettings);
bot.action('folders_edit_groups_per_folder', handleFoldersEditGroupsPerFolder);

// ─── Publish Engine Callbacks ────────────────────────────────────────────────
bot.action('publish_menu', handlePublishMenu);
bot.action('publish_ads_library', handleAdsLibrary);
bot.action('publish_ad_add', handleAdAddStart);
bot.action('publish_dashboard', handleDashboard);
bot.action('publish_dashboard_refresh', handleDashboard);
bot.action('publish_logs', handlePublishLogs);

bot.action(/^publish_ad_view_(\d+)$/, async (ctx) => {
  await handleAdView(ctx, parseInt(ctx.match[1], 10));
});

bot.action(/^folder_detail_(\d+)$/, async (ctx) => {
  await handleFolderDetail(ctx, parseInt(ctx.match[1], 10));
});
bot.action(/^folder_push_(\d+)$/, async (ctx) => {
  await handleFolderPush(ctx, parseInt(ctx.match[1], 10));
});
bot.action(/^folder_delete_confirm_(\d+)$/, async (ctx) => {
  await handleFolderDeleteConfirm(ctx, parseInt(ctx.match[1], 10));
});
bot.action(/^folder_delete_yes_(\d+)$/, async (ctx) => {
  await handleFolderDeleteYes(ctx, parseInt(ctx.match[1], 10));
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

// ═══════════════════════════════════════════════════════════════════════════
// 💎 Subscriptions Module — all routes prefixed "sub_" to avoid any collision
// with the callbacks above. Admin-only routes are wrapped in requireAdmin();
// storefront routes (sub_store_*) are open to every bot user.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Root / shared ────────────────────────────────────────────────────────────

bot.action('sub_menu', handleSubscriptionsMenu);
bot.action('sub_cancel', handleSubCancel);
bot.action('sub_noop', handleSubNoop);

// ─── Admin menu entries ───────────────────────────────────────────────────────

bot.action('sub_pkg_add', requireAdmin(packagesHandler.handlePackageAddStart));
bot.action('sub_pkg_list', requireAdmin(packagesHandler.handlePackagesList));
bot.action('sub_subr_list', requireAdmin(subscribersHandler.handleSubscribersList));
bot.action('sub_pay_list', requireAdmin(paymentsHandler.handlePaymentsList));
bot.action('sub_cpn_add', requireAdmin(couponsHandler.handleCouponAddStart));
bot.action('sub_cpn_list', requireAdmin(couponsHandler.handleCouponsList));
bot.action('sub_ofr_list', requireAdmin(offersHandler.handleOffersList));
bot.action('sub_ofr_add', requireAdmin(offersHandler.handleOfferAddStart));
bot.action('sub_code_list', requireAdmin(activationCodesHandler.handleCodesList));
bot.action('sub_code_add', requireAdmin(activationCodesHandler.handleCodeAddStart));
bot.action('sub_alerts', requireAdmin(handleSubscriptionsAlerts));
bot.action('sub_stats', requireAdmin(handleSubscriptionsStats));
bot.action('sub_log', requireAdmin(handleSubscriptionsLog));
bot.action('sub_settings', requireAdmin(handleSubscriptionsSettings));

// ─── Packages ─────────────────────────────────────────────────────────────────

bot.action(/^sub_pkg_page_(\d+)$/, requireAdmin(async (ctx) => {
  await packagesHandler.handlePackagesList(ctx, parseInt(ctx.match[1], 10));
}));
bot.action(/^sub_pkg_view_(\d+)$/, requireAdmin(async (ctx) => {
  await packagesHandler.handlePackageView(ctx, parseInt(ctx.match[1], 10));
}));
bot.action(/^sub_pkg_(toggle|special|dup|del|delyes|up|down|edit)_(\d+)$/, requireAdmin(packagesHandler.handlePackageAction));
bot.action(/^sub_pkg_field_([a-z_]+)_(\d+)$/, requireAdmin(packagesHandler.handlePackageFieldEditStart));

// Add-package wizard
bot.action(/^sub_pkgw_cur_(.+)$/, requireAdmin(packagesHandler.handlePkgCurrencyPick));
bot.action(/^sub_pkgw_dur_(\d+|custom)$/, requireAdmin(packagesHandler.handlePkgDurationPick));
bot.action(/^sub_pkgw_unlim_(accounts|operations|users)$/, requireAdmin(packagesHandler.handlePkgUnlimited));
bot.action('sub_pkgw_skip_desc', requireAdmin(packagesHandler.handlePkgSkipDescription));
bot.action('sub_pkgw_skip_features', requireAdmin(packagesHandler.handlePkgSkipFeatures));
bot.action(/^sub_pkgw_special_(yes|no)$/, requireAdmin(packagesHandler.handlePkgSpecial));
bot.action('sub_pkgw_skip_badge', requireAdmin(packagesHandler.handlePkgSkipBadge));
bot.action('sub_pkgw_confirm', requireAdmin(packagesHandler.handlePkgConfirm));

// ─── Subscribers ──────────────────────────────────────────────────────────────

bot.action(/^sub_subr_page_(\d+)$/, requireAdmin(subscribersHandler.handleSubscribersPage));
bot.action(/^sub_subr_filter_(\w+)$/, requireAdmin(subscribersHandler.handleSubscribersFilter));
bot.action(/^sub_subr_view_(\d+)$/, requireAdmin(async (ctx) => {
  await subscribersHandler.handleSubscriberView(ctx, parseInt(ctx.match[1], 10));
}));
bot.action(
  /^sub_subr_(changepkg|extend|renew|suspend|reactivate|cancel|cancelyes|autorenew|msg|notes|history)_(\d+)$/,
  requireAdmin(subscribersHandler.handleSubscriberAction)
);
bot.action(/^sub_subr_setpkg_(\d+)_(\d+)$/, requireAdmin(subscribersHandler.handleSubscriberSetPackage));
bot.action(/^sub_subr_extenddays_(\d+)_(\d+)$/, requireAdmin(subscribersHandler.handleSubscriberExtendDays));
bot.action(/^sub_subr_extendcustom_(\d+)$/, requireAdmin(subscribersHandler.handleSubscriberExtendCustomStart));
bot.action('sub_subr_search', requireAdmin(subscribersHandler.handleSubscribersSearchStart));

// ─── Payments ─────────────────────────────────────────────────────────────────

bot.action(/^sub_pay_page_(\d+)$/, requireAdmin(paymentsHandler.handlePaymentsPage));
bot.action(/^sub_pay_filter_(\w+)$/, requireAdmin(paymentsHandler.handlePaymentsFilter));
bot.action(/^sub_pay_view_(\d+)$/, requireAdmin(async (ctx) => {
  await paymentsHandler.handlePaymentView(ctx, parseInt(ctx.match[1], 10));
}));
bot.action(/^sub_pay_(accept|reject|rejectnow|refund|refundyes)_(\d+)$/, requireAdmin(paymentsHandler.handlePaymentAction));
bot.action('sub_pay_search', requireAdmin(paymentsHandler.handlePaymentsSearchStart));

// ─── Coupons ──────────────────────────────────────────────────────────────────

bot.action(/^sub_cpn_page_(\d+)$/, requireAdmin(async (ctx) => {
  await couponsHandler.handleCouponsList(ctx, parseInt(ctx.match[1], 10));
}));
bot.action(/^sub_cpn_view_(\d+)$/, requireAdmin(async (ctx) => {
  await couponsHandler.handleCouponView(ctx, parseInt(ctx.match[1], 10));
}));
bot.action(/^sub_cpn_(toggle|del|delyes)_(\d+)$/, requireAdmin(couponsHandler.handleCouponAction));

// Add-coupon wizard
bot.action('sub_cpnw_autocode', requireAdmin(couponsHandler.handleCpnAutoCode));
bot.action('sub_cpnw_skip_name', requireAdmin(couponsHandler.handleCpnSkipName));
bot.action(/^sub_cpnw_type_(percent|fixed)$/, requireAdmin(couponsHandler.handleCpnTypePick));
bot.action('sub_cpnw_unlim_uses', requireAdmin(couponsHandler.handleCpnUnlimitedUses));
bot.action('sub_cpnw_nolimit_date', requireAdmin(couponsHandler.handleCpnNoLimitDate));
bot.action('sub_cpnw_setdate', requireAdmin(couponsHandler.handleCpnSetDateStart));
bot.action(/^sub_cpnw_pkg_(\d+)$/, requireAdmin(couponsHandler.handleCpnTogglePackage));
bot.action('sub_cpnw_pkg_confirm', requireAdmin(couponsHandler.handleCpnPackagesConfirm));
bot.action('sub_cpnw_confirm', requireAdmin(couponsHandler.handleCpnConfirm));

// ─── Offers ───────────────────────────────────────────────────────────────────

bot.action(/^sub_ofr_view_(\d+)$/, requireAdmin(async (ctx) => {
  await offersHandler.handleOfferView(ctx, parseInt(ctx.match[1], 10));
}));
bot.action(/^sub_ofr_(toggle|del|delyes)_(\d+)$/, requireAdmin(offersHandler.handleOfferAction));

// Add-offer wizard
bot.action('sub_ofrw_skip_desc', requireAdmin(offersHandler.handleOfrSkipDescription));
bot.action(/^sub_ofrw_type_(discount|bogo|free_extension|free_upgrade|limited_time)$/, requireAdmin(offersHandler.handleOfrTypePick));
bot.action(/^sub_ofrw_pkg_(\d+|all)$/, requireAdmin(offersHandler.handleOfrPackagePick));
bot.action('sub_ofrw_nodate', requireAdmin(offersHandler.handleOfrNoDate));
bot.action('sub_ofrw_setdate', requireAdmin(offersHandler.handleOfrSetDateStart));

// ─── Activation Codes (🔑 أكواد التفعيل) ──────────────────────────────────────

bot.action(/^sub_code_page_(\d+)$/, requireAdmin(activationCodesHandler.handleCodesPage));
bot.action(/^sub_code_filter_(\w+)$/, requireAdmin(activationCodesHandler.handleCodesFilter));
bot.action(/^sub_code_view_(\d+)$/, requireAdmin(async (ctx) => {
  await activationCodesHandler.handleCodeView(ctx, parseInt(ctx.match[1], 10));
}));
bot.action(/^sub_code_(toggle|del|delyes)_(\d+)$/, requireAdmin(activationCodesHandler.handleCodeAction));

// Generate-codes wizard
bot.action(/^sub_codew_pkg_(\d+)$/, requireAdmin(activationCodesHandler.handleCodePackagePick));
bot.action('sub_codew_nodate', requireAdmin(activationCodesHandler.handleCodeNoExpiry));
bot.action('sub_codew_setdate', requireAdmin(activationCodesHandler.handleCodeSetExpiryStart));

// ─── Alerts (quick toggles) ───────────────────────────────────────────────────

bot.action(/^sub_alerts_toggle_(\w+)$/, requireAdmin(handleAlertsToggle));

// ─── Settings ─────────────────────────────────────────────────────────────────

bot.action('sub_settings_currency', requireAdmin(handleSettingsCurrencyMenu));
bot.action(/^sub_settings_setcur_(\w+)$/, requireAdmin(handleSettingsSetCurrency));
bot.action('sub_settings_tax', requireAdmin(handleSettingsTaxStart));
bot.action(/^sub_settings_msg_(\w+)$/, requireAdmin(handleSettingsMessageEditStart));
bot.action(/^sub_settings_toggle_(\w+)$/, requireAdmin(handleSettingsToggle));

// ─── Operations log ───────────────────────────────────────────────────────────

bot.action(/^sub_log_page_(\d+)$/, requireAdmin(handleSubscriptionsLogPage));

// ─── Storefront (subscriber-facing — open to all users, not admin-gated) ──────

bot.action('sub_store_mysub', storefrontHandler.handleStoreMySubscription);
bot.action('sub_store_packages', storefrontHandler.handleStorePackages);
bot.action('sub_store_redeem', storefrontHandler.handleStoreRedeemStart);
bot.action(/^sub_store_pkg_(\d+)$/, async (ctx) => {
  await storefrontHandler.handleStorePackageView(ctx, parseInt(ctx.match[1], 10));
});
bot.action(/^sub_store_subscribe_(\d+)$/, storefrontHandler.handleStoreSubscribeStart);
bot.action(/^sub_store_coupon_yes_(\d+)$/, storefrontHandler.handleStoreCouponYes);
bot.action(/^sub_store_coupon_no_(\d+)$/, storefrontHandler.handleStoreCouponNo);
bot.action(/^sub_store_confirm_(\d+)$/, storefrontHandler.handleStoreConfirm);
bot.action('sub_store_offers', storefrontHandler.handleStoreOffers);
bot.action('sub_store_history', storefrontHandler.handleStoreHistory);

// ─── Text Message Router ──────────────────────────────────────────────────────

bot.on('text', textRouter);

// ─── Document Upload Router (links file for join-to-links feature) ────────────

bot.on('document', async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  const uid = String(ctx.from.id);
  if (isAwaitingLinksFile(uid)) {
    await handleJoinLinksFileInput(ctx);
  }
});

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

    // Start the subscriptions module's background scheduler (pre/post expiry alerts).
    startSubscriptionScheduler(bot);

    // Start the publish engine's background scheduler.
    startPublishScheduler();
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
};

startBot();
