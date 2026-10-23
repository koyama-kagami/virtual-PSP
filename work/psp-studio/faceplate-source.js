// Build-time only: fine constrained triangulation is never run in the browser.
import * as THREE from 'three';
import triangulate from 'cdt2d';
import { getUtilityKeys, utilityY, utilityOutline } from './psp-hardware.js';
import { frontLayout, frontHeight, dpadKey } from './psp-surfaces.js';
import { getModel } from './models.js';

function holeFrom(shape, x, y, rotation = 0, scale = 1) {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const pts = shape.getPoints(24).map(p => new THREE.Vector2(
    x + (p.x * c - p.y * s) * scale,
    y + (p.x * s + p.y * c) * scale,
  ));
  return new THREE.Path(pts);
}

export function faceplateGeometry(outline, roundedShape, modelId = '3000') {
  const heightAt = (x, y) => frontHeight(x, y, modelId);
  outline = new THREE.Shape(outline.getPoints(64).map(p => new THREE.Vector2(p.x * 1.012, p.y * 1.029)));
  // Real openings, so the controls and LCD sit inside the shell instead of
  // being stacked on an unbroken slab. The recesses are part of this surface.
  outline.holes.push(holeFrom(roundedShape(9.68, 5.55, .045), 0, .23));
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    outline.holes.push(holeFrom(dpadKey(), -6.56 + Math.sin(a) * .69,
      .45 + Math.cos(a) * .69, -a, 1.10));
  }
  for (const [x, y] of frontLayout.face) {
    const h = new THREE.Path(); h.absarc(x, y, .447, 0, Math.PI * 2);
    outline.holes.push(h);
  }
  const nub = new THREE.Path(); nub.absarc(-6.52, -1.83, .625, 0, Math.PI * 2);
  outline.holes.push(nub);
  for (const key of getUtilityKeys(modelId)) {
    outline.holes.push(holeFrom(utilityOutline(key.width + .055, key.height + .045, modelId), key.x, utilityY));
  }
  const rings = [outline, ...outline.holes].map(path => {
    const pts = path.getPoints(48).filter((p, i, all) => !i || p.distanceToSquared(all[i - 1]) > 1e-12);
    if (pts[0].distanceToSquared(pts.at(-1)) < 1e-12) pts.pop();
    // Shape.getPoints samples curves but leaves straight edges unsplit. A long
    // chord would bridge the moulded height field and bend the bottom highlight.
    return pts.flatMap((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const segments = Math.max(1, Math.ceil(a.distanceTo(b) / .04));
      return Array.from({ length: segments }, (_, j) => a.clone().lerp(b, j / segments));
    });
  });
  const points = [], edges = [];
  for (const ring of rings) {
    const first = points.length;
    ring.forEach(p => points.push([p.x, p.y]));
    ring.forEach((_, i) => edges.push([first + i, first + (i + 1) % ring.length]));
  }
  function contains(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  // Uniform interior samples keep curvature smooth. Repeatedly subdividing
  // Earcut's long triangles creates T-junctions and visible lacquer cracks.
  const spacing = .04;
  // Keep the original slim-faceplate sampling exactly unchanged. The taller
  // original PSP needs samples all the way to its expanded outer boundary.
  const model = getModel(modelId), bounds = new THREE.Box2().setFromPoints(rings[0]);
  const expanded = model.shellScaleX !== 1 || model.shellScaleY !== 1;
  const minIx = expanded ? Math.floor((bounds.min.x + 8.4) / spacing) : 0;
  const maxIx = expanded ? Math.ceil((bounds.max.x + 8.4) / spacing) : 420;
  const minIy = expanded ? Math.floor((bounds.min.y + 3.49) / spacing) : 0;
  const maxIy = expanded ? Math.ceil((bounds.max.y + 3.49) / spacing) : 175;
  for (let iy = minIy; iy <= maxIy; iy++) for (let ix = minIx; ix <= maxIx; ix++) {
    const x = -8.4 + ix * spacing + (iy % 2) * spacing / 2, y = -3.49 + iy * spacing;
    if (!contains(rings[0], x, y) || rings.slice(1).some(r => contains(r, x, y))) continue;
    const nearEdge = edges.some(([i, j]) => {
      const a = points[i], b = points[j], dx = b[0] - a[0], dy = b[1] - a[1];
      const t = THREE.MathUtils.clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
      return (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2 < .006 ** 2;
    });
    if (!nearEdge) points.push([x, y]);
  }
  const indices = triangulate(points, edges, { exterior: false }).flat();
  const positions = points.flatMap(([x, y]) => [x, y, heightAt(x, y)]);
  for (const [ringIndex, ring] of rings.entries()) {
    const base = positions.length / 3, count = ring.length;
    for (const p of ring) positions.push(p.x, p.y, heightAt(p.x, p.y));
    // A small inward return seats the outer lip over the support. The support
    // need not bulge through the midframe just to close the front-shell seam.
    for (const p of ring) positions.push(p.x * (ringIndex === 0 ? .996 : 1),
      p.y * (ringIndex === 0 ? .992 : 1), ringIndex === 0 ? .35 : .51);
    const clockwise = THREE.ShapeUtils.isClockWise(ring);
    for (let i = 0; i < count; i++) {
      const a = base + i, b = base + (i + 1) % count, c = a + count, d = b + count;
      // Outer walls face away from the body; opening walls face into the hole.
      if (clockwise !== (ringIndex > 0)) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const n = geo.getAttribute('normal');
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i], e = .001;
    const dx = (heightAt(x + e, y) - heightAt(x - e, y)) / (2 * e);
    const dy = (heightAt(x, y + e) - heightAt(x, y - e)) / (2 * e);
    const v = new THREE.Vector3(-dx, -dy, 1).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}
