import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';

const H = (code) => ({ headers: { 'x-child-code': code, 'content-type': 'application/json' } });
const P = (code, body) => ({ method: 'POST', ...H(code), body: JSON.stringify(body || {}) });
const PIN = { headers: { 'x-parent-pin': 'testpin', 'content-type': 'application/json' } };

test('родитель задаёт возраст — писать можно только в коридоре', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  await srv.api('/api/guardian/link', P(db.childA2.code, { code: db.childA1.code }));
  const set = await srv.api('/api/guardian/chat-ages', P(db.childA2.code, {
    childId: db.childA1.id, age: 9, chatMin: 8, chatMax: 10,
  }));
  assert.equal(set.status, 200);
  assert.equal(set.body.chatMin, 8);
  assert.equal(set.body.chatMax, 10);

  const host = await srv.api('/api/parent/chat-ages', {
    ...PIN, method: 'POST', body: JSON.stringify({ childId: db.childB1.id, age: 14 }),
  });
  assert.equal(host.status, 200);

  const blocked = await srv.api('/api/friends/request', P(db.childA1.code, { to: db.childB1.id }));
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /8–10/);

  const mail = await srv.api('/api/message', P(db.childA1.code, { to: db.childB1.id, content: 'привет' }));
  assert.equal(mail.status, 403);

  await srv.api('/api/parent/chat-ages', {
    ...PIN, method: 'POST', body: JSON.stringify({ childId: db.childB1.id, age: 9 }),
  });
  const ok = await srv.api('/api/friends/request', P(db.childA1.code, { to: db.childB1.id }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'pending');
});

test('без коридора чат как раньше; чужой опекун возраст не меняет', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const open = await srv.api('/api/friends/request', P(db.childA1.code, { to: db.childB1.id }));
  assert.equal(open.status, 200);

  const spy = await srv.api('/api/guardian/chat-ages', P(db.childA2.code, {
    childId: db.childA1.id, age: 8, chatMin: 8, chatMax: 8,
  }));
  assert.equal(spy.status, 403);
});
