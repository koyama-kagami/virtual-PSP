import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeInput } from './runtime-input.js';

test('button ownership preserves other pointers and emits ordered edges', () => {
  const packets = []; const input = createRuntimeInput({ send: s => packets.push(s) });
  input.press('cross', 'keyboard'); input.press('cross', 'pointer1');
  input.press('circle', 'pointer2'); input.release('pointer1');
  assert.deepEqual(packets.at(-1).buttons, ['circle', 'cross']);
  input.release('keyboard'); assert.deepEqual(packets.at(-1).buttons, ['circle']);
  input.release('pointer2'); assert.deepEqual(packets.at(-1).buttons, []);
  assert.deepEqual(packets.map(p => p.sequence), packets.map((_, i) => i + 1));
});
test('axes clamp and release immediately restores remaining owner or center', () => {
  const packets = []; const input = createRuntimeInput({ send: s => packets.push(s) });
  input.setAxis('gamepad', .2, -.3); input.setAxis('pointer', 4, -4);
  assert.deepEqual([packets.at(-1).x, packets.at(-1).y], [1, -1]);
  input.releaseAxis('pointer'); assert.equal(packets.at(-1).x, .2);
  input.releaseAxis('gamepad'); assert.equal(packets.at(-1).x, 0);
  input.press('cross', 'keyboard'); input.clear();
  assert.deepEqual(packets.at(-1), { buttons: [], x: 0, y: 0, sequence: packets.length });
});
