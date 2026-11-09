-- Дотягиваем наработки DeepSeek 7–8 авг., которые не доехали из‑за вырезания auto-migrate:
-- 1) achievement_metric: guild + math + count (+ всё что уже было на проде)
-- 2) ачивки гильдий / мини-игр
-- 3) диалоги питомца для multiply / guess
-- Идемпотентно.

begin;

create or replace function achievement_metric(p_child uuid, p_metric text)
returns int language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'transfers_count'   then (select count(*) from transactions where from_user = p_child and type = 'transfer')
    when 'gifts_sum'         then (select coalesce(sum(amount),0) from transactions where from_user = p_child and type = 'transfer')
    when 'tasks_done'        then (select count(*) from tasks where child_id = p_child and status = 'done')
    when 'cones_earned'      then (select coalesce(total_earned,0) from wallets where user_id = p_child)
    when 'longest_streak'    then (select coalesce(longest_streak,0) from users where id = p_child)
    when 'deposits_count'    then (select count(*) from safes where user_id = p_child)
    when 'deposits_closed'   then (select count(*) from safes where user_id = p_child and status = 'unlocked')
    when 'horoscopes_read'   then (select count(*) from daily_horoscopes where child_id = p_child)
    when 'skins_owned'       then (select count(*) from user_skins where user_id = p_child)
    when 'pot_contributions' then (select count(*) from pot_contributions where child_id = p_child)
    when 'purchases_count'   then (select count(*) from purchases where child_id = p_child)
    when 'daily_quests_done' then (select count(*) from daily_quests where child_id = p_child and status = 'done')
    when 'rep_honesty'       then (select coalesce((reputation->>'honesty')::int,0) from users where id = p_child)
    when 'rep_generosity'    then (select coalesce((reputation->>'generosity')::int,0) from users where id = p_child)
    when 'rep_reliability'   then (select coalesce((reputation->>'reliability')::int,0) from users where id = p_child)
    when 'rep_wisdom'        then (select coalesce((reputation->>'wisdom')::int,0) from users where id = p_child)
    when 'total_reputation'  then (select coalesce((reputation->>'honesty')::int,0)+coalesce((reputation->>'generosity')::int,0)+coalesce((reputation->>'reliability')::int,0)+coalesce((reputation->>'wisdom')::int,0) from users where id = p_child)
    when 'cone_rain_caught'  then (select count(*) from transactions where to_user = p_child and message like 'Шишечный дождь%')
    when 'freezes_bought'    then (select count(*) from transactions where from_user = p_child and message = 'Дождик-защитник')
    when 'interest_earned'   then (select coalesce(sum(amount),0) from transactions where to_user = p_child and type = 'interest')
    when 'current_balance'   then (select coalesce(balance,0) from wallets where user_id = p_child)
    when 'cones_spent'       then (select coalesce(total_spent,0) from wallets where user_id = p_child)
    when 'tasks_photo'       then (select count(*) from tasks where child_id = p_child and status = 'done' and proof_url is not null)
    when 'tree_level'        then (select coalesce(tree_level,0) from users where id = p_child)
    when 'transfers_received' then (select count(*) from transactions where to_user = p_child and type = 'transfer')
    when 'gifts_received_sum' then (select coalesce(sum(amount),0) from transactions where to_user = p_child and type = 'transfer')
    when 'categories_done'   then (select count(distinct category) from tasks where child_id = p_child and status = 'done')
    when 'sales_count'       then (select count(*) from orders where seller_id = p_child and status = 'delivered')
    when 'sales_sum'         then (select coalesce(sum(price),0) from orders where seller_id = p_child and status = 'delivered')
    when 'shop_buys'         then (select count(*) from orders where buyer_id = p_child and status = 'delivered')
    when 'messages_sent'     then (select count(*) from messages where from_user = p_child)
    when 'investigations_done' then (select count(*) from transactions where to_user = p_child and is_anonymous and revealed)
    -- гильдии v3
    when 'guild_orders'     then (select count(*) from guild_history gh
      join guild_members gm on gm.guild_id=gh.guild_id where gm.child_id=p_child and gh.kind='order_completed')
    when 'guild_cones'      then (select coalesce(sum(t.amount),0) from transactions t
      where t.to_user=p_child and t.type='reward' and t.message like 'Заказ гильдии:%')
    when 'guild_founded'    then (select count(*) from guilds g where g.created_by=p_child)
    when 'guild_members_recruited' then (select count(distinct gh.title) from guild_history gh
      join guilds g on g.id=gh.guild_id where g.created_by=p_child and gh.kind='member_joined')
    -- мини-игры
    when 'math_score'       then (select coalesce(score,0) from mini_games where child_id=p_child and game='multiply')
    when 'count_score'      then (select coalesce(score,0) from mini_games where child_id=p_child and game='count')
    else 0 end::int
$$;

insert into achievements(code, title, description, metric, threshold, tier, reward) values
  -- гильдии
  ('gord_1',  'Первый заказ',            'Выполни первый заказ гильдии',              'guild_orders', 1,  1, 0),
  ('gord_2',  'Гильдейский подмастерье', 'Выполни 5 заказов гильдии',                 'guild_orders', 5,  2, 10),
  ('gord_3',  'Мастер заказов',          'Выполни 15 заказов гильдии',                'guild_orders', 15, 3, 25),
  ('gord_4',  'Опора гильдии',           'Выполни 30 заказов гильдии',                'guild_orders', 30, 3, 50),
  ('gcone_1', 'Гильдейский доход',       'Заработай 50 шишек на заказах гильдии',     'guild_cones', 50,  1, 5),
  ('gcone_2', 'Кормилец гильдии',        'Заработай 200 шишек на заказах гильдии',    'guild_cones', 200, 2, 15),
  ('gcone_3', 'Золотая гильдия',         'Заработай 500 шишек на заказах гильдии',    'guild_cones', 500, 3, 35),
  ('gfound_1','Основатель',              'Оснуй гильдию',                             'guild_founded', 1, 1, 0),
  ('gfound_2','Гильдмейстер',            'Оснуй 3 гильдии',                           'guild_founded', 3, 2, 15),
  ('grec_1',  'Вербовщик',               'Пригласи первого друга в гильдию',          'guild_members_recruited', 1,  1, 0),
  ('grec_2',  'Душа компании',           'Пригласи 5 друзей в гильдию',               'guild_members_recruited', 5,  2, 10),
  ('grec_3',  'Лесной вожак',            'Пригласи 12 друзей в гильдию',              'guild_members_recruited', 12, 3, 25),
  -- мини-игры
  ('math_1',  'Считатель',               '10 правильных ответов в таблице умножения', 'math_score', 10,  1, 5),
  ('math_2',  'Математик',               '50 правильных ответов в таблице умножения','math_score', 50,  2, 15),
  ('math_3',  'Архимед леса',            '200 правильных ответов в таблице умножения','math_score', 200, 3, 40),
  ('count_1', 'Считатель блица',         '30 правильных ответов в блиц-счёте',         'count_score', 30,  1, 5),
  ('count_2', 'Калькулятор',             '100 правильных ответов в блиц-счёте',        'count_score', 100, 2, 15)
on conflict (code) do nothing;

-- диалоги игр: без ON CONFLICT (у таблицы нет unique) — вставляем только отсутствующие фразы
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
  ('any','guess_done','Все загадки разгаданы! Ты отлично знаешь лесных жителей.'),
  ('any','count_start','Блиц-счёт! Складывай и вычитай на скорость.'),
  ('any','count_correct','Быстро! Так держать!'),
  ('any','count_wrong','Ой, мимо. Ещё раз!'),
  ('any','count_done','Отличный блиц! Возвращайся потренироваться завтра.')
) as v(category, trigger, phrase)
where not exists (
  select 1 from familiar_dialogs d
  where d.category = v.category and d.trigger = v.trigger and d.phrase = v.phrase
);

commit;
