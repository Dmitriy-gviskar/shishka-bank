// Генерит db/seed.sql — прод-схема Supabase из catalog.json:
// справочники (achievements/task_templates/horoscope_texts/skins) + демо-семья (circle, дети, задания, лавки, котёл, аукцион, гильдия, квест, инициативы).
// Идемпотентно: пересоздаёт справочники и демо-семью (invite_code DEMO01).
// Запуск: node db/gen_seed.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const cat = JSON.parse(readFileSync(new URL('../content/catalog.json', import.meta.url)));
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const b = (v) => (v ? 'true' : 'false');

let o = `-- АВТОГЕНЕРАЦИЯ (gen_seed.mjs). Демо-данные Шишка Банк в прод-схему Supabase.
create table if not exists child_logins (code text primary key, child_id uuid not null references users(id) on delete cascade);

begin;
-- ── справочники (глобальные) ──
delete from user_achievements; delete from achievements;
insert into achievements (code,title,description,metric,threshold,tier,reward) values
${cat.achievements.map((a) => { const clean = (a.desc || a.title).replace(/\s*—\s*достигни.*$/i, '').replace(/\s*\([a-z_]+\)\s*$/i, '').trim() || a.title;
  return `  (${q(a.code)},${q(a.title)},${q(clean)},${q(a.metric)},${a.threshold},${a.tier || 1},${a.reward || 0})`; }).join(',\n')};

delete from task_templates;
insert into task_templates (title,reward,category,is_daily,needs_photo) values
${cat.tasks.map((t) => `  (${q(t.title)},${t.reward},${q(t.category || 'home')},${b(t.daily)},${b(t.photo)})`).join(',\n')};

delete from horoscope_texts;
insert into horoscope_texts (text) values
${cat.horoscopes.map((h) => `  (${q(h)})`).join(',\n')};

delete from shop_items where circle_id is null;
insert into shop_items (circle_id,type,title,price,rarity,season) values
${cat.skins.map((s) => `  (null,'skin',${q(s.title)},${s.price},${q(s.rarity || 'base')},${s.season ? q(s.season) : 'null'})`).join(',\n')};

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
${cat.gifts.map((g) => `  insert into shop_items(circle_id,type,title,price) values (v_circle,'impression',${q(g.title)},${g.price});`).join('\n')}

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
`;
writeFileSync(new URL('./seed.sql', import.meta.url), o);
console.log(`seed.sql: ${o.length} байт (${cat.gifts.length} подарков, ${cat.tasks.length} заданий, ${cat.skins.length} скинов, ${cat.achievements.length} достижений)`);
