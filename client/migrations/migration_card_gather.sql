-- T19: апгрейд карты кроме эволюции — поселить дубль собирать шишки.
-- Ставка 1🌰/день: это уже существующая единица (quicksell ordinary, минимальный перевод).
-- Потолок 5 — как у питомцев. Типичный день 20–50, минимум ~6: сбор не заменяет задания.
create table if not exists card_gatherers (
  user_id    uuid not null references users(id) on delete cascade,
  type_id    uuid not null references card_types(id) on delete cascade,
  grade      int  not null check (grade between 1 and 6),
  trained_at timestamptz not null default now(),
  last_claim date,
  primary key (user_id, type_id, grade)
);
create index if not exists card_gatherers_user_idx on card_gatherers(user_id);

create or replace function train_gatherer(p_child uuid, p_type uuid, p_grade int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; used int; spec boolean;
begin
  if p_grade < 1 or p_grade > 6 then raise exception 'bad grade'; end if;
  select category = 'special' into spec from card_types where id = p_type;
  if spec is null then raise exception 'no type'; end if;
  if spec then raise exception 'special cards cannot gather'; end if;

  select qty into have from user_cards
    where user_id = p_child and type_id = p_type and grade = p_grade for update;
  if coalesce(have, 0) < 2 then raise exception 'need a duplicate'; end if;
  if exists (select 1 from card_gatherers where user_id = p_child and type_id = p_type and grade = p_grade)
    then raise exception 'already gathering'; end if;

  select count(*) into used from card_gatherers where user_id = p_child;
  if used >= 5 then raise exception 'max 5 gatherers'; end if;

  update user_cards set qty = qty - 1
    where user_id = p_child and type_id = p_type and grade = p_grade;
  delete from user_cards where user_id = p_child and type_id = p_type and grade = p_grade and qty <= 0;
  insert into card_gatherers(user_id, type_id, grade) values (p_child, p_type, p_grade);
  return jsonb_build_object('ok', true);
end $$;

create or replace function claim_gatherers(p_child uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare today date := (timezone('Europe/Moscow', now()))::date;
        n int; c_id uuid;
begin
  select count(*) into n
    from card_gatherers g
    join user_cards uc on uc.user_id = g.user_id and uc.type_id = g.type_id and uc.grade = g.grade and uc.qty > 0
   where g.user_id = p_child and g.last_claim is distinct from today;
  if coalesce(n, 0) <= 0 then return jsonb_build_object('ok', true, 'gained', 0); end if;

  update wallets set balance = balance + n, total_earned = total_earned + n
    where user_id = p_child;
  update card_gatherers set last_claim = today
   where user_id = p_child
     and last_claim is distinct from today
     and exists (select 1 from user_cards uc
                  where uc.user_id = card_gatherers.user_id
                    and uc.type_id = card_gatherers.type_id
                    and uc.grade = card_gatherers.grade and uc.qty > 0);

  select circle_id into c_id from users where id = p_child;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, null, p_child, n, 'reward', 'Сбор с карт');
  return jsonb_build_object('ok', true, 'gained', n);
end $$;
