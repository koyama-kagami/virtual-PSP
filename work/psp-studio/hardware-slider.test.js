import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Ray, Vector3 } from 'three';
import { createSliderDrag } from './hardware-slider.js';

function rayAt(group, x, y, z = 3, dz = -1) {
  group.updateWorldMatrix(true, false);
  return new Ray(new Vector3(x, y, z), new Vector3(0, 0, dz)).applyMatrix4(group.matrixWorld);
}

test('slider grab preserves an off-centre thumb offset and clamps travel', () => {
  const group = new Group();
  const slider = createSliderDrag({ group, axis: 'x', min: -.23, max: .23 });
  assert.equal(slider.begin(rayAt(group, .18, .03), .10), true);
  assert.ok(Math.abs(slider.move(rayAt(group, .18, .03)) - .10) < 1e-9);
  assert.ok(Math.abs(slider.move(rayAt(group, .23, -.1)) - .15) < 1e-9);
  assert.equal(slider.move(rayAt(group, 10, 0)), .23);
  assert.equal(slider.move(rayAt(group, -10, 0)), -.23);
});

test('slider follows its local rail through nested rotations and non-uniform scale', () => {
  const device = new Group();
  device.position.set(1, 2, 3); device.rotation.set(.6, -.8, .15);
  device.scale.set(1.1, .95, 1.3);
  const rail = new Group(); device.add(rail);
  rail.position.set(-8.35, 1.4, -.16); rail.rotation.set(0, -Math.PI / 2, Math.PI / 2);
  const wlan = createSliderDrag({ group: rail, axis: 'x', min: -.23, max: .23 });
  assert.equal(wlan.begin(rayAt(rail, -.21, .06), -.23), true);
  assert.ok(Math.abs(wlan.move(rayAt(rail, .25, .06)) - .23) < 1e-9);

  rail.rotation.set(0, Math.PI / 2, 0);
  const power = createSliderDrag({ group: rail, axis: 'y', min: -.26, max: .27 });
  assert.equal(power.begin(rayAt(rail, .12, .04), 0), true);
  assert.ok(Math.abs(power.move(rayAt(rail, -.1, .24)) - .20) < 1e-9);
});

test('parallel or rear-facing rays cannot begin or jump a slider', () => {
  const group = new Group();
  const slider = createSliderDrag({ group, axis: 'y', min: -.26, max: .27 });
  const parallel = new Ray(new Vector3(0, 0, 1), new Vector3(1, 0, 0));
  const grazing = new Ray(new Vector3(0, 0, 1), new Vector3(1, 0, -1e-9).normalize());
  assert.equal(slider.begin(parallel, 0), false);
  assert.equal(slider.move(rayAt(group, 0, .2)), null);
  assert.equal(slider.begin(rayAt(group, 0, 0, 1, 1), 0), false);
  assert.equal(slider.begin(rayAt(group, 0, 0), 0), true);
  assert.equal(slider.move(parallel), null);
  assert.equal(slider.move(grazing), null);
  assert.ok(Math.abs(slider.move(rayAt(group, 0, .15)) - .15) < 1e-9);
});

test('reset and re-grab discard the previous gesture offset', () => {
  const group = new Group();
  const slider = createSliderDrag({ group, axis: 'x', min: -.23, max: .23 });
  slider.begin(rayAt(group, .1, 0), .23);
  slider.reset();
  assert.equal(slider.move(rayAt(group, -.1, 0)), null);
  slider.begin(rayAt(group, -.15, 0), -.23);
  assert.ok(Math.abs(slider.move(rayAt(group, .05, 0)) + .03) < 1e-9);
});
