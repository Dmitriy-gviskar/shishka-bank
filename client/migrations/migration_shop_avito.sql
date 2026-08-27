-- T16: лавка как Авито — резерв → передача (handed) → подтверждение → выплата
alter table orders add column if not exists handed_at timestamptz;
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('reserved', 'handed', 'delivered', 'canceled'));

create or replace function hand_order(p_order uuid, p_seller uuid)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.seller_id <> p_seller then raise exception 'not the seller'; end if;
  if o.status <> 'reserved' then raise exception 'order not reserved (status=%)', o.status; end if;
  update orders set status = 'handed', handed_at = now() where id = p_order
    returning * into o;
  return o;
end $$;

create or replace function confirm_order(p_order uuid)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders; c_id uuid; lot_title text;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.status <> 'handed' then raise exception 'order not handed (status=%)', o.status; end if;

  update wallets set balance = balance + o.price, total_earned = total_earned + o.price
    where user_id = o.seller_id;
  update wallets set total_spent = total_spent + o.price
    where user_id = o.buyer_id;
  update orders set status = 'delivered', confirmed_at = now() where id = p_order;

  select circle_id into c_id from users where id = o.buyer_id;
  select title into lot_title from shop_lots where id = o.lot_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    values (c_id, o.buyer_id, o.seller_id, o.price, 'transfer', p_order,
            'Покупка в лавке: ' || coalesce(lot_title, 'товар'));

  perform check_achievements(o.seller_id);
  perform check_achievements(o.buyer_id);
  return o;
end $$;

create or replace function cancel_order(p_order uuid)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.status not in ('reserved', 'handed') then raise exception 'only open orders can be canceled'; end if;
  update wallets set balance = balance + o.price where user_id = o.buyer_id;
  update orders set status = 'canceled' where id = p_order;
  return o;
end $$;
