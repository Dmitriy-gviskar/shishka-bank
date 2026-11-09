// Локальный сервер Шишка Банк: статика клиента + REST-API на SQLite (модель из local_check).
// Запуск: node --experimental-sqlite client/server.mjs  → http://localhost:3777
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(DIR, '../content/catalog.json'), 'utf8'));

// ── БД в памяти: минимум под экраны Фазы 1 ───────────────────────────
const db = new DatabaseSync(':memory:');
db.exec(`
  create table users(id text primary key, name text, role text, tree_level integer default 1,
    avatar text, reputation text default '{}');
  create table wallets(user_id text primary key, balance integer default 0,
    total_earned integer default 0, total_spent integer default 0);
  create table tasks(id text primary key, child_id text, title text, reward integer,
    category text, needs_photo integer default 0, status text default 'open');
  create table shop_items(id text primary key, type text, title text, price integer);
  create table shops(id text primary key, owner text, avatar text, name text, is_heir integer default 0);
  create table lots(id text primary key, shop_id text, title text, price integer);
  create table badges(user_id text, code text, title text);
  create table safes(id text primary key, child_id text, amount integer, rate integer,
    unlock_at integer, status text default 'locked');
  create table pots(id text primary key, title text, goal integer, collected integer default 0,
    status text default 'active');
  create table transactions(id text primary key, from_user text, to_user text,
    amount integer, type text, message text, at integer);
`);
// ── ДЕТИ-ПРОФИЛИ семьи (родитель добавил каждого, у каждого свой код входа) ──
function seedChild(name, lvl, avatar, balance, earned, rep, code) {
  const id = randomUUID();
  db.prepare('insert into users(id,name,role,tree_level,avatar,reputation) values(?,?,?,?,?,?)')
    .run(id, name, 'child', lvl, avatar, JSON.stringify(rep));
  db.prepare('insert into wallets(user_id,balance,total_earned) values(?,?,?)').run(id, balance, earned);
  for (const t of catalog.tasks)
    db.prepare('insert into tasks(id,child_id,title,reward,category,needs_photo) values(?,?,?,?,?,?)')
      .run(randomUUID(), id, t.title, t.reward, t.category, t.photo ? 1 : 0);
  return { id, name, code };
}
const CHILDREN = [
  seedChild('Росточек', 5, 'tree.png', 120, 260, { honesty: 82, generosity: 64, reliability: 71, wisdom: 55 }, 'РОСТ-01'),
  seedChild('Ёжик', 3, 'tree3.png', 45, 90, { honesty: 40, generosity: 55, reliability: 30, wisdom: 25 }, 'ЁЖИК-02'),
];
let ACTIVE = CHILDREN[0].id;                 // текущий вошедший ребёнок (по коду)
// бейджи первому ребёнку (демо)
[['guardian', 'Хранитель'], ['philanthropist', 'Меценат'], ['saver', 'Спаситель']]
  .forEach(([c, t]) => db.prepare('insert into badges values(?,?,?)').run(CHILDREN[0].id, c, t));
// друзья-получатели (не профили — просто адресаты подарков)
const FRIENDS = [['Ёлочка', 'friend1.png'], ['Кедрик', 'friend2.png'], ['Сосенка', 'friend3.png']];
const fids = FRIENDS.map(([n, av]) => { const id = randomUUID();
  db.prepare('insert into users(id,name,role,avatar) values(?,?,?,?)').run(id, n, 'friend', av);
  db.prepare('insert into wallets(user_id,balance) values(?,0)').run(id); return id; });
[[0, 'Браслеты Ёлочки', 'Браслет дружбы', 15, 0],
 [1, 'Фокусы Кедрика', 'Весёлый фокус', 10, 1],
 [2, 'Рисунки Сосенки', 'Рисунок на заказ', 20, 0]].forEach(([fi, sn, lt, pr, heir]) => {
  const sid = randomUUID();
  db.prepare('insert into shops values(?,?,?,?,?)').run(sid, fids[fi], FRIENDS[fi][1], sn, heir);
  db.prepare('insert into lots values(?,?,?,?)').run(randomUUID(), sid, lt, pr);
});
for (const g of catalog.gifts)
  db.prepare('insert into shop_items values(?,?,?,?)').run(randomUUID(), 'impression', g.title, g.price);

// демо-котёл семьи
db.prepare('insert into pots(id,title,goal,collected) values(?,?,?,?)')
  .run(randomUUID(), 'Пицца-пати всей семьёй', 100, 40);
// демо-Дупло готовое к забору
db.prepare('insert into safes(id,child_id,amount,rate,unlock_at) values(?,?,?,?,?)').run(randomUUID(), ACTIVE, 30, 10, Date.now()-1000);

let seq = 0; const HOROSCOPE = {};   // гороскоп кэшируется на КАЖДОГО ребёнка, не глобально
const tx = (from, to, amount, type, message) =>
  db.prepare('insert into transactions values(?,?,?,?,?,?,?)').run(randomUUID(), from, to, amount, type, message, ++seq);

// ── операции ─────────────────────────────────────────────────────────
const api = {
  'GET /api/state': () => {
    const u = db.prepare('select * from users where id=?').get(ACTIVE);
    const w = db.prepare('select * from wallets where user_id=?').get(ACTIVE);
    return { name: u.name, tree_level: u.tree_level, balance: w.balance,
             total_earned: w.total_earned, total_spent: w.total_spent, tree_asset: equippedAsset(), skin_on: !!equippedSkin() };
  },
  'GET /api/tasks': () =>
    db.prepare("select id,title,reward,needs_photo,status from tasks where child_id=? order by rowid").all(ACTIVE),
  'POST /api/task/done': (body) => {
    const t = db.prepare('select * from tasks where id=? and child_id=?').get(body.id, ACTIVE);
    if (!t || t.status === 'done' || t.status === 'submitted') throw { code: 400, msg: 'задание недоступно' };
    if (t.needs_photo) {   // фото-задание уходит на проверку родителю, награда после подтверждения
      db.prepare("update tasks set status='submitted' where id=?").run(t.id);
      return { ok: true, submitted: true, balance: db.prepare('select balance from wallets where user_id=?').get(ACTIVE).balance };
    }
    db.prepare("update tasks set status='done' where id=?").run(t.id);
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?')
      .run(t.reward, t.reward, ACTIVE);
    tx(null, ACTIVE, t.reward, 'reward', t.title);
    bumpRep(ACTIVE, 'reliability', 3); growTree(ACTIVE);
    return { ok: true, balance: db.prepare('select balance from wallets where user_id=?').get(ACTIVE).balance };
  },
  'GET /api/shop': () =>
    db.prepare("select id,title,price from shop_items where type='impression' order by price").all(),
  'POST /api/shop/buy': (body) => {
    const it = db.prepare('select * from shop_items where id=?').get(body.id);
    const w = db.prepare('select * from wallets where user_id=?').get(ACTIVE);
    if (!it) throw { code: 400, msg: 'нет такого приза' };
    if (w.balance < it.price) throw { code: 400, msg: 'не хватает шишек' };
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?')
      .run(it.price, it.price, ACTIVE);
    tx(ACTIVE, null, it.price, 'purchase', it.title);
    return { ok: true, balance: w.balance - it.price };
  },
  'GET /api/friends': () =>
    db.prepare("select id,name,avatar from users where role='friend' order by rowid").all(),
  'POST /api/transfer': (body) => {
    const to = db.prepare('select * from users where id=?').get(body.to);
    const amount = parseInt(body.amount, 10);
    const w = db.prepare('select * from wallets where user_id=?').get(ACTIVE);
    if (!to) throw { code: 400, msg: 'нет такого друга' };
    if (!(amount > 0)) throw { code: 400, msg: 'укажи сумму' };
    if (w.balance < amount) throw { code: 400, msg: 'не хватает шишек' };
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?').run(amount, amount, ACTIVE);
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(amount, amount, to.id);
    tx(ACTIVE, to.id, amount, 'transfer', 'Подарок другу');
    bumpRep(ACTIVE, 'generosity', 4);
    return { ok: true, balance: w.balance - amount };
  },
  'GET /api/shops': () => db.prepare('select * from shops order by rowid').all().map((s) => ({
    ...s, mine: s.owner === ACTIVE, lot: db.prepare('select * from lots where shop_id=? limit 1').get(s.id) })),
  'POST /api/lot/buy': (body) => {
    const l = db.prepare('select * from lots where id=?').get(body.id);
    const w = db.prepare('select * from wallets where user_id=?').get(ACTIVE);
    if (!l) throw { code: 400, msg: 'нет такого лота' };
    if (w.balance < l.price) throw { code: 400, msg: 'не хватает шишек' };
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?').run(l.price, l.price, ACTIVE);
    tx(ACTIVE, null, l.price, 'purchase', 'Лавка: ' + l.title);
    return { ok: true, balance: w.balance - l.price };
  },
  'GET /api/profile': () => {
    const u = db.prepare('select * from users where id=?').get(ACTIVE);
    return { name: u.name, tree_level: u.tree_level, avatar: u.avatar,
      reputation: JSON.parse(u.reputation || '{}'),
      badges: db.prepare('select code,title from badges where user_id=?').all(ACTIVE) };
  },
  'GET /api/achievements': () => {
    const w = db.prepare('select * from wallets where user_id=?').get(ACTIVE);
    const u = db.prepare('select * from users where id=?').get(ACTIVE);
    const rep = JSON.parse(u.reputation || '{}');
    const c = (sql) => db.prepare(sql).get(ACTIVE).c;
    const metric = (m) => ({
      tasks_done: () => c("select count(*) c from tasks where child_id=? and status='done'"),
      cones_earned: () => w.total_earned, cones_spent: () => w.total_spent,
      current_balance: () => w.balance, tree_level: () => u.tree_level,
      purchases_count: () => c("select count(*) c from transactions where from_user=? and type='purchase'"),
      transfers_count: () => c("select count(*) c from transactions where from_user=? and type='transfer'"),
      gifts_sum: () => c("select coalesce(sum(amount),0) c from transactions where from_user=? and type='transfer'"),
      categories_done: () => c("select count(distinct category) c from tasks where child_id=? and status='done'"),
      tasks_photo: () => c("select count(*) c from tasks where child_id=? and status='done' and needs_photo=1"),
      rep_honesty: () => rep.honesty || 0, rep_generosity: () => rep.generosity || 0,
      rep_reliability: () => rep.reliability || 0, rep_wisdom: () => rep.wisdom || 0,
      total_reputation: () => (rep.honesty || 0) + (rep.generosity || 0) + (rep.reliability || 0) + (rep.wisdom || 0),
    }[m]?.() ?? 0);
    return catalog.achievements.map((a) => {
      const cur = metric(a.metric);
      return { code: a.code, title: a.title, desc: a.desc, tier: a.tier, threshold: a.threshold,
        track: a.track || a.code.split('_')[0], current: Math.min(cur, a.threshold),
        unlocked: cur >= a.threshold };
    });
  },
  'POST /api/onboard': (body) => { const av = { pine: 'tree3.png', cedar: 'tree4.png', spruce: 'tree2.png' }[body.tree] || 'tree.png';
    db.prepare('update users set name=?, avatar=? where id=?').run((body.name || 'Росточек').slice(0, 16), av, ACTIVE); return { ok: true }; },
  // ── Дупло-сейф ──
  'GET /api/safes': () => db.prepare("select * from safes where child_id=? and status='locked' order by rowid").all(ACTIVE)
    .map((s) => ({ ...s, ready: Date.now() >= s.unlock_at,
      days_left: Math.max(0, Math.ceil((s.unlock_at - Date.now()) / 86400000)) })),
  'POST /api/safe/open': (body) => {
    const amount = parseInt(body.amount, 10), days = parseInt(body.days, 10);
    const rate = { 3: 5, 7: 10, 30: 20 }[days];
    const w = db.prepare('select * from wallets where user_id=?').get(ACTIVE);
    if (!rate) throw { code: 400, msg: 'срок 3, 7 или 30 дней' };
    if (!(amount > 0)) throw { code: 400, msg: 'укажи сумму' };
    if (w.balance < amount) throw { code: 400, msg: 'не хватает шишек' };
    db.prepare('update wallets set balance=balance-? where user_id=?').run(amount, ACTIVE);
    db.prepare('insert into safes(id,child_id,amount,rate,unlock_at) values(?,?,?,?,?)')
      .run(randomUUID(), ACTIVE, amount, rate, Date.now() + days * 86400000);
    tx(ACTIVE, null, amount, 'deposit', 'Дупло на ' + days + ' дн.');
    bumpRep(ACTIVE, 'wisdom', 2);
    return { ok: true, balance: w.balance - amount };
  },
  'POST /api/safe/redeem': (body) => {
    const s = db.prepare('select * from safes where id=?').get(body.id);
    if (!s || s.status !== 'locked') throw { code: 400, msg: 'сейф недоступен' };
    if (Date.now() < s.unlock_at) throw { code: 400, msg: 'ещё не время' };
    const interest = Math.round(s.amount * s.rate / 100);
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?')
      .run(s.amount + interest, interest, ACTIVE);
    db.prepare("update safes set status='unlocked' where id=?").run(body.id);
    tx(null, ACTIVE, interest, 'interest', 'Прирост Дупла');
    return { ok: true, gained: s.amount + interest };
  },
  // ── Гороскоп ──
  'GET /api/horoscope': () => {
    if (!HOROSCOPE[ACTIVE]) {
      const text = catalog.horoscopes[Math.floor(Math.random() * catalog.horoscopes.length)];
      const bonus = Math.random() < 0.4 ? 1 + Math.floor(Math.random() * 3) : 0;
      if (bonus > 0) {
        db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(bonus, bonus, ACTIVE);
        tx(null, ACTIVE, bonus, 'reward', 'Лесной гороскоп');
      }
      HOROSCOPE[ACTIVE] = { text, bonus };
    }
    return HOROSCOPE[ACTIVE];
  },
  // ── Общий котёл ──
  'GET /api/pot': () => db.prepare("select * from pots where status in ('active','reached') order by rowid").all(),
  'POST /api/pot/contribute': (body) => {
    const p = db.prepare('select * from pots where id=?').get(body.id);
    const amount = parseInt(body.amount, 10);
    const w = db.prepare('select * from wallets where user_id=?').get(ACTIVE);
    if (!p) throw { code: 400, msg: 'нет котла' };
    if (!(amount > 0)) throw { code: 400, msg: 'укажи сумму' };
    if (w.balance < amount) throw { code: 400, msg: 'не хватает шишек' };
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?').run(amount, amount, ACTIVE);
    const collected = p.collected + amount;
    db.prepare('update pots set collected=?, status=? where id=?').run(collected, collected >= p.goal ? 'reached' : 'active', p.id);
    tx(ACTIVE, null, amount, 'pot_contribution', 'В котёл: ' + p.title);
    return { ok: true, balance: w.balance - amount, collected, goal: p.goal };
  },
};

// ═══ Опциональные механики: почта, аукцион, страховка, совет, гильдии, квесты ═══
db.exec(`
  create table messages(id text primary key, from_name text, kind text, content text, whisper integer default 0, seen integer default 0, at integer);
  create table auctions(id text primary key, title text, prize text, current_bid integer, leader text, min_bid integer, status text default 'live');
  create table proposals(id text primary key, kind text, title text, target text, amount integer, status text default 'voting', yes integer default 0, no integer default 0);
  create table guilds(id text primary key, name text, reward integer, status text default 'open');
  create table guild_members(guild_id text, name text, share integer);
  create table quests(id text primary key, title text, current_step integer default 1, status text default 'active', fund integer default 0, goal integer, reward integer);
  create table quest_steps(quest_id text, ord integer, kind text, text text, goal integer default 0, progress integer default 0);
  create table meta(k text primary key, v integer);
`);
db.prepare("insert into meta values('ins_fund', 30)").run();
// скины-наряды дерева: у каждого ребёнка базовое дерево надето; у Росточка есть Золотое
db.exec('create table user_skins(user_id text, skin_id text, equipped integer default 0);');
for (const ch of CHILDREN) db.prepare("insert into user_skins values(?, 'sk_base', 1)").run(ch.id);
db.prepare("insert into user_skins values(?, 'sk_gold', 0)").run(CHILDREN[0].id);
const equippedSkin = () => { const eq = db.prepare('select skin_id from user_skins where user_id=? and equipped=1').get(ACTIVE);
  const sk = eq && catalog.skins.find((s) => s.id === eq.skin_id);
  return sk && sk.asset !== 'base' ? sk : null; };
const equippedAsset = () => { const sk = equippedSkin();
  const u = db.prepare('select avatar from users where id=?').get(ACTIVE);
  return sk ? sk.asset + '.png' : (u.avatar || 'tree.png'); };
[['Ёлочка', 'emoji', 'обнимашка', 0], ['Кедрик', 'sticker', 'жёлудь', 0], ['Мама', 'audio', 'голосовое', 1]]
  .forEach(([f, k, c, w], i) => db.prepare('insert into messages(id,from_name,kind,content,whisper,at) values(?,?,?,?,?,?)').run(randomUUID(), f, k, c, w, i));
db.prepare('insert into auctions(id,title,prize,current_bid,leader,min_bid) values(?,?,?,?,?,?)')
  .run(randomUUID(), 'Золотое дерево', 'skin_gold', 20, 'Кедрик', 5);
db.prepare("insert into proposals(id,kind,title,target,amount,yes,no) values(?,?,?,?,?,?,?)")
  .run(randomUUID(), 'insurance_claim', 'Помочь Сосенке (прогорела в лавке)', 'Сосенка', 10, 1, 0);
db.prepare("insert into proposals(id,kind,title,target,amount,yes,no) values(?,?,?,?,?,?,?)")
  .run(randomUUID(), 'pot_spend', 'Потратить котёл на пиццу?', null, null, 2, 1);
db.prepare("insert into proposals(id,kind,title,target,amount,yes,no) values(?,?,?,?,?,?,?)")
  .run(randomUUID(), 'family', 'Устроить лесной пикник в выходные?', null, null, 3, 0);
const GLD = randomUUID();
db.prepare('insert into guilds(id,name,reward) values(?,?,?)').run(GLD, 'Лесные мастера', 60);
// участники — оба ребёнка-профиля + друзья, чтобы доля начислялась любому вошедшему
[[CHILDREN[0].name, 2], [CHILDREN[1].name, 1], ['Ёлочка', 1], ['Кедрик', 1]].forEach(([n, sh]) =>
  db.prepare('insert into guild_members values(?,?,?)').run(GLD, n, sh));
db.exec('create table user_votes(user_id text, proposal_id text);');
const QST = randomUUID();
db.prepare('insert into quests(id,title,goal,reward) values(?,?,?,?)').run(QST, 'Пропала Золотая Шишка', 30, 10);
[[1, 'narrative', 'Беда! Золотая Шишка исчезла из леса.', 0, 0],
 [2, 'collect', 'Соберите 30 шишек в фонд поисков.', 30, 12],
 [3, 'task', 'Обыщите поляны — 3 вылазки.', 3, 0],
 [4, 'finale', 'Золотая Шишка найдена! Награда всем.', 0, 0]]
  .forEach(([o, k, t, g, p]) => db.prepare('insert into quest_steps values(?,?,?,?,?,?)').run(QST, o, k, t, g, p));

const spend = (amount) => { const w = db.prepare('select balance from wallets where user_id=?').get(ACTIVE);
  if (w.balance < amount) throw { code: 400, msg: 'не хватает шишек' };
  db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?').run(amount, amount, ACTIVE); };
// ── рост: репутация (макс 100) и уровень дерева (по накопленному, не понижается) ──
const bumpRep = (uid, trait, amt) => { const u = db.prepare('select reputation from users where id=?').get(uid);
  const r = JSON.parse(u.reputation || '{}'); r[trait] = Math.min(100, (r[trait] || 0) + amt);
  db.prepare('update users set reputation=? where id=?').run(JSON.stringify(r), uid); };
const growTree = (uid) => { const w = db.prepare('select total_earned from wallets where user_id=?').get(uid);
  const lvl = Math.max(1, 1 + Math.floor(w.total_earned / 100));
  db.prepare('update users set tree_level=? where id=? and tree_level<?').run(lvl, uid, lvl); };
const earn = (amount, type, msg) => { db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(amount, amount, ACTIVE); tx(null, ACTIVE, amount, type, msg); growTree(ACTIVE); };
const bal = () => db.prepare('select balance from wallets where user_id=?').get(ACTIVE).balance;
// голосование доходит до исхода: 3+ голоса большинством → принято (страховая заявка выплачивается из фонда)
const resolveProposal = (id) => { const p = db.prepare('select * from proposals where id=?').get(id);
  if (!p || p.status !== 'voting') return;
  if (p.yes >= 3 && p.yes > p.no) {
    if (p.kind === 'insurance_claim' && p.amount) { const fund = db.prepare("select v from meta where k='ins_fund'").get().v;
      if (fund >= p.amount) { db.prepare("update meta set v=v-? where k='ins_fund'").run(p.amount);
        const tgt = db.prepare('select id from users where name=?').get(p.target);
        if (tgt) db.prepare('update wallets set balance=balance+? where user_id=?').run(p.amount, tgt.id); } }
    db.prepare("update proposals set status='accepted' where id=?").run(id);
  } else if (p.no >= 3 && p.no > p.yes) { db.prepare("update proposals set status='rejected' where id=?").run(id); }
};

Object.assign(api, {
  // Скины-наряды дерева
  'GET /api/skins': () => { const owned = new Set(db.prepare('select skin_id from user_skins where user_id=?').all(ACTIVE).map((r) => r.skin_id));
    const eq = db.prepare('select skin_id from user_skins where user_id=? and equipped=1').get(ACTIVE);
    return catalog.skins.map((s) => ({ id: s.id, title: s.title, price: s.price, rarity: s.rarity, asset: s.asset,
      owned: owned.has(s.id), equipped: !!eq && eq.skin_id === s.id })); },
  'POST /api/skin/buy': (body) => { const s = catalog.skins.find((x) => x.id === body.id);
    if (!s) throw { code: 400, msg: 'нет такого наряда' };
    if (db.prepare('select 1 from user_skins where user_id=? and skin_id=?').get(ACTIVE, s.id)) throw { code: 400, msg: 'уже есть' };
    spend(s.price); db.prepare('insert into user_skins values(?,?,0)').run(ACTIVE, s.id);
    return { ok: true, balance: bal() }; },
  'POST /api/skin/equip': (body) => {
    if (!db.prepare('select 1 from user_skins where user_id=? and skin_id=?').get(ACTIVE, body.id)) throw { code: 400, msg: 'сначала купи' };
    db.prepare('update user_skins set equipped=0 where user_id=?').run(ACTIVE);
    db.prepare('update user_skins set equipped=1 where user_id=? and skin_id=?').run(ACTIVE, body.id);
    return { ok: true, tree_asset: equippedAsset() }; },
  // Своя лавка ребёнка
  'POST /api/shop/create': (body) => { const name = String(body.name || '').trim(), lot = String(body.lot || '').trim(), price = parseInt(body.price, 10);
    if (!name || !lot) throw { code: 400, msg: 'заполни название лавки и товар' };
    if (!(price > 0)) throw { code: 400, msg: 'укажи цену больше 0' };
    if (db.prepare('select 1 from shops where owner=?').get(ACTIVE)) throw { code: 400, msg: 'у тебя уже есть лавка' };
    const u = db.prepare('select avatar from users where id=?').get(ACTIVE);
    const sid = randomUUID(); db.prepare('insert into shops values(?,?,?,?,?)').run(sid, ACTIVE, u.avatar || 'tree.png', name.slice(0, 24), 0);
    db.prepare('insert into lots values(?,?,?,?)').run(randomUUID(), sid, lot.slice(0, 24), price);
    return { ok: true }; },
  'POST /api/link': (body) => { const c = CHILDREN.find((x) => x.code.toUpperCase() === String(body.code||'').toUpperCase().trim()); if (!c) throw { code: 400, msg: 'код не найден' }; ACTIVE = c.id; return { ok: true, name: c.name }; },
  'GET /api/children': () => CHILDREN.map((c) => ({ name: c.name, code: c.code })),
  // ═══ Родительский кабинет ═══
  'GET /api/parent/children': () => CHILDREN.map((c) => {
    const w = db.prepare('select balance from wallets where user_id=?').get(c.id);
    const u = db.prepare('select tree_level from users where id=?').get(c.id);
    return { id: c.id, name: c.name, code: c.code, balance: w.balance, level: u.tree_level }; }),
  'POST /api/parent/add-child': (body) => {
    const name = String(body.name || '').trim().slice(0, 16); if (!name) throw { code: 400, msg: 'укажи имя' };
    const av = { pine: 'tree3.png', cedar: 'tree4.png', spruce: 'tree2.png' }[body.tree] || 'tree.png';
    const code = name.slice(0, 4).toUpperCase() + '-' + String(CHILDREN.length + 1).padStart(2, '0');
    const ch = seedChild(name, 1, av, 0, 0, { honesty: 0, generosity: 0, reliability: 0, wisdom: 0 }, code);
    CHILDREN.push(ch); db.prepare("insert into user_skins values(?, 'sk_base', 1)").run(ch.id);
    return { ok: true, name, code }; },
  'POST /api/parent/create-task': (body) => {
    const ch = CHILDREN.find((c) => c.id === body.childId); if (!ch) throw { code: 400, msg: 'нет ребёнка' };
    const title = String(body.title || '').trim().slice(0, 60); const reward = parseInt(body.reward, 10);
    if (!title) throw { code: 400, msg: 'укажи задание' }; if (!(reward > 0)) throw { code: 400, msg: 'укажи награду' };
    db.prepare('insert into tasks(id,child_id,title,reward,category,needs_photo) values(?,?,?,?,?,?)')
      .run(randomUUID(), ch.id, title, reward, 'family', body.photo ? 1 : 0);
    return { ok: true }; },
  'GET /api/parent/pending': () => db.prepare("select t.id, t.title, t.reward, u.name childName from tasks t join users u on u.id=t.child_id where t.status='submitted' order by t.rowid").all(),
  'POST /api/parent/approve': (body) => {
    const t = db.prepare('select * from tasks where id=?').get(body.id);
    if (!t || t.status !== 'submitted') throw { code: 400, msg: 'нет задания на проверке' };
    db.prepare("update tasks set status='done' where id=?").run(t.id);
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(t.reward, t.reward, t.child_id);
    tx(null, t.child_id, t.reward, 'reward', t.title);
    bumpRep(t.child_id, 'honesty', 3); bumpRep(t.child_id, 'reliability', 2); growTree(t.child_id);
    return { ok: true }; },
  'POST /api/parent/reject': (body) => { db.prepare("update tasks set status='open' where id=? and status='submitted'").run(body.id); return { ok: true }; },
  'POST /api/parent/topup': (body) => {
    const ch = CHILDREN.find((c) => c.id === body.childId); if (!ch) throw { code: 400, msg: 'нет ребёнка' };
    const amount = parseInt(body.amount, 10); if (!(amount > 0)) throw { code: 400, msg: 'укажи сумму' };
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(amount, amount, ch.id);
    tx(null, ch.id, amount, 'reward', 'Пополнение от родителя');
    growTree(ch.id);
    return { ok: true }; },
  'POST /api/parent/add-prize': (body) => {
    const title = String(body.title || '').trim().slice(0, 40); const price = parseInt(body.price, 10);
    if (!title) throw { code: 400, msg: 'название приза' }; if (!(price > 0)) throw { code: 400, msg: 'цена больше 0' };
    db.prepare('insert into shop_items values(?,?,?,?)').run(randomUUID(), 'impression', title, price);
    return { ok: true }; },
  'GET /api/inbox': () => db.prepare('select id,from_name,kind,content,whisper,seen from messages order by at desc').all(),
  'POST /api/message': (body) => { db.prepare('insert into messages(id,from_name,kind,content,at) values(?,?,?,?,?)')
    .run(randomUUID(), 'Ты', 'emoji', body.emoji || 'привет', 99); return { ok: true }; },
  'GET /api/auction': () => db.prepare("select * from auctions where status='live' limit 1").get() || {},
  'POST /api/bid': (body) => { const a = db.prepare("select * from auctions where status='live' limit 1").get();
    const amount = parseInt(body.amount, 10);
    if (!a) throw { code: 400, msg: 'нет аукциона' };
    if (amount <= a.current_bid) throw { code: 400, msg: `ставка должна быть больше ${a.current_bid}` };
    const nm = db.prepare('select name from users where id=?').get(ACTIVE).name;
    spend(amount); db.prepare('update auctions set current_bid=?, leader=? where id=?').run(amount, nm, a.id);
    return { ok: true, balance: bal(), current_bid: amount, leader: nm }; },
  'GET /api/insurance': () => { const voted = new Set(db.prepare('select proposal_id from user_votes where user_id=?').all(ACTIVE).map((r) => r.proposal_id));
    return { fund: db.prepare("select v from meta where k='ins_fund'").get().v,
      claims: db.prepare("select id,title,target,amount,yes,no,status from proposals where kind='insurance_claim'").all()
        .map((c) => ({ ...c, voted: voted.has(c.id) })) }; },
  'POST /api/premium': () => { spend(1); db.prepare("update meta set v=v+1 where k='ins_fund'").run();
    return { ok: true, balance: bal(), fund: db.prepare("select v from meta where k='ins_fund'").get().v }; },
  // Совет — только общесемейные инициативы (страховые заявки живут в Страховке)
  'GET /api/proposals': () => { const voted = new Set(db.prepare('select proposal_id from user_votes where user_id=?').all(ACTIVE).map((r) => r.proposal_id));
    return db.prepare("select id,kind,title,target,amount,yes,no,status from proposals where kind<>'insurance_claim' order by rowid").all()
      .map((p) => ({ ...p, voted: voted.has(p.id) })); },
  'POST /api/vote': (body) => {
    if (db.prepare('select 1 from user_votes where user_id=? and proposal_id=?').get(ACTIVE, body.id)) throw { code: 400, msg: 'ты уже голосовал' };
    const col = body.choice === 'yes' ? 'yes' : 'no';
    db.prepare(`update proposals set ${col}=${col}+1 where id=?`).run(body.id);
    db.prepare('insert into user_votes values(?,?)').run(ACTIVE, body.id);
    resolveProposal(body.id);
    const st = db.prepare('select status from proposals where id=?').get(body.id).status;
    return { ok: true, status: st }; },
  'GET /api/guild': () => { const g = db.prepare("select * from guilds where status='open' limit 1").get();
    if (!g) return {};
    return { ...g, members: db.prepare('select name,share from guild_members where guild_id=? order by rowid').all(g.id) }; },
  'POST /api/guild/complete': () => { const g = db.prepare("select * from guilds where status='open' limit 1").get();
    if (!g) throw { code: 400, msg: 'нет гильдии' };
    const members = db.prepare('select name,share from guild_members where guild_id=?').all(g.id);
    const total = members.reduce((s, m) => s + m.share, 0);
    const nm = db.prepare('select name from users where id=?').get(ACTIVE).name;
    const my = members.find((m) => m.name === nm);
    const myCut = Math.floor(g.reward * (my?.share || 0) / total);
    if (myCut > 0) earn(myCut, 'reward', 'Заказ гильдии');
    db.prepare("update guilds set status='completed' where id=?").run(g.id);
    return { ok: true, myCut, balance: bal() }; },
  'GET /api/quest': () => { const q = db.prepare("select * from quests where status='active' limit 1").get();
    if (!q) return { done: true };
    return { ...q, step: db.prepare('select ord,kind,text,goal,progress from quest_steps where quest_id=? and ord=?').get(q.id, q.current_step) }; },
  'POST /api/quest/act': (body) => { const q = db.prepare("select * from quests where status='active' limit 1").get();
    const st = db.prepare('select * from quest_steps where quest_id=? and ord=?').get(q.id, q.current_step);
    if (st.kind === 'collect') { const a = parseInt(body.amount || 5, 10); spend(a);
      db.prepare('update quest_steps set progress=progress+? where quest_id=? and ord=?').run(a, q.id, q.current_step);
      db.prepare('update quests set fund=fund+? where id=?').run(a, q.id); }
    else if (st.kind === 'task') db.prepare('update quest_steps set progress=progress+1 where quest_id=? and ord=?').run(q.id, q.current_step);
    return api['GET /api/quest'](); },
  'POST /api/quest/advance': () => { const q = db.prepare("select * from quests where status='active' limit 1").get();
    const st = db.prepare('select * from quest_steps where quest_id=? and ord=?').get(q.id, q.current_step);
    if (st.kind !== 'narrative' && st.progress < st.goal) throw { code: 400, msg: `шаг не завершён (${st.progress}/${st.goal})` };
    const next = q.current_step + 1;
    const nx = db.prepare('select * from quest_steps where quest_id=? and ord=?').get(q.id, next);
    db.prepare('update quests set current_step=? where id=?').run(next, q.id);
    if (nx && nx.kind === 'finale') { earn(q.reward, 'reward', 'Награда квеста'); db.prepare("update quests set status='completed' where id=?").run(q.id); }
    return api['GET /api/quest'](); },
});

// ── HTTP: /api/* → JSON, иначе статика ───────────────────────────────
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    let body = {};
    if (req.method === 'POST') {
      const chunks = []; for await (const c of req) chunks.push(c);
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch {}
    }
    // активный ребёнок — по коду-привязке из заголовка устройства
    const cc = req.headers['x-child-code'];
    if (cc) { const c = CHILDREN.find((x) => x.code === decodeURIComponent(cc)); if (c) ACTIVE = c.id; }
    const handler = api[`${req.method} ${url.pathname}`];
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!handler) { res.writeHead(404); return res.end('{}'); }
    try { const out = JSON.stringify(handler(body)); res.writeHead(200); res.end(out); }   // считаем ДО отправки заголовков
    catch (e) { res.writeHead(e.code || 500); res.end(JSON.stringify({ error: e.msg || 'server error' })); }
    return;
  }
  // статика
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const data = await readFile(join(DIR, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(3777, () => console.log('Шишка Банк → http://localhost:3777'));
