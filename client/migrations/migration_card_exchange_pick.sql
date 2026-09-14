-- T20: обменная полка — ребёнок сам выбирает, какие 5 дублей отдать.
-- По-прежнему только излишки (qty-1): последняя карта ячейки не уходит.
create or replace function exchange_cards_pick(p_child uuid, p_grade int, p_types uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec record; got card_types; have int; spent jsonb := '[]'::jsonb;
begin
  if p_types is null or cardinality(p_types) <> 5 then raise exception 'need 5 cards'; end if;
  if exists (select 1 from unnest(p_types) t(id) where t.id is null) then raise exception 'need 5 cards'; end if;
  if (select count(*) from unnest(p_types) x(id) join card_types t on t.id = x.id) <> 5
    then raise exception 'unknown type'; end if;

  perform 1 from user_cards
    where user_id = p_child and grade = p_grade
      and type_id in (select unnest(p_types))
    for update;

  for rec in
    select t.id as type_id, t.name, count(*)::int as take
      from unnest(p_types) x(id)
      join card_types t on t.id = x.id
     group by t.id, t.name, t.sort
     order by t.sort
  loop
    select coalesce(qty, 0) into have from user_cards
      where user_id = p_child and type_id = rec.type_id and grade = p_grade;
    if have - rec.take < 1 then raise exception 'would take last copy'; end if;
    update user_cards set qty = qty - rec.take
      where user_id = p_child and type_id = rec.type_id and grade = p_grade;
    spent := spent || jsonb_build_object('name', rec.name, 'qty', rec.take);
  end loop;

  select * into got from card_types t where t.pack_drop and not exists (
    select 1 from user_cards uc where uc.user_id = p_child and uc.type_id = t.id and uc.grade = p_grade and uc.qty > 0)
    order by random() limit 1;
  if got is null then select * into got from card_types where pack_drop order by random() limit 1; end if;

  insert into user_cards(user_id, type_id, grade, qty) values (p_child, got.id, p_grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;

  perform check_card_rewards(p_child);
  perform check_achievements(p_child);
  return jsonb_build_object('ok', true, 'spent', spent,
    'card', jsonb_build_object('code', got.code, 'name', got.name, 'category', got.category, 'grade', p_grade));
end $$;
