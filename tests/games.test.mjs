// Мини-игры: шишки только за верные ответы, не за заход в забег.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';

const P = (code, body) => ({
  method: 'POST',
  headers: { 'x-child-code': code, 'content-type': 'application/json' },
  body: JSON.stringify(body || {}),
});

test('лесные задачи: 0 верных — ничего, 1 верный — 1 шишка, не все 5', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const zero = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'story', score: 0 }));
  assert.equal(zero.status, 200);
  assert.equal(zero.body.reward, 0);
  const before = zero.body.balance;
  assert.equal(typeof before, 'number');

  const one = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'story', score: 1 }));
  assert.equal(one.status, 200);
  assert.equal(one.body.reward, 1, '1 из 5 задач = 1 шишка, не обещанные 5');
  assert.equal(one.body.balance, before + 1);

  const again = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'story', score: 5 }));
  assert.equal(again.body.already, true);
  assert.equal(again.body.reward, 0, 'вторая выплата за тот же день не проходит');
});

test('игры: полный забег даёт обещанное, частичный — долю', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const full = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'guess', score: 5 }));
  assert.equal(full.status, 200);
  assert.equal(full.body.reward, 5, '5 из 5 — вся награда');

  const part = await srv.api('/api/game/finish', P(db.childA2.code, { game: 'guess', score: 1 }));
  assert.equal(part.status, 200);
  assert.equal(part.body.reward, 1, '1 из 5 угадайки — 1, не 5');

  const mul = await srv.api('/api/game/finish', P(db.childB1.code, { game: 'multiply', score: 1 }));
  assert.equal(mul.status, 200);
  assert.equal(mul.body.reward, 0, '1 из 10 умножения на лёгком (3 шишки) ещё не дотягивает');

  const mulAll = await srv.api('/api/game/finish', P(db.childB2.code, { game: 'multiply', score: 10 }));
  assert.equal(mulAll.status, 200);
  assert.equal(mulAll.body.reward, 3, '10 из 10 на лёгком — обещанные 3');
});
