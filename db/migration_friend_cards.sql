-- Карты между друзьями из разных лесов: подарок и заявка «хочу такую».
-- Дружбу по-прежнему проверяет сервер (assertFriend); SQL больше не режет «other circle».

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
  perform send_message(p_child, p_to, 'emoji', 'Дарю тебе карту: ' || t.name || '!');
  perform check_card_rewards(p_to);
  perform check_achievements(p_to);
  return jsonb_build_object('ok', true, 'left_today', 3 - today_n - 1);
end $$;

create or replace function fill_want(p_seller uuid, p_want uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w card_wants; have int; bal int; fee int; net int;
begin
  perform assert_market(p_seller);
  select * into w from card_wants where id=p_want for update;
  if not found or w.status <> 'open' then raise exception 'want unavailable'; end if;
  if w.buyer_id = p_seller then raise exception 'own want'; end if;
  if (select circle_id from users where id=p_seller) is distinct from w.circle_id then
    if not exists (
      select 1 from friendships
       where user_id=p_seller and friend_id=w.buyer_id and status='accepted'
    ) then raise exception 'other circle'; end if;
  end if;

  select qty into have from user_cards where user_id=p_seller and type_id=w.type_id and grade=w.grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;
  select balance into bal from wallets where user_id=w.buyer_id for update;
  if bal is null or bal < w.price then raise exception 'buyer has no cones'; end if;
  fee := card_fee(w.price); net := w.price - fee;

  update wallets set balance=balance-w.price, total_spent=total_spent+w.price where user_id=w.buyer_id;
  update wallets set balance=balance+net, total_earned=total_earned+net where user_id=p_seller;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (w.circle_id, w.buyer_id, p_seller, net, 'transfer',
      case when fee > 0 then 'Продажа по заявке · цена ' || w.price || ' · банк −' || fee
           else 'Продажа по заявке' end);
  if fee > 0 then
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (w.circle_id, w.buyer_id, null, fee, 'fee', 'Комиссия рынка');
    update bank_account set treasury = treasury + fee where id = 'main';
  end if;

  update user_cards set qty=qty-1 where user_id=p_seller and type_id=w.type_id and grade=w.grade;
  delete from user_cards where user_id=p_seller and type_id=w.type_id and grade=w.grade and qty<=0;
  insert into user_cards(user_id, type_id, grade, qty) values (w.buyer_id, w.type_id, w.grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;

  update card_wants set status='filled', closed_at=now() where id=p_want;
  perform notify_child(w.buyer_id, 'По твоей заявке нашлась карта — она уже в альбоме 🙋');
  perform notify_child(p_seller,
    case when fee > 0
      then 'Продажа по заявке за ' || w.price || ' 🌰. Тебе ' || net || ' — банк взял ' || fee
      else 'Продажа по заявке за ' || w.price || ' 🌰 — шишки у тебя' end);
  perform check_card_rewards(w.buyer_id);
  perform check_achievements(w.buyer_id);
  return jsonb_build_object('ok', true, 'earned', net, 'fee', fee);
end $$;

-- Золотой аукцион — весь лес: ставить может любой, не только свой круг.
create or replace function bid_card_auction(p_child uuid, p_auction uuid, p_amount int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a card_auctions; need int; bal int; who text;
begin
  perform assert_market(p_child);
  select * into a from card_auctions where id=p_auction for update;
  if not found or a.status <> 'live' or now() >= a.ends_at then raise exception 'auction closed'; end if;
  if a.seller_id = p_child then raise exception 'own auction'; end if;
  if a.leader_id = p_child then raise exception 'already leading'; end if;

  need := case when a.current_bid is null then a.start_price
               else greatest(a.current_bid + 1, a.current_bid + a.current_bid/10) end;
  if p_amount < need then raise exception 'bid too low: need %', need; end if;
  select balance into bal from wallets where user_id=p_child for update;
  if bal < p_amount then raise exception 'not enough cones'; end if;

  if a.leader_id is not null then
    update wallets set balance=balance+a.current_bid, total_spent=greatest(0,total_spent-a.current_bid)
      where user_id=a.leader_id;
    perform notify_child(a.leader_id, 'Твою ставку перебили — шишки вернулись в кошелёк 🔨');
  end if;
  update wallets set balance=balance-p_amount, total_spent=total_spent+p_amount where user_id=p_child;
  update card_auctions set current_bid=p_amount, leader_id=p_child where id=p_auction;

  select name into who from users where id=p_child;
  perform notify_child(a.seller_id, 'Новая ставка на твоём аукционе: ' || p_amount || ' 🌰 от ' || who);
  return jsonb_build_object('ok', true, 'bid', p_amount, 'next', greatest(p_amount+1, p_amount + p_amount/10));
end $$;

-- Кто уже привёл друга по ссылке — сразу друзья, без нового кода.
insert into friendships(user_id, friend_id, status)
select referrer_id, referred_id, 'accepted' from referrals
 where referrer_id is not null and referred_id is not null and referrer_id <> referred_id
union
select referred_id, referrer_id, 'accepted' from referrals
 where referrer_id is not null and referred_id is not null and referrer_id <> referred_id
on conflict (user_id, friend_id) do update set status = 'accepted';
