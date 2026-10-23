import * as THREE from 'three';
import { faceplates } from 'psp:faceplate-data';
import { decodeTypedArray } from './faceplate-codec.js';

// build.mjs embeds the already triangulated mesh in this standalone page.
// Decoding typed arrays avoids a long main-thread tessellation at startup.
export function createFaceplateGeometry(modelId = '3000') {
  const { positions, normals, indices, indexBits } = faceplates[modelId] || faceplates['3000'];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(decodeTypedArray(positions, Float32Array), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(decodeTypedArray(normals, Float32Array), 3));
  geometry.setIndex(new THREE.BufferAttribute(decodeTypedArray(indices, indexBits === 16 ? Uint16Array : Uint32Array), 1));
  geometry.computeBoundingSphere();
  return geometry;
}
