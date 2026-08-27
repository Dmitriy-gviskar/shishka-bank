-- T23: обменная полка — 1 лишний высшего ранга → 1 недостающая рангом ниже.
-- Только излишек (последняя карта ячейки не уходит). Шишки не эмитирует.
create or replace function exchange_rank_down(
  p_child uuid, p_offer uuid, p_offer_g int, p_want uuid, p_want_g int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; ot card_types; wt card_types;
begin
  if p_offer is null or p_want is null then raise exception 'no types'; end if;
  if p_offer_g not between 2 and 6 or p_want_g not between 1 and 5 then raise exception 'bad grade'; end if;
  if p_want_g >= p_offer_g then raise exception 'want not lower'; end if;

  select * into ot from card_types where id = p_offer;
  if not found or not ot.pack_drop or ot.category = 'special' then raise exception 'no types'; end if;
  select * into wt from card_types where id = p_want;
  if not found or not wt.pack_drop or wt.category = 'special' then raise exception 'no types'; end if;

  select coalesce(qty, 0) into have from user_cards
    where user_id = p_child and type_id = p_offer and grade = p_offer_g for update;
  if have < 2 then raise exception 'need spare'; end if;

  if exists (
    select 1 from user_cards
     where user_id = p_child and type_id = p_want and grade = p_want_g and qty > 0
  ) then raise exception 'already have'; end if;

  update user_cards set qty = qty - 1
    where user_id = p_child and type_id = p_offer and grade = p_offer_g;

  insert into user_cards(user_id, type_id, grade, qty)
    values (p_child, p_want, p_want_g, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;

  perform check_card_rewards(p_child);
  perform check_achievements(p_child);
  return jsonb_build_object('ok', true,
    'spent', jsonb_build_object('code', ot.code, 'name', ot.name, 'grade', p_offer_g),
    'card', jsonb_build_object('code', wt.code, 'name', wt.name, 'category', wt.category, 'grade', p_want_g));
end $$;
