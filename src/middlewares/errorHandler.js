const logger = require('../utils/logger');
const { mainMenuKeyboard } = require('../utils/keyboards');

/**
 * Global error handler for the Telegraf bot
 * Catches unhandled errors from handlers and middlewares
 *
 * FIX: يحاول editMessageText أولاً عند callback queries
 *      لتجنب ظهور قائمة مكررة
 */
const errorHandler = (err, ctx) => {
  logger.error('Unhandled bot error:', {
    error: err.message,
    stack: err.stack,
    updateType: ctx?.updateType,
    userId: ctx?.from?.id,
  });

  const errorMessage = '⚠️ حدث خطأ غير متوقع. الرجاء المحاولة لاحقًا.';

  try {
    if (ctx?.callbackQuery) {
      // أجب على الـ callback أولاً لإزالة حالة التحميل
      ctx.answerCbQuery('⚠️ حدث خطأ').catch(() => {});
      // عدّل الرسالة الحالية بدلاً من إرسال جديدة
      ctx.editMessageText(errorMessage, { parse_mode: 'Markdown' })
        .catch(() => {
          // إذا فشل التعديل (رسالة قديمة جداً)، أرسل جديدة
          ctx.reply(errorMessage, mainMenuKeyboard()).catch(() => {});
        });
    } else if (ctx?.message) {
      ctx.reply(errorMessage, mainMenuKeyboard()).catch(() => {});
    }
  } catch (_) {
    // Suppress secondary errors in error handler
  }
};

module.exports = errorHandler;
