import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createShellFinish } from './psp-shell-finish.js';
import { addOriginalRearGrips } from './psp-legacy-grips.js';
import { silhouette } from './psp-shapes.js';
import { getFinish, getFinishes } from './finishes.js';
import { getModel } from './models.js';
import { disposeSceneResources } from './scene-resources.js';

const renderer = { capabilities: { getMaxAnisotropy: () => 8 } };
const checksum = arrays => {
  const hash = createHash('sha256');
  for (const array of arrays) hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  return hash.digest('hex');
};
const disposeFinish = finish => {
  finish.dispose();
  for (const material of [finish.shell, finish.rear, finish.core]) material.dispose();
};

test('paint families retain deterministic pixels with independent GPU lifetimes', () => {
  const first = createShellFinish(renderer, getFinish('black'));
  const second = createShellFinish(renderer, getFinish('black'));
  try {
    const signature = checksum([first.shell.normalMap.image.data, first.shell.roughnessMap.image.data]);
    assert.notEqual(first.shell.normalMap, second.shell.normalMap);
    assert.notEqual(first.shell.roughnessMap, second.shell.roughnessMap);
    let secondDisposals = 0;
    second.shell.normalMap.addEventListener('dispose', () => secondDisposals++);
    second.shell.roughnessMap.addEventListener('dispose', () => secondDisposals++);
    first.dispose();
    assert.equal(secondDisposals, 0);
    assert.equal(checksum([second.shell.normalMap.image.data, second.shell.roughnessMap.image.data]),
      signature);
    assert.equal(second.shell.normalMap.anisotropy, 8);
    assert.equal(second.shell.normalMap.generateMipmaps, true);
  } finally {
    for (const material of [first.shell, first.rear, first.core]) material.dispose();
    disposeFinish(second);
  }
});

test('paint switch changes the substrate while the clear coat remains a separate smooth layer', () => {
  const finish = createShellFinish(renderer, getFinish('black'));
  try {
    const lacquer = finish.shell.normalMap;
    const coat = finish.shell.clearcoatNormalMap;
    assert.notEqual(coat, lacquer);
    assert.equal(lacquer.type, THREE.HalfFloatType);
    assert.equal(lacquer.colorSpace, THREE.NoColorSpace);
    assert.equal(finish.shell.clearcoatRoughnessMap, null);
    finish.update(getFinish('red'));
    assert.notEqual(finish.shell.normalMap, lacquer);
    assert.ok(finish.shell.metalness > .4);
    assert.notEqual(finish.shell.normalMap, finish.shell.clearcoatNormalMap);
    finish.update(getFinish('black'));
    assert.equal(finish.shell.normalMap, lacquer, 'returning to a paint reuses its GPU texture');
    assert.equal(finish.shell.clearcoatNormalMap, coat);
    assert.equal(finish.shell.metalness, 0);
  } finally { disposeFinish(finish); }
});

test('two-tone metallic black and the UMD door use the rear paint independently', () => {
  const finish = createShellFinish(renderer, getFinish('black'));
  const door = finish.rear.clone();
  try {
    finish.update(getFinish('red-black'), door);
    assert.ok(finish.rear.metalness > .3, 'metallic black must not inherit plain piano black');
    assert.equal(door.normalMap, finish.rear.normalMap);
    assert.equal(door.metalness, finish.rear.metalness);
    assert.equal(door.color.getHexString(), finish.rear.color.getHexString());
    finish.update(getFinish('white-blue'), door);
    assert.notEqual(finish.shell.normalMap, finish.rear.normalMap);
    assert.equal(door.normalMap, finish.rear.normalMap);
  } finally { door.dispose(); disposeFinish(finish); }
});

test('all model colours are finite and old paint textures are released after switching', () => {
  for (const modelId of ['1000', '2000', '3000']) {
    const finish = createShellFinish(renderer, getFinish('black', modelId), getModel(modelId));
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), finish.shell);
    scene.add(mesh);
    for (let round = 0; round < 2; round++) for (const palette of getFinishes(modelId)) {
      finish.update(palette);
      for (const material of [finish.shell, finish.rear]) {
        for (const property of ['roughness','metalness','clearcoat','clearcoatRoughness']) assert.ok(Number.isFinite(material[property]));
        assert.equal(material.normalMap.image.width, 256);
      }
    }
    assert.ok(finish.resources.length <= 12, 'four families, three textures each, independent of switch count');
    const disposals = new Map(finish.resources.map(map => [map, 0]));
    for (const map of finish.resources) map.addEventListener('dispose', () => disposals.set(map, disposals.get(map) + 1));
    disposeSceneResources(scene, finish.resources);
    for (const count of disposals.values()) assert.equal(count, 1, 'inactive textures must also be released exactly once');
    finish.rear.dispose(); finish.core.dispose();
  }
});

// Geometry hashes remain unchanged: finish tuning must not simplify the shells.

test('projection preserves curved geometry, normals and all six UV directions byte for byte', () => {
  const finish = createShellFinish(renderer, getFinish('black'));
  const geometry = new THREE.SphereGeometry(8, 256, 128);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, finish.shell));
  try {
    finish.mapGeometry(root);
    assert.equal(checksum([geometry.attributes.position.array, geometry.attributes.normal.array,
      geometry.attributes.uv.array, geometry.index.array]),
    '296a210d4d936945606cbe19ac8648ff94e0430556b8c9fad71ce7d7f82dd0d1');
    const mappedPosition = geometry.attributes.position;
    root.add(new THREE.Mesh(geometry, finish.rear));
    finish.mapGeometry(root);
    assert.equal(geometry.attributes.position, mappedPosition, 'shared/already mapped geometry should not be rebuilt');
  } finally {
    geometry.dispose();
    disposeFinish(finish);
  }
});

test('non-indexed shell meshes remain supported and unrelated geometry is untouched', () => {
  const finish = createShellFinish(renderer, getFinish('black'));
  const geometry = new THREE.BoxGeometry().toNonIndexed();
  const source = geometry.attributes.position.array.slice();
  const ignored = new THREE.BoxGeometry(), ignoredPosition = ignored.attributes.position;
  const otherMaterial = new THREE.MeshStandardMaterial();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, finish.shell), new THREE.Mesh(ignored, otherMaterial));
  try {
    finish.mapGeometry(root);
    assert.deepEqual(geometry.attributes.position.array, source);
    assert.equal(geometry.index.count, source.length / 3);
    assert.equal(geometry.attributes.uv.count, source.length / 3);
    assert.equal(ignored.attributes.position, ignoredPosition);
  } finally {
    geometry.dispose(); ignored.dispose(); otherMaterial.dispose(); disposeFinish(finish);
  }
});

test('PSP-1000 grip optimization preserves silhouette, tessellation and smooth normals', () => {
  const material = new THREE.MeshStandardMaterial();
  const grips = addOriginalRearGrips(new THREE.Group(), material, silhouette('1000'));
  try {
    assert.equal(checksum(grips.children.flatMap(mesh => [mesh.geometry.attributes.position.array,
      mesh.geometry.attributes.normal.array, mesh.geometry.index.array])),
    '31a5d542e3db3634c454205356ae155d87b7343e051a983e743f19946666d7ab');
  } finally {
    for (const mesh of grips.children) mesh.geometry.dispose();
    material.dispose();
  }
});
