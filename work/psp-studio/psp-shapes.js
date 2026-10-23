import * as THREE from 'three';
import { getModel } from './models.js';

export function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// 1 scene unit = 10 mm. Overall body is approximately 169.4 × 71.4 × 18.6 mm.
export function silhouette(modelId = '3000') {
  const s = new THREE.Shape();
  s.moveTo(-5.30, 3.43);
  s.lineTo(5.30, 3.43);
  s.bezierCurveTo(5.57, 3.43, 5.72, 3.16, 5.94, 3.15);
  s.lineTo(7.08, 3.15);
  s.bezierCurveTo(7.62, 3.12, 8.28, 1.70, 8.33, .15);
  s.bezierCurveTo(8.37, -1.22, 7.92, -2.73, 7.46, -3.04);
  s.quadraticCurveTo(7.34, -3.13, 7.10, -3.13);
  s.lineTo(6.28, -3.13);
  s.bezierCurveTo(6.08, -3.13, 6.03, -3.43, 5.87, -3.43);
  s.lineTo(-5.87, -3.43);
  s.bezierCurveTo(-6.03, -3.43, -6.08, -3.13, -6.28, -3.13);
  s.lineTo(-7.10, -3.13);
  s.quadraticCurveTo(-7.34, -3.13, -7.46, -3.04);
  s.bezierCurveTo(-7.92, -2.73, -8.37, -1.22, -8.33, .15);
  s.bezierCurveTo(-8.28, 1.70, -7.62, 3.12, -7.08, 3.15);
  s.lineTo(-5.94, 3.15);
  s.bezierCurveTo(-5.72, 3.16, -5.57, 3.43, -5.30, 3.43);
  s.closePath();
  const { shellScaleX, shellScaleY } = getModel(modelId);
  if (shellScaleX !== 1 || shellScaleY !== 1) {
    // Transform the curve control points, preserving the smooth outer contour.
    // LCD and control cutouts are added later in their original coordinates.
    const points = new Set([s.currentPoint]);
    for (const curve of s.curves) {
      for (const value of Object.values(curve)) if (value?.isVector2) points.add(value);
    }
    for (const point of points) { point.x *= shellScaleX; point.y *= shellScaleY; }
  }
  return s;
}
