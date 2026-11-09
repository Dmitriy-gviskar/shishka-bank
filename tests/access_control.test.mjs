import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setupDb, startServer } from './helpers/db.mjs';
const pg = createRequire(new URL('../client/package.json', import.meta.url))('pg');
const post = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const child = (code) => ({ 'x-child-code': code });

test('host API rejects anonymous, child and wrong PIN; correct PIN permits management', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());
  const login = await srv.api('/api/link', post({ code: db.childA1.code }));
  for (const headers of [{}, child(db.childA1.code), { 'x-device-token': login.body.token }, { 'x-parent-pin': 'wrong' }]) {
    assert.equal((await srv.api('/api/parent/children', { headers })).status, 401);
    assert.equal((await srv.api('/api/parent/topup', post({ childId: db.childA1.id, amount: 10 }, headers))).status, 401);
    assert.equal((await srv.api('/api/parent/link-guardian', post({ childId: db.childA1.id, guardianId: db.childB1.id }, headers))).status, 401);
    assert.equal((await srv.hostApi('/api/parent/children')).status, 200);
  }
  assert.equal((await srv.hostApi('/api/parent/children')).status, 200);
  assert.equal((await srv.hostApi('/api/parent/topup', post({ childId: db.childA1.id, amount: 10 }))).status, 200);
  const state = await srv.api('/api/state', { headers: child(db.childA1.code) });
  assert.equal(state.body.balance, 40);
});

test('host fails closed for missing or whitespace PIN', async (t) => {
  const db = await setupDb();
  for (const pin of ['', '   ']) {
    const srv = await startServer(db.url, { PARENT_PIN: pin });
    try {
      assert.equal((await srv.api('/api/parent/children')).status, 503);
      assert.equal((await srv.api('/api/parent/topup', post({ childId: db.childA1.id, amount: 10 }))).status, 503);
    } finally { await srv.stop(); }
  }
});

test('PIN attempts lock out; successful child login cannot reset host lock', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());
  for (let i = 0; i < 10; i++) {
    assert.equal((await srv.api('/api/parent/children', { headers: { 'x-parent-pin': 'wrong', 'x-forwarded-for': `192.0.2.${i}` } })).status, 401);
    assert.equal((await srv.api('/api/link', post({ code: db.childA1.code }))).status, 200);
  }
  assert.equal((await srv.hostApi('/api/parent/children')).status, 429);
});

test('recovery never discloses credentials by name or matching signup IP; code login still works', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());
  const signup = await srv.api('/api/signup', post({ name: 'ЛесТест', tree: 'pine' }));
  assert.equal(signup.status, 200);
  let message;
  for (const name of ['ЛесТест', 'Ребёнок A1', 'Несуществующее', '']) {
    const res = await srv.api('/api/recover', post({ name }));
    assert.equal(res.status, 403);
    assert.equal(res.body.code, undefined);
    assert.equal(res.body.token, undefined);
    message ??= res.body.error;
    assert.equal(res.body.error, message);
  }
  const login = await srv.api('/api/link', post({ code: signup.body.code }));
  assert.equal(login.status, 200);
  const state = await srv.api('/api/state', { headers: { 'x-device-token': login.body.token } });
  assert.equal(state.body.name, 'ЛесТест');
});

test('child cannot appoint itself guardian by name, referral or private login code; host can appoint and revoke', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());
  for (const code of ['Ребёнок A1', db.childA1.ref, db.childA1.code]) {
    const res = await srv.api('/api/guardian/link', post({ code }, child(db.childB1.code)));
    assert.equal(res.status, 403);
  }
  assert.equal((await srv.api('/api/guardian/family', { headers: child(db.childB1.code) })).body.kids.length, 0);
  const body = { childId: db.childA1.id, guardianId: db.childB1.id };
  assert.equal((await srv.hostApi('/api/parent/link-guardian', post(body))).status, 200);
  assert.equal((await srv.hostApi('/api/parent/link-guardian', post(body))).status, 200);
  const home = await srv.api('/api/guardian/family', { headers: child(db.childB1.code) });
  assert.equal(home.body.kids.length, 1);
  assert.equal((await srv.api('/api/guardian/chat-ages', post({ childId: db.childA1.id, age: 9, chatMin: 8, chatMax: 11 }, child(db.childB1.code)))).status, 200);
  assert.equal((await srv.hostApi('/api/parent/unlink-guardian', post(body))).status, 200);
  assert.equal((await srv.api('/api/guardian/chat-ages', post({ childId: db.childA1.id, age: 9 }, child(db.childB1.code)))).status, 403);
  const pool = new pg.Pool({ connectionString: db.url });
  try { assert.equal((await pool.query('select count(*)::int as n from child_guardians')).rows[0].n, 0); }
  finally { await pool.end(); }
});

test('legacy guardian links grant no access until host verification; repeated migration preserves verification', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());
  const pool = new pg.Pool({ connectionString: db.url });
  t.after(() => pool.end());
  await pool.query('insert into child_guardians(child_id, guardian_id) values($1,$2)', [db.childA1.id, db.childB1.id]);
  assert.equal((await srv.api('/api/guardian/family', { headers: child(db.childB1.code) })).body.kids.length, 0);
  assert.equal((await srv.api('/api/guardian/chat-ages', post({ childId: db.childA1.id, age: 9 }, child(db.childB1.code)))).status, 403);
  const hosts = await srv.hostApi('/api/parent/children');
  assert.equal(hosts.body.find((x) => x.id === db.childA1.id).guardianLinks[0].verified_at, null);
  assert.equal((await srv.hostApi('/api/parent/link-guardian', post({ childId: db.childA1.id, guardianId: db.childB1.id }))).status, 200);
  await pool.query('alter table child_guardians add column if not exists verified_at timestamptz');
  assert.equal((await srv.api('/api/guardian/family', { headers: child(db.childB1.code) })).body.kids.length, 1);
});
