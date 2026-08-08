// Node-прокси Шишка Банк → PostgreSQL (прод-схема + функции).
// Кластеризация: master форкает N воркеров (по числу ядер), каждый на своём event loop.
// Rate-limit — per-worker (достаточно для детского приложения).
// Запуск: DATABASE_URL="postgres://..." PARENT_PIN=1234 node server-pg.mjs
import { createServer } from 'node:http';


import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { randomInt } from 'node:crypto';
import { makeAuth } from './lib/auth.mjs';
import { SEC, serveStatic, readBody, json, logError } from './lib/http.mjs';

// Код входа ребёнка: криптослучайный, из алфавита без двусмысленных символов (нет 0/O/1/I/L).
// Раньше был предсказуемым (ИМЯ+порядковый номер) и ломался на букве Ё — теперь развязан от имени.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genLoginCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

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
// base64-webm -> file
async function saveAudio(dataUrl) {
  const m = /^data:audio\/[^;]+;base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw { code: 400, msg: 'bad audio' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 2e6) throw { code: 400, msg: 'too long' };
  const path = `uploads/audio_${Date.now()}_${randomInt(1e6)}.webm`;
  await writeFile(join(DIR, path), buf);
  return path;
}

const TREE = { pine: 'tree.webp', spruce: 'tree3.webp', cedar: 'tree4.webp', oak: 'tree5.webp' };
const FRIEND_AV = ['friend1.webp', 'friend2.webp', 'friend3.webp'];
const PARENT_PIN = process.env.PARENT_PIN || '';                  // PIN родительского кабинета (опционально)
const PUBLIC = new Set(['POST /api/link', 'GET /api/ping']); // роуты без кода ребёнка
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
const api = {
  'POST /api/push/subscribe': async (b, ctx) => {
    const sub = b.subscription;
    if (!sub?.endpoint) throw { code: 400, msg: 'нужна подписка' };
    await q('insert into push_subscriptions(user_id, subscription) values($1,$2) on conflict(user_id) do update set subscription=$2, updated_at=now()', [ctx.child, JSON.stringify(sub)]);
    return { ok: true };
  },
  'GET /api/parent/state': async () => {
    const [kids, tx, treasury] = await Promise.all([
      one('select count(*)::int c from users where role=$1', ['child']),
      one("select count(*)::int c from transactions where created_at > now() - interval '1 day'"),
      one('select treasury from bank_account where id=$1', ['main']),
    ]);
    return { totalKids: kids?.c || 0, txToday: tx?.c || 0, treasury: treasury?.treasury || 0, online: 0 };
  },
  'GET /api/parent/report': async () => {
    const topSellers = await q(
      `select u.name, s.name as shop, count(o.id)::int deals, coalesce(sum(o.price),0)::int revenue
       from orders o join shop_lots l on l.id=o.lot_id join shops s on s.id=l.shop_id
       join users u on u.id=o.seller_id
       where o.status='delivered' and o.created_at > now() - interval '7 days'
       group by u.name, s.name order by revenue desc limit 10`);
    return { topSellers };
  },
  'GET /api/ping': async () => {
    let db = 'error', dberr = '';
    try { await pool.query('select 1'); db = 'ok'; } catch (e) { dberr = e.message || ''; }
    return { ok: true, ts: Date.now(), db, dberr, uptime: Math.floor(process.uptime()) };
  },
  'POST /api/link': async (b) => {
    const r = await one('select u.name from child_logins cl join users u on u.id=cl.child_id where cl.code=$1', [String(b.code || '').toUpperCase().trim()]);
    if (!r) throw { code: 400, msg: 'код не найден' };
    return { ok: true, name: r.name };
  },

  'GET /api/state': async (b, ctx) => {
    const [u, w] = await Promise.all([
      one("select name,tree_level,tree_type,avatar_skin,current_streak, (last_visit is distinct from (now() at time zone 'Europe/Moscow')::date) as can_claim_daily from users where id=$1", [ctx.child]),
      one('select balance,total_earned,total_spent from wallets where user_id=$1', [ctx.child]),
    ]);
    // питомцы на поляне: массив (до 5), каждый с фразой
    const familiars = await q(`select t.code, t.name, t.category, f.grade, l.title, r.color,
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
    return { name: u.name, tree_level: u.tree_level, balance: w.balance, total_earned: w.total_earned, total_spent: w.total_spent, tree_asset, skin_on,
             streak: u.current_streak, can_claim_daily: u.can_claim_daily, familiars };
  },

  // Ежедневный подарок: серия + растущий бонус + вехи + авто-защитник (всё в daily_visit)
  'POST /api/daily': async (b, ctx) => {
    const r = await one('select daily_visit($1) as v', [ctx.child]);
    return r.v;
  },

  'GET /api/tasks': async (b, ctx) => {
    await rpc('ensure_daily_tasks', [ctx.child]).catch(() => {});
    return (await q('select id,title,reward,needs_photo,status from tasks where child_id=$1 order by created_at', [ctx.child]))
      .map((t) => ({ id: t.id, title: t.title, reward: t.reward, needs_photo: t.needs_photo, status: t.status === 'pending_review' ? 'submitted' : t.status }));
  },
  'POST /api/task/done': async (b, ctx) => {
    const t = await one('select needs_photo,status from tasks where id=$1 and child_id=$2', [b.id, ctx.child]);  // только своё задание
    if (!t || t.status === 'done' || t.status === 'pending_review') throw { code: 400, msg: 'задание недоступно' };
    let proof = null;
    if (t.needs_photo) proof = await savePhoto(b.photo, 'task_' + b.id);   // фото обязательно: base64-jpeg → файл на диске → url в задании
    await rpc('submit_task', [b.id, proof]);   // ВСЁ через модерацию ведущего (решение 11.07)
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, submitted: true, balance: w.balance };
  },

  'GET /api/shop': (b, ctx) => memoGet('shop:' + ctx.circle, 6e4, () =>
    q("select id,title,price from shop_items where type='impression' and is_active and (circle_id=$1 or circle_id is null) order by price", [ctx.circle])),
  'POST /api/shop/buy': async (b, ctx) => {
    await assertOwn('select 1 from shop_items where id=$1 and is_active and (circle_id=$2 or circle_id is null)', [b.id, ctx.circle], 'нет такого приза');
    try { await rpc('purchase_item', [ctx.child, b.id]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : 'нет такого приза' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, balance: w.balance };
  },

  'GET /api/friends': (b, ctx) => q("select id,name from users where circle_id=$1 and role='child' and id<>$2 order by created_at", [ctx.circle, ctx.child])
    .then((rows) => rows.map((r, i) => ({ id: r.id, name: r.name, avatar: FRIEND_AV[i % 3] }))),
  'POST /api/transfer': async (b, ctx) => {
    let to = b.to;
    if (!to && b.toCode) {   // перевод по QR: получатель задан кодом, id наружу не светим
      const r = await one('select u.id from child_logins cl join users u on u.id=cl.child_id where cl.code=$1 and u.circle_id=$2', [String(b.toCode).toUpperCase().trim(), ctx.circle]);
      if (!r) throw { code: 400, msg: 'код не найден' };
      to = r.id;
    }
    if (to === ctx.child) throw { code: 400, msg: 'себе дарить нельзя' };
    b = { ...b, to };
    await assertOwn("select 1 from users where id=$1 and circle_id=$2 and role='child'", [b.to, ctx.circle], 'нет такого друга');  // только своя семья
    try { await rpc('transfer_cones', [ctx.child, b.to, parseInt(b.amount, 10), 'Подарок другу']); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : 'не получилось' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    sendPush(b.to, "🎁 Подарок!", "Тебе пришёл подарок от друга").catch(() => {});
    return { ok: true, balance: w.balance };
  },

  'POST /api/surprise': async (b, ctx) => {   // анонимный подарок «Шишка-сюрприз»
    await assertOwn("select 1 from users where id=$1 and circle_id=$2 and role='child'", [b.to, ctx.circle], 'нет такого друга');
    if (b.to === ctx.child) throw { code: 400, msg: 'себе нельзя' };
    try { await rpc('transfer_surprise', [ctx.child, b.to, parseInt(b.amount, 10)]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : 'не получилось' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    sendPush(b.to, "🎁 Шишка-сюрприз!", "Кто-то прислал тебе анонимный подарок").catch(() => {});
    return { ok: true, balance: w.balance };
  },
  'GET /api/gifts/received': (b, ctx) => q(`select t.amount, u.name as sender, t.created_at at
    from transactions t join users u on u.id=t.from_user
    where t.to_user=$1 and t.type='transfer' and t.from_user is not null
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
      where s.circle_id=$1 and s.is_active
      group by s.id, u.tree_type order by s.created_at`, [ctx.circle]);
    return rows.map((s) => ({ id: s.id, name: s.name, photo: s.photo, is_heir: s.is_heir, mine: s.owner_id === ctx.child,
      avatar: TREE[s.tree_type] || 'tree.webp', lots: s.lots }));
  },
  'POST /api/lot/buy': async (b, ctx) => {
    await assertOwn('select 1 from shop_lots l join shops s on s.id=l.shop_id where l.id=$1 and s.circle_id=$2', [b.id, ctx.circle], 'нет такого лота');
    try { await rpc('reserve_lot', [ctx.child, b.id]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : /own shop/.test(e.message) ? 'это твоя лавка' : 'нет такого лота' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, balance: w.balance };
  },

  'GET /api/profile': async (b, ctx) => {
    const u = await one('select name,tree_level,reputation from users where id=$1', [ctx.child]);
    const badges = await q('select badge_type as code from badges where user_id=$1', [ctx.child]);
    const titles = { guardian: 'Хранитель', philanthropist: 'Меценат', saver: 'Спаситель' };
    return { name: u.name, tree_level: u.tree_level, reputation: u.reputation,
      badges: badges.map((x) => ({ code: x.code, title: titles[x.code] || x.code })) };
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
    return (row.data || []).map((a) => {
      const track = (a.code || '').split('_')[0];
      return { code: a.code, title: a.title, desc: achDesc(track, a.threshold) || a.title, threshold: a.threshold,
        track, current: Math.min(a.current || 0, a.threshold), unlocked: !!a.unlocked };
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
    const p = await one('select created_by from pots where id=$1 and circle_id=$2', [b.id, ctx.circle]);
    if (!p) throw { code: 400, msg: 'котёл не найден' };
    if (p.created_by !== ctx.child) throw { code: 400, msg: 'только создатель может удалить котёл' };
    await q("update pots set status='fulfilled' where id=$1", [b.id]);
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

  // ── Лесная коллекция (карточки) ──
  'GET /api/cards': async (b, ctx) => {
    const [types, rar, owned, lore, seasons, packs, fam, history, facts] = await Promise.all([
      q('select id, code, name, category, sort, season, occasion from card_types order by sort'),
      q('select grade, code, name, color, price, quicksell, weight from rarities order by grade'),
      q('select type_id, grade, qty, merged from user_cards where user_id=$1', [ctx.child]),
      q('select category, grade, title, lore from card_lore'),
      q('select code, name, sort, status from card_seasons order by sort'),
      one('select packs_opened from users where id=$1', [ctx.child]),
      q('select type_id as type, grade from familiars where user_id=$1', [ctx.child]),
      // факт открывается только за собранное целиком существо — иначе его можно было бы подсмотреть
      q(`select t.code, l.grade, round(avg(l.price))::int as avg, count(*)::int as deals
         from card_listings l join card_types t on t.id=l.type_id
         where l.circle_id=$1 and l.status='sold' group by t.code, l.grade`, [ctx.circle]),
      q(`select f.code, f.fact from card_facts f join card_types t on t.code=f.code
         where (select count(distinct uc.grade) from user_cards uc
                where uc.user_id=$1 and uc.type_id=t.id and uc.qty>0) = 6`, [ctx.child]),
    ]);
    const own = {};   // type_id → {grade: {qty, merged}}
    for (const r of owned) { (own[r.type_id] ||= {})[r.grade] = { qty: r.qty, merged: r.merged }; }
    const cards = types.map((t) => {
      const have = own[t.id] || {};
      const grades = rar.map((g) => ({ grade: g.grade, qty: (have[g.grade] || {}).qty || 0, merged: (have[g.grade] || {}).merged || 0 }));
      const best = grades.filter((g) => g.qty > 0).reduce((m, g) => Math.max(m, g.grade), 0);
      return { id: t.id, code: t.code, name: t.name, category: t.category, season: t.season,
               occasion: t.occasion, grades, best, owned: best > 0 };
    });
    // гарант: каждый 10-й пак — недостающая карта, каждый 50-й — недостающая Эпическая+
    const opened = (packs && packs.packs_opened) || 0;
    const pity = { opened, to_new: 10 - (opened % 10), to_top: 50 - (opened % 50) };
    const marketAllowed = await one('select market_allowed from users where id=$1', [ctx.child]);
    const familiars = (fam || []).filter((f) => f.type);
    return { rarities: rar, cards, lore, facts, history, seasons, pity,
             market_allowed: marketAllowed ? marketAllowed.market_allowed : true,
             familiars,
             collected: cards.filter((c) => c.owned && c.category !== 'special').length,
             total: cards.filter((c) => c.category !== 'special').length };
  },
  'POST /api/familiar': async (b, ctx) => {
    try {
      if (b.remove) return await one('select remove_familiar($1,$2,$3) as v', [ctx.child, b.type, b.grade]).then((r) => r.v);
      return await one('select add_familiar($1,$2,$3) as v', [ctx.child, b.type, b.grade]).then((r) => r.v);
    }
    catch (e) { throw { code: 400, msg: /no card/.test(e.message) ? 'этой карты у тебя нет'
      : /already/.test(e.message) ? 'уже твой питомец' : /max 5/.test(e.message) ? 'максимум 5 питомцев' : 'нельзя' }; }
  },
  'POST /api/pack/open': async (b, ctx) => {
    let r;
    try { r = await one('select open_pack($1) as v', [ctx.child]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек на пак' : 'не получилось' }; }
    const rewards = (await one('select check_card_rewards($1) as v', [ctx.child])).v;
    return { cards: r.v, rewards, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance };
  },
  'POST /api/card/merge': async (b, ctx) => {
    let r;
    try { r = await one('select merge_cards($1,$2,$3) as v', [ctx.child, b.type, b.grade]).then((x) => x.v); }
    catch (e) { throw { code: 400, msg: /need 3/.test(e.message) ? 'нужно 3 одинаковых' : /max grade/.test(e.message) ? 'выше некуда' : 'нельзя' }; }
    const rewards = (await one('select check_card_rewards($1) as v', [ctx.child])).v;
    return { ...r, rewards };
  },
  'POST /api/card/merge-fuel': async (b, ctx) => {   // 2 своих + 4 любых того же ранга
    let r;
    try { r = await one('select merge_with_fuel($1,$2,$3,$4) as v', [ctx.child, b.type, b.grade, !!b.allow_unique]).then((x) => x.v); }
    catch (e) {
      // «нужны единственные» — не ошибка, а вопрос: клиент переспрашивает и повторяет с allow_unique
      if (/needs unique/.test(e.message)) throw { code: 409, msg: 'придётся сжечь карты, которые есть в единственном экземпляре' };
      throw { code: 400, msg: /need 2 own/.test(e.message) ? 'нужно 2 такие карты'
        : /need 4 fuel/.test(e.message) ? 'не хватает карт того же ранга'
        : /plain merge/.test(e.message) ? 'у тебя есть 3 такие — прокачивай обычным способом'
        : /max grade/.test(e.message) ? 'выше некуда' : 'нельзя' };
    }
    const rewards = (await one('select check_card_rewards($1) as v', [ctx.child])).v;
    return { ...r, rewards };
  },
  'POST /api/card/exchange': async (b, ctx) => {   // 5 лишних одного ранга → 1 недостающая того же ранга
    let r;
    try { r = await one('select exchange_cards($1,$2) as v', [ctx.child, b.grade]).then((x) => x.v); }
    catch (e) { throw { code: 400, msg: /need 5 spare/.test(e.message) ? 'нужно 5 лишних карт этого ранга' : 'нельзя' }; }
    const rewards = (await one('select check_card_rewards($1) as v', [ctx.child])).v;
    return { ...r, rewards };
  },
  'POST /api/card/gift': async (b, ctx) => {   // подарок карты другу: лимит 3 в день, лог у ведущего
    await assertOwn("select 1 from users where id=$1 and circle_id=$2 and role='child' and id<>$3", [b.to, ctx.circle, ctx.child], 'выбери, кому подарить');
    try { return await one('select gift_card($1,$2,$3,$4) as v', [ctx.child, b.to, b.type, b.grade]).then((r) => r.v); }
    catch (e) {
      throw { code: 400, msg: /daily gift limit/.test(e.message) ? 'сегодня уже подарено 3 карты — завтра можно снова'
        : /no card/.test(e.message) ? 'этой карты у тебя нет' : 'нельзя' };
    }
  },
  'POST /api/card/sell': async (b, ctx) => {
    try { const r = await one('select sell_card_to_bank($1,$2,$3) as v', [ctx.child, b.type, b.grade]).then((x) => x.v);
      return { ...r, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance }; }
    catch (e) { throw { code: 400, msg: /no card/.test(e.message) ? 'нет такой карты' : 'нельзя' }; }
  },
  'GET /api/market': async (b, ctx) => q(`select l.id, l.price, l.grade, t.code, t.name, t.category, u.name as seller,
      r.price as nominal, (l.seller_id=$1) as mine,
      (select round(avg(s.price))::int from card_listings s
         where s.circle_id=l.circle_id and s.type_id=l.type_id and s.grade=l.grade and s.status='sold') as avg_price
      from card_listings l join card_types t on t.id=l.type_id
      join users u on u.id=l.seller_id join rarities r on r.grade=l.grade
      where l.circle_id=$2 and l.status='open' order by l.created_at desc`,
      [ctx.child, ctx.circle]),
  'POST /api/card/list': async (b, ctx) => {
    try { return await one('select list_card($1,$2,$3,$4) as v', [ctx.child, b.type, b.grade, parseInt(b.price, 10)]).then((r) => r.v); }
    catch (e) { throw { code: 400, msg: /no card/.test(e.message) ? 'нет такой карты' : /range/.test(e.message) ? 'цена вне допустимого' : 'нельзя' }; }
  },
  'POST /api/market/buy': async (b, ctx) => {
    try { const r = await one('select buy_listing($1,$2) as v', [ctx.child, b.id]).then((x) => x.v);
      const rewards = (await one('select check_card_rewards($1) as v', [ctx.child])).v;
      return { ...r, rewards, listing: b.id, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance }; }
    catch (e) { throw { code: 400, msg: /market disabled/.test(e.message) ? 'ведущий пока закрыл рынок' : /not enough/.test(e.message) ? 'не хватает шишек' : /own/.test(e.message) ? 'это твой лот' : 'лот недоступен' }; }
  },
  'POST /api/market/undo': async (b, ctx) => {   // отмена покупки в течение 5 минут
    try { return await one('select undo_purchase($1,$2) as v', [ctx.child, b.id]).then((r) => r.v); }
    catch (e) { throw { code: 400, msg: /window passed/.test(e.message) ? 'время отмены вышло' : /already gone/.test(e.message) ? 'карты уже нет' : 'нельзя отменить' }; }
  },
  'POST /api/market/cancel': async (b, ctx) => {
    try { return await one('select cancel_listing($1,$2) as v', [ctx.child, b.id]).then((r) => r.v); }
    catch (e) { throw { code: 400, msg: 'нельзя снять' }; }
  },

  // ── Аукцион золотых карт ──
  'GET /api/card-auctions': (b, ctx) => q(`select a.id, a.grade, a.start_price, a.current_bid, a.ends_at,
      t.code, t.name, u.name as seller, lu.name as leader,
      (a.seller_id=$1) as mine, (a.leader_id=$1) as leading,
      case when a.current_bid is null then a.start_price
           else greatest(a.current_bid+1, a.current_bid + a.current_bid/10) end as next_bid
      from card_auctions a join card_types t on t.id=a.type_id
      join users u on u.id=a.seller_id left join users lu on lu.id=a.leader_id
      where a.circle_id=$2 and a.status='live' order by a.ends_at`, [ctx.child, ctx.circle]),
  'POST /api/card-auction/start': async (b, ctx) => {
    try { return await one('select start_card_auction($1,$2,$3,$4) as v', [ctx.child, b.type, b.grade, parseInt(b.price, 10)]).then((r) => r.v); }
    catch (e) {
      throw { code: 400, msg: /market disabled/.test(e.message) ? 'ведущий пока закрыл рынок' : /no card/.test(e.message) ? 'нет такой карты'
        : /already live/.test(e.message) ? 'твой аукцион уже идёт — дождись его конца'
        : /range/.test(e.message) ? 'цена вне допустимого' : 'нельзя' };
    }
  },
  'POST /api/card-auction/bid': async (b, ctx) => {
    try { const r = await one('select bid_card_auction($1,$2,$3) as v', [ctx.child, b.id, parseInt(b.amount, 10)]).then((x) => x.v);
      return { ...r, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance }; }
    catch (e) {
      throw { code: 400, msg: /market disabled/.test(e.message) ? 'ведущий пока закрыл рынок' : /too low/.test(e.message) ? 'ставка слишком мала'
        : /not enough/.test(e.message) ? 'не хватает шишек'
        : /own auction/.test(e.message) ? 'это твой лот'
        : /already leading/.test(e.message) ? 'ты и так лидируешь'
        : /closed/.test(e.message) ? 'аукцион уже закончился' : 'нельзя' };
    }
  },

  // ── Заявки на покупку («Хочу такую карту») ──
  'GET /api/wants': (b, ctx) => q(`select w.id, w.price, w.grade, t.id as type, t.code, t.name, t.category,
      u.name as buyer, (w.buyer_id=$1) as mine, r.price as nominal,
      coalesce((select uc.qty from user_cards uc
        where uc.user_id=$1 and uc.type_id=w.type_id and uc.grade=w.grade), 0) as i_have,
      ((select bw.balance from wallets bw where bw.user_id=w.buyer_id) >= w.price) as funded
      from card_wants w join card_types t on t.id=w.type_id
      join users u on u.id=w.buyer_id join rarities r on r.grade=w.grade
      where w.circle_id=$2 and w.status='open' order by w.created_at desc`,
      [ctx.child, ctx.circle]),
  'POST /api/want': async (b, ctx) => {
    try { return await one('select create_want($1,$2,$3,$4) as v', [ctx.child, b.type, b.grade, parseInt(b.price, 10)]).then((r) => r.v); }
    catch (e) { throw { code: 400, msg: /market disabled/.test(e.message) ? 'ведущий пока закрыл рынок' : /range/.test(e.message) ? 'цена вне допустимого' : /too many/.test(e.message) ? 'слишком много заявок — сними лишние' : 'нельзя' }; }
  },
  'POST /api/want/cancel': async (b, ctx) => {
    try { return await one('select cancel_want($1,$2) as v', [ctx.child, b.id]).then((r) => r.v); }
    catch (e) { throw { code: 400, msg: 'нельзя снять' }; }
  },
  'POST /api/want/fill': async (b, ctx) => {
    try { const r = await one('select fill_want($1,$2) as v', [ctx.child, b.id]).then((x) => x.v);
      return { ...r, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance }; }
    catch (e) {
      throw { code: 400, msg: /market disabled/.test(e.message) ? 'ведущий пока закрыл рынок' : /no card/.test(e.message) ? 'у тебя нет такой карты'
        : /buyer has no cones/.test(e.message) ? 'у покупателя не хватает шишек'
        : /own want/.test(e.message) ? 'это твоя заявка' : 'заявка недоступна' };
    }
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
  // Диалог с конкретным другом: все сообщения между мной и ним, по возрастанию времени
  'POST /api/chat': async (b, ctx) => {
    const withId = b.with;
    if (!withId) throw { code: 400, msg: 'нужен ?with=ID' };
    await assertOwn("select 1 from users where id=$1 and circle_id=$2 and role='child'", [withId, ctx.circle], 'друг не в твоём кругу');
    // Пометить входящие от этого друга как прочитанные
    await q(`update messages set read_at=now() where to_user=$1 and from_user=$2 and read_at is null`, [ctx.child, withId]);
    const msgs = await q(`select m.id, m.type, m.content, m.created_at, m.from_user=$1 as mine, m.read_at is not null as is_read, m.reply_to,
        (select r.content from messages r where r.id=m.reply_to) as reply_content,
        (select u.name from messages r join users u on u.id=r.from_user where r.id=m.reply_to) as reply_by,
        coalesce((select jsonb_agg(jsonb_build_object('emoji',mr.emoji,'by',u.name)) from message_reactions mr
          join users u on u.id=mr.user_id where mr.message_id=m.id), '[]'::jsonb) as reactions
        from messages m where m.circle_id=$2 and m.deliver_at<=now()
        and ((m.from_user=$1 and m.to_user=$3) or (m.from_user=$3 and m.to_user=$1))
        order by m.created_at asc`, [ctx.child, ctx.circle, withId]);
    return msgs;
  },
  // Список чатов: для каждого друга — последнее сообщение, непрочитанные, аватар
  'POST /api/chat/list': async (b, ctx) => {
    const rows = await q(`select u.id, u.name, u.last_seen > now() - interval '5 minutes' as online,
        (select content from messages m2 where m2.circle_id=$2 and m2.deliver_at<=now()
         and ((m2.from_user=u.id and m2.to_user=$1) or (m2.from_user=$1 and m2.to_user=u.id))
         order by m2.created_at desc limit 1) as last_msg,
        (select m2.created_at from messages m2 where m2.circle_id=$2 and m2.deliver_at<=now()
         and ((m2.from_user=u.id and m2.to_user=$1) or (m2.from_user=$1 and m2.to_user=u.id))
         order by m2.created_at desc limit 1) as last_at,
        (select count(*) from messages m2 where m2.circle_id=$2 and m2.to_user=$1 
         and m2.from_user=u.id and m2.read_at is null and m2.deliver_at<=now()) as unread
      from users u where u.circle_id=$2 and u.role='child' and u.id<>$1
      order by last_at desc nulls last`, [ctx.child, ctx.circle]);
    return rows.map((r, i) => ({ ...r, avatar: FRIEND_AV[i % 3] }));
  },
  // Пометить сообщения от друга как прочитанные
  'POST /api/message/read': async (b, ctx) => {
    const fid = b.from;
    if (!fid) throw { code: 400, msg: 'нужен from' };
    await q(`update messages set read_at=now() where to_user=$1 and from_user=$2 and read_at is null`, [ctx.child, fid]);
    return { ok: true };
  },
  'POST /api/message': async (b, ctx) => {
    await assertOwn("select 1 from users where id=$1 and circle_id=$2 and role='child' and id<>$3", [b.to, ctx.circle, ctx.child], 'выбери, кому отправить');
    // режем угловые скобки и длину (защита в глубину к клиентскому esc)
    const content = String(b.emoji ?? b.content ?? 'привет').replace(/[<>]/g, '').slice(0, 80) || 'привет';
    const type = b.type === 'sticker' ? 'sticker' : b.type === 'audio' ? 'audio' : 'emoji';
    const replyId = b.reply_to || null;
    await rpc('send_message', [ctx.child, b.to, type, content, replyId]);
    // push-уведомление получателю
    const sender = await one('select name from users where id=$1', [ctx.child]);
    if (sender) sendPush(b.to, sender.name, type === 'sticker' ? '🦊 Стикер' : content);
    return { ok: true };
  },
  // Реакции на сообщения
  'POST /api/message/react': async (b, ctx) => {
    const msgId = b.message_id; const emoji = String(b.emoji || '').slice(0, 4);
    if (!msgId || !emoji) throw { code: 400, msg: 'нужны message_id и emoji' };
    // проверить, что сообщение из того же круга
    const ok = await one('select 1 from messages where id=$1 and circle_id=$2', [msgId, ctx.circle]);
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

  // ── Совет ──
  'GET /api/proposals': (b, ctx) => q(`select p.id, p.type as kind, p.title, (case when p.status='passed' then 'accepted' else p.status end) as status,
      (select count(*) from votes where proposal_id=p.id and choice='yes') as yes,
      (select count(*) from votes where proposal_id=p.id and choice='no') as no,
      exists(select 1 from votes where proposal_id=p.id and voter_id=$2) as voted
      from proposals p where p.circle_id=$1 and p.type<>'insurance_claim' order by p.created_at`, [ctx.circle, ctx.child]),
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

  // ── Кабинет родителя ──
  'GET /api/parent/children': () => q('select cl.code, u.id, u.name, u.tree_level as level, u.market_allowed, w.balance from child_logins cl join users u on u.id=cl.child_id join wallets w on w.user_id=u.id order by u.created_at'),
  'POST /api/parent/add-child': async (b) => {
    const cid = b.circle_id || null;
    const circle = cid
      ? await one("select id from circles where id = $1", [cid])
      : await one("select id from circles order by created_at limit 1");
    if (cid && !circle) throw { code: 400, msg: 'круг не найден' };
    const name = String(b.name || "").replace(/[<>]/g, "").trim().slice(0, 16); if (!name) throw { code: 400, msg: 'укажи имя' };
    auth.dropCache();
    const u = (await rpc('add_child', [circle.id, name, b.tree || 'pine']))[0];
    let code;
    for (let i = 0; i < 6; i++) { code = genLoginCode(); if (!(await one('select 1 from child_logins where code=$1', [code]))) break; }  // на случай коллизии — переген
    await q('insert into child_logins(code,child_id) values($1,$2)', [code, u.id]);
    return { ok: true, name, code };
  },
  'POST /api/parent/create-task': async (b) => {
    const ch = await one('select circle_id from users where id=$1', [b.childId]); if (!ch) throw { code: 400, msg: 'нет ребёнка' };
    const title = String(b.title || '').trim().slice(0, 60); const reward = parseInt(b.reward, 10);
    if (!title) throw { code: 400, msg: 'укажи задание' }; if (!(reward > 0)) throw { code: 400, msg: 'укажи награду' };
    await q('insert into tasks(circle_id,child_id,title,reward,category,needs_photo) values($1,$2,$3,$4,$5,$6)', [ch.circle_id, b.childId, title, reward, 'family', !!b.photo]);
    return { ok: true };
  },
  'GET /api/parent/guilds': async () => {
    const gs = await q("select g.id, g.name from guilds g where g.status='open' order by g.created_at");
    for (const g of gs) g.members = (await q('select u.name from guild_members gm join users u on u.id=gm.child_id where gm.guild_id=$1', [g.id])).map((x) => x.name);
    return gs;
  },
  'POST /api/parent/guild-payout': async (b) => {
    const amount = parseInt(b.amount, 10); if (!(amount > 0)) throw { code: 400, msg: 'укажи сумму' };
    const paid = (await rpc('guild_payout', [b.id, amount, 'Заказ гильдии выполнен']))[0].r;
    return { ok: true, paid };
  },
  'POST /api/parent/guild-task': async (b) => {
    const title = String(b.title || '').trim().slice(0, 60); const reward = parseInt(b.reward, 10);
    if (!title) throw { code: 400, msg: 'укажи задание' }; if (!(reward > 0)) throw { code: 400, msg: 'укажи награду' };
    const g = await one("select circle_id, created_by from guilds where id=$1 and status in ('open','sleeping')", [b.guildId]);
    if (!g) throw { code: 400, msg: 'гильдия не найдена' };
    const kids = await q('select child_id from guild_members where guild_id=$1', [b.guildId]);
    for (const k of kids) {
      await q('insert into tasks(circle_id,child_id,title,reward,category,guild_id,guild_task_type) values($1,$2,$3,$4,$5,$6,$7)',
        [g.circle_id, k.child_id, title, reward, 'guild', b.guildId, b.type || 'joint']);
    }
    await q('insert into guild_history(guild_id, kind, title, amount) values($1,$2,$3,$4)', [b.guildId, 'task_created', title, reward]);
    await rpc('bump_guild_activity', [b.guildId]).catch(() => {});
    return { ok: true, kids: kids.length };
  },
  'GET /api/parent/templates': () => memoGet('templates', 6e5, () =>
    q('select id,title,reward,category,needs_photo from task_templates order by category nulls last, reward, title')),
  'GET /api/parent/pending': () => q("select t.id, t.title, t.reward, t.proof_url as photo, u.name as \"childName\" from tasks t join users u on u.id=t.child_id where t.status='pending_review' order by t.created_at"),
  // лог сделок картами (мониторинг ведущим): последние 40 продаж/отмен, флаг сделок у краёв коридора
  'POST /api/parent/market': async (b, ctx) => {
    await assertOwn("select 1 from users where id=$1 and circle_id=$2 and role='child'", [b.child, ctx.circle], 'нет такого ребёнка');
    await q('update users set market_allowed=$2 where id=$1', [b.child, !!b.allowed]);
    return { ok: true, allowed: !!b.allowed };
  },
  'GET /api/parent/card-metrics': (b, ctx) => one('select card_metrics($1,7) as v', [ctx.circle]).then((r) => r.v),
  'GET /api/parent/card-catalog': () => q(`select t.id, t.name, t.code, s.name as season, t.pack_drop, t.occasion
      from card_types t left join card_seasons s on s.code=t.season order by t.pack_drop, s.sort, t.sort`),
  'POST /api/parent/card/grant': async (b, ctx) => {
    await assertOwn("select 1 from users where id=$1 and circle_id=$2 and role='child'", [b.child, ctx.circle], 'нет такого ребёнка');
    try { return await one('select grant_card($1,$2,$3,$4) as v',
      [b.child, b.type, parseInt(b.grade, 10), (b.reason || '').trim().slice(0, 60) || null]).then((r) => r.v); }
    catch (e) { throw { code: 400, msg: /no such card/.test(e.message) ? 'нет такой карты' : 'не получилось вручить' }; }
  },
  'GET /api/parent/season': async (b, ctx) => {
    const active = await one("select code, name, sort, ends_at from card_seasons where status='active' order by sort limit 1");
    const [all, progress] = await Promise.all([
      q('select code, name, sort, status, ends_at from card_seasons order by sort'),
      q('select * from season_progress($1)', [ctx.circle]),
    ]);
    return { active, seasons: all, progress };
  },
  'POST /api/parent/season/next': async (b, ctx) => {
    const r = (await one('select switch_season($1) as v', [b.code || null])).v;
    if (r && r.ok) await q('select announce_season($1,$2)', [ctx.circle, `Сезон «${r.closed}» завершён. Открыт новый: «${r.opened}» 🌲`]);
    if (!r.ok) throw { code: 400, msg: r.reason || 'нельзя переключить' };
    return r;
  },
  'POST /api/parent/season/deadline': async (b) => {
    const d = b.ends_at ? new Date(b.ends_at) : null;
    if (b.ends_at && isNaN(d)) throw { code: 400, msg: 'непонятная дата' };
    await q("update card_seasons set ends_at=$1 where status='active'", [d]);
    return { ok: true, ends_at: d };
  },
  'GET /api/parent/card-gifts': (b, ctx) => q(`select fu.name as from_name, tu.name as to_name, ct.name as card, g.grade, g.created_at
      from card_gifts g join users fu on fu.id=g.from_user join users tu on tu.id=g.to_user
      join card_types ct on ct.id=g.type_id
      where g.circle_id=$1 order by g.created_at desc limit 40`, [ctx.circle]),
  'GET /api/parent/card-trades': () => q(`select su.name as seller, bu.name as buyer, ct.name as card,
      rr.name as grade, l.price, r.price as nominal, l.status, l.closed_at,
      (l.price <= r.price/2 or l.price >= r.price*3) as edge
      from card_listings l
      join card_types ct on ct.id=l.type_id
      join rarities r on r.grade=l.grade
      left join rarities rr on rr.grade=l.grade
      join users su on su.id=l.seller_id
      left join users bu on bu.id=l.buyer_id
      where l.status in ('sold','cancelled') order by l.closed_at desc limit 40`),
  'POST /api/parent/approve': async (b) => { try { await rpc('approve_task', [b.id]); } catch (e) { throw { code: 400, msg: 'нет задания на проверке' }; } const t = await one('select child_id, title from tasks where id=$1', [b.id]); if (t) sendPush(t.child_id, "✅ Задание одобрено", t.title).catch(() => {}); return { ok: true }; },
  'POST /api/parent/reject': async (b) => { await rpc('reject_task', [b.id]).catch(() => {}); return { ok: true }; },
  'POST /api/parent/topup': async (b) => {
    const ch = await one('select circle_id from users where id=$1', [b.childId]); if (!ch) throw { code: 400, msg: 'нет ребёнка' };
    const amount = parseInt(b.amount, 10); if (!(amount > 0)) throw { code: 400, msg: 'укажи сумму' };
    await q('update wallets set balance=balance+$1, total_earned=total_earned+$1 where user_id=$2', [amount, b.childId]);
    await q("insert into transactions(circle_id,from_user,to_user,amount,type,message) values($1,null,$2,$3,'reward',$4)", [ch.circle_id, b.childId, amount, b.reason || 'Начисление от ведущего']);
    return { ok: true, balance: (await one('select balance from wallets where user_id=$1', [b.childId])).balance };
  },
  // корректировка вниз (штраф/списание) — не уводит баланс в минус
  'POST /api/parent/deduct': async (b) => {
    const ch = await one('select circle_id from users where id=$1', [b.childId]); if (!ch) throw { code: 400, msg: 'нет ребёнка' };
    const amount = parseInt(b.amount, 10); if (!(amount > 0)) throw { code: 400, msg: 'укажи сумму' };
    const w = await one('select balance from wallets where user_id=$1', [b.childId]);
    const take = Math.min(amount, w.balance);   // не в минус
    if (take > 0) {
      await q('update wallets set balance=balance-$1 where user_id=$2', [take, b.childId]);
      await q("insert into transactions(circle_id,from_user,to_user,amount,type,message) values($1,$2,null,$3,'fee',$4)", [ch.circle_id, b.childId, take, b.reason || 'Списание ведущим']);
    }
    return { ok: true, balance: w.balance - take, took: take };
  },
  'POST /api/parent/add-prize': async (b) => {
    const circle = await one("select id from circles order by created_at limit 1");
    const title = String(b.title || '').trim().slice(0, 40); const price = parseInt(b.price, 10);
    if (!title) throw { code: 400, msg: 'название приза' }; if (!(price > 0)) throw { code: 400, msg: 'цена больше 0' };
    await q("insert into shop_items(circle_id,type,title,price) values($1,'impression',$2,$3)", [circle.id, title, price]);
    memo.clear();
    return { ok: true };
  },

  // ── прочее ──
  'POST /api/onboard': async (b, ctx) => { if (ctx.child) await q('update users set name=$1, tree_type=$2 where id=$3', [String(b.name || "Росточек").replace(/[<>]/g, "").slice(0, 16), b.tree || 'pine', ctx.child]); return { ok: true }; },
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
async function sendPush(userId, title, body) {
  try {
    const subs = await q('select subscription from push_subscriptions where user_id=$1', [userId]);
    const vapid = process.env.VAPID_PRIVATE_KEY;
    if (!vapid || !subs.length) return;
    const webpush = await import('web-push');
    webpush.setVapidDetails('mailto:shishka@elka-kvest-2026.ru',
      'BCsLnC1aJlENYUggedmMT3Gb-wns2cOD5T4gRRMUgW609m3KWFHvVrIlJbx5WzrjhWxYH3kyfPspd_VEmZSfT8o', vapid);
    for (const s of subs) {
      webpush.sendNotification(JSON.parse(s.subscription), JSON.stringify({ title, body })).catch(() => {});
    }
  } catch {}
}

const SKIN_ASSET = { 'Обычное дерево': 'base', 'Осеннее дерево': 'skin_autumn', 'Зимнее дерево': 'skin_winter', 'Золотое дерево': 'skin_gold', 'Светящееся дерево': 'skin_glow', 'Радужное дерево': 'skin_rainbow' };

const MAX_BODY = 10 * 1024 * 1024;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  for (const [k, v] of SEC) res.setHeader(k, v);
  if (url.pathname.startsWith('/api/')) {
    let body = {};
    if (req.method === 'POST') { body = await readBody(req, res); if (body === null) return; }
    const route = `${req.method} ${url.pathname}`;
    const handler = api[route];
    if (!handler) { res.writeHead(404); return res.end('{}'); }
    const isParent = url.pathname.startsWith('/api/parent/');
    const guarded = isParent || route === 'POST /api/link';   // роуты, где перебирают короткий секрет
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
      // детские endpoint'ы требуют валидный код (иначе 401, а не 500/пустота)
      if (!ctx.child && !PUBLIC.has(route) && !isParent) throw { code: 401, msg: 'нужен код входа' };
      // статус «в лесу»: обновляем время последней активности (не на каждом пинге)
      if (ctx.child && route !== 'GET /api/ping') q(`update users set last_seen=now() where id=$1`, [ctx.child]).catch(() => {});
      let result;
      if (route === 'POST /api/link') {   // неверный код (throw 400) считаем промахом, верный — сбрасывает счётчик
        try { result = await handler(body, ctx); okTry(ip); }
        catch (e) { badTry(ip); throw e; }
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
}).listen(Number(process.env.PORT) || 3777, function () {
  console.log('Шишка Банк → http://localhost:' + this.address().port);
});
