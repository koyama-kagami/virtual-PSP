// Overall dimensions from Sony specifications. Small detail coordinates are
// photograph-based reconstructions; see ../psp-reference-study/legacy-model-sources.md.
const MODELS = {
  '1000': { id: '1000', width: 17.0, height: 7.4, depth: 2.3,
    shellScaleX: 170 / 169.4, shellScaleY: 74 / 71.4, backExtension: .22,
    legacyKeys: true, microphone: false, infrared: true, speakerY: -2.70,
    rearRingInner: 1.90, rearRingOuter: 2.61, rearMatte: true },
  '2000': { id: '2000', width: 16.94, height: 7.14, depth: 1.86,
    shellScaleX: 1, shellScaleY: 1, backExtension: 0,
    legacyKeys: true, microphone: false, infrared: false, speakerY: 2.10,
    rearRingInner: 1.90, rearRingOuter: 2.61, rearMatte: false },
  '3000': { id: '3000', width: 16.94, height: 7.14, depth: 1.86,
    shellScaleX: 1, shellScaleY: 1, backExtension: 0,
    legacyKeys: false, microphone: true, infrared: false, speakerY: 2.10,
    rearRingInner: 2.460, rearRingOuter: 2.600, rearMatte: false },
};

export function getModel(id = '3000') { return MODELS[id] || MODELS['3000']; }
