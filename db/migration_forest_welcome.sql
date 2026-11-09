-- T24: больше 6 лесных дел (8 ежедневок + задание дня), приветственные 30 шишек.
-- Если сегодня уже выдано меньше восьми ежедневок — добираем, не дублируя заголовок.
create or replace function ensure_daily_tasks(p_child uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c_id uuid;
  cnt  int;
  days int;
  today date := (now() at time zone 'Europe/Moscow')::date;
begin
  select circle_id into c_id from users where id = p_child and role = 'child';
  if c_id is null then return; end if;

  select count(*) into cnt from tasks
    where child_id = p_child and is_daily and coalesce(kind, 'daily') = 'daily'
      and created_at::date = today;
  if cnt < 8 then
    insert into tasks(circle_id, child_id, title, reward, category, needs_photo, is_daily, kind)
      select c_id, p_child, t.title, t.reward, coalesce(t.category, 'дом'), t.needs_photo, true, 'daily'
      from task_templates t
      where t.kind = 'daily'
        and not exists (
          select 1 from tasks x
           where x.child_id = p_child and x.is_daily and coalesce(x.kind, 'daily') = 'daily'
             and x.created_at::date = today and x.title = t.title)
      order by random()
      limit 8 - cnt;
  end if;

  select count(*) into days from tasks
    where child_id = p_child and coalesce(kind, '') = 'day'
      and created_at::date = today;
  if days = 0 then
    insert into tasks(circle_id, child_id, title, reward, category, needs_photo, is_daily, kind)
      select c_id, p_child, t.title, t.reward, coalesce(t.category, 'дом'), t.needs_photo, true, 'day'
      from task_templates t
      where t.kind = 'day'
      order by random()
      limit 1;
  end if;
end $$;

create or replace function add_child(p_circle uuid, p_name text, p_tree_type text default 'pine')
returns users language plpgsql security definer set search_path = public as $$
declare u users;
begin
  insert into users(circle_id, role, name, tree_type)
    values (p_circle, 'child', p_name, p_tree_type) returning * into u;
  insert into wallets(user_id, balance, total_earned) values (u.id, 30, 30);
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (p_circle, null, u.id, 30, 'reward', 'Приветственные шишки');
  perform ensure_daily_tasks(u.id);
  return u;
end $$;

-- Кто так и не получил ни одной шишки — тот же стартовый запас, что у нового леса.
insert into transactions(circle_id, from_user, to_user, amount, type, message)
select u.circle_id, null, w.user_id, 30, 'reward', 'Приветственные шишки'
  from wallets w
  join users u on u.id = w.user_id and u.role = 'child'
 where w.balance = 0 and w.total_earned = 0
   and not exists (
     select 1 from transactions t
      where t.to_user = w.user_id and t.message = 'Приветственные шишки');

update wallets w
   set balance = 30, total_earned = 30
  from users u
 where u.id = w.user_id and u.role = 'child'
   and w.balance = 0 and w.total_earned = 0;
