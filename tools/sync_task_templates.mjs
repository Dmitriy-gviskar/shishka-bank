// Генерит db/migration_sync_tasks_daily.sql из catalog.json. Запуск: node tools/sync_task_templates.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const cat = JSON.parse(readFileSync(new URL('../content/catalog.json', import.meta.url)));
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const b = (v) => (v ? 'true' : 'false');
const tasks = cat.tasks;
const daily = tasks.filter((t) => t.daily).length;
const sql = `-- Автогенерация (tools/sync_task_templates.mjs). Не редактировать руками.
-- Шаблоны: ${tasks.length}, daily: ${daily}.

begin;

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
    limit 6;
end $$;

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

delete from task_templates;
insert into task_templates (title, reward, category, is_daily, needs_photo) values
${tasks.map((t) => `  (${q(t.title)}, ${t.reward}, ${q(t.category || 'дом')}, ${b(t.daily)}, ${b(t.photo)})`).join(',\n')};

update tasks
  set status = 'rejected'
  where status = 'open'
    and created_by is null
    and coalesce(is_daily, false) = false;

do $$
declare r record;
begin
  for r in select id from users where role = 'child' loop
    perform ensure_daily_tasks(r.id);
  end loop;
end $$;

commit;
`;
writeFileSync(new URL('../db/migration_sync_tasks_daily.sql', import.meta.url), sql);
console.log('OK templates', tasks.length, 'daily', daily);
