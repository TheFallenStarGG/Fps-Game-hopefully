/** Character customisation for the Rifleman model (+ procedural fallback + viewmodel hands). */
const KEY = 'realmrange.look.v2';

const PAL = [0x3a424c, 0x2b2d30, 0x6b7a52, 0x8a7a50, 0x7d8288, 0xd8d8d8, 0x93402f, 0x3b6a8c, 0xffc247, 0x7a3b8c, 0x1e5a3a, 0xc3662a];
const UNI = [0xffffff, ...PAL];
const SKIN = [0xf1c9a5, 0xd9a47c, 0xc29a78, 0x8d6a52, 0x6b4a35, 0x3d2a1e];
const ACC = [0x4aa8ff, 0xff4636, 0x5dff9a, 0xffc247, 0xd05bff, 0xffffff, 0xff7ac8, 0x2fe0d0];

/** Height scale multipliers (index → scale). */
const HEIGHT_SCALE = [0.88, 0.94, 1.0, 1.06, 1.12];
/** Figure / build: narrow → broad (X/Z scale). */
const FIGURE_SCALE = [0.90, 0.95, 1.0, 1.05, 1.10];

export const OPTIONS = [
  { k: 'gender', label: 'Gender', vals: ['Male', 'Female'] },
  { k: 'height', label: 'Height', vals: ['Short', 'Below average', 'Average', 'Tall', 'Very tall'] },
  { k: 'figure', label: 'Build', vals: ['Slim', 'Lean', 'Average', 'Athletic', 'Heavy'] },
  { k: 'skin', label: 'Skin tone', pal: SKIN },
  { k: 'uni', label: 'Uniform color', pal: UNI },
  { k: 'helmetStyle', label: 'Helmet', vals: ['On', 'Off'] },
  { k: 'mask', label: 'Facial hair', vals: ['Beard', 'Clean-shaven'] },
  { k: 'glove', label: 'Gloves (1st person)', pal: PAL },
  { k: 'patch', label: 'Accent', pal: ACC },
  // Kept for procedural fallback / older saves (hidden in UI when on Rifleman if you filter — still in string)
  { k: 'camo', label: 'Uniform pattern', vals: ['Grey camo', 'Green camo', 'Tan camo', 'Solid'], hidden: true },
  { k: 'vest', label: 'Vest', pal: PAL, hidden: true },
  { k: 'helmet', label: 'Headwear color', pal: PAL, hidden: true },
  { k: 'visor', label: 'Visor', pal: ACC, hidden: true },
  { k: 'boots', label: 'Boots', pal: PAL, hidden: true },
  { k: 'pack', label: 'Backpack', vals: ['None', 'Small', 'Large'], hidden: true },
  { k: 'packc', label: 'Pack color', pal: PAL, hidden: true },
];

const OPT = {};
for (const o of OPTIONS) OPT[o.k] = o;

export const DEFAULT = {
  gender: 0, height: 2, figure: 2, skin: 2, uni: 0, helmetStyle: 0, mask: 0, glove: 1, patch: 0,
  camo: 0, vest: 0, helmet: 0, visor: 0, boots: 1, pack: 0, packc: 2,
};

export const toHex = (n) => '#' + n.toString(16).padStart(6, '0');
const size = (o) => (o.vals ? o.vals.length : o.pal.length);

export const look = { ...DEFAULT };
try {
  const raw = localStorage.getItem(KEY) || localStorage.getItem('realmrange.look.v1') || '{}';
  const s = JSON.parse(raw);
  for (const o of OPTIONS) {
    if (Number.isInteger(s[o.k]) && s[o.k] >= 0 && s[o.k] < size(o)) look[o.k] = s[o.k];
  }
} catch (_) {}

export function setLook(k, v) {
  look[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch (_) {}
}

/** Compact string for multiplayer (order = OPTIONS). */
export const lookString = () => OPTIONS.map((o) => look[o.k]).join('.');

export function decodeLook(str) {
  const p = String(str || '').split('.').map(Number);
  const L = { ...DEFAULT };
  OPTIONS.forEach((o, i) => {
    if (Number.isInteger(p[i]) && p[i] >= 0 && p[i] < size(o)) L[o.k] = p[i];
  });
  return L;
}

const CAMOS = ['camoGrey', 'camoGreen', 'camoTan'];
const mulHex = (a, b) =>
  ((((a >> 16) & 255) * ((b >> 16) & 255) / 255) << 16) |
  ((((a >> 8) & 255) * ((b >> 8) & 255) / 255) << 8) |
  (((a & 255) * (b & 255) / 255) | 0);

function bareHand(col, hex) {
  col.setHex(hex);
  col.r = Math.min(1, col.r / 0.89);
  col.g = Math.min(1, col.g / 0.67);
  col.b = Math.min(1, col.b / 0.51);
}

/**
 * Rifleman: single atlas material + optional hat/beard meshes.
 * Gender/height/build → scale. Skin tones the material toward chosen skin.
 * Helmet / facial hair → mesh visibility.
 */
function applySkinLook(s, L) {
  const skinHex = SKIN[L.skin] ?? SKIN[2];
  const uniHex = UNI[L.uni] ?? 0xffffff;
  // Uniform-driven tint with a pull toward skin tone so "Skin" is visible on the model
  const base = mulHex(s.baseTint, uniHex);
  const mixed = mulHex(base, skinHex);
  // Bias toward uniform so camo/cloth still reads (60% uni-mix, 40% skin pull already in mul)
  s.mat.color.setHex(mixed);
  s.mat.needsUpdate = true;

  // Helmet: On = visible
  if (s.hat) s.hat.visible = (L.helmetStyle ?? 0) === 0;

  // Beard: only on male + "Beard" selected (female defaults clean)
  if (s.beard) {
    const female = (L.gender ?? 0) === 1;
    s.beard.visible = !female && (L.mask ?? 0) === 0;
  }

  // Body scale: height (Y) + gender/build (X/Z)
  const h = HEIGHT_SCALE[L.height ?? 2] ?? 1;
  const fig = FIGURE_SCALE[L.figure ?? 2] ?? 1;
  const genderXZ = (L.gender ?? 0) === 1 ? 0.92 : 1.0; // female slightly narrower
  const sx = genderXZ * fig;
  const sy = h;
  const sz = genderXZ * fig;

  const target = s.model || s.root;
  if (target && target.scale) {
    target.scale.set(sx, sy, sz);
  }
}

/** Procedural humanoid / viewmodel path (old soldier). */
function applyProcedural(root, L, tex) {
  const u = root.userData, m = u.mats, p = u.parts;
  if (!m) return;
  const c = (k) => OPT[k].pal[L[k]];
  if (m.uni) {
    m.uni.map = L.camo < 3 && tex ? tex[CAMOS[L.camo]] : null;
    m.uni.color.setHex(c('uni'));
    m.uni.needsUpdate = true;
  }
  if (u.bareHands && m.glove) bareHand(m.glove.color, c('skin'));
  else if (m.glove) m.glove.color.setHex(c('glove'));
  if (!m.vest) return;
  m.vest.color.setHex(c('vest'));
  if (m.helmet) m.helmet.color.setHex(c('helmet'));
  if (m.skin) m.skin.color.setHex(c('skin'));
  if (m.boot) m.boot.color.setHex(c('boots'));
  if (m.pack) m.pack.color.setHex(c('packc'));
  if (m.patch) m.patch.color.setHex(c('patch'));
  if (m.lens) m.lens.color.setHex(c('visor'));
  const show = (mesh, on) => { if (mesh) mesh.visible = !!on; };
  if (p) {
    show(p.helmet, L.helmetStyle === 0);
    show(p.cap, L.helmetStyle === 1);
    show(p.beanie, L.helmetStyle === 2);
    show(p.bala, L.mask === 1);
    show(p.band, L.mask === 2);
    show(p.packS, L.pack === 1);
    show(p.packL, L.pack === 2);
  }
}

/** Apply look to a humanoid root or viewmodel. */
export function applyLook(root, L, tex) {
  if (!root) return;
  const u = root.userData || {};
  if (u.skin) {
    applySkinLook(u.skin, L || look);
    // Viewmodel gloves still use glove/skin
    if (u.bareHands && u.mats && u.mats.glove) {
      bareHand(u.mats.glove.color, SKIN[(L || look).skin] ?? SKIN[2]);
    } else if (u.mats && u.mats.glove && OPT.glove) {
      u.mats.glove.color.setHex(OPT.glove.pal[(L || look).glove] ?? OPT.glove.pal[0]);
    }
    return;
  }
  applyProcedural(root, L || look, tex);
}

/** Options shown in the Character menu (hide procedural-only extras on rifleman builds). */
export function menuOptions(isRifleman) {
  if (!isRifleman) return OPTIONS.filter((o) => !o.hidden);
  return OPTIONS.filter((o) => !o.hidden);
}
