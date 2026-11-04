/** Character customisation: options, saved look, compact string for multiplayer, and applying it to a rig */
const KEY = 'realmrange.look.v1';
const PAL = [0x3a424c, 0x2b2d30, 0x6b7a52, 0x8a7a50, 0x7d8288, 0xd8d8d8, 0x93402f, 0x3b6a8c, 0xffc247, 0x7a3b8c, 0x1e5a3a, 0xc3662a];
const UNI = [0xffffff, ...PAL];
const SKIN = [0xf1c9a5, 0xd9a47c, 0xc29a78, 0x8d6a52, 0x6b4a35, 0x3d2a1e];
const ACC = [0x4aa8ff, 0xff4636, 0x5dff9a, 0xffc247, 0xd05bff, 0xffffff, 0xff7ac8, 0x2fe0d0];

export const OPTIONS = [
  { k: 'camo', label: 'Uniform pattern', vals: ['Grey camo', 'Green camo', 'Tan camo', 'Solid'] },
  { k: 'uni', label: 'Uniform tint', pal: UNI },
  { k: 'vest', label: 'Vest', pal: PAL },
  { k: 'helmetStyle', label: 'Headwear', vals: ['Helmet', 'Cap', 'Beanie', 'None'] },
  { k: 'helmet', label: 'Headwear color', pal: PAL },
  { k: 'mask', label: 'Face cover', vals: ['None', 'Balaclava', 'Bandana'] },
  { k: 'visor', label: 'Visor', pal: ACC },
  { k: 'skin', label: 'Skin', pal: SKIN },
  { k: 'glove', label: 'Gloves', pal: PAL },
  { k: 'boots', label: 'Boots', pal: PAL },
  { k: 'pack', label: 'Backpack', vals: ['None', 'Small', 'Large'] },
  { k: 'packc', label: 'Pack color', pal: PAL },
  { k: 'patch', label: 'Accent', pal: ACC },
];
const OPT = {};
for (const o of OPTIONS) OPT[o.k] = o;
export const DEFAULT = { camo: 0, uni: 0, vest: 0, helmetStyle: 0, helmet: 0, mask: 0, visor: 0, skin: 2, glove: 1, boots: 1, pack: 0, packc: 2, patch: 0 };
export const toHex = (n) => '#' + n.toString(16).padStart(6, '0');
const size = (o) => (o.vals ? o.vals.length : o.pal.length);

export const look = { ...DEFAULT };
try {
  const s = JSON.parse(localStorage.getItem(KEY) || '{}');
  for (const o of OPTIONS) if (Number.isInteger(s[o.k]) && s[o.k] >= 0 && s[o.k] < size(o)) look[o.k] = s[o.k];
} catch (_) {}

export function setLook(k, v) {
  look[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch (_) {}
}
/** '0.0.2...' sent to the server so other players see you */
export const lookString = () => OPTIONS.map((o) => look[o.k]).join('.');
export function decodeLook(str) {
  const p = String(str || '').split('.').map(Number), L = { ...DEFAULT };
  OPTIONS.forEach((o, i) => { if (Number.isInteger(p[i]) && p[i] >= 0 && p[i] < size(o)) L[o.k] = p[i]; });
  return L;
}

const CAMOS = ['camoGrey', 'camoGreen', 'camoTan'];
/** multiply two 0xRRGGBB colours channel by channel */
const mulHex = (a, b) => (((a >> 16) & 255) * ((b >> 16) & 255) / 255 << 16) | (((a >> 8) & 255) * ((b >> 8) & 255) / 255 << 8) | ((a & 255) * (b & 255) / 255);

/** first-person hands keep the model's own (light) skin colours; this tints them to the chosen skin tone */
function bareHand(col, hex) {
  col.setHex(hex);
  col.r = Math.min(1, col.r / 0.89);
  col.g = Math.min(1, col.g / 0.67);
  col.b = Math.min(1, col.b / 0.51);
}

/** the Rifleman model: one whole-body tint, plus the helmet and the beard can be switched off */
function applySkinLook(s, L) {
  s.mat.color.setHex(mulHex(s.baseTint, UNI[L.uni]));
  if (s.hat) s.hat.visible = L.helmetStyle === 0;
  if (s.beard) s.beard.visible = L.mask === 0;
}

/** works on a humanoid or the viewmodel (the viewmodel only has sleeves + gloves) */
export function applyLook(root, L, tex) {
  const u = root.userData, m = u.mats, p = u.parts;
  if (u.skin) { applySkinLook(u.skin, L); return; }
  if (!m) return;
  const c = (k) => OPT[k].pal[L[k]];
  m.uni.map = L.camo < 3 ? tex[CAMOS[L.camo]] : null;
  m.uni.color.setHex(c('uni'));
  m.uni.needsUpdate = true;
  if (u.bareHands) bareHand(m.glove.color, c('skin'));
  else m.glove.color.setHex(c('glove'));
  if (!m.vest) return;
  m.vest.color.setHex(c('vest'));
  m.helmet.color.setHex(c('helmet'));
  m.skin.color.setHex(c('skin'));
  m.boot.color.setHex(c('boots'));
  m.pack.color.setHex(c('packc'));
  m.lens.color.setHex(c('visor'));
  m.lens.emissive.setHex(c('visor'));
  m.patch.color.setHex(c('patch'));
  const show = (arr, on) => arr.forEach((o) => { o.visible = on; });
  show(p.helmet, L.helmetStyle === 0);
  show(p.cap, L.helmetStyle === 1);
  show(p.beanie, L.helmetStyle === 2);
  show(p.balaclava, L.mask === 1);
  show(p.bandana, L.mask === 2);
  show(p.packS, L.pack === 1);
  show(p.packL, L.pack === 2);
}
