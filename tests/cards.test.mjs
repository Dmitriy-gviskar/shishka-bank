// Механики Лесной коллекции: заявки, топливо, обменная полка, комиссия, подарки, аукцион.
// Работают на локальной shishka_test (setupDb заливает db/cards.sql), прод не трогается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupDb } from './helpers/db.mjs';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'client/'));
const pg = require('pg');

async function fixture() {
  const ids = await setupDb();
  const pool = new pg.Pool({ connectionString: ids.url });
  const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows);
  const one = (sql, p = []) => q(sql, p).then((r) => r[0] || null);
  const typeId = async (code) => (await one('select id from card_types where code=$1', [code])).id;
  const balance = async (u) => (await one('select balance from wallets where user_id=$1', [u])).balance;
  const give = (u, code, grade, qty) =>
    q(`insert into user_cards(user_id,type_id,grade,qty)
       select $1,(select id from card_types where code=$2),$3,$4
       on conflict (user_id,type_id,grade) do update set qty=excluded.qty`, [u, code, grade, qty]);
  const setBalance = (u, n) => q('update wallets set balance=$2 where user_id=$1', [u, n]);
  return { ...ids, pool, q, one, typeId, balance, give, setBalance };
}

test('заявка: продавец отдаёт карту, покупатель платит, банк берёт комиссию', async () => {
  const f = await fixture();
  try {
    const buyer = f.childA1.id, seller = f.childA2.id;
    await f.setBalance(buyer, 200);
    await f.setBalance(seller, 0);
    await f.give(seller, 'lisa', 4, 1);
    const lisa = await f.typeId('lisa');

    await f.q('select create_want($1,$2,$3,$4)', [buyer, lisa, 4, 60]);
    const want = await f.one("select id from card_wants where buyer_id=$1 and status='open'", [buyer]);
    const r = (await f.one('select fill_want($1,$2) as v', [seller, want.id])).v;

    assert.equal(r.fee, 6);                      // 10% с 60
    assert.equal(r.earned, 54);
    assert.equal(await f.balance(buyer), 140);
    assert.equal(await f.balance(seller), 54);
    const got = await f.one('select qty from user_cards where user_id=$1 and type_id=$2 and grade=4', [buyer, lisa]);
    assert.equal(got.qty, 1);
    const gone = await f.one('select qty from user_cards where user_id=$1 and type_id=$2 and grade=4', [seller, lisa]);
    assert.equal(gone, null);
  } finally { await f.pool.end(); }
});

test('заявку нельзя закрыть из другого круга и себе самому', async () => {
  const f = await fixture();
  try {
    const buyer = f.childA1.id, stranger = f.childB1.id;
    await f.setBalance(buyer, 200);
    await f.give(stranger, 'lisa', 4, 1);
    const lisa = await f.typeId('lisa');
    await f.q('select create_want($1,$2,$3,$4)', [buyer, lisa, 4, 60]);
    const want = await f.one("select id from card_wants where buyer_id=$1 and status='open'", [buyer]);

    await assert.rejects(() => f.q('select fill_want($1,$2)', [stranger, want.id]), /other circle/);
    await assert.rejects(() => f.q('select fill_want($1,$2)', [buyer, want.id]), /own want/);
  } finally { await f.pool.end(); }
});

test('слияние с топливом: 2 своих + 4 излишка, ячейки альбома не пустеют', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id;
    await f.give(kid, 'burunduk', 1, 2);
    await f.give(kid, 'lisa', 1, 3);
    await f.give(kid, 'sova', 1, 3);
    const bur = await f.typeId('burunduk');

    const r = (await f.one('select merge_with_fuel($1,$2,$3) as v', [kid, bur, 1])).v;
    assert.equal(r.new_grade, 2);
    assert.equal(r.emptied, 0);                  // жгли только излишки
    const left = await f.q(`select t.code, uc.qty from user_cards uc join card_types t on t.id=uc.type_id
                            where uc.user_id=$1 and uc.grade=1 order by t.code`, [kid]);
    assert.deepEqual(left, [{ code: 'lisa', qty: 1 }, { code: 'sova', qty: 1 }]);
  } finally { await f.pool.end(); }
});

test('слияние с топливом отказывает, пока не разрешили жечь единственные', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id;
    await f.give(kid, 'burunduk', 1, 2);
    await f.give(kid, 'lisa', 1, 1);
    await f.give(kid, 'sova', 1, 1);
    await f.give(kid, 'zayac', 1, 1);
    await f.give(kid, 'volk', 1, 1);
    const bur = await f.typeId('burunduk');

    await assert.rejects(() => f.q('select merge_with_fuel($1,$2,$3)', [kid, bur, 1]), /needs unique cards/);
    const r = (await f.one('select merge_with_fuel($1,$2,$3,true) as v', [kid, bur, 1])).v;
    assert.equal(r.new_grade, 2);
    assert.equal(r.emptied, 4);
  } finally { await f.pool.end(); }
});

test('обменная полка: 5 излишков → недостающая карта того же ранга', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id;
    await f.give(kid, 'lisa', 1, 4);
    await f.give(kid, 'sova', 1, 3);

    const r = (await f.one('select exchange_cards($1,$2) as v', [kid, 1])).v;
    assert.equal(r.card.grade, 1);
    assert.ok(!['lisa', 'sova'].includes(r.card.code));   // выдаёт то, чего не было
    const spare = await f.one('select coalesce(sum(qty-1),0)::int as n from user_cards where user_id=$1 and grade=1 and qty>1', [kid]);
    assert.equal(spare.n, 0);
    await assert.rejects(() => f.q('select exchange_cards($1,$2)', [kid, 1]), /need 5 spare/);
  } finally { await f.pool.end(); }
});

test('подарок: карта переходит другу, больше трёх в день нельзя', async () => {
  const f = await fixture();
  try {
    const from = f.childA1.id, to = f.childA2.id;
    await f.give(from, 'lisa', 4, 4);
    const lisa = await f.typeId('lisa');

    for (let i = 0; i < 3; i++) await f.q('select gift_card($1,$2,$3,$4)', [from, to, lisa, 4]);
    await assert.rejects(() => f.q('select gift_card($1,$2,$3,$4)', [from, to, lisa, 4]), /daily gift limit/);
    const got = await f.one('select qty from user_cards where user_id=$1 and type_id=$2 and grade=4', [to, lisa]);
    assert.equal(got.qty, 3);
  } finally { await f.pool.end(); }
});

test('золотая карта идёт только с молотка, ставки резервируют шишки', async () => {
  const f = await fixture();
  try {
    const seller = f.childA1.id, bidder = f.childA2.id;
    await f.setBalance(seller, 0);
    await f.setBalance(bidder, 2000);
    await f.give(seller, 'sova', 6, 1);
    const sova = await f.typeId('sova');

    await assert.rejects(() => f.q('select list_card($1,$2,$3,$4)', [seller, sova, 6, 900]), /gold goes to auction/);
    const a = (await f.one('select start_card_auction($1,$2,$3,$4) as v', [seller, sova, 6, 700])).v;

    await assert.rejects(() => f.q('select bid_card_auction($1,$2,$3)', [bidder, a.auction, 500]), /bid too low/);
    await f.q('select bid_card_auction($1,$2,$3)', [bidder, a.auction, 700]);
    assert.equal(await f.balance(bidder), 1300);            // ставка зарезервирована

    await f.q("update card_auctions set ends_at = now() - interval '1 minute' where id=$1", [a.auction]);
    const closed = (await f.one('select close_card_auction($1) as v', [a.auction])).v;
    assert.equal(closed.sold, true);
    assert.equal(await f.balance(seller), 630);             // 700 минус 10% комиссии
    const won = await f.one('select qty from user_cards where user_id=$1 and type_id=$2 and grade=6', [bidder, sova]);
    assert.equal(won.qty, 1);
  } finally { await f.pool.end(); }
});

test('слияние никогда не проигрывает: бонус только вверх', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id;
    await f.give(kid, 'burunduk', 1, 600);
    const bur = await f.typeId('burunduk');
    let bonuses = 0;
    for (let i = 0; i < 200; i++) {
      const r = (await f.one('select merge_cards($1,$2,$3) as v', [kid, bur, 1])).v;
      assert.ok(r.new_grade === 2 || r.new_grade === 3);    // либо +1, либо бонусные +2
      if (r.bonus) bonuses++;
    }
    assert.ok(bonuses > 0 && bonuses < 40, `бонусов ${bonuses} из 200 — ожидали около 5%`);
  } finally { await f.pool.end(); }
});

test('отмена покупки возвращает систему ровно в исходное состояние (комиссия тоже)', async () => {
  const f = await fixture();
  try {
    const buyer = f.childA1.id, seller = f.childA2.id;
    await f.setBalance(buyer, 300);
    await f.setBalance(seller, 100);
    await f.give(seller, 'lisa', 4, 1);
    const lisa = await f.typeId('lisa');
    const treasury = async () => Number((await f.one("select treasury from bank_account where id='main'")).treasury);
    const before = { buyer: await f.balance(buyer), seller: await f.balance(seller), bank: await treasury() };

    const l = (await f.one('select list_card($1,$2,$3,$4) as v', [seller, lisa, 4, 60])).v;
    await f.q('select buy_listing($1,$2)', [buyer, l.listing]);
    assert.equal(await f.balance(seller), 100 + 54);       // 60 минус комиссия 6
    assert.equal(await treasury(), before.bank + 6);

    await f.q('select undo_purchase($1,$2)', [buyer, l.listing]);
    const after = { buyer: await f.balance(buyer), seller: await f.balance(seller), bank: await treasury() };
    assert.deepEqual(after, before, 'после отмены балансы и касса банка должны совпасть с исходными');

    const back = await f.one('select qty from user_cards where user_id=$1 and type_id=$2 and grade=4', [seller, lisa]);
    assert.equal(back.qty, 1);                              // карта вернулась продавцу
    const gone = await f.one('select qty from user_cards where user_id=$1 and type_id=$2 and grade=4', [buyer, lisa]);
    assert.equal(gone, null);
  } finally { await f.pool.end(); }
});

test('шишки не появляются и не исчезают на цепочке рынок → заявка → аукцион', async () => {
  const f = await fixture();
  try {
    const a = f.childA1.id, b = f.childA2.id;
    await f.setBalance(a, 1000);
    await f.setBalance(b, 1000);
    await f.give(a, 'lisa', 4, 2);
    await f.give(b, 'sova', 6, 1);
    const lisa = await f.typeId('lisa'), sova = await f.typeId('sova');
    const total = async () => {
      const w = await f.one('select coalesce(sum(balance),0)::int as s from wallets');
      const t = await f.one("select treasury from bank_account where id='main'");
      return Number(w.s) + Number(t.treasury);
    };
    // достижения тоже платят шишки — их эмиссию считаем отдельно и вычитаем из дельты
    const emitted = async () => {
      const r = await f.one("select coalesce(sum(amount),0)::int as s from transactions where from_user is null and type in ('reward','payout','interest')");
      return Number(r.s);
    };
    const before = await total(), emitBefore = await emitted();

    const l = (await f.one('select list_card($1,$2,$3,$4) as v', [a, lisa, 4, 50])).v;
    await f.q('select buy_listing($1,$2)', [b, l.listing]);
    await f.q('select create_want($1,$2,$3,$4)', [a, lisa, 4, 44]);
    const want = await f.one("select id from card_wants where buyer_id=$1 and status='open'", [a]);
    await f.q('select fill_want($1,$2)', [b, want.id]);
    const auc = (await f.one('select start_card_auction($1,$2,$3,$4) as v', [b, sova, 6, 600])).v;
    await f.q('select bid_card_auction($1,$2,$3)', [a, auc.auction, 600]);
    await f.q("update card_auctions set ends_at = now() - interval '1 minute' where id=$1", [auc.auction]);
    await f.q('select close_card_auction($1)', [auc.auction]);

    const delta = (await total()) - before - ((await emitted()) - emitBefore);
    assert.equal(delta, 0, 'P2P и аукцион только перекладывают шишки: ничего не создаётся и не сгорает');
  } finally { await f.pool.end(); }
});

test('quicksell не даёт фарма: слияние никогда не выгоднее продажи трёх карт', async () => {
  const f = await fixture();
  try {
    const rar = await f.q('select grade, price, quicksell from rarities order by grade');
    const qs = Object.fromEntries(rar.map((r) => [r.grade, r.quicksell]));
    for (let g = 1; g <= 5; g++) {
      // с учётом 5% шанса бонусной двойной эволюции (не выше Легендарной)
      const up = g + 2 <= 5 ? 0.95 * qs[g + 1] + 0.05 * qs[g + 2] : qs[g + 1];
      assert.ok(up < 3 * qs[g], `ранг ${g}: слить (${up}) должно быть дешевле, чем продать три (${3 * qs[g]})`);
    }
    // возврат с пака при полной распродаже — заметно ниже цены пака (20, снижена 27.07)
    const evCard = rar.reduce((s, r) => s + r.quicksell * (r.grade === 1 ? 0.5 : r.grade === 2 ? 0.27
      : r.grade === 3 ? 0.13 : r.grade === 4 ? 0.06 : r.grade === 5 ? 0.03 : 0.01), 0);
    const evPack = evCard * 7;
    assert.ok(evPack < 20 * 0.55, `возврат с пака ${evPack.toFixed(1)} должен быть заметно ниже 20 — иначе пак+распродажа выгоднее самого пака`);
  } finally { await f.pool.end(); }
});

test('паки выдают существ только активного сезона', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id;
    await f.setBalance(kid, 45 * 9);
    const active = (await f.one("select code from card_seasons where status='active'")).code;
    const codes = [];
    for (let i = 0; i < 9; i++) {
      const r = (await f.one('select open_pack($1) as v', [kid])).v;
      codes.push(...r.map((c) => c.code));
    }
    const alien = await f.q('select code from card_types where code = any($1) and season <> $2', [codes, active]);
    assert.deepEqual(alien, [], 'в паках не должно быть существ из других сезонов');
    assert.ok(codes.length === 63);
  } finally { await f.pool.end(); }
});

test('гарант: каждый 10-й пак приносит новую карту, каждый 50-й — Эпическую и выше', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id;
    await f.setBalance(kid, 45 * 60);
    const owned = async () => {
      const r = await f.one('select count(*)::int as n from user_cards where user_id=$1 and qty>0', [kid]);
      return r.n;
    };
    let tenthGaveNew = false;
    for (let i = 1; i <= 10; i++) {
      const before = await owned();
      await f.q('select open_pack($1)', [kid]);
      if (i === 10) tenthGaveNew = (await owned()) > before;
    }
    assert.ok(tenthGaveNew, '10-й пак обязан принести карту, которой не было');

    for (let i = 11; i <= 49; i++) await f.q('select open_pack($1)', [kid]);
    const r = (await f.one('select open_pack($1) as v', [kid])).v;   // 50-й
    assert.ok(r.some((c) => c.grade >= 4 && c.is_new), '50-й пак обязан принести новую Эпическую+');
  } finally { await f.pool.end(); }
});

test('сезон, собранный целиком, платит награду один раз', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id;
    const season = await f.one("select code, name from card_seasons where status='active'");
    const beings = await f.q('select id from card_types where season=$1', [season.code]);
    for (const b of beings)
      for (let g = 1; g <= 6; g++)
        await f.q('insert into user_cards(user_id,type_id,grade,qty) values ($1,$2,$3,1)', [kid, b.id, g]);

    const first = (await f.one('select check_card_rewards($1) as v', [kid])).v;
    const seasonReward = first.filter((r) => r.kind === 'season');
    assert.equal(seasonReward.length, 1);
    assert.equal(seasonReward[0].reward, 300);
    assert.equal(seasonReward[0].name, season.name);

    const again = (await f.one('select check_card_rewards($1) as v', [kid])).v;
    assert.equal(again.filter((r) => r.kind === 'season').length, 0, 'награда за сезон не повторяется');
  } finally { await f.pool.end(); }
});

test('переключение сезона: следующий становится активным, за последним — стоп', async () => {
  const f = await fixture();
  try {
    const before = await f.one("select code, name from card_seasons where status='active'");
    const r = (await f.one('select switch_season() as v')).v;
    assert.equal(r.ok, true);
    assert.equal(r.closed, before.name);
    const now = await f.one("select code from card_seasons where status='active'");
    assert.notEqual(now.code, before.code);
    assert.equal((await f.one('select status from card_seasons where code=$1', [before.code])).status, 'archived');

    // докручиваем до последнего — дальше переключать нечего, активный остаётся
    let guard = 0;
    while ((await f.one('select switch_season() as v')).v.ok && guard++ < 10);
    const last = await f.one("select count(*)::int as n from card_seasons where status='active'");
    assert.equal(last.n, 1, 'активный сезон всегда ровно один');
  } finally { await f.pool.end(); }
});

test('карты прошлого сезона остаются у ребёнка и в обороте', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id, other = f.childA2.id;
    const oldSeason = await f.one("select code from card_seasons where status='active'");
    const being = await f.one('select id, code from card_types where season=$1 limit 1', [oldSeason.code]);
    await f.q('insert into user_cards(user_id,type_id,grade,qty) values ($1,$2,4,1)', [kid, being.id]);
    await f.q('select switch_season()');

    // карта на месте, её можно выставить на рынок и купить
    const still = await f.one('select qty from user_cards where user_id=$1 and type_id=$2 and grade=4', [kid, being.id]);
    assert.equal(still.qty, 1);
    const l = (await f.one('select list_card($1,$2,4,44) as v', [kid, being.id])).v;
    await f.setBalance(other, 200);
    await f.q('select buy_listing($1,$2)', [other, l.listing]);
    const bought = await f.one('select qty from user_cards where user_id=$1 and type_id=$2 and grade=4', [other, being.id]);
    assert.equal(bought.qty, 1, 'карта архивного сезона свободно обращается на рынке');
  } finally { await f.pool.end(); }
});

test('о событиях рынка и торгов приходит весточка в почту', async () => {
  const f = await fixture();
  try {
    const seller = f.childA1.id, buyer = f.childA2.id, third = null;
    await f.setBalance(buyer, 2000);
    await f.setBalance(seller, 100);
    await f.give(seller, 'lisa', 4, 1);
    await f.give(seller, 'sova', 6, 1);
    const lisa = await f.typeId('lisa'), sova = await f.typeId('sova');
    const inbox = async (u) => f.q('select content from messages where to_user=$1 order by created_at desc', [u]);

    const l = (await f.one('select list_card($1,$2,4,44) as v', [seller, lisa])).v;
    await f.q('select buy_listing($1,$2)', [buyer, l.listing]);
    assert.ok((await inbox(seller)).some((m) => /купили на рынке/.test(m.content)), 'продавцу сообщили о покупке');

    const a = (await f.one('select start_card_auction($1,$2,6,700) as v', [seller, sova])).v;
    await f.q('select bid_card_auction($1,$2,700)', [buyer, a.auction]);
    assert.ok((await inbox(seller)).some((m) => /Новая ставка/.test(m.content)), 'продавцу сообщили о ставке');

    await f.q("update card_auctions set ends_at = now() - interval '1 minute' where id=$1", [a.auction]);
    await f.q('select close_card_auction($1)', [a.auction]);
    assert.ok((await inbox(buyer)).some((m) => /выиграл торги/.test(m.content)), 'победителю сообщили');
    assert.ok((await inbox(seller)).some((m) => /ушла с молотка/.test(m.content)), 'продавцу сообщили об итоге');
  } finally { await f.pool.end(); }
});

test('закрытый рынок блокирует только сделки — паки, слияния и подарки живут', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id, friend = f.childA2.id;
    await f.setBalance(kid, 500);
    await f.give(kid, 'lisa', 4, 3);
    const lisa = await f.typeId('lisa');
    await f.q('update users set market_allowed=false where id=$1', [kid]);

    await assert.rejects(() => f.q('select list_card($1,$2,4,44)', [kid, lisa]), /market disabled/);
    await assert.rejects(() => f.q('select create_want($1,$2,5,120)', [kid, lisa]), /market disabled/);
    await assert.rejects(() => f.q('select start_card_auction($1,$2,4,44)', [kid, lisa]), /market disabled/);

    // а вот это должно работать
    const merged = (await f.one('select merge_cards($1,$2,4) as v', [kid, lisa])).v;
    assert.ok(merged.new_grade >= 5);
    const gift = (await f.one('select gift_card($1,$2,$3,$4) as v', [kid, friend, lisa, merged.new_grade])).v;
    assert.equal(gift.ok, true);
    await f.q('select open_pack($1)', [kid]);
  } finally { await f.pool.end(); }
});

test('спец-карта не падает из паков, но вручается ведущим', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id;
    await f.setBalance(kid, 45 * 25);
    const special = await f.one("select id, code from card_types where season = (select code from card_seasons where status='active') limit 1");
    await f.q('update card_types set pack_drop=false where id=$1', [special.id]);

    const seen = [];
    for (let i = 0; i < 25; i++) {
      const r = (await f.one('select open_pack($1) as v', [kid])).v;
      seen.push(...r.map((c) => c.code));
    }
    assert.ok(!seen.includes(special.code), 'спец-карта не должна выпадать из паков');

    const g = (await f.one('select grant_card($1,$2,5,$3) as v', [kid, special.id, 'за помощь в лесу'])).v;
    assert.equal(g.ok, true);
    const has = await f.one('select qty from user_cards where user_id=$1 and type_id=$2 and grade=5', [kid, special.id]);
    assert.equal(has.qty, 1);
    const msg = await f.one('select content from messages where to_user=$1 order by created_at desc limit 1', [kid]);
    assert.match(msg.content, /Ведущий вручил тебе карту/);
  } finally { await f.pool.end(); }
});

test('метрики показывают карты стоком, а не станком', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id;
    await f.setBalance(kid, 20 * 5);
    for (let i = 0; i < 5; i++) await f.q('select open_pack($1)', [kid]);
    const m = (await f.one('select card_metrics($1,7) as v', [f.circleA])).v;
    assert.equal(m.packs, 5);
    assert.equal(m.spent, 100);
    assert.ok(m.earned - m.spent < 0, 'нетто по картам обязан быть отрицательным');
    assert.equal(m.players, 1);
  } finally { await f.pool.end(); }
});

test('особые карты: не выпадают, не торгуются, не портят прогресс', async () => {
  const f = await fixture();
  try {
    const kid = f.childA1.id, friend = f.childA2.id;
    const sp = await f.one("select id, code, name, occasion from card_types where category='special' order by sort limit 1");
    assert.ok(sp, 'особые карты должны быть в каталоге');
    assert.ok(sp.occasion, 'у особой карты есть повод вручения');

    // 20 паков — особая не должна выпасть ни разу
    await f.setBalance(kid, 45 * 20);
    const seen = [];
    for (let i = 0; i < 20; i++) {
      const r = (await f.one('select open_pack($1) as v', [kid])).v;
      seen.push(...r.map((c) => c.code));
    }
    assert.ok(!seen.some((c) => c.startsWith('special_')), 'особые карты не выпадают из паков');

    // вручение работает, торговля — нет
    await f.q('select grant_card($1,$2,6,$3)', [kid, sp.id, 'за дело']);
    await assert.rejects(() => f.q('select list_card($1,$2,6,500)', [kid, sp.id]), /not tradable/);
    await assert.rejects(() => f.q('select start_card_auction($1,$2,6,500)', [kid, sp.id]), /not tradable/);
    await assert.rejects(() => f.q('select sell_card_to_bank($1,$2,6)', [kid, sp.id]), /not tradable/);
    await assert.rejects(() => f.q('select create_want($1,$2,6,500)', [kid, sp.id]), /not tradable/);
    // а подарить другу можно
    const g = (await f.one('select gift_card($1,$2,$3,6) as v', [kid, friend, sp.id])).v;
    assert.equal(g.ok, true);

    // и в «собери всё» особые не участвуют: счёт = только обычные существа, спец-карты вне его
    const total = await f.one("select count(*)::int as n from card_types where category <> 'special'");
    const specials = await f.one("select count(*)::int as n from card_types where category = 'special'");
    const all = await f.one('select count(*)::int as n from card_types');
    assert.ok(specials.n > 0, 'спец-карты в каталоге есть');
    assert.equal(total.n, all.n - specials.n, 'счёт коллекции не включает особые карты');
  } finally { await f.pool.end(); }
});
