import { Matrix4, Plane, Ray, Vector3 } from 'three';

/** Drag a thumb along a stationary rail's local X or Y axis, without grab jumps. */
export function createSliderDrag({ group, axis, min, max }) {
  if (axis !== 'x' && axis !== 'y') throw new TypeError('Slider axis must be x or y.');
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw new RangeError('Slider travel must be finite and increasing.');
  const inverse = new Matrix4(), localRay = new Ray();
  const plane = new Plane(new Vector3(0, 0, 1), 0), point = new Vector3();
  let active = false, grabOffset = 0;
  const clamp = value => Math.max(min, Math.min(max, value));

  function project(worldRay) {
    group.updateWorldMatrix(true, false);
    inverse.copy(group.matrixWorld).invert();
    localRay.copy(worldRay).applyMatrix4(inverse);
    // An edge-on rail has no stable drag plane: do not send the thumb to an end.
    if (Math.abs(localRay.direction.z) < 1e-7 || !localRay.intersectPlane(plane, point)) return null;
    return Number.isFinite(point[axis]) ? point[axis] : null;
  }

  return {
    begin(worldRay, currentValue) {
      active = false;
      if (!Number.isFinite(currentValue)) return false;
      const position = project(worldRay);
      if (position === null) return false;
      grabOffset = position - clamp(currentValue);
      active = true;
      return true;
    },
    move(worldRay) {
      if (!active) return null;
      const position = project(worldRay);
      return position === null ? null : clamp(position - grabOffset);
    },
    reset() { active = false; grabOffset = 0; },
  };
}
