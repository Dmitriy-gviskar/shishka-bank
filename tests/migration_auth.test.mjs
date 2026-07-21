import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { setupDb } from './helpers/db.mjs';

const run = promisify(execFile);
// pg установлен только в client/node_modules — тот же приём, что в helpers/db.mjs
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'client/'));
const pg = require('pg');

test('миграция auth идемпотентна и заводит нужные таблицы', async () => {
  const db = await setupDb();
  // повторный прогон не должен падать
  await run('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', 'shishka_test', '-f', 'db/migration_auth.sql'], { cwd: process.cwd().replace(/\/client$/, '') });

  const pool = new pg.Pool({ connectionString: db.url });
  const tables = await pool.query(
    "select table_name from information_schema.tables where table_schema='public' and table_name in ('adults','memberships','device_tokens','link_tokens','adult_sessions')");
  assert.equal(tables.rows.length, 5);

  const kind = await pool.query("select column_name, column_default from information_schema.columns where table_name='circles' and column_name='kind'");
  assert.equal(kind.rows.length, 1);

  const circles = await pool.query('select kind from circles');
  assert.ok(circles.rows.every((r) => r.kind === 'family'));
  await pool.end();
});
