// T24: 8+1 лесных дел, приветственные 30 шишек, задание дня без фото не ждёт ведущего.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupDb, startServer } from './helpers/db.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(join(ROOT, 'client/'))('pg');
const openPool = (url) => {
  const p = new pg.Pool({ connectionString: url });
  return { q: (s, a = []) => p.query(s, a).then((r) => r.rows), one: (s, a = []) => p.query(s, a).then((r) => r.rows[0] || null), end: () => p.end() };
};
const H = (code) => ({ headers: { 'x-child-code': code } });
const P = (code, body) => ({
  method: 'POST',
  headers: { 'x-child-code': code, 'content-type': 'application/json' },
  body: JSON.stringify(body || {}),
});

test('на день выдаётся 8 ежедневок и одно задание дня', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const list = await srv.api('/api/tasks', H(db.childA1.code));
  assert.equal(list.status, 200);
  const daily = (list.body || []).filter((x) => x.kind === 'daily' && x.status === 'open');
  const day = (list.body || []).filter((x) => x.kind === 'day' && x.status === 'open');
  assert.equal(daily.length, 8);
  assert.equal(day.length, 1);
});

test('новый ребёнок получает 30 приветственных шишек', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  const kid = await pp.one("select * from add_child($1,'Росток','pine')", [db.circleA]);
  const w = await pp.one('select balance, total_earned from wallets where user_id=$1', [kid.id]);
  assert.equal(w.balance, 30);
  assert.equal(w.total_earned, 30);
  const tx = await pp.one(
    "select amount from transactions where to_user=$1 and message='Приветственные шишки'",
    [kid.id]);
  assert.equal(tx.amount, 30);
});

test('задание дня без фото засчитывается сразу, даже если есть ведущий', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  await pp.q("insert into users(circle_id, role, name) values($1,'parent','Ведущий А')", [db.circleA]);
  const [task] = await pp.q(
    `insert into tasks(circle_id,child_id,title,reward,status,is_daily,kind)
     values($1,$2,'День без сладкого',15,'open',true,'day') returning id`,
    [db.circleA, db.childA1.id]);

  const before = (await srv.api('/api/state', H(db.childA1.code))).body.balance;
  const done = await srv.api('/api/task/done', P(db.childA1.code, { id: task.id }));
  assert.equal(done.status, 200);
  assert.equal(done.body.approved, true);
  assert.equal((await srv.api('/api/state', H(db.childA1.code))).body.balance, before + 15);
});

test('дело ведущего без is_daily по-прежнему ждёт проверку', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  await pp.q("insert into users(circle_id, role, name) values($1,'parent','Ведущий А')", [db.circleA]);
  const [task] = await pp.q(
    "insert into tasks(circle_id,child_id,title,reward,status) values($1,$2,'Полить дерево',15,'open') returning id",
    [db.circleA, db.childA1.id]);

  const before = (await srv.api('/api/state', H(db.childA1.code))).body.balance;
  const done = await srv.api('/api/task/done', P(db.childA1.code, { id: task.id }));
  assert.equal(done.status, 200);
  assert.equal(done.body.approved, false);
  assert.equal((await srv.api('/api/state', H(db.childA1.code))).body.balance, before);
});
