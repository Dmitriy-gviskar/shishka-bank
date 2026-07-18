// Node-прокси Шишка Банк → Supabase (PostgreSQL, прод-схема + 56 функций).
// Запуск: DATABASE_URL="postgres://..." node server-pg.mjs   (пароль не в файле!)
// Клиент (те же /api/*) не меняется. Ребёнок резолвится по коду из child_logins (заголовок x-child-code).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import pg from 'pg';

const DIR = dirname(fileURLToPath(import.meta.url));
await mkdir(join(DIR, 'uploads'), { recursive: true });
if (!process.env.DATABASE_URL) { console.error('нет DATABASE_URL в окружении'); process.exit(1); }
// idleTimeoutMillis:0 — не закрывать соединения (дефолт 10с ронял пул, и каждый «первый экран» платил ~0.5с за TLS-реконнект во Франкфурт)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 0, keepAlive: true });
setInterval(() => pool.query('select 1').catch(() => {}), 240e3);  // пинг: Supabase-пулер не должен резать idle-соединение
pool.query('select 1').catch(() => {});                            // прогрев на старте — первый экран не ждёт TLS-коннект
const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows);
const one = (sql, p = []) => q(sql, p).then((r) => r[0] || null);
const rpc = (fn, args = []) => q(`select * from ${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args);

const TREE = { pine: 'tree.webp', spruce: 'tree3.webp', cedar: 'tree4.webp', oak: 'tree5.webp' };
const FRIEND_AV = ['friend1.webp', 'friend2.webp', 'friend3.webp'];
const PARENT_PIN = process.env.PARENT_PIN || '1234';            // PIN родительского кабинета (env в проде)
const PUBLIC = new Set(['POST /api/link']); // единственный роут без кода ребёнка
const memo = new Map();   // серверный кэш редких данных: ключ → {v,t}
const memoGet = async (key, ttl, load) => {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await load(); memo.set(key, { v, t: Date.now() }); return v;
};

// Авто-закрытие аукционов: у кого дедлайн (ends_at) наступил — закрываем, объявляем победителя.
// Дедлайн ставит create_auction/next_monday_15msk (понедельник 15:00 МСК). Идемпотентно.
async function sweepAuctions() {
  try {
    const due = await q("select id from auctions where status='live' and ends_at is not null and now() >= ends_at");
    for (const a of due) { await rpc('close_auction', [a.id]).catch((e) => console.error('close_auction', a.id, e.message)); }
    if (due.length) for (const k of memo.keys()) memo.delete(k);   // сбросить кэш новостей/альбома
  } catch (e) { console.error('sweepAuctions', e.message); }
}
setInterval(sweepAuctions, 60e3);   // раз в минуту
sweepAuctions();                    // и сразу на старте — вдруг сервер лежал в момент дедлайна
const CTX_TTL = 3e5, ctxCache = new Map(); // код→{v:{child,circle},t}; сбрасывается при добавлении ребёнка
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
  'POST /api/link': async (b) => {
    const r = await one('select u.name from child_logins cl join users u on u.id=cl.child_id where cl.code=$1', [String(b.code || '').toUpperCase().trim()]);
    if (!r) throw { code: 400, msg: 'код не найден' };
    return { ok: true, name: r.name };
  },

  'GET /api/state': async (b, ctx) => {
    const [u, w] = await Promise.all([
      one('select name,tree_level,tree_type,avatar_skin from users where id=$1', [ctx.child]),
      one('select balance,total_earned,total_spent from wallets where user_id=$1', [ctx.child]),
    ]);
    let tree_asset = TREE[u.tree_type] || 'tree.webp', skin_on = false;
    if (u.avatar_skin && u.avatar_skin !== 'base') {   // avatar_skin = uuid скина → его asset
      const sk = await one('select title from shop_items where id=$1', [u.avatar_skin]);
      if (sk && SKIN_ASSET[sk.title] && SKIN_ASSET[sk.title] !== 'base') { tree_asset = SKIN_ASSET[sk.title] + '.png'; skin_on = true; }
    }
    return { name: u.name, tree_level: u.tree_level, balance: w.balance, total_earned: w.total_earned, total_spent: w.total_spent, tree_asset, skin_on };
  },

  'GET /api/tasks': async (b, ctx) => (await q('select id,title,reward,needs_photo,status from tasks where child_id=$1 order by created_at', [ctx.child]))
    .map((t) => ({ id: t.id, title: t.title, reward: t.reward, needs_photo: t.needs_photo, status: t.status === 'pending_review' ? 'submitted' : t.status })),
  'POST /api/task/done': async (b, ctx) => {
    const t = await one('select needs_photo,status from tasks where id=$1 and child_id=$2', [b.id, ctx.child]);  // только своё задание
    if (!t || t.status === 'done' || t.status === 'pending_review') throw { code: 400, msg: 'задание недоступно' };
    let proof = null;
    if (t.needs_photo) {   // фото обязательно: base64-jpeg → файл на диске → url в задании
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(b.photo || ''));
      if (!m) throw { code: 400, msg: 'нужно фото — нажми ещё раз и сфотографируй' };
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length > 4e6) throw { code: 400, msg: 'фото слишком большое' };
      proof = 'uploads/' + b.id + '.jpg';
      await writeFile(join(DIR, proof), buf);
    }
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
    return { ok: true, balance: w.balance };
  },

  'POST /api/surprise': async (b, ctx) => {   // анонимный подарок «Шишка-сюрприз»
    await assertOwn("select 1 from users where id=$1 and circle_id=$2 and role='child'", [b.to, ctx.circle], 'нет такого друга');
    if (b.to === ctx.child) throw { code: 400, msg: 'себе нельзя' };
    try { await rpc('transfer_surprise', [ctx.child, b.to, parseInt(b.amount, 10)]); }
    catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек' : 'не получилось' }; }
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, balance: w.balance };
  },
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
    const rows = await q(`select distinct on (s.id) s.id, s.name, s.is_heir, s.owner_id, u.tree_type,
        l.id lot_id, l.title lot_title, l.price lot_price
      from shops s join users u on u.id=s.owner_id
      join shop_lots l on l.shop_id=s.id and l.is_active
      where s.circle_id=$1 and s.is_active order by s.id, l.created_at`, [ctx.circle]);
    return rows.map((s) => ({ id: s.id, name: s.name, is_heir: s.is_heir, mine: s.owner_id === ctx.child,
      avatar: TREE[s.tree_type] || 'tree.webp', lot: { id: s.lot_id, title: s.lot_title, price: s.lot_price } }));
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
  'GET /api/pot': (b, ctx) => q(`select p.id, p.title, p.goal, p.collected, p.status, g.name as guild, coalesce(u.name,'семья') as author
    from pots p left join guilds g on g.id=p.guild_id left join users u on u.id=p.created_by
    where p.circle_id=$1 and p.status in ('open','reached') order by p.created_at desc`, [ctx.circle]),
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

  // ── Почта ──
  'GET /api/inbox': (b, ctx) => q(`select u.name as from_name, m.type as kind, m.content, m.is_whisper as whisper
      from messages m left join users u on u.id=m.from_user
      where m.to_user=$1 and m.deliver_at<=now() order by m.created_at desc`, [ctx.child]),
  'POST /api/message': async (b, ctx) => {
    await assertOwn("select 1 from users where id=$1 and circle_id=$2 and role='child' and id<>$3", [b.to, ctx.circle, ctx.child], 'выбери, кому отправить');
    await rpc('send_message', [ctx.child, b.to, 'emoji', b.emoji || 'привет']);
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
    const gs = await q("select g.id, g.name from guilds g where g.circle_id=$1 and g.status='open' order by g.created_at", [ctx.circle]);
    const out = [];
    for (const g of gs) {
      const members = await q('select u.id, u.name, gm.share from guild_members gm join users u on u.id=gm.child_id where gm.guild_id=$1 order by gm.share desc, u.name', [g.id]);
      out.push({ id: g.id, name: g.name, members: members.map((m) => ({ name: m.name, share: m.share })), mine: members.some((m) => m.id === ctx.child) });
    }
    return out;
  },
  'POST /api/guild/create': async (b, ctx) => {
    const name = String(b.name || '').trim().slice(0, 24);
    if (name.length < 2) throw { code: 400, msg: 'придумай название' };
    const dup = await one("select 1 from guilds where circle_id=$1 and status='open' and lower(name)=lower($2)", [ctx.circle, name]);
    if (dup) throw { code: 400, msg: 'такая гильдия уже есть' };
    const g = (await rpc('create_guild', [ctx.child, name]))[0];
    return { ok: true, id: g.id, name };
  },
  'POST /api/guild/join': async (b, ctx) => {
    await assertOwn("select 1 from guilds where id=$1 and circle_id=$2 and status='open'", [b.id, ctx.circle], 'нет такой гильдии');
    await rpc('join_guild', [b.id, ctx.child]);
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
    return { ok: true };
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
  'GET /api/parent/children': () => q('select cl.code, u.id, u.name, u.tree_level as level, w.balance from child_logins cl join users u on u.id=cl.child_id join wallets w on w.user_id=u.id order by u.created_at'),
  'POST /api/parent/add-child': async (b) => {
    const circle = await one("select id from circles order by created_at limit 1");
    const name = String(b.name || '').trim().slice(0, 16); if (!name) throw { code: 400, msg: 'укажи имя' };
    ctxCache.clear();
    const u = (await rpc('add_child', [circle.id, name, b.tree || 'pine']))[0];
    const cnt = (await one('select count(*) c from child_logins')).c;
    const code = name.slice(0, 4).toUpperCase() + '-' + String(Number(cnt) + 1).padStart(2, '0');
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
    await q('insert into guild_messages(guild_id, from_user, content) values($1,null,$2)', [b.id, `Заказ выполнен! Выплата ${amount} шишек`]);
    return { ok: true, paid };
  },
  'GET /api/parent/templates': () => memoGet('templates', 6e5, () =>
    q('select id,title,reward,category,needs_photo from task_templates order by category nulls last, reward, title')),
  'GET /api/parent/pending': () => q("select t.id, t.title, t.reward, t.proof_url as photo, u.name as \"childName\" from tasks t join users u on u.id=t.child_id where t.status='pending_review' order by t.created_at"),
  'POST /api/parent/approve': async (b) => { try { await rpc('approve_task', [b.id]); } catch (e) { throw { code: 400, msg: 'нет задания на проверке' }; } return { ok: true }; },
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
  'POST /api/onboard': async (b, ctx) => { if (ctx.child) await q('update users set name=$1, tree_type=$2 where id=$3', [String(b.name || 'Росточек').slice(0, 16), b.tree || 'pine', ctx.child]); return { ok: true }; },
  'POST /api/shop/create': async (b, ctx) => {
    const name = String(b.name || '').trim(), lot = String(b.lot || '').trim(), price = parseInt(b.price, 10);
    if (!name || !lot) throw { code: 400, msg: 'заполни название лавки и товар' };
    if (!(price > 0)) throw { code: 400, msg: 'укажи цену больше 0' };
    try { await rpc('open_shop', [ctx.child, name.slice(0, 24), null]); }
    catch (e) { throw { code: 400, msg: /already has/.test(e.message) ? 'у тебя уже есть лавка' : 'не удалось' }; }
    await rpc('add_lot', [ctx.child, lot.slice(0, 24), 'goods', price]);
    return { ok: true };
  },
};
const SKIN_ASSET = { 'Обычное дерево': 'base', 'Осеннее дерево': 'skin_autumn', 'Зимнее дерево': 'skin_winter', 'Золотое дерево': 'skin_gold', 'Светящееся дерево': 'skin_glow', 'Радужное дерево': 'skin_rainbow' };

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    let body = {};
    if (req.method === 'POST') { const chunks = []; for await (const c of req) chunks.push(c);
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch {} }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const route = `${req.method} ${url.pathname}`;
    const handler = api[route];
    if (!handler) { res.writeHead(404); return res.end('{}'); }
    try {
      // родительский контур защищён PIN-ом (иначе ребёнок начислит себе шишки)
      if (url.pathname.startsWith('/api/parent/')) {
        if ((req.headers['x-parent-pin'] || '') !== PARENT_PIN) throw { code: 401, msg: 'нужен PIN родителя' };
      }
      // резолв активного ребёнка по коду (мемо: код→ребёнок меняется редко, экономим запрос на КАЖДЫЙ вызов)
      let ctx = {};
      const cc = req.headers['x-child-code'];
      if (cc) {
        const key = decodeURIComponent(cc);
        const hit = ctxCache.get(key);
        if (hit && Date.now() - hit.t < CTX_TTL) ctx = hit.v;
        else {
          const r = await one('select u.id child, u.circle_id circle from child_logins cl join users u on u.id=cl.child_id where cl.code=$1', [key]);
          if (r) { ctx = { child: r.child, circle: r.circle }; ctxCache.set(key, { v: ctx, t: Date.now() }); }
        }
      }
      // детские endpoint'ы требуют валидный код (иначе 401, а не 500/пустота)
      if (!ctx.child && !PUBLIC.has(route) && !url.pathname.startsWith('/api/parent/')) throw { code: 401, msg: 'нужен код входа' };
      const out = JSON.stringify(await handler(body, ctx));
      res.writeHead(200); res.end(out);
    } catch (e) {
      // e.code бывает СТРОКОЙ от pg ('23503', 'P0001') — в writeHead только валидный HTTP-статус, иначе краш всего сервера
      const status = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 500;
      if (status >= 500) console.error(`[${route}]`, e.message || e.msg || e);   // реальные ошибки — в лог, не проглатывать
      res.writeHead(status); res.end(JSON.stringify({ error: e.msg || 'что-то пошло не так, попробуй ещё раз' }));
    }
    return;
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const ext = extname(p);
  // отдаём только клиентские ресурсы; серверные исходники (.mjs, .env, .sql, package*) наружу не светим
  if (!MIME[ext] || /server|\.env|\.sql|package/.test(p)) { res.writeHead(404); return res.end('not found'); }
  try {
    const data = await readFile(join(DIR, p));
    res.setHeader('Content-Type', MIME[ext]);
    if (p.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');  // арт не меняется
    res.writeHead(200); res.end(data);
  }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(3777, () => console.log('Шишка Банк (Supabase) → http://localhost:3777'));
