// Лесная коллекция: карты, питомцы, рынок, аукционы, wants.
import { PACK_PRICE, PACK_SIZE } from '../lib/offline-cards.mjs';

export function routesCards({ q, one, rpc, assertOwn, assertFriend }) {
  return {
// ── Лесная коллекция (карточки) ──
'GET /api/cards': async (b, ctx) => {
  const [types, rar, owned, lore, seasons, packs, fam, history, facts, gathers] = await Promise.all([
    q('select id, code, name, category, sort, season, occasion from card_types order by sort'),
    q('select grade, code, name, color, price, quicksell, weight from rarities order by grade'),
    q('select type_id, grade, qty, merged, seen_at from user_cards where user_id=$1', [ctx.child]),
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
    q(`select type_id, grade, last_claim from card_gatherers where user_id=$1`, [ctx.child]).catch(() => []),
  ]);
  const own = {};   // type_id → {grade: {qty, merged, unseen}}
  for (const r of owned) {
    (own[r.type_id] ||= {})[r.grade] = { qty: r.qty, merged: r.merged, unseen: !r.seen_at };
  }
  const gathering = {};
  for (const g of gathers || []) gathering[g.type_id + ':' + g.grade] = true;
  const cards = types.map((t) => {
    const have = own[t.id] || {};
    const grades = rar.map((g) => {
      const h = have[g.grade] || {};
      return { grade: g.grade, qty: h.qty || 0, merged: h.merged || 0, unseen: !!h.unseen,
               gathering: !!gathering[t.id + ':' + g.grade] };
    });
    const best = grades.filter((g) => g.qty > 0).reduce((m, g) => Math.max(m, g.grade), 0);
    return { id: t.id, code: t.code, name: t.name, category: t.category, season: t.season,
             occasion: t.occasion, grades, best, owned: best > 0 };
  });
  // гарант: каждый 10-й пак — недостающая карта, каждый 50-й — недостающая Эпическая+
  const opened = (packs && packs.packs_opened) || 0;
  const pity = { opened, to_new: 10 - (opened % 10), to_top: 50 - (opened % 50) };
  const marketAllowed = await one('select market_allowed from users where id=$1', [ctx.child]);
  const familiars = (fam || []).filter((f) => f.type);
  // Прогресс альбома = заполненные ячейки (грейд), не «хотя бы одна карта существа».
  // Иначе 140/145 при пустых полках выглядит как сломанный счётчик.
  const album = cards.filter((c) => c.category !== 'special');
  const cells = album.reduce((n, c) => n + c.grades.filter((g) => g.qty > 0).length, 0);
  const cellsTotal = album.length * 6;
  const met = album.filter((c) => c.owned).length;
  const complete = album.filter((c) => c.grades.filter((g) => g.qty > 0).length === 6).length;
  return { rarities: rar, cards, lore, facts, history, seasons, pity,
           market_allowed: marketAllowed ? marketAllowed.market_allowed : true,
           familiars,
           collected: cells,
           total: cellsTotal,
           beings_met: met,
           beings_complete: complete,
           beings_total: album.length };
},
// Альбом друга — любой принятый друг, даже из другого леса
'POST /api/friend/cards': async (b, ctx) => {
  if (!b.id) throw { code: 400, msg: 'выбери друга' };
  if (b.id === ctx.child) throw { code: 400, msg: 'это твой альбом' };
  await assertFriend(ctx.child, b.id, 'нет такого друга');
  const friend = await one('select id, name from users where id=$1', [b.id]);
  if (!friend) throw { code: 404, msg: 'друг не найден' };
  const [types, rar, owned, mine, lore, seasons] = await Promise.all([
    q('select id, code, name, category, sort, season, occasion from card_types order by sort'),
    q('select grade, code, name, color, price, quicksell, weight from rarities order by grade'),
    q('select type_id, grade, qty from user_cards where user_id=$1', [friend.id]),
    q('select type_id, grade, qty from user_cards where user_id=$1', [ctx.child]),
    q('select category, grade, title, lore from card_lore'),
    q('select code, name, sort, status from card_seasons order by sort'),
  ]);
  const own = {}, my = {};
  for (const r of owned) (own[r.type_id] ||= {})[r.grade] = r.qty;
  for (const r of mine) (my[r.type_id] ||= {})[r.grade] = r.qty;
  const cards = types.map((t) => {
    const have = own[t.id] || {};
    const mineHave = my[t.id] || {};
    const grades = rar.map((g) => ({
      grade: g.grade,
      qty: have[g.grade] || 0,
      mine_qty: mineHave[g.grade] || 0,
      merged: 0,
      unseen: false,
    }));
    const best = grades.filter((g) => g.qty > 0).reduce((m, g) => Math.max(m, g.grade), 0);
    return { id: t.id, code: t.code, name: t.name, category: t.category, season: t.season,
             occasion: t.occasion, grades, best, owned: best > 0 };
  });
  const album = cards.filter((c) => c.category !== 'special');
  const cells = album.reduce((n, c) => n + c.grades.filter((g) => g.qty > 0).length, 0);
  const met = album.filter((c) => c.owned).length;
  const complete = album.filter((c) => c.grades.filter((g) => g.qty > 0).length === 6).length;
  // сколько «дыр» у друга ты можешь закрыть (есть карта, у него пусто)
  const can_help = album.reduce((n, c) => n + c.grades.filter((g) => g.qty <= 0 && g.mine_qty > 0).length, 0);
  // рынок — свой флаг ведущего, не друга (иначе закрытый рынок «откроется» в peek)
  const marketAllowed = await one('select market_allowed from users where id=$1', [ctx.child]);
  return {
    rarities: rar, cards, lore, facts: [], history: [], seasons, pity: null,
    market_allowed: marketAllowed ? marketAllowed.market_allowed : true,
    familiars: [],
    collected: cells, total: album.length * 6,
    beings_met: met, beings_complete: complete, beings_total: album.length,
    peek: true, friend: { id: friend.id, name: friend.name }, can_help,
  };
},
'POST /api/familiar/talk': async (b, ctx) => {
  const f = await one('select t.category from familiars fm join card_types t on t.id=fm.type_id where fm.user_id=$1 and fm.type_id=$2 and fm.grade=$3',
    [ctx.child, b.type, b.grade]);
  if (!f) throw { code: 400, msg: 'нет такого питомца' };
  const phrase = await one(`select phrase from familiar_dialogs
    where category in ($1,'any') and trigger=$2 order by random() limit 1`, [f.category, b.trigger || 'greet']);
  return { phrase: phrase ? phrase.phrase : 'Мяу? То есть... привет!' };
},
'POST /api/familiar': async (b, ctx) => {
  try {
    if (b.remove) return await one('select remove_familiar($1,$2,$3) as v', [ctx.child, b.type, b.grade]).then((r) => r.v);
    return await one('select add_familiar($1,$2,$3) as v', [ctx.child, b.type, b.grade]).then((r) => r.v);
  }
  catch (e) { throw { code: 400, msg: /no card/.test(e.message) ? 'этой карты у тебя нет'
    : /already/.test(e.message) ? 'уже твой питомец' : /max 5/.test(e.message) ? 'максимум 5 питомцев' : 'нельзя' }; }
},
// Отметить карту просмотренной (плашка NEW в альбоме)
'POST /api/cards/seen': async (b, ctx) => {
  if (b.all) {
    await q('update user_cards set seen_at=now() where user_id=$1 and seen_at is null', [ctx.child]);
    return { ok: true };
  }
  if (!b.type || !b.grade) throw { code: 400, msg: 'нужны type и grade' };
  await q(`update user_cards set seen_at=now()
           where user_id=$1 and type_id=$2 and grade=$3 and seen_at is null`,
    [ctx.child, b.type, b.grade]);
  return { ok: true };
},
'POST /api/pack/open': async (b, ctx) => {
  let r;
  try { r = await one('select open_pack($1) as v', [ctx.child]); }
  catch (e) { throw { code: 400, msg: /not enough/.test(e.message) ? 'не хватает шишек на пак' : 'не получилось' }; }
  const rewards = (await one('select check_card_rewards($1) as v', [ctx.child])).v;
  return { cards: r.v, rewards, balance: (await one('select balance from wallets where user_id=$1', [ctx.child])).balance };
},
'POST /api/pack/offline': async (b, ctx) => {
  const nonce = String(b.nonce || '');
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(nonce)) throw { code: 400, msg: 'неверный пак' };
  const claimed = await one('select 1 as x from offline_pack_claims where child_id=$1 and nonce=$2', [ctx.child, nonce]);
  if (claimed) {
    const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
    return { ok: true, already: true, cards: [], rewards: [], balance: w.balance };
  }
  const today = await one(
    `select count(*)::int as n from offline_pack_claims
      where child_id=$1 and (created_at at time zone 'Europe/Moscow')::date
            = (now() at time zone 'Europe/Moscow')::date`, [ctx.child]);
  if ((today?.n || 0) >= 5) throw { code: 429, msg: 'сегодня хватит офлайн-паков — открой остальные по сети' };
  const items = Array.isArray(b.cards) ? b.cards : [];
  if (items.length !== PACK_SIZE) throw { code: 400, msg: 'в паке 7 карт' };
  let rare = 0;
  const resolved = [];
  for (const it of items) {
    const g = parseInt(it.grade, 10);
    if (g < 1 || g > 6) throw { code: 400, msg: 'не тот ранг' };
    if (g >= 5) rare++;
    const t = await one(
      `select id, code, name, category, pack_drop from card_types where id=$1`, [it.type]);
    if (!t || t.pack_drop === false) throw { code: 400, msg: 'так карта не выпадает' };
    resolved.push({ ...t, grade: g });
  }
  if (rare > 3) throw { code: 400, msg: 'слишком редкий пак' };
  const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
  if (!w || w.balance < PACK_PRICE) throw { code: 400, msg: 'не хватает шишек на пак' };
  await q('insert into offline_pack_claims(child_id, nonce) values ($1,$2)', [ctx.child, nonce]);
  await q('update wallets set balance=balance-$2, total_spent=total_spent+$2 where user_id=$1',
    [ctx.child, PACK_PRICE]);
  await q('update users set packs_opened = packs_opened + 1 where id=$1', [ctx.child]);
  await q("insert into transactions(circle_id, from_user, to_user, amount, type, message) select circle_id, $1, null, $2, 'purchase', 'Лесной пак' from users where id=$1",
    [ctx.child, PACK_PRICE]);
  const out = [];
  for (const t of resolved) {
    const had = await one('select qty from user_cards where user_id=$1 and type_id=$2 and grade=$3',
      [ctx.child, t.id, t.grade]);
    await q(`insert into user_cards(user_id, type_id, grade, qty) values ($1,$2,$3,1)
      on conflict (user_id, type_id, grade) do update set qty = user_cards.qty + 1`,
      [ctx.child, t.id, t.grade]);
    out.push({ code: t.code, name: t.name, category: t.category, grade: t.grade, is_new: !had || had.qty <= 0 });
  }
  await rpc('check_achievements', [ctx.child]).catch(() => {});
  const rewards = (await one('select check_card_rewards($1) as v', [ctx.child])).v;
  const bal = await one('select balance from wallets where user_id=$1', [ctx.child]);
  return { cards: out, rewards, balance: bal.balance, offline: true };
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
'POST /api/card/exchange': async (b, ctx) => {   // 5 выбранных дублей одного ранга → 1 недостающая
  const types = Array.isArray(b.types) ? b.types.filter(Boolean) : [];
  if (types.length !== 5) throw { code: 400, msg: 'выбери 5 карт, которые отдаёшь' };
  let r;
  try { r = await one('select exchange_cards_pick($1,$2,$3::uuid[]) as v', [ctx.child, b.grade, types]).then((x) => x.v); }
  catch (e) {
    throw { code: 400, msg: /need 5/.test(e.message) ? 'выбери 5 карт, которые отдаёшь'
      : /last copy/.test(e.message) ? 'последнюю карту из альбома отдать нельзя'
      : /unknown type/.test(e.message) ? 'нет такой карты' : 'нельзя' };
  }
  const rewards = (await one('select check_card_rewards($1) as v', [ctx.child])).v;
  return { ...r, rewards };
},
'POST /api/card/exchange-down': async (b, ctx) => {   // 1 дубль высшего ранга → 1 недостающая ниже
  if (!b.offer || !b.want) throw { code: 400, msg: 'выбери карты' };
  let r;
  try {
    r = await one('select exchange_rank_down($1,$2,$3,$4,$5) as v',
      [ctx.child, b.offer, b.offer_grade, b.want, b.want_grade]).then((x) => x.v);
  } catch (e) {
    throw { code: 400, msg: /need spare/.test(e.message) ? 'нужен дубль — последнюю карту отдать нельзя'
      : /already have/.test(e.message) ? 'эта карта у тебя уже есть'
      : /want not lower/.test(e.message) ? 'нужен ранг ниже'
      : /bad grade/.test(e.message) ? 'не тот ранг'
      : /no types/.test(e.message) ? 'нет такой карты' : 'нельзя' };
  }
  const rewards = (await one('select check_card_rewards($1) as v', [ctx.child])).v;
  return { ...r, rewards };
},
'POST /api/card/gift': async (b, ctx) => {   // подарок карты другу: лимит 3 в день, лог у ведущего
  if (!b.to || b.to === ctx.child) throw { code: 400, msg: 'выбери, кому подарить' };
  await assertFriend(ctx.child, b.to, 'нет такого друга');
  try { return await one('select gift_card($1,$2,$3,$4) as v', [ctx.child, b.to, b.type, b.grade]).then((r) => r.v); }
  catch (e) {
    throw { code: 400, msg: /daily gift limit/.test(e.message) ? 'сегодня уже подарено 3 карты — завтра можно снова'
      : /no card/.test(e.message) ? 'этой карты у тебя нет'
      : /other circle/.test(e.message) ? 'пока нельзя дарить в другой лес' : 'нельзя' };
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
    where l.status='open' and (
      l.circle_id=$2
      or exists (select 1 from friendships f
                  where f.user_id=$1 and f.friend_id=l.seller_id and f.status='accepted')
    ) order by l.created_at desc`,
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
    where a.status='live' order by a.ends_at`, [ctx.child]),
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
    where w.status='open' and (
      w.circle_id=$2
      or exists (select 1 from friendships f
                  where f.user_id=$1 and f.friend_id=w.buyer_id and f.status='accepted')
    ) order by w.created_at desc`,
    [ctx.child, ctx.circle]),
'POST /api/want': async (b, ctx) => {
  try { return await one('select create_want($1,$2,$3,$4) as v', [ctx.child, b.type, b.grade, parseInt(b.price, 10)]).then((r) => r.v); }
  catch (e) { throw { code: 400, msg: /market disabled/.test(e.message) ? 'ведущий пока закрыл рынок' : /range/.test(e.message) ? 'цена вне допустимого' : /too many/.test(e.message) ? 'слишком много заявок — сними лишние' : 'нельзя' }; }
},
'POST /api/want/cancel': async (b, ctx) => {
  try { return await one('select cancel_want($1,$2) as v', [ctx.child, b.id]).then((r) => r.v); }
  catch (e) { throw { code: 400, msg: 'нельзя снять' }; }
},
'GET /api/swaps': (b, ctx) => q(`select s.id, s.offer_grade, s.want_grade, s.created_at,
    ot.code as offer_code, ot.name as offer_name, wt.code as want_code, wt.name as want_name,
    u.name as from_name, (s.from_id=$1) as mine
    from card_swaps s
    join card_types ot on ot.id = s.offer_type
    join card_types wt on wt.id = s.want_type
    join users u on u.id = s.from_id
    where s.status = 'open' and (
      s.circle_id = $2
      or exists (select 1 from friendships f
                  where f.user_id=$1 and f.friend_id=s.from_id and f.status='accepted')
      or s.from_id = $1
    ) order by s.created_at desc`, [ctx.child, ctx.circle]),
'POST /api/swap': async (b, ctx) => {
  try {
    return await one('select create_card_swap($1,$2,$3,$4,$5) as v',
      [ctx.child, b.offer, parseInt(b.offer_grade, 10), b.want, parseInt(b.want_grade, 10)]).then((r) => r.v);
  } catch (e) {
    throw { code: 400, msg: /want higher grade/.test(e.message) ? 'просить можно только равный ранг или ниже'
      : /same card/.test(e.message) ? 'это та же карта'
      : /too many/.test(e.message) ? 'уже 3 обмена висят — сними лишний'
      : /no card/.test(e.message) ? 'этой карты у тебя нет'
      : /special/.test(e.message) ? 'особые карты так не меняют' : 'нельзя' };
  }
},
'POST /api/swap/cancel': async (b, ctx) => {
  try { return await one('select cancel_card_swap($1,$2) as v', [ctx.child, b.id]).then((r) => r.v); }
  catch (e) { throw { code: 400, msg: 'нельзя снять' }; }
},
'POST /api/swap/accept': async (b, ctx) => {
  try { return await one('select accept_card_swap($1,$2) as v', [ctx.child, b.id]).then((r) => r.v); }
  catch (e) {
    throw { code: 400, msg: /no card/.test(e.message) ? 'у тебя нет той карты, которую просят'
      : /own swap/.test(e.message) ? 'это твой обмен' : 'обмен недоступен' };
  }
},
'GET /api/gather': async (b, ctx) => {
  const today = await one("select (timezone('Europe/Moscow', now()))::date as d");
  const rows = await q(`
    select g.type_id as type, g.grade, t.code, t.name,
           (g.last_claim is distinct from $2::date) as ready
      from card_gatherers g
      join card_types t on t.id = g.type_id
      join user_cards uc on uc.user_id=g.user_id and uc.type_id=g.type_id and uc.grade=g.grade and uc.qty>0
     where g.user_id=$1
     order by g.trained_at`, [ctx.child, today.d]).catch(() => []);
  return { gatherers: rows, ready: rows.filter((r) => r.ready).length };
},
'POST /api/gather/train': async (b, ctx) => {
  try { await one('select train_gatherer($1,$2,$3) as v', [ctx.child, b.type, b.grade]); }
  catch (e) {
    throw { code: 400, msg: /duplicate/.test(e.message) ? 'нужен дубль — одна карта остаётся в альбоме'
      : /already/.test(e.message) ? 'эта карта уже собирает'
      : /max 5/.test(e.message) ? 'не больше 5 сборщиков'
      : /special/.test(e.message) ? 'особые карты не селят'
      : 'нельзя поселить' };
  }
  return { ok: true };
},
'POST /api/gather/claim': async (b, ctx) => {
  let r;
  try { r = (await one('select claim_gatherers($1) as v', [ctx.child])).v; }
  catch (e) { throw { code: 400, msg: 'не удалось собрать' }; }
  const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
  return { ok: true, gained: r.gained || 0, balance: w.balance };
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
  };
}
