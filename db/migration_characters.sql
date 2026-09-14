-- T21: обитатели поляны — косметика за шишки, не карты в паке и не касса.
alter table shop_items drop constraint if exists shop_items_type_check;
alter table shop_items add constraint shop_items_type_check
  check (type in ('impression', 'skin', 'character'));

alter table shop_items add column if not exists sku text;
create unique index if not exists shop_items_sku_uidx on shop_items (sku) where sku is not null;

alter table users add column if not exists grove_character text;

insert into shop_items (circle_id, type, title, price, rarity, sku, category)
select v.circle_id, v.type, v.title, v.price, v.rarity, v.sku, v.category
  from (values
    (null::uuid, 'character', 'Воробей', 30, 'seasonal', 'vorobey', 'ptica'),
    (null, 'character', 'Голубь', 30, 'seasonal', 'golub', 'ptica'),
    (null, 'character', 'Ласточка', 30, 'seasonal', 'lastochka', 'ptica'),
    (null, 'character', 'Скворец', 30, 'seasonal', 'skvorets', 'ptica'),
    (null, 'character', 'Зяблик', 30, 'seasonal', 'zyablik', 'ptica'),
    (null, 'character', 'Трясогузка', 30, 'seasonal', 'tryasoguzka', 'ptica'),
    (null, 'character', 'Чайка', 50, 'seasonal', 'chayka', 'ptica'),
    (null, 'character', 'Чомга', 50, 'seasonal', 'chomga', 'ptica'),
    (null, 'character', 'Кулик', 80, 'rare', 'kulik', 'ptica'),
    (null, 'character', 'Цапля', 80, 'rare', 'caplya', 'ptica'),
    (null, 'character', 'Утка', 80, 'rare', 'utka', 'ptica'),
    (null, 'character', 'Гусь', 80, 'rare', 'gus', 'ptica'),
    (null, 'character', 'Журавль', 100, 'rare', 'zhuravl', 'ptica'),
    (null, 'character', 'Лебедь', 100, 'rare', 'lebed', 'ptica'),
    (null, 'character', 'Тетерев', 100, 'rare', 'teterev', 'ptica'),
    (null, 'character', 'Куропатка', 100, 'rare', 'kuropatka', 'ptica'),
    (null, 'character', 'Вальдшнеп', 100, 'rare', 'valdshnep', 'ptica'),
    (null, 'character', 'Сокол', 150, 'epic', 'sokol', 'ptica'),
    (null, 'character', 'Ястреб', 150, 'epic', 'yastreb', 'ptica'),
    (null, 'character', 'Корюшка', 80, 'rare', 'koryushka', 'ryba'),
    (null, 'character', 'Судак', 80, 'rare', 'sudak', 'ryba'),
    (null, 'character', 'Форель', 100, 'rare', 'forel', 'ryba'),
    (null, 'character', 'Морошка', 50, 'seasonal', 'moroshka', 'rastenie'),
    (null, 'character', 'Клюква', 50, 'seasonal', 'klyukva', 'rastenie'),
    (null, 'character', 'Можжевельник', 50, 'seasonal', 'mozhzhevelnik', 'rastenie'),
    (null, 'character', 'Опёнок', 50, 'seasonal', 'openok', 'rastenie'),
    (null, 'character', 'Сыроежка', 50, 'seasonal', 'syroezhka', 'rastenie'),
    (null, 'character', 'Подберёзовик', 80, 'rare', 'podberezovik', 'rastenie')
  ) as v(circle_id, type, title, price, rarity, sku, category)
  where not exists (select 1 from shop_items s where s.sku = v.sku);

create or replace function purchase_character(p_child uuid, p_item uuid)
returns user_skins language plpgsql security definer set search_path = public as $$
declare it shop_items; w wallets; us user_skins;
begin
  select * into it from shop_items where id = p_item;
  if not found or not it.is_active or it.type <> 'character' then
    raise exception 'character unavailable';
  end if;
  if exists (select 1 from user_skins where user_id = p_child and skin_id = p_item) then
    raise exception 'character already owned';
  end if;
  select * into w from wallets where user_id = p_child for update;
  if not found then raise exception 'wallet not found'; end if;
  if w.balance < it.price then
    raise exception 'not enough cones: have %, need %', w.balance, it.price;
  end if;
  update wallets set balance = balance - it.price, total_spent = total_spent + it.price
    where user_id = p_child;
  insert into user_skins(user_id, skin_id) values (p_child, p_item) returning * into us;
  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    values (coalesce(it.circle_id, (select circle_id from users where id = p_child)),
            p_child, null, it.price, 'purchase', p_item, 'Обитатель: ' || it.title);
  perform check_achievements(p_child);
  return us;
end $$;

create or replace function equip_character(p_child uuid, p_item uuid)
returns users language plpgsql security definer set search_path = public as $$
declare it shop_items; u users;
begin
  if p_item is null then
    update users set grove_character = null where id = p_child returning * into u;
    return u;
  end if;
  select * into it from shop_items where id = p_item and type = 'character';
  if not found then raise exception 'character not found'; end if;
  if not exists (select 1 from user_skins where user_id = p_child and skin_id = p_item) then
    raise exception 'character not owned';
  end if;
  update users set grove_character = it.sku where id = p_child returning * into u;
  return u;
end $$;
