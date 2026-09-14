import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMerge, rollPack, applyPackToAlbum, PACK_PRICE } from '../client/lib/offline-cards.mjs';
import { setupDb, startServer } from './helpers/db.mjs';

const H = (code) => ({ headers: { 'x-child-code': code, 'content-type': 'application/json' } });
const P = (code, body) => ({ method: 'POST', ...H(code), body: JSON.stringify(body || {}) });

function albumFixture() {
  const grades = (qty1) => [1, 2, 3, 4, 5, 6].map((grade) => ({
    grade, qty: grade === 1 ? qty1 : 0, merged: 0, unseen: false,
  }));
  return {
    rarities: [
      { grade: 1, weight: 50 }, { grade: 2, weight: 27 }, { grade: 3, weight: 13 },
      { grade: 4, weight: 7 }, { grade: 5, weight: 2 }, { grade: 6, weight: 1 },
    ],
    seasons: [{ code: 's1', status: 'active' }],
    pity: { opened: 0, to_new: 10, to_top: 50 },
    cards: [
      { id: 't-lisa', code: 'lisa', name: 'Лиса', category: 'zver', season: 's1', grades: grades(3), best: 1, owned: true },
      { id: 't-sova', code: 'sova', name: 'Сова', category: 'zver', season: 's1', grades: grades(0), best: 0, owned: false },
      { id: 't-spec', code: 'spec', name: 'Особая', category: 'special', season: 's1', grades: grades(0), best: 0, owned: false },
    ],
  };
}

test('офлайн-слияние: 3 обычных → 1 рангом выше, ячейка пустеет', () => {
  const data = albumFixture();
  const r = applyMerge(data, 't-lisa', 1);
  assert.equal(r.ok, true);
  assert.equal(r.new_grade, 2);
  const lisa = data.cards[0];
  assert.equal(lisa.grades.find((g) => g.grade === 1).qty, 0);
  assert.equal(lisa.grades.find((g) => g.grade === 2).qty, 1);
  assert.equal(applyMerge(data, 't-lisa', 1).error, 'нужно 3 одинаковых');
});

test('офлайн-пак: 7 карт не из особых, альбом растёт', () => {
  const data = albumFixture();
  const rolled = rollPack(data, () => 0);
  assert.equal(rolled.drawn.length, 7);
  assert.ok(rolled.drawn.every((c) => c.category !== 'special'));
  const cards = applyPackToAlbum(data, rolled.drawn);
  assert.equal(cards.length, 7);
  assert.equal(data.pity.opened, 1);
  assert.ok(data.collected >= 1);
});

test('сервер принимает офлайн-пак один раз и не выдаёт повтор по тому же nonce', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const album = await srv.api('/api/cards', H(db.childA1.code));
  assert.equal(album.status, 200);
  const drop = album.body.cards.filter((c) => c.category !== 'special');
  assert.ok(drop.length >= 7);
  const seven = drop.slice(0, 7).map((c) => ({ type: c.id, grade: 1 }));

  const first = await srv.api('/api/pack/offline', P(db.childA1.code, { nonce: 'testnonce01abcdef', cards: seven }));
  assert.equal(first.status, 200, first.body.error);
  assert.equal(first.body.cards.length, 7);
  assert.equal(first.body.balance, 30 - PACK_PRICE);

  const again = await srv.api('/api/pack/offline', P(db.childA1.code, { nonce: 'testnonce01abcdef', cards: seven }));
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true);
  assert.equal(again.body.balance, first.body.balance);

  const fat = seven.map((c) => ({ ...c, grade: 6 }));
  const greedy = await srv.api('/api/pack/offline', P(db.childA1.code, { nonce: 'testnonce02abcdef', cards: fat }));
  assert.equal(greedy.status, 400);
});
