import * as THREE from 'three';

/** One decoder and texture survive every cosmetic model rebuild. */
export function createRuntimeDisplay() {
  const video=document.createElement('video');
  video.autoplay=true; video.muted=true; video.playsInline=true;
  const texture=new THREE.VideoTexture(video);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=THREE.LinearFilter; texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=false;
  const listeners=new Set(); let handle, disposed=false;
  const frame=()=>{if(disposed)return; for(const fn of listeners)fn(); handle=video.requestVideoFrameCallback?.(frame);};
  if(video.requestVideoFrameCallback) handle=video.requestVideoFrameCallback(frame);
  else video.addEventListener('timeupdate',frame);
  return {video,texture,onFrame(fn){listeners.add(fn);return()=>listeners.delete(fn);},dispose(){
    if(disposed)return; disposed=true; listeners.clear();
    if(handle!==undefined)video.cancelVideoFrameCallback?.(handle);
    video.removeEventListener('timeupdate',frame); video.pause(); video.srcObject=null; texture.dispose();
  }};
}
