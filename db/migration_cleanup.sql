-- Шишка Банк — чистка типов, конфигурируемые ставки, фикс таймзоны.
-- Применять после migration_rls_extended.sql и migration_fk_indexes.sql.

-- 1. bank_account.treasury: bigint → int (единообразие со всеми денежными колонками)
--    Проверка: если казна > 2.1 млрд — миграция откажется (такого объёма нет в природе).
do $$ declare v bigint;
begin
  select treasury into v from bank_account where id = 'main';
  if v > 2147483647 then
    raise exception 'treasury too large for int: %', v;
  end if;
  alter table bank_account alter column treasury type int using treasury::int;
end $$;

-- 2. Ставки депозита — вынос в отдельную функцию, чтобы не хардкодить в open_safe.
create or replace function safe_interest_rate(p_days int)
returns int language sql immutable as $$
  select case p_days
    when 3  then 5
    when 7  then 10
    when 30 then 20
    else null
  end
$$;

-- open_safe теперь дёргает safe_interest_rate вместо inline case
create or replace function open_safe(p_child uuid, p_amount int, p_days int)
returns safes language plpgsql security definer set search_path = public as $$
declare w wallets; s safes; rate int;
begin
  rate := safe_interest_rate(p_days);
  if rate is null then raise exception 'invalid term: % days (allowed 3/7/30)', p_days; end if;
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;

  select * into w from wallets where user_id = p_child for update;
  if not found then raise exception 'wallet not found'; end if;
  if w.balance < p_amount then
    raise exception 'not enough cones: have %, need %', w.balance, p_amount;
  end if;

  update wallets set balance = balance - p_amount where user_id = p_child;

  insert into safes(user_id, amount, interest_rate, unlock_date)
    values (p_child, p_amount, rate, now() + make_interval(days => p_days))
    returning * into s;

  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    select circle_id, p_child, null, p_amount, 'deposit', s.id, 'Дупло на '||p_days||' дн.'
      from users where id = p_child;

  perform bump_reputation(p_child, 'wisdom', 1);
  perform check_achievements(p_child);
  return s;
end $$;

-- 3. next_monday_15msk — явный часовой пояс, не полагаемся на server timezone
create or replace function next_monday_15msk()
returns timestamptz language sql stable as $$
  with msk as (select now() at time zone 'Europe/Moscow' as t)
  select (date_trunc('week', t) + interval '15 hours'
    + case when (date_trunc('week', t) + interval '15 hours') <= t
           then interval '7 days' else interval '0' end
  ) at time zone 'Europe/Moscow'
  from msk
$$;
