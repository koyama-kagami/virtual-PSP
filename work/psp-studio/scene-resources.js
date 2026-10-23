/** Release scene-owned assets; application-owned media must be explicitly borrowed. */
export function disposeSceneResources(scene, extraResources = [], borrowedResources = new Set()) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value);
      }
    }
  });
  const released = new Set();
  for (const set of [geometries, materials, textures, new Set(extraResources)]) {
    for (const resource of set) {
      if (borrowedResources.has(resource) || released.has(resource)) continue;
      resource.dispose(); released.add(resource);
    }
  }
  scene.environment = null;
  scene.clear();
}
