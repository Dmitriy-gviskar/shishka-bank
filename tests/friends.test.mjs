// Дружба по коду с поляны: между кругами заявка → принять → чат.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupDb, startServer } from './helpers/db.mjs';

const pg = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'client/'))('pg');

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

  const byId = await srv.api('/api/friends/request', P(db.childA1.code, { to: db.childB1.id }));
  assert.equal(byId.status, 200);
  assert.equal(byId.body.status, 'pending');
  assert.equal(byId.body.name, 'Ребёнок B1');

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
  assert.ok(hubA.body.forest.some((p) => p.id === db.childB2.id), 'в хабе видны обитатели другого леса');
  assert.ok(!hubA.body.forest.some((p) => p.id === db.childB1.id), 'заявка уже ушла — не дублируем в лесу');

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

  const pool = new pg.Pool({ connectionString: db.url });
  t.after(() => pool.end());
  await pool.query(
    `insert into user_cards(user_id,type_id,grade,qty)
      select $1, id, 2, 1 from card_types where code='lisa'`,
    [db.childA1.id]);
  const lisa = (await pool.query("select id from card_types where code='lisa'")).rows[0].id;
  const peek = await srv.api('/api/friend/cards', P(db.childA1.code, { id: db.childB1.id }));
  assert.equal(peek.status, 200, peek.body?.error || 'peek');
  assert.equal(peek.body.friend.id, db.childB1.id);
  const cardGift = await srv.api('/api/card/gift', P(db.childA1.code, { to: db.childB1.id, type: lisa, grade: 2 }));
  assert.equal(cardGift.status, 200, cardGift.body?.error || 'gift');
  assert.equal(cardGift.body.ok, true);

  const board = await srv.api('/api/board', H(db.childA1.code));
  assert.equal(board.status, 200);
  assert.ok(board.body.rows.some((r) => r.id === db.childA1.id && r.mine && r.friend));
  assert.ok(board.body.rows.some((r) => r.id === db.childB1.id && r.friend));
  const stranger = board.body.rows.find((r) => r.id === db.childB2.id);
  assert.ok(stranger, 'весь лес видит и без дружбы');
  assert.equal(stranger.friend, false);
});

test('без дружбы можно писать — заявка уходит сама; дарить шишки нельзя', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pool = new pg.Pool({ connectionString: db.url });
  t.after(() => { srv.stop(); pool.end(); });
  // Как на проде сейчас: старая send_message режет чужой круг. Письмо всё равно должно пройти.
  await pool.query(`
    create or replace function send_message(p_from uuid, p_to uuid, p_type text, p_content text, p_reply_to uuid default null)
    returns messages language plpgsql security definer set search_path = public as $$
    declare m messages; c_id uuid; to_circle uuid;
    begin
      select circle_id into c_id from users where id = p_from;
      select circle_id into to_circle from users where id = p_to;
      if c_id is distinct from to_circle then
        if not exists (
          select 1 from friendships
           where user_id = p_from and friend_id = p_to and status = 'accepted'
        ) then
          raise exception 'recipient is not in your circle';
        end if;
      end if;
      insert into messages(circle_id, from_user, to_user, type, content, reply_to)
        values (c_id, p_from, p_to, p_type, p_content, p_reply_to) returning * into m;
      return m;
    end $$`);

  const msg = await srv.api('/api/message', P(db.childA1.code, { to: db.childB1.id, content: 'хай' }));
  assert.equal(msg.status, 200, msg.body?.error || JSON.stringify(msg.body));

  const chat = await srv.api('/api/chat', P(db.childB1.code, { with: db.childA1.id }));
  assert.equal(chat.status, 200);
  assert.ok(chat.body.some((m) => m.content.includes('хай') && !m.mine));

  const listA = await srv.api('/api/chat/list', P(db.childA1.code, {}));
  assert.ok(listA.body.some((c) => c.id === db.childB1.id && c.last_msg), 'письмо сразу в списке чатов');

  const hubB = await srv.api('/api/friends/hub', H(db.childB1.code));
  assert.ok(hubB.body.pending_in.some((p) => p.id === db.childA1.id), 'письмо само шлёт заявку');

  const gift = await srv.api('/api/transfer', P(db.childA1.code, { to: db.childB1.id, amount: 5 }));
  assert.equal(gift.status, 403);

  const peek = await srv.api('/api/friend/cards', P(db.childA1.code, { id: db.childB1.id }));
  assert.equal(peek.status, 403);

  const req = await srv.api('/api/friends/request', P(db.childA1.code, { code: db.childB1.code }));
  assert.equal(req.status, 200);
  assert.equal(req.body.status, 'pending');

  await srv.api('/api/friends/accept', P(db.childB1.code, { from: db.childA1.id }));
  const again = await srv.api('/api/friends/request', P(db.childA1.code, { code: db.childB1.code }));
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'accepted');
});

test('золотые торги видит весь лес, ставка без дружбы проходит', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pool = new pg.Pool({ connectionString: db.url });
  t.after(() => { srv.stop(); pool.end(); });

  await pool.query(
    `insert into user_cards(user_id,type_id,grade,qty)
      select $1, id, 6, 1 from card_types where code='sova'`,
    [db.childA1.id]);
  await pool.query('update wallets set balance=2000 where user_id=$1', [db.childB2.id]);
  const sova = (await pool.query("select id from card_types where code='sova'")).rows[0].id;
  const started = await srv.api('/api/card-auction/start', P(db.childA1.code, { type: sova, grade: 6, price: 700 }));
  assert.equal(started.status, 200, started.body?.error || 'start');

  const list = await srv.api('/api/card-auctions', H(db.childB2.code));
  assert.equal(list.status, 200);
  const live = (list.body || []).find((a) => a.seller === 'Ребёнок A1');
  assert.ok(live, 'чужой круг видит торги');

  const bid = await srv.api('/api/card-auction/bid', P(db.childB2.code, { id: live.id, amount: live.next_bid }));
  assert.equal(bid.status, 200, bid.body?.error || 'bid');
  assert.equal(bid.body.ok, true);
});

test('приглашение сразу делает друзьями', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const sign = await srv.api('/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'РостокТест', tree: 'pine', ref: db.childA1.ref, force: true }),
  });
  assert.equal(sign.status, 200, JSON.stringify(sign.body));
  assert.ok(sign.body.code);
  const friends = await srv.api('/api/friends', H(sign.body.code));
  assert.equal(friends.status, 200);
  assert.ok(friends.body.some((f) => f.id === db.childA1.id), 'зовущий сразу в друзьях');
});

test('лесная грамота собирается из породы, имени и роста', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const p = await srv.api('/api/profile', H(db.childA1.code));
  assert.equal(p.status, 200);
  assert.equal(p.body.name, 'Ребёнок A1');
  assert.equal(p.body.tree_breed, 'Сосна');
  assert.match(p.body.chronicle, /Сосна «Ребёнок A1»/);
  assert.match(p.body.chronicle, /Корни с /);
  assert.match(p.body.chronicle, /саженец/i);
  assert.match(p.body.chronicle, /паспорт ещё чистый/i);
  assert.equal(p.body.reputation.honesty, 0);
  assert.equal(p.body.reputation.generosity, 0);
});
