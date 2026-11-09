import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pg = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'client/'))('pg');
const H = (code) => ({ headers: { 'x-child-code': code, 'content-type': 'application/json' } });
const P = (code, body) => ({ method: 'POST', ...H(code), body: JSON.stringify(body || {}) });

test('дубль селится собирать: 1🌰 в день, ранг не растёт', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pool = new pg.Pool({ connectionString: db.url });
  t.after(async () => { srv.stop(); await pool.end(); });

  const kid = db.childA1.id;
  const type = (await pool.query("select id from card_types where code='lisa'")).rows[0].id;
  await pool.query(
    `insert into user_cards(user_id,type_id,grade,qty) values ($1,$2,2,1)`, [kid, type]);

  const lonely = await srv.api('/api/gather/train', P(db.childA1.code, { type, grade: 2 }));
  assert.equal(lonely.status, 400);
  assert.match(lonely.body.error, /дубль/);

  await pool.query('update user_cards set qty=2 where user_id=$1 and type_id=$2 and grade=2', [kid, type]);
  const train = await srv.api('/api/gather/train', P(db.childA1.code, { type, grade: 2 }));
  assert.equal(train.status, 200, train.body.error);

  const left = (await pool.query(
    'select qty from user_cards where user_id=$1 and type_id=$2 and grade=2', [kid, type])).rows[0];
  assert.equal(left.qty, 1, 'карта осталась в альбоме');

  const again = await srv.api('/api/gather/train', P(db.childA1.code, { type, grade: 2 }));
  assert.equal(again.status, 400);

  const before = (await srv.api('/api/state', H(db.childA1.code))).body.balance;
  const claim = await srv.api('/api/gather/claim', P(db.childA1.code, {}));
  assert.equal(claim.status, 200);
  assert.equal(claim.body.gained, 1);
  assert.equal(claim.body.balance, before + 1);

  const twice = await srv.api('/api/gather/claim', P(db.childA1.code, {}));
  assert.equal(twice.body.gained, 0);
  assert.equal((await srv.api('/api/state', H(db.childA1.code))).body.balance, before + 1);

  const list = await srv.api('/api/gather', H(db.childA1.code));
  assert.equal(list.body.gatherers.length, 1);
  assert.equal(list.body.gatherers[0].grade, 2);
  assert.equal(list.body.ready, 0);

  const album = await srv.api('/api/album', H(db.childA1.code));
  assert.ok((album.body || []).some((e) => e.kind === 'earn' && /Сбор с карт/.test(e.title)));
});
