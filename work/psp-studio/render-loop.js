/** One cancellable render loop. The frame returns its next desired interval in ms. */
export function createRenderLoop(draw, clock = globalThis) {
  let frameId = null, timerId = null, suspended = false, disposed = false;
  const now = () => clock.now ? clock.now() : performance.now();
  function cancel() {
    if (frameId !== null) clock.cancelAnimationFrame(frameId);
    if (timerId !== null) clock.clearTimeout(timerId);
    frameId = timerId = null;
  }
  function invalidate() {
    if (disposed || suspended) return;
    if (timerId !== null) { clock.clearTimeout(timerId); timerId = null; }
    if (frameId === null) frameId = clock.requestAnimationFrame(tick);
  }
  function tick(time) {
    frameId = null;
    if (disposed || suspended) return;
    const interval = draw(time);
    if (disposed || suspended || frameId !== null || !Number.isFinite(interval)) return;
    // Leave a small vblank margin, subtracting work already spent on this frame.
    const remaining = Math.max(0, interval - (now() - time) - 4);
    if (remaining === 0) invalidate();
    else timerId = clock.setTimeout(() => { timerId = null; invalidate(); }, remaining);
  }
  return {
    invalidate,
    suspend() { suspended = true; cancel(); },
    resume() { if (!disposed) { suspended = false; invalidate(); } },
    dispose() { disposed = true; cancel(); },
  };
}
