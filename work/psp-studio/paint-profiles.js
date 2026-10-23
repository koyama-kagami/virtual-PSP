// Photo-calibrated rendering profiles, not measured Sony paint formulations.
// Pigment/flakes sit below a separate, smooth dielectric lacquer layer.
const lacquer = { mapFamily:'lacquer', roughness:.24, metalness:0, clearcoat:.95,
  clearcoatRoughness:.10, normalTexture:.16, coatTexture:.12, envMapIntensity:.95 };
const metallic = { ...lacquer, mapFamily:'metallic', roughness:.29, metalness:.60,
  clearcoat:.9, clearcoatRoughness:.12, normalTexture:.48, coatTexture:.15, envMapIntensity:1.0 };
const pearl = { ...lacquer, mapFamily:'pearl', roughness:.31, metalness:.19,
  clearcoat:.80, clearcoatRoughness:.15, normalTexture:.32, coatTexture:.16, envMapIntensity:.9 };
const profiles = {
  'piano-black': { ...lacquer, roughness:.22, clearcoat:.98, clearcoatRoughness:.075, normalTexture:.10, coatTexture:.07 },
  'pearl-white': { ...pearl, roughness:.30, metalness:.14, clearcoatRoughness:.14 },
  'ceramic-white': { ...lacquer, roughness:.25, clearcoat:.9, clearcoatRoughness:.11 },
  'mystic-silver': { ...metallic, roughness:.34, metalness:.82, clearcoat:.60, clearcoatRoughness:.19, normalTexture:.35 },
  'ice-silver': { ...metallic, roughness:.29, metalness:.80, clearcoat:.70, clearcoatRoughness:.16, normalTexture:.32 },
  'silver-1000': { ...metallic, roughness:.33, metalness:.75, clearcoat:.64, clearcoatRoughness:.18, normalTexture:.37 },
  'vibrant-blue': { ...metallic, roughness:.27, metalness:.54, clearcoat:.95, clearcoatRoughness:.105 },
  'radiant-red': { ...metallic, roughness:.28, metalness:.56, clearcoat:.96, clearcoatRoughness:.11 },
  'bright-yellow': { ...metallic, roughness:.30, metalness:.38, clearcoat:.90, clearcoatRoughness:.13, normalTexture:.37 },
  'spirited-green': { ...metallic, roughness:.28, metalness:.52, clearcoat:.94, clearcoatRoughness:.115 },
  'blossom-pink': { ...pearl, roughness:.30, metalness:.10, normalTexture:.24 },
  'turquoise-green': { ...lacquer, roughness:.28, clearcoat:.83, clearcoatRoughness:.13, normalTexture:.20 },
  'lilac-purple': { ...lacquer, roughness:.29, clearcoat:.82, clearcoatRoughness:.14, normalTexture:.19 },
  'pink-1000': { ...lacquer, roughness:.27, clearcoat:.86, clearcoatRoughness:.12 },
  'metallic-blue': { ...metallic, roughness:.28, metalness:.66, clearcoat:.90, clearcoatRoughness:.115, normalTexture:.52 },
  'champagne-gold': { ...metallic, roughness:.34, metalness:.70, clearcoat:.66, clearcoatRoughness:.18, normalTexture:.38 },
  'rose-pink': { ...pearl, metalness:.20, roughness:.32 },
  'lavender-purple': { ...pearl, metalness:.22, roughness:.32, clearcoatRoughness:.145 },
  'felicia-blue': { ...pearl, metalness:.24, roughness:.30, clearcoatRoughness:.14 },
  'mint-green': { ...pearl, metalness:.17, roughness:.32, normalTexture:.27 },
  'deep-red': { ...metallic, roughness:.27, metalness:.64, clearcoat:.94, clearcoatRoughness:.10 },
  'matte-bronze': { ...metallic, mapFamily:'matte', roughness:.55, metalness:.64,
    clearcoat:.12, clearcoatRoughness:.40, normalTexture:.50, coatTexture:.18, envMapIntensity:.85 },
  'metallic-red': { ...metallic, roughness:.28, metalness:.62, clearcoat:.94, clearcoatRoughness:.105 },
  'metallic-black': { ...metallic, roughness:.29, metalness:.48, clearcoat:.88,
    clearcoatRoughness:.12, normalTexture:.39, envMapIntensity:1.05 },
  'sky-blue': { ...lacquer, roughness:.24, metalness:.08, clearcoat:.92, clearcoatRoughness:.11 },
  'marine-blue': { ...lacquer, roughness:.25, metalness:.13, clearcoat:.94, clearcoatRoughness:.105 },
};

export function getPaintProfile(id) {
  if (!profiles[id]) throw new RangeError(`Unknown PSP paint profile: ${id}`);
  return { ...profiles[id], paint:id };
}
