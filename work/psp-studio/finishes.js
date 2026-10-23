// PSP-3000 colour families, including regional releases. Material RGB values
// are visual approximations from product photographs, not Sony paint codes.
// Source inventory: ../psp-reference-study/colour-sources.md
import { getPaintProfile } from './paint-profiles.js';

const base = {
  group: '单色', trim: '#bec3c7', frame: '#747a7f', inlay: '#cfd5db',
  ...getPaintProfile('piano-black'),
  ink: '#d6dde4', buttonInk: '#d6dde4',
};
const finish = (id, name, english, shell, options = {}) => {
  const palette = {
    ...base, id, name, english, swatch: shell, shell, rear: shell,
    button: shell, core: shell, recess: '#161b22',
    shoulder: '#ffffff', shoulderTransmission: 1,
    analog: shell, analogHighlight: '#7e8b96', analogShadow: '#12171c',
    ...options,
  };
  return { ...palette, utility: options.utility ?? palette.button,
    utilityInk: options.utilityInk ?? palette.buttonInk,
    rearInk: options.rearInk ?? palette.ink };
};
const black = finish('black', '钢琴黑', 'Piano Black', '#101215', {
  frame: '#b5babe',
  ...getPaintProfile('piano-black'),
  rear: '#060709', button: '#08090b', core: '#121417', recess: '#020304',
  analog: '#1c1e21', analogHighlight: '#4b4e52', analogShadow: '#08090a',
  ink: '#b4b9bd', buttonInk: '#c5c9ce',
});
const white = finish('white', '珍珠白', 'Pearl White', '#e0e0d7', {
  ...getPaintProfile('pearl-white'),
  rear: '#d7d9d1', button: '#cbd0ca', core: '#b2b7b3', recess: '#76817f',
  analog: '#bfc1b9', analogHighlight: '#e1e3db', analogShadow: '#9da299',
  ink: '#5c6266', buttonInk: '#5d666c',
});
const blue = finish('blue', '跃动蓝', 'Vibrant Blue', '#0065b9', {
  ...getPaintProfile('vibrant-blue'),
  rear: '#0063b1', button: '#065caa', core: '#124c84', recess: '#103356',
  analog: '#145594', analogHighlight: '#4c82b0', analogShadow: '#08355e',
});
const red = finish('red', '艳光红', 'Radiant Red', '#c41435', {
  ...getPaintProfile('radiant-red'),
  rear: '#bb1230', button: '#b0102a', core: '#801429', recess: '#490d1b',
  analog: '#971a32', analogHighlight: '#bd4b5d', analogShadow: '#5d1020',
});

export const FINISHES = [
  black, white,
  finish('silver', '神秘银', 'Mystic Silver', '#adb5bd', {
    ...getPaintProfile('mystic-silver'),
    rear: '#9ba4ad', button: '#929da8', core: '#626e79', recess: '#57616a',
    analog: '#89939c', analogHighlight: '#c6cbd0', analogShadow: '#626b73',
    ink: '#424b53', buttonInk: '#37424d',
  }),
  blue, red,
  finish('yellow', '明亮黄', 'Bright Yellow', '#efb900', {
    ...getPaintProfile('bright-yellow'),
    rear: '#e4ae00', button: '#dfab08', core: '#997c12', recess: '#6f5916',
    analog: '#c19a14', analogHighlight: '#e3c75c', analogShadow: '#8c7114',
    ink: '#62521a', buttonInk: '#62521a',
  }),
  finish('green', '活泼绿', 'Spirited Green', '#007d57', {
    ...getPaintProfile('spirited-green'),
    rear: '#007650', button: '#076b4c', core: '#175441', recess: '#103b2e',
    analog: '#1c624b', analogHighlight: '#59917b', analogShadow: '#174232',
  }),
  finish('pink', '樱花粉', 'Blossom Pink', '#df8fb7', {
    ...getPaintProfile('blossom-pink'),
    rear: '#ce7ca5', button: '#cd81a8', core: '#9c6584', recess: '#855a71',
    analog: '#ba789c', analogHighlight: '#e5b8d0', analogShadow: '#945b7b',
    ink: '#714d66', buttonInk: '#69435c',
  }),
  finish('turquoise', '松石绿', 'Turquoise Green', '#75c6bd', {
    ...getPaintProfile('turquoise-green'),
    rear: '#63b5ad', button: '#62b4aa', core: '#498e87', recess: '#426f6b',
    analog: '#5ba49d', analogHighlight: '#b2dcd6', analogShadow: '#447d78',
    ink: '#426b68', buttonInk: '#3e625f',
  }),
  finish('lilac', '丁香紫', 'Lilac Purple', '#b4a4ce', {
    ...getPaintProfile('lilac-purple'),
    rear: '#a695c0', button: '#a492c1', core: '#807298', recess: '#696079',
    analog: '#9583af', analogHighlight: '#d3c8e2', analogShadow: '#746589',
    ink: '#5f536e', buttonInk: '#5a4c6a',
  }),
  { ...black, ...getPaintProfile('piano-black'), id: 'black-red', name: '黑 / 红', english: 'Black / Red', group: '双色',
    swatch: 'linear-gradient(135deg,#15171b 50%,#c41435 50%)',
    rear: red.rear, rearFinish: 'red', rearPaint: 'radiant-red', button: red.button, shoulder: red.shell, shoulderTransmission: 0,
    rearInk: '#d6dde4',
  },
  { ...white, ...getPaintProfile('pearl-white'), id: 'white-blue', name: '白 / 蓝', english: 'White / Blue', group: '双色',
    swatch: 'linear-gradient(135deg,#e0e0d7 50%,#0065b9 50%)',
    rear: blue.rear, rearFinish: 'blue', rearPaint: 'vibrant-blue', button: blue.button, shoulder: blue.shell, shoulderTransmission: 0,
    ink: '#1b588f', buttonInk: '#d1deee', utilityInk: '#1b588f', rearInk: '#d6dde4',
  },
  { ...red, ...getPaintProfile('metallic-red'), id: 'red-black', name: '红 / 黑', english: 'Red / Black', group: '双色',
    swatch: 'linear-gradient(135deg,#c41435 50%,#15171b 50%)',
    rear: '#171b21', rearFinish: 'black', rearPaint: 'metallic-black', button: black.button, shoulder: black.shell, shoulderTransmission: 0,
    rearInk: '#8b2535',
  },
  finish('sky-marine', '天蓝 / 海蓝', 'Sky Blue / Marine Blue', '#22ade0', {
    ...getPaintProfile('sky-blue'),
    group: '双色', swatch: 'linear-gradient(135deg,#22ade0 50%,#1241ad 50%)',
    rear: '#1241ad', rearFinish: 'blue', rearPaint: 'marine-blue', button: '#154797', core: '#3e869e', recess: '#396481',
    shoulder: '#1241ad', shoulderTransmission: 0, utility: '#269fc8',
    analog: '#289ac1', analogHighlight: '#7cc9dc', analogShadow: '#1f728d',
    ink: '#d5e5f2', buttonInk: '#d5e5f2',
  }),
];

// Earlier generations use their own release colours, not aliases for the
// PSP-3000 Carnival range. RGB values remain photo-based approximations.
const ceramicWhite = { ...white, ...getPaintProfile('ceramic-white'), name: '陶瓷白', english: 'Ceramic White',
  shell: '#e5e5df', rear: '#deded7', button: '#d9dcd6', utility: '#d9dcd6' };
const metallicBlue = finish('metallic-blue', '金属蓝', 'Metallic Blue', '#174d8f', {
  ...getPaintProfile('metallic-blue'),
  rear: '#174581', button: '#1b4475', utility: '#1b4475', core: '#16345b',
  analog: '#1c3f6a', analogHighlight: '#627fa0', analogShadow: '#122b4b',
});
const silver1000 = { ...FINISHES[2], ...getPaintProfile('silver-1000'), name: '银色', english: 'Silver', shell: '#aeb4b8', rear: '#9ba3a7' };
const gold1000 = finish('champagne-gold', '香槟金', 'Champagne Gold', '#c6b793', {
  ...getPaintProfile('champagne-gold'),
  rear: '#b9aa87', button: '#bdad8b', core: '#9e906f', utility: '#bdad8b',
  analog: '#ac9b78', analogHighlight: '#d4c8af', analogShadow: '#817354',
  ink: '#5f594b', buttonInk: '#5f594b',
});
const FINISHES_1000 = [
  { ...black, ...getPaintProfile('piano-black'), name: '黑色', english: 'Black' }, ceramicWhite,
  finish('pink', '粉红', 'Pink', '#df6e9d', {
    ...getPaintProfile('pink-1000'),
    rear: '#ca668f', button: '#d8759d', core: '#a9577c', utility: '#d8759d',
    analog: '#c96b95', analogHighlight: '#ecabc7', analogShadow: '#9c4c73',
    ink: '#72445e', buttonInk: '#72445e',
  }),
  silver1000, metallicBlue, gold1000,
];
const FINISHES_2000 = [
  black, ceramicWhite,
  { ...FINISHES[2], ...getPaintProfile('ice-silver'), name: '冰银', english: 'Ice Silver', shell: '#b7bec5', rear: '#aab2bb' },
  finish('rose-pink', '玫瑰粉', 'Rose Pink', '#e9b4c8', {
    ...getPaintProfile('rose-pink'),
    rear: '#d9a6bb', button: '#d8a5bb', core: '#b38b9f', utility: '#d8a5bb',
    analog: '#c79caf', analogHighlight: '#f0d3dd', analogShadow: '#a77991',
    ink: '#7c606f', buttonInk: '#7c606f',
  }),
  finish('lavender-purple', '薰衣草紫', 'Lavender Purple', '#b5aec8', {
    ...getPaintProfile('lavender-purple'),
    rear: '#a49bb8', button: '#a89fbb', core: '#867e9a', utility: '#a89fbb',
    analog: '#9b92ae', analogHighlight: '#d9d1e8', analogShadow: '#756b8b',
    ink: '#60596d', buttonInk: '#60596d',
  }),
  finish('felicia-blue', '晴空蓝', 'Felicia Blue', '#93b5d4', {
    ...getPaintProfile('felicia-blue'),
    rear: '#82a6c6', button: '#89abc9', core: '#6888a5', utility: '#89abc9',
    analog: '#7a9ebf', analogHighlight: '#c1d5e8', analogShadow: '#567e9c',
    ink: '#46647f', buttonInk: '#46647f',
  }),
  finish('mint-green', '薄荷绿', 'Mint Green', '#b7d6cc', {
    ...getPaintProfile('mint-green'),
    rear: '#a5c7bc', button: '#abcbbf', core: '#82a799', utility: '#abcbbf',
    analog: '#9cbbaf', analogHighlight: '#d1e7de', analogShadow: '#74998b',
    ink: '#54796b', buttonInk: '#54796b',
  }),
  finish('deep-red', '深红', 'Deep Red', '#9b1b30', {
    ...getPaintProfile('deep-red'),
    group: '限定纯色', rear: '#8a172c', button: '#8e1b2e', core: '#601d2b', utility: '#8e1b2e',
    analog: '#861e30', analogHighlight: '#b45765', analogShadow: '#571420',
  }),
  finish('matte-bronze', '哑光古铜', 'Matte Bronze', '#84745d', {
    ...getPaintProfile('matte-bronze'),
    group: '限定纯色', rear: '#776850', button: '#7b6a53', core: '#5e5343', utility: '#7b6a53',
    analog: '#6c5d49', analogHighlight: '#a39581', analogShadow: '#4c4336',
  }),
  { ...metallicBlue, ...getPaintProfile('metallic-blue'), group: '限定纯色' },
];

export function getFinishes(modelId = '3000') {
  return ({ '1000': FINISHES_1000, '2000': FINISHES_2000, '3000': FINISHES })[modelId] || FINISHES;
}
export function getFinish(id, modelId = '3000') {
  const catalog = getFinishes(modelId);
  return catalog.find(finish => finish.id === id) || catalog[0];
}
