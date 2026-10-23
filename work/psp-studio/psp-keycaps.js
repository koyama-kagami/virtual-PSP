import * as THREE from 'three';

// Clear moulded acrylic over a pigmented insert. Opacity remains one: reducing
// alpha would expose the socket instead of refracting the insert through a cap.
export function crystalMaterial(thickness) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: .025,
    transmission: 1, thickness, ior: 1.49,
    attenuationColor: 0xffffff, attenuationDistance: .5,
    clearcoat: .35, clearcoatRoughness: .04, envMapIntensity: 1.0,
  });
}

export function tintCrystal(material, colour) {
  // Most colour belongs to the insert; only the thicker cap edges are tinted.
  material.attenuationColor.set(colour).lerp(new THREE.Color(0xffffff), .86);
}

export function addCapInsert(cap, material, xyScale, zScale, zOffset) {
  const geometry = cap.geometry.clone();
  geometry.scale(xyScale, xyScale, zScale);
  const insert = new THREE.Mesh(geometry, material);
  insert.position.copy(cap.position); insert.position.z += zOffset;
  cap.parent.add(insert);
  return insert;
}

export function beneathCrystal(legend) {
  // Three's transmission buffer contains opaque/cutout meshes, not the later
  // alpha-blended label pass. A cutout keeps the printed glyph under the glass.
  const material = legend.material;
  material.transparent = false;
  material.alphaTest = .12;
  material.alphaToCoverage = true;
  material.depthWrite = true;
  material.needsUpdate = true;
  return legend;
}
