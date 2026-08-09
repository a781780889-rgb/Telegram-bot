const fs = require('fs');
const dbPath = process.env.DB_PATH || '/tmp/subscription-flow.db';
fs.rmSync(dbPath, { force: true });
process.env.DB_PATH = dbPath;
const { getDb, botUserQueries } = require('../src/database/db');
const service = require('../src/services/subscriptionService');
const db = getDb();
botUserQueries.upsert('u-test', 'tester', 'Test');
for (const plan of Object.values(service.PLAN_TYPES)) {
  const [code] = service.createCodes({ planKey: plan.key, quantity: 1, adminId: 'admin' });
  const result = service.activateCode('u-test', code);
  if (!result.ok) throw new Error(`${plan.key}: activation failed: ${result.reason}`);
  const access = service.getAccess('u-test');
  if (!access.allowed) throw new Error(`${plan.key}: access denied after activation`);
  if (result.subscription.plan_key !== plan.key) throw new Error(`${plan.key}: wrong plan persisted`);
}
const finalAccess = service.getAccess('u-test');
if (!finalAccess.allowed || finalAccess.remaining !== null) throw new Error('Unlimited access assertion failed');
console.log(JSON.stringify({ ok: true, plans: Object.values(service.PLAN_TYPES).map((p) => p.key), accessAllowed: finalAccess.allowed, remaining: finalAccess.remaining }));
if (typeof db.close === 'function') db.close();
