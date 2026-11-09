-- Обмен картами между детьми: отдаёшь свою, просишь равный ранг или ниже.
create table if not exists card_swaps (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references circles(id) on delete cascade,
  from_id     uuid not null references users(id) on delete cascade,
  offer_type  uuid not null references card_types(id),
  offer_grade int  not null check (offer_grade between 1 and 6),
  want_type   uuid not null references card_types(id),
  want_grade  int  not null check (want_grade between 1 and 6),
  status      text not null default 'open' check (status in ('open','done','cancelled')),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  check (want_grade <= offer_grade)
);
create index if not exists card_swaps_open on card_swaps (status, created_at desc) where status = 'open';

create or replace function create_card_swap(p_child uuid, p_offer uuid, p_offer_g int, p_want uuid, p_want_g int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; c_id uuid; open_n int; ot card_types; wt card_types;
begin
  if p_offer is null or p_want is null then raise exception 'no types'; end if;
  if p_want_g > p_offer_g then raise exception 'want higher grade'; end if;
  if p_offer = p_want and p_offer_g = p_want_g then raise exception 'same card'; end if;
  select * into ot from card_types where id = p_offer;
  if not found then raise exception 'no types'; end if;
  select * into wt from card_types where id = p_want;
  if not found then raise exception 'no types'; end if;
  if ot.category = 'special' or wt.category = 'special' then raise exception 'special'; end if;

  select circle_id into c_id from users where id = p_child;
  select count(*) into open_n from card_swaps where from_id = p_child and status = 'open';
  if open_n >= 3 then raise exception 'too many swaps'; end if;

  select qty into have from user_cards
    where user_id = p_child and type_id = p_offer and grade = p_offer_g for update;
  if have is null or have < 1 then raise exception 'no card'; end if;

  update user_cards set qty = qty - 1
    where user_id = p_child and type_id = p_offer and grade = p_offer_g;
  delete from user_cards
    where user_id = p_child and type_id = p_offer and grade = p_offer_g and qty <= 0;

  insert into card_swaps(circle_id, from_id, offer_type, offer_grade, want_type, want_grade)
    values (c_id, p_child, p_offer, p_offer_g, p_want, p_want_g);

  return jsonb_build_object('ok', true, 'offer', ot.name, 'want', wt.name);
end $$;

create or replace function cancel_card_swap(p_child uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s card_swaps;
begin
  select * into s from card_swaps where id = p_id for update;
  if not found or s.status <> 'open' then raise exception 'swap unavailable'; end if;
  if s.from_id <> p_child then raise exception 'not owner'; end if;

  insert into user_cards(user_id, type_id, grade, qty)
    values (s.from_id, s.offer_type, s.offer_grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;
  update card_swaps set status = 'cancelled', closed_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function accept_card_swap(p_child uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s card_swaps; have int; ot card_types; wt card_types;
begin
  select * into s from card_swaps where id = p_id for update;
  if not found or s.status <> 'open' then raise exception 'swap unavailable'; end if;
  if s.from_id = p_child then raise exception 'own swap'; end if;

  if (select circle_id from users where id = p_child) is distinct from s.circle_id then
    if not exists (
      select 1 from friendships
       where user_id = p_child and friend_id = s.from_id and status = 'accepted'
    ) then raise exception 'other circle'; end if;
  end if;

  select qty into have from user_cards
    where user_id = p_child and type_id = s.want_type and grade = s.want_grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;

  update user_cards set qty = qty - 1
    where user_id = p_child and type_id = s.want_type and grade = s.want_grade;
  delete from user_cards
    where user_id = p_child and type_id = s.want_type and grade = s.want_grade and qty <= 0;

  insert into user_cards(user_id, type_id, grade, qty)
    values (s.from_id, s.want_type, s.want_grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;
  insert into user_cards(user_id, type_id, grade, qty)
    values (p_child, s.offer_type, s.offer_grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;

  update card_swaps set status = 'done', closed_at = now() where id = p_id;

  select * into ot from card_types where id = s.offer_type;
  select * into wt from card_types where id = s.want_type;
  perform notify_child(s.from_id, 'Обмен закрыт: ты получил(а) «' || wt.name || '» 🔄');
  perform check_card_rewards(s.from_id);
  perform check_card_rewards(p_child);
  perform check_achievements(s.from_id);
  perform check_achievements(p_child);
  return jsonb_build_object('ok', true, 'got', ot.name, 'gave', wt.name);
end $$;
