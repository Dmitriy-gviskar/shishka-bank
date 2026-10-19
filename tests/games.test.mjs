// Мини-игры: доля за верные, двойка ниже половины, провал закрывает день.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';

const P = (code, body) => ({
  method: 'POST',
  headers: { 'x-child-code': code, 'content-type': 'application/json' },
  body: JSON.stringify(body || {}),
});

test('лесные задачи: ниже половины — двойка и ноль, день закрыт', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const zero = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'story', score: 0 }));
  assert.equal(zero.status, 200);
  assert.equal(zero.body.reward, 0);
  assert.equal(zero.body.failed, true);

  const retry = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'story', score: 5 }));
  assert.equal(retry.body.already, true);
  assert.equal(retry.body.reward, 0, 'завалил — приходи завтра, даже на пятёрку');

  const one = await srv.api('/api/game/finish', P(db.childA2.code, { game: 'story', score: 1 }));
  assert.equal(one.status, 200);
  assert.equal(one.body.reward, 0, '1 из 5 — двойка, не 1 и не 5');

  const halfMinus = await srv.api('/api/game/finish', P(db.childB1.code, { game: 'story', score: 2 }));
  assert.equal(halfMinus.body.reward, 0, '2 из 5 всё ещё двойка');

  const pass = await srv.api('/api/game/finish', P(db.childB2.code, { game: 'story', score: 3 }));
  assert.equal(pass.status, 200);
  assert.equal(pass.body.reward, 3, '3 из 5 — тройка, 3 шишки');
  assert.equal(pass.body.failed, false);
});

test('игры: полный забег даёт обещанное, провал не кормит', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const full = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'guess', score: 5 }));
  assert.equal(full.status, 200);
  assert.equal(full.body.reward, 5, '5 из 5 — вся награда');

  const part = await srv.api('/api/game/finish', P(db.childA2.code, { game: 'guess', score: 1 }));
  assert.equal(part.status, 200);
  assert.equal(part.body.reward, 0, '1 из 5 угадайки — двойка');

  const mul = await srv.api('/api/game/finish', P(db.childB1.code, { game: 'multiply', score: 1 }));
  assert.equal(mul.status, 200);
  assert.equal(mul.body.reward, 0, '1 из 10 умножения — двойка');

  const mulAll = await srv.api('/api/game/finish', P(db.childB2.code, { game: 'multiply', score: 10 }));
  assert.equal(mulAll.status, 200);
  assert.equal(mulAll.body.reward, 3, '10 из 10 на лёгком — обещанные 3');
});
