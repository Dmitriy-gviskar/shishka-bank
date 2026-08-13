// Лесная коллекция: карты, питомцы, рынок, аукционы, wants.
export function routesCards({ q, one, rpc, assertOwn, assertFriend }) {
  return {
// ── Лесная коллекция (карточки) ──
'GET /api/cards': async (b, ctx) => {
  const [types, rar, owned, lore, seasons, packs, fam, history, facts] = await Promise.all([
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
  ]);
  const own = {};   // type_id → {grade: {qty, merged, unseen}}
  for (const r of owned) {
    (own[r.type_id] ||= {})[r.grade] = { qty: r.qty, merged: r.merged, unseen: !r.seen_at };
  }
  const cards = types.map((t) => {
    const have = own[t.id] || {};
    const grades = rar.map((g) => {
      const h = have[g.grade] || {};
      return { grade: g.grade, qty: h.qty || 0, merged: h.merged || 0, unseen: !!h.unseen };
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
// Альбом друга в круге — чтобы торговать не вслепую (qty свои + чужие)
'POST /api/friend/cards': async (b, ctx) => {
  if (!b.id) throw { code: 400, msg: 'выбери друга' };
  await assertOwn(
    "select 1 from users where id=$1 and circle_id=$2 and role='child' and id<>$3",
    [b.id, ctx.circle, ctx.child], 'нет такого друга');
  if (assertFriend) await assertFriend(ctx.child, b.id);
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
  if (assertFriend) await assertFriend(ctx.child, b.to);
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
  };
}
