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
const bal = async (srv, code) => (await srv.api('/api/state', { headers: { 'x-child-code': code } })).body.balance;

test('кириллический код дерева привязывает ребёнка', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  await pp.q('update child_logins set code=$1 where child_id=$2', ['ТАЯ-01', db.childA1.id]);
  const link = await srv.api('/api/guardian/link', P(db.childA2.code, { code: 'тая-01' }));
  assert.equal(link.status, 200);
  assert.equal(link.body.name, 'Ребёнок A1');

  const dash = await srv.api('/api/guardian/link', P(db.childB1.code, { code: 'ТАЯ\u201301' }));
  assert.equal(dash.status, 200);
  assert.equal(dash.body.name, 'Ребёнок A1');
});

test('родитель привязывает ребёнка по коду и выдаёт семейное дело', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const self = await srv.api('/api/guardian/link', P(db.childA2.code, { code: db.childA2.code }));
  assert.equal(self.status, 400);
  assert.match(self.body.error, /себя/);

  const link = await srv.api('/api/guardian/link', P(db.childA2.code, { code: db.childA1.code }));
  assert.equal(link.status, 200);
  assert.equal(link.body.name, 'Ребёнок A1');

  const home = await srv.api('/api/guardian/family', H(db.childA2.code));
  assert.equal(home.status, 200);
  assert.equal(home.body.kids.length, 1);
  assert.equal(home.body.kids[0].hanging, 0);

  const big = await srv.api('/api/guardian/task', P(db.childA2.code, {
    childId: db.childA1.id, title: 'Помыть чашку', reward: 99,
  }));
  assert.equal(big.status, 400);
  assert.match(big.body.error, /не больше 15/);

  const alien = await srv.api('/api/guardian/task', P(db.childB1.code, {
    childId: db.childA1.id, title: 'Чужое', reward: 5,
  }));
  assert.equal(alien.status, 403);

  const ok = await srv.api('/api/guardian/task', P(db.childA2.code, {
    childId: db.childA1.id, title: 'Помыть чашку', reward: 8,
  }));
  assert.equal(ok.status, 200);

  const tasks = await srv.api('/api/tasks', H(db.childA1.code));
  const family = (tasks.body || []).filter((x) => x.kind === 'family' && x.title === 'Помыть чашку');
  assert.equal(family.length, 1);
  assert.equal(family[0].reward, 8);
});

test('не больше 5 своих дел; каталог заполняет форму; ведущий очередь не видит', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pp = openPool(db.url);
  t.after(async () => { srv.stop(); await pp.end(); });

  await srv.api('/api/guardian/link', P(db.childA2.code, { code: db.childA1.code }));
  for (let i = 1; i <= 5; i++) {
    const r = await srv.api('/api/guardian/task', P(db.childA2.code, {
      childId: db.childA1.id, title: `Дело ${i}`, reward: 5,
    }));
    assert.equal(r.status, 200, `дело ${i}`);
  }
  const sixth = await srv.api('/api/guardian/task', P(db.childA2.code, {
    childId: db.childA1.id, title: 'Дело 6', reward: 5,
  }));
  assert.equal(sixth.status, 400);
  assert.match(sixth.body.error, /не больше 5/);

  const [tpl] = await pp.q(
    "insert into task_templates(title,reward,category,needs_photo) values('Протереть полку',12,'дом',false) returning id");
  await srv.api('/api/guardian/unlink', P(db.childA2.code, { childId: db.childA1.id }));
  await srv.api('/api/guardian/link', P(db.childB1.code, { code: db.childA1.code }));
  const fromTpl = await srv.api('/api/guardian/task', P(db.childB1.code, {
    childId: db.childA1.id, templateId: tpl.id,
  }));
  assert.equal(fromTpl.status, 200);
  assert.equal(fromTpl.body.title, 'Протереть полку');
  assert.equal(fromTpl.body.reward, 12);

  await pp.q(
    `insert into tasks(circle_id,child_id,title,reward,status,kind)
     values($1,$2,'Семейное на проверке',7,'pending_review','family')`,
    [db.circleA, db.childA1.id]);
  const host = await srv.api('/api/parent/pending', { headers: { 'x-parent-pin': 'testpin' } });
  assert.equal(host.status, 200);
  assert.ok(!(host.body || []).some((x) => x.title === 'Семейное на проверке'));
});

test('ребёнок сдаёт семейное дело — шишки после одобрения родителя', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  await srv.api('/api/guardian/link', P(db.childA2.code, { code: db.childA1.code }));
  await srv.api('/api/guardian/task', P(db.childA2.code, {
    childId: db.childA1.id, title: 'Сложить одежду', reward: 10,
  }));
  const list = await srv.api('/api/tasks', H(db.childA1.code));
  const task = (list.body || []).find((x) => x.title === 'Сложить одежду');
  assert.ok(task);

  const before = await bal(srv, db.childA1.code);
  const done = await srv.api('/api/task/done', P(db.childA1.code, { id: task.id }));
  assert.equal(done.status, 200);
  assert.equal(done.body.approved, false);
  assert.equal(await bal(srv, db.childA1.code), before);

  const spy = await srv.api('/api/guardian/approve', P(db.childB1.code, { id: task.id }));
  assert.equal(spy.status, 400);

  const appr = await srv.api('/api/guardian/approve', P(db.childA2.code, { id: task.id }));
  assert.equal(appr.status, 200);
  assert.equal(await bal(srv, db.childA1.code), before + 10);
});
