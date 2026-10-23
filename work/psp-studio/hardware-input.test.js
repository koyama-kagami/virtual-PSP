import test from 'node:test';
import assert from 'node:assert/strict';
import { createHardwareInput } from './hardware-input.js';

function fixture(options = {}) {
  const actions = [], pressed = [];
  let time = 0;
  const input = createHardwareInput({
    ...options,
    now: () => time,
    onAction: (name, phase) => actions.push([name, phase]),
    onPressed: (name, value) => pressed.push([name, value]),
  });
  return { input, actions, pressed, at(value) { time = value; input.update(); } };
}

test('ordinary buttons remain depressed until their owner releases them', () => {
  const { input, actions, pressed, at } = fixture();
  input.press('cross', 'pointer:1');
  assert.equal(input.isActive, true);
  assert.equal(input.isPressed('cross'), true);
  at(2000);
  assert.deepEqual(actions, [['cross', 'press']]);
  input.release('pointer:1');
  assert.deepEqual(actions, [['cross', 'press'], ['cross', 'release']]);
  assert.deepEqual(pressed, [['cross', true], ['cross', false]]);
  assert.equal(input.isActive, false);
  assert.equal(input.isPressed('cross'), false);
});

test('duplicate browser keydown events neither retrigger nor extend the repeat delay', () => {
  const { input, actions, at } = fixture();
  input.press('right', 'key:ArrowRight');
  at(300);
  assert.equal(input.press('right', 'key:ArrowRight'), false);
  at(399);
  assert.deepEqual(actions, [['right', 'press']]);
  at(400);
  at(489);
  at(490);
  assert.deepEqual(actions, [['right', 'press'], ['right', 'repeat'], ['right', 'repeat']]);
});

test('volume keys repeat but a background time jump never replays a backlog', () => {
  const { input, actions, at } = fixture();
  input.press('volumeDown', 'pointer:1');
  at(5000);
  at(5000);
  assert.deepEqual(actions, [['volumeDown', 'press'], ['volumeDown', 'repeat']]);
  at(5089);
  assert.equal(actions.length, 2);
  at(5090);
  assert.deepEqual(actions.at(-1), ['volumeDown', 'repeat']);
  assert.equal(actions.length, 3);
});

test('short presses of long-capable controls dispatch a tap only on release', () => {
  for (const [name, duration] of [['display', 999], ['note', 999], ['power', 2999]]) {
    const { input, actions, pressed } = fixture();
    input.press(name, 0, 10);
    assert.deepEqual(actions, []);
    input.release(0, 10 + duration);
    assert.deepEqual(actions, [[name, 'tap'], [name, 'release']]);
    assert.deepEqual(pressed, [[name, true], [name, false]]);
  }
});

test('display long and extended holds each fire once and suppress the release tap', () => {
  const { input, actions, at } = fixture();
  input.press('display', 'key:KeyB');
  at(1000);
  at(2000);
  assert.deepEqual(actions, [['display', 'long']]);
  at(5000);
  at(7000);
  input.release('key:KeyB');
  assert.deepEqual(actions, [['display', 'long'], ['display', 'extended'], ['display', 'release']]);
});

test('a long hold is recognized on release even if rendering missed its threshold', () => {
  const { input, actions } = fixture();
  input.press('power', 'pointer:1', 10);
  input.release('pointer:1', 3010);
  assert.deepEqual(actions, [['power', 'long'], ['power', 'release']]);
  input.press('note', 'pointer:2', 5000);
  input.release('pointer:2', 6000);
  assert.deepEqual(actions.slice(2), [['note', 'long'], ['note', 'release']]);
});

test('cancelling a gesture releases its visual without a late tap or hold action', () => {
  const { input, actions, pressed, at } = fixture();
  input.press('power', 'pointer:1');
  input.cancel('pointer:1');
  at(5000);
  input.release('pointer:1');
  assert.deepEqual(actions, []);
  assert.deepEqual(pressed, [['power', true], ['power', false]]);
  assert.equal(input.isActive, false);
});

test('two owners of the same physical key share one gesture until the last release', () => {
  const { input, actions, pressed, at } = fixture();
  input.press('display', 'pointer:1');
  at(100);
  input.press('display', 'key:KeyB');
  input.release('pointer:1', 200);
  assert.equal(input.isPressed('display'), true);
  assert.deepEqual(pressed, [['display', true]]);
  assert.deepEqual(actions, []);
  input.release('key:KeyB', 300);
  assert.deepEqual(actions, [['display', 'tap'], ['display', 'release']]);
  assert.deepEqual(pressed, [['display', true], ['display', false]]);
});

test('cancelling one owner does not release a key another owner still holds', () => {
  const { input, actions, pressed, at } = fixture();
  input.press('left', 'pointer:1');
  input.press('left', 'key:ArrowLeft');
  input.cancel('pointer:1');
  at(400);
  assert.deepEqual(pressed, [['left', true]]);
  assert.deepEqual(actions, [['left', 'press'], ['left', 'repeat']]);
  input.release('key:ArrowLeft');
  assert.deepEqual(pressed, [['left', true], ['left', false]]);
});

test('cancelAll clears every owner and allows fresh gestures without stuck keys', () => {
  const { input, actions, pressed, at } = fixture();
  input.press('display', 'pointer:1');
  input.press('display', 'key:KeyB');
  input.press('power', 'key:KeyP');
  input.cancelAll();
  input.cancelAll();
  at(10000);
  assert.equal(input.isActive, false);
  assert.deepEqual(actions, []);
  assert.deepEqual(pressed, [['display', true], ['power', true], ['display', false], ['power', false]]);
  input.press('display', 'pointer:1');
  input.release('pointer:1');
  assert.deepEqual(actions, [['display', 'tap'], ['display', 'release']]);
});

test('policy overrides can disable a default hold and customize a repeat control', () => {
  const { input, actions, at } = fixture({ policies: {
    power: { longMs: 0 },
    custom: { repeatDelay: 200, repeatInterval: 50 },
  } });
  input.press('power', 'p');
  input.release('p');
  assert.deepEqual(actions, [['power', 'press'], ['power', 'release']]);
  input.press('custom', 'c');
  at(199);
  assert.deepEqual(actions.at(-1), ['custom', 'press']);
  at(200);
  at(250);
  assert.deepEqual(actions.slice(2), [['custom', 'press'], ['custom', 'repeat'], ['custom', 'repeat']]);
});

test('an action cancelling input cannot leave a pressed visual or trigger another hold phase', () => {
  const actions = [], pressed = [];
  const input = createHardwareInput({
    now: () => 0,
    onPressed: (name, value) => pressed.push([name, value]),
    onAction(name, phase) { actions.push([name, phase]); input.cancelAll(); },
  });
  input.press('display', 'pointer:1');
  input.update(5000);
  assert.deepEqual(actions, [['display', 'long']]);
  assert.deepEqual(pressed, [['display', true], ['display', false]]);
  assert.equal(input.isActive, false);
});
