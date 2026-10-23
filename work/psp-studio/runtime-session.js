/**
 * Durable application-owned session. Adapter events: {type:'state', status},
 * {type:'error', error}, {type:'capabilities', capabilities}. Events may include
 * epoch (or sessionEpoch); adapters MUST bind emissions to the subscription's
 * transport generation, and honor AbortSignal before creating native resources.
 */
export function createRuntimeSession(adapter) {
  let state = Object.freeze({ status: 'off', epoch: 0, sessionId: 0, pauseReasons: Object.freeze([]), capabilities: null, error: null });
  const listeners = new Set(); const reasons = new Set();
  let epoch = 0; let controller; let unsubscribe; let startup; let stopping;
  let disposed = false; let disposal; let commands = Promise.resolve();
  const publish = patch => {
    state = Object.freeze({ ...state, ...patch, epoch, sessionId: epoch, pauseReasons: Object.freeze([...reasons]) });
    for (const listener of [...listeners]) listener(state);
  };
  const active = () => ['running', 'paused'].includes(state.status);
  const fail = (error, generation) => { if (generation === epoch && !disposed && state.status !== 'off') publish({ status: 'error', error }); };
  const detach = () => { unsubscribe?.(); unsubscribe = undefined; };
  const api = {
    get state() { return state; },
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    start(config = {}) {
      if (disposed) return Promise.reject(new Error('Runtime session disposed'));
      if (startup) return startup;
      if (active()) return Promise.resolve(state);
      const generation = ++epoch; controller = new AbortController(); const signal = controller.signal;
      detach(); publish({ status: 'starting', error: null, capabilities: null });
      const current = () => generation === epoch && !signal.aborted && !disposed && !['error', 'off'].includes(state.status);
      unsubscribe = adapter.subscribe(event => {
        if (!current() || (event.epoch ?? event.sessionEpoch ?? generation) !== generation) return;
        if (event.type === 'error') fail(event.error ?? new Error('Runtime error'), generation);
        if (event.type === 'capabilities') publish({ capabilities: event.capabilities });
        if (event.type === 'state' && ['running', 'paused', 'error', 'off'].includes(event.status)) {
          publish({ status: event.status === 'running' && reasons.size ? 'paused' : event.status, error: event.error ?? null });
        }
      });
      const pendingStop = stopping;
      const operation = (async () => {
        try {
          await pendingStop;
          if (!current()) return state;
          const capabilities = await adapter.initialize(config, signal);
          if (!current()) return state;
          publish({ capabilities, status: 'booting' });
          await adapter.boot(config.profile, signal);
          if (!current()) return state;
          for (const reason of reasons) {
            await adapter.setPaused(reason, true); if (!current()) return state;
            if (!reasons.has(reason)) { await adapter.setPaused(reason, false); if (!current()) return state; }
          }
          publish({ status: reasons.size ? 'paused' : 'running' });
          return state;
        } catch (error) { if (current()) { fail(error, generation); throw error; } return state; }
      })();
      startup = operation;
      operation.finally(() => { if (startup === operation) startup = undefined; }).catch(() => {});
      return operation;
    },
    async setPaused(reason, paused) {
      if (disposed) throw new Error('Runtime session disposed');
      // An explicit power gesture may resume a backend pause not owned locally.
      // Releasing visibility or another absent reason must not do so.
      const resumeBackend = reason === 'power' && !paused && state.status === 'paused' && reasons.size === 0;
      if (reasons.has(reason) === Boolean(paused) && !resumeBackend) return;
      paused ? reasons.add(reason) : reasons.delete(reason);
      const generation = epoch;
      publish(active() ? { status: reasons.size ? 'paused' : 'running' } : {});
      if (active()) {
        try { await adapter.setPaused(reason, Boolean(paused)); }
        catch (error) { fail(error, generation); throw error; }
      }
    },
    stop() {
      if (stopping) return stopping;
      if (state.status === 'off') return Promise.resolve();
      ++epoch; controller?.abort(); startup = undefined; detach();
      publish({ status: 'off', capabilities: null });
      const operation = (async () => {
        try { adapter.setController({ buttons: [], x: 0, y: 0, sequence: 0 }); }
        finally { await adapter.close(); }
      })();
      stopping = operation;
      operation.finally(() => { if (stopping === operation) stopping = undefined; }).catch(() => {});
      return operation;
    },
    setController(snapshot) {
      const neutral = snapshot.buttons?.length === 0 && snapshot.x === 0 && snapshot.y === 0;
      // Releases remain deliverable after pause/fault; non-neutral input stays gated.
      if (!disposed && (state.status === 'running' || (neutral && state.status !== 'off'))) {
        adapter.setController({ ...snapshot, epoch, sessionEpoch: epoch });
      }
    },
    command(command) {
      if (disposed) return Promise.reject(new Error('Runtime session disposed'));
      const generation = epoch;
      const next = commands.catch(() => {}).then(() => {
        if (disposed || generation !== epoch || !active()) throw new Error('Runtime session unavailable');
        return adapter.command(command);
      });
      commands = next; return next;
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true; disposal = api.stop().finally(() => { detach(); listeners.clear(); }); return disposal;
    },
  };
  return api;
}
