import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

test('retiring a model releases shared scene assets once and leaves unrelated assets alone', async () => {
  const module = await import('./scene-resources.js').catch(() => ({}));
  assert.equal(typeof module.disposeSceneResources, 'function');
  const scene = new THREE.Scene();
  const map = new THREE.Texture(), geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshPhysicalMaterial({map, normalMap:map, clearcoatNormalMap:map});
  const detached = new THREE.Texture();
  const counts = {map:0, geometry:0, material:0, detached:0, environment:0};
  for (const [key, resource] of Object.entries({map, geometry, material, detached})) {
    resource.addEventListener('dispose', () => counts[key]++);
  }
  scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const environment = new THREE.WebGLRenderTarget();
  environment.addEventListener('dispose', () => counts.environment++);
  scene.environment = environment.texture;
  module.disposeSceneResources(scene, [environment]);
  assert.deepEqual(counts, {map:1, geometry:1, material:1, detached:0, environment:1});
  assert.equal(scene.children.length, 0);
});

test('retiring a model preserves borrowed session textures even among extras', async () => {
  const { disposeSceneResources } = await import('./scene-resources.js');
  const scene = new THREE.Scene(); const shared = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: shared });
  const geometry = new THREE.PlaneGeometry(); let released = 0;
  shared.addEventListener('dispose', () => released++);
  scene.add(new THREE.Mesh(geometry, material));
  disposeSceneResources(scene, [shared], new Set([shared]));
  assert.equal(released, 0); assert.equal(scene.children.length, 0);
});
