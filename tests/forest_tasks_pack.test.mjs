// Новые лесные дела: шишки, наблюдение, сезоны — в каталоге и в дневной выдаче.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupDb } from './helpers/db.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(join(ROOT, 'client/'))('pg');
const openPool = (url) => {
  const p = new pg.Pool({ connectionString: url });
  return { q: (s, a = []) => p.query(s, a).then((r) => r.rows), end: () => p.end() };
};

const NEW_DAILY = [
  'Посчитать, на что хватит сегодняшних шишек',
  'Пять минут тихо сидеть и слушать лес',
  'Написать другу письмо в лесной почте',
  'Выпить стакан воды сразу после сна',
];
const NEW_DAY = [
  'Не тратить шишки весь день',
  'Сгрести кучку листьев',
  'Научить младшего одному делу',
];

test('новые шаблоны лежат в каталоге с нужным kind', async (t) => {
  const db = await setupDb();
  const pp = openPool(db.url);
  t.after(() => pp.end());

  const rows = await pp.q(
    'select title, kind, is_daily, needs_photo from task_templates where title = any($1)',
    [[...NEW_DAILY, ...NEW_DAY, 'Найти первый цветок или почку']]);
  assert.equal(rows.length, NEW_DAILY.length + NEW_DAY.length + 1);
  for (const title of NEW_DAILY) {
    const r = rows.find((x) => x.title === title);
    assert.equal(r.kind, 'daily');
    assert.equal(r.is_daily, true);
  }
  for (const title of NEW_DAY) {
    const r = rows.find((x) => x.title === title);
    assert.equal(r.kind, 'day');
    assert.equal(r.is_daily, false);
  }
  const spring = rows.find((x) => x.title === 'Найти первый цветок или почку');
  assert.equal(spring.kind, 'day');
  assert.equal(spring.needs_photo, true);
});

test('повтор миграции не плодит двойников', async (t) => {
  const db = await setupDb();
  const pp = openPool(db.url);
  t.after(() => pp.end());

  await pp.q(readFileSync(join(ROOT, 'db/migration_forest_tasks_pack.sql'), 'utf8'));
  const [row] = await pp.q(
    "select count(*)::int as n from task_templates where title='Не тратить шишки весь день'");
  assert.equal(row.n, 1);
});

test('новые ежедневки попадают в выдачу, если пул узкий', async (t) => {
  const db = await setupDb();
  const pp = openPool(db.url);
  t.after(() => pp.end());

  await pp.q("delete from tasks where child_id=$1", [db.childA1.id]);
  await pp.q("delete from task_templates where kind='daily' and title <> all($1)", [NEW_DAILY]);
  await pp.q('select ensure_daily_tasks($1)', [db.childA1.id]);
  const issued = await pp.q(
    "select title from tasks where child_id=$1 and kind='daily'",
    [db.childA1.id]);
  assert.equal(issued.length, NEW_DAILY.length);
  assert.deepEqual(issued.map((x) => x.title).sort(), [...NEW_DAILY].sort());
});
