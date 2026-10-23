import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getModel } from './models.js';
import { getHousingLayers, sideFrameAt, createSidePanelGeometry } from './psp-midframe.js';

function layerMesh(spec, name) {
  const geometry = new THREE.ExtrudeGeometry(spec.shape, {
    depth:spec.depth, bevelEnabled:true, bevelThickness:spec.bevel,
    bevelSize:spec.bevel, bevelSegments:10, curveSegments:48, steps:1,
  });
  geometry.scale(spec.scaleX, spec.scaleY, 1);
  geometry.translate(0, 0, spec.z);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = name;
  return mesh;
}
const disposeMeshes = meshes => meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });

test('the exposed middle frame stays outside the core on both sides of every generation', () => {
  const ray = new THREE.Raycaster();
  for (const id of ['1000','2000','3000']) {
    const layers = getHousingLayers(getModel(id));
    const meshes = [layerMesh(layers.core, 'core'), layerMesh(layers.frame, 'frame')];
    try {
      for (const side of [-1,1]) for (const y of [-2.8,-1.4,0,1.4,2.8]) for (const z of [-.2,0,.2]) {
        ray.set(new THREE.Vector3(side * 20, y, z), new THREE.Vector3(-side, 0, 0));
        assert.equal(ray.intersectObjects(meshes, false)[0]?.object.name, 'frame', `${id} side=${side} y=${y} z=${z}`);
      }
      assert.ok(Math.abs(layers.core.z + layers.core.depth - .36) < 1e-8, 'the structural front plane is retained');
      assert.equal(layers.frame.scaleX, 1);
      assert.equal(layers.frame.scaleY, 1);
      assert.equal(layers.rear.scaleX, .99);
      assert.equal(layers.rear.scaleY, .98);
      for (const layer of Object.values(layers)) assert.equal(layer.shape.holes.length, 1, 'UMD aperture is retained');
    } finally { disposeMeshes(meshes); }
  }
});

test('side mounting radius matches the real bevel contour rather than the bare outline', () => {
  const ray = new THREE.Raycaster();
  for (const id of ['1000','2000','3000']) {
    const model = getModel(id), mesh = layerMesh(getHousingLayers(model).frame, 'frame');
    try {
      for (const y of [-2.8,-2.1,-1.15,-.35,0,.02,.7,1.4,2.8]) {
        ray.set(new THREE.Vector3(20, y, 0), new THREE.Vector3(-1, 0, 0));
        const hit = ray.intersectObject(mesh, false)[0];
        const {radius, slope} = sideFrameAt(model, y);
        assert.ok(Math.abs(radius - hit.point.x) < 2e-6, `${id} y=${y}: ${radius} vs ${hit.point.x}`);
        assert.ok(Number.isFinite(slope));
        assert.ok(radius > 0);
      }
    } finally { disposeMeshes([mesh]); }
  }
});

test('a long memory cover follows the curved side with finite outward normals and nondegenerate triangles', () => {
  for (const id of ['1000','2000','3000']) {
    const model = getModel(id), centerY = id === '1000' ? -.35 : .02;
    const depth = .025;
    const geometry = createSidePanelGeometry(model, {width:.62, height:3.5, radius:.16, centerY, depth});
    try {
      const position = geometry.attributes.position, normal = geometry.attributes.normal;
      const center = sideFrameAt(model, centerY).radius;
      let low = Infinity, high = -Infinity;
      for (let i = 0; i < position.count; i++) {
        const x=position.getX(i), y=position.getY(i), z=position.getZ(i);
        assert.ok([x,y,z,normal.getX(i),normal.getY(i),normal.getZ(i)].every(Number.isFinite));
        assert.ok(Math.abs(z - (sideFrameAt(model, centerY+y).radius - center + depth)) < 2e-6);
        assert.ok(normal.getZ(i) > 0);
        assert.ok(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i)) - 1) < 1e-6);
        low=Math.min(low,z); high=Math.max(high,z);
      }
      assert.ok(high-low > .12, 'long side covers cannot be a flat plate');
      const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3();
      for(let i=0;i<geometry.index.count;i+=3){
        a.fromBufferAttribute(position,geometry.index.getX(i));
        b.fromBufferAttribute(position,geometry.index.getX(i+1)).sub(a);
        c.fromBufferAttribute(position,geometry.index.getX(i+2)).sub(a);
        assert.ok(b.cross(c).z > 1e-10, 'triangles face the outward local +z direction');
      }
    } finally { geometry.dispose(); }
  }
});

test('side panels also support capsule ends and reject geometry outside the side contour', () => {
  const model = getModel('3000');
  const geometry = createSidePanelGeometry(model, {width:.5,height:1.1,radius:.25,centerY:-1.15,depth:.02});
  try {
    assert.ok(geometry.index.count > 0);
    const p=geometry.attributes.position, a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3();
    for(let i=0;i<geometry.index.count;i+=3){
      a.fromBufferAttribute(p,geometry.index.getX(i));
      b.fromBufferAttribute(p,geometry.index.getX(i+1)).sub(a);
      c.fromBufferAttribute(p,geometry.index.getX(i+2)).sub(a);
      assert.ok(b.cross(c).z > 1e-10);
    }
  } finally { geometry.dispose(); }
  assert.throws(() => sideFrameAt(model, 20), RangeError);
  assert.throws(() => createSidePanelGeometry(model, {width:.5,height:20,radius:.1,centerY:0,depth:.02}), RangeError);
  assert.throws(() => createSidePanelGeometry(model, {width:0,height:1,radius:.1,centerY:0,depth:.02}), RangeError);
});
