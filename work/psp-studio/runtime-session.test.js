import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeSession } from './runtime-session.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function adapter() {
  const listeners = []; const calls = [];
  return { listeners, calls,
    async initialize(config, signal) { calls.push(['initialize', config, signal]); return { originalVsh: true }; },
    async boot(profile) { calls.push(['boot', profile]); },
    async setPaused(...args) { calls.push(['pause', ...args]); },
    setController(s) { calls.push(['controller', s]); },
    async command(c) { calls.push(['command', c]); return c; },
    async close() { calls.push(['close']); },
    subscribe(fn) { listeners.push(fn); return () => calls.push(['unsubscribe']); },
  };
}
test('start deduplicates and exposes immutable subscribed state', async () => {
  const a = adapter(); const s = createRuntimeSession(a); const seen = [];
  const unsubscribe = s.subscribe(state => seen.push(state.status));
  const first = s.start({ profile: 'vsh' }); assert.equal(first, s.start()); await first;
  assert.equal(s.state.status, 'running'); assert.equal(a.calls.filter(c => c[0] === 'boot').length, 1);
  assert.ok(Object.isFrozen(s.state)); assert.ok(seen.includes('booting')); unsubscribe();
  await s.start(); assert.equal(a.calls.filter(c => c[0] === 'boot').length, 1); await s.dispose();
});
test('stop aborts initialization and ignores late startup/events after restart', async () => {
  const a = adapter(); const gate = deferred(); const initial = a.initialize;
  a.initialize = (config, signal) => { a.signal = signal; return gate.promise; };
  const s = createRuntimeSession(a); const old = s.start(); const oldListener = a.listeners[0];
  await Promise.resolve();
  await s.stop(); assert.equal(a.signal.aborted, true); assert.equal(s.state.status, 'off');
  a.initialize = initial; await s.start(); const epoch = s.state.epoch;
  gate.resolve({}); await old; oldListener({ type: 'error', error: 'stale' });
  a.listeners.at(-1)({ type: 'state', status: 'paused', epoch: epoch - 1 });
  assert.equal(s.state.status, 'running'); assert.equal(s.state.epoch, epoch); await s.dispose();
});
test('pause reasons survive independent release and startup; failure can retry', async () => {
  const a = adapter(); const s = createRuntimeSession(a);
  await s.setPaused('hidden', true); await s.start(); assert.equal(s.state.status, 'paused');
  await s.setPaused('user', true); await s.setPaused('hidden', false);
  assert.equal(s.state.status, 'paused'); await s.setPaused('user', false); assert.equal(s.state.status, 'running');
  await s.stop(); const init = a.initialize; a.initialize = async () => { throw Error('offline'); };
  await assert.rejects(s.start(), /offline/); assert.equal(s.state.status, 'error');
  a.initialize = init; await s.start(); assert.equal(s.state.status, 'running'); await s.dispose();
});
test('commands serialize and disposal closes once and rejects new work', async () => {
  const a = adapter(); const s = createRuntimeSession(a); await s.start();
  assert.equal(await s.command('home'), 'home'); s.setController({ buttons: ['cross'], x: 0, y: 0, sequence: 1 });
  const first = s.dispose(); assert.equal(first, s.dispose()); await first;
  assert.equal(a.calls.filter(c => c[0] === 'close').length, 1);
  await assert.rejects(s.start(), /disposed/); await assert.rejects(s.command('home'), /disposed/);
});
test('backend boot error cannot be overwritten by boot promise completion', async () => {
  const a = adapter(); const gate = deferred(); a.boot = () => gate.promise;
  const s = createRuntimeSession(a); const start = s.start();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  a.listeners[0]({ type: 'error', error: new Error('core crashed') });
  gate.resolve(); await start; assert.equal(s.state.status, 'error'); await s.dispose();
});
test('queued commands preserve order and stop invalidates pending commands', async () => {
  const a = adapter(); const gate = deferred(); const executed = [];
  a.command = async value => { executed.push(value); if (value === 'first') await gate.promise; return value; };
  const s = createRuntimeSession(a); await s.start();
  const first = s.command('first'); const second = s.command('second');
  await Promise.resolve(); await Promise.resolve(); assert.deepEqual(executed, ['first']);
  await s.stop(); gate.resolve(); await first;
  await assert.rejects(second, /unavailable/); assert.deepEqual(executed, ['first']); await s.dispose();
});
test('pause released while startup pause is awaiting also releases backend reason', async () => {
  const a = adapter(); const gate = deferred();
  a.setPaused = async (...args) => { a.calls.push(['pause', ...args]); if (args[1]) await gate.promise; };
  const s = createRuntimeSession(a); await s.setPaused('hidden', true); const start = s.start();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await s.setPaused('hidden', false); gate.resolve(); await start;
  assert.deepEqual(a.calls.filter(c => c[0] === 'pause').at(-1), ['pause', 'hidden', false]);
  assert.equal(s.state.status, 'running'); await s.dispose();
});

test('neutral controller snapshots still clear backend when paused or faulted', async () => {
  const a = adapter(); const s = createRuntimeSession(a); await s.start();
  await s.setPaused('power', true);
  s.setController({ buttons: ['cross'], x: 0, y: 0, sequence: 1 });
  const neutral = { buttons: [], x: 0, y: 0, sequence: 2 };
  s.setController(neutral);
  assert.equal(a.calls.filter(c => c[0] === 'controller').length, 1);
  a.listeners.at(-1)({ type: 'error', error: Error('offline') });
  s.setController({ ...neutral, sequence: 3 });
  assert.equal(a.calls.filter(c => c[0] === 'controller').length, 2);
  await s.dispose();
});
test('power resume clears backend pause reported without local pause reason', async () => {
  const a = adapter(); const s = createRuntimeSession(a); await s.start();
  a.listeners.at(-1)({ type: 'state', status: 'paused' });
  assert.equal(s.state.status, 'paused'); assert.deepEqual(s.state.pauseReasons, []);
  await s.setPaused('power', false);
  assert.deepEqual(a.calls.filter(c => c[0] === 'pause').at(-1), ['pause', 'power', false]);
  assert.equal(s.state.status, 'running'); await s.dispose();
});
