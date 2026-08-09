process.env.DB_PATH = '/tmp/telegram-schedule-test.db';
const fs = require('fs');
try { fs.unlinkSync(process.env.DB_PATH); } catch {}
const { initScheduleSchema, scheduleQueries } = require('../src/database/scheduleDb');
initScheduleSchema();
const row = scheduleQueries.create('u1', {
  name: 'اختبار', accountIds: [1, 2], targetIds: ['@channel'], adIds: [3],
  scheduledAt: new Date(Date.now() + 3600000).toISOString(), recurrence: 'daily', delaySeconds: 5,
});
if (!row || row.id !== 1) throw new Error('schedule create failed');
if (scheduleQueries.findConflict('u1', row.scheduled_at, [1], ['@channel'])?.id !== row.id) throw new Error('conflict detection failed');
scheduleQueries.update(row.id, 'u1', { status: 'running' });
if (scheduleQueries.list('u1', 'running').length !== 1) throw new Error('status update failed');
scheduleQueries.addRun({ scheduleId: row.id, userId: 'u1', accountId: 1, targetId: '@channel', adId: 3, result: 'success', detail: 'ok' });
if (scheduleQueries.stats('u1').success !== 1) throw new Error('run stats failed');
scheduleQueries.remove(row.id, 'u1');
if (scheduleQueries.list('u1').length !== 0) throw new Error('delete failed');
console.log('schedule flow ok');
