// Тестовый контур: свежая локальная БД shishka_test + инстанс сервера на свободном порту.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// pg установлен только в client/node_modules — резолвим require относительно client/,
// без symlink node_modules в корне репозитория (ломался на свежем клоне)
const require = createRequire(join(ROOT, 'client/'));
const pg = require('pg');
const DB = 'shishka_test';
const pgUser = process.env.PGUSER || process.env.USER;
// sslmode=disable: сервер жёстко включает ssl-опцию (для прод-Supabase) — для локального postgres её нужно погасить строкой подключения
export const url = `postgres://${pgUser}@localhost:5432/${DB}?sslmode=disable`;

export async function setupDb() {
  await run('dropdb', ['--if-exists', DB]);
  await run('createdb', [DB]);
  // Supabase-специфика: схема auth и заглушка auth.uid() — их зовут функции из functions.sql
  await run('psql', ['-q', '-d', DB, '-c',
    'create schema if not exists auth; create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;']);
  await run('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', join(ROOT, 'db/schema.sql')]);
  // functions.sql ссылается на колонки/таблицы из более поздних миграций — без заглушек CREATE FUNCTION падает
  await run('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-c', `
    alter table transactions add column if not exists is_anonymous boolean not null default false;
    alter table transactions add column if not exists revealed boolean not null default false;
    alter table users add column if not exists last_seen timestamptz;
    create table if not exists mini_games (
      child_id uuid not null references users(id) on delete cascade,
      game text not null, level int not null default 1, score int not null default 0,
      streak int not null default 0, last_played date, primary key (child_id, game));
    create table if not exists guild_history (
      id uuid primary key default gen_random_uuid(),
      guild_id uuid not null references guilds(id) on delete cascade,
      kind text not null, title text not null, amount int,
      created_at timestamptz not null default now());
    create or replace function achievement_metric_legacy(p_child uuid, p_metric text)
    returns int language sql stable as $$ select 0 $$;
    create table if not exists friendships (
      user_id uuid not null references users(id) on delete cascade,
      friend_id uuid not null references users(id) on delete cascade,
      status text not null check (status in ('pending','accepted')),
      created_at timestamptz not null default now(),
      primary key (user_id, friend_id), check (user_id <> friend_id));
    create table if not exists familiars (
      user_id uuid not null references users(id) on delete cascade,
      type_id uuid, grade int not null default 1, slot int not null default 1,
      primary key (user_id, slot));
    create table if not exists familiar_phrases (category text, phrase text);
    create table if not exists child_guardians (
      child_id uuid not null references users(id) on delete cascade,
      guardian_id uuid not null references users(id) on delete cascade,
      primary key (child_id, guardian_id));
  `]);
  // cards.sql — часть прод-схемы (карты, лор, рынок, аукцион): /api/state читает familiar_* из неё
  for (const f of ['db/functions.sql', 'db/migration_auth.sql', 'db/cards.sql',
                     'db/migration_referrals.sql', 'db/migration_referral_levels.sql',
                     'db/migration_referral_l3.sql',                      'db/migration_friendships.sql',
                     'db/migration_reactions.sql', 'db/migration_cross_circle_friends.sql',
                     'db/migration_friend_cards.sql'])
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
      await q('update users set referral_code=$1 where id=$2', [`REF${key}${i}`, u.id]);
      ids[`child${key}${i}`] = { id: u.id, code: `${key}${i}-01`, ref: `REF${key}${i}` };
    }
  }
  await q(`
    insert into friendships(user_id, friend_id, status)
    select a.id, b.id, 'accepted'
      from users a
      join users b on b.circle_id = a.circle_id and b.role = 'child' and b.id <> a.id
     where a.role = 'child'
    on conflict do nothing`);
  await pool.end();
  return { url, ...ids };
}

export function startServer(dbUrl, env = {}) {
  const port = 3800 + Number(process.hrtime.bigint() % 100n);
  const proc = spawn(process.execPath, [join(ROOT, 'client', 'server-pg.mjs')], {
    env: { PARENT_PIN: 'testpin', ...process.env, ...env, DATABASE_URL: dbUrl, PORT: String(port) },
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
