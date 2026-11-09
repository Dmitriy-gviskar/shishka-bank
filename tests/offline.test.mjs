import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMerge } from '../client/lib/offline-cards.mjs';

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

