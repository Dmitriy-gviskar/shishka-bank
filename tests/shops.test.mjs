import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';

const H = (code) => ({ headers: { 'x-child-code': code, 'content-type': 'application/json' } });
const P = (code, body) => ({ method: 'POST', ...H(code), body: JSON.stringify(body || {}) });

async function mine(srv, code) {
  const r = await srv.api('/api/shops', H(code));
  return (r.body || []).find((s) => s.mine) || null;
}

test('лавка: несколько товаров, правка цены и удаление', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const created = await srv.api('/api/shop/create', P(db.childA1.code, {
    name: 'Шишки А1', lot: 'Шишка', price: 7,
  }));
  assert.equal(created.status, 200);

  const first = await mine(srv, db.childA1.code);
  assert.ok(first);
  assert.equal(first.name, 'Шишки А1');
  assert.equal(first.lots.length, 1);

  const add = await srv.api('/api/lot/add', P(db.childA1.code, { title: 'Жёлудь', price: 4 }));
  assert.equal(add.status, 200);
  const two = await mine(srv, db.childA1.code);
  assert.equal(two.lots.length, 2);

  const nut = two.lots.find((l) => l.title === 'Жёлудь');
  const edit = await srv.api('/api/lot/edit', P(db.childA1.code, { id: nut.id, title: 'Жёлудь', price: 9 }));
  assert.equal(edit.status, 200);
  const priced = (await mine(srv, db.childA1.code)).lots.find((l) => l.title === 'Жёлудь');
  assert.equal(priced.price, 9);

  const alien = await srv.api('/api/lot/edit', P(db.childA2.code, { id: nut.id, title: 'Чужое', price: 1 }));
  assert.equal(alien.status, 403);

  const rm = await srv.api('/api/lot/remove', P(db.childA1.code, { id: nut.id }));
  assert.equal(rm.status, 200);
  assert.equal((await mine(srv, db.childA1.code)).lots.length, 1);

  const renamed = await srv.api('/api/shop/rename', P(db.childA1.code, { name: 'Дупло А1' }));
  assert.equal(renamed.status, 200);
  assert.equal((await mine(srv, db.childA1.code)).name, 'Дупло А1');

  const closed = await srv.api('/api/shop/close', P(db.childA1.code, {}));
  assert.equal(closed.status, 200);
  assert.equal(await mine(srv, db.childA1.code), null);
});

test('на витрине не больше 8 товаров', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  await srv.api('/api/shop/create', P(db.childA2.code, { name: 'Лавка', lot: 'Товар 1', price: 3 }));
  for (let i = 2; i <= 8; i++) {
    const r = await srv.api('/api/lot/add', P(db.childA2.code, { title: `Товар ${i}`, price: 3 }));
    assert.equal(r.status, 200, `товар ${i}`);
  }
  const ninth = await srv.api('/api/lot/add', P(db.childA2.code, { title: 'Товар 9', price: 3 }));
  assert.equal(ninth.status, 400);
  assert.match(ninth.body.error, /не больше 8/);
});

test('сделка лавки: резерв → отдал → получил → выплата', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const bal = async (code) => (await srv.api('/api/state', H(code))).body.balance;

  await srv.api('/api/shop/create', P(db.childA1.code, { name: 'Лавка А1', lot: 'Жёлудь', price: 8 }));
  const shop = await mine(srv, db.childA1.code);
  const lot = shop.lots[0];

  const startBuyer = await bal(db.childA2.code);
  const startSeller = await bal(db.childA1.code);

  const buy = await srv.api('/api/lot/buy', P(db.childA2.code, { id: lot.id }));
  assert.equal(buy.status, 200);
  assert.ok(buy.body.order_id);
  assert.equal(await bal(db.childA2.code), startBuyer - 8);
  assert.equal(await bal(db.childA1.code), startSeller);

  const early = await srv.api('/api/order/confirm', P(db.childA2.code, { id: buy.body.order_id }));
  assert.equal(early.status, 404);
  assert.match(early.body.error, /отдать/);

  const alienHand = await srv.api('/api/order/hand', P(db.childA2.code, { id: buy.body.order_id }));
  assert.equal(alienHand.status, 404);

  const open = await srv.api('/api/orders', H(db.childA1.code));
  assert.equal(open.status, 200);
  assert.equal(open.body.length, 1);
  assert.equal(open.body[0].status, 'reserved');
  assert.equal(open.body[0].role, 'sell');

  const hand = await srv.api('/api/order/hand', P(db.childA1.code, { id: buy.body.order_id }));
  assert.equal(hand.status, 200);
  assert.equal(await bal(db.childA1.code), startSeller);

  const sellerCancel = await srv.api('/api/order/cancel', P(db.childA1.code, { id: buy.body.order_id }));
  assert.equal(sellerCancel.status, 400);
  assert.match(sellerCancel.body.error, /покупатель/);

  const got = await srv.api('/api/order/confirm', P(db.childA2.code, { id: buy.body.order_id }));
  assert.equal(got.status, 200);
  assert.equal(await bal(db.childA2.code), startBuyer - 8);
  assert.equal(await bal(db.childA1.code), startSeller + 8);

  const done = await srv.api('/api/orders', H(db.childA2.code));
  assert.equal(done.body.length, 0);

  const album = await srv.api('/api/album', H(db.childA2.code));
  const row = (album.body || []).find((e) => /Жёлудь/.test(e.title || ''));
  assert.ok(row, 'в ленте покупателя есть товар из лавки');
  assert.match(row.title, /Купил в лавке «Жёлудь»/);

  const news = await srv.api('/api/news', H(db.childA2.code));
  const feed = (news.body || []).find((e) => e.kind === 'buy' && /Жёлудь/.test(e.what || ''));
  assert.ok(feed, 'в новостях покупателя виден товар лавки');
});

test('после «Отдал» покупатель может отменить — шишки вернутся', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const bal = async (code) => (await srv.api('/api/state', H(code))).body.balance;
  await srv.api('/api/shop/create', P(db.childA2.code, { name: 'Лавка А2', lot: 'Шишка', price: 5 }));
  const lot = (await mine(srv, db.childA2.code)).lots[0];
  const start = await bal(db.childA1.code);

  const buy = await srv.api('/api/lot/buy', P(db.childA1.code, { id: lot.id }));
  await srv.api('/api/order/hand', P(db.childA2.code, { id: buy.body.order_id }));
  const cancel = await srv.api('/api/order/cancel', P(db.childA1.code, { id: buy.body.order_id }));
  assert.equal(cancel.status, 200);
  assert.equal(await bal(db.childA1.code), start);
  assert.equal((await srv.api('/api/orders', H(db.childA1.code))).body.length, 0);
});
