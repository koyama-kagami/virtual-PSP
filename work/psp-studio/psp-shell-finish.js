import * as THREE from 'three';
import { getFinish } from './finishes.js';
import { getPaintProfile } from './paint-profiles.js';

// A clean, moulded/painted shell: small finish variation, not wear or scratches.
// Distances are centimetres, consistent with the rest of the model. Texture
// filtering averages sub-pixel grain instead of letting it sparkle on rotation.
const SIZE = 256;
const TILE_CM = .9;
const cachedMapPixels = new Map();

function noiseLayer(cells, seed) {
  const hash = (a, b) => {
    let n = Math.imul((a + cells) % cells, 374761393) ^ Math.imul((b + cells) % cells, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grid = new Float64Array((cells + 1) * (cells + 1));
  const offsets = new Uint16Array(SIZE), weights = new Float64Array(SIZE);
  for (let y = 0; y <= cells; y++) for (let x = 0; x <= cells; x++) {
    grid[y * (cells + 1) + x] = hash(x, y);
  }
  for (let i = 0; i < SIZE; i++) {
    const p = i * cells / SIZE;
    offsets[i] = Math.floor(p);
    weights[i] = smooth(p - offsets[i]);
  }
  return (x, y) => {
    const start = offsets[y] * (cells + 1) + offsets[x], next = start + cells + 1;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(grid[start], grid[start + 1], weights[x]),
      THREE.MathUtils.lerp(grid[next], grid[next + 1], weights[x]), weights[y]);
  };
}

function createMapPixels(family) {
  const height = new Float32Array(SIZE * SIZE);
  const coatHeight = new Float32Array(SIZE * SIZE);
  const surface = new Uint8Array(SIZE * SIZE * 4);
  const peelAt = noiseLayer(34, 713), grainAt = noiseLayer(104, 2819), flowAt = noiseLayer(7, 647);
  const metal = family === 'metallic', pearl = family === 'pearl', matte = family === 'matte';
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const peel = peelAt(x, y), grain = grainAt(x, y), flow = flowAt(x, y);
    const flake = Math.pow(grain, 2.5);
    // Subsurface flake orientation changes the base reflection, not the smooth
    // top coat. No white dots are painted into the pigment/base colour.
    height[y * SIZE + x] = metal ? .90 * grain + .10 * flow
      : pearl ? .65 * grain + .25 * peel + .10 * flow
      : matte ? .80 * grain + .20 * peel : .30 * peel + .12 * grain + .58 * flow;
    coatHeight[y * SIZE + x] = .65 * peel + .35 * flow;
    const roughness = metal ? .94 - .10 * flake : pearl ? .96 - .06 * flake
      : matte ? .87 + .12 * grain : .96 + .04 * flow;
    const metalness = metal ? .94 + .06 * flake : pearl ? .96 + .04 * flake : 1;
    const pixel = (y * SIZE + x) * 4;
    surface[pixel] = 255;
    surface[pixel + 1] = Math.round(255 * roughness);
    surface[pixel + 2] = Math.round(255 * metalness);
    surface[pixel + 3] = 255;
  }
  function normals(values, amplitude) {
    // Half-float prevents the old near-flat 8-bit map collapsing into just six
    // normal levels. This is numeric linear data, never sRGB colour data.
    const pixels = new Uint16Array(SIZE * SIZE * 4);
    const at = (x, y) => values[((y + SIZE) % SIZE) * SIZE + (x + SIZE) % SIZE];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * amplitude * SIZE / (2 * TILE_CM);
      const dy = (at(x, y + 1) - at(x, y - 1)) * amplitude * SIZE / (2 * TILE_CM);
      const length = Math.hypot(dx, dy, 1), pixel = (y * SIZE + x) * 4;
      pixels[pixel] = THREE.DataUtils.toHalfFloat(.5 - dx / length * .5);
      pixels[pixel + 1] = THREE.DataUtils.toHalfFloat(.5 - dy / length * .5);
      pixels[pixel + 2] = THREE.DataUtils.toHalfFloat(.5 + .5 / length);
      pixels[pixel + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    return pixels;
  }
  return { normal: normals(height, metal ? .0010 : pearl ? .0008 : matte ? .0018 : .0008),
    coat: normals(coatHeight, .0007), surface };
}

function finishMaps(renderer, family) {
  // Four finite families, 1.25 MiB CPU each. Only the families visited by this
  // model own GPU textures; changing RGB never generates or uploads new pixels.
  if (!cachedMapPixels.has(family)) cachedMapPixels.set(family, createMapPixels(family));
  const pixels = cachedMapPixels.get(family);
  function texture(data, channel) {
    const map = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat,
      data instanceof Uint16Array ? THREE.HalfFloatType : THREE.UnsignedByteType);
    map.name = `${family}-paint-${channel}`;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    map.repeat.setScalar(1 / TILE_CM);
    map.needsUpdate = true;
    return map;
  }
  return { normal: texture(pixels.normal, 'base-normal'), coat: texture(pixels.coat, 'coat-normal'),
    surface: texture(pixels.surface, 'roughness-metalness') };
}

export function createShellFinish(renderer, initialFinish, model = {id:'3000', rearMatte:false}) {
  const bank = new Map(), resources = [];
  function mapsFor(family) {
    if (!bank.has(family)) {
      const maps = finishMaps(renderer, family);
      bank.set(family, maps); resources.push(...Object.values(maps));
    }
    return bank.get(family);
  }
  const shell = new THREE.MeshPhysicalMaterial({ ior: 1.49 });
  const rear = shell.clone();
  const core = new THREE.MeshStandardMaterial({
    roughness: .48, metalness: 0, envMapIntensity: .55,
  });

  function apply(material, palette, color) {
    const maps = mapsFor(palette.mapFamily);
    const firstMap = !material.normalMap;
    material.normalMap = maps.normal;
    material.normalScale.setScalar(palette.normalTexture);
    material.roughnessMap = material.metalnessMap = maps.surface;
    material.clearcoatNormalMap = maps.coat;
    material.clearcoatRoughnessMap = null;
    material.color.set(color);
    material.roughness = palette.roughness;
    material.metalness = palette.metalness;
    material.clearcoat = palette.clearcoat;
    material.clearcoatRoughness = palette.clearcoatRoughness;
    material.clearcoatNormalScale.setScalar(palette.coatTexture);
    material.envMapIntensity = palette.envMapIntensity;
    if (firstMap) material.needsUpdate = true;
  }
  function update(palette, doorMaterial) {
    let back = palette.rearFinish ? getFinish(palette.rearFinish, model.id) : palette;
    if (palette.rearPaint) back = { ...back, ...getPaintProfile(palette.rearPaint) };
    if (model.rearMatte) back = { ...back, mapFamily:'matte', roughness:Math.max(.47, back.roughness),
      clearcoat:.12, clearcoatRoughness:.36, normalTexture:.42, coatTexture:.20 };
    apply(shell, palette, palette.shell);
    apply(rear, back, palette.rear);
    if (doorMaterial) apply(doorMaterial, back, palette.rear);
    core.color.set(palette.core);
  }

  // The custom faceplate has no UVs. Project all shell pieces in model units,
  // including the separate hinged cover, so their grain has the same scale.
  const mappedGeometries = new WeakSet();
  function mapGeometry(root, doorMaterial) {
    const shellMaterials = new Set([shell, rear, core, doorMaterial]);
    root.traverse(mesh => {
      if (!mesh.isMesh || !shellMaterials.has(mesh.material)) return;
      const geometry = mesh.geometry, positions = geometry.attributes.position;
      if (mappedGeometries.has(geometry)) return;
      const normals = geometry.attributes.normal, originalIndex = geometry.index;
      const count = originalIndex?.count ?? positions.count;
      const projected = new Int32Array(positions.count * 6).fill(-1);
      const maxVertices = Math.min(count, projected.length);
      const sourceIds = new Uint32Array(maxVertices), projections = new Uint8Array(maxVertices);
      const indices = new Uint32Array(count);
      let vertexCount = 0;
      // Choose one projection per triangle. Split only vertices shared across
      // projection seams, retaining the smooth source normals and index reuse.
      // Per-vertex axis selection would stretch the grain across curved rims.
      for (let t = 0; t < count; t += 3) {
        const a = originalIndex ? originalIndex.getX(t) : t;
        const b = originalIndex ? originalIndex.getX(t + 1) : t + 1;
        const c = originalIndex ? originalIndex.getX(t + 2) : t + 2;
        const ax = positions.getX(a), ay = positions.getY(a), az = positions.getZ(a);
        const bx = positions.getX(b) - ax, by = positions.getY(b) - ay, bz = positions.getZ(b) - az;
        const cx = positions.getX(c) - ax, cy = positions.getY(c) - ay, cz = positions.getZ(c) - az;
        const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
        const x = Math.abs(nx), y = Math.abs(ny), z = Math.abs(nz);
        const axis = z >= x && z >= y ? 2 : x > y ? 0 : 1;
        const negative = (axis === 2 ? nz : axis === 0 ? nx : ny) < 0;
        const projection = axis * 2 + Number(negative);
        for (let k = 0; k < 3; k++) {
          const i = k === 0 ? a : k === 1 ? b : c;
          const key = i * 6 + projection;
          if (projected[key] === -1) {
            projected[key] = vertexCount;
            sourceIds[vertexCount] = i;
            projections[vertexCount++] = projection;
          }
          indices[t + k] = projected[key];
        }
      }
      const nextPositions = new Float32Array(vertexCount * 3), nextNormals = new Float32Array(vertexCount * 3);
      const uv = new Float32Array(vertexCount * 2);
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const i = sourceIds[vertex], axis = projections[vertex] >> 1;
        const sign = projections[vertex] & 1 ? -1 : 1;
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const at = vertex * 3, uvAt = vertex * 2;
        nextPositions[at] = x; nextPositions[at + 1] = y; nextPositions[at + 2] = z;
        nextNormals[at] = normals.getX(i); nextNormals[at + 1] = normals.getY(i); nextNormals[at + 2] = normals.getZ(i);
        uv[uvAt] = axis === 0 ? -z * sign : axis === 2 ? x * sign : x;
        uv[uvAt + 1] = axis === 1 ? -z * sign : y;
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(nextPositions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(nextNormals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geometry.setIndex(new THREE.BufferAttribute(vertexCount > 65535 ? indices : Uint16Array.from(indices), 1));
      mappedGeometries.add(geometry);
    });
  }
  update(initialFinish);
  return { shell, rear, core, update, mapGeometry, resources,
    dispose() { for (const resource of resources) resource.dispose(); } };
}
