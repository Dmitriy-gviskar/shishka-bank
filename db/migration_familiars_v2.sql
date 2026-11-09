-- Питомцы v2: несколько на поляне (до 5 слотов) + фразы при входе.
-- Заменяет users.familiar_type/familiar_grade на таблицу familiars.

-- 1. Новая таблица
create table if not exists familiars (
  user_id    uuid not null references users(id) on delete cascade,
  type_id    uuid not null references card_types(id),
  grade      int  not null check (grade between 1 and 6),
  slot       int  not null default 1 check (slot between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, slot)
);

-- 2. Перенос существующих питомцев в слот 1
insert into familiars(user_id, type_id, grade, slot)
  select id, familiar_type, familiar_grade, 1
  from users where familiar_type is not null
  on conflict (user_id, slot) do nothing;

-- 3. Новые RPC
create or replace function add_familiar(p_child uuid, p_type uuid, p_grade int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; used int; free_slot int;
begin
  select qty into have from user_cards where user_id=p_child and type_id=p_type and grade=p_grade;
  if have is null or have < 1 then raise exception 'no card'; end if;

  -- нельзя дублировать того же питомца
  if exists (select 1 from familiars where user_id=p_child and type_id=p_type and grade=p_grade) then
    raise exception 'already your familiar';
  end if;

  select count(*) into used from familiars where user_id=p_child;
  if used >= 5 then raise exception 'max 5 familiars'; end if;

  -- найти первый свободный слот
  for i in 1..5 loop
    if not exists (select 1 from familiars where user_id=p_child and slot=i) then
      free_slot := i; exit;
    end if;
  end loop;

  insert into familiars(user_id, type_id, grade, slot) values (p_child, p_type, p_grade, free_slot);
  return jsonb_build_object('ok', true, 'slot', free_slot);
end $$;

create or replace function remove_familiar(p_child uuid, p_type uuid, p_grade int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from familiars where user_id=p_child and type_id=p_type and grade=p_grade;
  if not found then raise exception 'not your familiar'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- 4. Фразы питомцев при входе (по категориям)
create table if not exists familiar_phrases (
  id       uuid primary key default gen_random_uuid(),
  category text not null default 'any',   -- any, zver, rastenie, nasekomoe, special
  mood     text not null default 'happy', -- happy, wise, grumpy
  phrase   text not null
);

insert into familiar_phrases(category, mood, phrase) values
  ('any', 'happy', 'С возвращением в лес!'),
  ('any', 'happy', 'Как хорошо, что ты зашёл!'),
  ('any', 'happy', 'Я скучал по тебе!'),
  ('any', 'wise',  'Сегодня отличный день для подвига.'),
  ('any', 'wise',  'Мудрость растёт с каждым шагом.'),
  ('any', 'grumpy','Ну наконец-то. Я тут ждал.'),
  ('any', 'grumpy','Кто долго спит, тот шишки теряет.'),
  ('zver', 'happy','Уррр! Охотиться будем?'),
  ('zver', 'wise', 'Лес полон тайн — приглядись.'),
  ('zver', 'grumpy','Моя шерсть встала дыбом от ожидания.'),
  ('rastenie','happy','Я распустил новый листок для тебя!'),
  ('rastenie','wise','Корни глубоки, ветви высоки — как твои дела.'),
  ('nasekomoe','happy','Жжжж! Давай полетаем!'),
  ('nasekomoe','wise','Даже маленький жук меняет лес.'),
  ('special','happy','Ты особенный, и я тоже!'),
  ('special','wise','Помни: ты — легенда этого леса.')
  on conflict do nothing;

-- 5. Диалоговые фразы: ответы питомца на действия ребёнка
create table if not exists familiar_dialogs (
  id       uuid primary key default gen_random_uuid(),
  category text not null default 'any',
  trigger  text not null,  -- greet / howareyou / secret / play / task_done / card_sold / gift_sent
  phrase   text not null
);

insert into familiar_dialogs(category, trigger, phrase) values
  ('any','greet','Привет-привет! Рад тебя видеть на поляне.'),
  ('any','greet','О, ты пришёл! Я как раз думал о тебе.'),
  ('any','howareyou','У меня всё отлично! А у тебя как дела?'),
  ('any','howareyou','Лес сегодня особенно красивый. Чувствую себя прекрасно!'),
  ('zver','howareyou','Шерсть блестит, когти острые — всё путём!'),
  ('rastenie','howareyou','Новый листок распустился — жизнь хороша!'),
  ('nasekomoe','howareyou','Жжжж! Крылья гудят от радости.'),
  ('any','secret','Хочешь секрет? Задания с фотоотчётом приносят больше шишек!'),
  ('any','secret','Говорят, в дупле старого дуба спрятан клад. Но это не точно.'),
  ('zver','secret','Самые редкие карты выпадают тем, кто не пропускает ни дня.'),
  ('rastenie','secret','Если поливать дерево каждый день — оно вырастет до небес.'),
  ('special','secret','Ты — избранный. Лес выбрал тебя не случайно.'),
  ('any','play','Давай! Я знаю отличную игру — кто больше заданий сделает за день?'),
  ('any','play','Сыграем в лесную угадайку? Я загадал зверя — попробуй угадать!'),
  ('zver','play','Побежали наперегонки! ... Ладно, ты выиграл. В этот раз.'),
  ('nasekomoe','play','Давай полетаем над лесом! Закрой глаза и представь...'),
  ('any','task_done','Молодец! Ещё одно задание позади. Ты растёшь!'),
  ('any','task_done','Так держать! Скоро ты станешь легендой леса.'),
  ('any','card_sold','Хорошая сделка! Шишки не должны лежать без дела.'),
  ('any','gift_sent','Подарок — это здорово! Друзья это ценят.')
  on conflict do nothing;
