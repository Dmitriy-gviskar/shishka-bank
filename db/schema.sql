-- Шишка Банк — схема БД (PostgreSQL / Supabase). Источник правды.
-- Фаза 1 (MVP-петля): circles, users, wallets, transactions, tasks, shop_items, purchases.
-- Таблицы Фазы 2-3 (safes, guilds, events, badges) объявлены, но не в петле MVP.
-- Деньги игры = «шишки», ВСЕГДА целые (integer), без дробей.

-- ─────────────────────────── Фаза 1: ядро ───────────────────────────

-- Семейный круг (группа: родитель + дети)
create table circles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,           -- код-приглашение ребёнка
  insurance_fund int not null default 0 check (insurance_fund >= 0),  -- Лесная страховка (общий фонд семьи)
  created_at  timestamptz not null default now()
);

-- Касса банка-оператора «Шишка Банк» (ГЛОБАЛЬНАЯ, одна на всю платформу).
-- Сюда стекаются комиссии со всех семей; отсюда банк оказывает услуги/платит бонусы.
create table bank_account (
  id       text primary key default 'main',
  treasury bigint not null default 0 check (treasury >= 0)
);
insert into bank_account(id) values ('main') on conflict do nothing;

-- Пользователи: родитель (Хранитель) и ребёнок (Дитя Леса)
create table users (
  id           uuid primary key default gen_random_uuid(),
  circle_id    uuid not null references circles(id) on delete cascade,
  role         text not null check (role in ('parent','child')),
  name         text not null,
  auth_id      uuid,                           -- связь с auth.users (родитель); у ребёнка null
  tree_type    text default 'pine' check (tree_type in ('pine','cedar','spruce','oak')),
  tree_level   int  not null default 1 check (tree_level >= 1),
  avatar_skin  text default 'base',
  reputation   jsonb not null default '{"honesty":0,"generosity":0,"reliability":0,"wisdom":0}',
  is_veteran   boolean not null default false, -- играл в офлайн-игре прошлого года
  -- удержание: серия ежедневных заходов («полив дерева»)
  last_visit      date,
  current_streak  int not null default 0,
  longest_streak  int not null default 0,      -- дерево растёт по МАКСИМУМУ и не деградирует
  streak_freezes  int not null default 0,      -- «дождики»-защитники серии (покупаются + авто раз в неделю)
  last_freeze_grant date,                       -- когда последний раз выдали авто-freeze (раз в 7 дней)
  created_at   timestamptz not null default now()
);
create index on users(circle_id);

-- Кошелёк (1:1 с ребёнком). Баланс — текущие шишки; total_* — счётчики за всё время.
create table wallets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references users(id) on delete cascade,
  balance      int  not null default 0 check (balance >= 0),
  total_earned int  not null default 0 check (total_earned >= 0),
  total_spent  int  not null default 0 check (total_spent >= 0)
);

-- Журнал операций (единый для наград, переводов, покупок, депозитов)
create table transactions (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references circles(id) on delete cascade,
  from_user  uuid references users(id) on delete set null,  -- null = эмиссия (награда от системы/родителя)
  to_user    uuid references users(id) on delete set null,  -- null = сжигание (покупка/аукцион)
  amount     int  not null check (amount > 0),
  type       text not null check (type in ('reward','transfer','purchase','deposit','interest','pot_contribution','fee','payout','insurance')),
  ref_id     uuid,                              -- ссылка на task/purchase/safe
  message    text,
  created_at timestamptz not null default now()
);
create index on transactions(circle_id, created_at desc);

-- Лесные задания (поручения ребёнку, награда в шишках)
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references circles(id) on delete cascade,
  child_id    uuid not null references users(id) on delete cascade,
  created_by  uuid references users(id) on delete set null,  -- родитель
  title       text not null,
  description text,
  reward      int  not null check (reward > 0),
  category    text,
  is_daily    boolean not null default false,
  needs_photo boolean not null default false,
  status      text not null default 'open'
              check (status in ('open','pending_review','done','rejected')),
  proof_url   text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index on tasks(circle_id, child_id, status);

-- Магазин впечатлений / скины (лоты, которые ребёнок покупает за шишки)
create table shop_items (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid references circles(id) on delete cascade,  -- null = глобальный шаблон
  type       text not null default 'impression'
             check (type in ('impression','skin')),
  title      text not null,
  price      int  not null check (price > 0),
  category   text,
  rarity     text default 'base' check (rarity in ('base','seasonal','rare','epic')),
  season     text,                              -- для сезонных скинов (winter/spring/...)
  created_by uuid references users(id) on delete set null,
  is_active  boolean not null default true
);
create index on shop_items(circle_id, type, is_active);

-- Инвентарь: какими скинами ребёнок владеет (куплены навсегда)
create table user_skins (
  user_id     uuid not null references users(id) on delete cascade,
  skin_id     uuid not null references shop_items(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  primary key (user_id, skin_id)
);

-- Покупки призов (резерв шишек до исполнения родителем)
create table purchases (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references circles(id) on delete cascade,
  child_id   uuid not null references users(id) on delete cascade,
  item_id    uuid not null references shop_items(id) on delete restrict,
  price      int  not null check (price > 0),   -- фиксируем цену на момент покупки
  status     text not null default 'promised'
             check (status in ('promised','fulfilled','canceled')),
  created_at   timestamptz not null default now(),
  fulfilled_at timestamptz
);
create index on purchases(circle_id, child_id, status);

-- Дневной квест от Лесного Духа: одна цель в день (крючок ежедневного возврата)
create table daily_quests (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references users(id) on delete cascade,
  quest_date date not null default current_date,
  title      text not null,
  reward     int  not null check (reward > 0),
  status     text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now(),
  unique (child_id, quest_date)               -- максимум один квест в день на ребёнка
);

-- Лесной гороскоп: справочник предсказаний + выданные ребёнку по дням
-- (ТЗ предлагал еженедельный; делаем ЕЖЕДНЕВНЫЙ — сильнее как крючок возврата)
create table horoscope_texts (
  id   uuid primary key default gen_random_uuid(),
  text text not null
);
create table daily_horoscopes (
  id            uuid primary key default gen_random_uuid(),
  child_id      uuid not null references users(id) on delete cascade,
  horoscope_date date not null default current_date,
  text          text not null,
  bonus         int  not null default 0,   -- «счастливое предсказание» иногда дарит 1-3 шишки
  created_at    timestamptz not null default now(),
  unique (child_id, horoscope_date)
);

-- Справочник заданий: готовые шаблоны, из которых родитель создаёт task в 1 тап
create table task_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  reward      int  not null check (reward > 0),
  category    text,
  is_daily    boolean not null default false,
  needs_photo boolean not null default false
);

-- Общий котёл: совместная семейная цель (сбор шишек всей семьёй)
create table pots (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references circles(id) on delete cascade,
  title      text not null,
  goal       int  not null check (goal > 0),      -- цель в шишках
  collected  int  not null default 0 check (collected >= 0),
  status     text not null default 'open' check (status in ('open','reached','fulfilled')),
  created_by uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  fulfilled_at timestamptz
);
create index on pots(circle_id, status);

-- Кто сколько вложил в котёл (для благодарности и прозрачности)
create table pot_contributions (
  id         uuid primary key default gen_random_uuid(),
  pot_id     uuid not null references pots(id) on delete cascade,
  child_id   uuid not null references users(id) on delete cascade,
  amount     int  not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index on pot_contributions(pot_id);

-- Лавки-мастерские: детский бизнес. Ребёнок открывает лавку и продаёт лоты.
-- Сделка с эскроу: покупатель резервирует (шишки блокируются) -> встреча в реале ->
-- покупатель подтверждает получение -> шишки уходят продавцу.
create table shops (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null unique references users(id) on delete cascade,  -- одна лавка на ребёнка
  circle_id   uuid not null references circles(id) on delete cascade,
  name        text not null,
  description text,
  is_heir     boolean not null default false,   -- «Наследник»: участник офлайн-игры
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table shop_lots (
  id        uuid primary key default gen_random_uuid(),
  shop_id   uuid not null references shops(id) on delete cascade,
  title     text not null,
  type      text not null default 'goods' check (type in ('goods','service','digital')),
  price     int  not null check (price > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on shop_lots(shop_id, is_active);

create table orders (
  id         uuid primary key default gen_random_uuid(),
  lot_id     uuid not null references shop_lots(id) on delete restrict,
  buyer_id   uuid not null references users(id) on delete cascade,
  seller_id  uuid not null references users(id) on delete cascade,
  price      int  not null check (price > 0),   -- фиксируем цену на момент резерва
  status     text not null default 'reserved' check (status in ('reserved','delivered','canceled')),
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);
create index on orders(seller_id, status);
create index on orders(buyer_id, status);

-- Гильдии: временное объединение детей для общего заказа. Доход делится по долям.
create table guilds (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references circles(id) on delete cascade,
  name       text not null,
  created_by uuid references users(id) on delete set null,
  status     text not null default 'open' check (status in ('open','completed','disbanded')),
  created_at timestamptz not null default now()
);

create table guild_members (
  guild_id uuid not null references guilds(id) on delete cascade,
  child_id uuid not null references users(id) on delete cascade,
  share    int  not null default 1 check (share > 0),   -- вес доли (не обязательно в %)
  primary key (guild_id, child_id)
);

-- Лесная почта: эмоции/стикеры/аудио БЕЗ текста. «Шёпот леса» — отложенное
-- родительское голосовое, появляется у ребёнка не сразу (deliver_at в будущем).
create table messages (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references circles(id) on delete cascade,
  from_user  uuid references users(id) on delete set null,
  to_user    uuid not null references users(id) on delete cascade,
  type       text not null check (type in ('emoji','sticker','audio')),
  content    text not null,                 -- эмодзи / id стикера / url аудио (без текста)
  is_whisper boolean not null default false, -- «Шёпот леса» от родителя
  deliver_at timestamptz not null default now(),  -- отложенная доставка
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on messages(to_user, deliver_at);

-- Лесной Совет: инициативы, решаемые голосованием детей. Для справедливости
-- голос РАВНЫЙ (1 ребёнок = 1 голос), не «1 шишка = 1 голос» (иначе богатый решает всё).
create table proposals (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references circles(id) on delete cascade,
  type        text not null check (type in ('insurance_claim','pot_spend','custom')),
  title       text not null,
  target_user uuid references users(id) on delete set null,   -- кому выплата (для страховки)
  amount      int  check (amount > 0),
  status      text not null default 'voting' check (status in ('voting','passed','rejected')),
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table votes (
  proposal_id uuid not null references proposals(id) on delete cascade,
  voter_id    uuid not null references users(id) on delete cascade,
  choice      text not null check (choice in ('yes','no')),
  primary key (proposal_id, voter_id)
);

-- Лесной аукцион: банк-оператор (админ) выставляет супер-лот, дети делают ставки.
-- Платит ТОЛЬКО победитель (его ставка -> касса банка), проигравшие не теряют
-- (эскроу текущего лидера возвращается при перебивке). Приз — скин победителю.
create table auctions (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  prize_skin     uuid references shop_items(id) on delete set null,  -- разыгрываемый скин
  min_bid        int  not null default 1 check (min_bid > 0),
  current_bid    int  not null default 0,
  current_leader uuid references users(id) on delete set null,
  status         text not null default 'live' check (status in ('live','closed')),
  created_by     uuid references users(id) on delete set null,       -- админ/банк
  created_at     timestamptz not null default now(),
  ends_at        timestamptz
);

create table bids (
  id         uuid primary key default gen_random_uuid(),
  auction_id uuid not null references auctions(id) on delete cascade,
  bidder_id  uuid not null references users(id) on delete cascade,
  amount     int  not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index on bids(auction_id);

-- Нарративные квесты от Духа: многошаговые истории-события (сбор + действия + финал).
create table quests (
  id           uuid primary key default gen_random_uuid(),
  circle_id    uuid not null references circles(id) on delete cascade,
  code         text not null,
  title        text not null,
  current_step int  not null default 1,
  status       text not null default 'active' check (status in ('active','completed')),
  fund         int  not null default 0,      -- собранные ресурсы (пул квеста)
  reward_cones int  not null default 0,
  reward_skin  uuid references shop_items(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table quest_steps (
  quest_id   uuid not null references quests(id) on delete cascade,
  step_order int  not null,
  kind       text not null check (kind in ('narrative','collect','task','finale')),
  text       text not null,
  goal       int  not null default 0,        -- collect: шишек; task: действий
  progress   int  not null default 0,
  done       boolean not null default false,
  primary key (quest_id, step_order)
);

-- ─────────────────────── Фаза 2-3: объявлено, вне MVP ───────────────────────

-- Дупло-сейф (депозит под процент)
create table safes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  amount        int  not null check (amount > 0),
  interest_rate int  not null,                  -- проценты (5/10/20)
  unlock_date   timestamptz not null,
  status        text not null default 'locked' check (status in ('locked','unlocked')),
  created_at    timestamptz not null default now()
);

create table badges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  badge_type text not null,
  earned_at  timestamptz not null default now(),
  unique (user_id, badge_type)
);

-- Реестр достижений (data-driven): условие = метрика >= порог. tier — уровень (I/II/III).
create table achievements (
  code        text primary key,
  title       text not null,
  description text,
  metric      text not null,          -- tasks_done/cones_earned/longest_streak/gifts_sum/...
  threshold   int  not null,
  tier        int  not null default 1,
  reward      int  not null default 0 -- бонус-шишки за открытие (0 = без бонуса)
);

-- Открытые ребёнком достижения
create table user_achievements (
  child_id    uuid not null references users(id) on delete cascade,
  code        text not null references achievements(code) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (child_id, code)
);

-- Сезонные события и модификаторы (Ярмарка/Засуха/сезоны). modifiers — множители
-- механик, напр. {"task_reward":2} (задания х2), {"safe_interest":2} (Дупло х2).
-- circle_id = null → глобальное событие для всех семей.
create table events (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid references circles(id) on delete cascade,
  type       text not null,                -- fair/drought/spring/summer/autumn/winter/cone_rain
  title      text not null,
  modifiers  jsonb not null default '{}',
  start_date timestamptz not null default now(),
  end_date   timestamptz,
  created_at timestamptz not null default now()
);
create index on events(circle_id, start_date, end_date);
