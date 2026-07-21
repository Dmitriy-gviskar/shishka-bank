# Вход без кода и мультиарендность — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Взрослый заводит круг одним нажатием и его помнит устройство, ребёнок — по ссылке привязки, круги изолированы друг от друга; вход по коду остаётся запасным.

**Architecture:** Логика авторизации выносится из разросшегося `client/server-pg.mjs` (648 строк) в модуль `client/lib/auth.mjs` (контекст запроса, токены устройств, ключи взрослых). Внешних провайдеров входа нет: и взрослый, и ребёнок опознаются по токену-ссылке, устройство помнит его само. Сервер получает единый резолв `{child, circle, role}` и фильтрует родительский контур по кругу. Хранилище — те же `circles/users/child_logins` плюс три новые таблицы.

**Tech Stack:** Node 18+ (на проде 18.19, локально 24), `pg`, встроенный `node:test` + `node:crypto`, PostgreSQL 16 (локально brew `postgresql@16`, на проде `shishka_prod`), ванильный JS на клиенте без сборки.

## Global Constraints

- Деньги игры — целые (`integer`), без дробей. Новый код это не меняет.
- Миграции только additive: `create table if not exists`, `alter table … add column if not exists`, `create or replace function`. Ничего не удалять и не переименовывать — образец стиля `db/cards.sql`.
- Вход по коду (`x-child-code` + `child_logins`) продолжает работать до конца всех задач. Ни одна задача его не ломает.
- Токены в БД хранятся только как SHA-256 хэш. Сырой токен существует лишь в ответе API и в localStorage/URL.
- Никаких новых npm-зависимостей и внешних сервисов: только `pg` (уже стоит) и встроенные модули Node. Telegram — задел на будущее (колонка `adults.tg_id` заводится сразу), в этот план не входит.
- Русский язык во всех текстах интерфейса и сообщениях об ошибках, без эмодзи в коде сообщений сервера.
- Прод не трогаем ни на одном шаге: вся разработка и тесты на локальной БД `shishka_test`. Деплой и рестарт `shishka.service` — отдельно, только по явному «да» Дмитрия.
- Прод-БД называется `shishka_prod`, connection-string брать из systemd-юнита (`systemctl show shishka -p Environment --value`), НЕ из `/root/shishka-local-db.env` (там стоячая копия).

---

### Task 1: Тестовый контур на локальной БД

**Files:**
- Create: `tests/helpers/db.mjs`
- Create: `tests/smoke.test.mjs`
- Modify: `client/package.json` (скрипт `test`)

**Interfaces:**
- Produces: `setupDb()` → `{ url, circleA, circleB, childA1, childA2, childB1 }` — пересоздаёт базу `shishka_test`, наливает `db/schema.sql`, `db/functions.sql`, `db/cards.sql`, создаёт два круга с детьми и кодами входа. `url` — connection string для `DATABASE_URL`. `startServer(url)` → `{ port, stop() }` — поднимает `client/server-pg.mjs` на свободном порту с этой базой.

- [ ] **Step 1: Написать хелпер**

Создать `tests/helpers/db.mjs`:

```js
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
export const url = `postgres://${process.env.USER}@localhost:5432/${DB}`;

export async function setupDb() {
  await run('dropdb', ['--if-exists', DB]);
  await run('createdb', [DB]);
  // Supabase-специфика: схема auth и заглушка auth.uid() — их зовут функции из functions.sql
  await run('psql', ['-q', '-d', DB, '-c',
    'create schema if not exists auth; create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;']);
  for (const f of ['db/schema.sql', 'db/functions.sql', 'db/cards.sql'])
    await run('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', join(ROOT, f)]);

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
  const port = 3800 + Math.floor(process.hrtime.bigint() % 100n);
  const proc = spawn(process.execPath, [join(ROOT, 'client', 'server-pg.mjs')], {
    env: { ...process.env, ...env, DATABASE_URL: dbUrl, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = new Promise((ok, bad) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('http://')) ok(); });
    proc.stderr.on('data', (d) => bad(new Error(String(d))));
    setTimeout(() => bad(new Error('сервер не поднялся за 10с')), 10000);
  });
  return ready.then(() => ({
    port,
    api: (path, opts = {}) => fetch(`http://127.0.0.1:${port}${path}`, opts).then((r) => r.json().then((j) => ({ status: r.status, body: j }))),
    stop: () => proc.kill(),
  }));
}
```

- [ ] **Step 2: Дать серверу читать PORT из окружения**

В `client/server-pg.mjs` последняя строка сейчас `}).listen(3777, () => console.log('Шишка Банк (Supabase) → http://localhost:3777'));`. Заменить на:

```js
}).listen(Number(process.env.PORT) || 3777, function () {
  console.log('Шишка Банк → http://localhost:' + this.address().port);
});
```

- [ ] **Step 3: Написать смоук-тест**

Создать `tests/smoke.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer } from './helpers/db.mjs';

test('код ребёнка отдаёт его состояние, чужой код — 401', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const ok = await srv.api('/api/state', { headers: { 'x-child-code': db.childA1.code } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.balance, 30);

  const bad = await srv.api('/api/state', { headers: { 'x-child-code': 'НЕТ-99' } });
  assert.equal(bad.status, 401);
});
```

- [ ] **Step 4: Прописать команду тестов**

В `client/package.json` заменить блок `"scripts"` на:

```json
  "scripts": {
    "test": "node --test ../tests/"
  },
```

- [ ] **Step 5: Запустить тесты**

Run: `cd ~/Desktop/shishka-bank/client && npm test`
Expected: PASS, 1 тест. Если `psql`/`createdb` не найдены — добавить в PATH `/opt/homebrew/opt/postgresql@16/bin`.

- [ ] **Step 6: Коммит**

```bash
cd ~/Desktop/shishka-bank
git add tests client/package.json client/server-pg.mjs
git commit -m "test(контур): локальная БД shishka_test + запуск сервера на свободном порту"
```

---

### Task 2: Миграция таблиц авторизации

**Files:**
- Create: `db/migration_auth.sql`
- Modify: `tests/helpers/db.mjs` (наливать миграцию в тестовую базу)
- Test: `tests/migration_auth.test.mjs`

**Interfaces:**
- Produces: таблицы `adults(id, tg_id, name, created_at)`, `memberships(adult_id, circle_id, role)`, `device_tokens(id, token_hash, child_id, circle_id, created_at, last_seen_at, revoked_at)`, `link_tokens(token_hash, child_id, circle_id, expires_at, used_at)`, `adult_sessions(token_hash, adult_id, created_at)`, колонка `circles.kind` (`family`|`camp`, default `family`).

- [ ] **Step 1: Написать тест на схему**

Создать `tests/migration_auth.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { setupDb } from './helpers/db.mjs';

const run = promisify(execFile);

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
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `cd ~/Desktop/shishka-bank/client && npm test -- --test-name-pattern="миграция auth"`
Expected: FAIL — файла `db/migration_auth.sql` нет.

- [ ] **Step 3: Написать миграцию**

Создать `db/migration_auth.sql`:

```sql
-- Шишка Банк — авторизация и мультиарендность. Идемпотентно (см. db/cards.sql).
-- Взрослый = субъект с постоянным ключом доступа (tg_id — задел под Telegram); ребёнок входит по токену устройства.

alter table circles add column if not exists kind text not null default 'family';
do $$ begin
  alter table circles add constraint circles_kind_check check (kind in ('family','camp'));
exception when duplicate_object then null; end $$;

-- Взрослый (родитель или ведущий). PIN больше не нужен.
create table if not exists adults (
  id         uuid primary key default gen_random_uuid(),
  tg_id      bigint unique,
  name       text not null default 'Хранитель',
  created_at timestamptz not null default now()
);

-- Кто каким кругом управляет. Один взрослый может вести семью и лагерь.
create table if not exists memberships (
  adult_id  uuid not null references adults(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  role      text not null default 'owner' check (role in ('owner','leader')),
  primary key (adult_id, circle_id)
);

-- Долгоживущий токен устройства ребёнка (в БД только хэш).
create table if not exists device_tokens (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  child_id     uuid not null references users(id) on delete cascade,
  circle_id    uuid not null references circles(id) on delete cascade,
  label        text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists device_tokens_child_idx on device_tokens(child_id);

-- Одноразовая ссылка привязки устройства: живёт 15 минут, сгорает при обмене.
create table if not exists link_tokens (
  token_hash text primary key,
  child_id   uuid not null references users(id) on delete cascade,
  circle_id  uuid not null references circles(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- Сессия взрослого (кука). Хранится хэш.
create table if not exists adult_sessions (
  token_hash text primary key,
  adult_id   uuid not null references adults(id) on delete cascade,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 4: Наливать миграцию в тестовую базу**

В `tests/helpers/db.mjs` в цикле заливки заменить строку

```js
  for (const f of ['db/schema.sql', 'db/functions.sql', 'db/cards.sql'])
```

на

```js
  for (const f of ['db/schema.sql', 'db/functions.sql', 'db/cards.sql', 'db/migration_auth.sql'])
```

- [ ] **Step 5: Запустить тесты**

Run: `cd ~/Desktop/shishka-bank/client && npm test`
Expected: PASS, 2 теста.

- [ ] **Step 6: Коммит**

```bash
cd ~/Desktop/shishka-bank
git add db/migration_auth.sql tests
git commit -m "feat(бд): таблицы взрослых, членств, токенов устройств и сессий"
```

---

### Task 3: Модуль контекста запроса

**Files:**
- Create: `client/lib/auth.mjs`
- Modify: `client/server-pg.mjs:598-630` (блок резолва в `createServer`)
- Test: `tests/context.test.mjs`

**Interfaces:**
- Consumes: таблицы из Task 2.
- Produces: `makeAuth(q, one)` → объект с методами:
  - `resolve(req)` → `Promise<{child?, circle?, adult?, role?}>` — разбирает `x-device-token`, `x-child-code`, куку `sb_session`;
  - `hash(raw)` → `string` (SHA-256 hex);
  - `newToken()` → `string` (48 hex-символов);
  - `readCookie(req, name)` → `string | null`.

- [ ] **Step 1: Написать тест**

Создать `tests/context.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupDb, startServer } from './helpers/db.mjs';
import { makeAuth } from '../client/lib/auth.mjs';

test('resolve отдаёт ребёнка по токену устройства и по коду, отозванный токен не пускает', async () => {
  const db = await setupDb();
  const pool = new pg.Pool({ connectionString: db.url });
  const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows);
  const one = (sql, p = []) => q(sql, p).then((r) => r[0] || null);
  const auth = makeAuth(q, one);

  const raw = auth.newToken();
  await q('insert into device_tokens(token_hash, child_id, circle_id) values ($1,$2,$3)',
    [auth.hash(raw), db.childA1.id, db.circleA]);

  const byToken = await auth.resolve({ headers: { 'x-device-token': raw } });
  assert.equal(byToken.child, db.childA1.id);
  assert.equal(byToken.circle, db.circleA);
  assert.equal(byToken.role, 'child');

  const byCode = await auth.resolve({ headers: { 'x-child-code': encodeURIComponent(db.childA1.code) } });
  assert.equal(byCode.child, db.childA1.id);

  await q('update device_tokens set revoked_at=now() where token_hash=$1', [auth.hash(raw)]);
  const revoked = await auth.resolve({ headers: { 'x-device-token': raw } });
  assert.equal(revoked.child, undefined);
  await pool.end();
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd ~/Desktop/shishka-bank/client && npm test -- --test-name-pattern="resolve отдаёт"`
Expected: FAIL — модуля `client/lib/auth.mjs` нет.

- [ ] **Step 3: Написать модуль**

Создать `client/lib/auth.mjs`:

```js
// Авторизация Шишка Банк: контекст запроса, токены устройств, сессии взрослых.
// В БД хранятся только хэши токенов; сырой токен живёт у клиента.
import { createHash, randomBytes } from 'node:crypto';

const CTX_TTL = 5 * 60e3;   // код/токен → ребёнок меняется редко

export function makeAuth(q, one) {
  const cache = new Map();
  const hash = (raw) => createHash('sha256').update(String(raw)).digest('hex');
  const newToken = () => randomBytes(24).toString('hex');

  const readCookie = (req, name) => {
    const raw = req.headers?.cookie;
    if (!raw) return null;
    for (const part of raw.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  };

  const cached = async (key, load) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < CTX_TTL) return hit.v;
    const v = await load();
    if (v) cache.set(key, { v, t: Date.now() });
    return v;
  };

  async function resolve(req) {
    const h = req.headers || {};

    const dt = h['x-device-token'];
    if (dt) {
      const ctx = await cached('d:' + dt, async () => {
        const r = await one(
          `select d.child_id child, d.circle_id circle from device_tokens d
             where d.token_hash=$1 and d.revoked_at is null`, [hash(dt)]);
        return r ? { child: r.child, circle: r.circle, role: 'child' } : null;
      });
      if (ctx) {
        q('update device_tokens set last_seen_at=now() where token_hash=$1', [hash(dt)]).catch(() => {});
        return ctx;
      }
    }

    const cc = h['x-child-code'];
    if (cc) {
      const code = decodeURIComponent(cc);
      const ctx = await cached('c:' + code, async () => {
        const r = await one(
          `select u.id child, u.circle_id circle from child_logins cl
             join users u on u.id=cl.child_id where cl.code=$1`, [code]);
        return r ? { child: r.child, circle: r.circle, role: 'child' } : null;
      });
      if (ctx) return ctx;
    }

    const sess = readCookie(req, 'sb_session');
    if (sess) {
      const ctx = await cached('s:' + sess, async () => {
        const r = await one(
          `select s.adult_id adult, m.circle_id circle, m.role from adult_sessions s
             left join memberships m on m.adult_id=s.adult_id
            where s.token_hash=$1 order by m.role limit 1`, [hash(sess)]);
        return r ? { adult: r.adult, circle: r.circle, role: r.role || 'owner' } : null;
      });
      if (ctx) return ctx;
    }

    return {};
  }

  const dropCache = () => cache.clear();
  return { resolve, hash, newToken, readCookie, dropCache };
}
```

- [ ] **Step 4: Подключить модуль в сервере**

В `client/server-pg.mjs` после строки с `import pg from 'pg';` добавить:

```js
import { makeAuth } from './lib/auth.mjs';
```

и после объявлений `q`/`one`/`rpc` добавить:

```js
const auth = makeAuth(q, one);
```

Затем в `createServer` заменить весь блок резолва (от комментария `// резолв активного ребёнка по коду` до строки `}` перед комментарием `// детские endpoint'ы требуют валидный код`) на:

```js
      const ctx = await auth.resolve(req);
```

Старые `ctxCache`/`CTX_TTL` в `server-pg.mjs` удалить — кэш теперь внутри модуля. Проверить, что нигде больше нет ссылок: `grep -n "ctxCache" client/server-pg.mjs` должен быть пуст (там, где кэш сбрасывался в `add-child`, вызывать `auth.dropCache()`).

- [ ] **Step 5: Запустить все тесты**

Run: `cd ~/Desktop/shishka-bank/client && npm test`
Expected: PASS, 3 теста — смоук (вход по коду) по-прежнему зелёный.

- [ ] **Step 6: Коммит**

```bash
cd ~/Desktop/shishka-bank
git add client/lib/auth.mjs client/server-pg.mjs tests
git commit -m "feat(вход): единый резолв контекста — токен устройства, код, сессия взрослого"
```

---

### Task 4: Изоляция кругов в родительском контуре

**Files:**
- Modify: `client/server-pg.mjs:509-580` (роуты `/api/parent/*`)
- Test: `tests/tenancy.test.mjs`

**Interfaces:**
- Consumes: `ctx.circle` из Task 3.
- Produces: все `/api/parent/*` работают в границах `ctx.circle`; хендлеры получают вторым аргументом `ctx`.

- [ ] **Step 1: Написать тест изоляции**

Создать `tests/tenancy.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupDb, startServer } from './helpers/db.mjs';
import { makeAuth } from '../client/lib/auth.mjs';

// Взрослый круга А не должен видеть детей круга Б и не должен заводить детей в чужой круг.
test('кабинет ограничен своим кругом', async (t) => {
  const db = await setupDb();
  const pool = new pg.Pool({ connectionString: db.url });
  const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows);
  const auth = makeAuth(q, (s, p) => q(s, p).then((r) => r[0] || null));

  const [adult] = await q("insert into adults(name) values ('Ведущий А') returning id");
  await q("insert into memberships(adult_id, circle_id, role) values ($1,$2,'owner')", [adult.id, db.circleA]);
  const sess = auth.newToken();
  await q('insert into adult_sessions(token_hash, adult_id) values ($1,$2)', [auth.hash(sess), adult.id]);

  const srv = await startServer(db.url);
  t.after(() => { srv.stop(); pool.end(); });
  const cookie = { cookie: `sb_session=${sess}` };

  const kids = await srv.api('/api/parent/children', { headers: cookie });
  assert.equal(kids.status, 200);
  assert.equal(kids.body.length, 2, 'видит только двоих своих');

  const add = await srv.api('/api/parent/add-child', {
    method: 'POST', headers: { ...cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Новичок', tree: 'pine' }),
  });
  assert.equal(add.status, 200);
  const [row] = await q('select circle_id from users where name=$1', ['Новичок']);
  assert.equal(row.circle_id, db.circleA, 'ребёнок попал в круг взрослого, а не в «первый по created_at»');

  const noAuth = await srv.api('/api/parent/children');
  assert.equal(noAuth.status, 401);
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd ~/Desktop/shishka-bank/client && npm test -- --test-name-pattern="кабинет ограничен"`
Expected: FAIL — `/api/parent/children` вернёт 401 (сейчас требуется PIN) или отдаст детей обоих кругов.

- [ ] **Step 3: Пропускать взрослого по сессии и фильтровать по кругу**

В `client/server-pg.mjs` в `createServer` заменить блок PIN-проверки

```js
      if (url.pathname.startsWith('/api/parent/')) {
        if ((req.headers['x-parent-pin'] || '') !== PARENT_PIN) throw { code: 401, msg: 'нужен PIN родителя' };
      }
```

на

```js
      const ctx = await auth.resolve(req);
      // родительский контур: ключ взрослого ИЛИ legacy-PIN (мост для круга LESFRIEND)
      if (url.pathname.startsWith('/api/parent/')) {
        const byPin = (req.headers['x-parent-pin'] || '') === PARENT_PIN;
        if (!ctx.adult && !byPin) throw { code: 401, msg: 'нужен вход взрослого' };
        if (!ctx.circle) {
          const c = await one('select id from circles order by created_at limit 1');   // legacy-PIN → первый круг
          ctx.circle = c?.id;
        }
      }
```

(строка `const ctx = await auth.resolve(req);` из Task 3 ниже по коду удаляется — резолв теперь один, выше.)

- [ ] **Step 4: Прокинуть круг в родительские роуты**

В `client/server-pg.mjs` заменить хендлеры на версии с фильтром (`ctx` — второй аргумент, как у детских роутов):

```js
  'GET /api/parent/children': (b, ctx) => q(
    `select cl.code, u.id, u.name, u.tree_level as level, w.balance
       from child_logins cl join users u on u.id=cl.child_id join wallets w on w.user_id=u.id
      where u.circle_id=$1 order by u.created_at`, [ctx.circle]),
```

В `POST /api/parent/add-child` и `POST /api/parent/add-prize` заменить строку

```js
    const circle = await one("select id from circles order by created_at limit 1");
```

на

```js
    const circle = { id: ctx.circle };
```

и добавить `ctx` в сигнатуру: `async (b, ctx) => {`.

В `GET /api/parent/pending` добавить фильтр:

```js
  'GET /api/parent/pending': (b, ctx) => q(
    `select t.id, t.title, t.reward, t.proof_url as photo, u.name as "childName"
       from tasks t join users u on u.id=t.child_id
      where t.status='pending_review' and u.circle_id=$1 order by t.created_at`, [ctx.circle]),
```

Аналогично добавить `where` по `circle_id` в `GET /api/parent/guilds`, `GET /api/parent/card-trades`, а в `POST /api/parent/topup`, `POST /api/parent/deduct`, `POST /api/parent/approve`, `POST /api/parent/reject`, `POST /api/parent/create-task`, `POST /api/parent/guild-payout` первой строкой поставить проверку принадлежности:

```js
    const own = await one('select 1 from users where id=$1 and circle_id=$2', [b.child || b.id, ctx.circle]);
    if (!own) throw { code: 403, msg: 'этот ребёнок не из вашего круга' };
```

(для `approve`/`reject`/`guild-payout`, где приходит id задания или гильдии, проверять через join: `select 1 from tasks t join users u on u.id=t.child_id where t.id=$1 and u.circle_id=$2`.)

- [ ] **Step 5: Запустить тесты**

Run: `cd ~/Desktop/shishka-bank/client && npm test`
Expected: PASS, 4 теста.

- [ ] **Step 6: Коммит**

```bash
cd ~/Desktop/shishka-bank
git add client/server-pg.mjs tests
git commit -m "fix(кабинет): родительский контур ограничен своим кругом (была утечка на всю БД)"
```

---

### Task 5: Взрослый заводит круг (вход бесшовный, ключ спрятан в кабинет)

**Files:**
- Modify: `client/server-pg.mjs` (роуты `POST /api/circle/create`, `GET /api/adult/session`, `POST /api/parent/transfer-link`)
- Create: `client/start.html`
- Test: `tests/adult_link.test.mjs`

**Interfaces:**
- Consumes: `adults`, `memberships`, `adult_sessions` (Task 2), `auth.resolve/newToken/hash` (Task 3).
- Produces:
  - `POST /api/circle/create` `{name, kind}` → `{id, kind}` — заводит взрослого (если куки нет), круг, членство `owner`, ставит `HttpOnly`-куку `sb_session`. Ключ наружу НЕ отдаётся;
  - `GET /api/adult/session` → `{ok, circles:[{id,name,kind}]}` — кто я и какими кругами владею; `401` без куки;
  - `POST /api/parent/transfer-link` → `{url}` — выдаёт ссылку переноса доступа на другое устройство (по требованию, из кабинета).
- Note: `adult_sessions` — долговременный ключ доступа, а не короткая сессия. Пользователь его не видит: вход бесшовный, устройство помнит. Telegram позже добавится вторым способом получить такой же ключ — схема не меняется.

- [ ] **Step 1: Написать тест**

Создать `tests/adult_link.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupDb, startServer } from './helpers/db.mjs';

// Кука ставится сервером; ключ пользователю не показывается, но доступ переносится по запросу.
test('взрослый заводит круг одним нажатием и видит только свой круг', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url, { APP_URL: 'http://localhost:3777' });
  const pool = new pg.Pool({ connectionString: db.url });
  t.after(() => { srv.stop(); pool.end(); });
  const json = { 'Content-Type': 'application/json' };

  const r = await fetch(`http://127.0.0.1:${srv.port}/api/circle/create`, {
    method: 'POST', headers: json, body: JSON.stringify({ name: 'Семья Петровых', kind: 'family' }) });
  assert.equal(r.status, 200);
  const made = await r.json();
  const cookie = (r.headers.get('set-cookie') || '');
  assert.match(cookie, /sb_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.equal(made.key, undefined, 'ключ наружу не отдаётся');
  const sess = cookie.match(/sb_session=([^;]+)/)[1];

  const me = await srv.api('/api/adult/session', { headers: { cookie: `sb_session=${sess}` } });
  assert.equal(me.status, 200);
  assert.equal(me.body.circles.length, 1);
  assert.equal(me.body.circles[0].kind, 'family');

  const kids = await srv.api('/api/parent/children', { headers: { cookie: `sb_session=${sess}` } });
  assert.equal(kids.status, 200);
  assert.equal(kids.body.length, 0, 'в новом круге пусто, чужих детей не видно');

  await srv.api('/api/parent/add-child', {
    method: 'POST', headers: { ...json, cookie: `sb_session=${sess}` }, body: JSON.stringify({ name: 'Тимка', tree: 'pine' }) });
  const [row] = await pool.query('select circle_id from users where name=$1', ['Тимка']).then((x) => x.rows);
  assert.equal(row.circle_id, made.id);

  const anon = await srv.api('/api/adult/session');
  assert.equal(anon.status, 401);

  // перенос доступа: ссылка выдаётся по требованию и открывает тот же круг
  const tr = await srv.api('/api/parent/transfer-link', {
    method: 'POST', headers: { ...json, cookie: `sb_session=${sess}` }, body: JSON.stringify({}) });
  assert.equal(tr.status, 200);
  const key2 = new URL(tr.body.url, 'http://x').searchParams.get('key');
  const me2 = await srv.api('/api/adult/session', { headers: { cookie: `sb_session=${key2}` } });
  assert.equal(me2.body.circles[0].id, made.id);

  // второй круг тем же взрослым: лагерь
  const camp = await srv.api('/api/circle/create', {
    method: 'POST', headers: { ...json, cookie: `sb_session=${sess}` }, body: JSON.stringify({ name: 'Лагерь Ёлка', kind: 'camp' }) });
  assert.equal(camp.status, 200);
  const me3 = await srv.api('/api/adult/session', { headers: { cookie: `sb_session=${sess}` } });
  assert.equal(me3.body.circles.length, 2);
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd ~/Desktop/shishka-bank/client && npm test -- --test-name-pattern="одним нажатием"`
Expected: FAIL — роуты отдают 404.

- [ ] **Step 3: Добавить роуты**

В `client/server-pg.mjs` рядом с `PARENT_PIN` добавить базовый адрес:

```js
const APP_URL = process.env.APP_URL || 'https://elka-kvest-2026.ru';
```

Расширить список роутов, которым не нужен код ребёнка:

```js
const PUBLIC = new Set(['POST /api/link', 'POST /api/circle/create', 'GET /api/adult/session', 'POST /api/device/claim']);
```

И добавить хендлеры в объект `api`:

```js
  // Заводит взрослого (если куки ещё нет), круг и членство. Ключ остаётся в HttpOnly-куке и наружу не отдаётся.
  'POST /api/circle/create': async (b, ctx, res) => {
    let adultId = ctx.adult;
    if (!adultId) {
      const a = await one('insert into adults(name) values ($1) returning id', [(b.adultName || 'Хранитель').slice(0, 40)]);
      adultId = a.id;
      const key = auth.newToken();
      await q('insert into adult_sessions(token_hash, adult_id) values ($1,$2)', [auth.hash(key), adultId]);
      res.setHeader('Set-Cookie', `sb_session=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    }
    const kind = b.kind === 'camp' ? 'camp' : 'family';
    const name = (b.name || '').trim() || (kind === 'camp' ? 'Лесной лагерь' : 'Моя семья');
    const invite = 'C' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const c = await one('insert into circles(name, invite_code, kind) values ($1,$2,$3) returning id', [name, invite, kind]);
    await q("insert into memberships(adult_id, circle_id, role) values ($1,$2,'owner')", [adultId, c.id]);
    auth.dropCache();
    return { id: c.id, kind };
  },

  'GET /api/adult/session': async (b, ctx) => {
    if (!ctx.adult) throw { code: 401, msg: 'нужен вход взрослого' };
    const circles = await q(
      'select c.id, c.name, c.kind from circles c join memberships m on m.circle_id=c.id where m.adult_id=$1 order by c.created_at',
      [ctx.adult]);
    return { ok: true, circles };
  },

  // Перенос доступа на другое устройство: второй ключ к тому же взрослому, по требованию из кабинета.
  'POST /api/parent/transfer-link': async (b, ctx) => {
    if (!ctx.adult) throw { code: 401, msg: 'нужен вход взрослого' };
    const key = auth.newToken();
    await q('insert into adult_sessions(token_hash, adult_id) values ($1,$2)', [auth.hash(key), ctx.adult]);
    return { url: `${APP_URL}/parent.html?key=${key}` };
  },
```

Чтобы хендлер мог поставить куку, прокинуть `res` третьим аргументом — в `createServer` заменить

```js
      const out = JSON.stringify(await handler(body, ctx));
```

на

```js
      const out = JSON.stringify(await handler(body, ctx, res));
```

- [ ] **Step 4: Экран «Завести свой лес»**

Создать `client/start.html`:

```html
<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="manifest" href="manifest.json"><meta name="theme-color" content="#7bab4c">
<title>Завести свой лес — Шишка Банк</title><link rel="stylesheet" href="style.css">
<style>
  .phone{background-image:url(assets/bg_spring.webp)}
  .wrap{justify-content:center;align-items:center;text-align:center;padding:18px 22px}
  .spirit img{width:140px;height:140px;object-fit:contain;filter:drop-shadow(0 5px 6px var(--shadow))}
  h1{font-size:24px;color:var(--ink);font-weight:900;margin-top:6px}
  .lead{color:var(--brown);font-weight:700;margin-top:8px;font-size:15px;line-height:1.35}
  input,select{margin-top:12px;width:100%;background:#fffaf0;border:3px solid var(--brown);border-radius:16px;
    padding:13px;font-size:17px;font-weight:800;color:var(--ink);outline:none}
</style></head><body data-no-nav>
<div class="phone"><div class="wrap">
  <div class="spirit"><img src="assets/spirit.webp" alt="Лесной Дух"></div>
  <h1>Заведите свой лес</h1>
  <div class="lead">Вы — Хранитель: выдаёте задания, подтверждаете их и начисляете шишки.</div>
  <input id="circleName" placeholder="Название, например «Наша семья»" maxlength="40">
  <select id="circleKind"><option value="family">Семья</option><option value="camp">Лагерь или класс</option></select>
  <button class="btn btn-lg" id="createBtn" style="width:100%;margin-top:12px">Создать</button>
  <div class="on-art" id="note" style="display:none;margin-top:12px"></div>
</div></div>
<script src="app.js"></script>
</body></html>
```

- [ ] **Step 5: Оживить экран и принимать ключ переноса**

В `client/app.js` после блока `if (page === 'link.html') { … }` добавить:

```js
// ── Ключ переноса из ссылки: /parent.html?key=… (даётся кабинетом по кнопке) ──
const urlKey = new URLSearchParams(location.search).get('key');
if (urlKey) {
  document.cookie = `sb_session=${urlKey}; Path=/; Max-Age=31536000; SameSite=Lax`;
  history.replaceState({}, '', location.pathname);   // ключ не остаётся в адресной строке
}

// ── Создание своего круга: ключ не показываем, сразу в кабинет ──
if (page === 'start.html') {
  document.getElementById('createBtn').onclick = async () => {
    const name = document.getElementById('circleName').value.trim();
    const kind = document.getElementById('circleKind').value;
    const r = await api('/api/circle/create', { name, kind });
    if (r.error) {
      const n = document.getElementById('note'); n.style.display = 'block'; n.textContent = r.error; return;
    }
    location.href = 'parent.html';
  };
}
```

Кука переноса ставится клиентом без `HttpOnly` (иначе JS её не запишет) — ключ и так пришёл в ссылке самому взрослому. Кука при создании круга остаётся `HttpOnly`.

- [ ] **Step 6: Кнопка переноса в кабинете**

В `client/parent.html` в конец блока настроек добавить:

```html
<details><summary>Перенести кабинет на другой телефон</summary>
  <div class="on-art">Ссылка откроет этот же кабинет на другом устройстве. Никому её не пересылайте — она заменяет пароль.</div>
  <button class="btn" id="transferBtn">Показать ссылку</button>
  <div id="transferBox"></div>
</details>
```

и в `client/app.js` в блоке кабинета:

```js
  const tb = document.getElementById('transferBtn');
  if (tb) tb.onclick = async () => {
    const r = await api('/api/parent/transfer-link', {});
    const box = document.getElementById('transferBox');
    box.innerHTML = r.error ? `<div class="on-art">${r.error}</div>`
      : `<div class="on-art" style="word-break:break-all"><a href="${r.url}">${r.url}</a></div><div class="qr"></div>`;
    if (!r.error) new QRCode(box.querySelector('.qr'), { text: r.url, width: 180, height: 180 });
  };
```

- [ ] **Step 7: Кабинет пускает по куке, PIN — запасной**

В `client/app.js` кабинет сейчас при ошибке списывает всё на PIN (около строки 794: `localStorage.removeItem('parentPin'); alert('Неверный PIN')`). Заменить на:

```js
    if (kids.error) {
      localStorage.removeItem('parentPin');
      location.href = 'start.html'; return;
    }
```

- [ ] **Step 8: Запустить тесты**

Run: `cd ~/Desktop/shishka-bank/client && npm test`
Expected: PASS, 6 тестов.

- [ ] **Step 9: Коммит**

```bash
cd ~/Desktop/shishka-bank
git add client/server-pg.mjs client/start.html client/parent.html client/app.js tests
git commit -m "feat(вход): взрослый заводит круг одним нажатием, перенос доступа — из кабинета"
```

---

### Task 6: Токен устройства — выдача и обмен

**Files:**
- Modify: `client/server-pg.mjs` (роуты `POST /api/parent/device-link`, `POST /api/device/claim`)
- Test: `tests/device_link.test.mjs`

**Interfaces:**
- Consumes: `link_tokens`, `device_tokens`, `auth.newToken()/hash()`; сессия взрослого из Task 5.
- Produces:
  - `POST /api/parent/device-link` `{child}` → `{url, expiresIn}` — `url` вида `https://<host>/connect.html?t=<token>`;
  - `POST /api/device/claim` `{t}` → `{token, child: {id, name}}` — обменивает одноразовый `link_token` на `device_token`.

- [ ] **Step 1: Написать тест**

Создать `tests/device_link.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupDb, startServer } from './helpers/db.mjs';
import { makeAuth } from '../client/lib/auth.mjs';

test('ссылка привязки одноразовая, с TTL, и выдаёт рабочий токен устройства', async (t) => {
  const db = await setupDb();
  const pool = new pg.Pool({ connectionString: db.url });
  const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows);
  const auth = makeAuth(q, (s, p) => q(s, p).then((r) => r[0] || null));
  const [adult] = await q("insert into adults(name) values ('Ведущий') returning id");
  await q("insert into memberships(adult_id, circle_id, role) values ($1,$2,'owner')", [adult.id, db.circleA]);
  const sess = auth.newToken();
  await q('insert into adult_sessions(token_hash, adult_id) values ($1,$2)', [auth.hash(sess), adult.id]);

  const srv = await startServer(db.url);
  t.after(() => { srv.stop(); pool.end(); });
  const headers = { cookie: `sb_session=${sess}`, 'Content-Type': 'application/json' };

  const link = await srv.api('/api/parent/device-link', { method: 'POST', headers, body: JSON.stringify({ child: db.childA1.id }) });
  assert.equal(link.status, 200);
  const t1 = new URL(link.body.url, 'http://x').searchParams.get('t');

  const claim = await srv.api('/api/device/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: t1 }) });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.child.id, db.childA1.id);

  const state = await srv.api('/api/state', { headers: { 'x-device-token': claim.body.token } });
  assert.equal(state.status, 200);
  assert.equal(state.body.balance, 30);

  const again = await srv.api('/api/device/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: t1 }) });
  assert.equal(again.status, 400, 'повторный обмен запрещён');

  // просроченная ссылка
  const link2 = await srv.api('/api/parent/device-link', { method: 'POST', headers, body: JSON.stringify({ child: db.childA1.id }) });
  const t2 = new URL(link2.body.url, 'http://x').searchParams.get('t');
  await q('update link_tokens set expires_at = now() - interval \'1 minute\' where token_hash=$1', [auth.hash(t2)]);
  const expired = await srv.api('/api/device/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: t2 }) });
  assert.equal(expired.status, 400);

  // чужой ребёнок
  const alien = await srv.api('/api/parent/device-link', { method: 'POST', headers, body: JSON.stringify({ child: db.childB1.id }) });
  assert.equal(alien.status, 403);
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd ~/Desktop/shishka-bank/client && npm test -- --test-name-pattern="ссылка привязки"`
Expected: FAIL — роуты отдают 404.

- [ ] **Step 3: Добавить роуты**

В `client/server-pg.mjs` в объект `api`:

```js
  'POST /api/parent/device-link': async (b, ctx) => {
    const own = await one('select id, name from users where id=$1 and circle_id=$2', [b.child, ctx.circle]);
    if (!own) throw { code: 403, msg: 'этот ребёнок не из вашего круга' };
    const raw = auth.newToken();
    await q(`insert into link_tokens(token_hash, child_id, circle_id, expires_at)
             values ($1,$2,$3, now() + interval '15 minutes')`, [auth.hash(raw), own.id, ctx.circle]);
    return { url: `${APP_URL}/connect.html?t=${raw}`, expiresIn: 900, childName: own.name };
  },

  'POST /api/device/claim': async (b) => {
    const lt = await one(
      `update link_tokens set used_at = now()
        where token_hash=$1 and used_at is null and expires_at > now()
        returning child_id, circle_id`, [auth.hash(b.t || '')]);
    if (!lt) throw { code: 400, msg: 'ссылка уже использована или устарела — попросите новую' };
    const raw = auth.newToken();
    await q('insert into device_tokens(token_hash, child_id, circle_id) values ($1,$2,$3)',
      [auth.hash(raw), lt.child_id, lt.circle_id]);
    const child = await one('select id, name from users where id=$1', [lt.child_id]);
    return { token: raw, child };
  },
```

Рядом с `PARENT_PIN` добавить базовый адрес приложения:

```js
const APP_URL = process.env.APP_URL || 'https://elka-kvest-2026.ru';
```

- [ ] **Step 4: Запустить тесты**

Run: `cd ~/Desktop/shishka-bank/client && npm test`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Коммит**

```bash
cd ~/Desktop/shishka-bank
git add client/server-pg.mjs tests
git commit -m "feat(вход): одноразовая ссылка привязки устройства и обмен на токен"
```

---

### Task 7: Клиент — вход без кода

**Files:**
- Create: `client/connect.html`
- Modify: `client/app.js:1-45` (функция `api`, guard, экран входа)
- Modify: `client/link.html` (код становится запасным входом)
- Modify: `client/sw.js` (добавить `connect.html` в precache)

**Interfaces:**
- Consumes: `POST /api/device/claim` (Task 7).
- Produces: `localStorage.deviceToken` — активный токен; `localStorage.profiles` — массив `{token, name}` для нескольких детей на одном устройстве.

- [ ] **Step 1: Экран подключения**

Создать `client/connect.html`:

```html
<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="manifest" href="manifest.json"><meta name="theme-color" content="#7bab4c">
<title>Подключение — Шишка Банк</title><link rel="stylesheet" href="style.css">
<style>
  .phone{background-image:url(assets/bg_spring.webp)}
  .wrap{justify-content:center;align-items:center;text-align:center;padding:18px 22px}
  .spirit img{width:150px;height:150px;object-fit:contain;filter:drop-shadow(0 5px 6px var(--shadow))}
  h1{font-size:26px;color:var(--ink);font-weight:900;margin-top:6px}
  .lead{color:var(--brown);font-weight:700;margin-top:8px;font-size:15px;line-height:1.35}
</style></head><body data-no-nav>
<div class="phone"><div class="wrap">
  <div class="spirit"><img src="assets/spirit.webp" alt="Лесной Дух"></div>
  <h1>Шишка Банк</h1>
  <div class="lead" id="note">Лесной Дух узнаёт тебя…</div>
</div></div>
<script src="app.js"></script>
</body></html>
```

- [ ] **Step 2: Клиент шлёт токен вместо кода**

В `client/app.js` в функции `api` заменить начало

```js
  const headers = {};
  const code = localStorage.getItem('childCode');
  if (code) headers['x-child-code'] = encodeURIComponent(code);   // привязка устройства к профилю
```

на

```js
  const headers = {};
  const token = localStorage.getItem('deviceToken');
  const code = localStorage.getItem('childCode');
  if (token) headers['x-device-token'] = token;                    // основной вход: устройство запомнено
  else if (code) headers['x-child-code'] = encodeURIComponent(code); // запасной вход по коду
```

И ключ кэша сделать по активному входу — заменить

```js
      const k = 'ac:' + (code || '') + ':' + path;
```

на

```js
      const k = 'ac:' + (token || code || '') + ':' + path;
```

- [ ] **Step 3: Guard и обработка экрана подключения**

В `client/app.js` заменить блок guard

```js
if (page !== 'link.html' && page !== 'onboarding.html' && page !== 'parent.html' && !localStorage.getItem('childCode'))
  location.href = 'link.html';
```

на

```js
const FREE = ['link.html', 'connect.html', 'onboarding.html', 'parent.html'];
if (!FREE.includes(page) && !localStorage.getItem('deviceToken') && !localStorage.getItem('childCode'))
  location.href = 'link.html';

// ── Подключение устройства по одноразовой ссылке ──
if (page === 'connect.html') {
  const t = new URLSearchParams(location.search).get('t');
  const note = document.getElementById('note');
  (async () => {
    if (!t) { note.textContent = 'Ссылка неполная — попроси новую у взрослого.'; return; }
    const r = await api('/api/device/claim', { t });
    if (r.error) { note.textContent = r.error; return; }
    localStorage.setItem('deviceToken', r.token);
    const profiles = JSON.parse(localStorage.getItem('profiles') || '[]').filter((p) => p.token !== r.token);
    profiles.push({ token: r.token, name: r.child.name });
    localStorage.setItem('profiles', JSON.stringify(profiles));
    localStorage.removeItem('childCode');
    note.textContent = 'Готово, ' + r.child.name + '! Заходи в свой лес.';
    setTimeout(() => (location.href = 'index.html'), 900);
  })();
}
```

- [ ] **Step 4: Переключение профилей вместо выхода**

В `client/app.js` заменить обработчик «Сменить пользователя»

```js
  if (su) su.onclick = (e) => { e.preventDefault(); localStorage.removeItem('childCode'); location.href = 'link.html'; };
```

на

```js
  if (su) su.onclick = (e) => {
    e.preventDefault();
    const profiles = JSON.parse(localStorage.getItem('profiles') || '[]');
    if (profiles.length > 1) {
      const cur = localStorage.getItem('deviceToken');
      const next = profiles[(profiles.findIndex((p) => p.token === cur) + 1) % profiles.length];
      localStorage.setItem('deviceToken', next.token);
      for (const k of Object.keys(sessionStorage)) if (k.startsWith('ac:')) sessionStorage.removeItem(k);
      location.href = 'index.html';
      return;
    }
    localStorage.removeItem('deviceToken'); localStorage.removeItem('childCode');
    location.href = 'link.html';
  };
```

- [ ] **Step 5: Код — запасной вход**

В `client/link.html` заменить подзаголовок и подпись кнопки на «запасной» смысл: строку

```html
  <div class="lead">Привет! Введи код, который дал тебе родитель, и заходи в свой лес.</div>
```

на

```html
  <div class="lead">Обычно лес узнаёт тебя сам. Если не узнал — попроси взрослого прислать ссылку или введи свой код.</div>
```

В `client/sw.js` в список precache добавить `'connect.html',` рядом с `'link.html'`.

- [ ] **Step 6: Проверить руками в браузере**

```bash
cd ~/Desktop/shishka-bank/client
DATABASE_URL="postgres://$USER@localhost:5432/shishka_test" APP_URL="http://localhost:3777" node server-pg.mjs
```

В другом окне получить ссылку (сессию взрослого создать как в тесте Task 7) и открыть её в браузере: приложение должно открыться на кошельке без ввода кода. Затем открыть ту же ссылку повторно — экран скажет «ссылка уже использована».

- [ ] **Step 7: Коммит**

```bash
cd ~/Desktop/shishka-bank
git add client/connect.html client/app.js client/link.html client/sw.js
git commit -m "feat(вход): ребёнок заходит по запомненному устройству, код — запасной вход"
```

---

### Task 8: Выкатка на прод

**Files:**
- Modify: нет кода — операционная задача.

**Interfaces:**
- Consumes: всё предыдущее.

- [ ] **Step 1: Свежий бэкап**

```bash
ssh root@62.113.99.125 '/root/backup-shishka.sh && tail -5 /root/backup-shishka.log'
```
Expected: в логе три успешные копии (локальная, stukach, git).

- [ ] **Step 2: Прогнать миграцию на проде**

```bash
ssh root@62.113.99.125 'DBURL=$(systemctl show shishka -p Environment --value | tr " " "\n" | grep "^DATABASE_URL=" | cut -d= -f2-); psql "$DBURL" -v ON_ERROR_STOP=1 -f /tmp/migration_auth.sql'
```
(файл предварительно `scp db/migration_auth.sql root@62.113.99.125:/tmp/`.) Миграция additive — прод продолжает работать на старом коде.

- [ ] **Step 3: Залить код и перезапустить (требует явного «да» Дмитрия)**

```bash
cd ~/Desktop/shishka-bank/client
tar czf /tmp/shishka.tgz *.html *.js *.css manifest.json server-pg.mjs lib assets
scp /tmp/shishka.tgz root@62.113.99.125:/tmp/
ssh root@62.113.99.125 'cd /opt/shishka && tar xzf /tmp/shishka.tgz'
```

В юнит `/etc/systemd/system/shishka.service` добавить `Environment=APP_URL=https://elka-kvest-2026.ru` (иначе ссылки привязки уйдут с дефолтным адресом), затем `systemctl daemon-reload && systemctl restart shishka`.

- [ ] **Step 4: Проверить живой прод**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://elka-kvest-2026.ru/
curl -s https://elka-kvest-2026.ru/api/state -H "x-child-code: $(printf %s 'ДЕМЬ-05' | jq -sRr @uri)" | head -c 200
```
Expected: 200 и живое состояние ребёнка — старый вход по коду не сломан.

- [ ] **Step 5: Проверить полный путь на себе**

Открыть `https://elka-kvest-2026.ru/start.html` → создать круг «Тест» (семья): кабинет открылся сразу, ничего вводить и запоминать не пришлось → «Подключить устройство» ребёнку → открыть ссылку привязки на втором телефоне: приложение открылось без кода → в кабинете «Перенести на другой телефон» → открыть эту ссылку в другом браузере: тот же кабинет. Затем убедиться, что круг LESFRIEND не затронут — в кабинете тестового круга видно только его детей, а играющие дети продолжают заходить по своим кодам.
