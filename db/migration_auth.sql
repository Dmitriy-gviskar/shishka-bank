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
