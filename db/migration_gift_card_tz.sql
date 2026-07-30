-- Фикс: дневной лимит подарков картами (gift_card) сравнивал ::date с timestamptz —
-- дата неявно приводилась к полуночи в таймзоне СЕССИИ (обычно UTC), а не Europe/Moscow.
-- Каждый день с 21:00 до 23:59 UTC (00:00–02:59 по Москве) граница считалась на 3 часа
-- раньше настоящей полуночи по Москве, и только что подаренные карты не попадали
-- в счётчик «сегодня» — лимит 3 подарка/день не срабатывал.

create or replace function gift_card(p_child uuid, p_to uuid, p_type uuid, p_grade int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; c_id uuid; today_n int; t card_types;
begin
  if p_child = p_to then raise exception 'self gift'; end if;
  select circle_id into c_id from users where id=p_child;
  if (select circle_id from users where id=p_to) is distinct from c_id then raise exception 'other circle'; end if;
  select count(*) into today_n from card_gifts
    where from_user=p_child and created_at >= date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow';
  if today_n >= 3 then raise exception 'daily gift limit'; end if;

  select qty into have from user_cards where user_id=p_child and type_id=p_type and grade=p_grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;

  update user_cards set qty=qty-1 where user_id=p_child and type_id=p_type and grade=p_grade;
  delete from user_cards where user_id=p_child and type_id=p_type and grade=p_grade and qty<=0;
  insert into user_cards(user_id, type_id, grade, qty) values (p_to, p_type, p_grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;
  insert into card_gifts(circle_id, from_user, to_user, type_id, grade) values (c_id, p_child, p_to, p_type, p_grade);

  select * into t from card_types where id=p_type;
  perform send_message(p_child, p_to, 'emoji', 'Дарю тебе карту: ' || t.name || '!');
  perform check_card_rewards(p_to);
  perform check_achievements(p_to);
  return jsonb_build_object('ok', true, 'left_today', 3 - today_n - 1);
end $$;
