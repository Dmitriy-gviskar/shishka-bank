-- Ежедневные задания: 6 случайных daily-шаблонов при первом заходе ребёнка за день.
-- Идемпотентно: если на сегодня уже есть is_daily-задачи — ничего не делает.
create or replace function ensure_daily_tasks(p_child uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c_id uuid;
  cnt  int;
begin
  select circle_id into c_id from users where id = p_child and role = 'child';
  if c_id is null then return; end if;

  -- уже выдавали daily сегодня (любой статус — open/pending/done/rejected)
  select count(*) into cnt from tasks
    where child_id = p_child
      and is_daily
      and created_at::date = (now() at time zone 'Europe/Moscow')::date;
  if cnt > 0 then return; end if;

  insert into tasks(circle_id, child_id, title, reward, category, needs_photo, is_daily)
    select c_id, p_child, t.title, t.reward, coalesce(t.category, 'дом'), t.needs_photo, true
    from task_templates t
    where t.is_daily
    order by random()
    limit 6;
end $$;

-- Новый ребёнок получает только сегодняшние daily, не весь каталог разом.
create or replace function add_child(p_circle uuid, p_name text, p_tree_type text default 'pine')
returns users language plpgsql security definer set search_path = public as $$
declare u users;
begin
  insert into users(circle_id, role, name, tree_type)
    values (p_circle, 'child', p_name, p_tree_type) returning * into u;
  insert into wallets(user_id) values (u.id);
  perform ensure_daily_tasks(u.id);
  return u;
end $$;
