const { accountQueries } = require('../database/db');
const { adQueries } = require('../database/publishDb');
const { joinGroupQueries } = require('../database/joinDb');
const { scheduleQueries } = require('../database/scheduleDb');
const wizard = require('../services/scheduleWizardState');
const keyboards = require('../utils/scheduleKeyboards');
const { nextOccurrence } = require('../services/scheduleService');

const uid = (ctx) => String(ctx.from.id);
const edit = async (ctx, text, keyboard) => {
  await ctx.answerCbQuery().catch(() => {});
  try { await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }); }
  catch { await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard }); }
};
const fmt = (row) => {
  const status = row.status === 'running' ? '🟢 يعمل' : row.status === 'completed' ? '✅ مكتمل' : row.status === 'failed' ? '🔴 فشل' : '⏸️ متوقف';
  const recurrence = { once: 'مرة واحدة', daily: 'يوميًا', weekly: 'أسبوعيًا', custom: `كل ${row.recurrence_value || 1} يوم` }[row.recurrence] || row.recurrence;
  return `🆔 *${row.id}* | ${row.name}\n👤 الحسابات: ${JSON.parse(row.account_ids || '[]').join(', ')}\n📂 الوجهات: ${JSON.parse(row.target_ids || '[]').join(', ')}\n📝 المحتوى: ${row.content_text || `إعلان #${JSON.parse(row.ad_ids || '[]')[0] || '-'}`}\n📅 الموعد: ${row.next_run_at || row.scheduled_at}\n🔁 التكرار: ${recurrence}\n${status}`;
};
const menu = async (ctx) => edit(ctx, '📅 *جدولة النشر*\n\nاختر العملية المطلوبة:', keyboards.scheduleMenuKeyboard());
const list = async (ctx, status) => {
  const rows = scheduleQueries.list(uid(ctx), status);
  const text = rows.length ? rows.map(fmt).join('\n\n') : 'لا توجد جدولات محفوظة.';
  const buttons = rows.flatMap((row) => [
    [{ text: row.status === 'running' ? '⏸️ إيقاف' : '▶️ تشغيل', callback_data: `schedule_toggle_${row.id}` }, { text: `📋 #${row.id}`, callback_data: `schedule_detail_${row.id}` }],
    [{ text: '✏️ تعديل', callback_data: `schedule_edit_${row.id}` }, { text: '🗑️ حذف', callback_data: `schedule_delete_${row.id}` }],
  ]);
  buttons.push([{ text: '🔙 رجوع', callback_data: 'schedule_menu' }]);
  return edit(ctx, `📋 *الجدولات*\n\n${text}`, { reply_markup: { inline_keyboard: buttons } });
};
const start = async (ctx) => {
  const user = uid(ctx); wizard.begin(user);
  const accounts = accountQueries.getAllByUserId(user).filter((a) => a.status === 'connected');
  if (!accounts.length) return edit(ctx, 'لا يوجد حساب متصل. أضف حسابًا أولًا.', keyboards.scheduleMenuKeyboard());
  return edit(ctx, '1️⃣ *اختيار الحسابات*\nيمكنك اختيار حساب أو عدة حسابات ثم الضغط على متابعة.', keyboards.wizardAccountsKeyboard(accounts));
};
const accountsDone = async (ctx) => {
  const state = wizard.get(uid(ctx)); if (!state?.accountIds.length) return ctx.answerCbQuery('اختر حسابًا واحدًا على الأقل');
  wizard.update(uid(ctx), { step: 'targets' });
  const targets = joinGroupQueries.getAllByUserId(uid(ctx));
  return edit(ctx, '2️⃣ *اختيار الوجهات*\nاختر مجموعة أو قناة أو عدة وجهات.', keyboards.wizardTargetsKeyboard(targets, state.targetIds));
};
const content = async (ctx) => {
  const state = wizard.get(uid(ctx)); if (!state?.targetIds.length) return ctx.answerCbQuery('اختر وجهة واحدة على الأقل');
  wizard.update(uid(ctx), { step: 'content' });
  return edit(ctx, '3️⃣ *اختيار الإعلان*\nاختر من المكتبة أو اكتب منشورًا جديدًا.', keyboards.wizardContentKeyboard(adQueries.getAll(uid(ctx))));
};
const scheduleTime = async (ctx) => { wizard.update(uid(ctx), { step: 'time' }); await edit(ctx, '4️⃣ أرسل التاريخ والوقت بالصيغة:\n`2026-08-09 21:30`\n\nاستخدم توقيت الخادم.', {}); };
const recurrence = async (ctx) => { wizard.update(uid(ctx), { step: 'recurrence' }); return edit(ctx, '5️⃣ *نوع الجدولة*', keyboards.recurrenceKeyboard()); };
const delay = async (ctx) => { wizard.update(uid(ctx), { step: 'delay' }); return edit(ctx, '6️⃣ *التأخير بين عمليات النشر*', keyboards.delayKeyboard()); };
const summary = async (ctx) => {
  const state = wizard.get(uid(ctx));
  const recurrenceLabel = { once: 'مرة واحدة', daily: 'يوميًا', weekly: 'أسبوعيًا', custom: `كل ${state.recurrenceValue} يوم` }[state.recurrence];
  return edit(ctx, `7️⃣ *ملخص الجدولة*\n\n👤 الحسابات: ${state.accountIds.join(', ')}\n📂 الوجهات: ${state.targetIds.join(', ')}\n📝 المحتوى: ${state.contentText || `إعلان #${state.adIds[0]}`}\n📅 الموعد: ${state.scheduledAt}\n🔁 التكرار: ${recurrenceLabel}\n⏱ التأخير: ${state.delaySeconds} ثانية`, { reply_markup: { inline_keyboard: [[{ text: '✅ تأكيد وإنشاء الجدولة', callback_data: 'schedule_confirm' }], [{ text: '🔙 رجوع', callback_data: 'schedule_menu' }, { text: '❌ إلغاء', callback_data: 'schedule_cancel' }]] } });
};
const confirm = async (ctx) => {
  const user = uid(ctx); const state = wizard.get(user);
  if (!state?.scheduledAt) return ctx.answerCbQuery('بيانات الجدولة غير مكتملة');
  const conflict = scheduleQueries.findConflict(user, state.scheduledAt, state.accountIds, state.targetIds);
  if (conflict) return edit(ctx, `⚠️ يوجد تضارب مع الجدولة #${conflict.id} في نفس الموعد والحسابات والوجهات.`, keyboards.scheduleMenuKeyboard());
  const row = scheduleQueries.create(user, state);
  wizard.reset(user);
  return edit(ctx, `✅ تم إنشاء الجدولة #${row.id} وحفظها بنجاح.\nالحالة: ⏸️ متوقفة. يمكنك تشغيلها من القائمة.`, keyboards.scheduleMenuKeyboard());
};
const toggle = async (ctx, id) => { const row = scheduleQueries.getById(id, uid(ctx)); if (!row) return ctx.answerCbQuery('الجدولة غير موجودة'); const status = row.status === 'running' ? 'paused' : 'running'; scheduleQueries.update(id, uid(ctx), { status, next_run_at: row.next_run_at || row.scheduled_at }); return list(ctx); };
const detail = async (ctx, id) => { const row = scheduleQueries.getById(id, uid(ctx)); if (!row) return ctx.answerCbQuery('الجدولة غير موجودة'); return edit(ctx, `📋 *تفاصيل الجدولة*\n\n${fmt(row)}\n\n✅ نجح: ${row.success_count} | ❌ فشل: ${row.failure_count}\n🔁 مرات التنفيذ: ${row.run_count}\nآخر خطأ: ${row.last_error || 'لا يوجد'}`, keyboards.rowKeyboard(row)); };
const remove = async (ctx, id) => { const row = scheduleQueries.getById(id, uid(ctx)); if (!row) return ctx.answerCbQuery('الجدولة غير موجودة'); return edit(ctx, `هل تريد حذف الجدولة #${id}؟`, { reply_markup: { inline_keyboard: [[{ text: '✅ تأكيد الحذف', callback_data: `schedule_delete_yes_${id}` }], [{ text: '❌ إلغاء', callback_data: `schedule_detail_${id}` }]] } }); };
const removeYes = async (ctx, id) => { scheduleQueries.remove(id, uid(ctx)); return menu(ctx); };
const editStart = async (ctx, id) => { const row = scheduleQueries.getById(id, uid(ctx)); if (!row) return ctx.answerCbQuery('الجدولة غير موجودة'); wizard.begin(uid(ctx)); wizard.update(uid(ctx), { step: 'edit_time', editId: id }); return edit(ctx, `✏️ أرسل الموعد الجديد للجدولة #${id} بالصيغة:\n\`2026-08-09 21:30\``, {}); };
const text = async (ctx) => {
  const user = uid(ctx); const state = wizard.get(user); if (!state) return false; const input = ctx.message.text.trim();
  if (state.step === 'targets_manual') { wizard.update(user, { targetIds: [...state.targetIds, input], step: 'targets' }); const targets = joinGroupQueries.getAllByUserId(user); return ctx.reply('تمت إضافة الوجهة. اختر المزيد أو تابع.', keyboards.wizardTargetsKeyboard(targets, wizard.get(user).targetIds)); }
  if (state.step === 'content_new') { wizard.update(user, { contentText: input, contentType: 'text' }); return ctx.reply('تم حفظ المنشور. اضغط متابعة من القائمة.', { reply_markup: { inline_keyboard: [[{ text: '✅ متابعة', callback_data: 'schedule_content_done' }], [{ text: '❌ إلغاء', callback_data: 'schedule_cancel' }]] } }); }
  if (state.step === 'time') { const parsed = new Date(input.replace(' ', 'T')); if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return ctx.reply('صيغة أو موعد غير صالح. أرسل وقتًا مستقبليًا: YYYY-MM-DD HH:mm'); wizard.update(user, { scheduledAt: parsed.toISOString() }); return ctx.reply('تم حفظ الموعد. اختر نوع التكرار.', keyboards.recurrenceKeyboard()); }
  if (state.step === 'custom_repeat') { const days = Number(input); if (!Number.isInteger(days) || days < 1) return ctx.reply('أرسل عدد أيام صحيحًا.'); wizard.update(user, { recurrence: 'custom', recurrenceValue: days }); return ctx.reply('تم حفظ التكرار. اختر التأخير.', keyboards.delayKeyboard()); }
  if (state.step === 'custom_delay') { const seconds = Number(input); if (!Number.isInteger(seconds) || seconds < 0) return ctx.reply('أرسل عدد ثوانٍ صحيحًا.'); wizard.update(user, { delaySeconds: seconds }); return ctx.reply('تم حفظ التأخير.', { reply_markup: { inline_keyboard: [[{ text: '📋 عرض الملخص', callback_data: 'schedule_summary' }]] } }); }
  if (state.step === 'edit_time') { const parsed = new Date(input.replace(' ', 'T')); if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return ctx.reply('موعد غير صالح.'); scheduleQueries.update(state.editId, user, { scheduled_at: parsed.toISOString(), next_run_at: parsed.toISOString(), status: 'paused' }); wizard.reset(user); return ctx.reply('✅ تم تعديل الموعد وإيقاف الجدولة مؤقتًا حتى تشغيلها.', keyboards.scheduleMenuKeyboard()); }
  return false;
};
const toggleAccount = async (ctx, id) => { const state = wizard.get(uid(ctx)); if (!state) return; const ids = state.accountIds.includes(Number(id)) ? state.accountIds.filter((x) => x !== Number(id)) : [...state.accountIds, Number(id)]; wizard.update(uid(ctx), { accountIds: ids }); const accounts = accountQueries.getAllByUserId(uid(ctx)).filter((a) => a.status === 'connected'); return edit(ctx, '1️⃣ اختيار الحسابات', keyboards.wizardAccountsKeyboard(accounts, ids)); };
const toggleTarget = async (ctx, id) => { const state = wizard.get(uid(ctx)); if (!state) return; const sid = String(id); const ids = state.targetIds.includes(sid) ? state.targetIds.filter((x) => x !== sid) : [...state.targetIds, sid]; wizard.update(uid(ctx), { targetIds: ids }); return edit(ctx, '2️⃣ اختيار الوجهات', keyboards.wizardTargetsKeyboard(joinGroupQueries.getAllByUserId(uid(ctx)), ids)); };
const selectAd = async (ctx, id) => { wizard.update(uid(ctx), { adIds: [Number(id)], contentText: null }); return scheduleTime(ctx); };
const selectRepeat = async (ctx, value) => { if (value === 'custom') { wizard.update(uid(ctx), { step: 'custom_repeat' }); return ctx.reply('أرسل عدد الأيام بين كل نشر وآخر.'); } wizard.update(uid(ctx), { recurrence: value, recurrenceValue: null }); return delay(ctx); };
const setDelay = async (ctx, seconds) => { wizard.update(uid(ctx), { delaySeconds: Number(seconds) }); return summary(ctx); };
const contentNew = async (ctx) => { wizard.update(uid(ctx), { step: 'content_new' }); return ctx.reply('أرسل نص المنشور الجديد.'); };
const cancel = async (ctx) => { wizard.reset(uid(ctx)); return menu(ctx); };
const stats = async (ctx) => { const s = scheduleQueries.stats(uid(ctx)); return edit(ctx, `📊 *إحصائيات الجدولة*\n\nإجمالي الجدولات: ${s.total}\n🟢 تعمل: ${s.running}\n⏸ متوقفة: ${s.paused}\n✅ عمليات ناجحة: ${s.success}\n❌ عمليات فاشلة: ${s.failed}`, keyboards.scheduleMenuKeyboard()); };
const logs = async (ctx) => { const rows = scheduleQueries.recentRuns(uid(ctx), 30); const text = rows.length ? rows.map((r) => `${r.result === 'success' ? '✅' : '❌'} #${r.schedule_id} | ${r.target_id} | ${r.detail || ''}`).join('\n') : 'لا يوجد سجل عمليات.'; return edit(ctx, `📜 *سجل عمليات الجدولة*\n\n${text}`, keyboards.scheduleMenuKeyboard()); };
const settings = async (ctx) => edit(ctx, '⚙️ *إعدادات الجدولة*\n\nالفحص كل 5 ثوانٍ. يتم عزل أخطاء كل جدولة ولا تتأثر الجدولات الأخرى. التوقيت حسب الخادم.', keyboards.scheduleMenuKeyboard());
module.exports = { menu, start, list, toggleAccount, accountsDone, toggleTarget, content, selectAd, contentNew, scheduleTime, recurrence, selectRepeat, delay, setDelay, summary, confirm, toggle, detail, remove, removeYes, editStart, text, cancel, stats, logs, settings };
