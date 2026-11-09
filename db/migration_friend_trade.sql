-- T29/T30: подарок и рынок между друзьями из разных лесов.
-- Письмо пишем сами: старая send_message на проде всё ещё режет чужой круг
-- и откатывает весь gift_card.

create or replace function gift_card(p_child uuid, p_to uuid, p_type uuid, p_grade int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; c_id uuid; today_n int; t card_types;
begin
  if p_child = p_to then raise exception 'self gift'; end if;
  select circle_id into c_id from users where id=p_child;
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
  insert into messages(circle_id, from_user, to_user, type, content)
    values (c_id, p_child, p_to, 'emoji', 'Дарю тебе карту: ' || t.name || '!');
  perform check_card_rewards(p_to);
  perform check_achievements(p_to);
  return jsonb_build_object('ok', true, 'left_today', 3 - today_n - 1);
end $$;

create or replace function buy_listing(p_child uuid, p_listing uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l card_listings; w wallets; fee int; net int;
begin
  perform assert_market(p_child);
  select * into l from card_listings where id=p_listing for update;
  if not found or l.status <> 'open' then raise exception 'listing unavailable'; end if;
  if l.seller_id = p_child then raise exception 'own listing'; end if;
  if (select circle_id from users where id=p_child) is distinct from l.circle_id then
    if not exists (
      select 1 from friendships
       where user_id=p_child and friend_id=l.seller_id and status='accepted'
    ) then raise exception 'other circle'; end if;
  end if;
  select * into w from wallets where user_id=p_child for update;
  if w.balance < l.price then raise exception 'not enough cones'; end if;
  fee := card_fee(l.price); net := l.price - fee;

  update wallets set balance = balance - l.price, total_spent = total_spent + l.price where user_id=p_child;
  update wallets set balance = balance + net, total_earned = total_earned + net where user_id=l.seller_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (l.circle_id, p_child, l.seller_id, net, 'transfer',
      case when fee > 0 then 'Покупка карты на рынке · цена ' || l.price || ' · банк −' || fee
           else 'Покупка карты на рынке' end);
  if fee > 0 then
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (l.circle_id, p_child, null, fee, 'fee', 'Комиссия рынка');
    update bank_account set treasury = treasury + fee where id = 'main';
  end if;
  insert into user_cards(user_id,type_id,grade,qty) values (p_child,l.type_id,l.grade,1)
    on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
  update card_listings set status='sold', buyer_id=p_child, closed_at=now() where id=p_listing;

  perform notify_child(l.seller_id,
    case when fee > 0
      then 'Карту купили за ' || l.price || ' 🌰. Тебе ' || net || ' — банк взял ' || fee
      else 'Твою карту купили на рынке за ' || l.price || ' 🌰' end);
  perform check_achievements(p_child);
  return jsonb_build_object('ok',true,'fee',fee);
end $$;
