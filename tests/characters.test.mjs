import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupDb, startServer } from './helpers/db.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(join(ROOT, 'client/'))('pg');
const openPool = (url) => { const p = new pg.Pool({ connectionString: url }); return { q: (s, a = []) => p.query(s, a).then((r) => r.rows), end: () => p.end() }; };

const H = (code) => ({ headers: { 'x-child-code': code, 'content-type': 'application/json' } });
const P = (code, body) => ({ method: 'POST', ...H(code), body: JSON.stringify(body || {}) });

test('обитатели поляны: 28 штук, латиница в sku, не карты пака', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  const list = await srv.api('/api/characters', H(db.childA1.code));
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 28);
  const names = list.body.map((c) => c.title);
  for (const n of ['Журавль', 'Цапля', 'Утка', 'Гусь', 'Лебедь', 'Трясогузка', 'Морошка', 'Клюква',
    'Можжевельник', 'Корюшка', 'Судак', 'Форель', 'Сокол', 'Голубь', 'Зяблик', 'Тетерев',
    'Куропатка', 'Вальдшнеп', 'Кулик', 'Подберёзовик', 'Опёнок', 'Сыроежка', 'Ласточка',
    'Скворец', 'Воробей', 'Чомга', 'Чайка', 'Ястреб']) {
    assert.ok(names.includes(n), n);
  }
  for (const c of list.body) {
    assert.match(c.sku, /^[a-z_]+$/);
    assert.equal(c.rub, undefined);
    assert.equal(c.rubles, undefined);
    const asCard = await pp.q('select 1 from card_types where code=$1', [c.sku]);
    assert.equal(asCard.length, 0, c.sku + ' не должен быть в паке');
  }
});

test('купить за шишки, надеть, без покупки нельзя', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  await pp.q('update wallets set balance=80 where user_id=$1', [db.childA1.id]);
  const list = await srv.api('/api/characters', H(db.childA1.code));
  const duck = list.body.find((c) => c.sku === 'utka');
  assert.ok(duck);
  const before = (await srv.api('/api/state', H(db.childA1.code))).body.balance;
  const sneak = await srv.api('/api/character/equip', P(db.childA1.code, { id: duck.id }));
  assert.equal(sneak.status, 400);

  const buy = await srv.api('/api/character/buy', P(db.childA1.code, { id: duck.id }));
  assert.equal(buy.status, 200);
  assert.equal(buy.body.balance, before - duck.price);

  const again = await srv.api('/api/character/buy', P(db.childA1.code, { id: duck.id }));
  assert.equal(again.status, 400);

  const wear = await srv.api('/api/character/equip', P(db.childA1.code, { id: duck.id }));
  assert.equal(wear.status, 200);
  const st = await srv.api('/api/state', H(db.childA1.code));
  assert.equal(st.body.grove.sku, 'utka');
  assert.equal(st.body.grove.name, 'Утка');
});

test('воробей открывается за собранное существо, без списания шишек', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  const type = (await pp.q("select id from card_types where code='lisa'"))[0].id;
  for (let g = 1; g <= 6; g++) {
    await pp.q(
      'insert into user_cards(user_id, type_id, grade, qty) values ($1,$2,$3,1)',
      [db.childA1.id, type, g]);
  }
  const before = (await srv.api('/api/state', H(db.childA1.code))).body.balance;
  const list = await srv.api('/api/characters', H(db.childA1.code));
  const bird = list.body.find((c) => c.sku === 'vorobey');
  assert.equal(bird.owned, true);
  assert.equal(bird.album, true);
  const after = (await srv.api('/api/state', H(db.childA1.code))).body.balance;
  assert.equal(after, before);
});
