// T27: на вебе видны котлы / гильдии / советы друзей, поляна не пустая.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupDb, startServer } from './helpers/db.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(join(ROOT, 'client/'))('pg');
const H = (code) => ({ headers: { 'x-child-code': code, 'content-type': 'application/json' } });
const P = (code, body) => ({ method: 'POST', ...H(code), body: JSON.stringify(body || {}) });

async function befriend(pool, a, b) {
  await pool.query(
    `insert into friendships(user_id, friend_id, status) values
       ($1,$2,'accepted'),($2,$1,'accepted')
     on conflict (user_id, friend_id) do update set status='accepted'`,
    [a, b]);
}

test('поляна отдаёт жизнь леса даже без своих котлов', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const life = await srv.api('/api/grove-life', H(db.childA1.code));
  assert.equal(life.status, 200);
  assert.ok(Array.isArray(life.body.pots));
  assert.ok(Array.isArray(life.body.proposals));
  assert.ok(Array.isArray(life.body.guilds));
  assert.ok(Array.isArray(life.body.shops));
  assert.equal(life.body.mail.friends, 1, 'в круге уже есть друг');
});

test('котёл и гильдия друга видны с другого круга, вклад и вступление проходят', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pool = new pg.Pool({ connectionString: db.url });
  t.after(async () => { srv.stop(); await pool.end(); });

  await befriend(pool, db.childA1.id, db.childB1.id);

  const pot = await srv.api('/api/pot/create', P(db.childA1.code, { title: 'Общий пикник', goal: 20 }));
  assert.equal(pot.status, 200);
  const potsB = await srv.api('/api/pot', H(db.childB1.code));
  assert.ok((potsB.body || []).some((p) => p.title === 'Общий пикник'), 'друг видит котёл');
  const put = await srv.api('/api/pot/contribute', P(db.childB1.code, { id: pot.body.id, amount: 5 }));
  assert.equal(put.status, 200, put.body.error);
  assert.equal(put.body.collected, 5);

  const g = await srv.api('/api/guild/create', P(db.childA1.code, { name: 'Белки' }));
  assert.equal(g.status, 200);
  const listB = await srv.api('/api/guilds', H(db.childB1.code));
  assert.ok((listB.body || []).some((x) => x.name === 'Белки'), 'друг видит гильдию');
  const join = await srv.api('/api/guild/join', P(db.childB1.code, { id: g.body.id }));
  assert.equal(join.status, 200, join.body.error);

  await srv.api('/api/proposals', P(db.childA1.code, { title: 'Устроить лесной пикник' }));
  const props = await srv.api('/api/proposals', H(db.childB1.code));
  const guest = (props.body || []).find((p) => p.title === 'Устроить лесной пикник');
  assert.ok(guest);
  assert.equal(guest.guest, true);

  const life = await srv.api('/api/grove-life', H(db.childB1.code));
  assert.ok(life.body.pots.some((p) => p.title === 'Общий пикник'));
  assert.ok(life.body.guilds.some((x) => x.name === 'Белки'));
  assert.ok(life.body.proposals.some((p) => p.title.includes('пикник')));
});

test('чужой котёл без дружбы не виден', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const pot = await srv.api('/api/pot/create', P(db.childA1.code, { title: 'Только свои', goal: 10 }));
  assert.equal(pot.status, 200);
  const potsB = await srv.api('/api/pot', H(db.childB1.code));
  assert.ok(!(potsB.body || []).some((p) => p.title === 'Только свои'));
  const put = await srv.api('/api/pot/contribute', P(db.childB1.code, { id: pot.body.id, amount: 5 }));
  assert.equal(put.status, 400);
});
