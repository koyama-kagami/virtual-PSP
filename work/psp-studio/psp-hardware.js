import * as THREE from 'three';
import { getModel } from './models.js';

// Photo proportions in centimetres; these are not factory CAD measurements.
export const utilityKeys = [
  { name: 'ps', x: -4.85, width: .98, height: .48, kind: 'ps', caption: '' },
  { name: 'volumeDown', x: -3.63, width: .47, height: .40, caption: '−' },
  { name: 'volumeUp', x: -2.43, width: .47, height: .40, caption: '+' },
  { name: 'display', x: 1.74, width: .50, height: .41, kind: 'display', caption: '' },
  { name: 'note', x: 2.55, width: .50, height: .41, caption: '♪' },
  { name: 'select', x: 3.61, width: .98, height: .43, caption: 'SELECT' },
  { name: 'start', x: 4.70, width: .98, height: .43, caption: 'START' },
];
export const utilityY = -3.09;

const legacyUtilityKeys = utilityKeys.map(key => ({
  ...key,
  ...(['ps', 'select', 'start'].includes(key.name)
    ? { height: .40 } : { width: .40, height: .40 }),
  ...(key.name === 'ps' ? { kind: 'text', caption: 'HOME', width: 1.02 } : {}),
}));

export function getUtilityKeys(modelId = '3000') {
  return getModel(modelId).legacyKeys ? legacyUtilityKeys : utilityKeys;
}

export function capsuleOutline(width, height) {
  const r = height / 2, x = width / 2 - r;
  const shape = new THREE.Shape();
  shape.moveTo(-x, -r); shape.lineTo(x, -r);
  shape.absarc(x, 0, r, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-x, r);
  shape.absarc(-x, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  shape.closePath(); return shape;
}

export function utilityOutline(width, height, modelId = '3000') {
  if (!getModel(modelId).legacyKeys) return capsuleOutline(width, height);
  const shape = new THREE.Shape();
  if (width / height < 1.6) {
    // Volume, display and sound keys are circular on the original and Slim.
    shape.absellipse(0, 0, width / 2, height / 2, 0, Math.PI * 2, false);
  } else {
    // HOME, SELECT and START have a flat top and a curved, tapered lower edge.
    // Official manuals: PSP-1000 p20 and PSP-2000 p8.
    shape.moveTo(-width * .42, height / 2);
    shape.lineTo(width * .42, height / 2);
    shape.quadraticCurveTo(width / 2, height / 2, width / 2, height * .30);
    shape.bezierCurveTo(width * .48, -height * .12, width * .25, -height / 2, 0, -height / 2);
    shape.bezierCurveTo(-width * .25, -height / 2, -width * .48, -height * .12, -width / 2, height * .30);
    shape.quadraticCurveTo(-width / 2, height / 2, -width * .42, height / 2);
  }
  shape.closePath();
  return shape;
}

export function utilityCapGeometry(width, height, modelId = '3000') {
  return new THREE.ExtrudeGeometry(utilityOutline(width - .04, height - .04, modelId), {
    depth: .052, bevelEnabled: true, bevelThickness: .016,
    bevelSize: .02, bevelSegments: 5, curveSegments: 32, steps: 1,
  });
}

// The trigger is a thin curved cap across the middle rail. Its outer end
// wraps around the case; the front/rear housings obscure most of it head-on.
export function shoulderPoint(u, v, inset = 0) {
  const t = THREE.MathUtils.smoothstep(u, .58, 1);
  const end = Math.exp(-u * 60) + Math.exp((u - 1) * 60);
  return new THREE.Vector3(-1.4 + 2.8 * u,
    .38 - 1.63 * t ** 1.25 - .065 * v * v - .025 * end - inset,
    -.015 + v * (.36 - .025 * end));
}

export function shoulderShellGeometry(inset = 0, thickness = .045) {
  const columns = 80, rows = 14, positions = [], indices = [];
  // Each face has its own vertices, retaining the narrow moulded rim edge.
  function surface(point, reverse = false) {
    const start = positions.length / 3;
    for (let i = 0; i <= columns; i++) for (let j = 0; j <= rows; j++) {
      const p = point(i / columns, j / rows); positions.push(p.x, p.y, p.z);
    }
    for (let i = 0; i < columns; i++) for (let j = 0; j < rows; j++) {
      const a = start + i * (rows + 1) + j, b = a + rows + 1;
      if (reverse) indices.push(a, b, a + 1, a + 1, b, b + 1);
      else indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  surface((u, v) => shoulderPoint(u, v * 2 - 1, inset));
  surface((u, v) => shoulderPoint(u, v * 2 - 1, inset + thickness), true);
  surface((u, v) => shoulderPoint(u, -1, inset + v * thickness), true);
  surface((u, v) => shoulderPoint(u, 1, inset + v * thickness));
  surface((u, v) => shoulderPoint(0, u * 2 - 1, inset + v * thickness));
  surface((u, v) => shoulderPoint(1, u * 2 - 1, inset + v * thickness), true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
