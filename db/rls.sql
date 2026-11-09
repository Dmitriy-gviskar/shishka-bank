-- Шишка Банк — Row Level Security (PostgreSQL / Supabase).
-- Модель: родитель (Хранитель) авторизован через Supabase Auth (auth.uid()).
-- Изоляция по семейному кругу: пользователь видит и трогает ТОЛЬКО свой circle.
-- Кошельки НЕЛЬЗЯ менять напрямую — только через SECURITY DEFINER функции (functions.sql),
-- которые проходят мимо RLS и гарантируют атомарность + журнал.
-- Тестируется в Supabase (локальный SQLite RLS не поддерживает).

-- circle_id текущего авторизованного пользователя
create or replace function my_circle() returns uuid
  language sql stable security definer set search_path = public as $$
  select circle_id from users where auth_id = auth.uid() limit 1
$$;

alter table circles       enable row level security;
alter table users         enable row level security;
alter table wallets       enable row level security;
alter table transactions  enable row level security;
alter table tasks         enable row level security;
alter table shop_items    enable row level security;
alter table purchases     enable row level security;
alter table task_templates enable row level security;

-- Свой круг — виден; чужой — нет
create policy circle_read on circles for select using (id = my_circle());

create policy users_read on users for select using (circle_id = my_circle());
-- родитель заводит детей/правит профили в своём круге
create policy users_write on users for all
  using (circle_id = my_circle()) with check (circle_id = my_circle());

-- Кошелёк: только читать свой круг. Запись — исключительно через RPC (security definer).
create policy wallets_read on wallets for select
  using (exists (select 1 from users u where u.id = wallets.user_id and u.circle_id = my_circle()));

-- Журнал операций — только чтение своего круга (пишут RPC-функции)
create policy tx_read on transactions for select using (circle_id = my_circle());

-- Задания: родитель полностью управляет заданиями своего круга
create policy tasks_all on tasks for all
  using (circle_id = my_circle()) with check (circle_id = my_circle());

-- Магазин: видны глобальные шаблоны и лоты своего круга; правит родитель свой круг
create policy shop_read on shop_items for select
  using (circle_id is null or circle_id = my_circle());
create policy shop_write on shop_items for all
  using (circle_id = my_circle()) with check (circle_id = my_circle());

-- Покупки — чтение своего круга (создаёт RPC purchase_item)
create policy purch_read on purchases for select using (circle_id = my_circle());

-- Справочник заданий — глобальный, только чтение всем авторизованным
create policy tmpl_read on task_templates for select using (true);
