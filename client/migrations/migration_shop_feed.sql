-- T18: в ленте покупателя видно, что именно купил
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
        when type = 'transfer' and message like 'Покупка в лавке%' and from_user = p_child then
          'Купил в лавке «' || coalesce(nullif(trim(split_part(message, ': ', 2)), ''), 'товар') || '»'
        when type = 'transfer' and message like 'Покупка в лавке%' and to_user = p_child then
          'Продал в лавке «' || coalesce(nullif(trim(split_part(message, ': ', 2)), ''), 'товар') || '»'
        when type = 'purchase' then 'Купил «' || coalesce(nullif(message, ''), 'приз') || '»'
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

