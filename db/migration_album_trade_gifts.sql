-- Альбом: рынок/оплата ≠ подарки; подарок шишками → чат; комиссия видна продавцу.

create or replace function transfer_cones(p_from uuid, p_to uuid, p_amount int, p_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w_from wallets; c_id uuid;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_from = p_to then raise exception 'cannot transfer to self'; end if;

  -- блокируем оба кошелька в детерминированном порядке (по user_id) — против дедлоков
  perform 1 from wallets where user_id in (p_from, p_to)
    order by user_id for update;

  select * into w_from from wallets where user_id = p_from;
  if not found then raise exception 'sender wallet not found'; end if;
  if w_from.balance < p_amount then
    raise exception 'not enough cones: have %, need %', w_from.balance, p_amount;
  end if;

  update wallets set balance = balance - p_amount, total_spent = total_spent + p_amount
    where user_id = p_from;
  update wallets set balance = balance + p_amount, total_earned = total_earned + p_amount
    where user_id = p_to;

  select circle_id into c_id from users where id = p_from;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, p_from, p_to, p_amount, 'transfer', coalesce(p_message, 'Подарок другу'));

  -- как подарок карты: след в чате, чтобы не плодить отдельный список «кто подарил»
  perform send_message(p_from, p_to, 'emoji', 'Дарю тебе ' || p_amount || ' шишек!');

  perform bump_reputation(p_from, 'generosity', 1);       -- подарок = щедрость
  perform check_achievements(p_from);                     -- Даритель/Меценат/Великий Меценат
end $$;

create or replace function pay_cones(p_from uuid, p_to uuid, p_amount int, p_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w_from wallets; c_id uuid; fee int := 1; net int;
begin
  if p_from = p_to then raise exception 'cannot pay yourself'; end if;
  if p_amount <= fee then raise exception 'amount must exceed the % cone fee', fee; end if;
  net := p_amount - fee;

  perform 1 from wallets where user_id in (p_from, p_to) order by user_id for update;
  select * into w_from from wallets where user_id = p_from;
  if not found then raise exception 'sender wallet not found'; end if;
  if w_from.balance < p_amount then
    raise exception 'not enough cones: have %, need %', w_from.balance, p_amount;
  end if;

  update wallets set balance = balance - p_amount, total_spent = total_spent + p_amount
    where user_id = p_from;
  update wallets set balance = balance + net, total_earned = total_earned + net
    where user_id = p_to;

  select circle_id into c_id from users where id = p_from;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, p_from, p_to, net, 'transfer',
      coalesce(p_message, 'Оплата') || ' · цена ' || p_amount || ' · банк −' || fee);
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, p_from, null, fee, 'fee', 'Комиссия банка');
  update bank_account set treasury = treasury + fee where id = 'main';   -- комиссия в кассу банка
end $$;

create or replace function get_album(p_child uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  -- комиссию банка покупателю в ленту не тащим (он платит цену целиком);
  -- продавцу пишем «банк −N», чтобы было ясно, почему пришло меньше
  with tx as (
    select t.*,
      coalesce(
        (select f.amount from transactions f
          where f.type = 'fee' and f.from_user = t.from_user
            and f.message like 'Комиссия%'
            and f.created_at between t.created_at - interval '2 seconds'
                                 and t.created_at + interval '2 seconds'
          order by f.created_at limit 1),
        nullif(substring(t.message from 'банк −([0-9]+)'), '')::int,
        0) as fee_amt
    from transactions t
    where (t.to_user = p_child or t.from_user = p_child)
      and not (t.type = 'fee' and t.from_user = p_child and t.message like 'Комиссия%')
  )
  select coalesce(jsonb_agg(ev order by (ev->>'at')::timestamptz desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'kind', case
        when type = 'reward' then 'earn'
        when type = 'transfer' and coalesce(is_anonymous,false) and to_user = p_child then 'gift_in'
        when type = 'transfer' and message = 'Подарок другу' and to_user = p_child then 'gift_in'
        when type = 'transfer' and message = 'Подарок другу' and from_user = p_child then 'gift_out'
        when type = 'transfer' and message like 'Покупка карты на рынке%' and to_user = p_child then 'trade_in'
        when type = 'transfer' and message like 'Покупка карты на рынке%' and from_user = p_child then 'trade_out'
        when type = 'transfer' and message like 'Продажа по заявке%' and to_user = p_child then 'trade_in'
        when type = 'transfer' and message like 'Продажа по заявке%' and from_user = p_child then 'trade_out'
        when type = 'transfer' and message like 'Аукцион: продажа карты%' and to_user = p_child then 'trade_in'
        when type = 'transfer' and message like 'Аукцион: продажа карты%' and from_user = p_child then 'trade_out'
        when type = 'transfer' and (message = 'Оплата' or message like 'Оплата %') and to_user = p_child then 'pay_in'
        when type = 'transfer' and (message = 'Оплата' or message like 'Оплата %') and from_user = p_child then 'pay_out'
        when type = 'transfer' and to_user = p_child then 'trade_in'
        when type = 'transfer' and from_user = p_child then 'trade_out'
        when type = 'purchase' then 'buy'
        when type = 'interest' then 'interest'
        when type = 'deposit' then 'deposit'
        when type = 'insurance' then 'insurance'
        when type = 'pot_contribution' then 'pot'
        when type = 'fee' then 'spend'
        when type = 'payout' then 'payout'
        else type end,
      'title', case
        -- продавцу: цена / тебе / банк — иначе «почему 9, а не 10?»
        when type = 'transfer' and message like 'Покупка карты на рынке%' and to_user = p_child then
          case when fee_amt > 0 then 'Продажа за ' || (amount + fee_amt) || ' · тебе ' || amount || ' (банк −' || fee_amt || ')'
               else 'Карту купили на рынке' end
        when type = 'transfer' and message like 'Покупка карты на рынке%' and from_user = p_child then 'Купил карту на рынке'
        when type = 'transfer' and message like 'Продажа по заявке%' and to_user = p_child then
          case when fee_amt > 0 then 'Продажа за ' || (amount + fee_amt) || ' · тебе ' || amount || ' (банк −' || fee_amt || ')'
               else 'Продал карту по заявке' end
        when type = 'transfer' and message like 'Продажа по заявке%' and from_user = p_child then 'Купил карту по заявке'
        when type = 'transfer' and message like 'Аукцион: продажа карты%' and to_user = p_child then
          case when fee_amt > 0 then 'Аукцион за ' || (amount + fee_amt) || ' · тебе ' || amount || ' (банк −' || fee_amt || ')'
               else 'Продажа с аукциона' end
        when type = 'transfer' and message like 'Аукцион: продажа карты%' and from_user = p_child then 'Покупка с аукциона'
        when type = 'transfer' and (message = 'Оплата' or message like 'Оплата %') and to_user = p_child then
          case when fee_amt > 0 then 'Оплата ' || (amount + fee_amt) || ' · тебе ' || amount || ' (банк −' || fee_amt || ')'
               else coalesce(nullif(split_part(message, ' ·', 1), ''), 'Оплата') end
        when type = 'transfer' and message = 'Подарок другу' and to_user = p_child then 'Подарок шишками'
        when type = 'transfer' and message = 'Подарок другу' and from_user = p_child then 'Подарок другу'
        when type = 'transfer' and message = 'Шишка-сюрприз' and to_user = p_child then 'Шишка-сюрприз'
        else coalesce(message, '') end,
      -- покупатель видит полную цену (нетто продавцу + комиссия), без отдельной строки налога
      'amount', case
        when type = 'transfer' and from_user = p_child and fee_amt > 0
             and (message like 'Покупка карты на рынке%' or message like 'Продажа по заявке%'
                  or message like 'Аукцион: продажа карты%'
                  or message = 'Оплата' or message like 'Оплата %')
          then amount + fee_amt
        else amount end,
      'at', created_at) as ev
    from tx

    union all
    -- открытые достижения
    select jsonb_build_object('kind', 'achievement', 'title', a.title, 'amount', null, 'at', ua.unlocked_at)
    from user_achievements ua join achievements a on a.code = ua.code
    where ua.child_id = p_child

    union all
    -- задания с фотоотчётом (памятные моменты)
    select jsonb_build_object('kind', 'photo', 'title', title, 'amount', null, 'at', completed_at)
    from tasks
    where child_id = p_child and status = 'done' and proof_url is not null and completed_at is not null
  ) src
$$;

create or replace function buy_listing(p_child uuid, p_listing uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l card_listings; w wallets;
begin
  select * into l from card_listings where id=p_listing for update;
  if not found or l.status <> 'open' then raise exception 'listing unavailable'; end if;
  if l.seller_id = p_child then raise exception 'own listing'; end if;
  select * into w from wallets where user_id=p_child for update;
  if w.balance < l.price then raise exception 'not enough cones'; end if;

  update wallets set balance = balance - l.price, total_spent = total_spent + l.price where user_id=p_child;
  update wallets set balance = balance + l.price, total_earned = total_earned + l.price where user_id=l.seller_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (l.circle_id, p_child, l.seller_id, l.price, 'transfer', 'Покупка карты на рынке');
  insert into user_cards(user_id,type_id,grade,qty) values (p_child,l.type_id,l.grade,1)
    on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
  update card_listings set status='sold', buyer_id=p_child, closed_at=now() where id=p_listing;

  perform check_achievements(p_child);
  return jsonb_build_object('ok',true);
end $$;

create or replace function fill_want(p_seller uuid, p_want uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w card_wants; have int; bal int;
begin
  select * into w from card_wants where id=p_want for update;
  if not found or w.status <> 'open' then raise exception 'want unavailable'; end if;
  if w.buyer_id = p_seller then raise exception 'own want'; end if;
  if (select circle_id from users where id=p_seller) is distinct from w.circle_id then raise exception 'other circle'; end if;

  select qty into have from user_cards where user_id=p_seller and type_id=w.type_id and grade=w.grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;
  select balance into bal from wallets where user_id=w.buyer_id for update;
  if bal is null or bal < w.price then raise exception 'buyer has no cones'; end if;

  update wallets set balance=balance-w.price, total_spent=total_spent+w.price where user_id=w.buyer_id;
  update wallets set balance=balance+w.price, total_earned=total_earned+w.price where user_id=p_seller;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (w.circle_id, w.buyer_id, p_seller, w.price, 'transfer', 'Продажа по заявке');

  update user_cards set qty=qty-1 where user_id=p_seller and type_id=w.type_id and grade=w.grade;
  delete from user_cards where user_id=p_seller and type_id=w.type_id and grade=w.grade and qty<=0;
  insert into user_cards(user_id, type_id, grade, qty) values (w.buyer_id, w.type_id, w.grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;

  update card_wants set status='filled', closed_at=now() where id=p_want;
  perform notify_child(w.buyer_id, 'По твоей заявке нашлась карта — она уже в альбоме 🙋');
  perform check_card_rewards(w.buyer_id);
  perform check_achievements(w.buyer_id);
  return jsonb_build_object('ok', true, 'earned', w.price);
end $$;

create or replace function close_card_auction(p_auction uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a card_auctions; fee int; net int; card_name text;
begin
  select * into a from card_auctions where id=p_auction for update;
  if not found or a.status <> 'live' then return jsonb_build_object('ok', false); end if;
  select name into card_name from card_types where id = a.type_id;

  if a.leader_id is null then
    insert into user_cards(user_id,type_id,grade,qty) values (a.seller_id,a.type_id,a.grade,1)
      on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
    update card_auctions set status='cancelled' where id=p_auction;
    perform notify_child(a.seller_id, 'Торги закончились без ставок — карта «' || card_name || '» вернулась к тебе');
    return jsonb_build_object('ok', true, 'sold', false);
  end if;

  fee := card_fee(a.current_bid); net := a.current_bid - fee;
  update wallets set balance=balance+net, total_earned=total_earned+net where user_id=a.seller_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (a.circle_id, a.leader_id, a.seller_id, net, 'transfer',
      case when fee > 0 then 'Аукцион: продажа карты · цена ' || a.current_bid || ' · банк −' || fee
           else 'Аукцион: продажа карты' end);
  if fee > 0 then
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (a.circle_id, a.leader_id, null, fee, 'fee', 'Комиссия аукциона');
    update bank_account set treasury = treasury + fee where id='main';
  end if;
  insert into user_cards(user_id,type_id,grade,qty) values (a.leader_id,a.type_id,a.grade,1)
    on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
  update card_auctions set status='sold' where id=p_auction;

  perform notify_child(a.leader_id, 'Ты выиграл торги! Карта «' || card_name || '» твоя 👑');
  perform notify_child(a.seller_id,
    case when fee > 0
      then 'Карта «' || card_name || '» ушла за ' || a.current_bid || ' 🌰. Тебе ' || net || ' — банк взял ' || fee
      else 'Карта «' || card_name || '» ушла с молотка за ' || a.current_bid || ' 🌰' end);
  perform check_card_rewards(a.leader_id);
  perform check_achievements(a.leader_id);
  return jsonb_build_object('ok', true, 'sold', true, 'price', a.current_bid);
end $$;
