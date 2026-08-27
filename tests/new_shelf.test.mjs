import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_BATCH, pageUnseen } from '../client/lib/new-shelf.mjs';

test('новинки режутся пачками по 10, не все сразу', () => {
  assert.equal(NEW_BATCH, 10);
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  const first = pageUnseen(items);
  assert.deepEqual(first.visible, items.slice(0, 10));
  assert.equal(first.rest, 13);
  assert.equal(first.total, 23);

  const second = pageUnseen(items, 20);
  assert.equal(second.visible.length, 20);
  assert.equal(second.rest, 3);

  const last = pageUnseen(items, 30);
  assert.equal(last.visible.length, 23);
  assert.equal(last.rest, 0);

  assert.deepEqual(pageUnseen([]).visible, []);
  assert.equal(pageUnseen(null).rest, 0);
});
