-- Мини-игры с питомцами: прогресс + ачивки.
-- Фаза 1: Таблица умножения.

-- 1. Прогресс мини-игр
create table if not exists mini_games (
  child_id    uuid not null references users(id) on delete cascade,
  game        text not null check (game in ('multiply','guess','count','chess')),
  level       int  not null default 1,
  score       int  not null default 0,
  streak      int  not null default 0,
  last_played date,
  primary key (child_id, game)
);

-- 2. Метрики для ачивок
create or replace function achievement_metric(p_child uuid, p_metric text)
returns int language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'guild_orders'     then (select count(*) from guild_history gh
      join guild_members gm on gm.guild_id=gh.guild_id where gm.child_id=p_child and gh.kind='order_completed')
    when 'guild_cones'      then (select coalesce(sum(t.amount),0) from transactions t
      where t.to_user=p_child and t.type='reward' and t.message like 'Заказ гильдии:%')
    when 'guild_founded'    then (select count(*) from guilds g where g.created_by=p_child)
    when 'guild_members_recruited' then (select count(distinct gh.title) from guild_history gh
      join guilds g on g.id=gh.guild_id where g.created_by=p_child and gh.kind='member_joined')
    when 'math_score'       then (select coalesce(score,0) from mini_games where child_id=p_child and game='multiply')
    when 'count_score'      then (select coalesce(score,0) from mini_games where child_id=p_child and game='count')
    else achievement_metric_legacy(p_child, p_metric)
  end;
$$;

-- 3. Ачивки (добавить в seed позже, пока вставим напрямую)
insert into achievements(code, title, description, metric, threshold, tier, reward) values
  ('math_1', 'Считатель',    '10 правильных ответов в таблице умножения',  'math_score', 10,  1, 5),
  ('math_2', 'Математик',    '50 правильных ответов',                     'math_score', 50,  2, 15),
  ('math_3', 'Архимед леса', '200 правильных ответов',                    'math_score', 200, 3, 40)
  on conflict (code) do nothing;

-- 4–5. Фразы питомца для игр (без ON CONFLICT — unique нет)
insert into familiar_dialogs(category, trigger, phrase)
select v.category, v.trigger, v.phrase from (values
  ('any','multiply_start','Давай проверим твою таблицу умножения! Готов?'),
  ('any','multiply_correct','Верно! Ты отлично считаешь!'),
  ('any','multiply_correct','Правильно! Ещё один!'),
  ('any','multiply_wrong','Почти! Попробуй ещё раз.'),
  ('any','multiply_wrong','Не совсем. Давай ещё попытку!'),
  ('any','multiply_done','Умница! Ты решил все примеры. Возвращайся завтра!'),
  ('any','multiply_done','Отлично потренировались! До завтра!'),
  ('any','guess_start','Давай поиграем в угадайку! Я опишу лесного жителя, а ты угадай кто это.'),
  ('any','guess_correct','Точно! Ты настоящий следопыт!'),
  ('any','guess_correct','Угадал! Отлично знаешь лес!'),
  ('any','guess_wrong','Не угадал. Это был {name}. Ничего, следующий раз повезёт!'),
  ('any','guess_wrong','Мимо! Я загадал {name}. Продолжим?'),
  ('any','guess_done','Все загадки разгаданы! Ты отлично знаешь лесных жителей.')
) as v(category, trigger, phrase)
where not exists (
  select 1 from familiar_dialogs d
  where d.category=v.category and d.trigger=v.trigger and d.phrase=v.phrase
);

-- 6. Блиц-счёт: ачивки
insert into achievements(code, title, description, metric, threshold, tier, reward) values
  ('count_1', 'Считатель',  '30 правильных ответов в блиц-счёте', 'count_score', 30,  1, 5),
  ('count_2', 'Калькулятор','100 правильных ответов',             'count_score', 100, 2, 15)
  on conflict (code) do nothing;
