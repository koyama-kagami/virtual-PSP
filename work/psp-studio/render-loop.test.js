import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderLoop } from './render-loop.js';

function clock() {
  let time = 0, id = 0;
  const frames = new Map(), timers = new Map();
  return {
    now: () => time,
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn, delay) => { timers.set(++id, {fn, at: time + delay}); return id; },
    clearTimeout: id => timers.delete(id),
    frame() { time += 16; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(time)); },
    advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } },
    get pending() { return frames.size + timers.size; },
  };
}

test('idle rendering sleeps between frames and input immediately preempts its timer', () => {
  const time = clock(); let draws = 0;
  const loop = createRenderLoop(() => { draws++; return 1000; }, time);
  loop.invalidate(); loop.invalidate(); time.frame();
  assert.equal(draws, 1);
  time.frame(); assert.equal(draws, 1);
  loop.invalidate(); loop.invalidate(); time.frame();
  assert.equal(draws, 2);
  assert.equal(time.pending, 1);
  loop.dispose(); assert.equal(time.pending, 0);
});

test('suspend cancels all work, resume draws once, and disposal cannot restart', () => {
  const time = clock(); let draws = 0;
  const loop = createRenderLoop(() => { draws++; return 0; }, time);
  loop.invalidate(); time.frame(); loop.suspend();
  loop.invalidate(); time.advance(2000); time.frame(); assert.equal(draws, 1);
  loop.resume(); loop.resume(); time.frame(); assert.equal(draws, 2);
  loop.dispose(); loop.resume(); loop.invalidate(); time.frame();
  assert.equal(draws, 2); assert.equal(time.pending, 0);
});

test('a completely static scene schedules no timer until invalidated', () => {
  const time = clock(); let draws = 0;
  const loop = createRenderLoop(() => { draws++; return Infinity; }, time);
  loop.invalidate(); time.frame();
  assert.equal(time.pending, 0);
  time.advance(60_000); time.frame(); assert.equal(draws, 1);
  loop.invalidate(); time.frame(); assert.equal(draws, 2);
});

test('a due idle timer yields to a single animation frame without duplicate loops', () => {
  const time = clock(); let draws = 0;
  const loop = createRenderLoop(() => { draws++; return 50; }, time);
  loop.invalidate(); time.frame(); time.advance(50); loop.invalidate(); time.frame();
  assert.equal(draws, 2); assert.equal(time.pending, 1);
  loop.dispose();
});
