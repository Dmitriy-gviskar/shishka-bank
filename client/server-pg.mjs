// Node-прокси Шишка Банк → PostgreSQL (прод-схема + функции).
// Кластеризация: master форкает N воркеров (по числу ядер), каждый на своём event loop.
// Rate-limit — per-worker (достаточно для детского приложения).
// Запуск: DATABASE_URL="postgres://..." PARENT_PIN=1234 node server-pg.mjs
import { createServer } from 'node:http';
import cluster from 'node:cluster';
import { WebSocketServer } from 'ws';


import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { randomInt } from 'node:crypto';
import { makeAuth } from './lib/auth.mjs';
import { SEC, serveStatic, readBody, json, logError } from './lib/http.mjs';
import { routesGames } from './routes/games.mjs';
import { routesParent } from './routes/parent.mjs';
import { routesCards } from './routes/cards.mjs';

// Код входа ребёнка: криптослучайный, из алфавита без двусмысленных символов (нет 0/O/1/I/L).
// Раньше был предсказуемым (ИМЯ+порядковый номер) и ломался на букве Ё — теперь развязан от имени.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genLoginCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
const REF_L1 = 100;  // ты позвал друга → он посадил дерево
const REF_L2 = 50;   // твой друг позвал своего → тебе +50
const REF_L3 = 25;   // друг друга позвал ещё кого-то → тебе +25
const REF_PAY = { 1: REF_L1, 2: REF_L2, 3: REF_L3 };


async function creditCones(userId, amount, message) {
  await q('update wallets set balance=balance+$2, total_earned=total_earned+$2 where user_id=$1', [userId, amount]);
  await q(
    `insert into transactions(circle_id, to_user, amount, type, message)
       select circle_id, $1, $2, 'reward', $3 from users where id=$1`,
    [userId, amount, message]);
}

// Дружба: в семье — авто; между кругами — заявка по коду с поляны (referral_code).
async function areFriends(a, b) {
  const r = await one(
    `select 1 as x from friendships
      where user_id=$1 and friend_id=$2 and status='accepted'`, [a, b]);
  return !!r;
}
async function assertFriend(a, b, msg = 'сначала добавь в друзья') {
  if (!(await areFriends(a, b))) throw { code: 403, msg };
}
// Письмо обитателю: заявка уходит сама, дружба не принимается. Карты/шишки по-прежнему после «Принять».
async function ensureForestTalk(from, to) {
  if (!to || from === to) throw { code: 400, msg: 'выбери, кому отправить' };
  const peer = await one("select id, name from users where id=$1 and role='child'", [to]);
  if (!peer) throw { code: 400, msg: 'друг не найден' };
  const existing = await one(
    `select status from friendships where user_id=$1 and friend_id=$2`, [from, to]);
  if (existing?.status === 'accepted') return { peer, friends: true };
  const reverse = await one(
    `select status from friendships where user_id=$1 and friend_id=$2`, [to, from]);
  if (reverse?.status === 'accepted') {
    await linkFriends(from, to);
    return { peer, friends: true };
  }
  if (!existing) {
    const todayN = await one(
      `select count(*)::int as n from friendships
        where user_id=$1 and status='pending'
          and created_at >= date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'`,
      [from]);
    if ((todayN?.n || 0) < 12) {
      await q(
        `insert into friendships(user_id, friend_id, status) values ($1,$2,'pending')
         on conflict (user_id, friend_id) do nothing`,
        [from, to]);
    }
  }
  return { peer, friends: false };
}
async function linkFriends(a, b) {
  if (!a || !b || a === b) return;
  await q(
    `insert into friendships(user_id, friend_id, status) values ($1,$2,'accepted'), ($2,$1,'accepted')
     on conflict (user_id, friend_id) do update set status='accepted'`,
    [a, b]);
}
// Код с поляны (им делятся) или код входа — без фильтра круга.
async function findChildByFriendCode(code) {
  const c = String(code || '').toUpperCase().trim();
  if (c.length < 4) return null;
  const byRef = await one(
    `select id, name, circle_id from users where referral_code=$1 and role='child'`, [c]);
  if (byRef) return byRef;
  return one(
    `select u.id, u.name, u.circle_id from child_logins cl
       join users u on u.id=cl.child_id
      where cl.code=$1 and u.role='child'`, [c]);
}
async function linkChildToCircleFriends(childId, circleId) {
  const peers = await q(
    "select id from users where circle_id=$1 and role='child' and id<>$2",
    [circleId, childId]);
  for (const p of peers) await linkFriends(childId, p.id);
}

async function payReferralLevel(beneficiaryId, sourceUserId, level, amount, message) {
  const row = await one(
    `insert into referral_rewards(beneficiary_id, source_user_id, level, amount)
       values ($1,$2,$3,$4)
       on conflict (beneficiary_id, source_user_id, level) do nothing
       returning id`,
    [beneficiaryId, sourceUserId, level, amount]);
  if (!row) return false;
  await creditCones(beneficiaryId, amount, message);
  return true;
}

async function ensureReferralCode(childId) {
  const cur = await one('select referral_code from users where id=$1', [childId]);
  if (cur?.referral_code) return cur.referral_code;
  for (let i = 0; i < 10; i++) {
    const code = genLoginCode();
    try {
      const row = await one(
        `update users set referral_code=$1 where id=$2 and referral_code is null returning referral_code`,
        [code, childId]);
      if (row?.referral_code) return row.referral_code;
      const again = await one('select referral_code from users where id=$1', [childId]);
      if (again?.referral_code) return again.referral_code;
    } catch { /* unique collision — ещё раз */ }
  }
  throw { code: 500, msg: 'не удалось выдать код приглашения' };
}

async function applyReferral(referrerCode, newChildId, newName) {
  const ref = String(referrerCode || '').toUpperCase().trim();
  if (!ref || ref.length < 4) return null;
  const referrer = await one(
    `select id, name, referred_by from users where referral_code=$1 and role='child'`, [ref]);
  if (!referrer || referrer.id === newChildId) return null;
  const ins = await one(
    `insert into referrals(referrer_id, referred_id, reward)
       values ($1,$2,$3)
       on conflict (referred_id) do nothing
       returning id`,
    [referrer.id, newChildId, REF_L1]);
  if (!ins) return null;
  await q('update users set referred_by=$1 where id=$2 and referred_by is null', [referrer.id, newChildId]);
  await linkFriends(referrer.id, newChildId);

  // Цепочка вверх: L1 = прямой зовущий, L2/L3 = кто привёл его / того
  const chain = [referrer];
  let cursor = referrer.referred_by;
  const seen = new Set([referrer.id, newChildId]);
  while (cursor && chain.length < 3 && !seen.has(cursor)) {
    seen.add(cursor);
    const up = await one(`select id, name, referred_by from users where id=$1 and role='child'`, [cursor]);
    if (!up) break;
    chain.push(up);
    cursor = up.referred_by;
  }

  const msgs = {
    1: `Друг ${newName} посадил дерево!`,
    2: `Друг ${referrer.name} привёл ${newName}!`,
    3: `В твоей поляне новый росток: ${newName}!`,
  };
  const paid = {};
  for (let i = 0; i < chain.length; i++) {
    const level = i + 1;
    const amount = REF_PAY[level];
    if (!amount) continue;
    const ok = await payReferralLevel(chain[i].id, newChildId, level, amount, msgs[level]);
    if (ok) {
      paid[level] = { name: chain[i].name, reward: amount };
      try { await rpc('bump_reputation', [chain[i].id, 'generosity', level === 1 ? 3 : 1]); } catch {}
    }
  }
  await q('update referrals set rewarded_at=now() where id=$1', [ins.id]);
  return {
    referrer: referrer.name,
    reward: REF_L1,
    upline: paid[2] || null,
    upline2: paid[3] || null,
  };
}

const DIR = dirname(fileURLToPath(import.meta.url));
await mkdir(join(DIR, 'uploads'), { recursive: true });
if (!process.env.DATABASE_URL) { console.error('нет DATABASE_URL в окружении'); process.exit(1); }
// idleTimeoutMillis:0 — не закрывать соединения (дефолт 10с ронял пул, и каждый «первый экран» платил ~0.5с за TLS-реконнект во Франкфурт)
// rejectUnauthorized:false — локальный PostgreSQL, TLS сертификат на hostname машины (puxdjhjrbn.local),
// но подключение через 127.0.0.1 (не совпадает). Для удалённой БД — выставить true.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 0, keepAlive: true });
setInterval(() => pool.query('select 1').catch(() => {}), 240e3);  // пинг: Supabase-пулер не должен резать idle-соединение
pool.query('select 1').catch(() => {});                            // прогрев на старте — первый экран не ждёт TLS-коннект
const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows);
const one = (sql, p = []) => q(sql, p).then((r) => r[0] || null);
const rpc = (fn, args = []) => q(`select * from ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args);
const auth = makeAuth(q, one);

// base64-jpeg (с клиента) → файл в uploads/, возвращает относительный путь для БД. Общий для фото заданий/лавок.
async function savePhoto(dataUrl, prefix) {
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw { code: 400, msg: 'нужно фото — попробуй ещё раз' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 4e6) throw { code: 400, msg: 'фото слишком большое' };
  const path = `uploads/${prefix}_${Date.now()}_${randomInt(1e6)}.jpg`;
  await writeFile(join(DIR, path), buf);
  return path;
}
// base64-audio -> file (webm / mp4 / ogg — как прислал клиент)
async function saveAudio(dataUrl) {
  // Chrome: data:audio/webm;codecs=opus;base64,...
  // Android WebView иногда: data:audio/mp4;base64,... или data:;base64,...
  let raw = String(dataUrl || '');
  let m = /^data:(audio\/[a-z0-9.+-]+)(?:;[\w.="'-]+)*;base64,(.+)$/i.exec(raw);
  if (!m) {
    const loose = /^data:(?:application\/octet-stream)?;base64,(.+)$/i.exec(raw);
    if (loose) m = ['', 'audio/webm', loose[1]];
  }
  if (!m) throw { code: 400, msg: 'не удалось записать голос' };
  const mime = m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 200) throw { code: 400, msg: 'слишком коротко — нажми 🎤 ещё раз, чтобы остановить' };
  if (buf.length > 4e6) throw { code: 400, msg: 'голосовое слишком длинное' };
  const ext = mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac') ? 'm4a'
    : mime.includes('ogg') ? 'ogg'
    : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
    : 'webm';
  const path = `uploads/audio_${Date.now()}_${randomInt(1e6)}.${ext}`;
  await writeFile(join(DIR, path), buf);
  return path;
}

const TREE = { pine: 'tree.webp', spruce: 'tree3.webp', cedar: 'tree4.webp', oak: 'tree5.webp' };
const TREE_BREED = { pine: 'Сосна', cedar: 'Кедр', spruce: 'Ель', oak: 'Дуб' };
const TRAIT_RU = { honesty: 'честность', generosity: 'щедрость', reliability: 'надёжность', wisdom: 'мудрость' };
const MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
  'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
function ruDays(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
}
function strongestTrait(rep) {
  let best = null, val = 0;
  for (const [k, label] of Object.entries(TRAIT_RU)) {
    const n = Number(rep?.[k] || 0);
    if (n > val) { val = n; best = label; }
  }
  return best;
}
function forestChronicle({ name, tree_type, planted_month, planted_year, tree_title, best_streak, reputation }) {
  const breed = TREE_BREED[tree_type] || 'Дерево';
  const bits = [`${breed} «${name}»`];
  const m = Number(planted_month);
  const y = Number(planted_year);
  if (m >= 1 && m <= 12 && y) bits.push(`Корни с ${MONTH_IN[m - 1]} ${y}`);
  if (tree_title) bits.push(`Сейчас — ${String(tree_title).toLowerCase()}`);
  const streak = Number(best_streak || 0);
  if (streak > 0) bits.push(`Лучшая серия — ${streak} ${ruDays(streak)}`);
  const trait = strongestTrait(reputation);
  bits.push(trait
    ? `В лесу сильнее всего растёт ${trait}`
    : 'Паспорт ещё чистый — дела его заполнят');
  return bits.join('. ') + '.';
}
const FRIEND_AV = ['friend1.webp', 'friend2.webp', 'friend3.webp'];
const treeAvatar = (treeType, i = 0) => TREE[treeType] || FRIEND_AV[i % 3];
const PARENT_PIN = process.env.PARENT_PIN || '';                  // PIN родительского кабинета (опционально)
const PUBLIC = new Set([
  'POST /api/link', 'POST /api/signup', 'GET /api/signup/hint', 'POST /api/recover', 'GET /api/ping',
]); // роуты без кода ребёнка
// Саморегистрация: не больше 5 новых лесов с одного IP за час (анти-спам витрин).
const SIGNUPS = new Map(); // ip → { n, reset }
const signupRateOk = (ip) => {
  const now = Date.now();
  let s = SIGNUPS.get(ip);
  if (!s || now > s.reset) { s = { n: 0, reset: now + 3600e3 }; SIGNUPS.set(ip, s); }
  if (s.n >= 5) return false;
  s.n++;
  return true;
};
// Мягкий анти-дубль: Telegram WebView и Safari — разные localStorage, но один IP.
// Память + БД (users.signup_ip), чтобы переживало рестарт сервера.
const SIGNUP_LAST = new Map(); // ip → { name, at }
const noteSignup = (ip, name) => { SIGNUP_LAST.set(ip, { name, at: Date.now() }); };
async function signupRecent(ip) {
  const mem = SIGNUP_LAST.get(ip);
  if (mem && Date.now() - mem.at < 48 * 3600e3) return mem;
  if (!ip || ip === 'x') return null;
  try {
    const row = await one(
      `select name from users
        where role='child' and signup_ip=$1
          and created_at > now() - interval '48 hours'
        order by created_at desc limit 1`, [ip]);
    if (row) { noteSignup(ip, row.name); return { name: row.name, at: Date.now() }; }
  } catch { /* колонки signup_ip ещё нет — только память */ }
  return null;
}
const memo = new Map();   // серверный кэш редких данных: ключ → {v,t}
const memoGet = async (key, ttl, load) => {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await load(); memo.set(key, { v, t: Date.now() }); return v;
};

// Анти-перебор для PIN-кабинета и кодов входа (/api/link): и то, и другое — короткий секрет.
// 10 неверных попыток с одного IP → лок на 10 минут. Перебор 10k PIN растягивается на годы.
const FAILS = new Map();               // ip → { n, until }
const LOCK_AT = 10, LOCK_MS = 10 * 60_000;
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || req.socket.remoteAddress || 'x';   // nginx проставляет X-Real-IP
const isLocked = (ip) => { const f = FAILS.get(ip); return !!f && f.until > Date.now(); };
const badTry = (ip) => { const f = FAILS.get(ip) || { n: 0, until: 0 }; f.n++; if (f.n >= LOCK_AT) { f.until = Date.now() + LOCK_MS; f.n = 0; } FAILS.set(ip, f); };
const okTry = (ip) => FAILS.delete(ip);

// Мягкий rate-limit для детских роутов: 100 запросов за 10 сек с IP → 429 на 30 сек.
// Не блокирует легитимное использование (100 запросов — это больше клика в секунду),
// но глушит скриптовый перебор API.
const CHILD_RATE = new Map();  // ip → { n, windowStart }
const CHILD_LIMIT = 100, CHILD_WINDOW = 10_000, CHILD_LOCK = 30_000;
const childRateCheck = (ip) => {
  const now = Date.now();
  const r = CHILD_RATE.get(ip);
  if (r && r.lockedUntil > now) return false;
  if (!r || now - r.windowStart > CHILD_WINDOW) { CHILD_RATE.set(ip, { n: 1, windowStart: now, lockedUntil: 0 }); return true; }
  r.n++;
  if (r.n > CHILD_LIMIT) { r.lockedUntil = now + CHILD_LOCK; return false; }
  return true;
};

// Авто-закрытие аукционов: у кого дедлайн (ends_at) наступил — закрываем, объявляем победителя.
// Дедлайн ставит create_auction/next_monday_15msk (понедельник 15:00 МСК). Идемпотентно.
async function sweepAuctions() {
  try {
    const due = await q("select id from auctions where status='live' and ends_at is not null and now() >= ends_at");
    for (const a of due) { await rpc('close_auction', [a.id]).catch((e) => console.error('close_auction', a.id, e.message)); }
    // сезон с наступившим дедлайном закрывается сам, дети получают шёпот леса
    const dueSeason = await one("select code, name from card_seasons where status='active' and ends_at is not null and now() >= ends_at");
    if (dueSeason) {
      const r = (await one('select switch_season() as v')).v;
      if (r && r.ok) {
        for (const c of await q('select id from circles'))
          await q('select announce_season($1,$2)', [c.id, `Сезон «${r.closed}» завершён. Открыт новый: «${r.opened}» 🌲`]);
        console.log('сезон переключён:', r.closed, '→', r.opened);
      }
    }
    const dueCards = await q("select id from card_auctions where status='live' and now() >= ends_at");
    for (const a of dueCards) { await q('select close_card_auction($1)', [a.id]).catch((e) => console.error('close_card_auction', a.id, e.message)); }
    if (due.length) for (const k of memo.keys()) memo.delete(k);   // сбросить кэш новостей/альбома
  } catch (e) { console.error('sweepAuctions', e.message); }
}
setInterval(sweepAuctions, 60e3);   // раз в минуту
sweepAuctions();                    // и сразу на старте — вдруг сервер лежал в момент дедлайна

// Авто-сон гильдий: без активности 7 дней → sleeping
async function sweepGuilds() {
  try { const r = await q('select sweep_sleeping_guilds(7) as cnt'); if (r[0].cnt > 0) console.log('sweepGuilds: усыплено', r[0].cnt); }
  catch (e) { console.error('sweepGuilds', e.message); }
}
setInterval(sweepGuilds, 3600e3);  // раз в час
sweepGuilds();

// Ежедневная «зарплата» тестировщику Берёзе: +500 шишек с 09:00 МСК (не чаще раза в сутки).
async function sweepTesterPayroll() {
  try {
    // в кластере крутит только worker 1 — иначе начислят N раз
    if (process.env.CLUSTER_WORKER && process.env.CLUSTER_WORKER !== '1') return;
    const slot = await one("select (now() at time zone 'Europe/Moscow')::date as d, extract(hour from (now() at time zone 'Europe/Moscow'))::int as h");
    if (!slot || slot.h < 9) return;
    const u = await one("select id, name from users where role='child' and name in ('Берёза','Береза') order by created_at limit 1");
    if (!u) return;
    const paid = await one(
      `select 1 as x from transactions
        where to_user=$1 and type='reward' and message=$2
          and (created_at at time zone 'Europe/Moscow')::date = $3::date
        limit 1`, [u.id, 'Зарплата тестировщика', slot.d]);
    if (paid) return;
    await creditCones(u.id, 500, 'Зарплата тестировщика');
    sendPush(u.id, '🌲 Зарплата!', '+500 шишек — зарплата тестировщика').catch(() => {});
    console.log('зарплата тестировщика:', u.name, '+500');
  } catch (e) { console.error('sweepTesterPayroll', e.message); }
}
setInterval(sweepTesterPayroll, 60e3);
sweepTesterPayroll();
// гильдейский чат — только готовые фразы (без свободного текста, этика детского общения)
const GUILD_PHRASES = new Set(['Собираемся!', 'Заказ готов!', 'Молодцы!', 'Нужна помощь', 'Ура!', 'Я за!']);
// описания достижений «за что» по треку (в БД desc = title, генерим человеческое)
const ACH_DESC = {
  work: ['Выполни первое задание', 'Выполни {n} заданий'],
  earn: ['Заработай {n} шишек', 'Заработай {n} шишек'],
  streak: ['Заходи в лес {n} дня подряд', 'Заходи в лес {n} дней подряд'],
  gift: ['Подари друзьям {n} шишек', 'Подари друзьям {n} шишек'],
  give: ['Сделай первый подарок другу', 'Сделай {n} подарков друзьям'],
  dep: ['Открой первый Дупло-сейф', 'Открой {n} Дупло-сейфов'],
  depc: ['Дождись конца заморозки в Дупле', 'Доведи до конца {n} вкладов в Дупле'],
  horo: ['Прочитай первый лесной гороскоп', 'Прочитай {n} гороскопов'],
  skin: ['Купи первый наряд для дерева', 'Собери {n} нарядов для дерева'],
  pot: ['Внеси вклад в семейный котёл', 'Внеси {n} вкладов в семейный котёл'],
  buy: ['Купи первый приз в магазине', 'Купи {n} призов в магазине'],
  dq: ['Выполни цель дня от Лесного Духа', 'Выполни {n} целей дня'],
  hon: ['Набери {n} очков Честности', 'Набери {n} очков Честности'],
  gen: ['Набери {n} очков Щедрости', 'Набери {n} очков Щедрости'],
  rel: ['Набери {n} очков Надёжности', 'Набери {n} очков Надёжности'],
  wis: ['Набери {n} очков Мудрости', 'Набери {n} очков Мудрости'],
  rain: ['Поймай шишечный дождь', 'Поймай шишечный дождь {n} раз'],
  freeze: ['Купи Дождик-защитник', 'Купи {n} Дождиков-защитников'],
  int: ['Получи {n} шишек процентами из Дупла', 'Получи {n} шишек процентами из Дупла'],
  bal: ['Накопи {n} шишек в кошельке', 'Накопи {n} шишек в кошельке'],
  photo: ['Сдай первое фото-задание', 'Сдай {n} фото-заданий'],
  tree: ['Вырасти дерево до {n} уровня', 'Вырасти дерево до {n} уровня'],
  recv: ['Получи первый подарок от друга', 'Получи {n} подарков от друзей'],
  recvsum: ['Получи в подарок {n} шишек', 'Получи в подарок {n} шишек'],
  rep: ['Набери {n} очков репутации всего', 'Набери {n} очков репутации всего'],
  spend: ['Потрать {n} шишек', 'Потрать {n} шишек'],
  cat: ['Выполни задания из {n} разных областей', 'Выполни задания из {n} разных областей'],
  sell: ['Соверши первую продажу в лавке', 'Соверши {n} продаж в лавке'],
  rev: ['Выручи в лавке {n} шишек', 'Выручи в лавке {n} шишек'],
  shopper: ['Купи что-нибудь в лавке друга', 'Купи {n} товаров в лавках друзей'],
  mail: ['Отправь первое письмо', 'Отправь {n} писем'],
  detective: ['Раскрой тайну анонимной шишки', 'Раскрой {n} анонимных сюрпризов'],
};
const achDesc = (track, n) => { const d = ACH_DESC[track]; return d ? (n === 1 ? d[0] : d[1]).replace(/\{n\}/g, n) : null; };
// проверка владельца/круга — против IDOR (id из тела не должен пускать в чужое)
const assertOwn = async (sql, params, msg) => { if (!(await one(sql, params))) throw { code: 403, msg: msg || 'нет доступа' }; };

// ── endpoints (async). ctx = { child, circle } резолвится из кода ──

async function sendPush(userId, title, body, url) {
  const openUrl = url || '/mail.html';
  try {
    const subs = await q('select subscription from push_subscriptions where user_id=$1', [userId]);
    const vapid = process.env.VAPID_PRIVATE_KEY;
    if (vapid && subs.length) {
      const webpush = await import('web-push');
      webpush.setVapidDetails('mailto:shishka@elka-kvest-2026.ru',
        'BCsLnC1aJlENYUggedmMT3Gb-wns2cOD5T4gRRMUgW609m3KWFHvVrIlJbx5WzrjhWxYH3kyfPspd_VEmZSfT8o', vapid);
      const payload = JSON.stringify({ title, body, url: openUrl });
      for (const s of subs) {
        webpush.sendNotification(JSON.parse(s.subscription), payload).catch(() => {});
      }
    }
  } catch {}
  // нативный APK: WebSocket-клиенты на этом и других воркерах кластера
  try { broadcastPush(userId, title, body, openUrl); } catch {}
}


const api = {
  ...routesGames({ q, one, rpc }),
  ...routesParent({ q, one, rpc, auth, assertOwn, memoGet, memo, sendPush, genLoginCode }),
  ...routesCards({ q, one, rpc, assertOwn, assertFriend }),
  'POST /api/push/subscribe': async (b, ctx) => {
    const sub = b.subscription;
    if (!sub?.endpoint) throw { code: 400, msg: 'нужна подписка' };
    await q('insert into push_subscriptions(user_id, subscription) values($1,$2) on conflict(user_id) do update set subscription=$2, updated_at=now()', [ctx.child, JSON.stringify(sub)]);
    return { ok: true };
  },
  'GET /api/ping': async () => {
    let db = 'error', dberr = '';
    try { await pool.query('select 1'); db = 'ok'; } catch (e) { dberr = e.message || ''; }
    return { ok: true, ts: Date.now(), db, dberr, uptime: Math.floor(process.uptime()) };
  },
  'POST /api/link': async (b) => {
    const code = String(b.code || '').toUpperCase().trim();
    const r = await one(
      `select u.id, u.name, u.circle_id
         from child_logins cl join users u on u.id=cl.child_id
        where cl.code=$1`, [code]);
    if (!r) throw { code: 400, msg: 'код не найден' };
    // новый device_token — чтобы Safari после Telegram получил свою сессию, а не только код
    let raw = null;
    try {
      raw = auth.newToken();
      await q(
        `insert into device_tokens(token_hash, child_id, circle_id, label) values($1,$2,$3,$4)`,
        [auth.hash(raw), r.id, r.circle_id, 'link']);
    } catch (e) {
      console.error('link device_token', e.message);
      raw = null;
    }
    return { ok: true, name: r.name, token: raw, code };
  },

  // Подсказка на экране входа: с этого IP недавно сажали — скорее всего тот же человек в другом браузере.
  'GET /api/signup/hint': async (b, ctx, req) => {
    const ip = clientIp(req || { headers: {}, socket: {} });
    const recent = await signupRecent(ip);
    return recent ? { recent: true, name: recent.name } : { recent: false };
  },

  // Забыл код: то же имя дерева + тот же IP за 7 дней → вернуть код и токен.
  'POST /api/recover': async (b, ctx, req) => {
    const name = String(b.name || '').replace(/[<>]/g, '').trim().slice(0, 16);
    if (name.length < 2) throw { code: 400, msg: 'напиши имя дерева' };
    const ip = clientIp(req || { headers: {}, socket: {} });
    if (!ip || ip === 'x') throw { code: 400, msg: 'не удалось проверить устройство' };
    const row = await one(
      `select u.id, u.name, u.circle_id, cl.code
         from users u
         join child_logins cl on cl.child_id=u.id
        where u.role='child' and lower(u.name)=lower($1)
          and u.signup_ip=$2
          and u.created_at > now() - interval '7 days'
        order by u.created_at desc limit 1`, [name, ip]);
    if (!row) throw { code: 404, msg: 'Не нашли такое дерево с этого телефона. Проверь имя или зайди по коду.' };
    let raw = null;
    try {
      raw = auth.newToken();
      await q(
        `insert into device_tokens(token_hash, child_id, circle_id, label) values($1,$2,$3,$4)`,
        [auth.hash(raw), row.id, row.circle_id, 'recover']);
    } catch (e) {
      console.error('recover device_token', e.message);
    }
    return { ok: true, name: row.name, code: row.code, token: raw };
  },

  // Открытая регистрация: своё дерево → новый семейный круг + кошелёк + токен устройства.
  // Код входа всё равно выдаём — запасной вход / смена телефона.
  'POST /api/signup': async (b, ctx, req) => {
    const name = String(b.name || '').replace(/[<>]/g, '').trim().slice(0, 16);
    if (name.length < 2) throw { code: 400, msg: 'как назовём дерево?' };
    const tree = ['pine', 'cedar', 'spruce'].includes(b.tree) ? b.tree : 'pine';
    const ip = clientIp(req || { headers: {}, socket: {} });
    const recent = await signupRecent(ip);
    if (recent && !b.force) {
      return { need_confirm: true, recent_name: recent.name };
    }
    if (!signupRateOk(ip)) throw { code: 429, msg: 'Слишком много новых лесов с этого устройства — загляни позже' };
    let invite;
    for (let i = 0; i < 8; i++) {
      invite = genLoginCode();
      if (!(await one('select 1 from circles where invite_code=$1', [invite]))) break;
    }
    const circle = await one(
      `insert into circles(name, invite_code) values($1,$2) returning id`,
      ['Лес ' + name, invite]);
    if (!circle) throw { code: 500, msg: 'не удалось открыть лес' };
    auth.dropCache();
    const u = (await rpc('add_child', [circle.id, name, tree]))[0];
    let code;
    for (let i = 0; i < 8; i++) {
      code = genLoginCode();
      if (!(await one('select 1 from child_logins where code=$1', [code]))) break;
    }
    await q('insert into child_logins(code,child_id) values($1,$2)', [code, u.id]);
    let raw = null;
    try {
      raw = auth.newToken();
      await q(
        `insert into device_tokens(token_hash, child_id, circle_id, label) values($1,$2,$3,$4)`,
        [auth.hash(raw), u.id, circle.id, 'signup']);
    } catch (e) {
      console.error('signup device_token', e.message);
      raw = null;   // без миграции auth — вход по коду всё равно работает
    }
    // витрина впечатлений: глобальные (circle_id is null) или копия из самого старого круга
    try {
      const seeded = await q(
        `insert into shop_items(circle_id,type,title,price)
           select $1::uuid, type, title, price from shop_items
            where type='impression' and is_active and circle_id is null
         returning id`, [circle.id]);
      if (!seeded.length) {
        await q(
          `insert into shop_items(circle_id,type,title,price)
             select $1::uuid, type, title, price from shop_items
              where type='impression' and is_active
                and circle_id = (select id from circles where id <> $1::uuid order by created_at limit 1)
              order by price limit 24`, [circle.id]);
      }
    } catch (e) { console.error('signup shop seed', e.message); }
    try { await q('update users set signup_ip=$1 where id=$2', [ip, u.id]); }
    catch (e) { console.error('signup_ip', e.message); }
    await ensureReferralCode(u.id).catch(() => {});
    let referral = null;
    try { referral = await applyReferral(b.ref, u.id, name); }
    catch (e) { console.error('signup referral', e.message); }
    noteSignup(ip, name);
    return { ok: true, name, code, token: raw, referral };
  },

  'GET /api/referral': async (b, ctx) => {
    const code = await ensureReferralCode(ctx.child);
    const friends = await q(
      `select u.name, r.reward, r.created_at, r.rewarded_at
         from referrals r join users u on u.id=r.referred_id
        where r.referrer_id=$1
        order by r.created_at desc limit 50`, [ctx.child]);
    const rewards = await q(
      `select rr.level, rr.amount, rr.created_at, u.name as source_name, mid.name as via_name
         from referral_rewards rr
         join users u on u.id=rr.source_user_id
         left join users mid on mid.id = u.referred_by
        where rr.beneficiary_id=$1
        order by rr.created_at desc limit 80`, [ctx.child]);
    const earned = rewards.reduce((s, r) => s + r.amount, 0);
    const earnedL1 = rewards.filter((r) => r.level === 1).reduce((s, r) => s + r.amount, 0);
    const earnedL2 = rewards.filter((r) => r.level === 2).reduce((s, r) => s + r.amount, 0);
    const earnedL3 = rewards.filter((r) => r.level === 3).reduce((s, r) => s + r.amount, 0);
    const countL2 = rewards.filter((r) => r.level === 2).length;
    const countL3 = rewards.filter((r) => r.level === 3).length;
    return {
      code,
      reward: REF_L1,
      rewardL2: REF_L2,
      rewardL3: REF_L3,
      count: friends.length,
      countL2,
      countL3,
      earned,
      earnedL1,
      earnedL2,
      earnedL3,
      friends: friends.map((r) => ({
        name: r.name,
        reward: r.reward,
        level: 1,
        at: r.created_at,
        paid: !!r.rewarded_at,
      })),
      cascade: rewards.filter((r) => r.level >= 2).slice(0, 40).map((r) => ({
        name: r.source_name,
        via: r.via_name,
        reward: r.amount,
        level: r.level,
        at: r.created_at,
      })),
    };
  },

  'GET /api/state': async (b, ctx) => {
    const TREE_NAME = { 1: 'Саженец', 2: 'Дубок', 3: 'Деревце', 4: 'Крепкое', 5: 'Могучее' };
    const [u, w] = await Promise.all([
      one(`select name,tree_level,tree_type,avatar_skin,current_streak,coalesce(streak_freezes,0) as streak_freezes,
            (last_visit is distinct from (now() at time zone 'Europe/Moscow')::date) as can_claim_daily
           from users where id=$1`, [ctx.child]),
      one('select balance,total_earned,total_spent from wallets where user_id=$1', [ctx.child]),
    ]);
    // питомцы на поляне: массив (до 5), каждый с фразой
    const familiars = await q(`select f.type_id as type, t.code, t.name, t.category, f.grade, l.title, r.color,
        coalesce((select phrase from familiar_phrases fp
          where fp.category in (t.category,'any') order by random() limit 1), 'Привет!') as phrase
      from familiars f join card_types t on t.id=f.type_id
      left join card_lore l on l.category=t.category and l.grade=f.grade
      left join rarities r on r.grade=f.grade
      where f.user_id=$1 order by f.slot`, [ctx.child]);
    let tree_asset = TREE[u.tree_type] || 'tree.webp', skin_on = false;
    if (u.avatar_skin && u.avatar_skin !== 'base') {
      const sk = await one('select title from shop_items where id=$1', [u.avatar_skin]);
      if (sk && SKIN_ASSET[sk.title] && SKIN_ASSET[sk.title] !== 'base') { tree_asset = SKIN_ASSET[sk.title] + '.png'; skin_on = true; }
    }
    const lvl = Math.min(5, Math.max(1, u.tree_level || 1));
    return { name: u.name, tree_level: lvl, tree_title: TREE_NAME[lvl] || 'Саженец',
             tree_type: u.tree_type, balance: w.balance,
             total_earned: w.total_earned, total_spent: w.total_spent, tree_asset, skin_on,
             streak: u.current_streak, streak_freezes: u.streak_freezes || 0,
             can_claim_daily: u.can_claim_daily, familiars };
  },
  'POST /api/freeze/buy': async (b, ctx) => {
    try { await rpc('buy_streak_freeze', [ctx.child]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'нужно 20 шишек' : 'не вышло' }; }
    const u = await one('select coalesce(streak_freezes,0) as streak_freezes from users where id=$1', [ctx.child]);
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, streak_freezes: u.streak_freezes, balance: w.balance };
  },

  // Ежедневный подарок: серия + растущий бонус + вехи + авто-защитник (всё в daily_visit)
  'POST /api/daily': async (b, ctx) => {
    const r = await one('select daily_visit($1) as v', [ctx.child]);
    return r.v;
  },

  'GET /api/tasks': async (b, ctx) => {
    try { await rpc('ensure_daily_tasks', [ctx.child]); }
    catch (e) { console.error('ensure_daily_tasks', e.message); }
    // open / на проверке / вернули на доработку; done только у сегодняшних daily
    return (await q(`select id,title,reward,needs_photo,status,is_daily,category,created_at
      from tasks where child_id=$1
      and (
        status in ('open','pending_review','rejected')
        or (status = 'done' and is_daily and created_at::date = (now() at time zone 'Europe/Moscow')::date)
      )
      order by case status when 'rejected' then 0 when 'open' then 1 when 'pending_review' then 2 else 3 end,
               is_daily desc, created_at`, [ctx.child]))
      .map((t) => ({
        id: t.id, title: t.title, reward: t.reward, needs_photo: t.needs_photo,
        is_daily: !!t.is_daily, category: t.category || '',
        status: t.status === 'pending_review' ? 'submitted' : t.status,
      }));
  },
  'POST /api/task/done': async (b, ctx) => {
    const t = await one('select id, title, needs_photo, status from tasks where id=$1 and child_id=$2', [b.id, ctx.child]);
    if (!t || t.status === 'done' || t.status === 'pending_review') throw { code: 400, msg: 'задание недоступно' };
    let proof = null;
    if (t.needs_photo) proof = await savePhoto(b.photo, 'task_' + b.id);
    await rpc('submit_task', [b.id, proof]);
    const me = await one('select name from users where id=$1', [ctx.child]);
    // ведущий + опекуны — как при покупке в магазине (иначе дело висит «на проверке» незамеченным)
    let notify = [];
    try {
      notify = await q("select id from users where circle_id=$1 and role='parent'", [ctx.circle]);
    } catch (e) { console.error('task notify parent', e.message); }
    try {
      const g = await q('select guardian_id as id from child_guardians where child_id=$1', [ctx.child]);
      notify = notify.concat(g);
    } catch (e) { console.error('task notify guardians', e.message); }
    let approved = false;
    if (!notify.length) {
      // свой лес без ведущего (приглашённый друг) — иначе дела висят навсегда
      try { await rpc('approve_task', [b.id]); approved = true; }
      catch (e) { console.error('auto-approve', e.message); }
    }
    if (!approved) {
      for (const p of notify) {
        sendPush(
          p.id,
          '📋 На проверку!',
          `${me?.name || 'Ребёнок'} сдал «${t.title}»`,
          '/parent.html#pending',
        ).catch(() => {});
      }
    }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, submitted: !approved, approved, balance: w.balance };
  },

  'GET /api/shop': (b, ctx) => memoGet('shop:' + ctx.circle, 6e4, () =>
    q("select id,title,price from shop_items where type='impression' and is_active and (circle_id=$1 or circle_id is null) order by price", [ctx.circle])),
  'GET /api/shop/purchases': (b, ctx) => q(`
      select p.id, p.price, p.status, p.created_at, i.title
        from purchases p join shop_items i on i.id = p.item_id
       where p.child_id = $1 and p.status in ('promised','fulfilled')
       order by case p.status when 'promised' then 0 else 1 end, p.created_at desc
       limit 20`, [ctx.child]),
  'POST /api/shop/buy': async (b, ctx) => {
    await assertOwn('select 1 from shop_items where id=$1 and is_active and (circle_id=$2 or circle_id is null)', [b.id, ctx.circle], 'нет такого приза');
    const it = await one('select title from shop_items where id=$1', [b.id]);
    try { await rpc('purchase_item', [ctx.child, b.id]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : 'нет такого приза' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    const me = await one('select name from users where id=$1', [ctx.child]);
    // ведущий круга + личные опекуны ребёнка (родители)
    let notify = [];
    try {
      notify = await q("select id from users where circle_id=$1 and role='parent'", [ctx.circle]);
    } catch (e) { console.error('shop notify parent', e.message); }
    try {
      notify = notify.concat(await q('select guardian_id as id from child_guardians where child_id=$1', [ctx.child]));
    } catch (e) { console.error('shop notify guardians', e.message); }
    for (const p of notify) {
      sendPush(p.id, '🎁 Обещание!', `${me.name} купил «${it?.title || 'приз'}»`).catch(() => {});
    }
    return { ok: true, balance: w.balance };
  },
  // очередь обещаний для опекуна (родитель, вошедший своим детским кодом)
  'GET /api/guardian/purchases': (b, ctx) => q(`
      select p.id, p.price, p.created_at, u.name as "childName", i.title
        from purchases p
        join child_guardians g on g.child_id = p.child_id and g.guardian_id = $1
        join users u on u.id = p.child_id
        join shop_items i on i.id = p.item_id
       where p.status = 'promised'
       order by p.created_at`, [ctx.child]),
  'POST /api/guardian/purchase/fulfill': async (b, ctx) => {
    const ok = await one(`
      select p.id from purchases p
        join child_guardians g on g.child_id = p.child_id and g.guardian_id = $1
       where p.id = $2 and p.status = 'promised'`, [ctx.child, b.id]);
    if (!ok) throw { code: 400, msg: 'нет такого обещания' };
    let pu;
    try { [pu] = await rpc('fulfill_purchase', [b.id]); }
    catch { throw { code: 400, msg: 'нет такого обещания' }; }
    const g = await one('select name from users where id=$1', [ctx.child]);
    sendPush(pu.child_id, '🎁 Получено!', `${g?.name || 'Родитель'} исполнил твоё впечатление`).catch(() => {});
    return { ok: true };
  },
  'POST /api/guardian/purchase/cancel': async (b, ctx) => {
    const ok = await one(`
      select p.id from purchases p
        join child_guardians g on g.child_id = p.child_id and g.guardian_id = $1
       where p.id = $2 and p.status = 'promised'`, [ctx.child, b.id]);
    if (!ok) throw { code: 400, msg: 'нет такого обещания' };
    let pu;
    try { [pu] = await rpc('cancel_purchase', [b.id]); }
    catch { throw { code: 400, msg: 'нет такого обещания' }; }
    sendPush(pu.child_id, '↩️ Возврат', 'Обещание отменили — шишки вернулись').catch(() => {});
    return { ok: true };
  },

  // Принятые друзья (свой круг и по коду). Для подарков / пикеров.
  'GET /api/friends': async (b, ctx) => {
    const rows = await q(
      `select u.id, u.name, u.tree_type,
              u.last_seen > now() - interval '5 minutes' as online
         from friendships f
         join users u on u.id = f.friend_id
        where f.user_id=$1 and f.status='accepted' and u.role='child'
        order by u.name`, [ctx.child]);
    return rows.map((r, i) => ({
      id: r.id, name: r.name, online: !!r.online, avatar: treeAvatar(r.tree_type, i),
    }));
  },
  // Поляна: весь лес + флаг друга. Добытые шишки, дела, ячейки альбома.
  'GET /api/board': async (b, ctx) => {
    const rows = await q(
      `select u.id, u.name, u.tree_type,
              u.last_seen > now() - interval '5 minutes' as online,
              coalesce(w.total_earned, 0)::int as cones,
              (select count(*)::int from tasks t
                where t.child_id = u.id and t.status = 'done') as tasks,
              (select count(*)::int from user_cards c
                where c.user_id = u.id and c.qty > 0) as cards,
              (u.id = $1 or exists (
                 select 1 from friendships f
                  where f.user_id = $1 and f.friend_id = u.id and f.status = 'accepted'
               )) as friend,
              exists (
                 select 1 from friendships f
                  where f.user_id = $1 and f.friend_id = u.id and f.status = 'pending'
               ) as pending
         from users u
         left join wallets w on w.user_id = u.id
        where u.role = 'child'
        order by coalesce(w.total_earned, 0) desc, u.name
        limit 80`, [ctx.child]);
    if (!rows.some((r) => r.id === ctx.child)) {
      const me = await q(
        `select u.id, u.name, u.tree_type,
                u.last_seen > now() - interval '5 minutes' as online,
                coalesce(w.total_earned, 0)::int as cones,
                (select count(*)::int from tasks t
                  where t.child_id = u.id and t.status = 'done') as tasks,
                (select count(*)::int from user_cards c
                  where c.user_id = u.id and c.qty > 0) as cards,
                true as friend
           from users u
           left join wallets w on w.user_id = u.id
          where u.id = $1`, [ctx.child]);
      if (me[0]) rows.push(me[0]);
    }
    return {
      me: ctx.child,
      rows: rows.map((r, i) => ({
        id: r.id,
        name: r.name,
        mine: r.id === ctx.child,
        friend: !!r.friend,
        pending: !!r.pending,
        online: !!r.online,
        cones: r.cones,
        tasks: r.tasks,
        cards: r.cards,
        avatar: treeAvatar(r.tree_type, i),
      })),
    };
  },
  // Хаб друзей для почты: друзья, заявки, свой круг и обитатели леса
  'GET /api/friends/hub': async (b, ctx) => {
    let my_code = '';
    try { my_code = await ensureReferralCode(ctx.child); } catch {}
    const [friends, pendingIn, pendingOut, circle, forest] = await Promise.all([
      q(`select u.id, u.name, u.tree_type, u.last_seen > now() - interval '5 minutes' as online
           from friendships f join users u on u.id=f.friend_id
          where f.user_id=$1 and f.status='accepted' and u.role='child'
          order by u.name`, [ctx.child]),
      q(`select u.id, u.name, u.tree_type
           from friendships f join users u on u.id=f.user_id
          where f.friend_id=$1 and f.status='pending' and u.role='child'
          order by f.created_at desc`, [ctx.child]),
      q(`select u.id, u.name, u.tree_type
           from friendships f join users u on u.id=f.friend_id
          where f.user_id=$1 and f.status='pending' and u.role='child'
          order by f.created_at desc`, [ctx.child]),
      q(`select u.id, u.name, u.tree_type
           from users u
          where u.circle_id=$1 and u.role='child' and u.id<>$2
            and not exists (
              select 1 from friendships f
               where f.user_id=$2 and f.friend_id=u.id)
          order by u.name`, [ctx.circle, ctx.child]),
      q(`select u.id, u.name, u.tree_type
           from users u
          where u.role='child' and u.id<>$1 and u.circle_id is distinct from $2
            and not exists (
              select 1 from friendships f
               where f.user_id=$1 and f.friend_id=u.id)
          order by u.last_seen desc nulls last, u.name
          limit 40`, [ctx.child, ctx.circle]),
    ]);
    const av = (rows) => rows.map((r, i) => ({ ...r, online: !!r.online, avatar: treeAvatar(r.tree_type, i) }));
    return {
      my_code,
      friends: av(friends),
      pending_in: av(pendingIn),
      pending_out: av(pendingOut),
      circle: av(circle),
      forest: av(forest),
    };
  },
  'POST /api/friends/request': async (b, ctx) => {
    let to = b.to;
    if (!to && b.code) {
      const r = await findChildByFriendCode(b.code);
      if (!r) throw { code: 400, msg: 'друг с таким кодом не найден' };
      to = r.id;
    }
    if (!to) throw { code: 400, msg: 'выбери друга' };
    if (to === ctx.child) throw { code: 400, msg: 'это ты сам' };
    const peer = await one("select id, name from users where id=$1 and role='child'", [to]);
    if (!peer) throw { code: 400, msg: 'друг с таким кодом не найден' };
    const existing = await one(
      `select status from friendships where user_id=$1 and friend_id=$2`,
      [ctx.child, to]);
    if (existing?.status === 'accepted') return { ok: true, status: 'accepted', name: peer.name };
    if (existing?.status === 'pending') return { ok: true, status: 'pending', name: peer.name };
    // встречная заявка → сразу друзья
    const reverse = await one(
      `select status from friendships where user_id=$1 and friend_id=$2`,
      [to, ctx.child]);
    if (reverse?.status === 'pending' || reverse?.status === 'accepted') {
      await linkFriends(ctx.child, to);
      const me = await one('select name from users where id=$1', [ctx.child]);
      sendPush(to, '🤝 Друзья!', `${me.name} теперь твой друг`).catch(() => {});
      return { ok: true, status: 'accepted', name: peer.name };
    }
    const todayN = await one(
      `select count(*)::int as n from friendships
        where user_id=$1 and status='pending'
          and created_at >= date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'`,
      [ctx.child]);
    if ((todayN?.n || 0) >= 12) throw { code: 429, msg: 'сегодня уже много заявок — продолжим завтра' };
    await q(
      `insert into friendships(user_id, friend_id, status) values ($1,$2,'pending')
       on conflict (user_id, friend_id) do update set status='pending'`,
      [ctx.child, to]);
    const me = await one('select name from users where id=$1', [ctx.child]);
    sendPush(to, '👋 Заявка в друзья', `${me.name} хочет дружить`).catch(() => {});
    return { ok: true, status: 'pending', name: peer.name };
  },
  'POST /api/friends/accept': async (b, ctx) => {
    if (!b.from) throw { code: 400, msg: 'нет заявки' };
    const req = await one(
      `select 1 as x from friendships
        where user_id=$1 and friend_id=$2 and status='pending'`,
      [b.from, ctx.child]);
    if (!req) throw { code: 400, msg: 'заявка не найдена' };
    const peer = await one("select id, name from users where id=$1 and role='child'", [b.from]);
    if (!peer) throw { code: 400, msg: 'заявка не найдена' };
    await linkFriends(ctx.child, b.from);
    const me = await one('select name from users where id=$1', [ctx.child]);
    sendPush(b.from, '✅ Заявка принята', `${me.name} добавил тебя в друзья`).catch(() => {});
    return { ok: true, name: peer.name };
  },
  'POST /api/friends/decline': async (b, ctx) => {
    if (!b.from) throw { code: 400, msg: 'нет заявки' };
    await q(
      `delete from friendships
        where user_id=$1 and friend_id=$2 and status='pending'`,
      [b.from, ctx.child]);
    return { ok: true };
  },

  'POST /api/transfer': async (b, ctx) => {
    let to = b.to;
    if (!to && b.toCode) {   // перевод по QR: получатель задан кодом, id наружу не светим
      const r = await findChildByFriendCode(b.toCode);
      if (!r) throw { code: 400, msg: 'код не найден' };
      to = r.id;
    }
    if (to === ctx.child) throw { code: 400, msg: 'себе дарить нельзя' };
    b = { ...b, to };
    const peer = await one("select 1 from users where id=$1 and role='child'", [b.to]);
    if (!peer) throw { code: 400, msg: 'нет такого друга' };
    await assertFriend(ctx.child, b.to);
    try { await rpc('transfer_cones', [ctx.child, b.to, parseInt(b.amount, 10), 'Подарок другу']); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : 'не получилось' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    sendPush(b.to, "🎁 Подарок!", "Тебе пришёл подарок от друга").catch(() => {});
    return { ok: true, balance: w.balance };
  },

  'POST /api/surprise': async (b, ctx) => {   // анонимный подарок «Шишка-сюрприз»
    const peer = await one("select 1 from users where id=$1 and role='child'", [b.to]);
    if (!peer) throw { code: 400, msg: 'нет такого друга' };
    if (b.to === ctx.child) throw { code: 400, msg: 'себе нельзя' };
    await assertFriend(ctx.child, b.to);
    try { await rpc('transfer_surprise', [ctx.child, b.to, parseInt(b.amount, 10)]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : 'не получилось' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    sendPush(b.to, "🎁 Шишка-сюрприз!", "Кто-то прислал тебе анонимный подарок").catch(() => {});
    return { ok: true, balance: w.balance };
  },
  // только подарки шишками — не покупки карт/оплаты (они тоже type=transfer)
  'GET /api/gifts/received': (b, ctx) => q(`select t.amount, u.name as sender, t.created_at at
    from transactions t join users u on u.id=t.from_user
    where t.to_user=$1 and t.type='transfer' and t.from_user is not null
      and coalesce(t.is_anonymous,false)=false
      and t.message = 'Подарок другу'
    order by t.created_at desc limit 20`, [ctx.child]),
  'GET /api/surprises': (b, ctx) => q(`select t.id, t.amount, t.revealed, t.created_at at,
      case when t.revealed then u.name else null end as sender
    from transactions t left join users u on u.id=t.from_user
    where t.to_user=$1 and t.is_anonymous order by t.created_at desc`, [ctx.child]),
  'POST /api/surprise/investigate': async (b, ctx) => {
    let name;
    try { name = (await one('select investigate_surprise($1,$2) as sender', [ctx.child, b.id])).sender; }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'нужна 1 шишка на расследование' : 'нет такого сюрприза' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, sender: name, balance: w.balance };
  },

  'POST /api/pay': async (b, ctx) => {   // ОПЛАТА (не подарок): pay_cones, комиссия 1 шишка сгорает в кассу Банка
    const r = await one('select u.id, u.name from child_logins cl join users u on u.id=cl.child_id where cl.code=$1 and u.circle_id=$2', [String(b.toCode || '').toUpperCase().trim(), ctx.circle]);
    if (!r) throw { code: 400, msg: 'код не найден' };
    if (r.id === ctx.child) throw { code: 400, msg: 'себе платить нельзя' };
    const amount = parseInt(b.amount, 10);
    if (!(amount > 1)) throw { code: 400, msg: 'минимум 2 шишки (1 — комиссия Банка)' };
    try { await rpc('pay_cones', [ctx.child, r.id, amount, 'Оплата по QR']); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : 'не получилось' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, balance: w.balance, to: r.name };
  },

  'GET /api/shops': async (b, ctx) => {
    const rows = await q(`select s.id, s.name, s.photo, s.is_heir, s.owner_id, u.tree_type,
        coalesce(jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'price',l.price,'photo',l.photo)
          order by l.created_at) filter (where l.id is not null), '[]') as lots
      from shops s join users u on u.id=s.owner_id
      left join shop_lots l on l.shop_id=s.id and l.is_active
      where s.is_active and (
        s.circle_id=$2
        or exists (select 1 from friendships f
                    where f.user_id=$1 and f.friend_id=s.owner_id and f.status='accepted')
      )
      group by s.id, u.tree_type order by s.created_at`, [ctx.child, ctx.circle]);
    return rows.map((s) => ({ id: s.id, name: s.name, photo: s.photo, is_heir: s.is_heir, mine: s.owner_id === ctx.child,
      avatar: TREE[s.tree_type] || 'tree.webp', lots: s.lots }));
  },
  'POST /api/lot/buy': async (b, ctx) => {
    const lot = await one(
      `select s.circle_id, s.owner_id from shop_lots l join shops s on s.id=l.shop_id where l.id=$1`,
      [b.id]);
    if (!lot) throw { code: 403, msg: 'нет такого лота' };
    if (lot.circle_id !== ctx.circle) await assertFriend(ctx.child, lot.owner_id, 'нет такого лота');
    let o;
    try { [o] = await rpc('reserve_lot', [ctx.child, b.id]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : /own shop|cannot buy/.test(e.message) ? 'это твоя лавка' : 'нет такого лота' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    sendPush(o.seller_id, '🛒 Заказ в лавке!', 'Кто-то купил твой товар — отдай его и жди подтверждения').catch(() => {});
    return { ok: true, balance: w.balance, order_id: o.id };
  },
  // Активные сделки лавок (эскроу): покупатель подтверждает получение → продавец получает шишки
  'GET /api/orders': async (b, ctx) => q(`
      select o.id, o.price, o.status, o.created_at,
             l.title, l.photo,
             buyer.name as buyer_name, seller.name as seller_name,
             case when o.buyer_id = $1 then 'buy' else 'sell' end as role
        from orders o
        join shop_lots l on l.id = o.lot_id
        join users buyer on buyer.id = o.buyer_id
        join users seller on seller.id = o.seller_id
       where o.status = 'reserved' and (o.buyer_id = $1 or o.seller_id = $1)
       order by o.created_at desc`, [ctx.child]),
  'POST /api/order/confirm': async (b, ctx) => {
    const id = b.id || b.orderId;
    if (!id) throw { code: 400, msg: 'нет заказа' };
    const o = await one(
      `select o.id, o.seller_id, l.title from orders o join shop_lots l on l.id=o.lot_id
        where o.id=$1 and o.buyer_id=$2 and o.status='reserved'`, [id, ctx.child]);
    if (!o) throw { code: 404, msg: 'заказ уже закрыт или не твой' };
    try { await rpc('confirm_order', [id]); }
    catch (e) {
      console.error('confirm_order', e.message || e);
      throw { code: 400, msg: 'не удалось подтвердить — попробуй ещё раз' };
    }
    sendPush(o.seller_id, '✅ Получено!', `Покупатель подтвердил «${o.title}» — шишки у тебя`).catch(() => {});
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, balance: w.balance, closed: true };
  },
  'POST /api/order/cancel': async (b, ctx) => {
    const id = b.id || b.orderId;
    if (!id) throw { code: 400, msg: 'нет заказа' };
    const o = await one(
      `select o.id, o.buyer_id, o.seller_id, l.title from orders o join shop_lots l on l.id=o.lot_id
        where o.id=$1 and o.status='reserved' and (o.buyer_id=$2 or o.seller_id=$2)`, [id, ctx.child]);
    if (!o) throw { code: 404, msg: 'заказ уже закрыт' };
    try { await rpc('cancel_order', [id]); }
    catch (e) {
      console.error('cancel_order', e.message || e);
      throw { code: 400, msg: 'не удалось отменить — попробуй ещё раз' };
    }
    const other = o.buyer_id === ctx.child ? o.seller_id : o.buyer_id;
    sendPush(other, '↩️ Заказ отменён', `«${o.title}» — шишки вернулись покупателю`).catch(() => {});
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, balance: w.balance };
  },

  'GET /api/profile': async (b, ctx) => {
    const u = await one(
      `select name, tree_level, tree_type, reputation, current_streak, longest_streak,
              extract(month from created_at at time zone 'Europe/Moscow')::int as planted_month,
              extract(year from created_at at time zone 'Europe/Moscow')::int as planted_year
         from users where id=$1`,
      [ctx.child]);
    const badges = await q('select badge_type as code from badges where user_id=$1', [ctx.child]);
    const titles = { guardian: 'Хранитель', philanthropist: 'Меценат', saver: 'Спаситель' };
    // дерево растёт от максимальной серии ежедневных заходов (см. daily_visit)
    const NEED = [0, 7, 21, 45, 90]; // дней longest_streak до уровней 2..5
    const TREE_NAME = { 1: 'Саженец', 2: 'Дубок', 3: 'Деревце', 4: 'Крепкое', 5: 'Могучее' };
    const lvl = Math.min(5, Math.max(1, u.tree_level || 1));
    const best = u.longest_streak || 0;
    const nextNeed = lvl >= 5 ? null : NEED[lvl];
    const prevNeed = lvl <= 1 ? 0 : NEED[lvl - 1];
    const span = nextNeed == null ? 1 : Math.max(1, nextNeed - prevNeed);
    const into = nextNeed == null ? span : Math.max(0, Math.min(span, best - prevNeed));
    const progress = nextNeed == null ? 100 : Math.round((into / span) * 100);
    const tree_title = TREE_NAME[lvl] || 'Саженец';
    const tree_breed = TREE_BREED[u.tree_type] || 'Дерево';
    return {
      name: u.name, tree_level: lvl, tree_title, tree_type: u.tree_type, tree_breed,
      streak: u.current_streak || 0, best_streak: best,
      next_level_at: nextNeed, days_to_next: nextNeed == null ? 0 : Math.max(0, nextNeed - best),
      progress, reputation: u.reputation,
      chronicle: forestChronicle({
        name: u.name, tree_type: u.tree_type, planted_month: u.planted_month,
        planted_year: u.planted_year, tree_title, best_streak: best, reputation: u.reputation,
      }),
      badges: badges.map((x) => ({ code: x.code, title: titles[x.code] || x.code })),
    };
  },
  'GET /api/news': async (b, ctx) => {
    const rows = await q(`
      select * from (
        select 'achievement' kind, u.name who, a.title what, null::int amount, ua.unlocked_at at
          from user_achievements ua join users u on u.id=ua.child_id join achievements a on a.code=ua.code
          where u.circle_id=$1
        union all
        select 'guild_pay', null, t.message, t.amount, t.created_at
          from transactions t where t.circle_id=$1 and t.type='reward' and t.message like 'Заказ гильдии%'
        union all
        select 'rain', u.name, 'Шишечный дождь', t.amount, t.created_at
          from transactions t join users u on u.id=t.to_user
          where t.circle_id=$1 and t.message like '%дождь%'
        union all
        select 'payout', u.name, coalesce(t.message,'Награда от Банка'), t.amount, t.created_at
          from transactions t join users u on u.id=t.to_user where t.circle_id=$1 and t.type='payout'
        union all
        select 'pot', null, 'Котёл «' || p.title || '» наполнен!', p.goal, coalesce(p.fulfilled_at, p.created_at)
          from pots p where p.circle_id=$1 and p.status in ('reached','fulfilled')
        union all
        select 'guild_new', u.name, 'Основана гильдия «' || g.name || '»', null, g.created_at
          from guilds g left join users u on u.id=g.created_by where g.circle_id=$1
        union all
        select 'auction', u.name, 'Ставка на аукционе: ' || a.title, a.current_bid, a.created_at
          from auctions a join users u on u.id=a.current_leader where a.status='live'
        union all
        select 'event', null, 'Событие: ' || e.title, null, e.start_date
          from events e where (e.circle_id=$1 or e.circle_id is null) and (e.end_date is null or e.end_date > now())
      ) n order by at desc limit 50`, [ctx.circle]);
    return rows;
  },
  'GET /api/album': async (b, ctx) => {
    const row = await one('select get_album($1) as data', [ctx.child]);   // готовый RPC: транзакции+достижения+фото
    return row.data || [];
  },
  'GET /api/achievements': async (b, ctx) => {
    const row = await one('select achievement_progress($1) as data', [ctx.child]);   // функция returns jsonb (массив)
    const rewards = await q('select code, coalesce(reward,0) as reward from achievements');
    const rw = Object.fromEntries(rewards.map((x) => [x.code, x.reward]));
    return (row.data || []).map((a) => {
      const track = (a.code || '').split('_')[0];
      return { code: a.code, title: a.title, desc: achDesc(track, a.threshold) || a.title, threshold: a.threshold,
        track, reward: rw[a.code] || 0,
        current: Math.min(a.current || 0, a.threshold), unlocked: !!a.unlocked };
    });
  },

  // ── Дупло-сейф ──
  'GET /api/safes': (b, ctx) => q(`select id, amount, interest_rate as rate, (unlock_date<=now()) as ready,
      greatest(0, ceil(extract(epoch from unlock_date-now())/86400))::int as days_left
      from safes where user_id=$1 and status='locked' order by created_at`, [ctx.child]),
  'POST /api/safe/open': async (b, ctx) => {
    try { await rpc('open_safe', [ctx.child, parseInt(b.amount, 10), parseInt(b.days, 10)]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : /term/.test(e.message) ? 'срок 3, 7 или 30 дней' : 'укажи сумму' }; }
    return { ok: true, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance };
  },
  'POST /api/safe/redeem': async (b, ctx) => {
    await assertOwn('select 1 from safes where id=$1 and user_id=$2', [b.id, ctx.child], 'сейф недоступен');  // только своё Дупло
    const before = (await one('select balance from wallets where user_id=$1', [ctx.child])).balance;
    try { await rpc('redeem_safe', [b.id]); }
    catch (e) { throw { code: 400, msg: /locked until/.test(e.message) ? 'ещё не время' : 'сейф недоступен' }; }
    const after = (await one('select balance from wallets where user_id=$1', [ctx.child])).balance;
    return { ok: true, gained: after - before };
  },

  // ── Общий котёл ──
  'GET /api/pot': (b, ctx) => q(`select p.id, p.title, p.goal, p.collected, p.status, p.created_by, g.name as guild, coalesce(u.name,'семья') as author
    from pots p left join guilds g on g.id=p.guild_id left join users u on u.id=p.created_by
    where p.circle_id=$1 and p.status in ('open','reached') order by p.created_at desc`, [ctx.circle])
    .then((rows) => rows.map((r) => ({ ...r, mine: r.created_by === ctx.child, created_by: undefined }))),
  'POST /api/pot/create': async (b, ctx) => {
    const title = String(b.title || '').trim().slice(0, 40);
    const goal = parseInt(b.goal, 10);
    if (title.length < 2) throw { code: 400, msg: 'назови цель' };
    if (!(goal > 0)) throw { code: 400, msg: 'укажи цель в шишках' };
    if (b.guildId) await assertOwn('select 1 from guild_members where guild_id=$1 and child_id=$2', [b.guildId, ctx.child], 'ты не в этой гильдии');
    const p = await one('insert into pots(circle_id, title, goal, created_by, guild_id) values($1,$2,$3,$4,$5) returning id',
      [ctx.circle, title, goal, ctx.child, b.guildId || null]);
    return { ok: true, id: p.id };
  },
  'POST /api/pot/contribute': async (b, ctx) => {
    await assertOwn('select 1 from pots where id=$1 and circle_id=$2', [b.id, ctx.circle], 'нет котла');  // только котёл своей семьи
    let pot;
    try { pot = (await rpc('contribute_pot', [ctx.child, b.id, parseInt(b.amount, 10)]))[0]; }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : 'нет котла' }; }
    return { ok: true, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance, collected: pot.collected, goal: pot.goal };
  },
  'POST /api/pot/delete': async (b, ctx) => {
    const p = await one('select created_by, status from pots where id=$1 and circle_id=$2', [b.id, ctx.circle]);
    if (!p) throw { code: 400, msg: 'котёл не найден' };
    if (p.created_by !== ctx.child) throw { code: 400, msg: 'только создатель может удалить котёл' };
    if (p.status === 'reached') throw { code: 400, msg: 'цель достигнута — жми «Исполнить»' };
    await q("update pots set status='fulfilled' where id=$1", [b.id]);
    return { ok: true };
  },
  'POST /api/pot/fulfill': async (b, ctx) => {
    const p = await one('select created_by, title, status from pots where id=$1 and circle_id=$2', [b.id, ctx.circle]);
    if (!p) throw { code: 400, msg: 'котёл не найден' };
    if (p.created_by !== ctx.child) throw { code: 400, msg: 'только создатель может исполнить' };
    if (p.status !== 'reached') throw { code: 400, msg: 'сначала накопи до цели' };
    try { await rpc('fulfill_pot', [b.id]); }
    catch { throw { code: 400, msg: 'не удалось исполнить' }; }
    return { ok: true };
  },

  // ── Гороскоп ──
  'GET /api/horoscope': async (b, ctx) => { const h = (await rpc('get_daily_horoscope', [ctx.child]))[0]; return { text: h.text, bonus: h.bonus }; },

  // ── Наряды дерева ──
  'GET /api/skins': async (b, ctx) => {
    const u = await one('select avatar_skin from users where id=$1', [ctx.child]);
    return q(`select s.id, s.title, s.price, s.rarity,
        exists(select 1 from user_skins us where us.user_id=$1 and us.skin_id=s.id) as owned,
        (s.id::text = $2) as equipped
        from shop_items s where s.type='skin' order by s.price`, [ctx.child, u.avatar_skin || 'base'])
      .then((rows) => rows.map((r) => ({ id: r.id, title: r.title, price: r.price, rarity: r.rarity, owned: r.owned || r.rarity === 'base', equipped: r.equipped, asset: SKIN_ASSET[r.title] || 'base' })));
  },
  'POST /api/skin/buy': async (b, ctx) => {
    try { await rpc('purchase_skin', [ctx.child, b.id]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : /owned/.test(e.message) ? 'уже есть' : 'нет наряда' }; }
    return { ok: true, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance };
  },
  'POST /api/skin/equip': async (b, ctx) => {
    try { await rpc('equip_skin', [ctx.child, b.id]); }
    catch (e) { throw { code: 400, msg: /not owned/.test(e.message) ? 'сначала купи' : 'нет наряда' }; }
    return { ok: true };
  },

  // Голосовое сообщение: загрузка аудио
  'POST /api/audio': async (b, ctx) => {
    const path = await saveAudio(b.data);
    return { url: '/' + path };
  },
  // ── Почта / Чат ──
  'GET /api/inbox': (b, ctx) => q(`select u.name as from_name, m.type as kind, m.content, m.is_whisper as whisper
      from messages m left join users u on u.id=m.from_user
      where m.to_user=$1 and m.deliver_at<=now() order by m.created_at desc`, [ctx.child]),
  // Диалог с конкретным другом: все сообщения между мной и ним, по возрастанию времени.
  // after_id — только новые после этого id (лёгкий опрос чата без полной перерисовки).
  'POST /api/chat': async (b, ctx) => {
    const withId = b.with;
    if (!withId) throw { code: 400, msg: 'нужен ?with=ID' };
    if (withId === ctx.child) throw { code: 400, msg: 'это ты сам' };
    const peer = await one("select 1 from users where id=$1 and role='child'", [withId]);
    if (!peer) throw { code: 400, msg: 'друг не найден' };
    await q(`update messages set read_at=now() where to_user=$1 and from_user=$2 and read_at is null`, [ctx.child, withId]);
    const afterId = b.after_id || null;
    const params = [ctx.child, withId];
    let afterSql = '';
    if (afterId) {
      params.push(afterId);
      afterSql = ` and m.created_at > coalesce((select created_at from messages where id=$3), '-infinity'::timestamptz)`;
    }
    const msgs = await q(`select m.id, m.type, m.content, m.created_at, m.from_user=$1 as mine, m.read_at is not null as is_read, m.reply_to,
        (select r.content from messages r where r.id=m.reply_to) as reply_content,
        (select u.name from messages r join users u on u.id=r.from_user where r.id=m.reply_to) as reply_by,
        coalesce((select jsonb_agg(jsonb_build_object('emoji',mr.emoji,'by',u.name)) from message_reactions mr
          join users u on u.id=mr.user_id where mr.message_id=m.id), '[]'::jsonb) as reactions
        from messages m where m.deliver_at<=now()
        and ((m.from_user=$1 and m.to_user=$2) or (m.from_user=$2 and m.to_user=$1))
        ${afterSql}
        order by m.created_at asc`, params);
    return msgs;
  },
  // Список чатов: друзья, заявки и те, с кем уже есть письма
  'POST /api/chat/list': async (b, ctx) => {
    const rows = await q(`select u.id, u.name, u.tree_type, u.last_seen > now() - interval '5 minutes' as online,
        (select content from messages m2 where m2.deliver_at<=now()
         and ((m2.from_user=u.id and m2.to_user=$1) or (m2.from_user=$1 and m2.to_user=u.id))
         order by m2.created_at desc limit 1) as last_msg,
        (select m2.created_at from messages m2 where m2.deliver_at<=now()
         and ((m2.from_user=u.id and m2.to_user=$1) or (m2.from_user=$1 and m2.to_user=u.id))
         order by m2.created_at desc limit 1) as last_at,
        (select count(*) from messages m2 where m2.to_user=$1
         and m2.from_user=u.id and m2.read_at is null and m2.deliver_at<=now()) as unread
      from users u
      where u.role='child' and u.id<>$1
        and (
          exists (select 1 from friendships f where f.user_id=$1 and f.friend_id=u.id)
          or exists (select 1 from friendships f where f.user_id=u.id and f.friend_id=$1)
          or exists (
            select 1 from messages m
             where (m.from_user=$1 and m.to_user=u.id) or (m.from_user=u.id and m.to_user=$1)
          )
        )
      order by last_at desc nulls last, u.name`, [ctx.child]);
    return rows.map((r, i) => ({ ...r, avatar: treeAvatar(r.tree_type, i) }));
  },
  // Пометить сообщения от друга как прочитанные
  'POST /api/message/read': async (b, ctx) => {
    const fid = b.from;
    if (!fid) throw { code: 400, msg: 'нужен from' };
    await q(`update messages set read_at=now() where to_user=$1 and from_user=$2 and read_at is null`, [ctx.child, fid]);
    return { ok: true };
  },
  'POST /api/message': async (b, ctx) => {
    const { friends } = await ensureForestTalk(ctx.child, b.to);
    if (!friends) {
      const todayN = await one(
        `select count(*)::int as n from messages
          where from_user=$1
            and created_at >= date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'
            and not exists (
              select 1 from friendships f
               where f.user_id=$1 and f.friend_id=messages.to_user and f.status='accepted'
            )`,
        [ctx.child]);
      if ((todayN?.n || 0) >= 30) {
        throw { code: 429, msg: 'сегодня уже много писем незнакомцам — продолжим завтра' };
      }
    }
    const type = b.type === 'sticker' ? 'sticker' : b.type === 'audio' ? 'audio' : 'emoji';
    // аудио — путь к файлу, не режем до 80 (иначе URL обрежется); эмодзи/стикер — коротко
    let content;
    if (type === 'audio') {
      content = String(b.content || '').replace(/[<>]/g, '').slice(0, 200);
      if (!/^\/uploads\/audio_[\w.-]+$/.test(content)) throw { code: 400, msg: 'сначала запиши голос' };
    } else {
      content = String(b.emoji ?? b.content ?? 'привет').replace(/[<>]/g, '').slice(0, 80) || 'привет';
    }
    const replyId = b.reply_to || null;
    await rpc('send_message', [ctx.child, b.to, type, content, replyId]);
    // push-уведомление получателю
    const sender = await one('select name from users where id=$1', [ctx.child]);
    if (sender) sendPush(b.to, sender.name, type === 'sticker' ? '🦊 Стикер' : type === 'audio' ? '🎤 Голосовое' : content);
    return { ok: true };
  },
  // Реакции на сообщения
  'POST /api/message/react': async (b, ctx) => {
    const msgId = b.message_id; const emoji = String(b.emoji || '').slice(0, 4);
    if (!msgId || !emoji) throw { code: 400, msg: 'нужны message_id и emoji' };
    const ok = await one(
      'select 1 from messages where id=$1 and (from_user=$2 or to_user=$2)',
      [msgId, ctx.child]);
    if (!ok) throw { code: 404, msg: 'сообщение не найдено' };
    // убрать свою предыдущую реакцию (если тапнул тот же emoji — удалить, иначе заменить)
    const exists = await one('select emoji from message_reactions where message_id=$1 and user_id=$2', [msgId, ctx.child]);
    if (exists) {
      if (exists.emoji === emoji) { await q('delete from message_reactions where message_id=$1 and user_id=$2', [msgId, ctx.child]); return { ok: true, removed: true }; }
      await q('update message_reactions set emoji=$2 where message_id=$1 and user_id=$3', [msgId, emoji, ctx.child]);
    } else {
      await q('insert into message_reactions(message_id,user_id,emoji) values($1,$2,$3)', [msgId, ctx.child, emoji]);
    }
    return { ok: true };
  },
  'POST /api/message/reactions': async (b, ctx) => {
    const msgId = b.message_id;
    if (!msgId) throw { code: 400, msg: 'нужен message_id' };
    return await q(`select mr.emoji, u.name from message_reactions mr
      join users u on u.id=mr.user_id where mr.message_id=$1`, [msgId]);
  },
  // Удалить своё сообщение у обоих (как «удалить у всех» в мессенджерах)
  'POST /api/message/delete': async (b, ctx) => {
    const msgId = b.message_id || b.id;
    if (!msgId) throw { code: 400, msg: 'нужен message_id' };
    const row = await one(
      `select id from messages where id=$1 and from_user=$2`,
      [msgId, ctx.child],
    );
    if (!row) throw { code: 404, msg: 'можно удалить только своё сообщение' };
    await q('delete from messages where id=$1', [msgId]);
    return { ok: true };
  },

  // ── Аукцион ──
  'GET /api/auction': async (b, ctx) => {
    await sweepAuctions();   // ленивое закрытие: вдруг дедлайн наступил между тиками таймера
    const a = await one("select a.id, a.title, a.current_bid, a.ends_at, u.name as leader from auctions a left join users u on u.id=a.current_leader where a.status='live' order by a.created_at desc limit 1");
    if (a) return { live: true, ...a };
    // живого нет — показать последний закрытый с победителем
    const last = await one("select a.title, a.current_bid as final_bid, u.name as winner from auctions a left join users u on u.id=a.current_leader where a.status='closed' order by a.created_at desc limit 1");
    return last ? { live: false, ...last } : { live: false };
  },
  'POST /api/bid': async (b, ctx) => {
    const a = await one("select id from auctions where status='live' limit 1"); if (!a) throw { code: 400, msg: 'нет аукциона' };
    try { await rpc('place_bid', [a.id, ctx.child, parseInt(b.amount, 10)]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : /ended/.test(e.message) ? 'аукцион завершён' : /top bidder/.test(e.message) ? 'ты уже лидер' : /beat|below/.test(e.message) ? 'ставка мала' : 'нельзя' }; }
    const nm = (await one('select name from users where id=$1', [ctx.child])).name;
    return { ok: true, current_bid: parseInt(b.amount, 10), leader: nm, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance };
  },

  // ── Страховка ──
  'GET /api/insurance': async (b, ctx) => {
    const c = await one('select insurance_fund from circles where id=$1', [ctx.circle]);
    const claims = await q(`select p.id, p.title, p.amount, tu.name as target,
        (select count(*) from votes where proposal_id=p.id and choice='yes') as yes,
        (select count(*) from votes where proposal_id=p.id and choice='no') as no,
        (case when p.status='passed' then 'accepted' else p.status end) as status, exists(select 1 from votes where proposal_id=p.id and voter_id=$2) as voted
        from proposals p left join users tu on tu.id=p.target_user
        where p.circle_id=$1 and p.type='insurance_claim' order by p.created_at`, [ctx.circle, ctx.child]);
    return { fund: c.insurance_fund, claims };
  },
  'POST /api/premium': async (b, ctx) => {
    try { await rpc('pay_premium', [ctx.child, 1]); }
    catch (e) { throw { code: 400, msg: 'не хватает шишек' }; }
    return { ok: true, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance,
      fund: (await one('select insurance_fund from circles where id=$1', [ctx.circle])).insurance_fund };
  },
  'POST /api/claim': async (b, ctx) => {
    const amount = parseInt(b.amount, 10);
    const reason = String(b.reason || '').trim().slice(0, 60);
    if (!(amount > 0 && amount <= 50)) throw { code: 400, msg: 'сумма от 1 до 50' };
    if (reason.length < 3) throw { code: 400, msg: 'напиши, что случилось' };
    const open = await one(
      `select count(*)::int c from proposals
        where circle_id=$1 and type='insurance_claim' and created_by=$2 and status='voting'`,
      [ctx.circle, ctx.child]);
    if ((open?.c || 0) >= 1) throw { code: 400, msg: 'у тебя уже есть заявка на голосовании' };
    try { await rpc('file_claim', [ctx.child, amount, reason]); }
    catch { throw { code: 400, msg: 'не удалось подать заявку' }; }
    return { ok: true };
  },

  // ── Совет ──
  'GET /api/proposals': (b, ctx) => q(`select p.id, p.type as kind, p.title, (case when p.status='passed' then 'accepted' else p.status end) as status,
      (select count(*) from votes where proposal_id=p.id and choice='yes') as yes,
      (select count(*) from votes where proposal_id=p.id and choice='no') as no,
      exists(select 1 from votes where proposal_id=p.id and voter_id=$2) as voted
      from proposals p where p.circle_id=$1 and p.type<>'insurance_claim' order by p.created_at desc`, [ctx.circle, ctx.child]),
  'POST /api/proposals': async (b, ctx) => {
    const title = String(b.title || '').trim().slice(0, 80);
    if (title.length < 4) throw { code: 400, msg: 'тема слишком короткая' };
    await q(`insert into proposals(circle_id, type, title, created_by)
      values ($1, 'custom', $2, $3)`, [ctx.circle, title, ctx.child]);
    return { ok: true };
  },
  'POST /api/vote': async (b, ctx) => {
    await assertOwn("select 1 from proposals where id=$1 and circle_id=$2", [b.id, ctx.circle], 'нет такой инициативы');  // только своя семья
    try { await rpc('vote_proposal', [b.id, ctx.child, b.choice === 'yes' ? 'yes' : 'no']); }
    catch (e) { throw { code: 400, msg: /closed/.test(e.message) ? 'голосование закрыто' : 'нельзя' }; }
    // закрываем ТОЛЬКО когда проголосовали все дети-игроки семьи (кворум), а не по первому голосу
    const voters = Number((await one('select count(*) c from votes where proposal_id=$1', [b.id])).c);
    const players = Number((await one('select count(*) c from child_logins cl join users u on u.id=cl.child_id where u.circle_id=$1', [ctx.circle])).c);
    if (voters >= players) { try { await rpc('close_proposal', [b.id]); } catch {} }
    const st = await one('select status from proposals where id=$1', [b.id]);
    return { ok: true, status: st.status === 'passed' ? 'accepted' : st.status };
  },

  // ── Гильдия ──
  'GET /api/guilds': async (b, ctx) => {
    const gs = await q("select g.id, g.name, g.status from guilds g where g.circle_id=$1 and g.status in ('open','sleeping') order by g.created_at", [ctx.circle]);
    const out = [];
    for (const g of gs) {
      const members = await q('select u.id, u.name, gm.share, gm.role from guild_members gm join users u on u.id=gm.child_id where gm.guild_id=$1 order by gm.role asc, gm.share desc, u.name', [g.id]);
      out.push({ id: g.id, name: g.name, status: g.status, members: members.map((m) => ({ id: m.id, name: m.name, share: m.share, role: m.role, mine: m.id === ctx.child })), mine: members.some((m) => m.id === ctx.child) });
    }
    return out;
  },
  'POST /api/guild/create': async (b, ctx) => {
    const name = String(b.name || "").replace(/[<>]/g, "").trim().slice(0, 24);
    if (name.length < 2) throw { code: 400, msg: 'придумай название' };
    const dup = await one("select 1 from guilds where circle_id=$1 and status='open' and lower(name)=lower($2)", [ctx.circle, name]);
    if (dup) throw { code: 400, msg: 'такая гильдия уже есть' };
    const g = (await rpc('create_guild', [ctx.child, name]))[0];
    return { ok: true, id: g.id, name };
  },
  'POST /api/guild/join': async (b, ctx) => {
    await assertOwn("select 1 from guilds where id=$1 and circle_id=$2 and status='open'", [b.id, ctx.circle], 'нет такой гильдии');
    await rpc('join_guild', [b.id, ctx.child]);
    await rpc('bump_guild_activity', [b.id]).catch(() => {});
    await q('insert into guild_history(guild_id, kind, title) values($1,$2,$3)', [b.id, 'member_joined', (await one('select name from users where id=$1', [ctx.child])).name]);
    return { ok: true };
  },
  'POST /api/guild/chat': async (b, ctx) => {   // POST: id в теле (GET-обёртка без параметров)
    await assertOwn('select 1 from guild_members where guild_id=$1 and child_id=$2', [b.id, ctx.child], 'ты не в этой гильдии');
    const rows = await q(`select coalesce(u.name,'Банк') as who, gm.content, gm.created_at at from guild_messages gm
      left join users u on u.id=gm.from_user where gm.guild_id=$1 order by gm.created_at desc limit 50`, [b.id]);
    return rows.reverse();
  },
  'POST /api/guild/say': async (b, ctx) => {
    if (!GUILD_PHRASES.has(b.phrase)) throw { code: 400, msg: 'выбери фразу' };   // свободного текста нет — этика
    await assertOwn('select 1 from guild_members where guild_id=$1 and child_id=$2', [b.id, ctx.child], 'ты не в этой гильдии');
    await q('insert into guild_messages(guild_id, from_user, content) values($1,$2,$3)', [b.id, ctx.child, b.phrase]);
    await rpc('bump_guild_activity', [b.id]).catch(() => {});
    return { ok: true };
  },
  'POST /api/guild/role': async (b, ctx) => {
    await assertOwn("select 1 from guild_members where guild_id=$1 and child_id=$2 and role='founder'", [b.id, ctx.child], 'только основатель');
    await rpc('guild_set_role', [b.id, b.childId, b.role, ctx.child]);
    return { ok: true };
  },
  'POST /api/guild/share': async (b, ctx) => {
    await assertOwn("select 1 from guild_members where guild_id=$1 and child_id=$2 and role in ('founder','treasurer')", [b.id, ctx.child], 'только казначей или основатель');
    await rpc('guild_set_share', [b.id, b.childId, b.share, ctx.child]);
    return { ok: true };
  },
  'POST /api/guild/awaken': async (b, ctx) => {
    await assertOwn('select 1 from guild_members where guild_id=$1 and child_id=$2', [b.id, ctx.child], 'ты не в этой гильдии');
    await rpc('guild_awaken', [b.id]);
    return { ok: true };
  },
  'POST /api/guild/history': async (b, ctx) => {
    await assertOwn('select 1 from guild_members where guild_id=$1 and child_id=$2', [b.id, ctx.child], 'ты не в этой гильдии');
    return await q('select kind, title, amount, created_at at from guild_history where guild_id=$1 order by created_at desc limit 30', [b.id]);
  },

  // ── Нарративный квест ──
  'GET /api/quest': async (b, ctx) => {
    const qu = await one("select id, title, current_step, status from quests where circle_id=$1 and status='active' limit 1", [ctx.circle]);
    if (!qu) return { done: true };
    const st = await one('select step_order as ord, kind, text, goal, progress from quest_steps where quest_id=$1 and step_order=$2', [qu.id, qu.current_step]);
    return { title: qu.title, status: qu.status, step: st };
  },
  'POST /api/quest/act': async (b, ctx) => {
    const qu = await one("select id, current_step from quests where circle_id=$1 and status='active' limit 1", [ctx.circle]);
    if (!qu) return { done: true };
    const st = await one('select kind from quest_steps where quest_id=$1 and step_order=$2', [qu.id, qu.current_step]);
    try {
      if (st.kind === 'collect') await rpc('quest_contribute', [ctx.child, qu.id, parseInt(b.amount || 5, 10)]);
      else if (st.kind === 'task') await rpc('quest_action', [ctx.child, qu.id]);
    } catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : 'не получилось' }; }
    return api['GET /api/quest'](b, ctx);
  },
  'POST /api/quest/advance': async (b, ctx) => {
    const qu = await one("select id from quests where circle_id=$1 and status='active' limit 1", [ctx.circle]);
    if (!qu) return { done: true };
    try { await rpc('advance_quest', [qu.id]); }
    catch (e) { throw { code: 400, msg: /not complete|not done/.test(e.message) ? 'шаг не завершён' : 'нельзя' }; }
    return api['GET /api/quest'](b, ctx);
  },


  // ── прочее ──
  'POST /api/onboard': async (b, ctx) => {
    if (!ctx.child) throw { code: 401, msg: 'нужен код' };
    const name = String(b.name || '').replace(/[<>]/g, '').trim().slice(0, 16);
    if (name.length < 2) throw { code: 400, msg: 'как назовём дерево?' };
    const tree = ['pine', 'cedar', 'spruce'].includes(b.tree) ? b.tree : 'pine';
    await q('update users set name=$1, tree_type=$2 where id=$3', [name, tree, ctx.child]);
    return { ok: true };
  },
  'POST /api/shop/create': async (b, ctx) => {
    const name = String(b.name || '').trim(), lot = String(b.lot || '').trim(), price = parseInt(b.price, 10);
    if (!name || !lot) throw { code: 400, msg: 'заполни название лавки и товар' };
    if (!(price > 0)) throw { code: 400, msg: 'укажи цену больше 0' };
    try { await rpc('open_shop', [ctx.child, name.slice(0, 24), null]); }
    catch (e) { throw { code: 400, msg: /already has/.test(e.message) ? 'у тебя уже есть лавка' : 'не удалось' }; }
    await rpc('add_lot', [ctx.child, lot.slice(0, 24), 'goods', price]);
    return { ok: true };
  },
  'POST /api/shop/rename': async (b, ctx) => {
    const name = String(b.name || "").replace(/[<>]/g, "").trim().slice(0, 24);
    if (!name) throw { code: 400, msg: 'укажи название' };
    await assertOwn('select 1 from shops where owner_id=$1', [ctx.child], 'нет лавки');
    await q('update shops set name=$2 where owner_id=$1', [ctx.child, name]);
    return { ok: true };
  },
  'POST /api/shop/close': async (b, ctx) => {
    await assertOwn('select 1 from shops where owner_id=$1', [ctx.child], 'нет лавки');
    await q('update shops set is_active=false where owner_id=$1', [ctx.child]);
    return { ok: true };
  },
  'POST /api/shop/photo': async (b, ctx) => {
    await assertOwn('select 1 from shops where owner_id=$1', [ctx.child], 'нет лавки');
    const photo = await savePhoto(b.photo, 'shop_' + ctx.child);
    await q('update shops set photo=$2 where owner_id=$1', [ctx.child, photo]);
    return { ok: true, photo };
  },
  'POST /api/lot/add': async (b, ctx) => {
    const title = String(b.title || '').trim().slice(0, 24), price = parseInt(b.price, 10);
    if (!title) throw { code: 400, msg: 'укажи название товара' };
    if (!(price > 0)) throw { code: 400, msg: 'укажи цену больше 0' };
    let lot;
    try { [lot] = await rpc('add_lot', [ctx.child, title, 'goods', price]); }
    catch (e) { throw { code: 400, msg: /open a shop/.test(e.message) ? 'сначала открой лавку' : 'не удалось' }; }
    if (b.photo) { const photo = await savePhoto(b.photo, 'lot_' + lot.id); await q('update shop_lots set photo=$2 where id=$1', [lot.id, photo]); }
    return { ok: true };
  },
  'POST /api/lot/edit': async (b, ctx) => {
    const title = String(b.title || '').trim().slice(0, 24), price = parseInt(b.price, 10);
    if (!title) throw { code: 400, msg: 'укажи название товара' };
    if (!(price > 0)) throw { code: 400, msg: 'укажи цену больше 0' };
    await assertOwn('select 1 from shop_lots l join shops s on s.id=l.shop_id where l.id=$1 and s.owner_id=$2', [b.id, ctx.child], 'нет такого товара');
    await q('update shop_lots set title=$2, price=$3 where id=$1', [b.id, title, price]);
    return { ok: true };
  },
  'POST /api/lot/remove': async (b, ctx) => {
    await assertOwn('select 1 from shop_lots l join shops s on s.id=l.shop_id where l.id=$1 and s.owner_id=$2', [b.id, ctx.child], 'нет такого товара');
    await q('update shop_lots set is_active=false where id=$1', [b.id]);
    return { ok: true };
  },
  'POST /api/lot/photo': async (b, ctx) => {
    await assertOwn('select 1 from shop_lots l join shops s on s.id=l.shop_id where l.id=$1 and s.owner_id=$2', [b.id, ctx.child], 'нет такого товара');
    const photo = await savePhoto(b.photo, 'lot_' + b.id);
    await q('update shop_lots set photo=$2 where id=$1', [b.id, photo]);
    return { ok: true, photo };
  },
};
// ── Push-уведомления ──
const SKIN_ASSET = { 'Обычное дерево': 'base', 'Осеннее дерево': 'skin_autumn', 'Зимнее дерево': 'skin_winter', 'Золотое дерево': 'skin_gold', 'Светящееся дерево': 'skin_glow', 'Радужное дерево': 'skin_rainbow' };

const MAX_BODY = 10 * 1024 * 1024;

// ── Нативные пуши APK: WebSocket /api/push/ws?token=deviceToken ──
const apkSockets = new Map(); // userId -> Set<WebSocket>
function deliverApkPush(userId, title, body, url) {
  const set = apkSockets.get(String(userId));
  if (!set || !set.size) return;
  const payload = JSON.stringify({
    title: String(title || 'Шишка Банк'),
    body: String(body || ''),
    url: String(url || 'https://elka-kvest-2026.ru/mail.html'),
  });
  for (const ws of set) {
    try { if (ws.readyState === 1) ws.send(payload); } catch {}
  }
}
function broadcastPush(userId, title, body, url) {
  deliverApkPush(userId, title, body, url);
  if (cluster.isWorker && typeof process.send === 'function') {
    try { process.send({ type: 'apk-push', userId: String(userId), title, body, url }); } catch {}
  }
}
if (cluster.isWorker) {
  process.on('message', (msg) => {
    if (msg && msg.type === 'apk-push') deliverApkPush(msg.userId, msg.title, msg.body, msg.url);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  for (const [k, v] of SEC) res.setHeader(k, v);
  if (url.pathname.startsWith('/api/')) {
    let body = {};
    if (req.method === 'POST') { body = await readBody(req, res); if (body === null) return; }
    const route = `${req.method} ${url.pathname}`;
    const handler = api[route];
    if (!handler) { res.writeHead(404); return res.end('{}'); }
    const isParent = url.pathname.startsWith('/api/parent/');
    const guarded = isParent || route === 'POST /api/link' || route === 'POST /api/recover';
    const ip = clientIp(req);
    try {
      if (guarded && isLocked(ip)) throw { code: 429, msg: 'Слишком много попыток — подожди 10 минут.' };
      if (!guarded && !childRateCheck(ip)) throw { code: 429, msg: 'Слишком много запросов — подожди полминуты.' };
      // родительский контур: PIN опционален (проверка только если PARENT_PIN задан)
      if (isParent) {
        if (PARENT_PIN && (req.headers['x-parent-pin'] || '') !== PARENT_PIN) { badTry(ip); throw { code: 401, msg: 'нужен PIN родителя' }; }
        okTry(ip);
      }
      const ctx = await auth.resolve(req);
      // детские endpoint'ы требуют валидный код/токен (иначе 401, а не 500/пустота)
      if (!ctx.child && !PUBLIC.has(route) && !isParent) throw { code: 401, msg: 'нужен код входа' };
      // статус «в лесу»: обновляем время последней активности (не на каждом пинге)
      if (ctx.child && route !== 'GET /api/ping') q(`update users set last_seen=now() where id=$1`, [ctx.child]).catch(() => {});
      let result;
      if (route === 'POST /api/link') {   // неверный код (throw 400) считаем промахом, верный — сбрасывает счётчик
        try { result = await handler(body, ctx); okTry(ip); }
        catch (e) { badTry(ip); throw e; }
      } else if (route === 'POST /api/recover') {
        try { result = await handler(body, ctx, req); okTry(ip); }
        catch (e) { badTry(ip); throw e; }
      } else if (route === 'POST /api/signup' || route === 'GET /api/signup/hint') {
        result = await handler(body, ctx, req);
      } else result = await handler(body, ctx);
      const out = JSON.stringify(result);
      res.writeHead(200); res.end(out);
    } catch (e) {
      // e.code бывает СТРОКОЙ от pg ('23503', 'P0001') — в writeHead только валидный HTTP-статус, иначе краш всего сервера
      const status = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 500;
      if (status >= 500) console.error(`[${route}]`, e.message || e.msg || e);   // реальные ошибки — в лог, не проглатывать
      res.writeHead(status); res.end(JSON.stringify({ error: e.msg || 'что-то пошло не так, попробуй ещё раз' }));
    }
    return;
  }
  const [status, body, headers] = await serveStatic(url.pathname, DIR);
  res.writeHead(status, headers || {});
  res.end(body);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname !== '/api/push/ws') { socket.destroy(); return; }
    const token = url.searchParams.get('token') || '';
    if (!token) { socket.destroy(); return; }
    const row = await one(
      `select d.child_id from device_tokens d
         where d.token_hash=$1 and d.revoked_at is null`, [auth.hash(token)]);
    if (!row) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const uid = String(row.child_id);
      let set = apkSockets.get(uid);
      if (!set) { set = new Set(); apkSockets.set(uid, set); }
      set.add(ws);
      ws.on('close', () => {
        set.delete(ws);
        if (!set.size) apkSockets.delete(uid);
      });
      ws.on('error', () => { try { ws.close(); } catch {} });
      try { ws.send(JSON.stringify({ ok: true })); } catch {}
    });
  } catch {
    try { socket.destroy(); } catch {}
  }
});

server.listen(Number(process.env.PORT) || 3777, function () {
  console.log('Шишка Банк → http://localhost:' + this.address().port);
});
