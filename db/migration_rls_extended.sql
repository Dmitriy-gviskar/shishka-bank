-- Шишка Банк — расширенные RLS-политики (Фаза 2+ таблицы).
-- Все таблицы с circle_id изолируются по семейному кругу.
-- Таблицы без circle_id (справочники) — только чтение для авторизованных.

-- =============================== Гильдии ===============================
alter table guilds              enable row level security;
alter table guild_members       enable row level security;
alter table guild_messages      enable row level security;

create policy guilds_read    on guilds         for select using (circle_id = my_circle());
create policy guilds_write   on guilds         for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy guildm_read    on guild_members  for select using (exists (select 1 from guilds g where g.id = guild_members.guild_id and g.circle_id = my_circle()));
create policy guildm_write   on guild_members  for all using (exists (select 1 from guilds g where g.id = guild_members.guild_id and g.circle_id = my_circle())) with check (exists (select 1 from guilds g where g.id = guild_members.guild_id and g.circle_id = my_circle()));
create policy guildmsg_read  on guild_messages for select using (exists (select 1 from guilds g where g.id = guild_messages.guild_id and g.circle_id = my_circle()));
create policy guildmsg_write on guild_messages for all using (exists (select 1 from guilds g where g.id = guild_messages.guild_id and g.circle_id = my_circle())) with check (exists (select 1 from guilds g where g.id = guild_messages.guild_id and g.circle_id = my_circle()));

-- =============================== Сообщения ===============================
alter table messages  enable row level security;

create policy msg_read  on messages for select using (circle_id = my_circle());
create policy msg_write on messages for all using (circle_id = my_circle()) with check (circle_id = my_circle());

-- =============================== Голосования ===============================
alter table proposals  enable row level security;
alter table votes      enable row level security;

create policy prop_read  on proposals for select using (circle_id = my_circle());
create policy prop_write on proposals for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy votes_read  on votes for select using (exists (select 1 from proposals p where p.id = votes.proposal_id and p.circle_id = my_circle()));
create policy votes_write on votes for all using (exists (select 1 from proposals p where p.id = votes.proposal_id and p.circle_id = my_circle())) with check (exists (select 1 from proposals p where p.id = votes.proposal_id and p.circle_id = my_circle()));

-- =============================== Аукционы ===============================
alter table auctions  enable row level security;
alter table bids      enable row level security;

create policy auc_read  on auctions for select using (circle_id = my_circle());
create policy auc_write on auctions for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy bids_read  on bids for select using (exists (select 1 from auctions a where a.id = bids.auction_id and a.circle_id = my_circle()));
create policy bids_write on bids for all using (exists (select 1 from auctions a where a.id = bids.auction_id and a.circle_id = my_circle())) with check (exists (select 1 from auctions a where a.id = bids.auction_id and a.circle_id = my_circle()));

-- =============================== Лавки-мастерские ===============================
alter table shops      enable row level security;
alter table shop_lots  enable row level security;
alter table orders     enable row level security;

create policy shops_read  on shops     for select using (circle_id = my_circle());
create policy shops_write on shops     for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy lots_read   on shop_lots for select using (exists (select 1 from shops s where s.id = shop_lots.shop_id and s.circle_id = my_circle()));
create policy lots_write  on shop_lots for all using (exists (select 1 from shops s where s.id = shop_lots.shop_id and s.circle_id = my_circle())) with check (exists (select 1 from shops s where s.id = shop_lots.shop_id and s.circle_id = my_circle()));
create policy orders_read  on orders    for select using (circle_id = my_circle());
create policy orders_write on orders    for all using (circle_id = my_circle()) with check (circle_id = my_circle());

-- =============================== Котлы ===============================
alter table pots               enable row level security;
alter table pot_contributions  enable row level security;

create policy pots_read  on pots for select using (circle_id = my_circle());
create policy pots_write on pots for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy potc_read  on pot_contributions for select using (exists (select 1 from pots p where p.id = pot_contributions.pot_id and p.circle_id = my_circle()));
create policy potc_write on pot_contributions for all using (exists (select 1 from pots p where p.id = pot_contributions.pot_id and p.circle_id = my_circle())) with check (exists (select 1 from pots p where p.id = pot_contributions.pot_id and p.circle_id = my_circle()));

-- =============================== Депозиты ===============================
alter table safes  enable row level security;

create policy safes_read  on safes for select using (circle_id = my_circle());
create policy safes_write on safes for all using (circle_id = my_circle()) with check (circle_id = my_circle());

-- =============================== Бейджи и достижения ===============================
alter table badges             enable row level security;
alter table achievements       enable row level security;
alter table user_achievements  enable row level security;

create policy badges_read  on badges  for select using (circle_id = my_circle());
create policy badges_write on badges  for all using (circle_id = my_circle()) with check (circle_id = my_circle());
-- achievements — глобальный справочник, только чтение
create policy ach_read  on achievements for select using (true);
-- user_achievements — через circle_id в users
create policy uach_read  on user_achievements for select using (exists (select 1 from users u where u.id = user_achievements.user_id and u.circle_id = my_circle()));
create policy uach_write on user_achievements for all using (exists (select 1 from users u where u.id = user_achievements.user_id and u.circle_id = my_circle())) with check (exists (select 1 from users u where u.id = user_achievements.user_id and u.circle_id = my_circle()));

-- =============================== События, квесты, гороскопы ===============================
alter table events             enable row level security;
alter table quests             enable row level security;
alter table quest_steps        enable row level security;
alter table daily_quests       enable row level security;
alter table daily_horoscopes   enable row level security;
alter table horoscope_texts    enable row level security;

create policy evt_read  on events   for select using (circle_id = my_circle());
create policy evt_write on events   for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy qst_read  on quests   for select using (circle_id = my_circle());
create policy qst_write on quests   for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy qstp_read  on quest_steps for select using (exists (select 1 from quests q where q.id = quest_steps.quest_id and q.circle_id = my_circle()));
create policy qstp_write on quest_steps for all using (exists (select 1 from quests q where q.id = quest_steps.quest_id and q.circle_id = my_circle())) with check (exists (select 1 from quests q where q.id = quest_steps.quest_id and q.circle_id = my_circle()));
create policy dq_read  on daily_quests     for select using (circle_id = my_circle());
create policy dq_write on daily_quests     for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy dh_read  on daily_horoscopes for select using (circle_id = my_circle());
create policy dh_write on daily_horoscopes for all using (circle_id = my_circle()) with check (circle_id = my_circle());
-- horoscope_texts — глобальный справочник, только чтение
create policy ht_read  on horoscope_texts for select using (true);

-- =============================== Карточки ===============================
alter table rarities        enable row level security;
alter table card_types      enable row level security;
alter table user_cards      enable row level security;
alter table card_listings   enable row level security;

-- rarities, card_types — глобальные справочники, только чтение
create policy rar_read  on rarities   for select using (true);
create policy ct_read   on card_types for select using (true);
create policy uc_read   on user_cards for select using (circle_id = my_circle());
create policy uc_write  on user_cards for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy cl_read   on card_listings for select using (circle_id = my_circle());
create policy cl_write  on card_listings for all using (circle_id = my_circle()) with check (circle_id = my_circle());

-- =============================== Банк (глобальный) ===============================
alter table bank_account  enable row level security;
-- банк — только чтение для всех авторизованных
create policy bank_read on bank_account for select using (true);

-- =============================== Auth-таблицы (migration_auth.sql) ===============================
-- adults, memberships, device_tokens, link_tokens, adult_sessions
-- Защита: только чтение своих записей. Запись — через SECURITY DEFINER функции.

alter table adults          enable row level security;
alter table memberships     enable row level security;
alter table device_tokens   enable row level security;
alter table link_tokens     enable row level security;
alter table adult_sessions  enable row level security;

create policy adults_read  on adults  for select using (circle_id = my_circle());
create policy adults_write on adults  for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy mem_read  on memberships for select using (circle_id = my_circle());
create policy mem_write on memberships for all using (circle_id = my_circle()) with check (circle_id = my_circle());
-- device_tokens: ребёнок видит только свои токены
create policy dt_read  on device_tokens for select using (exists (select 1 from users u where u.id = device_tokens.child_id and u.circle_id = my_circle()));
create policy dt_write on device_tokens for all using (exists (select 1 from users u where u.id = device_tokens.child_id and u.circle_id = my_circle())) with check (exists (select 1 from users u where u.id = device_tokens.child_id and u.circle_id = my_circle()));
-- link_tokens, adult_sessions: родитель видит только свои
create policy lt_read  on link_tokens    for select using (circle_id = my_circle());
create policy lt_write on link_tokens    for all using (circle_id = my_circle()) with check (circle_id = my_circle());
create policy as_read  on adult_sessions for select using (circle_id = my_circle());
create policy as_write on adult_sessions for all using (circle_id = my_circle()) with check (circle_id = my_circle());
