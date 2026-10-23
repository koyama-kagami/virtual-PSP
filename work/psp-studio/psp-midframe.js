import * as THREE from 'three';
import { getModel } from './models.js';
import { silhouette } from './psp-shapes.js';
import { withUmdOpening } from './psp-umd.js';

const contours = new Map();
const resolveModel = model => typeof model === 'string' ? getModel(model) : model;

/** Centimetres; these are the structural layers, not decorative surface strips. */
export function getHousingLayers(model) {
  model = resolveModel(model);
  const extension = model.backExtension;
  const layer = (depth, bevel, z, scaleX = 1, scaleY = 1) => ({
    shape:withUmdOpening(silhouette(model.id), scaleX, scaleY),
    depth, bevel, z, scaleX, scaleY,
  });
  return {
    core:layer(.72 + extension, .09, -.36 - extension),
    // The original PSP's extra depth belongs mainly to its rear housing,
    // not to a thicker middle stripe. Centre this band between the shells.
    frame:layer(.58, .10, -.30 - extension / 2),
    rear:layer(.27, .22, -.71 - extension, .99, .98),
  };
}

function frameContour(model) {
  model = resolveModel(model);
  if (contours.has(model.id)) return contours.get(model.id);
  const spec = getHousingLayers(model).frame;
  // Extract the actual full-width bevel ring once. Using the un-bevelled
  // silhouette (or a fixed x offset) puts side controls inside the housing.
  // Only the complete outer ring is needed: one bevel step and no internal
  // UMD walls produce the same XY ring as the full ten-step body extrusion.
  const geometry = new THREE.ExtrudeGeometry(silhouette(model.id), {
    depth:.01, bevelEnabled:true, bevelThickness:spec.bevel,
    bevelSize:spec.bevel, bevelSegments:1, curveSegments:48, steps:1,
  });
  const edges = new Map();
  let minY = Infinity, maxY = -Infinity;
  try {
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i += 3) {
      for (const [a,b] of [[i,i+1],[i+1,i+2],[i+2,i]]) {
        if (Math.abs(positions.getZ(a)) > 1e-7 || Math.abs(positions.getZ(b)) > 1e-7) continue;
        const ax=positions.getX(a), ay=positions.getY(a), bx=positions.getX(b), by=positions.getY(b);
        if (Math.hypot(bx-ax,by-ay) < 1e-8) continue;
        const first=`${ax},${ay}`, second=`${bx},${by}`;
        const key = first < second ? `${first}:${second}` : `${second}:${first}`;
        if (edges.has(key)) continue;
        edges.set(key, {ax,ay,bx,by});
        minY=Math.min(minY,ay,by); maxY=Math.max(maxY,ay,by);
      }
    }
  } finally { geometry.dispose(); }
  const contour = {edges:[...edges.values()], minY, maxY};
  if (!contour.edges.length) throw new Error('The PSP frame has no mounting contour');
  contours.set(model.id, contour);
  return contour;
}

function radiusAt(contour, y) {
  if (!Number.isFinite(y) || y < contour.minY || y > contour.maxY) {
    throw new RangeError('Side panel extends beyond the PSP frame');
  }
  let radius = -Infinity;
  for (const {ax,ay,bx,by} of contour.edges) {
    if (y < Math.min(ay,by)-1e-9 || y > Math.max(ay,by)+1e-9) continue;
    const dy=by-ay;
    if (Math.abs(dy) < 1e-9) {
      if (Math.abs(y-ay) < 1e-9) radius=Math.max(radius,ax,bx);
    } else {
      radius=Math.max(radius,ax+(bx-ax)*(y-ay)/dy);
    }
  }
  if (!(radius > 0)) throw new RangeError('No outer PSP frame surface at this height');
  return radius;
}

/** Positive side radius and dx/dy, valid for either symmetric side at world z=0. */
export function sideFrameAt(model, y) {
  const contour=frameContour(model);
  const radius=radiusAt(contour,y);
  // A tiny centred derivative avoids stepping normals at tessellation vertices.
  const below=Math.max(contour.minY,y-.005), above=Math.min(contour.maxY,y+.005);
  const slope=(radiusAt(contour,above)-radiusAt(contour,below))/(above-below);
  return {radius,slope};
}

/**
 * Rounded side skin in mount-local coordinates. Mount at sideFrameAt(centerY)
 * and rotate around Y by +/- PI/2: x spans body thickness, y follows the grip,
 * and +z points outwards. Depth is a radial offset, not an extrusion thickness.
 */
export function createSidePanelGeometry(model, {width,height,radius,centerY,depth}) {
  if (![width,height,radius,centerY,depth].every(Number.isFinite)
      || width <= 0 || height <= 0 || radius < 0 || radius > Math.min(width,height)/2) {
    throw new RangeError('Invalid PSP side panel dimensions');
  }
  const center=sideFrameAt(model,centerY).radius;
  // Validate the complete extent before allocating buffers or constructing rows.
  sideFrameAt(model,centerY-height/2); sideFrameAt(model,centerY+height/2);
  const rows=Math.max(2,Math.ceil(height/.045)), columns=Math.max(2,Math.ceil(width/.05));
  const positions=[], normals=[], uv=[], indices=[], rings=[];
  for(let row=0;row<=rows;row++){
    const y=-height/2+height*row/rows;
    const cap=Math.max(0,Math.abs(y)-(height/2-radius));
    const halfWidth=width/2-radius+Math.sqrt(Math.max(0,radius*radius-cap*cap));
    const sample=sideFrameAt(model,centerY+y), length=Math.hypot(sample.slope,1);
    const ring=[], count=halfWidth < 1e-8 ? 1 : columns+1;
    for(let col=0;col<count;col++){
      const x=count === 1 ? 0 : -halfWidth+2*halfWidth*col/columns;
      ring.push(positions.length/3);
      positions.push(x,y,sample.radius-center+depth);
      normals.push(0,-sample.slope/length,1/length);
      uv.push(x/width+.5,y/height+.5);
    }
    rings.push(ring);
  }
  for(let row=0;row<rows;row++){
    const lower=rings[row], upper=rings[row+1];
    if(lower.length === 1){
      for(let col=0;col<columns;col++) indices.push(lower[0],upper[col+1],upper[col]);
    }else if(upper.length === 1){
      for(let col=0;col<columns;col++) indices.push(lower[col],lower[col+1],upper[0]);
    }else{
      for(let col=0;col<columns;col++){
        const a=lower[col], b=lower[col+1], c=upper[col], d=upper[col+1];
        indices.push(a,b,c,b,d,c);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
