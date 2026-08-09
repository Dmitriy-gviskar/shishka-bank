-- Автогенерация (tools/sync_task_templates.mjs). Не редактировать руками.
-- Шаблоны: 120, daily: 51.

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
  ('Заправить кровать', 5, 'дом', true, false),
  ('Почистить зубы вечером', 4, 'здоровье', true, false),
  ('Покормить питомца', 6, 'забота', true, false),
  ('Накрыть на стол', 6, 'дом', false, false),
  ('Вынести мусор', 8, 'дом', false, false),
  ('Полить цветы', 8, 'дом', false, false),
  ('Зарядка утром', 8, 'здоровье', false, false),
  ('Собрать портфель с вечера', 8, 'самостоятельность', false, false),
  ('Разложить вещи по местам', 10, 'дом', false, false),
  ('Помочь маме с готовкой', 10, 'забота', false, false),
  ('Помыть посуду', 12, 'дом', false, false),
  ('Нарисовать рисунок', 12, 'развитие', false, true),
  ('Прогулка на улице 1 час', 12, 'здоровье', false, false),
  ('Погулять с собакой', 14, 'забота', false, false),
  ('Убрать комнату', 15, 'дом', false, true),
  ('Пропылесосить', 15, 'дом', false, false),
  ('Поиграть с младшим', 15, 'забота', false, false),
  ('День без сладкого', 15, 'здоровье', false, false),
  ('Собрать шишки и листья в лесу', 15, 'приключение', false, true),
  ('Прибрать в шкафу', 16, 'дом', false, true),
  ('Порешать задачки', 18, 'развитие', false, false),
  ('Помочь с покупками в магазине', 18, 'самостоятельность', false, false),
  ('Доброе дело и рассказать о нём', 20, 'забота', false, false),
  ('Почитать книгу 20 минут', 20, 'развитие', false, false),
  ('Приготовить простой завтрак сам', 20, 'самостоятельность', false, true),
  ('Написать письмо бабушке', 22, 'развитие', false, false),
  ('Помочь бабушке или соседке', 25, 'забота', false, false),
  ('Сделать уроки без напоминаний', 25, 'развитие', false, false),
  ('Выучить стихотворение', 30, 'развитие', false, false),
  ('Убрать во дворе или в гараже', 28, 'дом', false, true),
  ('Полить огород', 10, 'дом', false, false),
  ('Помыть пол', 14, 'дом', false, false),
  ('Протереть пыль', 10, 'дом', false, false),
  ('Собрать игрушки', 6, 'дом', true, false),
  ('Полить комнатные растения', 6, 'дом', false, false),
  ('Разобрать рюкзак', 6, 'самостоятельность', false, false),
  ('Написать список покупок', 8, 'самостоятельность', false, false),
  ('Приготовить салат', 18, 'самостоятельность', false, true),
  ('Позаниматься спортом', 10, 'здоровье', false, false),
  ('Выпить воды за день', 5, 'здоровье', true, false),
  ('Лечь спать без капризов', 6, 'здоровье', true, false),
  ('Выучить таблицу умножения', 30, 'развитие', false, false),
  ('Прочитать главу книги', 18, 'развитие', false, false),
  ('Сделать поделку', 15, 'развитие', false, true),
  ('Порепетировать музыку', 16, 'развитие', false, false),
  ('Помочь папе в гараже', 20, 'дом', false, true),
  ('Убрать за питомцем', 8, 'забота', false, false),
  ('Помочь младшему с уроками', 18, 'забота', false, false),
  ('Поблагодарить трёх человек', 10, 'забота', false, false),
  ('Помочь накрыть праздничный стол', 12, 'забота', false, false),
  ('Почистить зубы утром', 3, 'здоровье', true, false),
  ('Умыться и причесаться', 3, 'здоровье', true, false),
  ('Съесть полезный завтрак', 4, 'здоровье', true, false),
  ('Одеться самому без помощи', 4, 'самостоятельность', true, false),
  ('Сказать спасибо за завтрак', 2, 'забота', true, false),
  ('Обнять маму и папу', 2, 'забота', true, false),
  ('Погулять на улице 20 минут', 5, 'здоровье', true, false),
  ('Сделать 10 приседаний', 3, 'здоровье', true, false),
  ('Помыть руки перед едой', 2, 'здоровье', true, false),
  ('Собрать рюкзак самому', 5, 'самостоятельность', true, false),
  ('Прочитать страницу книги', 5, 'развитие', true, false),
  ('Написать 3 предложения в дневник', 6, 'развитие', true, false),
  ('Посчитать до 100', 4, 'развитие', true, false),
  ('Нарисовать что-то из леса', 6, 'развитие', true, false),
  ('Спеть песенку для семьи', 5, 'развитие', true, false),
  ('Сложить свою одежду', 4, 'дом', true, false),
  ('Вытереть стол после еды', 3, 'дом', true, false),
  ('Помочь накрыть на стол', 4, 'дом', true, false),
  ('Полить цветок на подоконнике', 3, 'дом', true, false),
  ('Покормить рыбок или хомяка', 4, 'забота', true, false),
  ('Сказать комплимент другу', 3, 'забота', true, false),
  ('Поделиться игрушкой', 5, 'забота', true, false),
  ('Помочь донести сумку', 4, 'забота', true, false),
  ('Посмотреть на звёзды вечером', 3, 'приключение', true, false),
  ('Найти три разных листочка', 5, 'приключение', true, false),
  ('Почистить зубы после завтрака', 2, 'здоровье', true, false),
  ('Лечь спать вовремя без напоминаний', 5, 'здоровье', true, false),
  ('Сделать утреннюю растяжку', 3, 'здоровье', true, false),
  ('Пройти пешком 2000 шагов', 4, 'здоровье', true, false),
  ('День без телефона', 10, 'здоровье', false, false),
  ('Приготовить полезный перекус', 6, 'здоровье', true, false),
  ('Проветрить комнату перед сном', 2, 'здоровье', true, false),
  ('Отжаться 5 раз утром', 4, 'здоровье', true, false),
  ('Заправить постель красиво', 3, 'дом', true, false),
  ('Помыть зеркало в ванной', 6, 'дом', false, false),
  ('Разложить обувь аккуратно', 3, 'дом', true, false),
  ('Протереть подоконники', 5, 'дом', false, false),
  ('Собрать мусор со стола после уроков', 3, 'дом', true, false),
  ('Помочь почистить овощи к ужину', 5, 'дом', true, false),
  ('Развесить бельё после стирки', 8, 'дом', false, false),
  ('Помыть свою кружку', 2, 'дом', true, false),
  ('Приготовить завтрак для всей семьи', 15, 'самостоятельность', false, true),
  ('Самому выбрать одежду на завтра', 3, 'самостоятельность', true, false),
  ('Позвонить бабушке самому', 8, 'самостоятельность', false, false),
  ('Спланировать день на завтра', 4, 'самостоятельность', true, false),
  ('Самому разогреть обед', 5, 'самостоятельность', false, false),
  ('Завязать шнурки без помощи', 4, 'самостоятельность', false, false),
  ('Разобрать почту и выбросить спам', 3, 'самостоятельность', true, false),
  ('Выучить 5 новых слов на английском', 6, 'развитие', true, false),
  ('Рассказать маме что узнал сегодня', 3, 'развитие', true, false),
  ('Собрать пазл или головоломку', 8, 'развитие', false, true),
  ('Посмотреть научное видео', 6, 'развитие', false, false),
  ('Придумать свою сказку', 10, 'развитие', false, false),
  ('Сосчитать все деревья во дворе', 5, 'развитие', false, false),
  ('Слепить что-то из пластилина', 6, 'развитие', false, true),
  ('Сделать открытку для друга', 8, 'забота', false, true),
  ('Помочь однокласснику с заданием', 12, 'забота', false, false),
  ('Накормить бездомного кота', 8, 'забота', false, true),
  ('Уступить место в транспорте', 5, 'забота', false, false),
  ('Поздравить друга с днём рождения', 6, 'забота', false, false),
  ('Прочитать сказку младшему', 8, 'забота', false, false),
  ('Помочь пожилому соседу', 15, 'забота', false, false),
  ('Построить шалаш из веток', 15, 'приключение', false, true),
  ('Найти птичье гнездо и зарисовать', 10, 'приключение', false, true),
  ('Погулять босиком по траве', 5, 'приключение', true, false),
  ('Собрать природный материал для поделки', 6, 'приключение', true, false),
  ('Покормить птиц зимой', 6, 'приключение', false, false),
  ('Пройти по бревну как по мосту', 5, 'приключение', true, false),
  ('Найти и сфоткать гриб', 8, 'приключение', false, true),
  ('Встретить рассвет', 12, 'приключение', false, true);

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
