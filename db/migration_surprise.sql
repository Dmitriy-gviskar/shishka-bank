-- Анонимная «Шишка-сюрприз» + расследование (роль Детектива). Всё аддитивно.

-- 1. флаги анонимности на транзакции перевода
alter table transactions add column if not exists is_anonymous boolean not null default false;
alter table transactions add column if not exists revealed      boolean not null default false;

-- 2. анонимный подарок: как transfer_cones, но даритель скрыт; щедрость +2 (анонимная = благороднее)
create or replace function transfer_surprise(p_from uuid, p_to uuid, p_amount int)
returns void language plpgsql security definer set search_path = public as $$
declare w_from wallets; c_id uuid;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_from = p_to then raise exception 'cannot transfer to self'; end if;
  perform 1 from wallets where user_id in (p_from, p_to) order by user_id for update;
  select * into w_from from wallets where user_id = p_from;
  if not found then raise exception 'sender wallet not found'; end if;
  if w_from.balance < p_amount then raise exception 'not enough cones: have %, need %', w_from.balance, p_amount; end if;

  update wallets set balance = balance - p_amount, total_spent = total_spent + p_amount where user_id = p_from;
  update wallets set balance = balance + p_amount, total_earned = total_earned + p_amount where user_id = p_to;

  select circle_id into c_id from users where id = p_from;
  insert into transactions(circle_id, from_user, to_user, amount, type, message, is_anonymous)
    values (c_id, p_from, p_to, p_amount, 'transfer', 'Шишка-сюрприз', true);

  perform bump_reputation(p_from, 'generosity', 2);
  perform check_achievements(p_from);
end $$;

-- 3. расследование: платишь 1 шишку (в кассу банка), узнаёшь дарителя, +мудрость, достижение Детектив
create or replace function investigate_surprise(p_child uuid, p_tx uuid)
returns text language plpgsql security definer set search_path = public as $$
declare tx transactions; w wallets; sender_name text; c_id uuid; fee int := 1;
begin
  select * into tx from transactions where id = p_tx for update;
  if not found or tx.to_user <> p_child or not tx.is_anonymous then raise exception 'no such surprise'; end if;
  if tx.revealed then                                    -- уже раскрыто — просто вернуть имя
    return (select name from users where id = tx.from_user);
  end if;
  select * into w from wallets where user_id = p_child for update;
  if w.balance < fee then raise exception 'not enough cones'; end if;

  update wallets set balance = balance - fee, total_spent = total_spent + fee where user_id = p_child;
  select circle_id into c_id from users where id = p_child;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, p_child, null, fee, 'fee', 'Расследование сюрприза');
  update bank_account set treasury = treasury + fee where id = 'main';

  update transactions set revealed = true where id = p_tx;
  perform bump_reputation(p_child, 'wisdom', 1);
  perform check_achievements(p_child);
  return (select name from users where id = tx.from_user);
end $$;

-- 4. метрика «расследовано сюрпризов» (пересоздаём с новой строкой)
create or replace function achievement_metric(p_child uuid, p_metric text)
returns int language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'transfers_count'   then (select count(*) from transactions where from_user = p_child and type = 'transfer')
    when 'gifts_sum'         then (select coalesce(sum(amount),0) from transactions where from_user = p_child and type = 'transfer')
    when 'tasks_done'        then (select count(*) from tasks where child_id = p_child and status = 'done')
    when 'cones_earned'      then (select coalesce(total_earned,0) from wallets where user_id = p_child)
    when 'longest_streak'    then (select coalesce(longest_streak,0) from users where id = p_child)
    when 'deposits_count'    then (select count(*) from safes where user_id = p_child)
    when 'deposits_closed'   then (select count(*) from safes where user_id = p_child and status = 'unlocked')
    when 'horoscopes_read'   then (select count(*) from daily_horoscopes where child_id = p_child)
    when 'skins_owned'       then (select count(*) from user_skins where user_id = p_child)
    when 'pot_contributions' then (select count(*) from pot_contributions where child_id = p_child)
    when 'purchases_count'   then (select count(*) from purchases where child_id = p_child)
    when 'daily_quests_done' then (select count(*) from daily_quests where child_id = p_child and status = 'done')
    when 'rep_honesty'       then (select coalesce((reputation->>'honesty')::int,0) from users where id = p_child)
    when 'rep_generosity'    then (select coalesce((reputation->>'generosity')::int,0) from users where id = p_child)
    when 'rep_reliability'   then (select coalesce((reputation->>'reliability')::int,0) from users where id = p_child)
    when 'rep_wisdom'        then (select coalesce((reputation->>'wisdom')::int,0) from users where id = p_child)
    when 'total_reputation'  then (select coalesce((reputation->>'honesty')::int,0)+coalesce((reputation->>'generosity')::int,0)+coalesce((reputation->>'reliability')::int,0)+coalesce((reputation->>'wisdom')::int,0) from users where id = p_child)
    when 'cone_rain_caught'  then (select count(*) from transactions where to_user = p_child and message like 'Шишечный дождь%')
    when 'freezes_bought'    then (select count(*) from transactions where from_user = p_child and message = 'Дождик-защитник')
    when 'interest_earned'   then (select coalesce(sum(amount),0) from transactions where to_user = p_child and type = 'interest')
    when 'current_balance'   then (select coalesce(balance,0) from wallets where user_id = p_child)
    when 'cones_spent'       then (select coalesce(total_spent,0) from wallets where user_id = p_child)
    when 'tasks_photo'       then (select count(*) from tasks where child_id = p_child and status = 'done' and proof_url is not null)
    when 'tree_level'        then (select coalesce(tree_level,0) from users where id = p_child)
    when 'transfers_received' then (select count(*) from transactions where to_user = p_child and type = 'transfer')
    when 'gifts_received_sum' then (select coalesce(sum(amount),0) from transactions where to_user = p_child and type = 'transfer')
    when 'categories_done'   then (select count(distinct category) from tasks where child_id = p_child and status = 'done')
    when 'sales_count'       then (select count(*) from orders where seller_id = p_child and status = 'delivered')
    when 'sales_sum'         then (select coalesce(sum(price),0) from orders where seller_id = p_child and status = 'delivered')
    when 'shop_buys'         then (select count(*) from orders where buyer_id = p_child and status = 'delivered')
    when 'messages_sent'     then (select count(*) from messages where from_user = p_child)
    when 'investigations_done' then (select count(*) from transactions where to_user = p_child and is_anonymous and revealed)
    else 0 end::int
$$;

-- 5. достижения «Детектив» (трек detective)
insert into achievements(code, title, description, metric, threshold, tier, reward) values
  ('detective_1', 'Детектив',      'Раскрой первую тайну анонимной шишки',   'investigations_done', 1,  1, 0),
  ('detective_2', 'Сыщик',         'Раскрой 5 анонимных сюрпризов',          'investigations_done', 5,  2, 10),
  ('detective_3', 'Шерлок Леса',   'Раскрой 15 анонимных сюрпризов',         'investigations_done', 15, 3, 25)
on conflict (code) do nothing;
