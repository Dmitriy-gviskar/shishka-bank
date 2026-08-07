-- Ежедневные задания: авто-генерация при заходе ребёнка на страницу заданий.
-- Выдаёт 5 случайных daily-шаблонов, если на сегодня ещё нет активных daily-заданий.
create or replace function ensure_daily_tasks(p_child uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c_id uuid; cnt int;
begin
  select circle_id into c_id from users where id = p_child;
  -- проверяем, есть ли уже daily-задания на сегодня (категория 'daily' или guild_id is not null пропускаем)
  select count(*) into cnt from tasks
    where child_id = p_child and status = 'open' and category = 'daily'
      and created_at::date = current_date;
  if cnt > 0 then return; end if;

  -- создаём 5 случайных daily-шаблонов
  insert into tasks(circle_id, child_id, title, reward, category, needs_photo, is_daily)
    select c_id, p_child, t.title, t.reward, coalesce(t.category, 'daily'), t.needs_photo, true
    from task_templates t
    where t.is_daily
    order by random() limit 6;
end $$;
