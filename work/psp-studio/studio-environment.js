import * as THREE from 'three';

/** The immutable light rig belongs to the renderer, not to a PSP generation. */
export function createStudioEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x555555);
  try {
    for (const [w, h, x, y, z, intensity] of [
      [21, 2.2, -2, 9, 8, 5], [3.5, 13, -12, 1, 6, 3.2],
      [2.3, 11, 12, 3, 5, 4.5], [17, 1, 0, -8, 5, 1.5],
      [18, 6, 2, 5, -12, 3],
    ]) {
      const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(intensity) }));
      card.position.set(x, y, z); card.lookAt(0, 0, 0); studio.add(card);
    }
    return pmrem.fromScene(studio, .025);
  } finally {
    studio.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    pmrem.dispose();
  }
}
