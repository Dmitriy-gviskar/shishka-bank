import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';

const H = (code) => ({ headers: { 'x-child-code': code, 'content-type': 'application/json' } });
const post = (code, extra = {}) => ({ method: 'POST', ...H(code), ...extra });

test('почта: угловые скобки и длина режутся на сервере (защита в глубину к клиентскому esc)', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const payload = '<img src=x onerror=alert(1)>'.repeat(5);   // 135 символов с тегами
  const sent = await srv.api('/api/message', post(db.childA1.code, { body: JSON.stringify({ to: db.childA2.id, emoji: payload }) }));
  assert.equal(sent.status, 200);

  const inbox = await srv.api('/api/inbox', H(db.childA2.code));
  assert.equal(inbox.status, 200);
  const msg = inbox.body[0];
  assert.ok(msg, 'сообщение доставлено');
  assert.ok(!msg.content.includes('<') && !msg.content.includes('>'), 'угловые скобки вырезаны');
  assert.ok(msg.content.length <= 80, `длина ограничена 80 (было ${msg.content.length})`);
});

test('кабинет ведущего открыт без PIN', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url, { PARENT_PIN: '' });
  t.after(() => srv.stop());

  const kids = await srv.api('/api/parent/children');
  assert.equal(kids.status, 200);
  assert.ok(Array.isArray(kids.body));
  assert.ok(kids.body.some((k) => k.id === db.childA1.id));
});

test('начисление ведущим не больше 100 шишек за раз, даже с PIN', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const huge = await srv.api('/api/parent/topup', {
    method: 'POST',
    headers: { 'x-parent-pin': 'testpin', 'content-type': 'application/json' },
    body: JSON.stringify({ childId: db.childA1.id, amount: 100000000 }),
  });
  assert.equal(huge.status, 400);
  assert.match(huge.body.error, /не больше 100/);

  const ok = await srv.api('/api/parent/topup', {
    method: 'POST',
    headers: { 'x-parent-pin': 'testpin', 'content-type': 'application/json' },
    body: JSON.stringify({ childId: db.childA1.id, amount: 100 }),
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.balance, 130);
});

test('новый код входа — криптослучайный из безопасного алфавита, развязан от имени, работает', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const add = await srv.api('/api/parent/add-child', { method: 'POST', headers: { 'x-parent-pin': 'testpin', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Тимофей', tree: 'pine' }) });
  assert.equal(add.status, 200);
  const code = add.body.code;
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/, 'код 6 символов из алфавита без 0/O/1/I/L, латиница → не завязан на кириллическое имя');

  // код реально пускает в аккаунт этого ребёнка
  const login = await srv.api('/api/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  assert.equal(login.status, 200);
  const state = await srv.api('/api/state', { headers: { 'x-child-code': code } });
  assert.equal(state.status, 200);
  assert.equal(state.body.name, 'Тимофей');
});

test('вход по коду: 10 неверных кодов с IP → лок (429), верный код сбрасывает счётчик', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const link = (code) => srv.api('/api/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });

  // 5 неверных (каждый — 400 «код не найден»), потом верный — счётчик обнуляется
  for (let i = 0; i < 5; i++) { const r = await link('ZZ-99'); assert.equal(r.status, 400); }
  const good = await link(db.childA1.code);
  assert.equal(good.status, 200);
  assert.ok(good.body.ok, 'верный код принят');

  // теперь снова 10 неверных → лок на 11-й
  for (let i = 0; i < 10; i++) await link('ZZ-99');
  const locked = await link('ZZ-99');
  assert.equal(locked.status, 429, 'после 10 неверных — лок');
});
