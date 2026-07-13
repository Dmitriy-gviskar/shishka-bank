// Локальная проверка модели Шишка Банк на node:sqlite (node v24).
// НЕ прод: прод-логика в functions.sql (Postgres RPC). Здесь зеркалим схему и
// операции на SQLite, льём реальный каталог и гоняем полный цикл петли,
// проверяя финансовые инварианты ассертами. Запуск:
//   node --experimental-sqlite db/local_check.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const db = new DatabaseSync(':memory:');
db.exec(`
  create table circles(id text primary key, name text, invite_code text unique, insurance_fund integer default 0);
  create table bank_account(id text primary key, treasury integer default 0);
  insert into bank_account(id,treasury) values('main',0);
  create table proposals(id text primary key, circle_id text, type text, title text,
    target_user text, amount integer, status text default 'voting', created_by text);
  create table votes(proposal_id text, voter_id text, choice text, primary key(proposal_id, voter_id));
  create table auctions(id text primary key, title text, prize_skin text, min_bid integer default 1,
    current_bid integer default 0, current_leader text, status text default 'live', created_by text);
  create table bids(id text primary key, auction_id text, bidder_id text, amount integer);
  create table quests(id text primary key, circle_id text, code text, title text, current_step integer default 1,
    status text default 'active', fund integer default 0, reward_cones integer default 0, reward_skin text);
  create table quest_steps(quest_id text, step_order integer, kind text, text text,
    goal integer default 0, progress integer default 0, done integer default 0, primary key(quest_id, step_order));
  create table users(id text primary key, circle_id text, role text, name text,
    tree_level integer default 1, avatar_skin text default 'base',
    reputation text default '{"honesty":0,"generosity":0,"reliability":0,"wisdom":0}',
    last_visit integer, current_streak integer default 0, longest_streak integer default 0,
    streak_freezes integer default 0);
  create table wallets(user_id text primary key, balance integer default 0,
    total_earned integer default 0, total_spent integer default 0);
  create table transactions(id text primary key, circle_id text, from_user text,
    to_user text, amount integer, type text, ref_id text, message text);
  create table tasks(id text primary key, circle_id text, child_id text, title text,
    reward integer, category text, needs_photo integer default 0,
    status text default 'open', proof_url text);
  create table shop_items(id text primary key, circle_id text, type text default 'impression',
    title text, price integer, category text, rarity text default 'base', season text, is_active integer default 1);
  create table user_skins(user_id text, skin_id text, primary key(user_id, skin_id));
  create table pots(id text primary key, circle_id text, title text, goal integer,
    collected integer default 0, status text default 'open');
  create table pot_contributions(id text primary key, pot_id text, child_id text, amount integer);
  create table horoscope_texts(id text primary key, text text);
  create table daily_horoscopes(id text primary key, child_id text, horoscope_date integer,
    text text, bonus integer default 0, unique(child_id, horoscope_date));
  create table events(id text primary key, circle_id text, type text, title text,
    modifiers text default '{}', active integer default 1);
  create table achievements(code text primary key, title text, description text,
    metric text, threshold integer, tier integer default 1, reward integer default 0);
  create table user_achievements(child_id text, code text, primary key(child_id, code));
  create table shops(id text primary key, owner_id text unique, circle_id text, name text,
    description text, is_heir integer default 0, is_active integer default 1);
  create table shop_lots(id text primary key, shop_id text, title text, type text default 'goods',
    price integer, is_active integer default 1);
  create table orders(id text primary key, lot_id text, buyer_id text, seller_id text,
    price integer, status text default 'reserved');
  create table guilds(id text primary key, circle_id text, name text, created_by text, status text default 'open');
  create table guild_members(guild_id text, child_id text, share integer default 1, primary key(guild_id, child_id));
  create table messages(id text primary key, circle_id text, from_user text, to_user text,
    type text, content text, is_whisper integer default 0, deliver_at integer, read_at integer);
  create table purchases(id text primary key, circle_id text, child_id text, item_id text,
    price integer, status text default 'promised');
  create table safes(id text primary key, user_id text, amount integer, interest_rate integer,
    unlock_date integer, status text default 'locked');
  create table badges(user_id text, badge_type text, unique(user_id, badge_type));
  create table task_templates(id text primary key, title text, reward integer,
    category text, is_daily integer default 0, needs_photo integer default 0);
  create table daily_quests(id text primary key, child_id text, quest_date integer,
    title text, reward integer, status text default 'open', unique(child_id, quest_date));
`);
// В проде last_visit/quest_date — DATE; здесь целый «день N» для детерминированной симуляции.

// ── операции (зеркало functions.sql) ─────────────────────────────────
const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; }
                     catch (e) { db.exec('ROLLBACK'); throw e; } };

function submitTask(taskId, proof = null) {
  const t = db.prepare('select * from tasks where id=?').get(taskId);
  assert(t, 'task not found');
  assert(['open', 'rejected'].includes(t.status), `not submittable: ${t.status}`);
  if (t.needs_photo) assert(proof, 'task requires photo proof');
  db.prepare("update tasks set status='pending_review', proof_url=? where id=?").run(proof, taskId);
}
function approveTask(taskId) {
  return tx(() => {
    const t = db.prepare('select * from tasks where id=?').get(taskId);
    assert(t && t.status === 'pending_review', 'not awaiting review');
    const rew = Math.round(t.reward * eventMultiplier(t.circle_id, 'task_reward'));  // Ярмарка/сезон
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?')
      .run(rew, rew, t.child_id);
    db.prepare("update tasks set status='done' where id=?").run(taskId);
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), t.circle_id, null, t.child_id, rew, 'reward', t.id, t.title);
    bumpReputation(t.child_id, 'honesty', 1);
    checkAchievements(t.child_id);
  });
}
function purchaseItem(childId, itemId) {
  return tx(() => {
    const it = db.prepare('select * from shop_items where id=?').get(itemId);
    assert(it && it.is_active, 'item unavailable');
    const w = db.prepare('select * from wallets where user_id=?').get(childId);
    assert(w, 'wallet not found');
    assert(w.balance >= it.price, `not enough cones: have ${w.balance}, need ${it.price}`);
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?')
      .run(it.price, it.price, childId);
    const pid = randomUUID();
    db.prepare('insert into purchases values(?,?,?,?,?,?)')
      .run(pid, it.circle_id, childId, it.id, it.price, 'promised');
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), it.circle_id, childId, null, it.price, 'purchase', pid, it.title);
    return pid;
  });
}
function transferCones(fromId, toId, amount, message = null) {
  return tx(() => {
    assert(amount > 0, 'amount must be positive');
    assert(fromId !== toId, 'cannot transfer to self');
    const wf = db.prepare('select * from wallets where user_id=?').get(fromId);
    assert(wf && wf.balance >= amount, `not enough cones: have ${wf?.balance}, need ${amount}`);
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?')
      .run(amount, amount, fromId);
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?')
      .run(amount, amount, toId);
    const cid = db.prepare('select circle_id from users where id=?').get(fromId).circle_id;
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), cid, fromId, toId, amount, 'transfer', null, message);
    bumpReputation(fromId, 'generosity', 1);
    checkAchievements(fromId);   // Даритель/Меценат/Великий Меценат
  });
}

function bumpReputation(userId, trait, delta) {
  const u = db.prepare('select reputation from users where id=?').get(userId);
  const rep = JSON.parse(u.reputation); rep[trait] = (rep[trait] || 0) + delta;
  db.prepare('update users set reputation=? where id=?').run(JSON.stringify(rep), userId);
}
const awardBadge = (userId, type) =>
  db.prepare('insert or ignore into badges values(?,?)').run(userId, type);

function openSafe(childId, amount, days) {
  return tx(() => {
    const rate = { 3: 5, 7: 10, 30: 20 }[days];
    assert(rate, `invalid term: ${days} days`);
    assert(amount > 0, 'amount must be positive');
    const w = db.prepare('select * from wallets where user_id=?').get(childId);
    assert(w && w.balance >= amount, `not enough cones: have ${w?.balance}, need ${amount}`);
    db.prepare('update wallets set balance=balance-? where user_id=?').run(amount, childId); // заморозка ≠ трата
    const sid = randomUUID();
    const unlock = Date.now() + days * 86400_000;
    db.prepare('insert into safes values(?,?,?,?,?,?)').run(sid, childId, amount, rate, unlock, 'locked');
    const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), cid, childId, null, amount, 'deposit', sid, `Дупло на ${days} дн.`);
    bumpReputation(childId, 'wisdom', 1);
    checkAchievements(childId);   // Осторожный (первое Дупло)
    return sid;
  });
}
function redeemSafe(safeId) {
  return tx(() => {
    const s = db.prepare('select * from safes where id=?').get(safeId);
    assert(s, 'safe not found');
    assert(s.status === 'locked', 'safe already redeemed');
    assert(Date.now() >= s.unlock_date, 'safe locked (no early withdrawal)');
    const cid = db.prepare('select circle_id from users where id=?').get(s.user_id).circle_id;
    const interest = Math.round(s.amount * s.interest_rate / 100 * eventMultiplier(cid, 'safe_interest'));  // Осень х2
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?')
      .run(s.amount + interest, interest, s.user_id);
    db.prepare("update safes set status='unlocked' where id=?").run(safeId);
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), cid, null, s.user_id, interest, 'interest', safeId, 'Прирост Дупла');
    bumpReputation(s.user_id, 'reliability', 1);
    checkAchievements(s.user_id);   // Хранитель (3 закрытых Дупла)
  });
}

function checkMilestones(childId) {
  const u = db.prepare('select * from users where id=?').get(childId);
  if (u.longest_streak >= 7) awardBadge(childId, 'week_in_forest');
  if (u.longest_streak >= 30) awardBadge(childId, 'forest_master');
  const done = db.prepare("select count(*) c from tasks where child_id=? and status='done'").get(childId).c;
  if (done >= 10) awardBadge(childId, 'hard_worker');
  const earned = db.prepare('select total_earned e from wallets where user_id=?').get(childId).e;
  if (earned >= 100) awardBadge(childId, 'saver');
}
function buyStreakFreeze(childId) {
  return tx(() => {
    const price = 20;
    const w = db.prepare('select * from wallets where user_id=?').get(childId);
    assert(w && w.balance >= price, `not enough cones: have ${w?.balance}, need ${price}`);
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?').run(price, price, childId);
    db.prepare('update users set streak_freezes=streak_freezes+1 where id=?').run(childId);
    const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), cid, childId, null, price, 'purchase', null, 'Дождик-защитник');
  });
}
// стрик-полив: ведёт серию (с защитой «дождиком»), растит дерево, дарит шишечный дождь
function dailyVisit(childId, day) {
  return tx(() => {
    const u = db.prepare('select * from users where id=?').get(childId);
    if (u.last_visit === day)
      return { streak: u.current_streak, tree_level: u.tree_level, rain: 0, first_today: false, freeze_used: false };
    let newStreak, freezeUsed = false;
    if (u.last_visit === day - 1) newStreak = u.current_streak + 1;
    else if (u.last_visit === day - 2 && u.streak_freezes > 0) {
      newStreak = u.current_streak + 1;               // дождик спас пропущенный день
      db.prepare('update users set streak_freezes=streak_freezes-1 where id=?').run(childId);
      freezeUsed = true;
    } else newStreak = 1;
    const ls = Math.max(u.longest_streak, newStreak);
    const lvl = ls >= 30 ? 5 : ls >= 14 ? 4 : ls >= 7 ? 3 : ls >= 3 ? 2 : 1;
    const rain = Math.random() < 0.30 ? 1 + Math.floor(Math.random() * 3) : 0;
    db.prepare('update users set last_visit=?, current_streak=?, longest_streak=?, tree_level=? where id=?')
      .run(day, newStreak, ls, lvl, childId);
    if (rain > 0) {
      db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?')
        .run(rain, rain, childId);
      const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
      db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), cid, null, childId, rain, 'reward', null, 'Шишечный дождь');
    }
    checkAchievements(childId);
    return { streak: newStreak, tree_level: lvl, rain, first_today: true, freeze_used: freezeUsed };
  });
}
function getDailyQuest(childId, day) {
  let q = db.prepare('select * from daily_quests where child_id=? and quest_date=?').get(childId, day);
  if (q) return q;
  const tmpl = db.prepare('select * from task_templates order by random() limit 1').get() ||
               { title: 'Помочь по дому', reward: 10 };  // фолбэк, если шаблоны не залиты в этом ране
  const id = randomUUID();
  db.prepare('insert into daily_quests(id,child_id,quest_date,title,reward) values(?,?,?,?,?)')
    .run(id, childId, day, tmpl.title, tmpl.reward + 5);
  return db.prepare('select * from daily_quests where id=?').get(id);
}
function completeDailyQuest(qid) {
  return tx(() => {
    const q = db.prepare('select * from daily_quests where id=?').get(qid);
    assert(q, 'quest not found');
    assert(q.status !== 'done', 'daily quest already done');
    db.prepare("update daily_quests set status='done' where id=?").run(qid);
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?')
      .run(q.reward, q.reward, q.child_id);
    const cid = db.prepare('select circle_id from users where id=?').get(q.child_id).circle_id;
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), cid, null, q.child_id, q.reward, 'reward', q.id, 'Квест дня: ' + q.title);
  });
}

function purchaseSkin(childId, itemId) {
  return tx(() => {
    const it = db.prepare('select * from shop_items where id=?').get(itemId);
    assert(it && it.is_active && it.type === 'skin', 'skin unavailable');
    assert(!db.prepare('select 1 from user_skins where user_id=? and skin_id=?').get(childId, itemId), 'skin already owned');
    const w = db.prepare('select * from wallets where user_id=?').get(childId);
    assert(w && w.balance >= it.price, `not enough cones: have ${w?.balance}, need ${it.price}`);
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?').run(it.price, it.price, childId);
    db.prepare('insert into user_skins values(?,?)').run(childId, itemId);
    const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), cid, childId, null, it.price, 'purchase', itemId, 'Скин: ' + it.title);
    checkAchievements(childId);   // Модник/Коллекционер
  });
}
function equipSkin(childId, skinId) {
  const it = db.prepare('select * from shop_items where id=?').get(skinId);
  assert(it && it.type === 'skin', 'skin not found');
  if (it.rarity !== 'base')
    assert(db.prepare('select 1 from user_skins where user_id=? and skin_id=?').get(childId, skinId), 'skin not owned');
  db.prepare('update users set avatar_skin=? where id=?').run(skinId, childId);
}

function createPot(circleId, title, goal) {
  const id = randomUUID();
  db.prepare('insert into pots(id,circle_id,title,goal) values(?,?,?,?)').run(id, circleId, title, goal);
  return id;
}
function contributePot(childId, potId, amount) {
  return tx(() => {
    assert(amount > 0, 'amount must be positive');
    const pt = db.prepare('select * from pots where id=?').get(potId);
    assert(pt, 'pot not found');
    assert(pt.status !== 'fulfilled', 'pot already fulfilled');
    const w = db.prepare('select * from wallets where user_id=?').get(childId);
    assert(w && w.balance >= amount, `not enough cones: have ${w?.balance}, need ${amount}`);
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?').run(amount, amount, childId); // ушло в котёл
    const collected = pt.collected + amount;
    const status = collected >= pt.goal ? 'reached' : pt.status;
    db.prepare('update pots set collected=?, status=? where id=?').run(collected, status, potId);
    db.prepare('insert into pot_contributions values(?,?,?,?)').run(randomUUID(), potId, childId, amount);
    const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), cid, childId, null, amount, 'pot_contribution', potId, 'В котёл: ' + pt.title);
    bumpReputation(childId, 'generosity', 1);
    checkAchievements(childId);   // Друг семьи
    return db.prepare('select * from pots where id=?').get(potId);
  });
}
function fulfillPot(potId) {
  const pt = db.prepare('select * from pots where id=?').get(potId);
  assert(pt && pt.status !== 'fulfilled', 'pot already fulfilled');
  db.prepare("update pots set status='fulfilled' where id=?").run(potId);
}
function getDailyHoroscope(childId, day) {
  const ex = db.prepare('select * from daily_horoscopes where child_id=? and horoscope_date=?').get(childId, day);
  if (ex) return ex;
  const txt = db.prepare('select text from horoscope_texts order by random() limit 1').get().text;
  const bonus = Math.random() < 0.20 ? 1 + Math.floor(Math.random() * 3) : 0;
  const id = randomUUID();
  db.prepare('insert into daily_horoscopes(id,child_id,horoscope_date,text,bonus) values(?,?,?,?,?)')
    .run(id, childId, day, txt, bonus);
  if (bonus > 0) {
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(bonus, bonus, childId);
    const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), cid, null, childId, bonus, 'reward', null, 'Лесной гороскоп');
  }
  checkAchievements(childId);   // Звездочёт (7 гороскопов)
  return db.prepare('select * from daily_horoscopes where id=?').get(id);
}

// действующий множитель по ключу среди активных событий (своих и глобальных)
function eventMultiplier(circleId, key) {
  const rows = db.prepare('select modifiers from events where (circle_id=? or circle_id is null) and active=1').all(circleId);
  const vals = [];
  for (const r of rows) { const m = JSON.parse(r.modifiers); if (key in m) vals.push(m[key]); }
  return vals.length ? Math.max(...vals) : 1;
}
function startEvent(circleId, type, title, modifiers, _days) {
  const id = randomUUID();
  db.prepare('insert into events(id,circle_id,type,title,modifiers) values(?,?,?,?,?)')
    .run(id, circleId, type, title, JSON.stringify(modifiers));
  return id;
}
function triggerConeRain(circleId, amount) {
  return tx(() => {
    assert(amount > 0, 'amount must be positive');
    const kids = db.prepare("select id from users where circle_id=? and role='child'").all(circleId);
    for (const k of kids) {
      db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(amount, amount, k.id);
      db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), circleId, null, k.id, amount, 'reward', null, 'Шишечный дождь для всех');
    }
    return kids.length;
  });
}

function achievementMetric(childId, metric) {
  if (metric.startsWith('rep_') || metric === 'total_reputation') {
    const rep = JSON.parse(db.prepare('select reputation from users where id=?').get(childId).reputation);
    if (metric === 'total_reputation')
      return (rep.honesty || 0) + (rep.generosity || 0) + (rep.reliability || 0) + (rep.wisdom || 0);
    return rep[metric.slice(4)] || 0;
  }
  const q = {
    transfers_count: "select count(*) c from transactions where from_user=? and type='transfer'",
    gifts_sum: "select coalesce(sum(amount),0) c from transactions where from_user=? and type='transfer'",
    tasks_done: "select count(*) c from tasks where child_id=? and status='done'",
    cones_earned: 'select coalesce(total_earned,0) c from wallets where user_id=?',
    longest_streak: 'select coalesce(longest_streak,0) c from users where id=?',
    deposits_count: 'select count(*) c from safes where user_id=?',
    deposits_closed: "select count(*) c from safes where user_id=? and status='unlocked'",
    horoscopes_read: 'select count(*) c from daily_horoscopes where child_id=?',
    skins_owned: 'select count(*) c from user_skins where user_id=?',
    pot_contributions: 'select count(*) c from pot_contributions where child_id=?',
    purchases_count: 'select count(*) c from purchases where child_id=?',
    daily_quests_done: "select count(*) c from daily_quests where child_id=? and status='done'",
    cone_rain_caught: "select count(*) c from transactions where to_user=? and message like 'Шишечный дождь%'",
    freezes_bought: "select count(*) c from transactions where from_user=? and message='Дождик-защитник'",
    interest_earned: "select coalesce(sum(amount),0) c from transactions where to_user=? and type='interest'",
    current_balance: 'select coalesce(balance,0) c from wallets where user_id=?',
    cones_spent: 'select coalesce(total_spent,0) c from wallets where user_id=?',
    tasks_photo: "select count(*) c from tasks where child_id=? and status='done' and proof_url is not null",
    tree_level: 'select coalesce(tree_level,0) c from users where id=?',
    transfers_received: "select count(*) c from transactions where to_user=? and type='transfer'",
    gifts_received_sum: "select coalesce(sum(amount),0) c from transactions where to_user=? and type='transfer'",
    categories_done: "select count(distinct category) c from tasks where child_id=? and status='done'",
    sales_count: "select count(*) c from orders where seller_id=? and status='delivered'",
    sales_sum: "select coalesce(sum(price),0) c from orders where seller_id=? and status='delivered'",
    shop_buys: "select count(*) c from orders where buyer_id=? and status='delivered'",
    messages_sent: 'select count(*) c from messages where from_user=?',
  }[metric];
  return q ? db.prepare(q).get(childId).c : 0;
}
function checkAchievements(childId) {
  for (const a of db.prepare('select * from achievements').all()) {
    if (db.prepare('select 1 from user_achievements where child_id=? and code=?').get(childId, a.code)) continue;
    if (achievementMetric(childId, a.metric) >= a.threshold) {
      db.prepare('insert into user_achievements values(?,?)').run(childId, a.code);
      if (a.reward > 0) {
        db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(a.reward, a.reward, childId);
        const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
        db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
          .run(randomUUID(), cid, null, childId, a.reward, 'reward', null, 'Достижение: ' + a.title);
      }
    }
  }
}

function openShop(childId, name, desc) {
  assert(!db.prepare('select 1 from shops where owner_id=?').get(childId), 'child already has a shop');
  const id = randomUUID();
  const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
  db.prepare('insert into shops(id,owner_id,circle_id,name,description) values(?,?,?,?,?)').run(id, childId, cid, name, desc);
  return id;
}
function addLot(childId, title, type, price) {
  const sh = db.prepare('select * from shops where owner_id=?').get(childId);
  assert(sh, 'open a shop first');
  const id = randomUUID();
  db.prepare('insert into shop_lots(id,shop_id,title,type,price) values(?,?,?,?,?)').run(id, sh.id, title, type || 'goods', price);
  return id;
}
function reserveLot(buyerId, lotId) {
  return tx(() => {
    const l = db.prepare('select * from shop_lots where id=?').get(lotId);
    assert(l && l.is_active, 'lot unavailable');
    const sh = db.prepare('select * from shops where id=?').get(l.shop_id);
    assert(sh.is_active, 'shop closed');
    assert(sh.owner_id !== buyerId, 'cannot buy from your own shop');
    const w = db.prepare('select * from wallets where user_id=?').get(buyerId);
    assert(w.balance >= l.price, `not enough cones: have ${w.balance}, need ${l.price}`);
    db.prepare('update wallets set balance=balance-? where user_id=?').run(l.price, buyerId);  // эскроу
    const id = randomUUID();
    db.prepare('insert into orders(id,lot_id,buyer_id,seller_id,price) values(?,?,?,?,?)').run(id, lotId, buyerId, sh.owner_id, l.price);
    return id;
  });
}
function confirmOrder(orderId) {
  return tx(() => {
    const o = db.prepare('select * from orders where id=?').get(orderId);
    assert(o && o.status === 'reserved', 'order not reservable');
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(o.price, o.price, o.seller_id);
    db.prepare('update wallets set total_spent=total_spent+? where user_id=?').run(o.price, o.buyer_id);
    db.prepare("update orders set status='delivered' where id=?").run(orderId);
    const cid = db.prepare('select circle_id from users where id=?').get(o.buyer_id).circle_id;
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), cid, o.buyer_id, o.seller_id, o.price, 'transfer', orderId, 'Покупка в лавке');
    checkAchievements(o.seller_id);
    checkAchievements(o.buyer_id);
  });
}
function cancelOrder(orderId) {
  return tx(() => {
    const o = db.prepare('select * from orders where id=?').get(orderId);
    assert(o && o.status === 'reserved', 'only reserved orders can be canceled');
    db.prepare('update wallets set balance=balance+? where user_id=?').run(o.price, o.buyer_id);
    db.prepare("update orders set status='canceled' where id=?").run(orderId);
  });
}

function createGuild(creatorId, name, share) {
  const id = randomUUID();
  const cid = db.prepare('select circle_id from users where id=?').get(creatorId).circle_id;
  db.prepare('insert into guilds(id,circle_id,name,created_by) values(?,?,?,?)').run(id, cid, name, creatorId);
  db.prepare('insert into guild_members values(?,?,?)').run(id, creatorId, Math.max(share, 1));
  return id;
}
function joinGuild(guildId, childId, share) {
  const g = db.prepare('select * from guilds where id=?').get(guildId);
  assert(g && g.status === 'open', 'guild is not open');
  db.prepare('insert or replace into guild_members values(?,?,?)').run(guildId, childId, Math.max(share, 1));
}
function completeGuildOrder(guildId, amount) {
  return tx(() => {
    assert(amount > 0, 'amount must be positive');
    const g = db.prepare('select * from guilds where id=?').get(guildId);
    assert(g && g.status === 'open', 'guild order already closed');
    const members = db.prepare('select * from guild_members where guild_id=? order by child_id').all(guildId);
    const total = members.reduce((s, m) => s + m.share, 0);
    assert(total > 0, 'guild has no members');
    let paid = 0;
    members.forEach((m, i) => {
      const cut = (i === members.length - 1) ? amount - paid : Math.floor(amount * m.share / total);
      paid += cut;
      if (cut > 0) {
        db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(cut, cut, m.child_id);
        const cid = db.prepare('select circle_id from users where id=?').get(m.child_id).circle_id;
        db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)')
          .run(randomUUID(), cid, null, m.child_id, cut, 'reward', guildId, 'Заказ гильдии: ' + g.name);
        checkAchievements(m.child_id);
      }
    });
    db.prepare("update guilds set status='completed' where id=?").run(guildId);
  });
}

function sendMessage(fromId, toId, type, content) {
  const cf = db.prepare('select circle_id from users where id=?').get(fromId).circle_id;
  const ct = db.prepare('select circle_id from users where id=?').get(toId).circle_id;
  assert(cf === ct, 'recipient is not in your circle');
  const id = randomUUID();
  db.prepare('insert into messages(id,circle_id,from_user,to_user,type,content,deliver_at) values(?,?,?,?,?,?,?)')
    .run(id, cf, fromId, toId, type, content, Date.now());
  checkAchievements(fromId);   // Почтальон
  return id;
}
function sendWhisper(parentId, childId, url, delayHours) {
  const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
  const id = randomUUID();
  db.prepare('insert into messages(id,circle_id,from_user,to_user,type,content,is_whisper,deliver_at) values(?,?,?,?,?,?,1,?)')
    .run(id, cid, parentId, childId, 'audio', url, Date.now() + Math.max(delayHours, 0) * 3600000);
  return id;
}
const getInbox = (childId) =>
  db.prepare('select * from messages where to_user=? and deliver_at<=? order by rowid desc').all(childId, Date.now());
function markRead(msgId) {
  db.prepare('update messages set read_at=? where id=? and read_at is null').run(Date.now(), msgId);
}

// перевод-оплата с комиссией банка (НЕ подарок): 1 шишка сгорает, щедрость не растёт
function payCones(fromId, toId, amount, message) {
  return tx(() => {
    assert(fromId !== toId, 'cannot pay yourself');
    const fee = 1;
    assert(amount > fee, `amount must exceed the ${fee} cone fee`);
    const net = amount - fee;
    const wf = db.prepare('select * from wallets where user_id=?').get(fromId);
    assert(wf.balance >= amount, `not enough cones: have ${wf.balance}, need ${amount}`);
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?').run(amount, amount, fromId);
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(net, net, toId);
    const cid = db.prepare('select circle_id from users where id=?').get(fromId).circle_id;
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)').run(randomUUID(), cid, fromId, toId, net, 'transfer', null, message || 'Оплата');
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)').run(randomUUID(), cid, fromId, null, fee, 'fee', null, 'Комиссия банка');
    db.prepare("update bank_account set treasury=treasury+? where id='main'").run(fee);   // комиссия в глобальную кассу банка
  });
}

// выплата из кассы банка (страховка/бонус): казна -> кошелёк, НЕ новая эмиссия
function bankPayout(childId, amount, reason) {
  return tx(() => {
    const t = db.prepare("select treasury from bank_account where id='main'").get().treasury;
    assert(t >= amount, `not enough in bank treasury: have ${t}, need ${amount}`);
    db.prepare("update bank_account set treasury=treasury-? where id='main'").run(amount);
    db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(amount, amount, childId);
    const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)').run(randomUUID(), cid, null, childId, amount, 'payout', null, reason);
  });
}

function payPremium(childId, amount = 1) {
  return tx(() => {
    assert(amount > 0, 'amount must be positive');
    const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
    const w = db.prepare('select * from wallets where user_id=?').get(childId);
    assert(w.balance >= amount, `not enough cones: have ${w.balance}, need ${amount}`);
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?').run(amount, amount, childId);
    db.prepare('update circles set insurance_fund=insurance_fund+? where id=?').run(amount, cid);
    db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)').run(randomUUID(), cid, childId, null, amount, 'insurance', null, 'Взнос в Лесную страховку');
  });
}
function fileClaim(childId, amount, reason) {
  const id = randomUUID();
  const cid = db.prepare('select circle_id from users where id=?').get(childId).circle_id;
  db.prepare('insert into proposals(id,circle_id,type,title,target_user,amount,created_by) values(?,?,?,?,?,?,?)')
    .run(id, cid, 'insurance_claim', reason, childId, amount, childId);
  return id;
}
function voteProposal(proposalId, voterId, choice) {
  const pr = db.prepare('select * from proposals where id=?').get(proposalId);
  assert(pr && pr.status === 'voting', 'voting is closed');
  db.prepare('insert or replace into votes values(?,?,?)').run(proposalId, voterId, choice);
}
function closeProposal(proposalId) {
  return tx(() => {
    const pr = db.prepare('select * from proposals where id=?').get(proposalId);
    assert(pr && pr.status === 'voting', 'proposal already closed');
    const yes = db.prepare("select count(*) c from votes where proposal_id=? and choice='yes'").get(proposalId).c;
    const no = db.prepare("select count(*) c from votes where proposal_id=? and choice='no'").get(proposalId).c;
    if (yes > no) {
      db.prepare("update proposals set status='passed' where id=?").run(proposalId);
      if (pr.type === 'insurance_claim' && pr.target_user) {
        const fund = db.prepare('select insurance_fund f from circles where id=?').get(pr.circle_id).f;
        const payout = Math.min(pr.amount, fund);
        if (payout > 0) {
          db.prepare('update circles set insurance_fund=insurance_fund-? where id=?').run(payout, pr.circle_id);
          db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(payout, payout, pr.target_user);
          db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)').run(randomUUID(), pr.circle_id, null, pr.target_user, payout, 'payout', null, 'Страховая выплата (Совет)');
        }
      }
    } else {
      db.prepare("update proposals set status='rejected' where id=?").run(proposalId);
    }
    return db.prepare('select status from proposals where id=?').get(proposalId).status;
  });
}

function createAuction(title, prizeSkin, minBid, createdBy) {
  const id = randomUUID();
  db.prepare('insert into auctions(id,title,prize_skin,min_bid,created_by) values(?,?,?,?,?)').run(id, title, prizeSkin, minBid, createdBy);
  return id;
}
function placeBid(auctionId, bidderId, amount) {
  return tx(() => {
    const a = db.prepare('select * from auctions where id=?').get(auctionId);
    assert(a && a.status === 'live', 'auction is closed');
    assert(bidderId !== a.current_leader, 'you are already the top bidder');
    assert(amount >= a.min_bid, `bid below minimum ${a.min_bid}`);
    assert(amount > a.current_bid, `bid must beat current ${a.current_bid}`);
    const w = db.prepare('select * from wallets where user_id=?').get(bidderId);
    assert(w.balance >= amount, `not enough cones: have ${w.balance}, need ${amount}`);
    if (a.current_leader) db.prepare('update wallets set balance=balance+? where user_id=?').run(a.current_bid, a.current_leader);  // возврат прежнему
    db.prepare('update wallets set balance=balance-? where user_id=?').run(amount, bidderId);   // резерв нового
    db.prepare('update auctions set current_bid=?, current_leader=? where id=?').run(amount, bidderId, auctionId);
    db.prepare('insert into bids(id,auction_id,bidder_id,amount) values(?,?,?,?)').run(randomUUID(), auctionId, bidderId, amount);
  });
}
function closeAuction(auctionId) {
  return tx(() => {
    const a = db.prepare('select * from auctions where id=?').get(auctionId);
    assert(a && a.status === 'live', 'auction already closed');
    if (a.current_leader) {
      db.prepare('update wallets set total_spent=total_spent+? where user_id=?').run(a.current_bid, a.current_leader);
      db.prepare("update bank_account set treasury=treasury+? where id='main'").run(a.current_bid);
      const cid = db.prepare('select circle_id from users where id=?').get(a.current_leader).circle_id;
      db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)').run(randomUUID(), cid, a.current_leader, null, a.current_bid, 'fee', null, 'Ставка на аукционе: ' + a.title);
      if (a.prize_skin) {
        db.prepare('insert or ignore into user_skins values(?,?)').run(a.current_leader, a.prize_skin);
        checkAchievements(a.current_leader);
      }
    }
    db.prepare("update auctions set status='closed' where id=?").run(auctionId);
  });
}

// Лесной Альбом: тёплая хроника из журнала + достижений + фотоотчётов (read-only)
function getAlbum(childId) {
  const ev = [];
  for (const t of db.prepare('select * from transactions where to_user=? or from_user=? order by rowid desc').all(childId, childId)) {
    let kind = t.type;
    if (t.type === 'reward') kind = 'earn';
    else if (t.type === 'transfer') kind = t.to_user === childId ? 'gift_in' : 'gift_out';
    else if (t.type === 'purchase') kind = 'buy';
    else if (t.type === 'fee') kind = 'spend';
    else if (t.type === 'pot_contribution') kind = 'pot';
    ev.push({ kind, title: t.message || '', amount: t.amount });
  }
  for (const ua of db.prepare('select code from user_achievements where child_id=?').all(childId))
    ev.push({ kind: 'achievement', title: db.prepare('select title from achievements where code=?').get(ua.code).title, amount: null });
  for (const t of db.prepare("select title from tasks where child_id=? and status='done' and proof_url is not null").all(childId))
    ev.push({ kind: 'photo', title: t.title, amount: null });
  return ev;
}

function startQuest(circleId, code) {
  assert(code === 'golden_cone', 'unknown quest template');
  const id = randomUUID();
  const gold = db.prepare("select id from shop_items where type='skin' and title='Золотое дерево'").get().id;
  db.prepare('insert into quests(id,circle_id,code,title,reward_cones,reward_skin) values(?,?,?,?,?,?)')
    .run(id, circleId, 'golden_cone', 'Пропала Золотая Шишка', 10, gold);
  const steps = [
    [1, 'narrative', 'Беда! Золотая Шишка исчезла из леса.', 0],
    [2, 'collect', 'Соберите 30 шишек в фонд поисков.', 30],
    [3, 'task', 'Каждый обыщет свою поляну — 3 вылазки.', 3],
    [4, 'narrative', 'След ведёт к старому дубу...', 0],
    [5, 'finale', 'Золотая Шишка найдена! Награда всем.', 0],
  ];
  for (const [o, k, t, g] of steps)
    db.prepare('insert into quest_steps(quest_id,step_order,kind,text,goal) values(?,?,?,?,?)').run(id, o, k, t, g);
  return id;
}
const curStep = (qid) => { const q = db.prepare('select current_step from quests where id=?').get(qid);
  return db.prepare('select * from quest_steps where quest_id=? and step_order=?').get(qid, q.current_step); };
function questContribute(childId, questId, amount) {
  return tx(() => {
    assert(amount > 0, 'amount must be positive');
    const q = db.prepare('select * from quests where id=?').get(questId);
    assert(q && q.status === 'active', 'quest not active');
    const st = curStep(questId);
    assert(st.kind === 'collect', 'current step is not a collect step');
    const w = db.prepare('select * from wallets where user_id=?').get(childId);
    assert(w.balance >= amount, `not enough cones: have ${w.balance}, need ${amount}`);
    db.prepare('update wallets set balance=balance-?, total_spent=total_spent+? where user_id=?').run(amount, amount, childId);
    db.prepare('update quests set fund=fund+? where id=?').run(amount, questId);
    db.prepare('update quest_steps set progress=progress+? where quest_id=? and step_order=?').run(amount, questId, q.current_step);
  });
}
function questAction(childId, questId) {
  const q = db.prepare('select * from quests where id=?').get(questId);
  assert(q && q.status === 'active', 'quest not active');
  const st = curStep(questId);
  assert(st.kind === 'task', 'current step is not a task step');
  db.prepare('update quest_steps set progress=progress+1 where quest_id=? and step_order=?').run(questId, q.current_step);
}
function advanceQuest(questId) {
  return tx(() => {
    let q = db.prepare('select * from quests where id=?').get(questId);
    assert(q && q.status === 'active', 'quest not active');
    const st = curStep(questId);
    assert(st.kind === 'narrative' || st.progress >= st.goal, `current step not complete (${st.progress}/${st.goal})`);
    db.prepare('update quest_steps set done=1 where quest_id=? and step_order=?').run(questId, q.current_step);
    db.prepare('update quests set current_step=current_step+1 where id=?').run(questId);
    q = db.prepare('select * from quests where id=?').get(questId);
    const nxt = curStep(questId);
    if (nxt.kind === 'finale') {
      for (const r of db.prepare("select id from users where circle_id=? and role='child'").all(q.circle_id)) {
        db.prepare('update wallets set balance=balance+?, total_earned=total_earned+? where user_id=?').run(q.reward_cones, q.reward_cones, r.id);
        db.prepare('insert into transactions values(?,?,?,?,?,?,?,?)').run(randomUUID(), q.circle_id, null, r.id, q.reward_cones, 'reward', questId, 'Награда квеста: ' + q.title);
        if (q.reward_skin) db.prepare('insert or ignore into user_skins values(?,?)').run(r.id, q.reward_skin);
        checkAchievements(r.id);
      }
      db.prepare('update quest_steps set done=1 where quest_id=? and step_order=?').run(questId, q.current_step);
      db.prepare("update quests set status='completed' where id=?").run(questId);
    }
  });
}

// ── помощники ────────────────────────────────────────────────────────
const mkCircle = (name) => { const id = randomUUID();
  db.prepare('insert into circles(id,name,invite_code) values(?,?,?)').run(id, name, name.slice(0, 4) + '-' + id.slice(0, 4)); return id; };
const mkUser = (cid, role, name) => { const id = randomUUID();
  db.prepare('insert into users(id,circle_id,role,name) values(?,?,?,?)').run(id, cid, role, name);
  if (role === 'child') db.prepare('insert into wallets(user_id) values(?)').run(id); return id; };
const mkTask = (cid, child, title, reward, cat, photo = 0) => { const id = randomUUID();
  db.prepare('insert into tasks(id,circle_id,child_id,title,reward,category,needs_photo) values(?,?,?,?,?,?,?)')
    .run(id, cid, child, title, reward, cat, photo); return id; };
const bal = (u) => db.prepare('select * from wallets where user_id=?').get(u);

// ── сид каталога ─────────────────────────────────────────────────────
const catalog = JSON.parse(readFileSync(new URL('../content/catalog.json', import.meta.url)));
for (const g of catalog.gifts)
  db.prepare('insert into shop_items(id,circle_id,type,title,price,category) values(?,?,?,?,?,?)')
    .run(randomUUID(), null, 'impression', g.title, g.price, g.category);
for (const t of catalog.tasks)
  db.prepare('insert into task_templates(id,title,reward,category,is_daily,needs_photo) values(?,?,?,?,?,?)')
    .run(randomUUID(), t.title, t.reward, t.category, t.daily ? 1 : 0, t.photo ? 1 : 0);
for (const s of catalog.skins)
  db.prepare('insert into shop_items(id,circle_id,type,title,price,rarity,season) values(?,?,?,?,?,?,?)')
    .run(randomUUID(), null, 'skin', s.title, s.price, s.rarity, s.season || null);
for (const h of catalog.horoscopes)
  db.prepare('insert into horoscope_texts values(?,?)').run(randomUUID(), h);
for (const a of catalog.achievements)
  db.prepare('insert into achievements values(?,?,?,?,?,?,?)')
    .run(a.code, a.title, a.desc, a.metric, a.threshold, a.tier, a.reward);
console.log(`сид: подарков=${db.prepare('select count(*) c from shop_items').get().c}, шаблонов заданий=${db.prepare('select count(*) c from task_templates').get().c}`);

// ── сценарий петли ───────────────────────────────────────────────────
const circle = mkCircle('Семья Петровых');
const mom = mkUser(circle, 'parent', 'Мама');
const kolya = mkUser(circle, 'child', 'Коля');
const olya = mkUser(circle, 'child', 'Оля');

// 3 задания Коле из каталога
const roomTask = mkTask(circle, kolya, 'Убрать комнату', 15, 'дом', 1);
const dishTask = mkTask(circle, kolya, 'Помыть посуду', 12, 'дом', 0);
const bookTask = mkTask(circle, kolya, 'Почитать книгу 20 минут', 20, 'развитие', 0);

// петля: выполнить -> подтвердить
submitTask(roomTask, 'photo://room.jpg'); approveTask(roomTask);   // +15
submitTask(dishTask); approveTask(dishTask);                       // +12
submitTask(bookTask); approveTask(bookTask);                       // +20
console.log(`Коля заработал заданиями: balance=${bal(kolya).balance} (ожидаем 47)`);
assert.equal(bal(kolya).balance, 47);

// покупка приза «Мороженое» (35)
const iceCream = db.prepare("select * from shop_items where title like 'Мороженое%'").get();
purchaseItem(kolya, iceCream.id);
console.log(`после покупки «${iceCream.title}» (${iceCream.price}): balance=${bal(kolya).balance} (ожидаем 12)`);
assert.equal(bal(kolya).balance, 47 - 35);

// подарок Оле 10 шишек
transferCones(kolya, olya, 10, 'Держи, сестрёнка!');
console.log(`после подарка Оле 10: Коля=${bal(kolya).balance}, Оля=${bal(olya).balance}`);
assert.equal(bal(kolya).balance, 2);
assert.equal(bal(olya).balance, 10);

// негативные проверки: нельзя купить/перевести сверх баланса
assert.throws(() => purchaseItem(kolya, iceCream.id), /not enough cones/);
assert.throws(() => transferCones(kolya, olya, 999), /not enough cones/);
assert.throws(() => submitTask(roomTask), /not submittable/); // уже done

// ── Фаза 2: Дупло-сейф (депозит под процент) ─────────────────────────
console.log('\n── Фаза 2: Дупло-сейф + репутация/бейджи ──');
// неверный срок и сумма сверх баланса — отбиваются
assert.throws(() => openSafe(olya, 10, 5), /invalid term/);
assert.throws(() => openSafe(olya, 999, 30), /not enough cones/);

// Оля кладёт 10 шишек в Дупло на 30 дней (20%)
const safe = openSafe(olya, 10, 30);
console.log(`Оля открыла Дупло 10 на 30д: balance=${bal(olya).balance} (ожидаем 0, заморожено 10)`);
assert.equal(bal(olya).balance, 0);
// досрочно снять нельзя
assert.throws(() => redeemSafe(safe), /no early withdrawal/);

// промотка времени: срок Дупла истёк
db.prepare('update safes set unlock_date=? where id=?').run(Date.now() - 1000, safe);
redeemSafe(safe);
console.log(`после срока Оля забрала Дупло: balance=${bal(olya).balance} (ожидаем 12 = 10 + 20%)`);
assert.equal(bal(olya).balance, 12);                 // тело 10 + процент 2
assert.throws(() => redeemSafe(safe), /already redeemed/);

// репутация «Лесного паспорта»
const rep = (u) => JSON.parse(db.prepare('select reputation from users where id=?').get(u).reputation);
console.log('Коля:', rep(kolya), '| Оля:', rep(olya));
assert.equal(rep(kolya).honesty, 3);        // 3 выполненных задания
assert.equal(rep(kolya).generosity, 1);     // 1 подарок
assert.equal(rep(olya).wisdom, 1);          // открыл депозит
assert.equal(rep(olya).reliability, 1);     // дождался срока

// бейджи выдаются по порогам, не раньше
const hasBadge = (u, t) => !!db.prepare('select 1 from user_achievements where child_id=? and code=?').get(u, t);
assert.equal(hasBadge(olya, 'depc_2'), false);        // Хранитель: нужно 3 закрытых Дупла, есть 1
assert.equal(hasBadge(kolya, 'gift_2'), false);       // Меценат: подарил 10 < 50

// ── Удержание: стрик-полив, рост дерева, дневной квест, шишечный дождь ──
console.log('\n── Удержание: стрик-полив + дневной квест ──');
const dasha = mkUser(circle, 'child', 'Даша');
let v;
for (let day = 1; day <= 7; day++) v = dailyVisit(dasha, day);   // 7 дней подряд
console.log(`Даша 7 дней подряд: streak=${v.streak}, дерево=${v.tree_level}`);
assert.equal(v.streak, 7);
assert.equal(v.tree_level, 3);                 // серия 7 -> дерево уровня 3

const again = dailyVisit(dasha, 7);            // повторный заход в тот же день
assert.equal(again.first_today, false);
assert.equal(again.streak, 7);                 // серию не двигает

const after = dailyVisit(dasha, 10);           // пропущены дни 8-9
console.log(`после пропуска (день 10): streak=${after.streak}, дерево=${after.tree_level} (держится)`);
assert.equal(after.streak, 1);                 // серия сброшена
assert.equal(after.tree_level, 3);             // дерево НЕ деградировало (метафора «не умирает»)
assert.equal(db.prepare('select longest_streak l from users where id=?').get(dasha).l, 7);

const dq = getDailyQuest(dasha, 10);
assert.equal(getDailyQuest(dasha, 10).id, dq.id);   // ровно один квест на день
completeDailyQuest(dq.id);
assert.throws(() => completeDailyQuest(dq.id), /already done/);
console.log(`квест дня: «${dq.title}» +${dq.reward} — выполнен, повтор отбит`);

const rainTotal = db.prepare("select coalesce(sum(amount),0) s from transactions where message='Шишечный дождь'").get().s;
console.log(`шишечного дождя за 7 заходов нападало суммарно: ${rainTotal} (случайно, ~30% шанс/день)`);

// дождик-защитник спасает серию при пропуске 1 дня
const dt = mkTask(circle, dasha, 'Большая помощь по дому', 30, 'дом');
submitTask(dt); approveTask(dt);                 // Даше +30 (хватит на дождик)
buyStreakFreeze(dasha);                           // -20, +1 дождик
assert.equal(db.prepare('select streak_freezes f from users where id=?').get(dasha).f, 1);
dailyVisit(dasha, 11);                             // день 11: серия 1 -> 2
const saved = dailyVisit(dasha, 13);              // пропущен день 12 — дождик спасает
console.log(`дождик: день 13 после пропуска — streak=${saved.streak}, freeze_used=${saved.freeze_used}`);
assert.equal(saved.freeze_used, true);
assert.equal(saved.streak, 3);                     // серия НЕ прервалась
assert.equal(db.prepare('select streak_freezes f from users where id=?').get(dasha).f, 0); // дождик потрачен

// достижения-вехи выдаются по порогам
const hasB = (u, t) => !!db.prepare('select 1 from user_achievements where child_id=? and code=?').get(u, t);
assert.equal(hasB(dasha, 'streak_2'), true);         // Неделя в лесу: серия достигала 7
assert.equal(hasB(dasha, 'streak_4'), false);        // Хозяин леса (30) — не дотянула
assert.equal(hasB(kolya, 'work_3'), false);          // Работяга (10 заданий) — у Коли 3
console.log('достижения Даши:', db.prepare('select code from user_achievements where child_id=?').all(dasha).map(r => r.code));

// ── Коллекции скинов: покупка (владение) + надевание ──────────────────
console.log('\n── Коллекции скинов ──');
const st = mkTask(circle, dasha, 'Заработок на скин', 50, 'дом');
submitTask(st); approveTask(st);                       // Даше +50 на скин
const autumnSkin = db.prepare("select * from shop_items where type='skin' and title like 'Осеннее%'").get();
purchaseSkin(dasha, autumnSkin.id);
assert.throws(() => purchaseSkin(dasha, autumnSkin.id), /already owned/);   // дважды нельзя
equipSkin(dasha, autumnSkin.id);                       // надел купленный
assert.equal(db.prepare('select avatar_skin a from users where id=?').get(dasha).a, autumnSkin.id);
const goldSkin = db.prepare("select * from shop_items where type='skin' and title like 'Золотое%'").get();
assert.throws(() => equipSkin(dasha, goldSkin.id), /not owned/);            // невладеемый rare — нельзя
const baseSkin = db.prepare("select * from shop_items where type='skin' and rarity='base'").get();
equipSkin(dasha, baseSkin.id);                         // базовый образ — без покупки
console.log(`Даша купила и надела «${autumnSkin.title}»; золотое надеть нельзя (не куплено); базовое — можно`);
console.log(`инвентарь Даши:`, db.prepare('select title from user_skins join shop_items on skin_id=id where user_id=?').all(dasha).map(r => r.title));

// ── Общий котёл: совместная семейная цель ─────────────────────────────
console.log('\n── Общий котёл ──');
const pot = createPot(circle, 'Пицца-пати', 20);
contributePot(olya, pot, 12);                       // Оля вкладывает всё
const potState = contributePot(dasha, pot, 8);      // Даша добивает до цели
console.log(`котёл «Пицца-пати»: собрано ${potState.collected}/${potState.goal}, статус=${potState.status}`);
assert.equal(potState.collected, 20);
assert.equal(potState.status, 'reached');
assert.equal(bal(olya).balance, 0);
assert.throws(() => contributePot(kolya, pot, 999), /not enough cones/);
fulfillPot(pot);                                     // родитель исполняет цель
assert.throws(() => contributePot(dasha, pot, 1), /already fulfilled/);
console.log('котёл исполнен родителем — шишки ушли на реальную цель (пиццу)');

// ── Лесной гороскоп: ежедневное предсказание от Духа ──────────────────
console.log('\n── Лесной гороскоп ──');
const horo = getDailyHoroscope(dasha, 20);
console.log(`гороскоп Даши: «${horo.text}»${horo.bonus ? ` (+${horo.bonus} счастливых шишек)` : ''}`);
assert(horo.text && horo.text.length > 0, 'гороскоп без текста');
assert.equal(getDailyHoroscope(dasha, 20).id, horo.id);   // одно предсказание на день

// ── Сезонные события: модификаторы механик ────────────────────────────
console.log('\n── Сезонные события ──');
assert.equal(eventMultiplier(circle, 'task_reward'), 1);        // без событий — нейтрально
startEvent(circle, 'fair', 'Лесная ярмарка', { task_reward: 2 }, 7);
const ft = mkTask(circle, dasha, 'Ярмарочное задание', 20, 'дом');
submitTask(ft); approveTask(ft);
const lastRew = db.prepare("select amount a from transactions where to_user=? and type='reward' order by rowid desc limit 1").get(dasha).a;
console.log(`Ярмарка (задания х2): задание 20 → начислено ${lastRew}`);
assert.equal(lastRew, 40);
assert.equal(eventMultiplier(circle, 'task_reward'), 2);

startEvent(circle, 'autumn', 'Золотая осень', { safe_interest: 2 }, 7);
const as2 = openSafe(dasha, 30, 3);                            // 3д = 5%
db.prepare('update safes set unlock_date=? where id=?').run(Date.now() - 1000, as2);
const b0 = bal(dasha).balance;
redeemSafe(as2);
const gained = bal(dasha).balance - b0;
console.log(`Осень (Дупло х2): 30 шишек (5%) вернулось ${gained} (тело 30 + процент 3)`);
assert.equal(gained, 33);                                      // 30 + round(30*5%*2)=3

const n = triggerConeRain(circle, 2);
console.log(`Шишечный дождь для всех: осыпано детей = ${n}`);
assert.equal(n, 3);                                            // Коля, Оля, Даша

// ── Достижения: data-driven реестр с прогрессом и уровнями ────────────
console.log('\n── Достижения ──');
const totalAch = db.prepare('select count(*) c from achievements').get().c;
console.log(`всего достижений в игре: ${totalAch}`);
assert.equal(totalAch, 111);
const dashaAch = db.prepare('select code from user_achievements where child_id=?').all(dasha).map(r => r.code);
console.log(`открыто у Даши (${dashaAch.length}):`, dashaAch);
assert(dashaAch.includes('streak_2'), 'серия 7 → Неделя в лесу');
assert(dashaAch.includes('dep_1'), 'открыла Дупло → Осторожный');
assert(dashaAch.includes('pot_1'), 'вклад в котёл → Друг семьи');
assert.equal(hasB(dasha, 'work_3'), false);   // многоуровневость: <10 заданий
// прогресс к незакрытому (для экрана достижений)
const doneTasks = achievementMetric(dasha, 'tasks_done');
console.log(`прогресс Даши к «Работяга»: ${doneTasks}/10`);
// tier-структура присутствует
const tiers = db.prepare('select distinct tier from achievements order by tier').all().map(r => r.tier);
assert.deepEqual(tiers, [1, 2, 3]);
console.log(`уровни достижений: I/II/III (${tiers.join('/')})`);

// ── Лавки-мастерские: детский бизнес с эскроу ─────────────────────────
console.log('\n── Лавки-мастерские ──');
const kt = mkTask(circle, kolya, 'Заработок на покупку', 20, 'дом');
submitTask(kt); approveTask(kt);                    // Коля +40 (Ярмарка х2)
openShop(dasha, 'Мастерская Даши', 'Браслеты и поделки');
assert.throws(() => openShop(dasha, 'Вторая', null), /already has a shop/);
const lot = addLot(dasha, 'Браслет дружбы', 'goods', 15);
assert.throws(() => reserveLot(dasha, lot), /own shop/);   // свой лот купить нельзя
const kB = bal(kolya).balance;
const order = reserveLot(kolya, lot);
console.log(`Коля зарезервировал «Браслет дружбы» (15): ${kB} → ${bal(kolya).balance} (эскроу)`);
assert.equal(bal(kolya).balance, kB - 15);
const dB = bal(dasha).balance;
confirmOrder(order);
console.log(`сделка подтверждена: Даша получила 15 (${dB} → ${bal(dasha).balance})`);
assert.equal(bal(dasha).balance, dB + 15);
// отмена возвращает эскроу-шишки покупателю
const lot2 = addLot(dasha, 'Весёлый фокус', 'service', 10);
const order2 = reserveLot(kolya, lot2);
const kM = bal(kolya).balance;
cancelOrder(order2);
assert.equal(bal(kolya).balance, kM + 10);
assert.throws(() => confirmOrder(order2), /not reservable/);   // отменённый не подтвердить
console.log('отмена вернула эскроу; отменённый заказ подтвердить нельзя');

// ── Гильдии: совместный заказ с распределением по долям ───────────────
console.log('\n── Гильдии ──');
const guild = createGuild(kolya, 'Лесные мастера', 2);
joinGuild(guild, olya, 1);
joinGuild(guild, dasha, 1);                         // доли 2:1:1
const gk = bal(kolya).balance, go = bal(olya).balance, gd = bal(dasha).balance;
completeGuildOrder(guild, 100);                     // 100 шишек по долям
console.log(`заказ 100 разделён: Коля +${bal(kolya).balance - gk}, Оля +${bal(olya).balance - go}, Даша +${bal(dasha).balance - gd}`);
assert.equal(bal(kolya).balance - gk, 50);          // 2/4
assert.equal(bal(olya).balance - go, 25);           // 1/4
assert.equal(bal(dasha).balance - gd, 25);          // 1/4
assert.throws(() => completeGuildOrder(guild, 50), /already closed/);
console.log('доли сошлись точно (50+25+25=100), повторный заказ закрыт');

// ── Лесная почта: эмоции/стикеры/аудио + «Шёпот леса» ─────────────────
console.log('\n── Лесная почта ──');
sendMessage(olya, kolya, 'emoji', '🌲');
sendMessage(dasha, kolya, 'sticker', 'sticker_acorn');
const inbox = getInbox(kolya);
console.log(`входящих у Коли: ${inbox.length}`);
assert.equal(inbox.length, 2);
assert(inbox.some((m) => m.content === '🌲'));
// «Шёпот леса» — отложенное голосовое от мамы, не появляется сразу
const wh = sendWhisper(mom, dasha, 'audio://обнимашки.mp3', 6);
assert.equal(getInbox(dasha).length, 0);            // ещё не доставлено
db.prepare('update messages set deliver_at=? where id=?').run(Date.now() - 1000, wh);
assert.equal(getInbox(dasha).length, 1);            // время пришло — появилось
console.log('«Шёпот леса» появился только после задержки');
// прочтение
markRead(inbox[0].id);
assert(db.prepare('select read_at from messages where id=?').get(inbox[0].id).read_at, 'помечено прочитанным');

// ── Оплата с комиссией банка vs подарок без комиссии ──────────────────
console.log('\n── Оплата (комиссия) vs подарок (без комиссии) ──');
const pkb = bal(kolya).balance, pob = bal(olya).balance;
payCones(kolya, olya, 10, 'За весёлый фокус');
console.log(`оплата 10: Коля -${pkb - bal(kolya).balance}, Оля +${bal(olya).balance - pob}, банк удержал 1`);
assert.equal(pkb - bal(kolya).balance, 10);         // с отправителя полные 10
assert.equal(bal(olya).balance - pob, 9);            // получателю 9 (1 комиссия сгорела)
assert.throws(() => payCones(kolya, olya, 1, 'мало'), /exceed/);   // меньше комиссии нельзя
const gob = bal(olya).balance, gGen = JSON.parse(db.prepare('select reputation from users where id=?').get(kolya).reputation).generosity;
transferCones(kolya, olya, 3, 'от души');           // подарок — без комиссии
assert.equal(bal(olya).balance - gob, 3);            // 1:1, комиссии нет
const gGen2 = JSON.parse(db.prepare('select reputation from users where id=?').get(kolya).reputation).generosity;
assert.equal(gGen2, gGen + 1);                       // подарок растит щедрость, оплата — нет
console.log('подарок 1:1 без комиссии и растит Щедрость; оплата берёт комиссию и щедрость не трогает');
// ГЛОБАЛЬНАЯ касса банка-оператора накопила комиссию
const treas0 = db.prepare("select treasury t from bank_account where id='main'").get().t;
console.log(`касса банка-оператора (глобальная): ${treas0} шишек (комиссии со всех семей)`);
assert(treas0 >= 1);
// выплата из кассы банка (напр. страховка/услуга) — берётся из казны, не эмитируется
const payB = bal(olya).balance;
bankPayout(olya, 1, 'Страховая выплата');
assert.equal(bal(olya).balance - payB, 1);
assert.equal(db.prepare("select treasury t from bank_account where id='main'").get().t, treas0 - 1);
console.log('выплата из кассы банка: касса −1, ребёнку +1 (не новая эмиссия)');

// ── Лесная страховка + Лесной Совет (голосования) ─────────────────────
console.log('\n── Лесная страховка + Лесной Совет ──');
payPremium(kolya, 1); payPremium(olya, 1); payPremium(dasha, 1);   // все скидываются
const fund0 = db.prepare('select insurance_fund f from circles where id=?').get(circle).f;
console.log(`страховой фонд семьи: ${fund0} шишки`);
assert.equal(fund0, 3);
const claim = fileClaim(olya, 3, 'Прогорела на неудачной сделке');   // Оля в беде
voteProposal(claim, kolya, 'yes');                                  // Совет голосует
voteProposal(claim, dasha, 'yes');
const insB = bal(olya).balance;
const res = closeProposal(claim);
console.log(`Совет решил: ${res}; Оля получила из фонда ${bal(olya).balance - insB}`);
assert.equal(res, 'passed');
assert.equal(bal(olya).balance - insB, 3);
assert.equal(db.prepare('select insurance_fund f from circles where id=?').get(circle).f, 0);
assert.throws(() => closeProposal(claim), /already closed/);
// отклонение: если «против» больше — выплаты нет
payPremium(kolya, 1);
const claim2 = fileClaim(kolya, 1, 'сомнительная заявка');
voteProposal(claim2, olya, 'no'); voteProposal(claim2, dasha, 'no');
assert.equal(closeProposal(claim2), 'rejected');
console.log('страховая выплата — по решению Совета (равный голос); отклонённая заявка без выплаты');

// ── Лесной аукцион: ставки с эскроу, победитель платит в кассу банка ───
console.log('\n── Лесной аукцион ──');
[[olya, 15], [kolya, 10], [dasha, 10]].forEach(([kid, r]) => {   // топ-ап ставщиков
  const t = mkTask(circle, kid, 'на аукцион', r, 'дом'); submitTask(t); approveTask(t);
});
const prizeGold = db.prepare("select id from shop_items where type='skin' and title like 'Золотое%'").get().id;
const auc = createAuction("Золотая шишка", prizeGold, 5, mom);   // админ выставляет супер-лот
placeBid(auc, kolya, 10);
placeBid(auc, dasha, 15);                        // Коле возврат 10
placeBid(auc, olya, 20);                         // Даше возврат 15
const treB = db.prepare("select treasury t from bank_account where id='main'").get().t;
const kolB = bal(kolya).balance, dasB = bal(dasha).balance;
closeAuction(auc);
console.log('аукцион закрыт: Оля выиграла (20), шишки в кассу банка, приз — Золотое дерево');
assert.equal(db.prepare("select treasury t from bank_account where id='main'").get().t, treB + 20);
assert(db.prepare('select 1 from user_skins where user_id=? and skin_id=?').get(olya, prizeGold), 'приз победителю');
assert.equal(bal(kolya).balance, kolB);          // проигравшим эскроу вернулся при перебивке
assert.equal(bal(dasha).balance, dasB);
console.log('победитель заплатил в кассу банка; проигравшие ничего не потеряли');

// ── Лесной Альбом: хроника жизни из журнала транзакций ────────────────
console.log('\n── Лесной Альбом (хроника) ──');
const album = getAlbum(kolya);
const kinds = [...new Set(album.map((e) => e.kind))];
console.log(`событий в альбоме Коли: ${album.length}; типы: ${kinds.join(', ')}`);
assert(album.length > 0, 'альбом не пустой');
assert(kinds.includes('earn'), 'есть заработки');
assert(kinds.includes('buy'), 'есть покупки');
assert(kinds.includes('achievement'), 'есть достижения');
assert(album.some((e) => e.kind === 'earn' && e.amount > 0), 'первые заработанные шишки');
console.log(`пример события: «${album[0].title || album[0].kind}»`);

// ── Нарративный квест «Золотая Шишка» (многошаговая история) ──────────
console.log('\n── Нарративный квест: Золотая Шишка ──');
const quest = startQuest(circle, 'golden_cone');
advanceQuest(quest);                                 // шаг 1 (нарратив) → шаг 2 (сбор)
assert.throws(() => advanceQuest(quest), /not complete/);   // фонд ещё не собран
questContribute(kolya, quest, 15);
questContribute(dasha, quest, 15);                   // фонд поисков = 30
advanceQuest(quest);                                 // → шаг 3 (личные вылазки)
questAction(kolya, quest); questAction(olya, quest); questAction(dasha, quest);
advanceQuest(quest);                                 // → шаг 4 (нарратив)
const qkb = bal(kolya).balance, qob = bal(olya).balance, qdb = bal(dasha).balance;
advanceQuest(quest);                                 // → шаг 5 (финал) → награда всем
const qq = db.prepare('select * from quests where id=?').get(quest);
console.log(`квест «${qq.title}»: ${qq.status}, фонд поисков ${qq.fund}`);
assert.equal(qq.status, 'completed');
assert.equal(bal(kolya).balance - qkb, 10);          // награда каждому искателю
assert.equal(bal(olya).balance - qob, 10);
assert.equal(bal(dasha).balance - qdb, 10);
assert(db.prepare('select 1 from user_skins where user_id=? and skin_id=?').get(kolya, qq.reward_skin), 'приз-скин всем');
console.log('история пройдена: собрали фонд, обыскали поляны, нашли Шишку — награда и скин всем');

// ── инварианты целостности (с учётом заморозки в сейфах) ──────────────
const frozenOf = (u) =>
  db.prepare("select coalesce(sum(amount),0) s from safes where user_id=? and status='locked'").get(u).s;
const reservedOf = (u) =>
  db.prepare("select coalesce(sum(price),0) s from orders where buyer_id=? and status='reserved'").get(u).s;
const reservedBidOf = (u) =>
  db.prepare("select coalesce(sum(current_bid),0) s from auctions where status='live' and current_leader=?").get(u).s;
const wallets = db.prepare('select * from wallets').all();
for (const w of wallets)
  assert.equal(w.balance, w.total_earned - w.total_spent - frozenOf(w.user_id) - reservedOf(w.user_id) - reservedBidOf(w.user_id),
    `инвариант balance у ${w.user_id}`);

const sum = (t) => db.prepare('select coalesce(sum(amount),0) s from transactions where type=?').get(t).s;
const emit = sum('reward'), burn = sum('purchase'), interest = sum('interest');
const totalBal = db.prepare('select coalesce(sum(balance),0) s from wallets').get().s;
const totalFrozen = db.prepare("select coalesce(sum(amount),0) s from safes where status='locked'").get().s;
const openPot = db.prepare("select coalesce(sum(collected),0) s from pots where status<>'fulfilled'").get().s;
const spentPot = db.prepare("select coalesce(sum(collected),0) s from pots where status='fulfilled'").get().s;
console.log(`\nэмиссия=${emit}, сожжено=${burn}, проценты=${interest}, заморожено=${totalFrozen}, в котлах=${openPot}, потрачено котлами=${spentPot}`);
const reserved = db.prepare("select coalesce(sum(price),0) s from orders where status='reserved'").get().s;
const treasury = db.prepare("select coalesce(treasury,0) s from bank_account where id='main'").get().s;
const insFund = db.prepare('select coalesce(sum(insurance_fund),0) s from circles').get().s;
const reservedBid = db.prepare("select coalesce(sum(current_bid),0) s from auctions where status='live' and current_leader is not null").get().s;
const questFund = db.prepare("select coalesce(sum(fund),0) s from quests where status='active'").get().s;
const questSpent = db.prepare("select coalesce(sum(fund),0) s from quests where status='completed'").get().s;
const left = totalBal + totalFrozen + openPot + reserved + treasury + insFund + reservedBid + questFund;
const right = emit - burn - spentPot - questSpent + interest;
console.log(`кошельки+сейфы+котлы+эскроу+касса(${treasury})+страхфонд(${insFund})+квест(${questFund})=${left}; эмиссия-сожжено-котлы-квест+проценты=${right}`);
assert.equal(left, right,
  'глобально: все кошельки + все пулы = эмиссия - сожжённое - потраченное котлами/квестами + проценты');

console.log('\n✓ Все проверки петли Фаз 1-2 и инварианты целостности прошли');
