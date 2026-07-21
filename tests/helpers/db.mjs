// Тестовый контур: свежая локальная БД shishka_test + инстанс сервера на свободном порту.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = 'shishka_test';
// sslmode=disable: сервер жёстко включает ssl-опцию (для прод-Supabase) — для локального postgres её нужно погасить строкой подключения
export const url = `postgres://${process.env.USER}@localhost:5432/${DB}?sslmode=disable`;

export async function setupDb() {
  await run('dropdb', ['--if-exists', DB]);
  await run('createdb', [DB]);
  // Supabase-специфика: схема auth и заглушка auth.uid() — их зовут функции из functions.sql
  await run('psql', ['-q', '-d', DB, '-c',
    'create schema if not exists auth; create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;']);
  for (const f of ['db/schema.sql', 'db/functions.sql', 'db/cards.sql'])
    await run('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', join(ROOT, f)]);
  // child_logins не входит в schema.sql — в проде её создаёт db/seed.sql (см. server-pg.mjs: авторизация ребёнка по коду из этой таблицы)
  await run('psql', ['-q', '-d', DB, '-c',
    "create table if not exists child_logins (code text primary key, child_id uuid not null references users(id) on delete cascade);"]);

  const pool = new pg.Pool({ connectionString: url });
  const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows);
  const ids = {};
  for (const [key, name, code] of [['A', 'Круг А', 'DEMOA'], ['B', 'Круг Б', 'DEMOB']]) {
    const [c] = await q('insert into circles(name, invite_code) values ($1,$2) returning id', [name, code]);
    ids['circle' + key] = c.id;
    for (let i = 1; i <= 2; i++) {
      const [u] = await q("insert into users(circle_id, role, name) values ($1,'child',$2) returning id", [c.id, `Ребёнок ${key}${i}`]);
      await q('insert into wallets(user_id, balance) values ($1, 30)', [u.id]);
      await q('insert into child_logins(code, child_id) values ($1,$2)', [`${key}${i}-01`, u.id]);
      ids[`child${key}${i}`] = { id: u.id, code: `${key}${i}-01` };
    }
  }
  await pool.end();
  return { url, ...ids };
}

export function startServer(dbUrl, env = {}) {
  const port = 3800 + Number(process.hrtime.bigint() % 100n);
  const proc = spawn(process.execPath, [join(ROOT, 'client', 'server-pg.mjs')], {
    env: { ...process.env, ...env, DATABASE_URL: dbUrl, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error('сервер не поднялся за 10с')), 10000);
    proc.stdout.on('data', (d) => { if (String(d).includes('http://')) { clearTimeout(timer); ok(); } });
    proc.stderr.on('data', (d) => { clearTimeout(timer); bad(new Error(String(d))); });
  });
  return ready.then(() => ({
    port,
    api: (path, opts = {}) => fetch(`http://127.0.0.1:${port}${path}`, opts).then((r) => r.json().then((j) => ({ status: r.status, body: j }))),
    stop: () => proc.kill(),
  }));
}
