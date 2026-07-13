-- АВТОГЕНЕРАЦИЯ (gen_seed.mjs). Демо-данные Шишка Банк в прод-схему Supabase.
create table if not exists child_logins (code text primary key, child_id uuid not null references users(id) on delete cascade);

begin;
-- ── справочники (глобальные) ──
delete from user_achievements; delete from achievements;
insert into achievements (code,title,description,metric,threshold,tier,reward) values
  ('work_1','Первый шаг','Первый шаг','tasks_done',1,1,0),
  ('work_2','Помощник','Помощник','tasks_done',5,2,0),
  ('work_3','Работяга','Работяга','tasks_done',10,3,0),
  ('work_4','Умелец','Умелец','tasks_done',25,3,10),
  ('work_5','Мастер дел','Мастер дел','tasks_done',50,3,15),
  ('work_6','Герой труда','Герой труда','tasks_done',100,3,25),
  ('work_7','Легенда труда','Легенда труда','tasks_done',250,3,50),
  ('earn_1','Первые шишки','Первые шишки','cones_earned',50,1,0),
  ('earn_2','Запасливый','Запасливый','cones_earned',100,2,0),
  ('earn_3','Копилка','Копилка','cones_earned',250,3,10),
  ('earn_4','Богатей леса','Богатей леса','cones_earned',500,3,15),
  ('earn_5','Шишкомагнат','Шишкомагнат','cones_earned',1000,3,25),
  ('earn_6','Шишкобарон','Шишкобарон','cones_earned',2500,3,50),
  ('streak_1','Росток привычки','Росток привычки','longest_streak',3,1,0),
  ('streak_2','Неделя в лесу','Неделя в лесу','longest_streak',7,2,5),
  ('streak_3','Две недели','Две недели','longest_streak',14,3,10),
  ('streak_4','Хозяин леса','Хозяин леса','longest_streak',30,3,20),
  ('streak_5','Верный лесу','Верный лесу','longest_streak',60,3,35),
  ('streak_6','Легенда леса','Легенда леса','longest_streak',100,3,50),
  ('gift_1','Добряк','Добряк','gifts_sum',10,1,0),
  ('gift_2','Меценат','Меценат','gifts_sum',50,2,5),
  ('gift_3','Благодетель','Благодетель','gifts_sum',100,3,10),
  ('gift_4','Великий Меценат','Великий Меценат','gifts_sum',250,3,20),
  ('gift_5','Душа леса','Душа леса','gifts_sum',500,3,40),
  ('give_1','Даритель','Даритель','transfers_count',1,1,0),
  ('give_2','Щедрая рука','Щедрая рука','transfers_count',5,2,0),
  ('give_3','Друголюб','Друголюб','transfers_count',15,3,10),
  ('give_4','Верный друг','Верный друг','transfers_count',30,3,15),
  ('give_5','Ангел леса','Ангел леса','transfers_count',60,3,30),
  ('dep_1','Осторожный','Осторожный','deposits_count',1,1,0),
  ('dep_2','Копитель','Копитель','deposits_count',3,2,5),
  ('dep_3','Мудрый вклад','Мудрый вклад','deposits_count',7,3,15),
  ('dep_4','Дальновидный','Дальновидный','deposits_count',15,3,30),
  ('depc_1','Терпеливый','Терпеливый','deposits_closed',1,1,0),
  ('depc_2','Хранитель','Хранитель','deposits_closed',3,2,10),
  ('depc_3','Страж Дупла','Страж Дупла','deposits_closed',10,3,25),
  ('horo_1','Любопытный','Любопытный','horoscopes_read',1,1,0),
  ('horo_2','Звездочёт','Звездочёт','horoscopes_read',7,2,5),
  ('horo_3','Астролог','Астролог','horoscopes_read',30,3,15),
  ('horo_4','Оракул леса','Оракул леса','horoscopes_read',100,3,40),
  ('skin_1','Модник','Модник','skins_owned',1,1,0),
  ('skin_2','Стиляга','Стиляга','skins_owned',3,2,10),
  ('skin_3','Коллекционер','Коллекционер','skins_owned',5,3,30),
  ('pot_1','Друг семьи','Друг семьи','pot_contributions',1,1,0),
  ('pot_2','Командный игрок','Командный игрок','pot_contributions',5,2,10),
  ('pot_3','Опора семьи','Опора семьи','pot_contributions',10,3,25),
  ('buy_1','Первая покупка','Первая покупка','purchases_count',1,1,0),
  ('buy_2','Знаток наград','Знаток наград','purchases_count',5,2,5),
  ('buy_3','Ценитель','Ценитель','purchases_count',15,3,15),
  ('buy_4','Гурман впечатлений','Гурман впечатлений','purchases_count',30,3,30),
  ('dq_1','Исполнитель','Исполнитель','daily_quests_done',1,1,0),
  ('dq_2','Прилежный','Прилежный','daily_quests_done',7,2,5),
  ('dq_3','Квестомастер','Квестомастер','daily_quests_done',30,3,20),
  ('dq_4','Летописец леса','Летописец леса','daily_quests_done',100,3,45),
  ('hon_1','Честный','Честный','rep_honesty',5,1,0),
  ('hon_2','Правдивый','Правдивый','rep_honesty',20,2,10),
  ('hon_3','Кристально чистый','Кристально чистый','rep_honesty',50,3,25),
  ('gen_1','Щедрый','Щедрый','rep_generosity',5,1,0),
  ('gen_2','Великодушный','Великодушный','rep_generosity',20,2,10),
  ('gen_3','Золотое сердце','Золотое сердце','rep_generosity',50,3,25),
  ('rel_1','Надёжный','Надёжный','rep_reliability',5,1,0),
  ('rel_2','Крепкая опора','Крепкая опора','rep_reliability',20,2,10),
  ('rel_3','Скала леса','Скала леса','rep_reliability',50,3,25),
  ('wis_1','Смышлёный','Смышлёный','rep_wisdom',5,1,0),
  ('wis_2','Мудрец','Мудрец','rep_wisdom',20,2,10),
  ('wis_3','Лесной шалфей','Лесной шалфей','rep_wisdom',50,3,25),
  ('rain_1','Под дождём','Под дождём','cone_rain_caught',1,1,0),
  ('rain_2','Ловец шишек','Ловец шишек','cone_rain_caught',10,2,10),
  ('rain_3','Дождевик','Дождевик','cone_rain_caught',30,3,25),
  ('freeze_1','Запасливый дождик','Запасливый дождик','freezes_bought',1,1,0),
  ('freeze_2','Метеоролог','Метеоролог','freezes_bought',5,2,15),
  ('int_1','Процентщик','Процентщик','interest_earned',10,1,0),
  ('int_2','Рантье','Рантье','interest_earned',50,2,15),
  ('int_3','Финансист леса','Финансист леса','interest_earned',200,3,35),
  ('bal_1','Кошелёк звенит','Кошелёк звенит','current_balance',50,1,0),
  ('bal_2','Толстый кошель','Толстый кошель','current_balance',200,2,10),
  ('bal_3','Сундук шишек','Сундук шишек','current_balance',500,3,25),
  ('photo_1','Фотоотчёт','Фотоотчёт','tasks_photo',1,1,0),
  ('photo_2','Лесной репортёр','Лесной репортёр','tasks_photo',10,2,15),
  ('tree_1','Саженец растёт','Саженец растёт','tree_level',2,1,0),
  ('tree_2','Деревце','Деревце','tree_level',3,2,5),
  ('tree_3','Крепкое дерево','Крепкое дерево','tree_level',4,3,15),
  ('tree_4','Могучее дерево','Могучее дерево','tree_level',5,3,40),
  ('recv_1','Обласканный','Обласканный','transfers_received',1,1,0),
  ('recv_2','Любимчик','Любимчик','transfers_received',10,2,10),
  ('recv_3','Звезда леса','Звезда леса','transfers_received',30,3,25),
  ('recvsum_1','Одаряемый','Одаряемый','gifts_received_sum',50,1,5),
  ('recvsum_2','Купается в шишках','Купается в шишках','gifts_received_sum',200,2,20),
  ('rep_1','Уважаемый','Уважаемый','total_reputation',20,1,5),
  ('rep_2','Почтенный','Почтенный','total_reputation',50,2,15),
  ('rep_3','Славный','Славный','total_reputation',100,3,30),
  ('rep_4','Гордость леса','Гордость леса','total_reputation',200,3,50),
  ('rep_5','Легенда паспорта','Легенда паспорта','total_reputation',350,3,75),
  ('spend_1','Тратишка','Тратишка','cones_spent',50,1,0),
  ('spend_2','Ценитель трат','Ценитель трат','cones_spent',200,2,10),
  ('spend_3','Король трат','Король трат','cones_spent',500,3,25),
  ('spend_4','Император трат','Император трат','cones_spent',1000,3,50),
  ('cat_1','Разносторонний','Разносторонний','categories_done',3,1,5),
  ('cat_2','Мастер на все руки','Мастер на все руки','categories_done',5,2,20),
  ('cat_3','Универсал леса','Универсал леса','categories_done',7,3,35),
  ('sell_1','Первая продажа','Первая продажа','sales_count',1,1,0),
  ('sell_2','Лавочник','Лавочник','sales_count',5,2,10),
  ('sell_3','Купец','Купец','sales_count',15,3,25),
  ('sell_4','Акула Бизнеса','Акула Бизнеса','sales_count',30,3,50),
  ('rev_1','Оборотистый','Оборотистый','sales_sum',50,1,5),
  ('rev_2','Богатый купец','Богатый купец','sales_sum',200,2,20),
  ('shopper_1','Первый покупатель','Первый покупатель','shop_buys',1,1,0),
  ('shopper_2','Завсегдатай','Завсегдатай','shop_buys',10,2,15),
  ('mail_1','Почтальон','Почтальон','messages_sent',1,1,0),
  ('mail_2','Лесной вестник','Лесной вестник','messages_sent',10,2,10),
  ('mail_3','Голубь мира','Голубь мира','messages_sent',30,3,25);

delete from task_templates;
insert into task_templates (title,reward,category,is_daily,needs_photo) values
  ('Заправить кровать',5,'дом',true,false),
  ('Почистить зубы вечером',4,'здоровье',true,false),
  ('Покормить питомца',6,'забота',true,false),
  ('Накрыть на стол',6,'дом',false,false),
  ('Вынести мусор',8,'дом',false,false),
  ('Полить цветы',8,'дом',false,false),
  ('Зарядка утром',8,'здоровье',false,false),
  ('Собрать портфель с вечера',8,'самостоятельность',false,false),
  ('Разложить вещи по местам',10,'дом',false,false),
  ('Помочь маме с готовкой',10,'забота',false,false),
  ('Помыть посуду',12,'дом',false,false),
  ('Нарисовать рисунок',12,'развитие',false,true),
  ('Прогулка на улице 1 час',12,'здоровье',false,false),
  ('Погулять с собакой',14,'забота',false,false),
  ('Убрать комнату',15,'дом',false,true),
  ('Пропылесосить',15,'дом',false,false),
  ('Поиграть с младшим',15,'забота',false,false),
  ('День без сладкого',15,'здоровье',false,false),
  ('Собрать шишки и листья в лесу',15,'приключение',false,true),
  ('Прибрать в шкафу',16,'дом',false,true),
  ('Порешать задачки',18,'развитие',false,false),
  ('Помочь с покупками в магазине',18,'самостоятельность',false,false),
  ('Доброе дело и рассказать о нём',20,'забота',false,false),
  ('Почитать книгу 20 минут',20,'развитие',false,false),
  ('Приготовить простой завтрак сам',20,'самостоятельность',false,true),
  ('Написать письмо бабушке',22,'развитие',false,false),
  ('Помочь бабушке или соседке',25,'забота',false,false),
  ('Сделать уроки без напоминаний',25,'развитие',false,false),
  ('Выучить стихотворение',30,'развитие',false,false),
  ('Убрать во дворе или в гараже',28,'дом',false,true),
  ('Полить огород',10,'дом',false,false),
  ('Помыть пол',14,'дом',false,false),
  ('Протереть пыль',10,'дом',false,false),
  ('Собрать игрушки',6,'дом',true,false),
  ('Полить комнатные растения',6,'дом',false,false),
  ('Разобрать рюкзак',6,'самостоятельность',false,false),
  ('Написать список покупок',8,'самостоятельность',false,false),
  ('Приготовить салат',18,'самостоятельность',false,true),
  ('Позаниматься спортом',10,'здоровье',false,false),
  ('Выпить воды за день',5,'здоровье',true,false),
  ('Лечь спать без капризов',6,'здоровье',true,false),
  ('Выучить таблицу умножения',30,'развитие',false,false),
  ('Прочитать главу книги',18,'развитие',false,false),
  ('Сделать поделку',15,'развитие',false,true),
  ('Порепетировать музыку',16,'развитие',false,false),
  ('Помочь папе в гараже',20,'дом',false,true),
  ('Убрать за питомцем',8,'забота',false,false),
  ('Помочь младшему с уроками',18,'забота',false,false),
  ('Поблагодарить трёх человек',10,'забота',false,false),
  ('Помочь накрыть праздничный стол',12,'забота',false,false);

delete from horoscope_texts;
insert into horoscope_texts (text) values
  ('Сегодня звёзды советуют сделать доброе дело — оно вернётся теплом.'),
  ('Хороший день, чтобы поделиться шишкой с другом.'),
  ('Лес шепчет: самое время отложить немного в Дупло.'),
  ('Сегодня удача любит трудолюбивых — выполни задание.'),
  ('Звёзды сулят радостную встречу.'),
  ('Маленький добрый поступок сделает этот день ярче.'),
  ('Сегодня твоё дерево растёт быстрее — не забудь его навестить.'),
  ('День загадок: может, раскроешь тайну анонимной шишки?'),
  ('Хороший день для новой идеи в твоей лавке.'),
  ('Звёзды советуют сказать спасибо тому, кто рядом.'),
  ('Сегодня хороший день, чтобы навести порядок в своей лавке.'),
  ('Звёзды советуют открыть новое Дупло.'),
  ('Сегодня удача любит смелых — попробуй новое задание.'),
  ('Лес шепчет: поделись улыбкой с тем, кто загрустил.'),
  ('Хороший день, чтобы поблагодарить родителей.'),
  ('Сегодня твои шишки особенно тёплые — потрать их с умом.'),
  ('Звёзды сулят приятный сюрприз.'),
  ('Сегодня стоит помочь тому, кто младше тебя.'),
  ('Лес советует больше гулять на свежем воздухе.'),
  ('Хороший день, чтобы начать копить на большую мечту.');

delete from shop_items where circle_id is null;
insert into shop_items (circle_id,type,title,price,rarity,season) values
  (null,'skin','Обычное дерево',1,'base',null),
  (null,'skin','Осеннее дерево',30,'seasonal','autumn'),
  (null,'skin','Зимнее дерево',30,'seasonal','winter'),
  (null,'skin','Золотое дерево',100,'rare',null),
  (null,'skin','Светящееся дерево',150,'rare',null),
  (null,'skin','Радужное дерево',300,'epic',null);

-- ── реальная семья друзей: 4 ребёнка-игрока (транзакционным блоком) ──
do $$
declare
  v_circle uuid; v_taya uuid; v_tim uuid; v_eva uuid; v_alex uuid;
  v_gld uuid; v_qst uuid;
begin
  delete from circles where invite_code = 'LESFRIEND';
  delete from auctions;   -- глобальные (без circle_id) — чистим явно
  insert into circles(name,invite_code,insurance_fund) values ('Лесные друзья','LESFRIEND',0) returning id into v_circle;
  insert into users(circle_id,role,name) values (v_circle,'parent','Ведущий');

  -- дети-игроки: старт 30 приветственных шишек, репутация/уровень с нуля (растут от действий)
  insert into users(circle_id,role,name,tree_type) values (v_circle,'child','Тая','pine')   returning id into v_taya;
  insert into wallets(user_id,balance,total_earned) values (v_taya,30,30);
  insert into users(circle_id,role,name,tree_type) values (v_circle,'child','Тим','cedar')  returning id into v_tim;
  insert into wallets(user_id,balance,total_earned) values (v_tim,30,30);
  insert into users(circle_id,role,name,tree_type) values (v_circle,'child','Ева','spruce') returning id into v_eva;
  insert into wallets(user_id,balance,total_earned) values (v_eva,30,30);
  insert into users(circle_id,role,name,tree_type) values (v_circle,'child','Александр','oak') returning id into v_alex;
  insert into wallets(user_id,balance,total_earned) values (v_alex,30,30);

  -- персональные коды входа
  insert into child_logins(code,child_id) values
    ('ТАЯ-01',v_taya),('ТИМ-02',v_tim),('ЕВА-03',v_eva),('АЛЕК-04',v_alex);

  -- базовый скин у всех
  insert into user_skins(user_id,skin_id) select id, (select id from shop_items where type='skin' and title='Обычное дерево')
    from users where circle_id=v_circle and role='child';

  -- магазин впечатлений (общий для круга)
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Мультик +1 час',30);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Телефон +30 минут',40);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Порулить музыкой в машине',25);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Мороженое или десерт',35);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Выбрать фильм на вечер',40);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Настольная игра всей семьёй',45);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Лечь спать на 30 мин позже',45);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Выбор ужина',50);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Завтрак в постель',55);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Игра с папой в приставку 1 ч',60);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','День без уборки',70);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Папа строит шалаш',80);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Пицца на ужин',90);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Новая книжка',100);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Маленькая игрушка',110);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Поход в кино',120);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Друг в гости с ночёвкой',130);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Поход в парк аттракционов',150);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Поездка в зоопарк',160);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','День «я главный» (мой план дня)',200);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Выбрать мультик всей семье',40);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Дополнительная сказка на ночь',20);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Порисовать с мамой',35);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Настольный вечер с друзьями',70);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Купить любимый снек',30);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Мороженое в кафе',90);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Подольше на площадке',40);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Выбрать наклейки',25);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Праздник «День рождения дерева»',100);
  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression','Мастер-класс или кружок',130);

  -- задания каждому ребёнку (весь каталог)
  insert into tasks(circle_id,child_id,title,reward,category,needs_photo)
    select v_circle, u.id, t.title, t.reward, coalesce(t.category,'home'), t.needs_photo
    from users u, task_templates t where u.circle_id=v_circle and u.role='child';

  -- семейные механики
  insert into pots(circle_id,title,goal,collected) values (v_circle,'Пицца-пати всей компанией',100,0);

  insert into auctions(title,prize_skin,min_bid,current_bid)
    select 'Золотое дерево',id,5,4 from shop_items where type='skin' and title='Золотое дерево' limit 1;

  insert into guilds(circle_id,name,created_by) values (v_circle,'Лесные мастера',v_taya) returning id into v_gld;
  insert into guild_members(guild_id,child_id,share) values (v_gld,v_taya,1),(v_gld,v_tim,1),(v_gld,v_eva,1),(v_gld,v_alex,1);

  insert into proposals(circle_id,type,title) values (v_circle,'pot_spend','Потратить котёл на общую пиццу?');
  insert into proposals(circle_id,type,title) values (v_circle,'custom','Устроить лесной пикник в выходные?');

  insert into quests(circle_id,code,title,reward_cones) values (v_circle,'golden_cone','Пропала Золотая Шишка',10) returning id into v_qst;
  insert into quest_steps(quest_id,step_order,kind,text,goal) values
    (v_qst,1,'narrative','Беда! Золотая Шишка исчезла из леса.',0),
    (v_qst,2,'collect','Соберите 30 шишек в фонд поисков.',30),
    (v_qst,3,'task','Обыщите поляны — 3 вылазки.',3),
    (v_qst,4,'finale','Золотая Шишка найдена! Награда всем.',0);
end $$;
commit;
