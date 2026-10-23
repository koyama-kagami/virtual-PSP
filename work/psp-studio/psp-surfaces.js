import * as THREE from 'three';
import { getModel } from './models.js';

// Photo-calibrated coordinates in centimetres. These describe a PSP-3000,
// not a CAD scan; the clean front photograph supplies the control landmarks.
export const frontLayout = {
  dpad: [-6.56, .45], analog: [-6.52, -1.83],
  face: [[6.67, 1.40], [7.62, .45], [6.67, -.50], [5.72, .45]],
};

export function dpadKey() {
  const s = new THREE.Shape();
  s.moveTo(0, -.42);
  s.bezierCurveTo(-.07, -.39, -.26, -.23, -.35, -.14);
  s.lineTo(-.36, .25);
  s.bezierCurveTo(-.36, .44, -.21, .46, 0, .46);
  s.bezierCurveTo(.21, .46, .36, .44, .36, .25);
  s.lineTo(.35, -.14);
  s.bezierCurveTo(.26, -.23, .07, -.39, 0, -.42);
  s.closePath();
  return s;
}

const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  // C2 continuity keeps the slope and its derivative smooth at each join.
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export function frontHeight(x, y, modelId = '3000') {
  // Continuous moulded face: a gentle grip crown and roll toward the side wall.
  const { shellScaleX, shellScaleY } = getModel(modelId);
  const side = smooth(7.55 * shellScaleX, 8.42 * shellScaleX, Math.abs(x));
  const crown = .018 * Math.exp(-(((Math.abs(x) - 6.60) / 1.0) ** 2));
  let height = .86 + crown - .20 * side - .055 * smooth(3.29 * shellScaleY, 3.57 * shellScaleY, Math.abs(y));
  const left = Math.hypot(x + 6.56, y - .45);
  height -= .035 * (1 - smooth(1.10, 1.49, left));
  const dx = x - 6.67, dy = y - .45;
  const a = Math.atan2(dy, dx);
  const scallop = 1.32 + .14 * Math.cos(a * 4);
  height -= .04 * (1 - smooth(scallop - .24, scallop + .20, Math.hypot(dx, dy)));
  return height;
}

// Closed, gently domed keycaps. Their highlight wraps around the cap instead
// of forming the hard concentric rings produced by extruded cylinders.
export function roundKeyGeometry(radius = .405) {
  const points = [new THREE.Vector2(0, 0), new THREE.Vector2(radius * .93, 0),
    new THREE.Vector2(radius, .025), new THREE.Vector2(radius, .105),
    new THREE.Vector2(radius * .99, .13), new THREE.Vector2(radius * .94, .155),
    new THREE.Vector2(radius * .82, .17), new THREE.Vector2(radius * .55, .18),
    new THREE.Vector2(0, .185)];
  const geometry = new THREE.LatheGeometry(points, 96);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
