/** Build once after the device is assembled; moving controls keep their meshes. */
export function createControlPicker(root, raycaster) {
  const controls = [];
  root.traverse(object => {
    if (object.isMesh && object.userData.control) controls.push(object);
  });
  const candidates = [], intersections = [];

  return function pickControl() {
    candidates.length = 0;
    raycaster.intersectObjects(controls, false, candidates);
    // Most hover positions miss every control. Avoid testing the detailed shell
    // and drive mechanism until there is a control that could actually be hit.
    if (!candidates.length) return null;
    const previousFar = raycaster.far;
    raycaster.far = Math.min(previousFar, candidates[0].distance + .00001);
    intersections.length = 0;
    try {
      raycaster.intersectObject(root, true, intersections);
      for (const hit of intersections) {
        if (hit.object.userData.control) return hit.object.userData.control;
        const material = hit.object.material;
        // Preserve transparent labels and the invisible power click surface.
        // Opaque housing must still block a button viewed from the rear.
        if (material && !material.transparent && material.visible !== false) return null;
      }
      return null;
    } finally {
      raycaster.far = previousFar;
      candidates.length = intersections.length = 0;
    }
  };
}
