// Дружба по коду с поляны: между кругами заявка → принять → чат.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';

const H = (code) => ({ headers: { 'x-child-code': code, 'content-type': 'application/json' } });
const P = (code, body) => ({ method: 'POST', ...H(code), body: JSON.stringify(body || {}) });

test('код с поляны из другого круга: заявка, принять, чат и подарок шишек', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const code = db.childB1.ref;

  const miss = await srv.api('/api/friends/request', P(db.childA1.code, { code: 'ZZZZZZ' }));
  assert.equal(miss.status, 400);
  assert.match(miss.body.error, /не найден/);

  const self = await srv.api('/api/friends/request', P(db.childB1.code, { code }));
  assert.equal(self.status, 400);
  assert.match(self.body.error, /сам/);

  // чужой id без кода — нельзя обходить круговую изоляцию
  const byId = await srv.api('/api/friends/request', P(db.childA1.code, { to: db.childB1.id }));
  assert.equal(byId.status, 403);

  const req = await srv.api('/api/friends/request', P(db.childA1.code, { code }));
  assert.equal(req.status, 200);
  assert.equal(req.body.status, 'pending');
  assert.equal(req.body.name, 'Ребёнок B1');

  const hubB = await srv.api('/api/friends/hub', H(db.childB1.code));
  assert.equal(hubB.status, 200);
  assert.equal(hubB.body.pending_in.length, 1);
  assert.equal(hubB.body.pending_in[0].id, db.childA1.id);

  const hubA = await srv.api('/api/friends/hub', H(db.childA1.code));
  assert.equal(hubA.body.pending_out.length, 1);
  assert.ok(hubA.body.my_code);

  const acc = await srv.api('/api/friends/accept', P(db.childB1.code, { from: db.childA1.id }));
  assert.equal(acc.status, 200);

  const friends = await srv.api('/api/friends', H(db.childA1.code));
  assert.ok(friends.body.some((f) => f.id === db.childB1.id), 'A видит B в друзьях');

  const sent = await srv.api('/api/message', P(db.childA1.code, { to: db.childB1.id, content: 'привет из круга А' }));
  assert.equal(sent.status, 200, sent.body?.error || JSON.stringify(sent.body));

  const chat = await srv.api('/api/chat', P(db.childB1.code, { with: db.childA1.id }));
  assert.equal(chat.status, 200);
  assert.ok(chat.body.some((m) => m.content.includes('привет') && !m.mine));

  const list = await srv.api('/api/chat/list', P(db.childB1.code, {}));
  assert.ok(list.body.some((c) => c.id === db.childA1.id && c.last_msg));

  const gift = await srv.api('/api/transfer', P(db.childA1.code, { to: db.childB1.id, amount: 5 }));
  assert.equal(gift.status, 200);
});

test('без дружбы в чужой круг писать и дарить нельзя; код входа тоже находит друга', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const msg = await srv.api('/api/message', P(db.childA1.code, { to: db.childB1.id, content: 'хай' }));
  assert.equal(msg.status, 403);

  const gift = await srv.api('/api/transfer', P(db.childA1.code, { to: db.childB1.id, amount: 5 }));
  assert.equal(gift.status, 403);

  const req = await srv.api('/api/friends/request', P(db.childA1.code, { code: db.childB1.code }));
  assert.equal(req.status, 200);
  assert.equal(req.body.status, 'pending');

  await srv.api('/api/friends/accept', P(db.childB1.code, { from: db.childA1.id }));
  const again = await srv.api('/api/friends/request', P(db.childA1.code, { code: db.childB1.code }));
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'accepted');
});
