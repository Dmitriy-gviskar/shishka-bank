import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';

const H = (code) => ({ headers: { 'x-child-code': code, 'content-type': 'application/json' } });
const P = (code, body) => ({ method: 'POST', ...H(code), body: JSON.stringify(body || {}) });

test('викторина 10–14: 8 вопросов, верный ответ принимается, награда раз в день', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const start = await srv.api('/api/game/quiz/start', P(db.childA1.code, {}));
  assert.equal(start.status, 200);
  assert.equal(start.body.questions.length, 8);
  assert.equal(start.body.reward, 6);
  for (const q of start.body.questions) {
    assert.ok(q.q && q.q.length > 8, 'есть формулировка');
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer), 'верный вариант среди четырёх');
    assert.equal(new Set(q.options).size, 4, 'варианты не повторяются');
  }

  const q0 = start.body.questions[0];
  const ok = await srv.api('/api/game/quiz/answer', P(db.childA1.code, { answer: q0.answer, expected: q0.answer }));
  assert.equal(ok.body.correct, true);
  const bad = await srv.api('/api/game/quiz/answer', P(db.childA1.code, { answer: 'нет такого', expected: q0.answer }));
  assert.equal(bad.body.correct, false);

  const before = (await srv.api('/api/state', H(db.childA1.code))).body.balance;
  const fin = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'quiz', score: 7 }));
  assert.equal(fin.status, 200);
  assert.equal(fin.body.reward, 5, 'обещанные 6 минус 1 ошибка');
  const after = (await srv.api('/api/state', H(db.childA1.code))).body.balance;
  assert.equal(after, before + 5);

  const again = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'quiz', score: 8 }));
  assert.equal(again.body.already, true);
  assert.equal(again.body.reward, 0);
  assert.equal((await srv.api('/api/state', H(db.childA1.code))).body.balance, after);
});

test('задачи 10–14: пять числовых ответов, награда с потолком', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const start = await srv.api('/api/game/logic/start', P(db.childA1.code, {}));
  assert.equal(start.status, 200);
  assert.equal(start.body.questions.length, 5);
  assert.equal(start.body.reward, 6);
  for (const q of start.body.questions) {
    assert.ok(q.text && q.text.length > 10);
    assert.equal(typeof q.answer, 'number');
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0);
  }

  const before = (await srv.api('/api/state', H(db.childA1.code))).body.balance;
  const fin = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'logic', score: 5 }));
  assert.equal(fin.status, 200);
  assert.equal(fin.body.reward, 6);
  assert.equal((await srv.api('/api/state', H(db.childA1.code))).body.balance, before + 6);

  const unknown = await srv.api('/api/game/finish', P(db.childA1.code, { game: 'chess', score: 3 }));
  assert.equal(unknown.status, 400);
});
