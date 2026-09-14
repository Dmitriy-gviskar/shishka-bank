-- До 10 ежедневок в день вместо 6 — иначе в вебе почти нечем зарабатывать.
create or replace function ensure_daily_tasks(p_child uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c_id uuid;
  cnt  int;
begin
  select circle_id into c_id from users where id = p_child and role = 'child';
  if c_id is null then return; end if;

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
    limit 10;
end $$;
