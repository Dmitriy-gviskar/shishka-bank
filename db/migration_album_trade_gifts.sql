-- Альбом: рынок/оплата ≠ подарки; подарок шишками → сообщение в чат (как подарок карты).

create or replace function transfer_cones(p_from uuid, p_to uuid, p_amount int, p_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w_from wallets; c_id uuid;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_from = p_to then raise exception 'cannot transfer to self'; end if;

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

  perform send_message(p_from, p_to, 'emoji', 'Дарю тебе ' || p_amount || ' шишек!');

  perform bump_reputation(p_from, 'generosity', 1);
  perform check_achievements(p_from);
end $$;

create or replace function get_album(p_child uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  -- комиссию банка покупателю в ленту не тащим (он платит цену целиком);
  -- продавцу пишем «банк −N», чтобы было ясно, почему пришло меньше
  with tx as (
    select t.*,
      (select f.amount from transactions f
        where f.type = 'fee' and f.from_user = t.from_user
          and f.message like 'Комиссия%'
          and f.created_at between t.created_at - interval '2 seconds'
                               and t.created_at + interval '2 seconds'
        order by f.created_at limit 1) as fee_amt
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
        when type = 'transfer' and message in ('Покупка карты на рынке','Продажа по заявке','Аукцион: продажа карты')
             and to_user = p_child then 'trade_in'
        when type = 'transfer' and message in ('Покупка карты на рынке','Продажа по заявке','Аукцион: продажа карты')
             and from_user = p_child then 'trade_out'
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
        when type = 'transfer' and message = 'Покупка карты на рынке' and to_user = p_child then
          case when coalesce(fee_amt,0) > 0 then 'Карту купили · банк −' || fee_amt else 'Карту купили на рынке' end
        when type = 'transfer' and message = 'Покупка карты на рынке' and from_user = p_child then 'Купил карту на рынке'
        when type = 'transfer' and message = 'Продажа по заявке' and to_user = p_child then
          case when coalesce(fee_amt,0) > 0 then 'Продал по заявке · банк −' || fee_amt else 'Продал карту по заявке' end
        when type = 'transfer' and message = 'Продажа по заявке' and from_user = p_child then 'Купил карту по заявке'
        when type = 'transfer' and message = 'Аукцион: продажа карты' and to_user = p_child then
          case when coalesce(fee_amt,0) > 0 then 'Аукцион · банк −' || fee_amt else 'Продажа с аукциона' end
        when type = 'transfer' and message = 'Аукцион: продажа карты' and from_user = p_child then 'Покупка с аукциона'
        when type = 'transfer' and (message = 'Оплата' or message like 'Оплата %') and to_user = p_child then
          case when coalesce(fee_amt,0) > 0 then coalesce(message,'Оплата') || ' · банк −' || fee_amt else coalesce(message,'Оплата') end
        when type = 'transfer' and message = 'Подарок другу' and to_user = p_child then 'Подарок шишками'
        when type = 'transfer' and message = 'Подарок другу' and from_user = p_child then 'Подарок другу'
        when type = 'transfer' and message = 'Шишка-сюрприз' and to_user = p_child then 'Шишка-сюрприз'
        else coalesce(message, '') end,
      'amount', case
        when type = 'transfer' and from_user = p_child and coalesce(fee_amt,0) > 0
             and (message in ('Покупка карты на рынке','Продажа по заявке','Аукцион: продажа карты')
                  or message = 'Оплата' or message like 'Оплата %')
          then amount + fee_amt
        else amount end,
      'at', created_at) as ev
    from tx

    union all
    select jsonb_build_object('kind', 'achievement', 'title', a.title, 'amount', null, 'at', ua.unlocked_at)
    from user_achievements ua join achievements a on a.code = ua.code
    where ua.child_id = p_child

    union all
    select jsonb_build_object('kind', 'photo', 'title', title, 'amount', null, 'at', completed_at)
    from tasks
    where child_id = p_child and status = 'done' and proof_url is not null and completed_at is not null
  ) src
$$;
