// Регресс-сеть на ядровые механики основного приложения (задания, покупки, переводы, оплата).
// Данные (tasks/shop_items) сидим напрямую в БД — setupDb их не создаёт.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupDb, startServer } from './helpers/db.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(join(ROOT, 'client/'))('pg');
const openPool = (url) => { const p = new pg.Pool({ connectionString: url }); return { q: (s, a = []) => p.query(s, a).then((r) => r.rows), end: () => p.end() }; };

const H = (code) => ({ headers: { 'x-child-code': code } });
const P = (code, body) => ({ method: 'POST', headers: { 'x-child-code': code, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const PIN = (body) => ({ method: 'POST', headers: { 'x-parent-pin': 'testpin', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const bal = async (srv, code) => (await srv.api('/api/state', H(code))).body.balance;

test('задание проходит модерацию: submit не платит, approve начисляет, повторный approve отклонён', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  const [task] = await pp.q(
    "insert into tasks(circle_id,child_id,title,reward,status) values($1,$2,'Полить дерево',15,'open') returning id",
    [db.circleA, db.childA1.id]);

  const before = await bal(srv, db.childA1.code);
  const done = await srv.api('/api/task/done', P(db.childA1.code, { id: task.id }));
  assert.equal(done.status, 200);
  assert.equal(await bal(srv, db.childA1.code), before, 'до одобрения баланс не меняется');

  const appr = await srv.api('/api/parent/approve', PIN({ id: task.id }));
  assert.equal(appr.status, 200);
  assert.equal(await bal(srv, db.childA1.code), before + 15, 'после одобрения +reward');

  const again = await srv.api('/api/parent/approve', PIN({ id: task.id }));
  assert.equal(again.status, 400, 'повторное одобрение отклонено — нет двойного начисления');
});

test('нельзя одобрить чужое задание чужим PIN, но главное — approve требует PIN', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  const [task] = await pp.q(
    "insert into tasks(circle_id,child_id,title,reward,status) values($1,$2,'Задание',50,'pending_review') returning id",
    [db.circleA, db.childA1.id]);
  const noPin = await srv.api('/api/parent/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: task.id }) });
  assert.equal(noPin.status, 401, 'approve без PIN запрещён');
  assert.equal(await bal(srv, db.childA1.code), 30, 'начисления не было');
});

test('покупка списывает шишки и не даёт уйти в минус', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  const [cheap] = await pp.q("insert into shop_items(circle_id,type,title,price,is_active) values($1,'impression','Мороженое',20,true) returning id", [db.circleA]);
  const [dear] = await pp.q("insert into shop_items(circle_id,type,title,price,is_active) values($1,'impression','Самокат',1000,true) returning id", [db.circleA]);

  const buy = await srv.api('/api/shop/buy', P(db.childA1.code, { id: cheap.id }));
  assert.equal(buy.status, 200);
  assert.equal(buy.body.balance, 10, '30−20=10');

  const over = await srv.api('/api/shop/buy', P(db.childA1.code, { id: dear.id }));
  assert.equal(over.status, 400, 'нельзя купить дороже баланса');
  assert.equal(await bal(srv, db.childA1.code), 10, 'баланс не тронут при неудачной покупке');
});

test('перевод: 1:1 без потерь, себе нельзя, больше баланса нельзя', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const self = await srv.api('/api/transfer', P(db.childA1.code, { to: db.childA1.id, amount: 5 }));
  assert.equal(self.status, 400, 'себе дарить нельзя');

  const over = await srv.api('/api/transfer', P(db.childA1.code, { to: db.childA2.id, amount: 999 }));
  assert.equal(over.status, 400, 'больше баланса нельзя');

  const a0 = await bal(srv, db.childA1.code), b0 = await bal(srv, db.childA2.code);
  const ok = await srv.api('/api/transfer', P(db.childA1.code, { to: db.childA2.id, amount: 10 }));
  assert.equal(ok.status, 200);
  const a1 = await bal(srv, db.childA1.code), b1 = await bal(srv, db.childA2.code);
  assert.equal(a1, a0 - 10);
  assert.equal(b1, b0 + 10);
  assert.equal(a1 + b1, a0 + b0, 'сумма шишек сохранилась');
});

test('перевод отрицательной/нулевой суммы отклонён', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());
  for (const amount of [0, -50]) {
    const r = await srv.api('/api/transfer', P(db.childA1.code, { to: db.childA2.id, amount }));
    assert.equal(r.status, 400, `сумма ${amount} отклонена`);
  }
  assert.equal(await bal(srv, db.childA2.code), 30, 'получателю ничего не прилетело');
});

test('перевод в другой круг отклонён (изоляция семьи)', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());
  const cross = await srv.api('/api/transfer', P(db.childA1.code, { to: db.childB1.id, amount: 5 }));
  assert.equal(cross.status, 403, 'нельзя дарить в чужой круг (assertOwn → 403)');
  assert.equal(await bal(srv, db.childB1.code), 30, 'чужому ребёнку ничего не прилетело');
});

test('оплата (pay): комиссия 1 шишка сгорает — сумма у детей уменьшается ровно на комиссию', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const a0 = await bal(srv, db.childA1.code), b0 = await bal(srv, db.childA2.code);
  const pay = await srv.api('/api/pay', P(db.childA1.code, { toCode: db.childA2.code, amount: 10 }));
  assert.equal(pay.status, 200);
  const a1 = await bal(srv, db.childA1.code), b1 = await bal(srv, db.childA2.code);
  assert.equal(a1, a0 - 10, 'плательщик −amount');
  assert.equal(b1, b0 + 9, 'получатель +(amount−комиссия)');
  assert.equal(a0 + b0 - (a1 + b1), 1, 'ровно 1 шишка ушла из оборота детей (сток)');

  const self = await srv.api('/api/pay', P(db.childA1.code, { toCode: db.childA1.code, amount: 10 }));
  assert.equal(self.status, 400, 'себе платить нельзя');
  const tiny = await srv.api('/api/pay', P(db.childA1.code, { toCode: db.childA2.code, amount: 1 }));
  assert.equal(tiny.status, 400, 'сумма ≤ комиссии отклонена');
});

test('дупло: заморозка списывает, досрочно не снять, по сроку возвращает тело + проценты', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  // открыть на 3 дня (ставка 5%), 20 шишек
  const open = await srv.api('/api/safe/open', P(db.childA1.code, { amount: 20, days: 3 }));
  assert.equal(open.status, 200);
  assert.equal(open.body.balance, 10, '30−20 заморожено');

  const [safe] = await pp.q('select id, unlock_date from safes where user_id=$1', [db.childA1.id]);

  // досрочно — отказ
  const early = await srv.api('/api/safe/redeem', P(db.childA1.code, { id: safe.id }));
  assert.equal(early.status, 400, 'досрочное снятие запрещено');
  assert.equal(await bal(srv, db.childA1.code), 10, 'баланс не изменился при отказе');

  // перематываем срок в прошлое и забираем
  await pp.q("update safes set unlock_date = now() - interval '1 hour' where id=$1", [safe.id]);
  const redeem = await srv.api('/api/safe/redeem', P(db.childA1.code, { id: safe.id }));
  assert.equal(redeem.status, 200);
  assert.equal(redeem.body.gained, 21, 'тело 20 + процент round(20*5%)=1');
  assert.equal(await bal(srv, db.childA1.code), 31, '10 + 21');

  // повторный redeem того же сейфа — отказ (нет двойной выплаты)
  const twice = await srv.api('/api/safe/redeem', P(db.childA1.code, { id: safe.id }));
  assert.equal(twice.status, 400, 'сейф уже забран');
});

test('дупло: неверный срок отклонён', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());
  const bad = await srv.api('/api/safe/open', P(db.childA1.code, { amount: 5, days: 5 }));
  assert.equal(bad.status, 400, 'срок только 3/7/30');
  assert.equal(await bal(srv, db.childA1.code), 30, 'ничего не заморожено');
});
