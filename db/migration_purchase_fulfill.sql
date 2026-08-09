-- Исполнение / отмена покупок в магазине впечатлений (promised → fulfilled|canceled)
create or replace function fulfill_purchase(p_purchase uuid)
returns purchases language plpgsql security definer set search_path = public as $$
declare pu purchases;
begin
  select * into pu from purchases where id = p_purchase for update;
  if not found then raise exception 'purchase not found'; end if;
  if pu.status <> 'promised' then raise exception 'purchase not promised (status=%)', pu.status; end if;
  update purchases set status = 'fulfilled', fulfilled_at = now()
    where id = p_purchase returning * into pu;
  return pu;
end $$;

-- Отмена обещания: вернуть шишки ребёнку
create or replace function cancel_purchase(p_purchase uuid)
returns purchases language plpgsql security definer set search_path = public as $$
declare pu purchases; it_title text; c_id uuid;
begin
  select * into pu from purchases where id = p_purchase for update;
  if not found then raise exception 'purchase not found'; end if;
  if pu.status <> 'promised' then raise exception 'purchase not promised (status=%)', pu.status; end if;

  update wallets set balance = balance + pu.price,
                     total_spent = greatest(0, total_spent - pu.price)
    where user_id = pu.child_id;
  update purchases set status = 'canceled' where id = p_purchase returning * into pu;

  select title into it_title from shop_items where id = pu.item_id;
  select circle_id into c_id from users where id = pu.child_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    values (c_id, null, pu.child_id, pu.price, 'refund', pu.id,
            'Возврат: ' || coalesce(it_title, 'приз'));
  return pu;
end $$;

-- Покупка: circle_id берём у ребёнка, если у приза он null (глобальный каталог)
create or replace function purchase_item(p_child uuid, p_item uuid)
returns purchases language plpgsql security definer set search_path = public as $$
declare it shop_items; w wallets; pu purchases; c_id uuid;
begin
  select * into it from shop_items where id = p_item;
  if not found or not it.is_active then raise exception 'item unavailable'; end if;
  select circle_id into c_id from users where id = p_child;
  c_id := coalesce(it.circle_id, c_id);

  select * into w from wallets where user_id = p_child for update;
  if not found then raise exception 'wallet not found'; end if;
  if w.balance < it.price then
    raise exception 'not enough cones: have %, need %', w.balance, it.price;
  end if;

  update wallets set balance = balance - it.price,
                     total_spent = total_spent + it.price
    where user_id = p_child;

  insert into purchases(circle_id, child_id, item_id, price)
    values (c_id, p_child, it.id, it.price) returning * into pu;

  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    values (c_id, p_child, null, it.price, 'purchase', pu.id, it.title);
  perform check_achievements(p_child);
  return pu;
end $$;

-- Паспорт: черты не выше 100
create or replace function bump_reputation(p_user uuid, p_trait text, p_delta int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_trait not in ('honesty','generosity','reliability','wisdom') then
    raise exception 'unknown reputation trait: %', p_trait;
  end if;
  update users
    set reputation = jsonb_set(reputation, array[p_trait],
        to_jsonb(least(100, coalesce((reputation->>p_trait)::int, 0) + p_delta)))
    where id = p_user;
end $$;
