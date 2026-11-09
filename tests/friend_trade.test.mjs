// T29/T30: подарок (в т.ч. «Берёза»), рынок и чужой альбом — между друзьями, не только свой круг.
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

test('подарок «Берёзы» и чужой альбом работают с другом из другого леса', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pool = new pg.Pool({ connectionString: db.url });
  t.after(async () => { srv.stop(); await pool.end(); });

  await befriend(pool, db.childA1.id, db.childB1.id);
  const bereza = (await pool.query("select id from card_types where code='bereza'")).rows[0];
  assert.ok(bereza, 'карта Берёза в каталоге');
  await pool.query(
    `insert into user_cards(user_id,type_id,grade,qty) values ($1,$2,3,1)`,
    [db.childA1.id, bereza.id]);

  const friends = await srv.api('/api/friends', H(db.childA1.code));
  assert.ok(friends.body.some((f) => f.id === db.childB1.id), 'друг из другого леса в списке');

  const peek = await srv.api('/api/friend/cards', P(db.childA1.code, { id: db.childB1.id }));
  assert.equal(peek.status, 200, peek.body?.error || 'peek');
  assert.equal(peek.body.friend.id, db.childB1.id);

  const gift = await srv.api('/api/card/gift', P(db.childA1.code, {
    to: db.childB1.id, type: bereza.id, grade: 3,
  }));
  assert.equal(gift.status, 200, gift.body?.error || 'gift bereza');
  assert.equal(gift.body.ok, true);

  const got = (await pool.query(
    `select qty from user_cards where user_id=$1 and type_id=$2 and grade=3`,
    [db.childB1.id, bereza.id])).rows[0];
  assert.equal(got.qty, 1);

  const mail = (await pool.query(
    `select content from messages where from_user=$1 and to_user=$2 order by created_at desc limit 1`,
    [db.childA1.id, db.childB1.id])).rows[0];
  assert.match(mail.content, /Берёза/);

  const stranger = await srv.api('/api/card/gift', P(db.childA1.code, {
    to: db.childB2.id, type: bereza.id, grade: 3,
  }));
  assert.ok(stranger.status >= 400, 'чужому без дружбы дарить нельзя');
});

test('рынок друга из другого леса виден и покупается; без дружбы — нет', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pool = new pg.Pool({ connectionString: db.url });
  t.after(async () => { srv.stop(); await pool.end(); });

  await befriend(pool, db.childA1.id, db.childB1.id);
  const lisa = (await pool.query("select id from card_types where code='lisa'")).rows[0].id;
  await pool.query(
    `insert into user_cards(user_id,type_id,grade,qty) values ($1,$2,4,1)`,
    [db.childA1.id, lisa]);
  await pool.query('update wallets set balance=200 where user_id=$1', [db.childB1.id]);
  await pool.query('update wallets set balance=200 where user_id=$1', [db.childB2.id]);

  const listed = await srv.api('/api/card/list', P(db.childA1.code, { type: lisa, grade: 4, price: 44 }));
  assert.equal(listed.status, 200, listed.body?.error || 'list');
  const lotId = listed.body.listing;

  const marketB = await srv.api('/api/market', H(db.childB1.code));
  assert.ok((marketB.body || []).some((l) => l.id === lotId), 'друг видит лот');

  const marketStranger = await srv.api('/api/market', H(db.childB2.code));
  assert.ok(!(marketStranger.body || []).some((l) => l.id === lotId), 'чужой лот без дружбы не виден');

  const steal = await srv.api('/api/market/buy', P(db.childB2.code, { id: lotId }));
  assert.equal(steal.status, 400);

  const buy = await srv.api('/api/market/buy', P(db.childB1.code, { id: lotId }));
  assert.equal(buy.status, 200, buy.body?.error || 'buy friend lot');
  assert.equal(buy.body.ok, true);
});
