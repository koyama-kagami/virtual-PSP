import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

async function picker(root, raycaster) {
  const module = await import('./control-picking.js').catch(() => ({}));
  assert.equal(typeof module.createControlPicker, 'function');
  root.updateMatrixWorld(true);
  return module.createControlPicker(root, raycaster);
}

function plane(root, z, control, options = {}) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, ...options }));
  mesh.position.z = z;
  if (control) mesh.userData.control = control;
  root.add(mesh);
  return mesh;
}

function ray() {
  return new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1), 0, 20);
}

test('picks the nearest exposed control and restores the caller ray range', async () => {
  const root = new THREE.Group(), raycaster = ray();
  plane(root, 0, null);
  plane(root, 1, 'front-button');
  plane(root, -1, 'rear-button');
  const pick = await picker(root, raycaster);
  assert.equal(pick(), 'front-button');
  assert.equal(raycaster.far, 20);
});

test('opaque housing prevents pressing a control on its far side', async () => {
  const root = new THREE.Group(), raycaster = ray();
  plane(root, 0, null);
  plane(root, -1, 'rear-button');
  const pick = await picker(root, raycaster);
  assert.equal(pick(), null);
  assert.equal(raycaster.far, 20);
});

test('transparent legends and hidden click surfaces retain their picking behavior', async () => {
  const root = new THREE.Group(), raycaster = ray();
  plane(root, 2, null, { transparent: true });
  plane(root, 1, 'power', { visible: false });
  const pick = await picker(root, raycaster);
  assert.equal(pick(), 'power');
});

test('empty-space hover never tests detailed non-interactive housing', async () => {
  const root = new THREE.Group(), raycaster = ray();
  const housing = plane(root, 0, null);
  const control = plane(root, 1, 'button');
  control.position.x = 4;
  const pick = await picker(root, raycaster);
  let housingTests = 0;
  const intersectHousing = housing.raycast;
  housing.raycast = function (...args) { housingTests++; return intersectHousing.apply(this, args); };
  assert.equal(pick(), null);
  assert.equal(housingTests, 0);
});

test('a failed occlusion query does not leak its shortened ray range', async () => {
  const root = new THREE.Group(), raycaster = ray();
  const housing = plane(root, 0, null);
  plane(root, 1, 'button');
  const pick = await picker(root, raycaster);
  housing.raycast = () => { throw new Error('bad geometry'); };
  assert.throws(pick, /bad geometry/);
  assert.equal(raycaster.far, 20);
});
