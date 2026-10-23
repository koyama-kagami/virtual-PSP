/** Aggregate electrical inputs independently of scene animation. Latest active axis wins. */
export function createRuntimeInput({ send }) {
  const buttons = new Map(); const axes = new Map(); let sequence = 0;
  const emit = () => {
    const names = [...new Set([...buttons.values()].flatMap(set => [...set]))].sort();
    const [x, y] = [...axes.values()].at(-1) ?? [0, 0];
    send({ buttons: names, x, y, sequence: ++sequence });
  };
  const clamp = value => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  return {
    press(name, owner) {
      const held = buttons.get(owner) ?? new Set();
      if (held.has(name)) return;
      held.add(name); buttons.set(owner, held); emit();
    },
    release(owner) { if (buttons.delete(owner)) emit(); },
    setAxis(owner, x, y) { axes.delete(owner); axes.set(owner, [clamp(x), clamp(y)]); emit(); },
    releaseAxis(owner) { if (axes.delete(owner)) emit(); },
    clear() { buttons.clear(); axes.clear(); emit(); },
  };
}
