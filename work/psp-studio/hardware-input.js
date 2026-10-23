const REPEAT = { repeatDelay: 400, repeatInterval: 90 };
const DEFAULT_POLICIES = {
  up: REPEAT, down: REPEAT, left: REPEAT, right: REPEAT,
  volumeUp: REPEAT, volumeDown: REPEAT,
  display: { longMs: 1000, extraLongMs: 5000 },
  note: { longMs: 1000 },
  power: { longMs: 3000 },
};

/**
 * Owns physical press lifetimes, independent of keyboard, pointer and rendering.
 * Each input source supplies a stable owner (for example, "key:ArrowUp").
 * Call update from the animation loop; cancellation never dispatches an action.
 * Policies merge with the defaults; a zero duration disables that behavior.
 */
export function createHardwareInput({
  onAction = () => {}, onPressed = () => {},
  now = () => performance.now(), policies = {},
} = {}) {
  const owners = new Map();
  const buttons = new Map();
  const isCurrent = state => buttons.get(state.name) === state;

  function updateHold(state, time) {
    const elapsed = time - state.startedAt;
    if (state.policy.longMs > 0 && !state.longFired && elapsed >= state.policy.longMs) {
      state.longFired = true;
      onAction(state.name, 'long');
    }
    if (!isCurrent(state)) return;
    if (state.policy.extraLongMs > 0 && !state.extendedFired && elapsed >= state.policy.extraLongMs) {
      state.extendedFired = true;
      onAction(state.name, 'extended');
    }
  }

  function finish(owner, cancelled, time) {
    const state = owners.get(owner);
    if (!state) return false;
    owners.delete(owner);
    state.owners.delete(owner);
    if (state.owners.size) return true;

    // A slow frame must not turn a completed long hold into a short tap.
    if (!cancelled) updateHold(state, time);
    if (!isCurrent(state)) return true;
    buttons.delete(state.name);
    onPressed(state.name, false);
    if (!cancelled) {
      if (state.delayedTap && !state.longFired && !state.extendedFired) onAction(state.name, 'tap');
      onAction(state.name, 'release');
    }
    return true;
  }

  return {
    press(name, owner, time = now()) {
      // Native keyboard auto-repeat and duplicate pointer events share an owner.
      if (owners.has(owner)) return false;
      let state = buttons.get(name);
      if (state) {
        state.owners.add(owner);
        owners.set(owner, state);
        return true;
      }
      const policy = { ...DEFAULT_POLICIES[name], ...policies[name] };
      state = {
        name, policy, owners: new Set([owner]), startedAt: time,
        nextRepeat: time + (policy.repeatDelay ?? 400),
        delayedTap: policy.longMs > 0 || policy.extraLongMs > 0,
        longFired: false, extendedFired: false,
      };
      buttons.set(name, state);
      owners.set(owner, state);
      onPressed(name, true);
      if (isCurrent(state) && !state.delayedTap) onAction(name, 'press');
      return true;
    },
    release(owner, time = now()) { return finish(owner, false, time); },
    cancel(owner) { return finish(owner, true); },
    cancelAll() {
      const active = [...buttons.values()];
      owners.clear();
      buttons.clear();
      for (const state of active) onPressed(state.name, false);
    },
    update(time = now()) {
      for (const state of [...buttons.values()]) {
        if (!isCurrent(state)) continue;
        updateHold(state, time);
        if (!isCurrent(state)) continue;
        if (state.policy.repeatInterval > 0 && time >= state.nextRepeat) {
          // One repeat per update: never replay a hidden tab's accumulated input.
          state.nextRepeat = time + state.policy.repeatInterval;
          onAction(state.name, 'repeat');
        }
      }
    },
    isPressed(name) { return buttons.has(name); },
    get isActive() { return buttons.size > 0; },
  };
}
