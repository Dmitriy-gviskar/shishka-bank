// Главная: код переноса можно вставить на витрине, не только на link.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';

test('на главной есть поле для кода переноса', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const res = await fetch(`http://127.0.0.1:${srv.port}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /id="homeCode"/);
  assert.match(html, /id="homeCodeBox"/);
  assert.match(html, /Код с другого телефона/);
});

test('код с профиля пускает в тот же лес', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const login = await srv.api('/api/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: db.childA1.code }),
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  const state = await srv.api('/api/state', { headers: { 'x-device-token': login.body.token } });
  assert.equal(state.status, 200);
  assert.equal(state.body.name, 'Ребёнок A1');
  assert.equal(state.body.login_code, db.childA1.code);
});
