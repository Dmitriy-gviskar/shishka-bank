-- ═══════════════════ Лесная коллекция: seed + RPC ═══════════════════
-- Идемпотентно: справочники через on conflict, функции create or replace.
-- Экономика: Panini/FUT-модель — резкий разброс номинала (1000×) + регрессивный quicksell.

-- Колонка регрессивного quicksell (банк выкупает мусор щедро, топ — за копейки)
alter table rarities add column if not exists quicksell int;

-- Грейды рарности: price = номинал (якорь рынка), quicksell = цена выкупа банком, weight = вес выпадения
-- quicksell пересчитан 22.07: при таблице 1/2/5/15/40/100 «продавец всего» возвращал 75% цены пака,
-- то есть карты почти не работали стоком. Новая таблица 1/2/3/8/20/50 = 47% возврата (сток 23.9🌰/пак
-- вместо 11.5) и делает слияние невыгодным ради денег на ЛЮБОМ ранге — merge остаётся коллекционным.
-- Для собирающего ребёнка ничего не меняется: нетто -43🌰/пак и скорость сбора те же (tools/sim_cards.py).
insert into rarities(grade,code,name,color,price,quicksell,weight) values
  (1,'common','Обычная','#9aa4b2',1,1,50),
  (2,'uncommon','Необычная','#46c93a',3,2,27),
  (3,'rare','Редкая','#3b8eea',10,3,13),
  (4,'epic','Эпическая','#a24bf0',40,8,6),
  (5,'legendary','Легендарная','#ff8a2b',150,20,3),
  (6,'gold','Золотая','#ffc21f',1000,50,1)
on conflict (grade) do update set code=excluded.code,name=excluded.name,
  color=excluded.color,price=excluded.price,quicksell=excluded.quicksell,weight=excluded.weight;

-- Каталог существ (121). code = имя ассета assets/cards/<code>_<grade>.webp
insert into card_types(code,name,category,sort) values
  -- Звери
  ('burunduk','Бурундук','zver',1),('ezh','Ёж','zver',2),('lisa','Лиса','zver',3),
  ('sova','Сова','zver',4),('zayac','Заяц','zver',5),('medved','Медведь','zver',6),
  ('volk','Волк','zver',7),('enot','Енот','zver',8),('krot','Крот','zver',9),
  ('belka','Белка','zver',10),('bobr','Бобр','zver',11),('olen','Олень','zver',12),
  ('kaban','Кабан','zver',13),('vydra','Выдра','zver',14),('rys','Рысь','zver',15),
  ('mysh','Мышь','zver',16),('letuchaya_mysh','Летучая мышь','zver',17),('barsuk','Барсук','zver',18),
  ('letyaga','Белка-летяга','zver',19),('horek','Хорёк','zver',20),('los','Лось','zver',21),
  ('sobol','Соболь','zver',22),('lan','Лань','zver',23),('rosomaha','Росомаха','zver',24),('filin','Филин','zver',25),
  ('gornostay','Горностай','zver',26),('suslik','Суслик','zver',27),('kunica','Куница','zver',28),
  -- Растения
  ('muhomor','Мухомор','rastenie',30),('romashka','Ромашка','rastenie',31),('zemlyanika','Земляника','rastenie',32),
  ('oduvanchik','Одуванчик','rastenie',33),('podsolnuh','Подсолнух','rastenie',34),('kolokolchik','Колокольчик','rastenie',35),
  ('paporotnik','Папоротник','rastenie',36),('klever','Клевер','rastenie',37),('kuvshinka','Кувшинка','rastenie',38),
  ('shipovnik','Шиповник','rastenie',39),('landysh','Ландыш','rastenie',40),('mak','Мак','rastenie',41),
  ('dub','Дуб','rastenie',42),('vasilek','Василёк','rastenie',43),('tulpan','Тюльпан','rastenie',44),
  ('kaktus','Кактус','rastenie',45),('naperstyanka','Наперстянка','rastenie',46),('lotos','Лотос','rastenie',47),
  ('vinograd','Виноград','rastenie',48),('nezabudka','Незабудка','rastenie',49),('chertopoloh','Чертополох','rastenie',50),
  ('vyunok','Вьюнок','rastenie',51),('kolos','Колосок','rastenie',52),('fialka','Фиалка','rastenie',53),
  ('lopuh','Лопух','rastenie',54),
  -- Насекомые
  ('zhuk','Жук-олень','nasekomoe',60),('korovka','Божья коровка','nasekomoe',61),('babochka','Бабочка','nasekomoe',62),
  ('strekoza','Стрекоза','nasekomoe',63),('pchela','Пчела','nasekomoe',64),('svetlyachok','Светлячок','nasekomoe',65),
  ('kuznechik','Кузнечик','nasekomoe',66),('muravey','Муравей','nasekomoe',67),('bogomol','Богомол','nasekomoe',68),
  ('ulitka','Улитка','nasekomoe',69),('skarabey','Скарабей','nasekomoe',70),('komar','Комар','nasekomoe',71),
  ('gusenica','Гусеница','nasekomoe',72),('osa','Оса','nasekomoe',73),('cikada','Цикада','nasekomoe',74),
  ('pauk','Паук','nasekomoe',75),('shmel','Шмель','nasekomoe',76),('vodomerka','Водомерка','nasekomoe',77),
  ('nosorog','Жук-носорог','nasekomoe',78),('motylek','Мотылёк','nasekomoe',79),('sverchok','Сверчок','nasekomoe',80),
  ('bronzovka','Бронзовка','nasekomoe',81),('gerkules','Жук-геркулес','nasekomoe',82),
  ('mayskiy_zhuk','Майский жук','nasekomoe',83),('plavunec','Плавунец','nasekomoe',84),('zlatoglazka','Златоглазка','nasekomoe',85),
  -- Волна 10: zver
  ('zubr','Зубр','zver',100),
  ('laska','Ласка','zver',101),
  ('kosulya','Косуля','zver',102),
  ('kabarga','Кабарга','zver',103),
  ('norka','Норка','zver',104),
  ('ondatra','Ондатра','zver',105),
  ('surok','Сурок','zver',106),
  ('dyatel','Дятел','zver',107),
  ('snegir','Снегирь','zver',108),
  ('sinica','Синица','zver',109),
  ('soroka','Сорока','zver',110),
  ('voron','Ворон','zver',111),
  ('gluhar','Глухарь','zver',112),
  ('zimorodok','Зимородок','zver',113),
  ('solovey','Соловей','zver',114),
  ('lyagushka','Лягушка','zver',115),
  ('uzh','Уж','zver',116),
  ('yashcherica','Ящерица','zver',117),
  -- Волна 10: rastenie
  ('brusnika','Брусника','rastenie',200),
  ('chernika','Черника','rastenie',201),
  ('malina','Малина','rastenie',202),
  ('ryabina','Рябина','rastenie',203),
  ('el','Ель','rastenie',204),
  ('sosna','Сосна','rastenie',205),
  ('bereza','Берёза','rastenie',206),
  ('klen','Клён','rastenie',207),
  ('iva','Ива','rastenie',208),
  ('krapiva','Крапива','rastenie',209),
  ('ivan_chay','Иван-чай','rastenie',210),
  ('belyy_grib','Белый гриб','rastenie',211),
  ('lisichka','Лисичка','rastenie',212),
  ('kamysh','Камыш','rastenie',213),
  ('zveroboy','Зверобой','rastenie',214),
  -- Волна 10: nasekomoe
  ('shershen','Шершень','nasekomoe',300),
  ('zhuzhelica','Жужелица','nasekomoe',301),
  ('usach','Жук-усач','nasekomoe',302),
  ('zlatka','Жук-златка','nasekomoe',303),
  ('medvedka','Медведка','nasekomoe',304),
  ('klop_soldatik','Клоп-солдатик','nasekomoe',305),
  ('cherv','Дождевой червь','nasekomoe',306),
  ('stonozhka','Сороконожка','nasekomoe',307),
  ('shelkopryad','Шелкопряд','nasekomoe',308)
on conflict (code) do update set name=excluded.name,category=excluded.category,sort=excluded.sort;

-- Случайный грейд по весам выпадения
create or replace function roll_grade()
returns int language plpgsql as $$
declare total int; r numeric; acc int := 0; g int;
begin
  select sum(weight) into total from rarities;
  r := random() * total;
  for g in select grade from rarities order by grade loop
    acc := acc + (select weight from rarities where grade = g);
    if r < acc then return g; end if;
  end loop;
  return 1;
end $$;

-- Открыть пак: 20 шишек → 7 карт. Возвращает jsonb-массив выпавших карт.
create or replace function open_pack(p_child uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare price int := 20; cards_n int := 7; w wallets; c_id uuid; i int; g int; t card_types;
        was_new boolean; result jsonb := '[]'::jsonb;
begin
  select * into w from wallets where user_id = p_child for update;
  if not found then raise exception 'wallet not found'; end if;
  if w.balance < price then raise exception 'not enough cones: have %, need %', w.balance, price; end if;
  select circle_id into c_id from users where id = p_child;

  update wallets set balance = balance - price, total_spent = total_spent + price
    where user_id = p_child;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, p_child, null, price, 'purchase', 'Лесной пак');

  for i in 1..cards_n loop
    g := roll_grade();
    select * into t from card_types order by random() limit 1;
    was_new := not exists (select 1 from user_cards where user_id=p_child and type_id=t.id and grade=g);
    insert into user_cards(user_id, type_id, grade, qty) values (p_child, t.id, g, 1)
      on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;
    result := result || jsonb_build_object('code',t.code,'name',t.name,'category',t.category,
      'grade',g,'is_new',was_new);
  end loop;

  perform check_achievements(p_child);
  return result;
end $$;

-- Прокачка: 3 карты ОДНОГО существа ОДНОГО грейда N → 1 карта грейда N+1
create or replace function merge_cards(p_child uuid, p_type uuid, p_grade int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; new_g int; bonus boolean := false;
begin
  if p_grade >= 6 then raise exception 'max grade'; end if;
  select qty into have from user_cards where user_id=p_child and type_id=p_type and grade=p_grade for update;
  if have is null or have < 3 then raise exception 'need 3 cards'; end if;

  -- бонус «эволюция удалась вдвойне»: 5%, только до Легендарной. Золото так не получить,
  -- и потерять на слиянии нельзя никогда — рандом работает исключительно вверх.
  new_g := p_grade + 1;
  if p_grade + 2 <= 5 and random() < 0.05 then new_g := p_grade + 2; bonus := true; end if;

  update user_cards set qty = qty - 3 where user_id=p_child and type_id=p_type and grade=p_grade;
  delete from user_cards where user_id=p_child and type_id=p_type and grade=p_grade and qty <= 0;
  insert into user_cards(user_id, type_id, grade, qty, merged) values (p_child, p_type, new_g, 1, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1, merged = user_cards.merged + 1;

  perform check_achievements(p_child);
  return jsonb_build_object('ok',true,'new_grade',new_g,'bonus',bonus);
end $$;

-- Продать карту банку по РЕГРЕССИВНОЙ таблице quicksell (топ — за копейки, стимул продать игроку)
create or replace function sell_card_to_bank(p_child uuid, p_type uuid, p_grade int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; c_id uuid; payout int;
begin
  perform assert_tradable(p_type);
  select qty into have from user_cards where user_id=p_child and type_id=p_type and grade=p_grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;
  payout := greatest(1, (select quicksell from rarities where grade=p_grade));
  select circle_id into c_id from users where id = p_child;

  update user_cards set qty = qty - 1 where user_id=p_child and type_id=p_type and grade=p_grade;
  delete from user_cards where user_id=p_child and type_id=p_type and grade=p_grade and qty <= 0;
  update wallets set balance = balance + payout, total_earned = total_earned + payout
    where user_id = p_child;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, null, p_child, payout, 'payout', 'Продажа карты Банку');
  return jsonb_build_object('ok',true,'payout',payout);
end $$;

-- Выставить дубль на рынок. Цена в коридоре [номинал/2 .. номинал*3]. Карта резервируется.
create or replace function list_card(p_child uuid, p_type uuid, p_grade int, p_price int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; c_id uuid; base int; lid uuid;
begin
  select qty into have from user_cards where user_id=p_child and type_id=p_type and grade=p_grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;
  base := (select price from rarities where grade=p_grade);
  if p_price < greatest(1, base/2) or p_price > base*3 then raise exception 'price out of range'; end if;
  select circle_id into c_id from users where id = p_child;

  update user_cards set qty = qty - 1 where user_id=p_child and type_id=p_type and grade=p_grade;
  delete from user_cards where user_id=p_child and type_id=p_type and grade=p_grade and qty <= 0;
  insert into card_listings(seller_id,circle_id,type_id,grade,price)
    values (p_child,c_id,p_type,p_grade,p_price) returning id into lid;
  return jsonb_build_object('ok',true,'listing',lid);
end $$;

-- Купить лот. Покупатель платит продавцу (перевод), карта переходит покупателю.
create or replace function buy_listing(p_child uuid, p_listing uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l card_listings; w wallets;
begin
  select * into l from card_listings where id=p_listing for update;
  if not found or l.status <> 'open' then raise exception 'listing unavailable'; end if;
  if l.seller_id = p_child then raise exception 'own listing'; end if;
  select * into w from wallets where user_id=p_child for update;
  if w.balance < l.price then raise exception 'not enough cones'; end if;

  update wallets set balance = balance - l.price, total_spent = total_spent + l.price where user_id=p_child;
  update wallets set balance = balance + l.price, total_earned = total_earned + l.price where user_id=l.seller_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (l.circle_id, p_child, l.seller_id, l.price, 'transfer', 'Покупка карты на рынке');
  insert into user_cards(user_id,type_id,grade,qty) values (p_child,l.type_id,l.grade,1)
    on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
  update card_listings set status='sold', buyer_id=p_child, closed_at=now() where id=p_listing;

  perform check_achievements(p_child);
  return jsonb_build_object('ok',true);
end $$;

-- Снять свой лот, вернуть карту (undo-предохранитель на стороне клиента даёт 5 мин)
create or replace function cancel_listing(p_child uuid, p_listing uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l card_listings;
begin
  select * into l from card_listings where id=p_listing for update;
  if not found or l.status <> 'open' or l.seller_id <> p_child then raise exception 'cannot cancel'; end if;
  update card_listings set status='cancelled', closed_at=now() where id=p_listing;
  insert into user_cards(user_id,type_id,grade,qty) values (p_child,l.type_id,l.grade,1)
    on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
  return jsonb_build_object('ok',true);
end $$;

-- ═══════════════════ Альбом-награды (long-term крючок) ═══════════════════
-- Таблица выданных наград (идемпотентность: одна награда — один раз)
create table if not exists card_rewards (
  user_id   uuid not null references users(id) on delete cascade,
  code      text not null,          -- 'being:<type_code>' | 'cat:<category>' | 'all'
  reward    int  not null,          -- сколько шишек начислено
  earned_at timestamptz not null default now(),
  primary key (user_id, code)
);

-- Проверить и выдать все заслуженные альбом-награды. Идемпотентно.
-- Существо целиком (6 грейдов) → +50. Категория целиком → +200 + бейдж. Всё (59) → +1000 + бейдж + титул.
-- Возвращает jsonb-массив только НОВЫХ наград (для показа на клиенте).
create or replace function check_card_rewards(p_child uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c_id uuid; rec record; v_code text; payout int; result jsonb := '[]'::jsonb;
        total_types int; owned_full int;
begin
  select circle_id into c_id from users where id = p_child;

  -- 1) существа, собранные целиком (есть все 6 грейдов, qty>0 в каждом)
  for rec in
    select ct.id, ct.code, ct.name from card_types ct
    where ct.category <> 'special'
      and (select count(distinct uc.grade) from user_cards uc
           where uc.user_id=p_child and uc.type_id=ct.id and uc.qty>0) = 6
  loop
    v_code := 'being:' || rec.code; payout := 50;
    if not exists (select 1 from card_rewards where user_id=p_child and code=v_code) then
      insert into card_rewards(user_id,code,reward) values (p_child,v_code,payout);
      update wallets set balance=balance+payout, total_earned=total_earned+payout where user_id=p_child;
      insert into transactions(circle_id,from_user,to_user,amount,type,message)
        values (c_id,null,p_child,payout,'reward','Собрано существо: '||rec.name||' ✨');
      result := result || jsonb_build_object('kind','being','name',rec.name,'reward',payout);
    end if;
  end loop;

  -- 2) категории, собранные целиком (все существа категории собраны целиком = have all 6 grades)
  for rec in
    select category,
      count(*) as total,
      count(*) filter (where full6) as done
    from (
      select ct.category,
        (select count(distinct uc.grade) from user_cards uc
         where uc.user_id=p_child and uc.type_id=ct.id and uc.qty>0)=6 as full6
      from card_types ct where ct.category <> 'special'
    ) s group by category
  loop
    if rec.total>0 and rec.done=rec.total then
      v_code := 'cat:' || rec.category; payout := 200;
      if not exists (select 1 from card_rewards where user_id=p_child and code=v_code) then
        insert into card_rewards(user_id,code,reward) values (p_child,v_code,payout);
        update wallets set balance=balance+payout, total_earned=total_earned+payout where user_id=p_child;
        insert into transactions(circle_id,from_user,to_user,amount,type,message)
          values (c_id,null,p_child,payout,'reward','Собран альбом: '||rec.category||' 🏆');
        perform award_badge(p_child, 'album_'||rec.category);
        result := result || jsonb_build_object('kind','category','name',rec.category,'reward',payout);
      end if;
    end if;
  end loop;

  -- 2b) сезон, собранный целиком — главная достижимая цель (около 270 паков при гаранте)
  for rec in
    select cs.code, cs.name,
      count(ct.id) as total,
      count(ct.id) filter (where (select count(distinct uc.grade) from user_cards uc
                                  where uc.user_id=p_child and uc.type_id=ct.id and uc.qty>0)=6) as done
    from card_seasons cs join card_types ct on ct.season = cs.code
    group by cs.code, cs.name
  loop
    if rec.total > 0 and rec.done = rec.total then
      v_code := 'season:' || rec.code; payout := 300;
      if not exists (select 1 from card_rewards where user_id=p_child and code=v_code) then
        insert into card_rewards(user_id,code,reward) values (p_child,v_code,payout);
        update wallets set balance=balance+payout, total_earned=total_earned+payout where user_id=p_child;
        insert into transactions(circle_id,from_user,to_user,amount,type,message)
          values (c_id,null,p_child,payout,'reward','Сезон собран: '||rec.name);
        perform award_badge(p_child, 'season_'||rec.code);
        result := result || jsonb_build_object('kind','season','name',rec.name,'reward',payout);
      end if;
    end if;
  end loop;

  -- 3) вся коллекция (все существа собраны целиком)
  select count(*) into total_types from card_types where category <> 'special';
  select count(*) into owned_full from (
    select ct.id from card_types ct
    where ct.category <> 'special'
      and (select count(distinct uc.grade) from user_cards uc
           where uc.user_id=p_child and uc.type_id=ct.id and uc.qty>0)=6
  ) s;
  if total_types>0 and owned_full=total_types then
    v_code := 'all'; payout := 1000;
    if not exists (select 1 from card_rewards where user_id=p_child and code=v_code) then
      insert into card_rewards(user_id,code,reward) values (p_child,v_code,payout);
      update wallets set balance=balance+payout, total_earned=total_earned+payout where user_id=p_child;
      insert into transactions(circle_id,from_user,to_user,amount,type,message)
        values (c_id,null,p_child,payout,'reward','ВСЯ Лесная коллекция собрана! 👑');
      perform award_badge(p_child, 'album_master');
      result := result || jsonb_build_object('kind','all','name','Хранитель Леса','reward',payout);
    end if;
  end if;

  return result;
end $$;

-- ═══════════════════ Титулы и лор грейдов ═══════════════════
-- Шесть ячеек в полке — это не светофор рангов, а биография героя. Титул и фраза заданы
-- по КАТЕГОРИИ и грейду: ровно те архетипы, по которым генерился арт (уличный → скаут →
-- ученик магии → рунный рыцарь → боевой маг → дух леса), поэтому текст всегда совпадает с картинкой.
create table if not exists card_lore (
  category text not null,
  grade    int  not null references rarities(grade),
  title    text not null,
  lore     text not null,
  primary key (category, grade)
);

insert into card_lore(category, grade, title, lore) values
  -- звери
  ('zver',1,'Уличный сорванец','Ещё никто — но уже с характером: носится по тропам и ничего не боится.'),
  ('zver',2,'Лесной скаут','Выучил все тропы, носит плащ из листа и знает, где спрятаны жёлуди.'),
  ('zver',3,'Ученик магии','Впервые зажёг в лапах голубую искру — и лес это заметил.'),
  ('zver',4,'Рунный рыцарь','Броня в светящихся рунах, взгляд серьёзный: теперь он защищает своих.'),
  ('zver',5,'Боевой маг','Управляет бурей и светом. Про него уже рассказывают у костра.'),
  ('zver',6,'Дух леса','Хранитель, чьё имя лес помнит вечно. Золото, крылья и тишина.'),
  -- растения
  ('rastenie',1,'Росток','Только проклюнулся, а уже тянется к солнцу изо всех сил.'),
  ('rastenie',2,'Травник','Знает, какая роса лечит, а какая — просто вкусная.'),
  ('rastenie',3,'Заклинатель','На листьях загораются зелёные знаки — учится говорить с лесом.'),
  ('rastenie',4,'Рунный страж','Стоит на границе поляны и не пускает беду.'),
  ('rastenie',5,'Дух-шаман','Его корни слышат весь лес, а голос успокаивает бурю.'),
  ('rastenie',6,'Божество рощи','Из него растёт свет. Роща живёт, пока он цветёт.'),
  -- насекомые
  ('nasekomoe',1,'Букашка-храбрец','Крохотный, но уже лезет на самую высокую травинку.'),
  ('nasekomoe',2,'Разведчик','Летает дальше всех и первым узнаёт лесные новости.'),
  ('nasekomoe',3,'Ученик-алхимик','Смешивает росу и пыльцу — получается свет.'),
  ('nasekomoe',4,'Рунный гладиатор','Панцирь как броня, а усики ловят магию за версту.'),
  ('nasekomoe',5,'Чемпион роя','За ним поднимается весь рой — и никто не спорит.'),
  ('nasekomoe',6,'Золотое божество','Крылья как витраж, а шаг — как удар грома.')
on conflict (category, grade) do update set title=excluded.title, lore=excluded.lore;

-- ═══════════════════ Фамильяр (питомец на поляне) ═══════════════════
-- Выбранная карта видна на главном экране: прокачал грейд — питомец на глазах стал круче.
alter table users add column if not exists familiar_type  uuid references card_types(id);
alter table users add column if not exists familiar_grade int references rarities(grade);

-- Поставить питомца (карта должна быть у ребёнка) либо снять (p_type = null)
create or replace function set_familiar(p_child uuid, p_type uuid, p_grade int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int;
begin
  if p_type is null then
    update users set familiar_type=null, familiar_grade=null where id=p_child;
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;
  select qty into have from user_cards where user_id=p_child and type_id=p_type and grade=p_grade;
  if have is null or have < 1 then raise exception 'no card'; end if;
  update users set familiar_type=p_type, familiar_grade=p_grade where id=p_child;
  return jsonb_build_object('ok', true);
end $$;

-- ═══════════════════ Заявки на покупку («Хочу такую карту») ═══════════════════
-- Ребёнок объявляет спрос на конкретную карту (существо+грейд) по своей цене; у кого она есть —
-- продаёт в один тап. Замыкает петлю альбом → рынок и показывает детям спрос и предложение.
-- Шишки НЕ холдируются: заявка — объявление, а не резерв. Наличие денег проверяется при продаже,
-- а список показывает флаг «обеспечена», чтобы продавец не жал вслепую.
create table if not exists card_wants (
  id         uuid primary key default gen_random_uuid(),
  buyer_id   uuid not null references users(id) on delete cascade,
  circle_id  uuid not null references circles(id) on delete cascade,
  type_id    uuid not null references card_types(id) on delete cascade,
  grade      int  not null references rarities(grade),
  price      int  not null check (price > 0),
  status     text not null default 'open' check (status in ('open','filled','cancelled')),
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);
-- одна открытая заявка на карту от одного ребёнка (повтор = смена цены)
create unique index if not exists card_wants_one_open on card_wants(buyer_id, type_id, grade) where status = 'open';
create index if not exists card_wants_circle_open on card_wants(circle_id) where status = 'open';

-- Создать/обновить заявку. Цена в том же коридоре, что и лоты: [номинал/2 .. номинал*3].
create or replace function create_want(p_child uuid, p_type uuid, p_grade int, p_price int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c_id uuid; base int; wid uuid; open_n int; already boolean;
begin
  perform assert_market(p_child);
  perform assert_tradable(p_type);
  base := (select price from rarities where grade = p_grade);
  if base is null then raise exception 'bad grade'; end if;
  if p_price < greatest(1, base/2) or p_price > base*3 then raise exception 'price out of range'; end if;
  select circle_id into c_id from users where id = p_child;

  already := exists (select 1 from card_wants
    where buyer_id=p_child and type_id=p_type and grade=p_grade and status='open');
  if not already then
    select count(*) into open_n from card_wants where buyer_id=p_child and status='open';
    if open_n >= 10 then raise exception 'too many wants'; end if;   -- не превращать альбом в спам заявок
  end if;

  insert into card_wants(buyer_id, circle_id, type_id, grade, price)
    values (p_child, c_id, p_type, p_grade, p_price)
  on conflict (buyer_id, type_id, grade) where status='open'
    do update set price = excluded.price, created_at = now()
  returning id into wid;
  return jsonb_build_object('ok', true, 'want', wid, 'price', p_price);
end $$;

-- Снять свою заявку
create or replace function cancel_want(p_child uuid, p_want uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update card_wants set status='cancelled', closed_at=now()
    where id=p_want and buyer_id=p_child and status='open';
  if not found then raise exception 'cannot cancel'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Продать свою карту по чужой заявке: карта → покупателю, шишки → продавцу.
create or replace function fill_want(p_seller uuid, p_want uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w card_wants; have int; bal int;
begin
  select * into w from card_wants where id=p_want for update;
  if not found or w.status <> 'open' then raise exception 'want unavailable'; end if;
  if w.buyer_id = p_seller then raise exception 'own want'; end if;
  if (select circle_id from users where id=p_seller) is distinct from w.circle_id then raise exception 'other circle'; end if;

  select qty into have from user_cards where user_id=p_seller and type_id=w.type_id and grade=w.grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;
  select balance into bal from wallets where user_id=w.buyer_id for update;
  if bal is null or bal < w.price then raise exception 'buyer has no cones'; end if;

  update wallets set balance=balance-w.price, total_spent=total_spent+w.price where user_id=w.buyer_id;
  update wallets set balance=balance+w.price, total_earned=total_earned+w.price where user_id=p_seller;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (w.circle_id, w.buyer_id, p_seller, w.price, 'transfer', 'Продажа по заявке');

  update user_cards set qty=qty-1 where user_id=p_seller and type_id=w.type_id and grade=w.grade;
  delete from user_cards where user_id=p_seller and type_id=w.type_id and grade=w.grade and qty<=0;
  insert into user_cards(user_id, type_id, grade, qty) values (w.buyer_id, w.type_id, w.grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;

  update card_wants set status='filled', closed_at=now() where id=p_want;
  perform notify_child(w.buyer_id, 'По твоей заявке нашлась карта — она уже в альбоме 🙋');
  perform check_card_rewards(w.buyer_id);
  perform check_achievements(w.buyer_id);
  return jsonb_build_object('ok', true, 'earned', w.price);
end $$;

-- ═══════════════════ P2P-предохранители ═══════════════════
-- Отмена сделки покупателем в течение 5 минут (реверс: карта→продавцу, шишки→покупателю).
-- Защита от импульсивной покупки/слива любимой карты.
create or replace function undo_purchase(p_child uuid, p_listing uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l card_listings; have int; fee int; net int;
begin
  select * into l from card_listings where id=p_listing for update;
  if not found or l.status <> 'sold' or l.buyer_id <> p_child then raise exception 'nothing to undo'; end if;
  if now() - l.closed_at > interval '5 minutes' then raise exception 'undo window passed'; end if;

  -- у покупателя должна остаться купленная карта (не сплавил дальше)
  select qty into have from user_cards where user_id=p_child and type_id=l.type_id and grade=l.grade;
  if have is null or have < 1 then raise exception 'card already gone'; end if;

  -- реверс денег: покупателю возвращается вся цена, с продавца снимается ровно то, что он получил
  -- (цена минус комиссия), а сама комиссия уходит обратно из кассы банка. Иначе отмена либо
  -- вгоняла продавца в минус на комиссию, либо печатала эти шишки из воздуха.
  fee := card_fee(l.price); net := l.price - fee;
  update wallets set balance=balance+l.price, total_spent=greatest(0,total_spent-l.price) where user_id=p_child;
  update wallets set balance=greatest(0,balance-net), total_earned=greatest(0,total_earned-net) where user_id=l.seller_id;
  if fee > 0 then update bank_account set treasury = greatest(0, treasury - fee) where id='main'; end if;
  insert into transactions(circle_id,from_user,to_user,amount,type,message)
    values (l.circle_id, l.seller_id, p_child, net, 'transfer', 'Отмена сделки (возврат)');
  -- реверс карты: у покупателя −1, продавцу +1
  update user_cards set qty=qty-1 where user_id=p_child and type_id=l.type_id and grade=l.grade;
  delete from user_cards where user_id=p_child and type_id=l.type_id and grade=l.grade and qty<=0;
  insert into user_cards(user_id,type_id,grade,qty) values (l.seller_id,l.type_id,l.grade,1)
    on conflict (user_id,type_id,grade) do update set qty=user_cards.qty+1;
  update card_listings set status='cancelled' where id=p_listing;
  return jsonb_build_object('ok',true,'refunded',l.price);
end $$;

-- ═══════════════════ «Знаешь ли ты?» — факт за собранное существо ═══════════════════
-- Открывается, когда существо собрано целиком (6/6). Природоведческий слой: собирать
-- существо целиком становится интереснее, а родителю есть что обсудить с ребёнком.
create table if not exists card_facts (
  code text primary key references card_types(code) on delete cascade,
  fact text not null
);

insert into card_facts(code, fact) values
  -- звери
  ('burunduk','Бурундук уносит еду в защёчных мешках — набивает их так, что щёки становятся больше головы.'),
  ('ezh','Испугавшись, ёж сворачивается в клубок: снаружи остаются только иголки.'),
  ('lisa','Лиса слышит мышь под снегом и прыгает прямо в сугроб, чтобы её поймать.'),
  ('sova','Сова поворачивает голову далеко назад: её глаза почти не двигаются в глазницах.'),
  ('zayac','Зимой заяц-беляк меняет серую шубку на белую, чтобы его не было видно на снегу.'),
  ('medved','Всю зиму медведь спит в берлоге и не ест — живёт за счёт жира, накопленного осенью.'),
  ('volk','Волки воют, чтобы перекликаться со своей стаей на большом расстоянии.'),
  ('enot','Енота-полоскуна назвали так за привычку перебирать еду лапами в воде.'),
  ('krot','Крот почти слепой, зато роет длинные подземные ходы и находит червей на ощупь.'),
  ('belka','Белка прячет орехи в разных местах, и часть тайников забывает — из них вырастают деревья.'),
  ('bobr','Бобр валит деревья зубами и строит на речке плотину — получается свой пруд.'),
  ('olen','Каждый год олень сбрасывает рога, и весной у него вырастают новые.'),
  ('kaban','Кабан рыхлит землю пятачком, разыскивая корешки и жёлуди.'),
  ('vydra','Выдра отлично плавает и умеет закрывать под водой ноздри и уши.'),
  ('rys','У рыси кисточки на ушах, а широкие лапы работают как снегоступы.'),
  ('mysh','Мышь грызёт постоянно: её передние зубы растут всю жизнь.'),
  ('letuchaya_mysh','Летучая мышь находит дорогу в темноте по эху собственного писка.'),
  ('barsuk','Барсук роет нору с несколькими выходами и поддерживает в ней чистоту.'),
  ('letyaga','Белка-летяга не летает, а планирует между деревьями на складке кожи между лапами.'),
  ('horek','Хорёк — родственник ласки; в случае опасности он выпускает резкий запах.'),
  ('los','Лось — самый крупный зверь наших лесов, а рога у него плоские, как лопаты.'),
  ('sobol','Соболь ловко лазает по деревьям, а его мех — один из самых тёплых.'),
  ('lan','Лань убегает прыжками и умеет резко менять направление.'),
  ('rosomaha','Росомаха невелика, но очень сильна — способна отогнать зверя крупнее себя.'),
  ('filin','Филин — самая крупная сова, и летает почти бесшумно: перья гасят звук.'),
  ('gornostay','Зимой горностай белеет весь, кроме чёрного кончика хвоста.'),
  ('suslik','Суслик встаёт столбиком, чтобы осмотреться, и свистом предупреждает соседей.'),
  ('kunica','Куница ночует в дуплах и легко бегает по веткам.'),
  ('zubr','Зубр — самый тяжёлый зверь Европы; когда-то он почти исчез, и его спасли люди.'),
  ('laska','Ласка — самый маленький хищник: она пролезает даже в мышиную нору.'),
  ('kosulya','Косуля при опасности лает — коротко и резко, будто собака.'),
  ('kabarga','У кабарги нет рогов, зато есть длинные клыки.'),
  ('norka','Норка живёт у воды и охотится на лягушек и рыбу.'),
  ('ondatra','Ондатра строит хатки из тростника прямо на воде.'),
  ('surok','Сурок спит в норе почти полгода и просыпается только весной.'),
  ('dyatel','Дятел бьёт клювом по стволу очень быстро, а голову бережёт крепкий череп.'),
  ('snegir','Красная грудка — у самца снегиря, а самочка серая.'),
  ('sinica','Зимой синица достаёт личинок из-под коры и охотно прилетает на кормушку.'),
  ('soroka','Сорока узнаёт себя в зеркале — это умеют очень немногие животные.'),
  ('voron','Ворон умеет доставать еду палочкой и живёт очень долго.'),
  ('gluhar','Во время весенней песни глухарь на несколько мгновений перестаёт слышать — за это его так и назвали.'),
  ('zimorodok','Зимородок ныряет в воду прямо с ветки и хватает рыбку клювом.'),
  ('solovey','Соловей поёт по ночам, и в его песне десятки разных колен.'),
  ('lyagushka','Лягушка дышит не только лёгкими, но и кожей — поэтому ей нужна влага.'),
  ('uzh','Ужа узнают по двум жёлтым пятнам на голове — он не ядовит.'),
  ('yashcherica','Ящерица может отбросить хвост, спасаясь от врага, — потом отрастёт новый.'),
  -- растения
  ('muhomor','Красный мухомор ядовит: любоваться можно, трогать и есть — нельзя.'),
  ('romashka','У ромашки не один цветок, а множество мелких, собранных в корзинку.'),
  ('zemlyanika','У земляники «ягода» — разросшееся цветоложе, а настоящие плодики — крапинки на ней.'),
  ('oduvanchik','Пушистый шарик одуванчика — семена с парашютиками, они улетают с ветром.'),
  ('podsolnuh','Молодые подсолнухи поворачивают головки вслед за солнцем.'),
  ('kolokolchik','В дождь колокольчик закрывается, чтобы пыльца не намокла.'),
  ('paporotnik','Папоротник не цветёт: он размножается спорами, а не семенами.'),
  ('klever','Обычно у клевера три листочка, поэтому найти четвёртый так трудно.'),
  ('kuvshinka','На ночь кувшинка закрывает цветок и прячет его под воду.'),
  ('shipovnik','В плодах шиповника много витамина C, а шипы защищают куст.'),
  ('landysh','Ландыш красив, но ядовит целиком — вместе с красными ягодами.'),
  ('mak','В одной маковой коробочке созревают тысячи крошечных семян.'),
  ('dub','Из одного жёлудя вырастает дуб, который живёт сотни лет.'),
  ('vasilek','Василёк растёт по краям полей и в пшенице считается сорняком.'),
  ('tulpan','Тюльпан вырастает из луковицы, которая всю зиму спит в земле.'),
  ('kaktus','Колючки кактуса — это его листья, а воду он запасает в стебле.'),
  ('naperstyanka','Цветки наперстянки похожи на напёрстки, но растение ядовито.'),
  ('lotos','С листьев лотоса вода скатывается каплями и совсем их не смачивает.'),
  ('vinograd','Виноград цепляется усиками и забирается по опоре вверх.'),
  ('nezabudka','У незабудки крошечные голубые цветки с жёлтым глазком в середине.'),
  ('chertopoloh','Колючки берегут чертополох от травоядных, а пчёлы любят его цветки.'),
  ('vyunok','Вьюнок обвивает опору по спирали и всегда закручивается в одну сторону.'),
  ('kolos','В колосе созревают зёрна, из которых мелют муку.'),
  ('fialka','Лесная фиалка зацветает ранней весной, пока деревья ещё без листьев.'),
  ('lopuh','Цепкие соплодия лопуха подсказали людям идею застёжки-липучки.'),
  ('brusnika','Листья брусники не опадают: под снегом она остаётся зелёной.'),
  ('chernika','От черники язык синеет — в ней много красящих веществ.'),
  ('malina','Ягода малины состоит из множества маленьких сросшихся ягодок.'),
  ('ryabina','После первых морозов рябина становится слаще: горечь уходит.'),
  ('el','Ель не сбрасывает хвою на зиму, а меняет иголки понемногу.'),
  ('sosna','Сосна тянется к свету и растёт даже на песке, где другим деревьям трудно.'),
  ('bereza','Весной из берёзы течёт сладкий сок, а кора-береста не пропускает воду.'),
  ('klen','Семена клёна крылатые: падая, они крутятся, как вертолётики.'),
  ('iva','Ветка ивы, воткнутая во влажную землю, часто пускает корни и становится деревом.'),
  ('krapiva','Крапива жжётся волосками с едким соком, но в супе она уже безопасна.'),
  ('ivan_chay','Иван-чай одним из первых занимает выгоревшие места — за это его зовут огненной травой.'),
  ('belyy_grib','Белый гриб назвали так за то, что его мякоть остаётся белой даже после сушки.'),
  ('lisichka','Лисички почти никогда не бывают червивыми.'),
  ('kamysh','Камыш растёт прямо в воде, а внутри стебля у него воздушные ходы.'),
  ('zveroboy','Разотрёшь цветок зверобоя — и пальцы окрасятся в красноватый цвет.'),
  -- насекомые
  ('zhuk','«Рога» жука-оленя — это его челюсти: ими самцы борются друг с другом.'),
  ('korovka','Божья коровка за жизнь съедает тысячи тлей — потому её и любят садоводы.'),
  ('babochka','Бабочка пробует еду лапками: вкус она чувствует именно ими.'),
  ('strekoza','Глаз стрекозы состоит из тысяч крошечных глазков, и видит она почти вокруг себя.'),
  ('pchela','Пчёлы рассказывают друг другу дорогу к цветам особым танцем.'),
  ('svetlyachok','Светлячок светится холодным светом — тепла он почти не даёт.'),
  ('kuznechik','Кузнечик слышит ногами: его слуховые органы — на передних голенях.'),
  ('muravey','Муравей поднимает груз во много раз тяжелее себя самого.'),
  ('bogomol','Богомол замирает, сложив лапы, и хватает добычу молниеносным броском.'),
  ('ulitka','Улитка ползёт по слизи и потому не ранится даже об острые края.'),
  ('skarabey','Скарабей катает шар из навоза, а в древнем Египте его считали священным.'),
  ('komar','Кровь пьют только самки комаров — она нужна им для будущих яиц.'),
  ('gusenica','Гусеница ест листья и растёт, а потом становится куколкой и бабочкой.'),
  ('osa','Осиное гнездо бумажное: осы жуют древесину и лепят из неё соты.'),
  ('cikada','Цикада — одно из самых громких насекомых: её слышно очень далеко.'),
  ('pauk','Паук — не насекомое: у него восемь ног, а не шесть.'),
  ('shmel','Шмель мохнатый и потому летает даже в прохладную погоду.'),
  ('vodomerka','Водомерка бегает по воде: её лапки не смачиваются и опираются на плёнку.'),
  ('nosorog','Рог жука-носорога — вырост панциря: лёгкий и очень прочный.'),
  ('motylek','Ночные мотыльки летят на свет и подолгу кружат у фонаря.'),
  ('sverchok','Сверчок стрекочет, потирая крылья друг о друга.'),
  ('bronzovka','Бронзовка блестит, как металл, и умеет летать, почти не раскрывая надкрылья.'),
  ('gerkules','Жук-геркулес — один из самых крупных жуков на свете: вместе с рогом он с ладонь.'),
  ('mayskiy_zhuk','Майский жук летает весной, а его личинки живут в земле несколько лет.'),
  ('plavunec','Жук-плавунец уносит под воду пузырёк воздуха и дышит им.'),
  ('zlatoglazka','У златоглазки прозрачные кружевные крылья, а её личинки поедают тлю.'),
  ('shershen','Шершень — самая крупная наша оса; его гнездо трогать нельзя.'),
  ('zhuzhelica','Жужелица охотится ночью и бегает очень быстро.'),
  ('usach','У жука-усача усы бывают длиннее собственного тела.'),
  ('zlatka','Жуки-златки блестят на солнце, будто покрыты металлом.'),
  ('medvedka','Медведка роет ходы в земле передними лапами, похожими на лопатки.'),
  ('klop_soldatik','Клопа-солдатика легко узнать по красно-чёрному узору на спинке.'),
  ('cherv','Дождевой червь пропускает через себя землю и делает почву рыхлой.'),
  ('stonozhka','Ног у сороконожки вовсе не сорок: у разных видов их и меньше, и намного больше.'),
  ('shelkopryad','Гусеница тутового шелкопряда прядёт кокон из одной длинной шёлковой нити.')
on conflict (code) do update set fact = excluded.fact;

-- ═══════════════════ Слияние с топливом (C1) ═══════════════════
-- Затык обычного merge: пять разных дублей на руках, но ни одной тройки — прогресса нет.
-- Здесь карта поднимается на грейд за 2 своих + 4 ЛЮБЫХ карты того же грейда. Курс хуже,
-- чем 3 своих, поэтому «правильный» путь остаётся выгоднее, а тупик исчезает.
-- p_allow_unique=false бережёт альбом: если дублей на топливо не хватает и пришлось бы жечь
-- карты, которые стоят в полке в единственном экземпляре, функция откажет — клиент переспросит.
create or replace function merge_with_fuel(p_child uuid, p_type uuid, p_grade int, p_allow_unique boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; need int := 4; rec record; take int; spent jsonb := '[]'::jsonb; uniq_used int := 0;
begin
  if p_grade >= 6 then raise exception 'max grade'; end if;
  select qty into have from user_cards where user_id=p_child and type_id=p_type and grade=p_grade for update;
  if have is null or have < 2 then raise exception 'need 2 own'; end if;
  if have >= 3 then raise exception 'plain merge is cheaper'; end if;   -- три своих дешевле, не путать ребёнка

  -- сколько всего топлива доступно (любые карты этого грейда, кроме двух своих)
  if (select coalesce(sum(qty),0) from user_cards
      where user_id=p_child and grade=p_grade and type_id <> p_type) < need
    then raise exception 'need 4 fuel'; end if;
  -- если из дублей топлива не наберётся, придётся жечь единственные — только с разрешения
  if not p_allow_unique and (select coalesce(sum(qty-1),0) from user_cards
      where user_id=p_child and grade=p_grade and type_id <> p_type and qty > 1) < need
    then raise exception 'needs unique cards'; end if;

  -- проход 1: только излишки дублей — ни одна ячейка альбома не пустеет
  for rec in select uc.type_id, uc.qty, t.name from user_cards uc join card_types t on t.id=uc.type_id
             where uc.user_id=p_child and uc.grade=p_grade and uc.type_id <> p_type and uc.qty > 1
             order by uc.qty desc, t.sort for update
  loop
    exit when need <= 0;
    take := least(rec.qty - 1, need);
    update user_cards set qty = qty - take where user_id=p_child and type_id=rec.type_id and grade=p_grade;
    spent := spent || jsonb_build_object('name', rec.name, 'qty', take);
    need := need - take;
  end loop;
  -- проход 2: если дублей не хватило — добираем последние экземпляры (только с разрешения)
  if need > 0 then
    for rec in select uc.type_id, uc.qty, t.name from user_cards uc join card_types t on t.id=uc.type_id
               where uc.user_id=p_child and uc.grade=p_grade and uc.type_id <> p_type and uc.qty > 0
               order by t.sort for update
    loop
      exit when need <= 0;
      take := least(rec.qty, need);
      uniq_used := uniq_used + 1;                                 -- ячейка опустеет
      update user_cards set qty = qty - take where user_id=p_child and type_id=rec.type_id and grade=p_grade;
      spent := spent || jsonb_build_object('name', rec.name, 'qty', take);
      need := need - take;
    end loop;
  end if;
  delete from user_cards where user_id=p_child and grade=p_grade and qty <= 0;

  update user_cards set qty = qty - 2 where user_id=p_child and type_id=p_type and grade=p_grade;
  delete from user_cards where user_id=p_child and type_id=p_type and grade=p_grade and qty <= 0;
  insert into user_cards(user_id, type_id, grade, qty, merged) values (p_child, p_type, p_grade+1, 1, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1, merged = user_cards.merged + 1;

  perform check_achievements(p_child);
  return jsonb_build_object('ok', true, 'new_grade', p_grade+1, 'fuel', spent, 'emptied', uniq_used);
end $$;

-- ═══════════════════ След прокачки (C6) ═══════════════════
-- Карта, поднятая слиянием, помнит об этом: в детали видно «прокачана тобой».
alter table user_cards add column if not exists merged int not null default 0;

-- ═══════════════════ Обменная полка банка (C2) ═══════════════════
-- 5 ЛИШНИХ карт одного ранга → 1 случайная карта того же ранга, которой ещё нет в альбоме.
-- Жжёт только излишки (qty > 1), поэтому ни одна ячейка альбома не пустеет.
-- Эмиссию шишек не трогает: обмен идёт картами внутри одного ранга.
create or replace function exchange_cards(p_child uuid, p_grade int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare need int := 5; rec record; take int; spent jsonb := '[]'::jsonb; got card_types;
begin
  if (select coalesce(sum(qty-1),0) from user_cards where user_id=p_child and grade=p_grade and qty > 1) < need
    then raise exception 'need 5 spare'; end if;

  for rec in select uc.type_id, uc.qty, t.name from user_cards uc join card_types t on t.id=uc.type_id
             where uc.user_id=p_child and uc.grade=p_grade and uc.qty > 1
             order by uc.qty desc, t.sort for update
  loop
    exit when need <= 0;
    take := least(rec.qty - 1, need);
    update user_cards set qty = qty - take where user_id=p_child and type_id=rec.type_id and grade=p_grade;
    spent := spent || jsonb_build_object('name', rec.name, 'qty', take);
    need := need - take;
  end loop;

  -- в первую очередь то, чего в этой ячейке ещё нет; если собрано всё — просто случайная
  select * into got from card_types t where t.pack_drop and not exists (
    select 1 from user_cards uc where uc.user_id=p_child and uc.type_id=t.id and uc.grade=p_grade and uc.qty>0)
    order by random() limit 1;
  if got is null then select * into got from card_types where pack_drop order by random() limit 1; end if;

  insert into user_cards(user_id, type_id, grade, qty) values (p_child, got.id, p_grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;

  perform check_card_rewards(p_child);
  perform check_achievements(p_child);
  return jsonb_build_object('ok', true, 'spent', spent,
    'card', jsonb_build_object('code', got.code, 'name', got.name, 'category', got.category, 'grade', p_grade));
end $$;

-- ═══════════════════ Комиссия банка на P2P (D3) ═══════════════════
-- 10% с продажи карты уходит в кассу банка: сток шишек против инфляции (эмиссия 20-50/день)
-- и естественный тормоз для перепродажной суеты. Мелкие сделки (дешевле 10) комиссии не платят.
create or replace function card_fee(p_price int) returns int
  language sql immutable as $$ select case when p_price < 10 then 0 else (p_price / 10) end $$;

-- Покупка лота с комиссией: покупатель платит цену, продавец получает цену минус комиссия.
create or replace function buy_listing(p_child uuid, p_listing uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l card_listings; w wallets; fee int; net int;
begin
  perform assert_market(p_child);
  select * into l from card_listings where id=p_listing for update;
  if not found or l.status <> 'open' then raise exception 'listing unavailable'; end if;
  if l.seller_id = p_child then raise exception 'own listing'; end if;
  select * into w from wallets where user_id=p_child for update;
  if w.balance < l.price then raise exception 'not enough cones'; end if;
  fee := card_fee(l.price); net := l.price - fee;

  update wallets set balance = balance - l.price, total_spent = total_spent + l.price where user_id=p_child;
  update wallets set balance = balance + net, total_earned = total_earned + net where user_id=l.seller_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (l.circle_id, p_child, l.seller_id, net, 'transfer', 'Покупка карты на рынке');
  if fee > 0 then
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (l.circle_id, p_child, null, fee, 'fee', 'Комиссия рынка');
    update bank_account set treasury = treasury + fee where id = 'main';
  end if;
  insert into user_cards(user_id,type_id,grade,qty) values (p_child,l.type_id,l.grade,1)
    on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
  update card_listings set status='sold', buyer_id=p_child, closed_at=now() where id=p_listing;

  perform notify_child(l.seller_id, 'Твою карту купили на рынке за ' || l.price || ' 🌰 (тебе ' || net || ') 🏷');
  perform check_achievements(p_child);
  return jsonb_build_object('ok',true,'fee',fee);
end $$;

-- Та же комиссия при продаже по заявке
create or replace function fill_want(p_seller uuid, p_want uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w card_wants; have int; bal int; fee int; net int;
begin
  perform assert_market(p_seller);
  select * into w from card_wants where id=p_want for update;
  if not found or w.status <> 'open' then raise exception 'want unavailable'; end if;
  if w.buyer_id = p_seller then raise exception 'own want'; end if;
  if (select circle_id from users where id=p_seller) is distinct from w.circle_id then raise exception 'other circle'; end if;

  select qty into have from user_cards where user_id=p_seller and type_id=w.type_id and grade=w.grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;
  select balance into bal from wallets where user_id=w.buyer_id for update;
  if bal is null or bal < w.price then raise exception 'buyer has no cones'; end if;
  fee := card_fee(w.price); net := w.price - fee;

  update wallets set balance=balance-w.price, total_spent=total_spent+w.price where user_id=w.buyer_id;
  update wallets set balance=balance+net, total_earned=total_earned+net where user_id=p_seller;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (w.circle_id, w.buyer_id, p_seller, net, 'transfer', 'Продажа по заявке');
  if fee > 0 then
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (w.circle_id, w.buyer_id, null, fee, 'fee', 'Комиссия рынка');
    update bank_account set treasury = treasury + fee where id = 'main';
  end if;

  update user_cards set qty=qty-1 where user_id=p_seller and type_id=w.type_id and grade=w.grade;
  delete from user_cards where user_id=p_seller and type_id=w.type_id and grade=w.grade and qty<=0;
  insert into user_cards(user_id, type_id, grade, qty) values (w.buyer_id, w.type_id, w.grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;

  update card_wants set status='filled', closed_at=now() where id=p_want;
  perform notify_child(w.buyer_id, 'По твоей заявке нашлась карта — она уже в альбоме 🙋');
  perform check_card_rewards(w.buyer_id);
  perform check_achievements(w.buyer_id);
  return jsonb_build_object('ok', true, 'earned', net, 'fee', fee);
end $$;

-- ═══════════════════ Подарок карты другу (D4) ═══════════════════
-- Детям важнее подарить, чем продать. Не более 3 подарков в день, только внутри круга,
-- каждый подарок виден ведущему в логе сделок — защита от давления старших.
create table if not exists card_gifts (
  id        uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  from_user uuid not null references users(id) on delete cascade,
  to_user   uuid not null references users(id) on delete cascade,
  type_id   uuid not null references card_types(id) on delete cascade,
  grade     int  not null references rarities(grade),
  created_at timestamptz not null default now()
);
create index if not exists card_gifts_circle_idx on card_gifts(circle_id, created_at desc);

create or replace function gift_card(p_child uuid, p_to uuid, p_type uuid, p_grade int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; c_id uuid; today_n int; t card_types;
begin
  if p_child = p_to then raise exception 'self gift'; end if;
  select circle_id into c_id from users where id=p_child;
  if (select circle_id from users where id=p_to) is distinct from c_id then raise exception 'other circle'; end if;
  select count(*) into today_n from card_gifts
    where from_user=p_child and created_at >= (now() at time zone 'Europe/Moscow')::date;
  if today_n >= 3 then raise exception 'daily gift limit'; end if;

  select qty into have from user_cards where user_id=p_child and type_id=p_type and grade=p_grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;

  update user_cards set qty=qty-1 where user_id=p_child and type_id=p_type and grade=p_grade;
  delete from user_cards where user_id=p_child and type_id=p_type and grade=p_grade and qty<=0;
  insert into user_cards(user_id, type_id, grade, qty) values (p_to, p_type, p_grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;
  insert into card_gifts(circle_id, from_user, to_user, type_id, grade) values (c_id, p_child, p_to, p_type, p_grade);

  select * into t from card_types where id=p_type;
  perform send_message(p_child, p_to, 'emoji', 'Дарю тебе карту: ' || t.name || '!');
  perform check_card_rewards(p_to);
  perform check_achievements(p_to);
  return jsonb_build_object('ok', true, 'left_today', 3 - today_n - 1);
end $$;

-- ═══════════════════ Аукцион золотых карт (D2) ═══════════════════
-- Золотая карта (номинал 1000) не продаётся обычным лотом: её слишком легко слить за бесценок
-- или пропустить. Только аукцион на 24 часа — событие для всего круга.
-- Шишки резервируются в момент ставки (перебили — деньги сразу вернулись), поэтому у победителя
-- всегда есть чем заплатить. Комиссия банка — та же, что на рынке.
create table if not exists card_auctions (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references circles(id) on delete cascade,
  seller_id   uuid not null references users(id) on delete cascade,
  type_id     uuid not null references card_types(id) on delete cascade,
  grade       int  not null references rarities(grade),
  start_price int  not null check (start_price > 0),
  current_bid int,
  leader_id   uuid references users(id) on delete set null,
  status      text not null default 'live' check (status in ('live','sold','cancelled')),
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists card_auctions_live on card_auctions(circle_id) where status = 'live';

-- Выставить карту на аукцион (24 часа). Карта резервируется, как и при обычном лоте.
create or replace function start_card_auction(p_child uuid, p_type uuid, p_grade int, p_start int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; c_id uuid; aid uuid; base int;
begin
  perform assert_market(p_child);
  perform assert_tradable(p_type);
  base := (select price from rarities where grade=p_grade);
  if base is null then raise exception 'bad grade'; end if;
  if p_start < greatest(1, base/2) or p_start > base*3 then raise exception 'price out of range'; end if;
  select qty into have from user_cards where user_id=p_child and type_id=p_type and grade=p_grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;
  select circle_id into c_id from users where id=p_child;
  if exists (select 1 from card_auctions where seller_id=p_child and status='live')
    then raise exception 'auction already live'; end if;   -- по одному аукциону на ребёнка

  update user_cards set qty=qty-1 where user_id=p_child and type_id=p_type and grade=p_grade;
  delete from user_cards where user_id=p_child and type_id=p_type and grade=p_grade and qty<=0;
  insert into card_auctions(circle_id, seller_id, type_id, grade, start_price, ends_at)
    values (c_id, p_child, p_type, p_grade, p_start, now() + interval '24 hours') returning id into aid;
  return jsonb_build_object('ok', true, 'auction', aid);
end $$;

-- Ставка. Шаг — минимум +10% (но не меньше +1). Деньги резервируются, прошлому лидеру возвращаются.
create or replace function bid_card_auction(p_child uuid, p_auction uuid, p_amount int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a card_auctions; need int; bal int;
begin
  select * into a from card_auctions where id=p_auction for update;
  if not found or a.status <> 'live' or now() >= a.ends_at then raise exception 'auction closed'; end if;
  if a.seller_id = p_child then raise exception 'own auction'; end if;
  if (select circle_id from users where id=p_child) is distinct from a.circle_id then raise exception 'other circle'; end if;
  if a.leader_id = p_child then raise exception 'already leading'; end if;

  need := case when a.current_bid is null then a.start_price
               else greatest(a.current_bid + 1, a.current_bid + a.current_bid/10) end;
  if p_amount < need then raise exception 'bid too low: need %', need; end if;
  select balance into bal from wallets where user_id=p_child for update;
  if bal < p_amount then raise exception 'not enough cones'; end if;

  if a.leader_id is not null then    -- перебили: прошлому лидеру деньги сразу назад
    update wallets set balance=balance+a.current_bid, total_spent=greatest(0,total_spent-a.current_bid)
      where user_id=a.leader_id;
  end if;
  update wallets set balance=balance-p_amount, total_spent=total_spent+p_amount where user_id=p_child;
  update card_auctions set current_bid=p_amount, leader_id=p_child where id=p_auction;
  return jsonb_build_object('ok', true, 'bid', p_amount, 'next', greatest(p_amount+1, p_amount + p_amount/10));
end $$;

-- Закрытие по дедлайну: карта победителю, шишки продавцу за вычетом комиссии.
-- Без ставок — карта возвращается продавцу. Идемпотентно: работает только со status='live'.
create or replace function close_card_auction(p_auction uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a card_auctions; fee int; net int;
begin
  select * into a from card_auctions where id=p_auction for update;
  if not found or a.status <> 'live' then return jsonb_build_object('ok', false); end if;

  if a.leader_id is null then        -- никто не поставил — карта домой
    insert into user_cards(user_id,type_id,grade,qty) values (a.seller_id,a.type_id,a.grade,1)
      on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
    update card_auctions set status='cancelled' where id=p_auction;
    return jsonb_build_object('ok', true, 'sold', false);
  end if;

  fee := card_fee(a.current_bid); net := a.current_bid - fee;
  update wallets set balance=balance+net, total_earned=total_earned+net where user_id=a.seller_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (a.circle_id, a.leader_id, a.seller_id, net, 'transfer', 'Аукцион: продажа карты');
  if fee > 0 then
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (a.circle_id, a.leader_id, null, fee, 'fee', 'Комиссия аукциона');
    update bank_account set treasury = treasury + fee where id='main';
  end if;
  insert into user_cards(user_id,type_id,grade,qty) values (a.leader_id,a.type_id,a.grade,1)
    on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
  update card_auctions set status='sold' where id=p_auction;
  perform check_card_rewards(a.leader_id);
  perform check_achievements(a.leader_id);
  return jsonb_build_object('ok', true, 'sold', true, 'price', a.current_bid);
end $$;

-- Золотую карту обычным лотом больше не выставить — только через аукцион
create or replace function list_card(p_child uuid, p_type uuid, p_grade int, p_price int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have int; c_id uuid; base int; lid uuid;
begin
  perform assert_market(p_child);
  perform assert_tradable(p_type);
  if p_grade >= 6 then raise exception 'gold goes to auction'; end if;
  select qty into have from user_cards where user_id=p_child and type_id=p_type and grade=p_grade for update;
  if have is null or have < 1 then raise exception 'no card'; end if;
  base := (select price from rarities where grade=p_grade);
  if p_price < greatest(1, base/2) or p_price > base*3 then raise exception 'price out of range'; end if;
  select circle_id into c_id from users where id = p_child;

  update user_cards set qty = qty - 1 where user_id=p_child and type_id=p_type and grade=p_grade;
  delete from user_cards where user_id=p_child and type_id=p_type and grade=p_grade and qty <= 0;
  insert into card_listings(seller_id,circle_id,type_id,grade,price)
    values (p_child,c_id,p_type,p_grade,p_price) returning id into lid;
  return jsonb_build_object('ok',true,'listing',lid);
end $$;

-- ═══════════════════ Сезоны коллекции ═══════════════════
-- Полный альбом из 121 существа собирается ~12 лет — как бумажный Panini, финиша не видно.
-- Сезон даёт достижимую цель: паки выдают существ ТОЛЬКО активного сезона (~20 существ,
-- около 270 паков до полного сбора при гаранте новинки). Карты прошлых сезонов остаются
-- в альбоме и в обороте: их можно купить у друзей, выменять на обменной полке или получить в подарок.
create table if not exists card_seasons (
  code   text primary key,
  name   text not null,
  sort   int  not null default 0,
  status text not null default 'archived' check (status in ('active','archived','upcoming'))
);
alter table card_types add column if not exists season text references card_seasons(code);

insert into card_seasons(code,name,sort,status) values
  ('s1','Лесная опушка',1,'active'),
  ('s2','Тёмный бор',2,'upcoming'),
  ('s3','Речная пойма',3,'upcoming'),
  ('s4','Цветущий луг',4,'upcoming'),
  ('s5','Ночной лес',5,'upcoming'),
  ('s6','Осенний лес',6,'upcoming')
on conflict (code) do update set name=excluded.name, sort=excluded.sort;

-- раскладка существ по сезонам (каждое существо ровно в одном)
update card_types set season='s1' where code in ('burunduk','ezh','lisa','sova','zayac','belka','medved','volk','romashka','oduvanchik','zemlyanika','klever','kolokolchik','malina','korovka','babochka','pchela','muravey','kuznechik','strekoza');
update card_types set season='s2' where code in ('rys','barsuk','kunica','sobol','rosomaha','filin','el','sosna','paporotnik','belyy_grib','lisichka','muhomor','chernika','brusnika','zhuk','nosorog','shershen','mayskiy_zhuk','usach','zlatka');
update card_types set season='s3' where code in ('bobr','vydra','norka','ondatra','zimorodok','lyagushka','uzh','yashcherica','kuvshinka','kamysh','iva','ivan_chay','krapiva','lotos','vodomerka','plavunec','komar','medvedka','cherv','stonozhka');
update card_types set season='s4' where code in ('suslik','surok','mysh','horek','laska','gornostay','podsolnuh','mak','vasilek','tulpan','fialka','nezabudka','vyunok','kolos','shmel','osa','svetlyachok','bronzovka','zlatoglazka','motylek');
update card_types set season='s5' where code in ('letuchaya_mysh','krot','letyaga','enot','landysh','naperstyanka','kaktus','lopuh','chertopoloh','pauk','ulitka','bogomol','gusenica','cikada','sverchok','zhuzhelica','shelkopryad','klop_soldatik','skarabey','gerkules');
update card_types set season='s6' where code in ('los','gluhar','voron','soroka','snegir','sinica','solovey','olen','kaban','zubr','kosulya','kabarga','lan','dyatel','dub','bereza','klen','ryabina','shipovnik','vinograd','zveroboy');
-- Активный сезон (тот, из которого падают карты в паках)
create or replace function active_season() returns text
  language sql stable as $$ select code from card_seasons where status='active' order by sort limit 1 $$;

-- ═══════════════════ Гарант новинки (pity) ═══════════════════
-- Пити по РАНГАМ бессмысленно: Эпическая+ есть в 52% паков, Легендарная+ — в 25%, так что
-- «20 паков подряд без эпика» не случается никогда. Узкое место — не ранг, а конкретная карта:
-- шанс золотой карты нужного существа 0.0083%. Поэтому гарант считает НЕДОСТАЮЩИЕ карты:
--   каждый 10-й пак — карта, которой у ребёнка ещё нет (если пак не принёс новинку сам),
--   каждый 50-й пак — недостающая карта Эпическая и выше (закрывает верхний хвост альбома).
-- Ускоряет сбор сезона втрое (952 → 270 паков), эмиссию шишек почти не двигает.
alter table users add column if not exists packs_opened int not null default 0;

create or replace function open_pack(p_child uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare price int := 20; cards_n int := 7; w wallets; c_id uuid; i int; g int; t card_types;
        was_new boolean; result jsonb := '[]'::jsonb; v_season text;
        v_types uuid[] := '{}'; v_grades int[] := '{}'; n_packs int;
        pity_type uuid; pity_grade int; has_new boolean := false;
begin
  select * into w from wallets where user_id = p_child for update;
  if not found then raise exception 'wallet not found'; end if;
  if w.balance < price then raise exception 'not enough cones: have %, need %', w.balance, price; end if;
  select circle_id into c_id from users where id = p_child;
  v_season := active_season();   -- null = сезоны не заведены, значит доступен весь каталог

  update wallets set balance = balance - price, total_spent = total_spent + price
    where user_id = p_child;
  update users set packs_opened = packs_opened + 1 where id = p_child returning packs_opened into n_packs;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, p_child, null, price, 'purchase', 'Лесной пак');

  -- набираем пак из существ активного сезона
  for i in 1..cards_n loop
    select ct.id into pity_type from card_types ct
      where ct.pack_drop and (v_season is null or ct.season = v_season)
      order by random() limit 1;
    v_types := array_append(v_types, pity_type);
    v_grades := array_append(v_grades, roll_grade());
  end loop;

  -- принёс ли пак сам хоть одну карту, которой у ребёнка нет
  for i in 1..cards_n loop
    if not exists (select 1 from user_cards uc
        where uc.user_id=p_child and uc.type_id=v_types[i] and uc.grade=v_grades[i] and uc.qty>0)
      then has_new := true; end if;
  end loop;

  -- гарант: каждый 50-й пак — недостающая Эпическая+, каждый 10-й — любая недостающая
  pity_type := null;
  if n_packs % 50 = 0 then
    select ct.id, gs into pity_type, pity_grade
      from card_types ct cross join generate_series(4,6) gs
      where ct.pack_drop and (v_season is null or ct.season = v_season)
        and not exists (select 1 from user_cards uc
              where uc.user_id=p_child and uc.type_id=ct.id and uc.grade=gs and uc.qty>0)
      order by random() limit 1;
  elsif n_packs % 10 = 0 and not has_new then
    select ct.id, gs into pity_type, pity_grade
      from card_types ct cross join generate_series(1,6) gs
      where ct.pack_drop and (v_season is null or ct.season = v_season)
        and not exists (select 1 from user_cards uc
              where uc.user_id=p_child and uc.type_id=ct.id and uc.grade=gs and uc.qty>0)
      order by random() limit 1;
  end if;
  if pity_type is not null then
    v_types[cards_n] := pity_type; v_grades[cards_n] := pity_grade;
  end if;

  -- выдаём карты
  for i in 1..cards_n loop
    select * into t from card_types where id = v_types[i];
    g := v_grades[i];
    was_new := not exists (select 1 from user_cards where user_id=p_child and type_id=t.id and grade=g);
    insert into user_cards(user_id, type_id, grade, qty) values (p_child, t.id, g, 1)
      on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;
    result := result || jsonb_build_object('code',t.code,'name',t.name,'category',t.category,
      'grade',g,'is_new',was_new);
  end loop;

  perform check_achievements(p_child);
  return result;
end $$;

-- ═══════════════════ Управление сезоном (ведущий) ═══════════════════
-- Дедлайн сезона: если задан и прошёл — сервер переключит сезон сам (свип), но ведущий может
-- сделать это в любой момент вручную. Незакрытый сезон ничего не сжигает: его карты остаются
-- в альбоме, а награду за него по-прежнему можно получить через рынок, обмен и подарки.
alter table card_seasons add column if not exists ends_at timestamptz;

-- Переключить сезон: активный уходит в архив, следующий по порядку становится активным.
-- Идемпотентно и безопасно: если следующего нет, активный остаётся (коллекция не «кончается»).
create or replace function switch_season(p_next text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur card_seasons; nxt card_seasons;
begin
  select * into cur from card_seasons where status='active' order by sort limit 1;
  if p_next is not null then
    select * into nxt from card_seasons where code = p_next;
  else
    select * into nxt from card_seasons
      where status <> 'archived' and (cur is null or sort > cur.sort)
      order by sort limit 1;
  end if;
  if nxt is null or (cur is not null and nxt.code = cur.code) then
    return jsonb_build_object('ok', false, 'reason', 'нет следующего сезона');
  end if;

  if cur.code is not null then update card_seasons set status='archived' where code=cur.code; end if;
  update card_seasons set status='active' where code=nxt.code;
  return jsonb_build_object('ok', true, 'closed', cur.name, 'opened', nxt.name, 'code', nxt.code);
end $$;

-- Сводка по сезону для кабинета ведущего: кто сколько собрал
create or replace function season_progress(p_circle uuid)
returns table(child text, done int, total int) language sql stable security definer set search_path = public as $$
  select u.name,
    (select count(*)::int from card_types ct
      where ct.season = active_season()
        and (select count(distinct uc.grade) from user_cards uc
             where uc.user_id=u.id and uc.type_id=ct.id and uc.qty>0) = 6),
    (select count(*)::int from card_types where season = active_season())
  from users u where u.circle_id = p_circle and u.role='child' order by u.created_at
$$;

-- Оповестить детей круга о смене сезона (сообщение «шёпот леса» — без свободного текста от игроков)
create or replace function announce_season(p_circle uuid, p_text text)
returns void language sql security definer set search_path = public as $$
  insert into messages(circle_id, from_user, to_user, type, content, is_whisper)
  select p_circle, null, u.id, 'emoji', p_text, true
  from users u where u.circle_id = p_circle and u.role = 'child'
$$;

-- ═══════════════════ Оповещения о событиях коллекции ═══════════════════
-- Раньше сделки и торги проходили молча: карту купили или тебя перебили — узнаёшь, только
-- заглянув в раздел. Теперь важные события падают ребёнку в почту «шёпотом леса».
create or replace function notify_child(p_to uuid, p_text text)
returns void language sql security definer set search_path = public as $$
  insert into messages(circle_id, from_user, to_user, type, content, is_whisper)
  select circle_id, null, p_to, 'emoji', p_text, true from users where id = p_to
$$;

-- Ставка: прошлому лидеру сообщаем, что его перебили (шишки уже вернулись)
create or replace function bid_card_auction(p_child uuid, p_auction uuid, p_amount int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a card_auctions; need int; bal int; who text;
begin
  perform assert_market(p_child);
  select * into a from card_auctions where id=p_auction for update;
  if not found or a.status <> 'live' or now() >= a.ends_at then raise exception 'auction closed'; end if;
  if a.seller_id = p_child then raise exception 'own auction'; end if;
  if (select circle_id from users where id=p_child) is distinct from a.circle_id then raise exception 'other circle'; end if;
  if a.leader_id = p_child then raise exception 'already leading'; end if;

  need := case when a.current_bid is null then a.start_price
               else greatest(a.current_bid + 1, a.current_bid + a.current_bid/10) end;
  if p_amount < need then raise exception 'bid too low: need %', need; end if;
  select balance into bal from wallets where user_id=p_child for update;
  if bal < p_amount then raise exception 'not enough cones'; end if;

  if a.leader_id is not null then
    update wallets set balance=balance+a.current_bid, total_spent=greatest(0,total_spent-a.current_bid)
      where user_id=a.leader_id;
    perform notify_child(a.leader_id, 'Твою ставку перебили — шишки вернулись в кошелёк 🔨');
  end if;
  update wallets set balance=balance-p_amount, total_spent=total_spent+p_amount where user_id=p_child;
  update card_auctions set current_bid=p_amount, leader_id=p_child where id=p_auction;

  select name into who from users where id=p_child;
  perform notify_child(a.seller_id, 'Новая ставка на твоём аукционе: ' || p_amount || ' 🌰 от ' || who);
  return jsonb_build_object('ok', true, 'bid', p_amount, 'next', greatest(p_amount+1, p_amount + p_amount/10));
end $$;

-- Закрытие торгов: победитель и продавец узнают сразу
create or replace function close_card_auction(p_auction uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a card_auctions; fee int; net int; card_name text;
begin
  select * into a from card_auctions where id=p_auction for update;
  if not found or a.status <> 'live' then return jsonb_build_object('ok', false); end if;
  select name into card_name from card_types where id = a.type_id;

  if a.leader_id is null then
    insert into user_cards(user_id,type_id,grade,qty) values (a.seller_id,a.type_id,a.grade,1)
      on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
    update card_auctions set status='cancelled' where id=p_auction;
    perform notify_child(a.seller_id, 'Торги закончились без ставок — карта «' || card_name || '» вернулась к тебе');
    return jsonb_build_object('ok', true, 'sold', false);
  end if;

  fee := card_fee(a.current_bid); net := a.current_bid - fee;
  update wallets set balance=balance+net, total_earned=total_earned+net where user_id=a.seller_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (a.circle_id, a.leader_id, a.seller_id, net, 'transfer', 'Аукцион: продажа карты');
  if fee > 0 then
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (a.circle_id, a.leader_id, null, fee, 'fee', 'Комиссия аукциона');
    update bank_account set treasury = treasury + fee where id='main';
  end if;
  insert into user_cards(user_id,type_id,grade,qty) values (a.leader_id,a.type_id,a.grade,1)
    on conflict (user_id,type_id,grade) do update set qty = user_cards.qty + 1;
  update card_auctions set status='sold' where id=p_auction;

  perform notify_child(a.leader_id, 'Ты выиграл торги! Карта «' || card_name || '» твоя 👑');
  perform notify_child(a.seller_id, 'Карта «' || card_name || '» ушла с молотка за ' || a.current_bid || ' 🌰 (тебе ' || net || ')');
  perform check_card_rewards(a.leader_id);
  perform check_achievements(a.leader_id);
  return jsonb_build_object('ok', true, 'sold', true, 'price', a.current_bid);
end $$;

-- ═══════════════════ Родительский тумблер рынка ═══════════════════
-- Возраст детей в одном круге разный: кому-то торговля полезна, кому-то рано. Ведущий закрывает
-- рынок конкретному ребёнку — паки, альбом, слияния, обменная полка и подарки продолжают работать,
-- недоступны только сделки за шишки (лоты, заявки, аукцион).
alter table users add column if not exists market_allowed boolean not null default true;

create or replace function assert_market(p_child uuid) returns void
language plpgsql stable as $$
begin
  if not coalesce((select market_allowed from users where id = p_child), true)
    then raise exception 'market disabled'; end if;
end $$;

-- ═══════════════════ Спец-выпуски и вручение карт ведущим ═══════════════════
-- Единственная механика, где редкая карта достаётся не за удачу, а за дело: ведущий вручает
-- карту за выполненное задание или событие (день рождения леса, победа в семейном квесте).
-- Спец-карты помечаются pack_drop=false — они НИКОГДА не падают из паков, только из рук ведущего.
alter table card_types add column if not exists pack_drop boolean not null default true;

create or replace function grant_card(p_child uuid, p_type uuid, p_grade int, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t card_types; nm text;
begin
  select * into t from card_types where id = p_type;
  if t is null then raise exception 'no such card'; end if;
  if p_grade < 1 or p_grade > 6 then raise exception 'bad grade'; end if;

  insert into user_cards(user_id, type_id, grade, qty) values (p_child, p_type, p_grade, 1)
    on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1;
  select name into nm from rarities where grade = p_grade;
  perform notify_child(p_child, 'Ведущий вручил тебе карту: ' || t.name || ' (' || nm || ')'
    || coalesce(' — ' || p_reason, '') || ' 🎖');
  perform check_card_rewards(p_child);
  perform check_achievements(p_child);
  return jsonb_build_object('ok', true, 'code', t.code, 'name', t.name, 'grade', p_grade);
end $$;

-- ═══════════════════ Метрики здоровья карточной экономики ═══════════════════
-- Три цифры, по которым видно, что фича не сломалась: сколько шишек карты вернули детям,
-- сколько забрали, сколько паков открыто. Нетто должно быть отрицательным — карты сток, а не станок.
create or replace function card_metrics(p_circle uuid, p_days int default 7)
returns jsonb language sql stable security definer set search_path = public as $$
  with tx as (
    select t.* from transactions t
    where t.circle_id = p_circle and t.created_at >= now() - make_interval(days => p_days)
  )
  select jsonb_build_object(
    'days', p_days,
    'packs', (select count(*)::int from tx where type='purchase' and message='Лесной пак'),
    'spent', (select coalesce(sum(amount),0)::int from tx where type='purchase' and message='Лесной пак'),
    'earned', (select coalesce(sum(amount),0)::int from tx
                where (type='payout' and message='Продажа карты Банку')
                   or (type='reward' and (message like 'Собрано существо%' or message like 'Сезон собран%'
                       or message like 'Собран альбом%' or message like 'ВСЯ Лесная коллекция%'))),
    'fees', (select coalesce(sum(amount),0)::int from tx where type='fee' and message like 'Комиссия%'),
    'players', (select count(distinct u.id)::int from users u
                where u.circle_id = p_circle and u.role='child' and u.packs_opened > 0),
    'children', (select count(*)::int from users where circle_id = p_circle and role='child')
  )
$$;

-- ═══════════════════ Спец-выпуски как контент ═══════════════════
-- Событийные карты: Новый год, день рождения леса, победа в аукционе и т.д. У них своя категория,
-- нет сезона (в паки не попадают даже теоретически) и ровно один облик — Золотой.
-- Их не «собирают», их получают за дело, поэтому они исключены из прогресса и из наград за сборы.
alter table card_types drop constraint if exists card_types_category_check;
alter table card_types add constraint card_types_category_check
  check (category in ('zver','rastenie','nasekomoe','special'));

insert into card_types(code, name, category, sort, season, pack_drop) values
  ('special_ng_shishka','Новогодняя Шишка','special',900,null,false),
  ('special_den_lesa','Именинник Леса','special',901,null,false),
  ('special_master_torga','Мастер Торга','special',902,null,false),
  ('special_pervaya_shishka','Хранитель Первой Шишки','special',903,null,false),
  ('special_solncevorot','Солнечный Светлячок','special',904,null,false),
  ('special_urozhay','Урожайный Барсук','special',905,null,false),
  ('special_podsnezhnik','Первый Подснежник','special',906,null,false),
  ('special_kubok_lesa','Кубок Леса','special',907,null,false)
on conflict (code) do update set name=excluded.name, category=excluded.category,
  sort=excluded.sort, season=excluded.season, pack_drop=excluded.pack_drop;

-- Повод, за который вручается карта — его видит ведущий в списке и ребёнок в письме
alter table card_types add column if not exists occasion text;
update card_types set occasion = v.occasion from (values
  ('special_ng_shishka','Новый год'),
  ('special_den_lesa','День рождения леса'),
  ('special_master_torga','Победа в аукционе'),
  ('special_pervaya_shishka','Первое выполненное задание'),
  ('special_solncevorot','Летнее солнцестояние'),
  ('special_urozhay','Осенний праздник урожая'),
  ('special_podsnezhnik','Первый день весны'),
  ('special_kubok_lesa','Победа в семейном квесте')
) as v(code, occasion) where card_types.code = v.code;

insert into card_lore(category, grade, title, lore) values
  ('special',6,'Особая карта','Её не выпадет из пака ни за какие шишки — такую вручают за настоящее дело.')
on conflict (category, grade) do update set title=excluded.title, lore=excluded.lore;

-- Особые карты не торгуются: их вручают за дело, ими дорожат. Подарить другу и сделать
-- питомцем можно — это жест, а не сделка. Банк их тоже не выкупает.
create or replace function assert_tradable(p_type uuid) returns void
language plpgsql stable as $$
begin
  if (select category from card_types where id = p_type) = 'special'
    then raise exception 'special card is not tradable'; end if;
end $$;

-- ═══════════════════ Волна 24.07.2026: 24 существа финального арт-метода ═══════════════════
-- Арт: cards/beings_probe5.json (5 переделанных), beings_new5.json, beings_wave2.json, beings_wave3.json.
-- Метод: docs/cards_art_method.md (цвет по грейдам + развитие персонажа + свой мир).
insert into card_types(code,name,category,sort) values
  ('vyhuhol','Выхухоль','zver',118),('soyka','Сойка','zver',119),('homyak','Хомяк','zver',120),
  ('kozodoy','Козодой','zver',121),('yorsh','Ёрш','zver',122),('shchuka','Щука','zver',123),
  ('udod','Удод','zver',124),('ivolga','Иволга','zver',125),('tushkanchik','Тушканчик','zver',126),
  ('kvaksha','Квакша','zver',127),('som','Сом','zver',128),('drozd','Дрозд','zver',129),
  ('sviristel','Свиристель','zver',130),('klyost','Клёст','zver',131),('kolonok','Колонок','zver',132),
  ('popolzen','Поползень','zver',133),('vyun','Вьюн','zver',134),('nalim','Налим','zver',135),
  ('strizh','Стриж','zver',136),('okun','Окунь','zver',137),('salamandra','Саламандра','zver',138),
  ('kukushka','Кукушка','zver',139),('karas','Карась','zver',140),
  ('rosyanka','Росянка','rastenie',215)
on conflict (code) do update set name=excluded.name,category=excluded.category,sort=excluded.sort;

-- по 4 новых в каждый сезон (активный s1 сразу получает свежие карты)
update card_types set season='s1' where code in ('vyhuhol','soyka','homyak','kozodoy');
update card_types set season='s2' where code in ('yorsh','shchuka','udod','ivolga');
update card_types set season='s3' where code in ('tushkanchik','kvaksha','som','drozd');
update card_types set season='s4' where code in ('sviristel','klyost','kolonok','popolzen');
update card_types set season='s5' where code in ('vyun','nalim','strizh','okun');
update card_types set season='s6' where code in ('salamandra','rosyanka','kukushka','karas');
