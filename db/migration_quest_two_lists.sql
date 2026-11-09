-- Два списка у всех: дешёвые ежедневки и одно дорогое «задание дня» из полного пула.
alter table task_templates add column if not exists pack text;
alter table task_templates add column if not exists kind text;
alter table tasks add column if not exists kind text;

update task_templates
   set kind = 'daily'
 where coalesce(kind, '') = ''
   and is_daily
   and reward <= 10;

update task_templates
   set kind = 'day'
 where coalesce(kind, '') = ''
   and not is_daily
   and reward >= 12;

create or replace function ensure_daily_tasks(p_child uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c_id uuid;
  cnt  int;
  days int;
begin
  select circle_id into c_id from users where id = p_child and role = 'child';
  if c_id is null then return; end if;

  select count(*) into cnt from tasks
    where child_id = p_child and is_daily and coalesce(kind, 'daily') = 'daily'
      and created_at::date = (now() at time zone 'Europe/Moscow')::date;
  if cnt = 0 then
    insert into tasks(circle_id, child_id, title, reward, category, needs_photo, is_daily, kind)
      select c_id, p_child, t.title, t.reward, coalesce(t.category, 'дом'), t.needs_photo, true, 'daily'
      from task_templates t
      where t.kind = 'daily'
      order by random()
      limit 5;
  end if;

  select count(*) into days from tasks
    where child_id = p_child and coalesce(kind, '') = 'day'
      and created_at::date = (now() at time zone 'Europe/Moscow')::date;
  if days = 0 then
    insert into tasks(circle_id, child_id, title, reward, category, needs_photo, is_daily, kind)
      select c_id, p_child, t.title, t.reward, coalesce(t.category, 'дом'), t.needs_photo, true, 'day'
      from task_templates t
      where t.kind = 'day'
      order by random()
      limit 1;
  end if;
end $$;
