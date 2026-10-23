export class AnalogStick {
  constructor(radius = .24) {
    this.radius = radius;
    this.x = 0;
    this.y = 0;
    this.pointerId = null;
  }
  begin(pointerId, x, y) {
    if (this.pointerId !== null) return false;
    this.pointerId = pointerId;
    this.anchorX = x - this.x;
    this.anchorY = y - this.y;
    return true;
  }
  move(pointerId, x, y) {
    if (this.pointerId === null || pointerId !== this.pointerId) return false;
    const dx = x - this.anchorX, dy = y - this.anchorY;
    const scale = Math.min(1, this.radius / (Math.hypot(dx, dy) || 1));
    this.x = dx * scale;
    this.y = dy * scale;
    return true;
  }
  release(pointerId) {
    if (this.pointerId === null || pointerId !== this.pointerId) return false;
    this.pointerId = null;
    return true;
  }
  reset() { this.pointerId = null; }
  update(dt, immediate = false) {
    if (this.pointerId !== null) return;
    const decay = immediate ? 0 : Math.exp(-Math.max(0, dt) * 30);
    this.x *= decay; this.y *= decay;
    if (Math.hypot(this.x, this.y) < .0001) this.x = this.y = 0;
  }
}
