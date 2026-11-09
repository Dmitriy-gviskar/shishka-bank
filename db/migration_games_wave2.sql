-- Волна 2: number / compare / story — ачивки и метрики
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
    when 'guild_orders'     then (select count(*) from guild_history gh
      join guild_members gm on gm.guild_id=gh.guild_id where gm.child_id=p_child and gh.kind='order_completed')
    when 'guild_cones'      then (select coalesce(sum(t.amount),0) from transactions t
      where t.to_user=p_child and t.type='reward' and t.message like 'Заказ гильдии:%')
    when 'guild_founded'    then (select count(*) from guilds g where g.created_by=p_child)
    when 'guild_members_recruited' then (select count(distinct gh.title) from guild_history gh
      join guilds g on g.id=gh.guild_id where g.created_by=p_child and gh.kind='member_joined')
    when 'math_score'       then (select coalesce(score,0) from mini_games where child_id=p_child and game='multiply')
    when 'count_score'      then (select coalesce(score,0) from mini_games where child_id=p_child and game='count')
    when 'memory_score'     then (select coalesce(score,0) from mini_games where child_id=p_child and game='memory')
    when 'word_score'       then (select coalesce(score,0) from mini_games where child_id=p_child and game='word')
    when 'odd_score'        then (select coalesce(score,0) from mini_games where child_id=p_child and game='odd')
    when 'number_score'     then (select coalesce(score,0) from mini_games where child_id=p_child and game='number')
    when 'compare_score'    then (select coalesce(score,0) from mini_games where child_id=p_child and game='compare')
    when 'story_score'      then (select coalesce(score,0) from mini_games where child_id=p_child and game='story')
    else 0 end::int
$$;

insert into achievements(code, title, description, metric, threshold, tier, reward) values
  ('number_1', 'Читатель чисел', '16 верных ответов в диктанте чисел', 'number_score', 16, 1, 5),
  ('number_2', 'Числовед',       '40 верных ответов в диктанте чисел', 'number_score', 40, 2, 12),
  ('compare_1','Сравниватель',   '16 верных в «Тропинке сравнения»', 'compare_score', 16, 1, 5),
  ('compare_2','Мастер сравнения','40 верных в «Тропинке сравнения»', 'compare_score', 40, 2, 12),
  ('story_1',  'Решатель задач', '10 верных лесных задач', 'story_score', 10, 1, 5),
  ('story_2',  'Лесной математик','25 верных лесных задач', 'story_score', 25, 2, 15)
on conflict (code) do nothing;
