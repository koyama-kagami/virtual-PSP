import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalogStick } from './analog-stick.js';

test('an off-centre grab follows the finger without jumping and clamps to a circle', () => {
  const stick = new AnalogStick(.24);
  assert.equal(stick.begin(11, .3, -.1), true);
  assert.equal(stick.x, 0);
  stick.move(11, .42, .02);
  assert.ok(Math.abs(stick.x - .12) < 1e-9);
  assert.ok(Math.abs(stick.y - .12) < 1e-9);
  for (let angle = 0; angle < Math.PI * 2; angle += .1) {
    stick.move(11, .3 + Math.cos(angle) * 2, -.1 + Math.sin(angle) * 2);
    assert.ok(Math.abs(Math.hypot(stick.x, stick.y) - .24) < 1e-9);
    assert.ok(Math.abs(stick.x - .24 * Math.cos(angle)) < 1e-9);
  }
});

test('another pointer cannot steal, move or release the active nub', () => {
  const stick = new AnalogStick();
  stick.begin(11, 0, 0);
  stick.move(11, .2, 0);
  assert.equal(stick.begin(22, 0, 0), false);
  assert.equal(stick.move(22, -2, 0), false);
  assert.equal(stick.release(22), false);
  assert.equal(stick.pointerId, 11);
  assert.equal(stick.x, .2);
});

test('release returns to centre without overshoot and a new grab interrupts the return', () => {
  const stick = new AnalogStick();
  stick.begin(1, 0, 0); stick.move(1, .24, 0); stick.release(1);
  stick.update(.016);
  assert.ok(stick.x > 0 && stick.x < .24);
  const current = stick.x;
  stick.begin(2, .5, 0); stick.move(2, .5, 0);
  assert.equal(stick.x, current);
  stick.release(2);
  for (let i = 0; i < 30; i++) stick.update(.016);
  assert.equal(stick.x, 0);
  assert.equal(stick.y, 0);
});

test('cancellation and reduced motion restore the neutral input', () => {
  const stick = new AnalogStick();
  stick.begin(1, 0, 0); stick.move(1, -.2, -.1); stick.reset();
  assert.equal(stick.pointerId, null);
  stick.update(.016, true);
  assert.equal(stick.x, 0); assert.equal(stick.y, 0);
});
