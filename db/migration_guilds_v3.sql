-- Гильдии v3: роли, задания, история, распад, бейджи (аддитивно).

-- 1. Роли в гильдии: founder, treasurer, herald, member.
alter table guild_members add column if not exists role text not null default 'member'
  check (role in ('founder','treasurer','herald','member'));

-- При создании гильдии — founder. Существующим первый участник = founder.
update guild_members gm set role = 'founder'
  from guilds g
  where gm.guild_id = g.id and gm.child_id = g.created_by and gm.role = 'member';

-- 2. Активность гильдии (для авто-сна).
alter table guilds add column if not exists last_activity timestamptz not null default now();
alter table guilds add column if not exists status_v2 text;
update guilds set status_v2 = status;
-- спящий статус
alter table guilds drop constraint if exists guilds_status_check;
alter table guilds add constraint guilds_status_check check (status in ('open','completed','disbanded','sleeping'));
update guilds set status = coalesce(status_v2, 'open');
alter table guilds drop column if exists status_v2;

-- 3. Гильдейские задания: guild_id в tasks (null = личное задание, не null = гильдейское).
alter table tasks add column if not exists guild_id uuid references guilds(id) on delete set null;
alter table tasks add column if not exists guild_task_type text default 'joint'
  check (guild_task_type in ('joint','individual'));  -- joint: награда делится; individual: каждый делает своё

-- 4. История завершённых заказов гильдии (сверх guild_messages — структурированная).
create table if not exists guild_history (
  id         uuid primary key default gen_random_uuid(),
  guild_id   uuid not null references guilds(id) on delete cascade,
  kind       text not null check (kind in ('order_completed','task_created','member_joined','role_changed','awakened')),
  title      text not null,
  amount     int,
  created_at timestamptz not null default now()
);
create index if not exists guild_history_guild_idx on guild_history(guild_id, created_at desc);

-- 5. Метрики для гильдейских достижений (в achievement_metric).
create or replace function achievement_metric(p_child uuid, p_metric text)
returns int language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'guild_orders'     then (select count(*) from guild_history gh
      join guild_members gm on gm.guild_id=gh.guild_id where gm.child_id=p_child and gh.kind='order_completed')
    when 'guild_cones'      then (select coalesce(sum(t.amount),0) from transactions t
      where t.to_user=p_child and t.type='reward' and t.message like 'Заказ гильдии:%')
    when 'guild_founded'    then (select count(*) from guilds g
      where g.created_by=p_child)
    when 'guild_members_recruited' then (select count(distinct gh.title) from guild_history gh
      join guilds g on g.id=gh.guild_id where g.created_by=p_child and gh.kind='member_joined')
    else achievement_metric_legacy(p_child, p_metric)
  end;
$$;

-- сохраняем старую версию как legacy
create or replace function achievement_metric_legacy(p_child uuid, p_metric text)
returns int language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'tasks_done'       then (select count(*) from tasks where child_id=p_child and status='done')
    when 'cones_earned'     then (select coalesce(total_earned,0) from wallets where user_id=p_child)
    when 'cones_spent'      then (select coalesce(total_spent,0) from wallets where user_id=p_child)
    when 'longest_streak'   then (select coalesce(longest_streak,0) from users where id=p_child)
    when 'gifts_sum'        then (select coalesce(sum(amount),0) from transactions
      where from_user=p_child and type='transfer' and message like 'Подарок:%')
    when 'transfers_count'  then (select count(*) from transactions
      where from_user=p_child and type='transfer')
    when 'transfers_received' then (select count(*) from transactions
      where to_user=p_child and type='transfer' and from_user is not null)
    when 'gifts_received_sum' then (select coalesce(sum(amount),0) from transactions
      where to_user=p_child and type='transfer' and message like 'Подарок:%')
    when 'deposits_count'   then (select count(*) from safes where user_id=p_child and status='locked')
    when 'deposits_closed'  then (select count(*) from safes where user_id=p_child and status='unlocked')
    when 'horoscopes_read'  then (select count(*) from daily_horoscopes where child_id=p_child)
    when 'skins_owned'      then (select count(*) from user_skins where user_id=p_child)
    when 'pot_contributions' then (select count(*) from pot_contributions where child_id=p_child)
    when 'purchases_count'  then (select count(*) from purchases where child_id=p_child)
    when 'daily_quests_done' then (select count(*) from daily_quests where child_id=p_child and status='done')
    when 'rep_honesty'      then (select (reputation->>'honesty')::int from users where id=p_child)
    when 'rep_generosity'   then (select (reputation->>'generosity')::int from users where id=p_child)
    when 'rep_reliability'  then (select (reputation->>'reliability')::int from users where id=p_child)
    when 'rep_wisdom'       then (select (reputation->>'wisdom')::int from users where id=p_child)
    when 'total_reputation' then (select (reputation->>'honesty')::int+(reputation->>'generosity')::int+(reputation->>'reliability')::int+(reputation->>'wisdom')::int from users where id=p_child)
    when 'cone_rain_caught' then (select count(*) from transactions
      where to_user=p_child and type='rain')
    when 'freezes_bought'   then (select streak_freezes from users where id=p_child)
    when 'interest_earned'  then (select coalesce(sum(amount),0) from transactions
      where to_user=p_child and type='interest')
    when 'current_balance'  then (select coalesce(balance,0) from wallets where user_id=p_child)
    when 'tasks_photo'      then (select count(*) from tasks
      where child_id=p_child and needs_photo and status='done')
    when 'tree_level'       then (select coalesce(tree_level,1) from users where id=p_child)
    when 'categories_done'  then (select count(distinct t.category) from tasks t
      where t.child_id=p_child and t.status='done' and t.category is not null)
    when 'sales_count'      then (select count(*) from orders where seller_id=p_child and status='delivered')
    when 'sales_sum'        then (select coalesce(sum(price),0) from orders where seller_id=p_child and status='delivered')
    when 'shop_buys'        then (select count(*) from orders where buyer_id=p_child and status='delivered')
    when 'messages_sent'    then (select count(*) from messages where from_user=p_child)
    when 'investigations_done' then (select count(*) from surprises where revealed=true and child_id=p_child)
    when 'cards_merged'     then (select coalesce(sum(merged),0) from user_cards where user_id=p_child)
    when 'beings_completed' then (select count(*) from user_cards uc
      join card_types ct on ct.id=uc.type_id where uc.user_id=p_child group by uc.type_id having count(distinct uc.grade)=6)
    else 0
  end;
$$;

-- 6. Выплата заказа гильдии с записью в историю (пересоздаём).
create or replace function guild_payout(p_guild uuid, p_amount int, p_title text default 'Заказ гильдии')
returns int language plpgsql security definer set search_path = public as $$
declare g guilds; total int; paid int := 0; n int; i int := 0; cut int; m record;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into g from guilds where id = p_guild for update;
  if not found then raise exception 'guild not found'; end if;
  if g.status <> 'open' then raise exception 'guild is not open'; end if;

  select coalesce(sum(share),0), count(*) into total, n from guild_members where guild_id = p_guild;
  if total = 0 then raise exception 'guild has no members'; end if;

  for m in select * from guild_members where guild_id = p_guild order by child_id loop
    i := i + 1;
    if i = n then cut := p_amount - paid;
    else cut := (p_amount * m.share) / total; end if;
    paid := paid + cut;
    if cut > 0 then
      update wallets set balance = balance + cut, total_earned = total_earned + cut
        where user_id = m.child_id;
      insert into transactions(circle_id, from_user, to_user, amount, type, message)
        values (g.circle_id, null, m.child_id, cut, 'reward', p_title);
      perform check_achievements(m.child_id);
    end if;
  end loop;

  -- активность + запись в историю
  update guilds set last_activity = now() where id = p_guild;
  insert into guild_history(guild_id, kind, title, amount) values (p_guild, 'order_completed', p_title, p_amount);
  insert into guild_messages(guild_id, from_user, content) values(p_guild, null, p_title || ' — выплата ' || p_amount || ' шишек');

  return paid;
end $$;

-- 7. Обновление last_activity при действиях в гильдии.
create or replace function bump_guild_activity(p_guild uuid)
returns void language sql security definer set search_path = public as $$
  update guilds set last_activity = now() where id = p_guild;
$$;

-- 8. Смена роли участника (только основатель).
create or replace function guild_set_role(p_guild uuid, p_child uuid, p_new_role text)
returns void language plpgsql security definer set search_path = public as $$
declare g guilds;
begin
  select * into g from guilds where id = p_guild;
  if not found then raise exception 'guild not found'; end if;
  if g.status <> 'open' then raise exception 'guild is not open'; end if;
  if not exists (select 1 from guild_members where guild_id = p_guild and child_id = p_child and role = 'founder') then
    raise exception 'only founder can change roles'; end if;
  if p_new_role = 'founder' then raise exception 'cannot reassign founder'; end if;
  update guild_members set role = p_new_role where guild_id = p_guild and child_id = p_child;
  if not found then raise exception 'member not found'; end if;
  insert into guild_history(guild_id, kind, title) values (p_guild, 'role_changed', (select name from users where id = p_child) || ' → ' || p_new_role);
  perform bump_guild_activity(p_guild);
end $$;

-- 9. Смена доли участника (казначей или основатель).
create or replace function guild_set_share(p_guild uuid, p_child uuid, p_share int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_share < 1 then raise exception 'share must be positive'; end if;
  if not exists (select 1 from guild_members where guild_id = p_guild and child_id = p_child and role in ('founder','treasurer')) then
    raise exception 'only founder or treasurer can change shares'; end if;
  update guild_members set share = p_share where guild_id = p_guild and child_id = p_child;
  if not found then raise exception 'member not found'; end if;
  perform bump_guild_activity(p_guild);
end $$;

-- 10. Разбудить спящую гильдию (любой участник).
create or replace function guild_awaken(p_guild uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update guilds set status = 'open', last_activity = now() where id = p_guild and status = 'sleeping';
  if not found then raise exception 'guild not found or not sleeping'; end if;
  insert into guild_history(guild_id, kind, title) values (p_guild, 'awakened', 'Гильдия пробудилась');
end $$;

-- 11. Авто-сон: периодическая задача (вызывать раз в час).
create or replace function sweep_sleeping_guilds(p_idle_days int default 7)
returns int language plpgsql security definer set search_path = public as $$
declare cnt int := 0;
begin
  update guilds set status = 'sleeping'
    where status = 'open' and last_activity < now() - make_interval(days => p_idle_days);
  get diagnostics cnt = row_count;
  return cnt;
end $$;
