import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';

test('код ребёнка отдаёт его состояние, чужой код — 401', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const ok = await srv.api('/api/state', { headers: { 'x-child-code': db.childA1.code } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.balance, 30);

  const bad = await srv.api('/api/state', { headers: { 'x-child-code': 'ZZ-99' } });
  assert.equal(bad.status, 401);
});
