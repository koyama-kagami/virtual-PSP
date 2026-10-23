import * as THREE from 'three';

// Zero slope and curvature at both ends: the raised region eases into the
// continuous rear plane instead of terminating in an extruded pad sidewall.
const bulge = t => 64 * t ** 3 * (1 - t) ** 3;
const bulgeSlope = t => 192 * t ** 2 * (1 - t) ** 2 * (1 - 2 * t);
const INNER_X = 3.80;
const HALF_HEIGHT = 3.0;
const EDGE_INSET = .33;
// The rear group sits .013 cm behind the shell's flat rear face. Bury the
// boundary by another .001 cm so no detached rim can catch the light.
const BASE_Z = -.014;
const HEIGHT = .214;

/**
 * Add the original PSP's smoothly swollen rear grips.
 * Pass the unscaled silhouette(modelId); this function applies the same
 * .99/.98 XY scale as the rear shell. It does not alter the supplied shape.
 */
export function addOriginalRearGrips(rear, material, silhouetteShape) {
  const outline = silhouetteShape.getPoints(192)
    .map(point => new THREE.Vector2(point.x * .99, point.y * .98));
  const root = new THREE.Group();
  root.name = 'original-psp-continuous-rear-grips';
  rear.add(root);

  function outerEdgesAt(y) {
    let left = -Infinity, right = -Infinity;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      const dy = b.y - a.y;
      if (Math.abs(dy) < 1e-10 || y < Math.min(a.y, b.y) || y > Math.max(a.y, b.y)) continue;
      const x = a.x + (y - a.y) / dy * (b.x - a.x);
      left = Math.max(left, -x);
      right = Math.max(right, x);
    }
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.min(left, right) - EDGE_INSET <= INNER_X) {
      throw new RangeError('Rear silhouette does not contain the PSP grip region');
    }
    return [left - EDGE_INSET, right - EDGE_INSET];
  }

  const columns = 96, rows = 144;
  // Both grips sample the same horizontal slices. Keep their individual edges
  // (the outline need not be symmetric), but walk the outline only once.
  const widths = [new Float64Array(rows + 1), new Float64Array(rows + 1)];
  const slopes = [new Float64Array(rows + 1), new Float64Array(rows + 1)];
  const columnBulge = new Float64Array(columns + 1), columnSlope = new Float64Array(columns + 1);
  for (let i = 0; i <= columns; i++) {
    columnBulge[i] = bulge(i / columns);
    columnSlope[i] = bulgeSlope(i / columns);
  }
  for (let j = 0; j <= rows; j++) {
    const y = -HALF_HEIGHT + j / rows * HALF_HEIGHT * 2;
    const edges = outerEdgesAt(y), above = outerEdgesAt(y + .005), below = outerEdgesAt(y - .005);
    for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
      widths[sideIndex][j] = edges[sideIndex] - INNER_X;
      slopes[sideIndex][j] = (above[sideIndex] - below[sideIndex]) / .01;
    }
  }
  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const side = sideIndex === 0 ? -1 : 1;
    const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
    const normals = new Float32Array(positions.length), indices = new Uint16Array(columns * rows * 6);
    for (let j = 0; j <= rows; j++) {
      const v = j / rows, y = -HALF_HEIGHT + v * HALF_HEIGHT * 2;
      const width = widths[sideIndex][j], outerSlope = slopes[sideIndex][j];
      const rowBulge = bulge(v), rowSlope = bulgeSlope(v);
      for (let i = 0; i <= columns; i++) {
        const u = i / columns;
        const z = BASE_Z + HEIGHT * columnBulge[i] * rowBulge;
        const at = (j * (columns + 1) + i) * 3;
        positions[at] = side * (INNER_X + u * width);
        positions[at + 1] = y;
        positions[at + 2] = z;
        // Analytic bump derivatives, including the changing contour width.
        const dx = side * HEIGHT * columnSlope[i] * rowBulge / width;
        const dy = HEIGHT * (columnBulge[i] * rowSlope / (HALF_HEIGHT * 2)
          - columnSlope[i] * u * outerSlope * rowBulge / width);
        const length = Math.hypot(dx, dy, 1);
        normals[at] = -dx / length;
        normals[at + 1] = -dy / length;
        normals[at + 2] = 1 / length;
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
      const a = j * (columns + 1) + i, b = a + 1;
      const c = a + columns + 1, d = c + 1;
      const at = (j * columns + i) * 6;
      indices[at] = a;
      indices[at + 1] = side > 0 ? b : c;
      indices[at + 2] = side > 0 ? c : b;
      indices[at + 3] = b;
      indices[at + 4] = side > 0 ? d : c;
      indices[at + 5] = side > 0 ? c : d;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `original-rear-grip-${side > 0 ? 'right' : 'left'}`;
    root.add(mesh);
  }
  return root;
}
