import * as THREE from 'three';

// Construction is photo-calibrated, not factory CAD. The bottom hinge and the
// separate stamped-metal UMD brace are visible in iFixit's 300xc guide, steps
// 18–20: https://www.ifixit.com/Guide/PSP+300xc+UMD+Door+Replacement/4279
const APERTURE = { width: 7.02, height: 6.10, radius: .16 };
const HINGE_Y = -3.19;
const OPEN_ANGLE = THREE.MathUtils.degToRad(58);

function outline(width, height, radius) {
  const s = new THREE.Shape(), x = -width / 2, y = -height / 2;
  s.moveTo(x + radius, y); s.lineTo(x + width - radius, y);
  s.quadraticCurveTo(x + width, y, x + width, y + radius);
  s.lineTo(x + width, y + height - radius);
  s.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  s.lineTo(x + radius, y + height);
  s.quadraticCurveTo(x, y + height, x, y + height - radius);
  s.lineTo(x, y + radius); s.quadraticCurveTo(x, y, x + radius, y);
  s.closePath();
  return s;
}

/** Keep all structural shell layers genuinely open behind the UMD door. */
export function withUmdOpening(shape, scaleX = 1, scaleY = 1) {
  if (!(scaleX > 0 && scaleY > 0)) throw new RangeError('UMD shell scale must be positive');
  const result = shape.clone();
  const points = outline(APERTURE.width, APERTURE.height, APERTURE.radius)
    .getPoints(24).map(p => new THREE.Vector2(p.x / scaleX, p.y / scaleY));
  result.holes.push(new THREE.Path(points));
  return result;
}

export function createUmdMechanism({
  rear, materials, roundedBox, disc, ring, annulus, seam,
  label, pspLogo, getFinish, textLabel,
  model = {id:'3000', rearRingInner:2.460, rearRingOuter:2.600},
}) {
  const finish = getFinish();
  const doorMaterial = materials.rear.clone();
  const inlayMaterial = new THREE.MeshPhysicalMaterial({
    color: finish.inlay, metalness: .62, roughness: .28,
    clearcoat: .5, envMapIntensity: .8,
  });
  const trayMaterial = new THREE.MeshStandardMaterial({ color: '#a1a7a9', metalness: .78, roughness: .41 });
  const braceMaterial = new THREE.MeshStandardMaterial({ color: '#b6b7b1', metalness: .83, roughness: .32 });
  const innerMaterial = new THREE.MeshStandardMaterial({ color: '#202326', metalness: .04, roughness: .71 });
  const plasticMaterial = new THREE.MeshStandardMaterial({ color: '#101215', metalness: .06, roughness: .49 });
  const apertureMaterial = new THREE.MeshStandardMaterial({ color: '#08090b', metalness: .03, roughness: .81 });

  function solid(shape, depth, material, z, parent, bevel = 0) {
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: 24, bevelEnabled: bevel > 0,
      bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.z = z; parent.add(mesh);
    return mesh;
  }
  function frame(width, height, radius, wall, depth, material, z, parent) {
    const s = outline(width, height, radius);
    s.holes.push(new THREE.Path(outline(width - wall * 2, height - wall * 2,
      Math.max(.025, radius - wall)).getPoints(24)));
    return solid(s, depth, material, z, parent);
  }
  function screwHead(x, y, z, parent) {
    disc(.074, .035, braceMaterial, x, y, z, parent);
    roundedBox(.072, .015, .005, .004, plasticMaterial, x, y, z + .021, parent);
  }

  const bay = new THREE.Group(); bay.name = 'umd-drive-bay'; rear.add(bay);
  // This recessed well closes the aperture before the front LCD. Its walls and
  // floor replace the previous solid slab behind a decorative lid.
  solid(outline(7.01, 6.09, .16), .075, apertureMaterial, -.80, bay);
  frame(7.01, 6.09, .16, .18, .68, innerMaterial, -.75, bay);
  frame(7.08, 6.16, .17, .09, .045, plasticMaterial, -.085, bay);

  // Perforated stamped drive chassis, with a drive spindle and an optical sled.
  const trayShape = outline(6.58, 5.66, .16);
  for (const [x, y, radius] of [[-2.45, 1.80, .30], [2.41, 1.75, .24],
    [-2.45, -.80, .25], [2.44, -.80, .25], [-2.12, -2.16, .17], [2.1, -2.16, .17]]) {
    const hole = new THREE.Path(); hole.absarc(x, y, radius, 0, Math.PI * 2);
    trayShape.holes.push(hole);
  }
  const laserSlot = outline(2.05, 1.13, .13);
  trayShape.holes.push(new THREE.Path(laserSlot.getPoints(20).map(p => p.add(new THREE.Vector2(1.18, -.80)))));
  solid(trayShape, .035, trayMaterial, -.66, bay, .006);
  // The optical spindle is substantially smaller than the outer UMD silver ring.
  disc(.84, .07, plasticMaterial, -.30, .39, -.565, bay);
  ring(.70, .035, materials.rim, -.30, .39, -.52, bay);
  disc(.38, .10, plasticMaterial, -.30, .39, -.49, bay);
  disc(.14, .12, braceMaterial, -.30, .39, -.43, bay);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    disc(.053, .017, braceMaterial, -.30 + Math.cos(a) * .57, .39 + Math.sin(a) * .57, -.514, bay);
  }
  for (const y of [-1.20, -.42]) seam([[.08, y, -.51], [2.38, y, -.51]], .035, braceMaterial, bay);
  roundedBox(1.00, .84, .10, .08, plasticMaterial, 1.12, -.80, -.61, bay);
  disc(.26, .09, materials.rim, 1.12, -.80, -.48, bay);
  const lensMaterial = new THREE.MeshPhysicalMaterial({ color: '#426477', metalness: .28, roughness: .12, clearcoat: 1 });
  disc(.15, .025, lensMaterial, 1.12, -.80, -.415, bay);
  // Small guide blocks and fastening points break up the flat chassis.
  for (const x of [-2.90, 2.90]) {
    roundedBox(.20, 2.55, .16, .045, plasticMaterial, x, -.15, -.57, bay);
    for (const y of [-2.42, 2.42]) screwHead(x, y, -.57, bay);
  }
  roundedBox(.36, .35, .18, .04, plasticMaterial, -2.54, 2.45, -.43, bay);
  roundedBox(.14, .25, .13, .025, braceMaterial, -2.54, 2.46, -.24, bay);

  const pivot = new THREE.Group();
  pivot.name = 'umd-door-hinge';
  pivot.position.set(0, HINGE_Y, -.035);
  rear.add(pivot);
  const door = new THREE.Group(); door.name = 'umd-door';
  door.position.set(0, -HINGE_Y, .035); pivot.add(door);
  // Outer face is in its original closed position. Thickness extends inward.
  solid(outline(7.29, 6.54, .055), .085, doorMaterial, -.093, door, .008);
  const ringInner = model.rearRingInner, ringOuter = model.rearRingOuter;
  annulus(ringInner - .012, ringOuter + .012, materials.recess, 0, .02, .015, door);
  annulus(ringInner, ringOuter, inlayMaterial, 0, .02, .024, door);
  ring(ringOuter + .001, .007, materials.trim, 0, .02, .024, door);
  ring(ringInner - .007, .005, materials.black, 0, .02, .019, door);
  label(model.id === '3000' ? 4.60 : 3.45, model.id === '3000' ? .84 : .68, 0, -.03, .029,
    (ctx, w, h) => pspLogo(ctx, w, h, getFinish().rearInk), door, true);
  textLabel('UMD™', .73, .23, 2.92, 3.15, .007, { rear: true }, door);

  // The inner skin and moulded ribs are visible from an oblique open view.
  solid(outline(6.92, 6.11, .11), .027, innerMaterial, -.127, door);
  frame(6.85, 6.01, .14, .065, .075, plasticMaterial, -.20, door);
  for (const x of [-2.91, 2.91]) {
    roundedBox(.07, 4.94, .06, .02, innerMaterial, x, -.15, -.21, door);
    for (const y of [-1.73, 1.73]) roundedBox(.52, .07, .06, .015, innerMaterial, x * .94, y, -.21, door);
  }
  const innerRing = ring(2.47, .033, plasticMaterial, 0, .02, -.165, door);
  innerRing.scale.z = .7;
  // Shallow central reinforcement belongs to the cover, not an invented disc.
  for (const y of [-1.10, 1.10]) roundedBox(3.95, .055, .055, .02, innerMaterial, 0, y, -.19, door);

  // Thin U-shaped steel disc guide, with open centre and folded lower corners.
  const braceShape = new THREE.Shape();
  braceShape.moveTo(-3.08, 1.92); braceShape.lineTo(-3.08, -2.51);
  braceShape.quadraticCurveTo(-3.08, -2.75, -2.82, -2.75);
  braceShape.lineTo(2.82, -2.75); braceShape.quadraticCurveTo(3.08, -2.75, 3.08, -2.51);
  braceShape.lineTo(3.08, 1.92); braceShape.lineTo(2.78, 1.92);
  braceShape.lineTo(2.78, -2.37); braceShape.lineTo(-2.78, -2.37);
  braceShape.lineTo(-2.78, 1.92); braceShape.closePath();
  solid(braceShape, .035, braceMaterial, -.32, door, .009);
  for (const x of [-2.95, 2.95]) {
    roundedBox(.15, .85, .12, .025, braceMaterial, x, 1.71, -.32, door);
    for (const y of [-1.98, 1.21]) disc(.058, .026, plasticMaterial, x, y, -.337, door);
  }
  // Hinge barrels are aligned with the true bottom pivot, not the cover centre.
  for (const x of [-2.96, 2.96]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.105, .105, .41, 24), plasticMaterial);
    barrel.rotation.z = Math.PI / 2; barrel.position.set(x, 0, 0); pivot.add(barrel);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(.047, .047, .47, 16), braceMaterial);
    pin.rotation.z = Math.PI / 2; pin.position.copy(barrel.position); pivot.add(pin);
  }
  // Picking any part of the moving cover closes it, including its printed face.
  pivot.traverse(object => { if (object.isMesh) object.userData.control = 'umd'; });

  let opened = false;
  return {
    doorMaterial, inlayMaterial, pivot,
    get isOpen() { return opened; },
    get isAnimating() { return Math.abs((opened ? OPEN_ANGLE : 0) - pivot.rotation.x) >= .0001; },
    setOpen(open, immediate = false) {
      opened = Boolean(open);
      if (immediate) pivot.rotation.x = opened ? OPEN_ANGLE : 0;
    },
    update(dt, reducedMotion = false) {
      const target = opened ? OPEN_ANGLE : 0;
      pivot.rotation.x = reducedMotion ? target : THREE.MathUtils.damp(pivot.rotation.x, target, 13, Math.min(Math.max(dt, 0), .1));
      if (Math.abs(target - pivot.rotation.x) < .0001) pivot.rotation.x = target;
    },
  };
}
