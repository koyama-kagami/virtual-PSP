import test from 'node:test';
import assert from 'node:assert/strict';
import * as finishes from './finishes.js';

test('colour catalogue isolates hardware generations and falls back within that generation', () => {
  assert.equal(typeof finishes.getFinishes, 'function', 'model-specific catalogue is required');
  const one = finishes.getFinishes('1000');
  const two = finishes.getFinishes('2000');
  const three = finishes.getFinishes('3000');
  assert.ok(one.some(f => f.english === 'Champagne Gold'));
  assert.ok(two.some(f => f.english === 'Felicia Blue'));
  assert.ok(two.some(f => f.english === 'Mint Green'));
  assert.equal(one.some(f => f.id === 'black-red'), false);
  assert.equal(two.some(f => f.id === 'black-red'), false);
  assert.equal(three.length, 14);
  assert.equal(finishes.getFinish('black-red', '1000').id, 'black');
  assert.equal(finishes.getFinish('white', '2000').english, 'Ceramic White');
  assert.equal(finishes.getFinish('white', '3000').english, 'Pearl White');
});

test('each catalogue has unique, renderable finish entries', () => {
  assert.equal(typeof finishes.getFinishes, 'function');
  for (const model of ['1000', '2000', '3000']) {
    const list = finishes.getFinishes(model);
    assert.equal(new Set(list.map(f => f.id)).size, list.length);
    for (const finish of list) {
      for (const key of ['shell', 'rear', 'button', 'core', 'ink', 'utility']) {
        assert.match(finish[key], /^#[0-9a-f]{6}$/i, `${model}/${finish.id}/${key}`);
      }
      for (const key of ['roughness', 'metalness', 'clearcoat', 'clearcoatRoughness', 'coatTexture']) {
        assert.ok(Number.isFinite(finish[key]) && finish[key] >= 0 && finish[key] <= 1);
      }
    }
  }
});
