-- Список заданий для Берёзы: дешёвые ежедневки + одно «задание дня» из её плана.
alter table task_templates add column if not exists pack text;
alter table task_templates add column if not exists kind text;
alter table tasks add column if not exists kind text;

delete from task_templates where pack = 'bereza';

insert into task_templates (title, reward, category, is_daily, needs_photo, pack, kind) values
  ('Заправить постель', 5, 'дом', true, false, 'bereza', 'daily'),
  ('Почистить зубы утром', 3, 'здоровье', true, false, 'bereza', 'daily'),
  ('Почистить зубы вечером', 4, 'здоровье', true, false, 'bereza', 'daily'),
  ('Сделать уроки', 8, 'развитие', true, false, 'bereza', 'daily'),
  ('Умыться и причесаться', 3, 'здоровье', true, false, 'bereza', 'daily'),
  ('Сложить свою одежду', 4, 'дом', true, false, 'bereza', 'daily'),
  ('Помыть свою кружку', 3, 'дом', true, false, 'bereza', 'daily'),
  ('Сказать спасибо за еду', 2, 'забота', true, false, 'bereza', 'daily'),
  ('Проветрить комнату', 3, 'здоровье', true, false, 'bereza', 'daily'),
  ('Лечь спать вовремя', 5, 'здоровье', true, false, 'bereza', 'daily'),
  ('Навести порядок на рабочем столе', 15, 'дом', false, false, 'bereza', 'day'),
  ('Приготовить полезный перекус', 14, 'здоровье', false, false, 'bereza', 'day'),
  ('День без сладкого', 15, 'здоровье', false, false, 'bereza', 'day'),
  ('День без телефона', 18, 'здоровье', false, false, 'bereza', 'day'),
  ('Убрать комнату', 16, 'дом', false, true, 'bereza', 'day'),
  ('Почитать книгу 20 минут', 14, 'развитие', false, false, 'bereza', 'day'),
  ('Помочь с ужином', 15, 'забота', false, false, 'bereza', 'day'),
  ('Прогулка на улице 1 час', 12, 'здоровье', false, false, 'bereza', 'day'),
  ('Доброе дело и рассказать о нём', 16, 'забота', false, false, 'bereza', 'day'),
  ('Сделать уроки без напоминаний', 20, 'развитие', false, false, 'bereza', 'day');

create or replace function ensure_daily_tasks(p_child uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c_id uuid;
  nm   text;
  cnt  int;
  days int;
begin
  select circle_id, name into c_id, nm from users where id = p_child and role = 'child';
  if c_id is null then return; end if;

  if nm in ('Берёза', 'Береза') then
    select count(*) into cnt from tasks
      where child_id = p_child and is_daily and coalesce(kind, 'daily') = 'daily'
        and created_at::date = (now() at time zone 'Europe/Moscow')::date;
    if cnt = 0 then
      insert into tasks(circle_id, child_id, title, reward, category, needs_photo, is_daily, kind)
        select c_id, p_child, t.title, t.reward, coalesce(t.category, 'дом'), t.needs_photo, true, 'daily'
        from task_templates t
        where t.pack = 'bereza' and t.kind = 'daily'
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
        where t.pack = 'bereza' and t.kind = 'day'
        order by random()
        limit 1;
    end if;
    return;
  end if;

  select count(*) into cnt from tasks
    where child_id = p_child
      and is_daily
      and created_at::date = (now() at time zone 'Europe/Moscow')::date;
  if cnt > 0 then return; end if;

  insert into tasks(circle_id, child_id, title, reward, category, needs_photo, is_daily, kind)
    select c_id, p_child, t.title, t.reward, coalesce(t.category, 'дом'), t.needs_photo, true, 'daily'
    from task_templates t
    where t.is_daily
    order by random()
    limit 10;
end $$;
