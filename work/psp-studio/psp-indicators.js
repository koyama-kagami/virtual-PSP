import * as THREE from 'three';
import { capsuleOutline } from './psp-hardware.js';
import { frontHeight } from './psp-surfaces.js';

// Front-photo estimates in centimetres, not factory dimensions. The POWER
// window is almost round head-on; its old 2.3:1 slit was too flat and inboard.
export const indicatorLayout = {
  power: { x: 7.98, y: -1.27, width: .13, height: .11 },
  hold: { x: 7.70, y: -2.02, width: .11, height: .10 },
};

function windowSurface({ x, y, width, height }, offset, modelId) {
  const geometry = new THREE.ShapeGeometry(capsuleOutline(width, height), 32);
  const positions = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    const px = positions.getX(i), py = positions.getY(i);
    uv.setXY(i, px / width + .5, py / height + .5);
    positions.setXYZ(i, x + px, y + py, frontHeight(x + px, y + py, modelId) + offset);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function createPowerIndicators(device, modelId = '3000') {
  const group = new THREE.Group();
  group.name = 'power-and-hold-windows';
  device.add(group);
  const bezelMaterial = new THREE.MeshStandardMaterial({ color: 0x121a16, roughness: .58 });
  const lensMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x102017, roughness: .35, clearcoat: .5, clearcoatRoughness: .25,
    emissive: 0x000000, emissiveIntensity: 0, toneMapped: false,
  });
  const holdMaterial = new THREE.MeshPhysicalMaterial({color:0x211e15, roughness:.48, clearcoat:.3, clearcoatRoughness:.3});
  for (const [name, layout] of Object.entries(indicatorLayout)) {
    const bezel = new THREE.Mesh(windowSurface({ ...layout,
      width: layout.width + .024, height: layout.height + .024 }, .004, modelId), bezelMaterial);
    bezel.name = `${name}-window-rim`;
    group.add(bezel);
    const material = name === 'power' ? lensMaterial : holdMaterial;
    const lens = new THREE.Mesh(windowSurface(layout, .009, modelId), material);
    lens.name = `${name}-indicator`;
    group.add(lens);
  }

  // A little diffusion at the lens, not a large scene-wide bloom or point light.
  // Conforming this patch to the shell keeps it depth-occluded from the rear.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(32, 32, 3, 32, 32, 32);
  glow.addColorStop(0, 'rgba(98,255,61,.24)');
  glow.addColorStop(.42, 'rgba(68,245,40,.10)');
  glow.addColorStop(1, 'rgba(68,245,40,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Mesh(windowSurface({ ...indicatorLayout.power,
    width: .34, height: .29 }, .002, modelId), new THREE.MeshBasicMaterial({
    map, transparent: true, depthWrite: false, toneMapped: false,
  }));
  halo.name = 'power-lens-diffusion'; halo.visible = false;
  group.add(halo);

  return {
    setHold(on) { holdMaterial.color.set(on ? 0xd6a024 : 0x211e15); },
    setOn(on) {
      lensMaterial.color.set(on ? 0x205b18 : 0x102017);
      lensMaterial.emissive.set(on ? 0x32ed1f : 0x000000);
      lensMaterial.emissiveIntensity = on ? 1.15 : 0;
      halo.visible = on;
    },
  };
}
