import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../client/parent.js', import.meta.url), 'utf8');
function mount(savedPin) {
  const nodes = new Map();
  const storage = new Map(savedPin ? [['parentPin', savedPin]] : []);
  let calls = 0;
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, style: {}, value: '', addEventListener() {} });
    return nodes.get(id);
  };
  const context = { window: { api: async () => { calls++; return { error: 'Нужен PIN ведущего' }; }, esc: String }, document: { getElementById: node }, sessionStorage: { getItem: (k) => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: (k) => storage.delete(k) } };
  vm.runInNewContext(source, context);
  context.window.runParent();
  return { node, storage, calls: () => calls };
}

test('host UI starts closed and does not fetch children before PIN', () => {
  const ui = mount();
  assert.equal(ui.node('cabinet').hidden, true);
  assert.equal(ui.node('pinGate').hidden, false);
  assert.equal(ui.calls(), 0);
});

test('invalid PIN leaves cabinet closed and removes stored secret', async () => {
  const ui = mount();
  ui.node('pinInput').value = 'wrong';
  await ui.node('pinEnter').onclick();
  assert.equal(ui.calls(), 1);
  assert.equal(ui.node('cabinet').hidden, true);
  assert.equal(ui.storage.has('parentPin'), false);
  assert.equal(ui.node('pinNote').textContent, 'Нужен PIN ведущего');
});

test('invalid restored PIN does not open cabinet', async () => {
  const ui = mount('expired');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.node('cabinet').hidden, true);
  assert.equal(ui.storage.has('parentPin'), false);
});
