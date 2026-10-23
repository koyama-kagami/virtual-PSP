import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as THREE from 'three';
import { cachedFaceplate, geometryFingerprint } from './faceplate-cache.mjs';
import { faceplateGeometry } from './faceplate-source.js';
import { roundedShape, silhouette } from './psp-shapes.js';
import { getModel } from './models.js';
import { getHousingLayers } from './psp-midframe.js';

const root = import.meta.dirname;
const encode = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64');
const decode = (data, Type) => new Type(Uint8Array.from(Buffer.from(data, 'base64')).buffer);

test('all three front shells close the side seam while keeping control apertures clear', async () => {
  const fingerprint = await geometryFingerprint({ root });
  for (const modelId of ['1000', '2000', '3000']) {
    const { data } = await cachedFaceplate({
      modelId, fingerprint, directory: path.join(root, '.cache', 'faceplates'),
      bake: () => {
        const geometry = faceplateGeometry(silhouette(modelId), roundedShape, modelId);
        const result = { positions: encode(geometry.attributes.position.array), normals: encode(geometry.attributes.normal.array),
          indices: encode(geometry.index.array), indexBits: geometry.index.array.BYTES_PER_ELEMENT * 8 };
        geometry.dispose(); return result;
      },
    });
    const face = new THREE.BufferGeometry();
    face.setAttribute('position', new THREE.BufferAttribute(decode(data.positions, Float32Array), 3));
    face.setIndex(new THREE.BufferAttribute(decode(data.indices, data.indexBits === 16 ? Uint16Array : Uint32Array), 1));
    const support = getHousingLayers(getModel(modelId)).core;
    const core = new THREE.ExtrudeGeometry(support.shape, {
      depth: support.depth, bevelEnabled: true, bevelThickness: support.bevel, bevelSize: support.bevel,
      bevelSegments: 10, steps: 1, curveSegments: 48,
    });
    core.scale(support.scaleX, support.scaleY, 1); core.translate(0, 0, support.z);
    const material = new THREE.MeshBasicMaterial();
    const meshes = [new THREE.Mesh(face, material), new THREE.Mesh(core, material)];
    const ray = new THREE.Raycaster();
    try {
      for (const side of [-1, 1]) for (const y of [-2.8, -2.1, -1.4, -.7, 0, .7, 1.4, 2.1, 2.8]) {
        for (const z of [.40, .47, .505, .54, .58]) {
          ray.set(new THREE.Vector3(side * 20, y, z), new THREE.Vector3(-side, 0, 0));
          assert.ok(ray.intersectObjects(meshes, false).length,
            `PSP-${modelId} leaks through side ${side}, y=${y}, z=${z}`);
        }
      }
      // The seam repair must not fill the screen, face keys or analog opening.
      for (const [x, y] of [[0, .23], [6.67, 1.40], [7.62, .45], [6.67, -.5], [5.72, .45], [-6.52, -1.83]]) {
        ray.set(new THREE.Vector3(x, y, 2), new THREE.Vector3(0, 0, -1));
        assert.equal(ray.intersectObject(meshes[0], false).length, 0, `PSP-${modelId} filled aperture at ${x},${y}`);
      }
    } finally { face.dispose(); core.dispose(); material.dispose(); }
  }
});
