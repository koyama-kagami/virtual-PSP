import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { frontLayout, frontHeight, dpadKey, roundKeyGeometry } from './psp-surfaces.js';
import { roundedShape, silhouette } from './psp-shapes.js';
import { createFaceplateGeometry } from './faceplate-geometry.js';
import { getFinish } from './finishes.js';
import { mountFinishPicker } from './finish-picker.js';
import { getUtilityKeys, utilityY, utilityOutline, utilityCapGeometry, shoulderPoint, shoulderShellGeometry } from './psp-hardware.js';
import { AnalogStick } from './analog-stick.js';
import { createUmdMechanism } from './psp-umd.js';
import { drawSonyWordmark } from './sony-wordmark.js';
import { createPowerIndicators } from './psp-indicators.js';
import { crystalMaterial, tintCrystal, addCapInsert, beneathCrystal } from './psp-keycaps.js';
import { createShellFinish } from './psp-shell-finish.js';
import { getHousingLayers, sideFrameAt, createSidePanelGeometry } from './psp-midframe.js';
import { getModel } from './models.js';
import { mountModelPicker } from './model-picker.js';
import { disposeSceneResources } from './scene-resources.js';
import { addOriginalRearGrips } from './psp-legacy-grips.js';
import { createRenderLoop } from './render-loop.js';
import { createStudioEnvironment } from './studio-environment.js';
import { createControlPicker } from './control-picking.js';
import { createHardwareInput } from './hardware-input.js';
import { createSliderDrag } from './hardware-slider.js';
import { createRuntimeSession } from './runtime-session.js';
import { createRuntimeInput } from './runtime-input.js';
import { createRuntimeClient } from './runtime-client.js';
import { createRuntimeDisplay } from './runtime-display.js';

const $ = (s) => document.querySelector(s);
const viewport = $('#viewport');
// Session/media belong to the application, never to a replaceable device model.
const runtimeDisplay = createRuntimeDisplay();
const runtimeClient = createRuntimeClient({ video: runtimeDisplay.video });
const runtimeSession = createRuntimeSession(runtimeClient);
const runtimeInput = createRuntimeInput({ send: snapshot => runtimeSession.setController(snapshot) });
const borrowedMedia = new Set([runtimeDisplay.texture]);
const gameButtons = new Set(['up', 'down', 'left', 'right', 'triangle', 'circle', 'cross', 'square', 'l', 'r', 'ps', 'start', 'select']);
const hostState = { hold: false, wlan: false, muted: false, volume: 18, brightnessLevel: 2, displayOff: false };
const finishPicker = mountFinishPicker();
const rememberedFinishes = new Map();
let activeModelId = '3000', activeInstance;
const modelPicker = mountModelPicker(switchModel);
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionQuery.matches;
let renderer, sharedEnvironment;
let contextLost = false;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  RectAreaLightUniformsLib.init();
  sharedEnvironment = createStudioEnvironment(renderer);
} catch {
  $('#loading').hidden = true;
  $('#failure').hidden = false;
  document.querySelectorAll('.bottom-area button').forEach(b => b.disabled = true);
}
if (renderer && sharedEnvironment) switchModel('3000');
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  activeInstance?.dispose(); sharedEnvironment?.dispose(); renderer?.dispose();
  runtimeSession.dispose().catch(console.error).finally(() => runtimeDisplay.dispose());
});

function switchModel(id) {
  if (!renderer || contextLost || (activeInstance && id === activeModelId)) return;
  const model = getModel(id);
  const previous = activeInstance?.snapshot() || {};
  if (activeInstance) rememberedFinishes.set(activeModelId, previous.finishId);
  activeInstance?.dispose();
  activeInstance = null;
  activeModelId = model.id;
  const finishId = rememberedFinishes.get(model.id) || 'black';
  finishPicker.setModel(model.id, finishId);
  modelPicker.update(model.id);
  $('#loading').hidden = false;
  $('#failure').hidden = true;
  try {
    activeInstance = init(model, { ...previous, finishId });
  } catch (error) {
    console.error('PSP model initialization failed', error);
    $('#loading').hidden = true; $('#failure').hidden = false;
    $('#failure strong').textContent = '模型暂时无法载入';
    $('#failure span').textContent = '请重新选择机型，或刷新页面重试。';
  }
}

function init(model, saved = {}) {
  const eventScope = new AbortController();
  let loop, resizeObserver, hoverFrame = 0, hoverEvent, shellFinish;
  let unsubscribeRuntime = () => {}, unsubscribeFrames = () => {};
  const listen = (target, type, handler, options = {}, wake = true) => target.addEventListener(type, event => {
    handler(event);
    if (wake) loop?.invalidate();
  }, { ...options, signal: eventScope.signal });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .98;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  viewport.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  try {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  scene.environment = sharedEnvironment.texture;
  scene.environmentIntensity = .85;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x797979, .65));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
  keyLight.position.set(-5, 10, 12);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, 1.8);
  rimLight.position.set(7, 7, -5);
  scene.add(rimLight);
  // A finite softbox lets metallic base reflections vary across the shell.
  // Replaces the flat fill; no shadow map or extra render pass is required.
  const softLight = new THREE.RectAreaLight(0xffffff, 3, 12, 7);
  softLight.position.set(-7, 6, 10);
  softLight.lookAt(0, 0, 0);
  scene.add(softLight);
  const leftRim = new THREE.DirectionalLight(0xffffff, 1.0);
  leftRim.position.set(-10, 2, -2);
  scene.add(leftRim);

  const device = new THREE.Group();
  scene.add(device);
  let finish = getFinish(saved.finishId, model.id);
  shellFinish = createShellFinish(renderer, finish, model);
  const materials = {
    shell: shellFinish.shell,
    rear: shellFinish.rear,
    core: shellFinish.core,
    trim: new THREE.MeshStandardMaterial({ color: finish.trim, metalness: .94, roughness: .23 }),
    sideFrame: new THREE.MeshStandardMaterial({ color: finish.frame, metalness: .26, roughness: .43, envMapIntensity: .7 }),
    sideSwitch: new THREE.MeshStandardMaterial({ color: '#a7acae', metalness: .16, roughness: .4 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x353a40, metalness: .6, roughness: .24 }),
    black: new THREE.MeshStandardMaterial({ color: 0x070809, roughness: .62, metalness: .03 }),
    button: new THREE.MeshStandardMaterial({ color: finish.button, roughness: .42, metalness: 0 }),
    utility: new THREE.MeshStandardMaterial({ color: finish.utility, roughness: .42, metalness: 0 }),
    keyCrystal: crystalMaterial(.06),
    utilityCrystal: crystalMaterial(.025),
    recess: new THREE.MeshStandardMaterial({ color: finish.recess, roughness: .4, metalness: .05 }),
    shoulder: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: .16, clearcoat: .85, clearcoatRoughness: .09, transmission: .72, thickness: .045, ior: 1.49, envMapIntensity: .55 }),
    shoulderLining: new THREE.MeshStandardMaterial({ color: '#bfc5c8', roughness: .44, metalness: .16 }),
    hole: new THREE.MeshBasicMaterial({ color: 0x050609 }),
  };
  const controls = new Map();
  const labels = [];
  // Only host controls live here. Native core state always comes from session.
  const system = { state: hostState,
    get brightness() { return [.45, .72, 1][hostState.brightnessLevel]; },
    setHold(value) { hostState.hold = Boolean(value); return { message: value ? 'HOLD 已锁定输入' : 'HOLD 已解除' }; },
    setWlan(value) { hostState.wlan = Boolean(value); return { message: value ? 'WLAN 外观开关已打开；网络模拟未启用' : 'WLAN 外观开关已关闭' }; },
  };
  let isOn = runtimeSession.state.status === 'running';
  let soundEnabled = !hostState.muted;
  let autoRotate = saved.autoRotate ?? false;
  let zoom = saved.zoom ?? 1;
  let targetZoom = saved.targetZoom ?? 1;
  let targetX = saved.targetX ?? .08, targetY = saved.targetY ?? -.12, targetZ = saved.targetZ ?? -.018;
  let currentX = saved.currentX ?? targetX, currentY = saved.currentY ?? targetY, currentZ = saved.currentZ ?? targetZ;
  let toastTimer;
  let brightness = system.brightness;
  let hardware;
  let screenDirty = true;
  let lcdVisible = true;
  let lastFrame = performance.now();
  let disposed = false;
  const analogKeys = new Set();
  const pointers = new Map();
  let gesture = null;
  let lastHardwarePointerAt = -Infinity;
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  function extrude(shape, depth, bevel, material, z = 0, parent = device) {
    const bounds = new THREE.Box2().setFromPoints(shape.getPoints(8)).getSize(new THREE.Vector2());
    const size = Math.max(bounds.x, bounds.y);
    const detail = size < .16 ? [2, 4] : size < .75 ? [4, 12] : size < 2.5 ? [6, 24] : [10, 48];
    const raw = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: detail[0], steps: 1, curveSegments: detail[1] });
    const geo = toCreasedNormals(raw, Math.PI / 3);
    if (geo !== raw) raw.dispose();
    // Keep large planar faces planar. Averaging their normals with the bevel
    // makes the triangulation show up as false dents in glossy reflections.
    const positions = geo.getAttribute('position'), normals = geo.getAttribute('normal');
    for (let i = 0; i < positions.count; i++) {
      const pointZ = positions.getZ(i);
      if (Math.abs(pointZ - depth - bevel) < .00001) normals.setXYZ(i, 0, 0, 1);
      else if (Math.abs(pointZ + bevel) < .00001) normals.setXYZ(i, 0, 0, -1);
    }
    normals.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.z = z;
    parent.add(mesh);
    return mesh;
  }
  function roundedBox(w, h, depth, radius, material, x, y, z, parent = device) {
    const bevel = Math.min(.045, depth / 3);
    const mesh = extrude(roundedShape(w, h, radius), depth, bevel, material, z, parent);
    mesh.position.x = x; mesh.position.y = y;
    return mesh;
  }
  function disc(radius, depth, material, x, y, z, parent = device) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, 64), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  function ring(radius, width, material, x, y, z, parent = device) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, width, 12, 96), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  function annulus(inner, outer, material, x, y, z, parent = device) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 128), material);
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function seam(points, radius, material, parent = device) {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(32, points.length * 12), radius, 8, false), material);
    parent.add(mesh); return mesh;
  }
  function surfaceGroup(x, y, z, rx = 0, ry = 0, parent = device) {
    const group = new THREE.Group();
    group.position.set(x, y, z); group.rotation.set(rx, ry, 0); parent.add(group); return group;
  }
  function screw(x, y, z, parent = device, radius = .078) {
    disc(radius * 1.4, .012, materials.recess, x, y, z, parent);
    disc(radius, .017, materials.trim, x, y, z + .007, parent);
    label(radius * 1.5, radius * 1.5, x, y, z + .019, (ctx, w, h) => {
      ctx.strokeStyle = '#171b20'; ctx.lineWidth = w * .17; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(w * .2, h / 2); ctx.lineTo(w * .8, h / 2);
      ctx.moveTo(w / 2, h * .2); ctx.lineTo(w / 2, h * .8); ctx.stroke();
    }, parent);
  }
  function sideMount(side, y, z) {
    return surfaceGroup(side * sideFrameAt(model, y).radius, y, z, 0, side * Math.PI / 2);
  }
  function sidePanel(parent, width, height, radius, depth, material) {
    const mesh = new THREE.Mesh(createSidePanelGeometry(model,
      { width, height, radius, centerY: parent.position.y, depth }), material);
    parent.add(mesh); return mesh;
  }
  function texture(w, h, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    draw(ctx, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }
  function label(w, h, x, y, z, draw, parent = device, recolor = false) {
    const density = Math.max(160, 128 / w, 64 / h);
    const tex = texture(Math.round(w * density), Math.round(h * density), draw);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    if (parent === device && z > .86 && z < .9) {
      // Printed legends follow the moulded surface rather than clipping into it.
      z = Math.max(frontHeight(x - w / 2, y, model.id), frontHeight(x + w / 2, y, model.id), frontHeight(x, y, model.id)) + .009;
    }
    mesh.position.set(x, y, z); parent.add(mesh);
    if (recolor) labels.push({ tex, draw });
    return mesh;
  }
  function textLabel(text, w, h, x, y, z, options = {}, parent = device) {
    return label(w, h, x, y, z, (ctx, cw, ch) => {
      ctx.fillStyle = options.fixedColor || (options.rear ? finish.rearInk : finish.ink);
      ctx.font = `${options.weight || 400} ${ch * (options.size || .64)}px ${options.font || 'Arial'}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, cw / 2, ch / 2, cw * .94);
    }, parent, !options.fixedColor);
  }
  function pspLogo(ctx, cw, ch, color) {
    ctx.save();
    ctx.translate(cw * .06, ch * .22);
    ctx.scale(cw * .88 / 116, ch * .56 / 29);
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineCap = 'square';
    ctx.stroke(new Path2D('M1 27V15H30V2H1M73 2H43V15H73V27H43M85 27V15H115V2H85'));
    ctx.restore();
  }
  function playStationMark(ctx, w, h, color) {
    // PlayStation's own family mark; crop its 64px artboard to the actual glyph.
    // Source: playstation.com/.../pdc.designkit/resources/ps-icons-map__dig__brand.svg
    const scale = Math.min(w / 40.8, h / 31);
    ctx.save(); ctx.translate((w - 40.8 * scale) / 2, (h - 31 * scale) / 2);
    ctx.scale(scale, scale); ctx.translate(-11.7, -17);
    ctx.fillStyle = color;
    ctx.fill(new Path2D('M51.644 40.724a7.479 7.479 0 0 1-2.696 1.696l-13.932 5.136v-3.788l10.172-3.749c1.19-.428 1.371-1.033.405-1.35a7.044 7.044 0 0 0-3.902.202l-6.675 2.47V37.41l.404-.137a17.987 17.987 0 0 1 4.546-1.032 20.626 20.626 0 0 1 9.038 1.08c3.075.976 3.42 2.413 2.64 3.403zm-15.62-6.449v-9.687c0-1.137-.169-2.183-1.232-2.48-.814-.263-.792.497-.792 1.633v24.256l-7-2.077V17a77.512 77.512 0 0 1 8.932 2.471c5.518 1.902 7.388 4.27 7.388 9.603 0 5.198-3.235 7.17-7.297 5.201zm-21.021 9.098c-3.155-.893-3.681-2.751-2.243-3.823a15.37 15.37 0 0 1 3.59-1.733l9.651-3.335v3.801L18.97 40.7c-1.189.428-1.37 1.032-.405 1.35a7.062 7.062 0 0 0 3.903-.202L26 40.674v3.401c-.204.037-.432.073-.643.108-3.468.548-7.015.27-10.355-.81z'), 'evenodd');
    ctx.restore();
  }
  function addControl(name, group, axis = 'z', travel = .07) {
    // A ray can hit the inset print/core through a cap seam. Every layer belongs
    // to this same key; opaque backing must not swallow the click.
    group.traverse(child => { if (child.isMesh) child.userData.control = name; });
    controls.set(name, { group, axis, rest: group.position[axis], travel, pressed: false, until: 0 });
  }

  // The internal support stays inside the separate, satin-finished midframe.
  const backExtension = model.backExtension;
  const housing = getHousingLayers(model);
  for (const [name, material] of [['core', materials.core], ['frame', materials.sideFrame], ['rear', materials.rear]]) {
    const layer = housing[name];
    extrude(layer.shape, layer.depth, layer.bevel, material, layer.z).scale.set(layer.scaleX, layer.scaleY, 1);
  }
  device.add(new THREE.Mesh(createFaceplateGeometry(model.id), materials.shell));
  // The lens is inset into the faceplate rather than a tablet glued on top.
  roundedBox(9.70, 5.58, .018, .045, materials.recess, 0, .23, .782);
  const lensMaterial = new THREE.MeshPhysicalMaterial({ color: 0x050607, roughness: .15, metalness: .02, clearcoat: 1, clearcoatRoughness: .035, envMapIntensity: .4 });
  roundedBox(9.61, 5.48, .012, .03, lensMaterial, 0, .23, .810);

  // Borrow one durable native framebuffer texture across all shell rebuilds.
  const lcdMaterial = new THREE.MeshBasicMaterial({ map: runtimeDisplay.texture, toneMapped: false, color: 0x000000 });
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(9.52, 5.395), lcdMaterial);
  lcd.position.set(0, .23, .836);
  device.add(lcd);
  const glassTexture = texture(512, 300, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(222,235,255,.07)');
    g.addColorStop(.24, 'rgba(222,235,255,.022)');
    g.addColorStop(.245, 'rgba(255,255,255,.004)');
    g.addColorStop(.8, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(180,190,205,.016)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const glassMaterial = new THREE.MeshBasicMaterial({ map: glassTexture, transparent: true, depthWrite: false, toneMapped: false });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(9.52, 5.395), glassMaterial);
  glass.position.copy(lcd.position); glass.position.z += .012;
  device.add(glass);

  label(1.40, .28, model.legacyKeys ? 6.10 : -6.10, model.legacyKeys ? 2.60 : 2.53, .875,
    (ctx, w, h) => drawSonyWordmark(ctx, w, h, finish.ink), device, true);
  if (model.legacyKeys) label(.44, .36, -6.49, 2.55, .875,
    (ctx, w, h) => playStationMark(ctx, w, h, finish.ink), device, true);
  label(2.50, .43, -.03, -3.09, .88, (ctx, w, h) => pspLogo(ctx, w, h, finish.ink), device, true);

  // The d-pad sits in one shallow circular dish. Keys meet at a diamond gap.
  disc(1.24, .025, materials.recess, -6.56, .45, .65);
  const upShape = dpadKey();
  ['up', 'right', 'down', 'left'].forEach((name, i) => {
    const angle = -i * Math.PI / 2;
    const group = new THREE.Group();
    group.position.set(-6.56 + Math.sin(i * Math.PI / 2) * .69, .45 + Math.cos(i * Math.PI / 2) * .69, .775);
    group.rotation.z = angle;
    device.add(group);
    const mesh = extrude(upShape, .145, .025, materials.keyCrystal, 0, group);
    addCapInsert(mesh, materials.button, .90, .52, .006);
    beneathCrystal(label(.29, .26, 0, .12, .104, (ctx, w, h) => {
      ctx.strokeStyle = finish.buttonInk; ctx.lineWidth = w * .075;
      ctx.beginPath(); ctx.moveTo(w * .5, h * .16); ctx.lineTo(w * .85, h * .8);
      ctx.lineTo(w * .15, h * .8); ctx.closePath(); ctx.stroke();
    }, group, true));
    addControl(name, group);
  });

  // Four caps emerge from real holes in the continuously recessed faceplate.
  const faceButtons = ['triangle', 'circle', 'cross', 'square'].map((name, i) => [name, ...frontLayout.face[i]]);
  faceButtons.forEach(([name, x, y]) => {
    disc(.475, .03, materials.recess, x, y, .68);
    const group = new THREE.Group(); group.position.set(x, y, .78); device.add(group);
    const mesh = new THREE.Mesh(roundKeyGeometry(), materials.keyCrystal); group.add(mesh);
    addCapInsert(mesh, materials.button, .90, .50, .004);
    beneathCrystal(label(.42, .42, 0, 0, .106, (ctx, w, h) => {
      ctx.strokeStyle = finish.buttonInk;
      ctx.lineWidth = w * .052; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      if (name === 'triangle') { ctx.moveTo(w / 2, h * .16); ctx.lineTo(w * .84, h * .8); ctx.lineTo(w * .16, h * .8); ctx.closePath(); }
      if (name === 'circle') ctx.arc(w / 2, h / 2, w * .32, 0, Math.PI * 2);
      if (name === 'cross') { ctx.moveTo(w * .22, h * .22); ctx.lineTo(w * .78, h * .78); ctx.moveTo(w * .78, h * .22); ctx.lineTo(w * .22, h * .78); }
      if (name === 'square') ctx.rect(w * .22, h * .22, w * .56, h * .56);
      ctx.stroke();
    }, group, true));
    addControl(name, group);
  });

  // Textured analog nub, with the PSP's dense stippled grip.
  function drawAnalog(ctx, w, h) {
    ctx.fillStyle = finish.analog; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 7) for (let x = 0; x < w; x += 7) {
      const offset = y % 14 ? 3.5 : 0;
      ctx.fillStyle = finish.analogHighlight;
      ctx.beginPath(); ctx.arc(x + offset, y, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = finish.analogShadow;
      ctx.beginPath(); ctx.arc(x + offset + 1.3, y + 1.3, 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  const analogTexture = texture(256, 256, drawAnalog);
  const analogMat = new THREE.MeshStandardMaterial({ map: analogTexture, roughness: .94, metalness: 0 });
  disc(.65, .028, materials.recess, -6.52, -1.83, .72);
  const analogInput = new AnalogStick(.24);
  const analogHome = new THREE.Vector3(-6.52, -1.83, .98);
  const analogGroup = new THREE.Group(); analogGroup.position.copy(analogHome); device.add(analogGroup);
  const analogEdgeMaterial = materials.black.clone();
  analogEdgeMaterial.color.set(finish.analog);
  const analog = disc(.59, .17, analogEdgeMaterial, 0, 0, 0, analogGroup);
  const analogTop = new THREE.Mesh(new THREE.CircleGeometry(.545, 64), analogMat);
  analogTop.position.z = .089; analogGroup.add(analogTop);
  ring(.56, .026, analogEdgeMaterial, 0, 0, .075, analogGroup);
  for (let n = 0; n < 64; n++) {
    const a = n / 64 * Math.PI * 2;
    const grip = roundedBox(.012, .12, .008, .004, analogEdgeMaterial, Math.cos(a) * .58, Math.sin(a) * .58, -.055, analogGroup);
    grip.rotation.set(Math.PI / 2, 0, a - Math.PI / 2);
  }
  // PSP's nub slides across its plane; it does not tilt or click like a modern stick.
  analogGroup.traverse(o => { if (o.isMesh) o.userData.control = 'analog'; });
  const analogPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -analogHome.z);
  const localRay = new THREE.Ray(), inverseDevice = new THREE.Matrix4(), analogPoint = new THREE.Vector3();

  // Small bottom controls, PS key and physical display controls.
  function utility({ name, x, width, height, caption, kind = 'text' }) {
    const socket = extrude(utilityOutline(width + .06, height + .05, model.id), .018, 0, materials.recess, .787);
    socket.position.set(x, utilityY, .787);
    const group = new THREE.Group(); group.position.set(x, utilityY, .840); device.add(group);
    const mesh = new THREE.Mesh(utilityCapGeometry(width, height, model.id), materials.utilityCrystal); group.add(mesh);
    addCapInsert(mesh, materials.utility, .92, .48, .004);
    const legendWidth = kind === 'ps' ? .445 : width * .82;
    const legendHeight = kind === 'ps' ? .338 : height * .57;
    beneathCrystal(label(legendWidth, legendHeight, 0, 0, .044, (ctx, w, h) => {
      ctx.fillStyle = ctx.strokeStyle = finish.utilityInk;
      ctx.lineWidth = 2.4;
      if (kind === 'ps') {
        playStationMark(ctx, w, h, ctx.fillStyle);
      } else if (kind === 'display') {
        ctx.strokeRect(w * .26, h * .25, w * .48, h * .5);
        ctx.beginPath(); ctx.moveTo(w * .16, h * .28); ctx.lineTo(w * .16, h * .72);
        ctx.moveTo(w * .84, h * .28); ctx.lineTo(w * .84, h * .72); ctx.stroke();
      } else {
        ctx.font = `${kind === 'ps' ? 'bold ' : ''}${h * (kind === 'ps' ? .86 : .7)}px Arial`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(caption, w / 2, h * .51);
      }
    }, group, true));
    addControl(name, group, 'z', .025);
  }
  getUtilityKeys(model.id).forEach(utility);
  textLabel('VOL', .55, .2, -3.03, -3.09, .88, { size: .58 });
  // The original 1000 placed the speakers below the LCD; Slim models moved
  // them above it. Only the 3000 has the microphone on the HOME/PS bar.
  for (const x of [-5.61, 5.61]) {
    const y = model.speakerY, speakerHeight = model.id === '1000' ? .22 : .115;
    roundedBox(.29, speakerHeight, .009, speakerHeight / 2, materials.recess, x, y, .872);
    roundedBox(.22, speakerHeight * .57, .008, .03, materials.hole, x, y, .886);
    for (let i = 0; i < 5; i++) roundedBox(.008, speakerHeight * .34, .003, .003, materials.rim, x - .08 + i * .04, y, .893);
  }
  if (model.microphone) {
    annulus(.035, .065, materials.rim, -1.38, -3.08, .878);
    disc(.037, .008, materials.hole, -1.38, -3.08, .88);
  }
  textLabel('POWER', .70, .175, 7.28, -1.27, .876, { size: .70 });
  textLabel('HOLD', .57, .175, 7.24, -2.02, .876, { size: .70 });
  const powerIndicators = createPowerIndicators(device, model.id);
  label(.30, .20, -7.59, -1.26, .876, (ctx, w, h) => {
    ctx.strokeStyle = finish.ink; ctx.lineWidth = w * .075;
    for (let n = 0; n < 3; n++) {
      ctx.beginPath(); ctx.arc(w * .5, h * .85, h * (.2 + n * .23), Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
    }
  }, device, true);
  label(.27, .23, -7.55, -2.01, .876, (ctx, w, h) => {
    ctx.fillStyle = finish.ink;
    ctx.beginPath(); ctx.roundRect(w * .27, h * .16, w * .46, h * .7, 2); ctx.fill();
    ctx.fillStyle = finish.shell;
    for (let i = 0; i < 3; i++) ctx.fillRect(w * (.35 + i * .1), h * .22, w * .05, h * .25);
  }, device, true);
  for (const y of [-1.26, -2.01]) roundedBox(.105, .038, .006, .018, materials.rim, -7.86, y, .879);

  // Separate curved acrylic caps, pale internal supports and narrow assembly gaps.
  for (const [name, sign] of [['L', -1], ['R', 1]]) {
    const group = surfaceGroup(sign * 6.67, 3.15 * model.shellScaleY, -backExtension / 2);
    if (model.id === '1000') group.scale.z = 1.35;
    const mesh = new THREE.Mesh(shoulderShellGeometry(), materials.shoulder);
    mesh.scale.x = sign; group.add(mesh);
    const lining = new THREE.Mesh(shoulderShellGeometry(.075, .025), materials.shoulderLining);
    lining.scale.set(sign * .992, 1, .88); group.add(lining);
    for (const v of [-1, 1]) {
      const edge = Array.from({ length: 45 }, (_, i) => {
        const p = shoulderPoint(i / 44, v, .033); return [sign * p.x, p.y, p.z];
      });
      const lip = seam(edge, .011, materials.shoulderLining, group);
      lip.userData.control = name.toLowerCase();
    }
    // A single moulded letter on the broad top face, never buried in the cap.
    const triggerTop = surfaceGroup(sign * -.10, .387, -.015, -Math.PI / 2, 0, group);
    triggerTop.rotation.z = Math.PI;
    label(.22, .25, 0, 0, .002, (ctx, w, h) => {
      ctx.font = `${h * .86}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(1, h * .025);
      ctx.strokeStyle = finish.shoulderTransmission ? '#788287' : finish.buttonInk;
      ctx.strokeText(name, w / 2, h / 2);
    }, triggerTop, true);
    lining.userData.control = name.toLowerCase();
    addControl(name.toLowerCase(), group, 'y', .055);
  }

  // Top rail: an inset mini-B socket, five contacts and accessory mounting holes.
  const topRail = surfaceGroup(0, 3.56 * model.shellScaleY, -.015 - backExtension / 2, -Math.PI / 2);
  roundedBox(10.50, .68, .016, .03, materials.trim, 0, 0, 0, topRail);
  const usbOutline = new THREE.Shape();
  usbOutline.moveTo(-.39, .17); usbOutline.lineTo(.39, .17); usbOutline.lineTo(.39, -.02);
  usbOutline.lineTo(.27, -.18); usbOutline.lineTo(-.27, -.18); usbOutline.lineTo(-.39, -.02); usbOutline.closePath();
  extrude(usbOutline, .012, .018, materials.recess, .021, topRail);
  const usbLip = new THREE.Shape();
  usbLip.moveTo(-.41, .19); usbLip.lineTo(.41, .19); usbLip.lineTo(.41, -.035);
  usbLip.lineTo(.28, -.20); usbLip.lineTo(-.28, -.20); usbLip.lineTo(-.41, -.035); usbLip.closePath();
  const usbHole = new THREE.Path();
  usbHole.moveTo(-.34, .12); usbHole.lineTo(-.34, -.02); usbHole.lineTo(-.24, -.135);
  usbHole.lineTo(.24, -.135); usbHole.lineTo(.34, -.02); usbHole.lineTo(.34, .12); usbHole.closePath();
  usbLip.holes.push(usbHole);
  extrude(usbLip, .042, .006, materials.trim, .030, topRail);
  roundedBox(.49, .07, .018, .015, materials.black, 0, .055, .041, topRail);
  const contactMaterial = new THREE.MeshStandardMaterial({ color: 0xc9b573, metalness: .82, roughness: .3 });
  for (let i = 0; i < 5; i++) roundedBox(.037, .052, .014, .004, contactMaterial, -.16 + i * .08, .016, .053, topRail);
  for (const sign of [-1, 1]) {
    screw(sign * 1.05, 0, .031, topRail, .084);
    disc(.15, .009, materials.recess, sign * 1.78, 0, .028, topRail);
    annulus(.112, .148, materials.rim, sign * 1.78, 0, .039, topRail);
    disc(.105, .006, materials.hole, sign * 1.78, 0, .04, topRail);
    roundedBox(.10, .16, .012, .018, materials.hole, sign * .63, 0, .025, topRail);
  }
  if (model.infrared) {
    const irMaterial = new THREE.MeshPhysicalMaterial({ color:'#21151b', roughness:.20, clearcoat:.8 });
    roundedBox(1.08, .33, .025, .12, materials.recess, -3.75, 0, .035, topRail);
    roundedBox(.92, .22, .018, .08, irMaterial, -3.75, 0, .059, topRail);
    textLabel('IR', .28, .12, -3.75, 0, .083, {fixedColor:'#bdc0c2'}, topRail);
    const latch = surfaceGroup(3.65, 0, .035, 0, 0, topRail);
    roundedBox(.94, .32, .045, .09, materials.core, 0, 0, 0, latch);
    textLabel('OPEN ▸', .75, .13, 0, .015, .075, {size:.72}, latch);
    addControl('umdOpen', latch, 'x', -.07);
  }
  const wlanMount = model.infrared ? sideMount(-1, 1.40, -.16) : null;
  const wlanGroup = model.infrared
    ? surfaceGroup(0, 0, .012, Math.atan(sideFrameAt(model, 1.40).slope), 0, wlanMount)
    : surfaceGroup(-4.10, .025, .026, 0, 0, topRail);
  if (model.infrared) wlanGroup.rotation.z = Math.PI / 2;
  roundedBox(1.10, .27, .018, .09, materials.recess, 0, 0, 0, wlanGroup);
  const wlanThumb = surfaceGroup(system.state.wlan ? .23 : -.23, 0, 0, 0, 0, wlanGroup);
  roundedBox(.49, .20, .035, .07, materials.button, 0, 0, .021, wlanThumb);
  for (let i = 0; i < 4; i++) roundedBox(.018, .12, .009, .005, materials.rim, -.15 + i * .09, 0, .062, wlanThumb);
  textLabel('WLAN', .66, .15, model.infrared ? 0 : -.75, model.infrared ? .23 : -.055,
    .008, { fixedColor: '#575e65', size: .72 }, wlanGroup);
  textLabel('OFF  ▸  ON', .88, .12, 0, -.23, .005, { fixedColor: '#535960', size: .7 }, wlanGroup);
  addControl('wlan', wlanThumb, 'x', 0);
  wlanGroup.traverse(object => { if (object.isMesh) object.userData.control = 'wlan'; });
  const wlanDrag = createSliderDrag({group:wlanGroup, axis:'x', min:-.23, max:.23});

  // Recess and cap follow the side contour instead of sitting inside the core.
  const powerGroup = sideMount(1, -1.55, .10 - backExtension / 2);
  sidePanel(powerGroup, .48, 1.25, .10, .004, materials.black);
  const powerThumb = surfaceGroup(0, system.state.hold ? -.26 : 0, 0, 0, 0, powerGroup);
  const powerRadius = sideFrameAt(model, powerGroup.position.y).radius;
  let lastPowerThumbY = NaN;
  roundedBox(.34, .43, .025, .065, materials.sideSwitch, 0, 0, .014, powerThumb);
  for (let i = 0; i < 3; i++) roundedBox(.15, .018, .008, .006, materials.rim, 0, -.075 + i * .075, .052, powerThumb);
  addControl('power', powerThumb, 'y', -.27);
  powerGroup.traverse(object => { if (object.isMesh) object.userData.control = 'power'; });
  const powerDrag = createSliderDrag({group:powerGroup, axis:'y', min:-.26, max:.27});
  const powerClickZone = new THREE.Mesh(new THREE.PlaneGeometry(.98, 1.24), new THREE.MeshBasicMaterial({ visible: false }));
  powerClickZone.position.set(7.7, -1.3, .94); powerClickZone.userData.control = 'power'; device.add(powerClickZone);
  const memoryHeight = model.id === '1000' ? 2.04 : 3.45;
  const memoryCover = sideMount(-1, model.id === '1000' ? -.35 : .80, -.015 - backExtension / 2);
  sidePanel(memoryCover, .59, memoryHeight + .045, .055, .005, materials.black);
  sidePanel(memoryCover, .55, memoryHeight, .045, .012, materials.sideFrame);
  const printHeight = model.id === '1000' ? 1.55 : 2.0;
  const memoryPrint = label(.17, printHeight, 0, 0, 0, (ctx, w, h) => {
    ctx.translate(w / 2, h / 2); ctx.rotate(Math.PI / 2);
    ctx.font = `${w * .65}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#30363a'; ctx.fillText('Memory Stick Duo', 0, 0, h * .94);
  }, memoryCover);
  memoryPrint.geometry.dispose();
  memoryPrint.geometry = createSidePanelGeometry(model,
    { width:.17, height:printHeight, radius:0, centerY:memoryCover.position.y, depth:.019 });

  // Bottom rail, AV/headphone recess, barrel power jack and the strap anchor.
  const bottomRail = surfaceGroup(0, -3.56 * model.shellScaleY, -.015 - backExtension / 2, Math.PI / 2);
  roundedBox(11.58, .68, .015, .035, materials.trim, 0, 0, 0, bottomRail);
  screw(-.2, 0, .026, bottomRail, .065);
  roundedBox(1.23, .39, .019, .14, materials.recess, -5.10, -.12, .03, bottomRail);
  annulus(.121, .173, materials.rim, -5.44, -.12, .060, bottomRail);
  disc(.121, .014, materials.hole, -5.44, -.12, .056, bottomRail);
  roundedBox(.51, .22, .013, .04, materials.hole, -4.92, -.12, .055, bottomRail);
  for (let i = 0; i < 6; i++) roundedBox(.028, .085, .006, .003, contactMaterial, -5.10 + i * .069, -.12, .067, bottomRail);
  label(.7, .20, -5.12, .20, .032, (ctx, w, h) => {
    ctx.strokeStyle = '#525a62'; ctx.lineWidth = w * .035;
    ctx.beginPath(); ctx.arc(w * .22, h * .54, h * .28, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#525a62'; ctx.fillRect(w * .1, h * .48, w * .065, h * .30); ctx.fillRect(w * .275, h * .48, w * .065, h * .30);
    if (model.id !== '1000') { ctx.font = `${h * .68}px Arial`; ctx.fillText('AV', w * .45, h * .75); }
  }, bottomRail);
  label(3.25, .35, 1.83, 0, .034, (ctx, w, h) => {
    ctx.fillStyle = '#b8bdc0'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, h * .1); ctx.fill();
    ctx.fillStyle = '#343a40';
    for (let i = 0; i < 90; i++) {
      const width = i % 5 === 0 ? 3 : i % 3 === 0 ? 2 : 1;
      ctx.fillRect(w * .04 + i * w * .005, h * .13, width, h * .68);
    }
    ctx.font = `${h * .30}px Arial`; ctx.textBaseline = 'middle';
    ctx.fillText(`SONY   PSP-${model.id}`, w * .54, h * .38);
    ctx.font = `${h * .22}px Arial`; ctx.fillText('5V  ⎓   PORTABLE ENTERTAINMENT', w * .54, h * .73);
  }, bottomRail);
  const dcGroup = surfaceGroup(6.83, -3.28 * model.shellScaleY, -.02 - backExtension / 2, Math.PI / 2);
  roundedBox(.68, .57, .019, .12, materials.trim, 0, 0, .0, dcGroup);
  const dcInsulator = new THREE.MeshStandardMaterial({ color: 0xc5a235, metalness: .06, roughness: .43 });
  disc(.211, .015, materials.recess, 0, 0, .028, dcGroup);
  annulus(.103, .184, dcInsulator, 0, 0, .046, dcGroup);
  disc(.10, .012, materials.hole, 0, 0, .038, dcGroup);
  disc(.028, .024, contactMaterial, 0, 0, .05, dcGroup);
  textLabel('DC IN 5V', .95, .14, .04, .43, .02, { fixedColor: '#a8afb5', size: .68 }, dcGroup);
  const strap = roundedShape(1.43, .52, .23);
  const strapHole = new THREE.Path(roundedShape(.98, .24, .11).getPoints(32)); strap.holes.push(strapHole);
  const strapMesh = extrude(strap, .86, .035, materials.trim, -.42);
  strapMesh.position.set(-6.72, -3.22, -.42);
  roundedBox(.98, .23, .01, .1, materials.recess, -6.72, -3.22, .48);

  // The central UMD lid is separate from the stationary rear housing.
  const rear = surfaceGroup(0, 0, -.943 - backExtension, 0, Math.PI);
  if (model.id === '1000') {
    // The original shell gains its depth at the two rear grips. The LCD and
    // front controls retain their original size; they are not scaled in Z.
    addOriginalRearGrips(rear, materials.rear, silhouette(model.id));
  }
  const umd = createUmdMechanism({
    rear, materials, roundedBox, disc, ring, annulus, seam, label,
    pspLogo, getFinish: () => finish, textLabel, model,
  });
  const { doorMaterial, inlayMaterial } = umd;
  for (const x of [-3.68, 3.68]) {
    seam([[x, 3.39, -.015], [x, 2.9, .014], [x, -2.9, .014], [x, -3.39, -.015]], .018, materials.recess, rear);
    seam([[x + .032, 3.26, .001], [x + .032, 2.7, .012], [x + .032, -2.7, .012], [x + .032, -3.28, -.002]], .004, materials.rim, rear);
  }
  label(1.00, .20, -4.55, 3.15, .007,
    (ctx, w, h) => drawSonyWordmark(ctx, w, h, finish.rearInk), rear, true);
  for (const y of [2.76, -2.72]) screw(7.38, y, -.012, rear, .079);
  if (model.id === '1000') {
    const release = surfaceGroup(-7.88, .55, .08, 0, 0, rear);
    roundedBox(.21, .86, .03, .08, materials.core, 0, 0, 0, release);
    const push = textLabel('PUSH', .65, .12, 0, 0, .05, {size:.70}, release);
    push.rotation.z = Math.PI / 2;
    addControl('batteryRelease', release, 'z', .025);
  } else {
    const release = sideMount(1, .12, -.55);
    release.position.x += .04;
    const halfMoon = new THREE.Shape();
    halfMoon.moveTo(-.15, -.39); halfMoon.lineTo(-.15, .39);
    halfMoon.bezierCurveTo(.25, .34, .25, -.34, -.15, -.39);
    extrude(halfMoon, .012, .006, materials.recess, 0, release);
    const cap = extrude(halfMoon, .012, .006, materials.button, .012, release);
    cap.scale.set(.83, .82, 1);
    addControl('batteryRelease', release, 'x', .015);
  }

  // Soft suspended-object shadow. The texture remains part of this offline file.
  const shadowMap = texture(512, 128, (ctx, w, h) => {
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(1, .25);
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, w / 2);
    g.addColorStop(0, 'rgba(45,45,45,.22)'); g.addColorStop(.35, 'rgba(45,45,45,.14)'); g.addColorStop(1, 'rgba(45,45,45,0)');
    ctx.fillStyle = g; ctx.fillRect(-w / 2, -w / 2, w, w); ctx.restore();
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(20.2, 2.8), new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false, toneMapped: false, opacity: .65 }));
  shadow.position.set(0, -4.36, -2.5); scene.add(shadow);

  function drawScreen() {
    lcdMaterial.color.setScalar(isOn && !system.state.displayOff ? brightness : 0);
    screenDirty = false;
  }

  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2400);
  }
  function syncSystem(result = {}) {
    brightness = system.brightness;
    if (!isOn || system.state.hold) { analogInput.reset(); analogInput.update(0, true); }
    screenDirty = true; updatePowerState();
    if (result.message) { $('#screen-state').textContent = result.message; toast(result.message); }
    loop?.invalidate();
  }
  function setHold(value) {
    syncSystem(system.setHold(value));
    // Locking never leaves a queued key repeat or a long-press action behind.
    if (value) releaseAll();
  }
  function updatePowerState() {
    const status = runtimeSession.state.status;
    const powerLabel = isOn ? '待机' : status === 'paused' ? '唤醒' : status === 'starting' || status === 'booting' ? '启动中' : status === 'error' ? '重试' : '开机';
    $('#power').setAttribute('aria-pressed', String(isOn)); $('#power').setAttribute('aria-label', powerLabel);
    $('#power-label').textContent = powerLabel;
    $('#status-led').classList.toggle('on', isOn);
    $('#status-label').textContent = status.toUpperCase();
    const descriptions = { off: 'PSP 已关闭。开机连接本机 PPSSPP 原版 XMB。', starting: '正在连接本机 PSP 运行时。', booting: '正在启动原版 XMB。', running: 'PSP 运行中。屏幕和声音来自本机 PPSSPP。', paused: 'PSP 已暂停，上推电源键继续。', error: '运行时连接失败，点击电源重试。' };
    $('#screen-state').textContent = descriptions[status];
    powerIndicators.setOn(isOn);
    powerIndicators.setHold(system.state.hold);
  }
  function updateSound() {
    $('#sound').setAttribute('aria-pressed', String(soundEnabled));
    $('#sound').setAttribute('aria-label', soundEnabled ? '静音 PSP 原生声音' : '开启 PSP 原生声音');
    $('#sound').title = soundEnabled ? '静音 PSP 原生声音' : '开启 PSP 原生声音';
    $('#sound-waves').setAttribute('d', soundEnabled ? 'M15.5 8a6 6 0 0 1 0 8M18.5 5a10 10 0 0 1 0 14' : 'm16 9 5 6m0-6-5 6');
  }
  const controlLabels = {up:'↑',down:'↓',left:'←',right:'→',triangle:'△',circle:'○',cross:'×',square:'□',
    l:'L',r:'R',ps:model.legacyKeys?'HOME':'PS',volumeUp:'音量 +',volumeDown:'音量 −',display:'DISPLAY',note:'♪',
    select:'SELECT',start:'START',power:'POWER',hold:'HOLD',wlan:'WLAN',umd:'UMD',umdOpen:'OPEN',batteryRelease:'电池盖卡扣'};
  function dispatchHardware(name, phase) {
    if (name === 'wlan') {
      if (phase === 'release') syncSystem(system.setWlan(!system.state.wlan));
      return;
    }
    if (phase === 'release') return;
    if (name === 'power') {
      if (system.state.hold) { setHold(false); return; }
      if (!['tap', 'long'].includes(phase)) return;
      releaseAll();
      if (phase === 'long') {
        runtimeSession.stop().then(() => runtimeSession.setPaused('power', false)).catch(reportRuntimeError);
        return;
      }
      const status = runtimeSession.state.status;
      if (status === 'running') runtimeSession.setPaused('power', true).catch(reportRuntimeError);
      else if (status === 'paused') runtimeSession.setPaused('power', false).catch(reportRuntimeError);
      else runtimeSession.setPaused('power', false).then(() => runtimeSession.start()).catch(reportRuntimeError);
      return;
    }
    if (name === 'hold') { setHold(!system.state.hold); return; }
    if (name === 'umd' || name === 'umdOpen') {
      umd.setOpen(name === 'umdOpen' || !umd.isOpen, reducedMotion);
      system.umdOpen = umd.isOpen; screenDirty = true;
      $('#umd-state').textContent = umd.isOpen ? 'UMD 仓已打开。再次点击仓盖可关闭。' : 'UMD 仓已关闭。';
      toast($('#umd-state').textContent + ' 仅机械开合，不改变原生介质。'); return;
    }
    if (name === 'batteryRelease') { toast('电池盖卡扣已按下（暂未模拟拆盖）'); return; }
    if (system.state.hold || !['volumeUp', 'volumeDown', 'display', 'note'].includes(name)) return;
    if (name === 'volumeUp' || name === 'volumeDown') {
      system.state.volume = THREE.MathUtils.clamp(system.state.volume + (name === 'volumeUp' ? 1 : -1), 0, 30);
      sendRuntimeCommand({ type: 'volume', value: system.state.volume / 30 });
      syncSystem({ message: `音量 ${system.state.volume} / 30` });
    } else if (name === 'display') {
      if (phase === 'long') system.state.displayOff = !system.state.displayOff;
      else if (phase === 'tap') { system.state.displayOff = false; system.state.brightnessLevel = (system.state.brightnessLevel + 1) % 3; }
      syncSystem({ message: system.state.displayOff ? '宿主背光已关闭' : `宿主亮度 ${system.state.brightnessLevel + 1} / 3` });
    } else if (name === 'note' && (phase === 'long' || (phase === 'tap' && system.state.muted))) {
      system.state.muted = !system.state.muted; soundEnabled = !system.state.muted;
      sendRuntimeCommand({ type: 'mute', value: system.state.muted }); updateSound();
    }
  }
  function reportRuntimeError(error) { if (!disposed) toast(`PSP 连接失败：${error?.message || error}。点击电源重试。`); }
  function sendRuntimeCommand(command) {
    if (['running', 'paused'].includes(runtimeSession.state.status)) runtimeSession.command(command).catch(reportRuntimeError);
  }
  hardware = createHardwareInput({
    onAction: dispatchHardware,
    onPressed(name, pressed) {
      if (gameButtons.has(name)) {
        const owner = 'hardware:' + name;
        if (!pressed) runtimeInput.release(owner);
        else if (!system.state.hold && runtimeSession.state.status === 'running') {
          runtimeInput.press(name, owner);
          if (system.state.displayOff) { system.state.displayOff = false; screenDirty = true; }
        }
      }
      const control = controls.get(name);
      if (control) { control.pressed = pressed; if (pressed) control.until = performance.now() + 80; }
      const held = Object.keys(controlLabels).filter(key => hardware?.isPressed(key));
      $('#hardware-state').textContent = (controlLabels[name] || name) + (pressed ? ' 按下' : ' 松开') + (held.length ? '；按住：' + held.map(key => controlLabels[key]).join(' + ') : '');
      loop?.invalidate();
    },
  });
  // Accessible page power control has the same short/long semantics as the rail.
  let lastPowerActivation = -Infinity;
  const powerButton = $('#power');
  listen(powerButton, 'pointerdown', event => {
    if (event.button !== 0) return;
    powerButton.setPointerCapture(event.pointerId);
    hardware.press('power', 'toolbar:' + event.pointerId); lastPowerActivation = performance.now();
  });
  listen(powerButton, 'pointerup', event => { hardware.release('toolbar:' + event.pointerId); lastPowerActivation = performance.now(); });
  listen(powerButton, 'pointercancel', event => hardware.cancel('toolbar:' + event.pointerId));
  listen(powerButton, 'lostpointercapture', event => hardware.cancel('toolbar:' + event.pointerId));
  listen(powerButton, 'keydown', event => {
    if (!['Enter',' '].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); hardware.press('power', 'toolbar-key:' + event.code);
  });
  listen(powerButton, 'keyup', event => {
    if (!['Enter',' '].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); hardware.release('toolbar-key:' + event.code); lastPowerActivation = performance.now();
  });
  listen(powerButton, 'click', event => {
    if (event.detail === 0 && performance.now() - lastPowerActivation > 100) {
      hardware.press('power', 'assistive'); hardware.release('assistive');
    }
  });
  function stopRotation() {
    autoRotate = false; $('#rotate').setAttribute('aria-pressed', 'false');
  }
  function setView(view) {
    releaseAll();
    stopRotation();
    const angles = {
      front: [0, 0, 0], back: [-.12, Math.PI + .18, .035],
      top: [1.08, -.04, 0], bottom: [-1.08, .04, 0],
    };
    const [x, desiredY, z] = angles[view] || angles.front;
    targetX = x;
    targetY = currentY + Math.atan2(Math.sin(desiredY - currentY), Math.cos(desiredY - currentY));
    targetZ = z;
    targetZoom = 1;
    for (const [name, id] of Object.entries({front:'front',back:'back',top:'top-view',bottom:'bottom-view'})) {
      $('#' + id).classList.toggle('active', view === name);
      $('#' + id).setAttribute('aria-pressed', String(view === name));
    }
    if (reducedMotion) { currentX = targetX; currentY = targetY; currentZ = targetZ; zoom = targetZoom; }
  }
  function clearPreset() {
    for (const id of ['front', 'back', 'top-view', 'bottom-view']) { $('#' + id).classList.remove('active'); $('#' + id).setAttribute('aria-pressed', 'false'); }
  }
  function setFinish(value) {
    finish = getFinish(value, model.id);
    shellFinish.update(finish, doorMaterial);
    materials.button.color.set(finish.button);
    materials.utility.color.set(finish.utility);
    tintCrystal(materials.keyCrystal, finish.button);
    tintCrystal(materials.utilityCrystal, finish.utility);
    materials.shoulder.color.set(finish.shoulder);
    materials.shoulderLining.color.set(finish.shoulderTransmission ? '#bfc5c8' : finish.shoulder);
    const transmission = finish.shoulderTransmission * .72;
    if (materials.shoulder.transmission !== transmission) {
      materials.shoulder.transmission = transmission;
      materials.shoulder.needsUpdate = true;
    }
    materials.trim.color.set(finish.trim);
    materials.sideFrame.color.set(finish.frame);
    materials.recess.color.set(finish.recess);
    inlayMaterial.color.set(finish.inlay);
    analogMat.color.set(0xffffff);
    analogEdgeMaterial.color.set(finish.analog);
    drawAnalog(analogTexture.image.getContext('2d'), 256, 256); analogTexture.needsUpdate = true;
    for (const { tex, draw } of labels) {
      const ctx = tex.image.getContext('2d'); ctx.clearRect(0, 0, tex.image.width, tex.image.height);
      draw(ctx, tex.image.width, tex.image.height); tex.needsUpdate = true;
    }
    document.dispatchEvent(new CustomEvent('psp-finish-change', {
      detail: { id: finish.id, modelId: model.id, name: finish.name, english: finish.english, swatch: finish.swatch },
    }));
  }

  function returnToDevice(view = 'front') {
    setView(view);
    viewport.focus({ preventScroll: true });
  }
  listen($('#front'), 'click', () => setView('front'));
  listen($('#back'), 'click', () => setView('back'));
  listen($('#top-view'), 'click', () => setView('top'));
  listen($('#bottom-view'), 'click', () => setView('bottom'));
  listen($('.brand'), 'click', e => { e.preventDefault(); returnToDevice('front'); });
  listen($('#rotate'), 'click', () => {
    if (isOn) { toast('运行中可拖动机身查看，自动旋转已暂停'); return; }
    autoRotate = !autoRotate; $('#rotate').setAttribute('aria-pressed', String(autoRotate)); clearPreset();
  });
  listen($('#sound'), 'click', () => {
    soundEnabled = !soundEnabled; system.state.muted = !soundEnabled;
    sendRuntimeCommand({ type: 'mute', value: !soundEnabled }); updateSound();
  });
  listen(document, 'psp-finish-select', event => setFinish(event.detail.id));
  shellFinish.mapGeometry(device, doorMaterial);
  setFinish(finish.id);
  updatePowerState(); updateSound();
  $('#rotate').setAttribute('aria-pressed', String(autoRotate));
  $('#umd-state').textContent = 'UMD 仓已关闭。';
  $('#analog-state').textContent = '摇杆 X 0.00，Y 0.00';
  const analogStateElement = $('#analog-state');
  // Local transforms of the housing and its details never change. Only the
  // device, controls, analog nub and hinged lid need per-frame composition.
  device.traverse(object => { object.updateMatrix(); object.matrixAutoUpdate = false; });
  for (const object of [device, analogGroup, umd.pivot, ...[...controls.values()].map(control => control.group)]) object.matrixAutoUpdate = true;
  const pickControl = createControlPicker(device, raycaster);
  function toggleHelp(force) {
    const open = force ?? $('#help-panel').hidden;
    $('#help-panel').hidden = !open; $('#help').setAttribute('aria-expanded', String(open));
    if (open) $('#close-help').focus(); else $('#help').focus();
  }
  listen($('#help'), 'click', () => toggleHelp());
  listen($('#close-help'), 'click', () => toggleHelp(false));
  listen(document, 'pointerdown', e => {
    if (!$('#help-panel').hidden && !$('#help-panel').contains(e.target) && !$('#help').contains(e.target)) {
      $('#help-panel').hidden = true; $('#help').setAttribute('aria-expanded', 'false');
    }
  });

  function pointerRay(e) {
    const rect = viewport.getBoundingClientRect();
    pointerNdc.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    device.updateWorldMatrix(true, true);
  }
  function pointOnAnalog(e) {
    pointerRay(e);
    inverseDevice.copy(device.matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(inverseDevice);
    return localRay.intersectPlane(analogPlane, analogPoint);
  }
  function hitTest(e) {
    pointerRay(e);
    return pickControl();
  }
  function pinchDistance() {
    const a = [...pointers.values()];
    return a.length > 1 ? Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y) : 0;
  }
  function beginSlider(record) {
    const power = record.hit === 'power';
    record.slider = power ? powerDrag : wlanDrag;
    record.sliderStart = power ? (system.state.hold ? -.26 : 0) : (system.state.wlan ? .23 : -.23);
    record.wasHeld = power && system.state.hold;
    const rail = power ? powerGroup : wlanGroup;
    const origin = rail.localToWorld(new THREE.Vector3()).project(camera);
    const end = rail.localToWorld(new THREE.Vector3(power ? 0 : 1, power ? 1 : 0, 0)).project(camera);
    const rect = viewport.getBoundingClientRect();
    record.sliderAxis = new THREE.Vector2((end.x - origin.x) * rect.width / 2, -(end.y - origin.y) * rect.height / 2);
    record.slider.begin(raycaster.ray, record.sliderStart);
    // An almost edge-on side rail has an unstable ray/plane intersection.
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(rail.matrixWorld);
    record.projectSlider = Math.abs(normal.dot(raycaster.ray.direction)) < .25;
  }
  function moveSlider(record, e) {
    pointerRay(e);
    let value = record.projectSlider ? null : record.slider.move(raycaster.ray);
    if (value === null) {
      const axis = record.sliderAxis;
      if (axis.lengthSq() < 1) return;
      value = record.sliderStart + ((e.clientX - record.startPointerX) * axis.x + (e.clientY - record.startPointerY) * axis.y) / axis.lengthSq();
    }
    record.sliderValue = THREE.MathUtils.clamp(value, record.hit === 'power' ? -.26 : -.23, record.hit === 'power' ? .27 : .23);
    if (record.hit !== 'power') return;
    if (record.consumed) return;
    if (record.sliderValue < -.12) {
      hardware.cancel(record.owner);
      if (!system.state.hold) setHold(true);
    } else {
      if (system.state.hold) setHold(false);
      if (record.sliderValue > .12) hardware.press('power', record.owner);
      else hardware.cancel(record.owner);
    }
  }
  listen(viewport, 'pointerdown', e => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    const hit = hitTest(e);
    // Hardware gestures remain independent: a second button never starts a pinch.
    if (pointers.size && (!hit || !gesture?.hit) && (hit || gesture?.hit)) return;
    if (['analog', 'power', 'wlan'].includes(hit) && [...pointers.values()].some(p => p.hit === hit)) return;
    if (pointers.size >= 5 || (!hit && pointers.size >= 2)) return;
    cancelAnimationFrame(hoverFrame); hoverFrame = 0; hoverEvent = null;
    viewport.focus({ preventScroll: true });
    stopRotation();
    const record = { pointerId: e.pointerId, owner: 'pointer:' + e.pointerId, x: e.clientX, y: e.clientY,
      startPointerX: e.clientX, startPointerY: e.clientY, startX: targetX, startY: targetY, hit, moved: false, floatY: device.position.y };
    pointers.set(e.pointerId, record);
    viewport.setPointerCapture(e.pointerId);
    if (!hit && pointers.size === 2) {
      gesture = { pinching: true, distance: pinchDistance(), zoom: targetZoom, floatY: device.position.y };
      return;
    }
    if (!gesture) gesture = record;
    if (hit) lastHardwarePointerAt = performance.now();
    if (hit) {
      targetX = currentX; targetY = currentY; targetZ = currentZ; targetZoom = zoom;
    }
    if (hit === 'analog') {
      if (system.state.hold || !isOn) return;
      analogKeys.clear(); analogInput.release('keyboard'); runtimeInput.releaseAxis('analog:keyboard');
      const point = pointOnAnalog(e);
      if (point) analogInput.begin(e.pointerId, point.x, point.y);
    } else if (hit) {
      if (hit === 'power' || hit === 'wlan') beginSlider(record);
      if (!record.wasHeld) hardware.press(hit, record.owner);
    }
    viewport.classList.add('dragging');
  });
  listen(viewport, 'pointermove', e => {
    if (!pointers.has(e.pointerId)) {
      if (!gesture) {
        hoverEvent = { clientX: e.clientX, clientY: e.clientY };
        if (!hoverFrame) hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0;
          if (!disposed && !contextLost && hoverEvent) viewport.classList.toggle('over-button', !!hitTest(hoverEvent));
        });
      }
      return;
    }
    loop?.invalidate();
    const record = pointers.get(e.pointerId);
    record.x = e.clientX; record.y = e.clientY;
    if (!gesture) return;
    if (gesture.pinching) {
      if (pointers.size === 2) targetZoom = THREE.MathUtils.clamp(gesture.zoom * pinchDistance() / Math.max(1, gesture.distance), .7, 1.65);
      return;
    }
    if (record.hit === 'analog') {
      const point = pointOnAnalog(e);
      if (point && analogInput.move(e.pointerId, point.x, point.y)) sendAnalog('analog:pointer:' + e.pointerId);
      return;
    }
    const dx = e.clientX - record.startPointerX, dy = e.clientY - record.startPointerY;
    if (Math.hypot(dx, dy) > 4) record.moved = true;
    if (record.slider && record.moved) { moveSlider(record, e); return; }
    if (record.hit) return;
    if (record.moved) {
      clearPreset();
      targetY = record.startY + dx * .008;
      targetX = THREE.MathUtils.clamp(record.startX + dy * .006, -1.15, 1.15);
      targetZ *= .96;
      if (reducedMotion) { currentX = targetX; currentY = targetY; currentZ = targetZ; }
    }
  }, {}, false);
  listen(viewport, 'pointerleave', () => {
    cancelAnimationFrame(hoverFrame); hoverFrame = 0; hoverEvent = null;
    viewport.classList.remove('over-button');
  }, {}, false);
  function endPointer(e, cancelled = false) {
    const record = pointers.get(e.pointerId);
    if (!record) return;
    pointers.delete(e.pointerId);
    if (record.hit) lastHardwarePointerAt = performance.now();
    if (record.hit === 'analog') {
      analogInput.release(e.pointerId);
      runtimeInput.releaseAxis('analog:pointer:' + e.pointerId);
    }
    if (cancelled) hardware.cancel(record.owner);
    else if (record.hit === 'wlan' && record.moved) {
      hardware.cancel(record.owner);
      syncSystem(system.setWlan((record.sliderValue ?? record.sliderStart) > 0));
    } else if (record.hit === 'power' && record.wasHeld && !record.moved) setHold(false);
    else hardware.release(record.owner);
    record.slider?.reset();
    if (gesture?.pointerId === e.pointerId || gesture?.pinching) {
      gesture = [...pointers.values()][0] || null;
      if (gesture && !gesture.hit) {
        gesture.startPointerX = gesture.x; gesture.startPointerY = gesture.y;
        gesture.startX = targetX; gesture.startY = targetY;
      }
    }
    if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    if (!pointers.size) { gesture = null; viewport.classList.remove('dragging'); }
  }
  listen(viewport, 'pointerup', e => endPointer(e));
  listen(viewport, 'pointercancel', e => endPointer(e, true));
  listen(viewport, 'lostpointercapture', e => endPointer(e, true));
  listen(viewport, 'wheel', e => {
    e.preventDefault();
    if (!gesture?.hit) targetZoom = THREE.MathUtils.clamp(targetZoom * Math.exp(-e.deltaY * .00065), .7, 1.65);
  }, { passive: false });
  listen(viewport, 'dblclick', e => {
    // An opening lid can move away from the second click; remember the first.
    if (performance.now() - lastHardwarePointerAt < 650) return;
    if (!hitTest(e)) setView('front');
  });
  const keyMap = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', w: 'up', s: 'down', a: 'left', d: 'right', x: 'cross', o: 'circle', i: 'triangle', j: 'square', q: 'l', e: 'r', p: 'power', u: 'umd', home: 'ps',
    enter:'start', backspace:'select', '-':'volumeDown', '=':'volumeUp', '+':'volumeUp', b:'display', n:'note', v:'wlan', h:'hold' };
  function moveAnalogWithKeys() {
    if (!analogKeys.size) { analogInput.release('keyboard'); runtimeInput.releaseAxis('analog:keyboard'); return; }
    if (system.state.hold || !isOn) return;
    if (analogInput.pointerId === null) {
      analogInput.update(0, true);
      analogInput.begin('keyboard', 0, 0);
    }
    analogInput.move('keyboard',
      (Number(analogKeys.has('arrowright')) - Number(analogKeys.has('arrowleft'))) * analogInput.radius,
      (Number(analogKeys.has('arrowup')) - Number(analogKeys.has('arrowdown'))) * analogInput.radius);
    sendAnalog('analog:keyboard');
  }
  function sendAnalog(owner) {
    if (!system.state.hold && isOn) runtimeInput.setAxis(owner, analogInput.x / analogInput.radius, analogInput.y / analogInput.radius);
  }
  listen(window, 'keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (e.key === 'Enter' && e.target.closest('button,a,[role="button"]')) return;
    if (e.key === 'Escape') { if (!$('#help-panel').hidden) toggleHelp(false); else setView('front'); return; }
    const key = e.key.toLowerCase(), name = keyMap[key];
    if (e.shiftKey && key.startsWith('arrow')) {
      e.preventDefault();
      hardware.cancel('key:' + (e.code || key));
      if (analogInput.pointerId !== null && analogInput.pointerId !== 'keyboard') return;
      analogKeys.add(key); moveAnalogWithKeys(); return;
    }
    if (!name) return;
    e.preventDefault();
    if (e.repeat) return;
    if (name === 'umd' && !umd.isOpen) setView('back');
    hardware.press(name, 'key:' + (e.code || key));
  });
  listen(window, 'keyup', e => {
    if (e.key === 'Shift') { analogKeys.clear(); analogInput.release('keyboard'); runtimeInput.releaseAxis('analog:keyboard'); }
    else if (analogKeys.delete(e.key.toLowerCase())) { moveAnalogWithKeys(); }
    hardware.release('key:' + (e.code || e.key.toLowerCase()));
  });
  function releaseAll() {
    cancelAnimationFrame(hoverFrame); hoverFrame = 0; hoverEvent = null;
    hardware?.cancelAll();
    runtimeInput.clear();
    for (const c of controls.values()) { c.pressed = false; c.until = 0; }
    powerDrag.reset(); wlanDrag.reset();
    analogInput.reset();
    analogKeys.clear();
    const captured = [...pointers.keys()];
    pointers.clear(); gesture = null; viewport.classList.remove('dragging');
    for (const id of captured) if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
  }
  listen(window, 'blur', releaseAll);
  listen(motionQuery, 'change', e => { reducedMotion = e.matches; screenDirty = true; if (reducedMotion) stopRotation(); });
  let baseDistance = 28;
  let lastWidth = 0, lastHeight = 0;
  function resize() {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (w <= 0 || h <= 0 || (w === lastWidth && h === lastHeight)) return;
    lastWidth = w; lastHeight = h;
    // Supersample even at DPR 1: MSAA alone misses narrow glossy highlights.
    // Bound both the pixel budget and the GPU renderbuffer dimensions.
    const maxDimension = renderer.capabilities.maxTextureSize;
    const ratio = Math.min(2, Math.sqrt(4_000_000 / Math.max(1, w * h)), maxDimension / w, maxDimension / h);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h); camera.aspect = w / h;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const mobile = w < 760;
    baseDistance = Math.max(17.8 / (2 * tan * camera.aspect * (mobile ? .92 : .82)), 7.8 / (2 * tan * (mobile ? .86 : .85)));
    camera.position.set(0, mobile ? -.03 : .15, baseDistance / zoom);
    camera.lookAt(0, mobile ? -.03 : .15, 0);
    camera.updateProjectionMatrix();
    loop?.invalidate();
  }
  resizeObserver = new ResizeObserver(resize); resizeObserver.observe(viewport); resize();
  drawScreen(performance.now());
  $('#loading').hidden = true;

  const screenNormal = new THREE.Vector3(), viewDirection = new THREE.Vector3();
  // Preserve the subtle float at 30 fps. Gestures and moving hardware run at
  // display refresh rate; a reduced-motion still scene does no idle GPU work.
  function frame(now) {
    if (disposed || contextLost) return Infinity;
    const dt = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now;
    hardware.update(now);
    let moving = hardware.isActive;
    if (autoRotate && !gesture && !reducedMotion) { targetY += dt * .24; moving = true; }
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 10);
    function approach(value, target, factor = ease) {
      if (Math.abs(target - value) < .0001) return target;
      moving = true;
      return value + (target - value) * factor;
    }
    currentX = approach(currentX, targetX); currentY = approach(currentY, targetY); currentZ = approach(currentZ, targetZ);
    zoom = approach(zoom, targetZoom);
    device.rotation.set(currentX, currentY, currentZ);
    device.position.y = gesture ? gesture.floatY : reducedMotion ? 0 : Math.sin(now * .00065) * .065;
    shadow.material.opacity = .64 - (reducedMotion ? 0 : Math.sin(now * .00065) * .025);
    for (const [name, c] of controls) {
      let target = c.rest - (c.pressed || now < c.until ? c.travel : 0);
      if (name === 'power' || name === 'wlan') {
        const drag = [...pointers.values()].find(p => p.hit === name && p.moved);
        target = drag?.sliderValue ?? (name === 'wlan' ? (system.state.wlan ? .23 : -.23) : system.state.hold ? -.26 : c.pressed ? .27 : 0);
      }
      c.group.position[c.axis] = approach(c.group.position[c.axis], target, reducedMotion ? 1 : 1 - Math.exp(-dt * 24));
      if (now < c.until) moving = true;
    }
    if (lastPowerThumbY !== powerThumb.position.y) {
      const powerSurface = sideFrameAt(model, powerGroup.position.y + powerThumb.position.y);
      powerThumb.position.z = powerSurface.radius - powerRadius;
      powerThumb.rotation.x = Math.atan(powerSurface.slope);
      lastPowerThumbY = powerThumb.position.y;
    }
    analogInput.update(dt, reducedMotion);
    umd.update(dt, reducedMotion);
    if (analogInput.x !== 0 || analogInput.y !== 0 || umd.isAnimating) moving = true;
    // Leave room for the open cover's depth while preserving the user's zoom.
    camera.position.z = baseDistance / zoom * (1 + Math.sin(umd.pivot.rotation.x) * .28);
    analogGroup.position.x = analogHome.x + analogInput.x;
    analogGroup.position.y = analogHome.y + analogInput.y;
    const analogState = `摇杆 X ${(analogInput.x / analogInput.radius).toFixed(2)}，Y ${(analogInput.y / analogInput.radius).toFixed(2)}`;
    if (analogStateElement.textContent !== analogState) analogStateElement.textContent = analogState;
    screenNormal.set(0, 0, 1).applyQuaternion(device.quaternion);
    viewDirection.copy(camera.position).sub(device.position);
    const screenVisible = screenNormal.dot(viewDirection) > 0;
    lcdVisible = screenVisible;
    lcd.visible = screenVisible;
    if (screenDirty) drawScreen();
    renderer.render(scene, camera);
    if (moving || gesture) return 0;
    if (!reducedMotion) return 1000 / 30;
    return Infinity;
  }
  loop = createRenderLoop(frame);
  unsubscribeFrames = runtimeDisplay.onFrame(() => {
    if (!disposed && isOn && lcdVisible && !system.state.displayOff && !document.hidden) loop.invalidate();
  });
  let previousRuntimeStatus;
  unsubscribeRuntime = runtimeSession.subscribe(state => {
    const wasOn = isOn; isOn = state.status === 'running';
    if (wasOn && !isOn) releaseAll();
    if (isOn && !wasOn) stopRotation();
    if (isOn && previousRuntimeStatus !== 'running') {
      sendRuntimeCommand({ type: 'volume', value: system.state.volume / 30 });
      sendRuntimeCommand({ type: 'mute', value: system.state.muted });
    }
    if (state.status === 'error' && previousRuntimeStatus !== 'error') reportRuntimeError(state.error || '本机运行时未连接');
    previousRuntimeStatus = state.status;
    screenDirty = true; updatePowerState(); loop.invalidate();
  });
  listen(document, 'visibilitychange', () => {
    loop.suspend(); releaseAll();
    runtimeSession.setPaused('visibility', document.hidden).catch(reportRuntimeError);
    if (!document.hidden && !disposed && !contextLost) { lastFrame = performance.now(); screenDirty = true; loop.resume(); }
  });
  listen(renderer.domElement, 'webglcontextlost', e => {
    e.preventDefault(); contextLost = true; loop.suspend(); releaseAll(); $('#failure').hidden = false;
    $('#failure strong').textContent = '3D 画面已暂停';
    $('#failure span').textContent = '正在等待显卡连接恢复。';
  });
  listen(renderer.domElement, 'webglcontextrestored', () => {
    try {
      sharedEnvironment?.dispose(); sharedEnvironment = null;
      sharedEnvironment = createStudioEnvironment(renderer);
      scene.environment = sharedEnvironment.texture;
      contextLost = false; screenDirty = true; lastFrame = performance.now();
      $('#failure').hidden = true;
      if (!document.hidden && !disposed) loop.resume();
    } catch (error) {
      console.error('PSP graphics recovery failed', error);
      $('#failure').hidden = false;
      $('#failure span').textContent = '显卡资源暂时不足，请刷新页面重试。';
    }
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    releaseAll(); eventScope.abort();
    unsubscribeRuntime(); unsubscribeFrames();
    loop.dispose(); resizeObserver.disconnect();
    clearTimeout(toastTimer); $('#toast').classList.remove('visible');
    viewport.classList.remove('over-button', 'dragging');
    disposeSceneResources(scene, shellFinish.resources, borrowedMedia);
    renderer.renderLists.dispose();
  }
  listen(window, 'pagehide', event => {
    if (event.persisted) { loop.suspend(); releaseAll(); }
    else dispose();
  });
  listen(window, 'pageshow', () => {
    if (!disposed && !contextLost && !document.hidden) { lastFrame = performance.now(); screenDirty = true; loop.resume(); }
  });
  if (document.hidden) loop.suspend(); else loop.invalidate();
  return { dispose, setFinish,
    snapshot: () => ({finishId:finish.id, autoRotate,
      zoom, targetZoom, targetX, targetY, targetZ, currentX, currentY, currentZ}),
  };
  } catch (error) {
    eventScope.abort(); loop?.dispose(); resizeObserver?.disconnect(); cancelAnimationFrame(hoverFrame);
    unsubscribeRuntime(); unsubscribeFrames(); runtimeInput.clear();
    disposeSceneResources(scene, shellFinish?.resources ?? [], borrowedMedia); renderer.renderLists.dispose();
    throw error;
  }
}
