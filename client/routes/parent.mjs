// Кабинет родителя: /api/parent/*
export function routesParent({ q, one, rpc, auth, assertOwn, memoGet, memo, sendPush, genLoginCode }) {
  return {
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
// ── Кабинет родителя ──
'GET /api/parent/children': async () => {
  const kids = await q(
    `select cl.code, u.id, u.name, u.tree_level as level, u.market_allowed, w.balance,
            u.created_at, c.name as circle_name
       from child_logins cl
       join users u on u.id=cl.child_id
       join wallets w on w.user_id=u.id
       join circles c on c.id=u.circle_id
      where u.role='child'
      order by u.created_at desc`);
  for (const k of kids) {
    k.guardians = (await q(
      `select g.guardian_id as id, u.name
         from child_guardians g join users u on u.id = g.guardian_id
        where g.child_id = $1 order by u.name`, [k.id])).map((x) => x.name);
  }
  return kids;
},
'POST /api/parent/link-guardian': async (b) => {
  const child = await one("select id, name, circle_id from users where id=$1 and role='child'", [b.childId]);
  if (!child) throw { code: 400, msg: 'нет такого ребёнка' };
  const g = await one(
    "select id, name from users where id=$1 and role='child' and circle_id=$2",
    [b.guardianId, child.circle_id]);
  if (!g) throw { code: 400, msg: 'опекун должен быть в том же кругу' };
  if (g.id === child.id) throw { code: 400, msg: 'нельзя привязать к себе' };
  await q(
    'insert into child_guardians(child_id, guardian_id) values($1,$2) on conflict do nothing',
    [child.id, g.id]);
  return { ok: true, child: child.name, guardian: g.name };
},
'POST /api/parent/unlink-guardian': async (b) => {
  await q('delete from child_guardians where child_id=$1 and guardian_id=$2', [b.childId, b.guardianId]);
  return { ok: true };
},
'POST /api/parent/remove-child': async (b) => {
  const u = await one(
    `select id, name, circle_id, role from users where id=$1`, [b.childId]);
  if (!u || u.role !== 'child') throw { code: 400, msg: 'нет такого игрока' };
  const confirm = String(b.confirm || '').trim();
  if (!confirm || confirm.toLowerCase() !== String(u.name).toLowerCase()) {
    throw { code: 400, msg: `для удаления введи имя точно: ${u.name}` };
  }
  auth.dropCache();
  await q('update device_tokens set revoked_at=now() where child_id=$1 and revoked_at is null', [u.id]).catch(() => {});
  await q('delete from users where id=$1 and role=$2', [u.id, 'child']);
  // пустой круг после открытой регистрации — убираем
  const left = await one('select count(*)::int as n from users where circle_id=$1', [u.circle_id]);
  if (left && left.n === 0) {
    await q('delete from circles where id=$1', [u.circle_id]).catch((e) => console.error('remove circle', e.message));
  }
  return { ok: true, name: u.name };
},
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
  // семья: новый ребёнок сразу дружит со всеми в круге
  await q(
    `insert into friendships(user_id, friend_id, status)
     select $1, id, 'accepted' from users where circle_id=$2 and role='child' and id<>$1
     on conflict (user_id, friend_id) do update set status='accepted'`,
    [u.id, circle.id]).catch(() => {});
  await q(
    `insert into friendships(user_id, friend_id, status)
     select id, $1, 'accepted' from users where circle_id=$2 and role='child' and id<>$1
     on conflict (user_id, friend_id) do update set status='accepted'`,
    [u.id, circle.id]).catch(() => {});
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
'GET /api/parent/purchases': async () => {
  const list = await q(`
    select p.id, p.price, p.created_at, u.name as "childName", i.title, p.child_id
      from purchases p
      join users u on u.id = p.child_id
      join shop_items i on i.id = p.item_id
     where p.status = 'promised'
     order by p.created_at`);
  for (const p of list) {
    p.guardians = (await q(
      `select u.name from child_guardians g join users u on u.id = g.guardian_id
        where g.child_id = $1 order by u.name`, [p.child_id])).map((x) => x.name);
    delete p.child_id;
  }
  return list;
},
'POST /api/parent/purchase/fulfill': async (b) => {
  let pu;
  try { [pu] = await rpc('fulfill_purchase', [b.id]); }
  catch { throw { code: 400, msg: 'нет такого обещания' }; }
  sendPush(pu.child_id, '🎁 Получено!', 'Ведущий исполнил твоё впечатление').catch(() => {});
  return { ok: true };
},
'POST /api/parent/purchase/cancel': async (b) => {
  let pu;
  try { [pu] = await rpc('cancel_purchase', [b.id]); }
  catch { throw { code: 400, msg: 'нет такого обещания' }; }
  sendPush(pu.child_id, '↩️ Возврат', 'Обещание отменили — шишки вернулись').catch(() => {});
  return { ok: true };
},
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
'POST /api/parent/reject': async (b) => {
  let t;
  try { [t] = await rpc('reject_task', [b.id]); }
  catch { return { ok: true }; }
  if (t?.child_id) {
    sendPush(t.child_id, '📝 Доработай дело', `«${t.title}» вернули — отправь ещё раз`).catch(() => {});
  }
  return { ok: true };
},
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
  };
}
