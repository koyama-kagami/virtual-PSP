import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createShellFinish } from '../psp-shell-finish.js';
import { addOriginalRearGrips } from '../psp-legacy-grips.js';
import { silhouette } from '../psp-shapes.js';
import { getFinish } from '../finishes.js';
import { disposeSceneResources } from '../scene-resources.js';

// CPU-only benchmark: GPU time and browser frame rate must be measured separately.
const renderer = { capabilities: { getMaxAnisotropy: () => 8 } };
const checksum = arrays => {
  const hash = createHash('sha256');
  for (const array of arrays) hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  return hash.digest('hex');
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const times = { finish: [], projection: [], grips: [] };
let textureHash, projectionHash, gripHash;
for (let iteration = 0; iteration < 6; iteration++) {
  const scene = new THREE.Scene();
  let started = performance.now();
  const finish = createShellFinish(renderer, getFinish('black'));
  times.finish.push(performance.now() - started);
  textureHash = checksum([finish.shell.normalMap.image.data, finish.shell.roughnessMap.image.data]);
  // Comparable triangle count to one pre-baked PSP faceplate, with projection seams.
  const sphere = new THREE.SphereGeometry(8, 256, 128);
  scene.add(new THREE.Mesh(sphere, finish.shell));
  started = performance.now();
  finish.mapGeometry(scene);
  times.projection.push(performance.now() - started);
  projectionHash = checksum([sphere.attributes.position.array, sphere.attributes.normal.array,
    sphere.attributes.uv.array, sphere.index.array]);
  const back = new THREE.Group();
  scene.add(back);
  started = performance.now();
  const grips = addOriginalRearGrips(back, finish.rear, silhouette('1000'));
  times.grips.push(performance.now() - started);
  gripHash = checksum(grips.children.flatMap(mesh => [mesh.geometry.attributes.position.array,
    mesh.geometry.attributes.normal.array, mesh.geometry.index.array]));
  disposeSceneResources(scene);
  finish.core.dispose();
}
console.log(JSON.stringify({
  note: 'Node CPU timings in milliseconds; six iterations; warm median excludes the first.',
  cold: Object.fromEntries(Object.entries(times).map(([key, values]) => [key, values[0]])),
  warmMedian: Object.fromEntries(Object.entries(times).map(([key, values]) => [key, median(values.slice(1))])),
  samples: times,
  checksums: { textureHash, projectionHash, gripHash },
}, null, 2));
