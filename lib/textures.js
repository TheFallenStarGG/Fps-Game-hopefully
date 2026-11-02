/** Procedural textures — painted on canvases at startup, no downloads.
 *  createTextures({ res, aniso }): res = resolution multiplier (0.5 low, 1 default, 2 high, 3 ultra). */
import * as THREE from 'three';

let K = 1; // resolution multiplier
let D = 1; // detail multiplier (amount of fine strokes / specks)
let A = 8; // anisotropy

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** canvas of logical size w x h, drawn in logical units, stored at k x resolution */
function cv(w, h = w, k = K) {
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(w * k));
  c.height = Math.max(16, Math.round(h * k));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.scale(c.width / w, c.height / h);
  return [c, x];
}

// draw a shape at 9 offsets so textures tile seamlessly
const wrap = (S, fn) => {
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
};

function grain(x, amt, r) {
  const w = x.canvas.width, h = x.canvas.height;
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
}

function blob(x, S, px, py, rad, col, a) {
  wrap(S, (ox, oy) => {
    const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rad);
    g.addColorStop(0, `rgba(${col},${a})`);
    g.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = g;
    x.fillRect(px + ox - rad, py + oy - rad, rad * 2, rad * 2);
  });
}

function grassCanvas() {
  const S = 512, r = rng(7), [c, x] = cv(S);
  x.fillStyle = '#41602f';
  x.fillRect(0, 0, S, S);
  const cols = ['82,116,57', '53,80,42', '98,114,58', '91,90,58', '47,71,36'];
  for (let i = 0; i < 46; i++) blob(x, S, r() * S, r() * S, 30 + r() * 90, cols[(r() * cols.length) | 0], 0.55);
  const bl = ['#6f9448', '#557a36', '#7ea04f', '#3d5c2b', '#8a9a4e', '#2c441f'];
  x.lineWidth = 1.2;
  x.lineCap = 'round';
  const n = Math.round(6000 * D);
  for (let i = 0; i < n; i++) {
    const px = r() * S, py = r() * S, len = 4 + r() * 9, ang = -Math.PI / 2 + (r() - 0.5) * 1.3;
    x.strokeStyle = bl[(r() * bl.length) | 0];
    x.globalAlpha = 0.35 + r() * 0.4;
    const draw = (ox, oy) => {
      x.beginPath();
      x.moveTo(px + ox, py + oy);
      x.lineTo(px + ox + Math.cos(ang) * len, py + oy + Math.sin(ang) * len);
      x.stroke();
    };
    if (px < 14 || py < 14 || px > S - 14 || py > S - 14) wrap(S, draw);
    else draw(0, 0);
  }
  x.globalAlpha = 1;
  grain(x, 22, r);
  return c;
}

function concreteCanvas() {
  const S = 512, r = rng(21), [c, x] = cv(S);
  x.fillStyle = '#8b8d8a';
  x.fillRect(0, 0, S, S);
  const cols = ['170,172,168', '110,112,108', '95,97,93'];
  for (let i = 0; i < 60; i++) blob(x, S, r() * S, r() * S, 20 + r() * 70, cols[(r() * 3) | 0], 0.28);
  const pits = Math.round(520 * D);
  for (let i = 0; i < pits; i++) {
    x.fillStyle = `rgba(40,40,40,${0.2 + r() * 0.25})`;
    x.beginPath();
    x.arc(r() * S, r() * S, 0.6 + r() * 1.6, 0, 7);
    x.fill();
  }
  x.strokeStyle = 'rgba(30,30,30,.45)';
  x.lineWidth = 1;
  for (let k = 0; k < 6; k++) {
    let px = r() * S, py = r() * S;
    x.beginPath();
    x.moveTo(px, py);
    for (let i = 0; i < 40; i++) {
      px += (r() - 0.4) * 14;
      py += (r() - 0.5) * 14;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const px = r() * S, w = 6 + r() * 12, len = 120 + r() * 200;
    const g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(30,30,30,.16)');
    g.addColorStop(1, 'rgba(30,30,30,0)');
    x.fillStyle = g;
    x.fillRect(px, 0, w, len);
  }
  grain(x, 34, r);
  return c;
}

function woodCanvas() {
  const S = 512, r = rng(3), [c, x] = cv(S);
  const ph = S / 4;
  for (let i = 0; i < 4; i++) {
    const b = 130 + ((r() * 30) | 0);
    x.fillStyle = `rgb(${b + 30},${b - 10},${b - 55})`;
    x.fillRect(0, i * ph, S, ph);
    const lines = Math.round(45 * D);
    for (let k = 0; k < lines; k++) {
      let yy = i * ph + r() * ph;
      x.strokeStyle = `rgba(60,35,15,${0.08 + r() * 0.18})`;
      x.lineWidth = 0.6 + r() * 1.4;
      x.beginPath();
      x.moveTo(0, yy);
      for (let px = 0; px <= S; px += 32) {
        yy += (r() - 0.5) * 2.2;
        x.lineTo(px, yy);
      }
      x.stroke();
    }
    if (r() < 0.7) {
      const kx = r() * S, ky = i * ph + ph * (0.3 + 0.4 * r());
      x.strokeStyle = 'rgba(50,28,12,.35)';
      for (let q = 5; q > 0; q--) {
        x.beginPath();
        x.ellipse(kx, ky, q * 3.5, q * 1.6, 0, 0, 7);
        x.stroke();
      }
    }
    x.fillStyle = 'rgba(20,12,6,.8)';
    x.fillRect(0, i * ph, S, 3);
  }
  x.fillStyle = 'rgba(55,35,18,.55)';
  x.fillRect(0, 0, 34, S);
  x.fillRect(S - 34, 0, 34, S);
  for (let i = 0; i < 4; i++) {
    for (const nx of [17, S - 17]) {
      x.fillStyle = '#2b2b2b';
      x.beginPath(); x.arc(nx, i * ph + ph / 2, 3.5, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,255,255,.3)';
      x.beginPath(); x.arc(nx - 1, i * ph + ph / 2 - 1, 1.2, 0, 7); x.fill();
    }
  }
  grain(x, 24, r);
  return c;
}

function metalCanvas() {
  const S = 512, r = rng(33), [c, x] = cv(S);
  x.fillStyle = '#9fa3a6';
  x.fillRect(0, 0, S, S);
  for (let px = 0; px < S; px += 32) {
    const g = x.createLinearGradient(px, 0, px + 32, 0);
    g.addColorStop(0, 'rgba(255,255,255,.32)');
    g.addColorStop(0.5, 'rgba(0,0,0,.05)');
    g.addColorStop(1, 'rgba(0,0,0,.38)');
    x.fillStyle = g;
    x.fillRect(px, 0, 32, S);
  }
  for (let i = 0; i < 26; i++) {
    blob(x, S, r() * S, r() * S, 14 + r() * 40, `${(110 + r() * 40) | 0},${(50 + r() * 25) | 0},20`, 0.15 + r() * 0.3);
  }
  const sc = Math.round(160 * D);
  for (let i = 0; i < sc; i++) {
    x.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.14)';
    const px = r() * S, py = r() * S, a = r() * 6.28, l = 10 + r() * 50;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
    x.stroke();
  }
  grain(x, 20, r);
  return c;
}

const CAMO = {
  green: { base: '#6b7a52', cols: ['#4a5a38', '#8a8a62', '#2f3a28', '#5b4b35'] },
  tan: { base: '#b39a6e', cols: ['#8a7550', '#cdb98a', '#6b5a3c', '#4a3f2a'] },
  grey: { base: '#7d8288', cols: ['#5a5f66', '#9aa0a6', '#3e4348', '#6d7a86'] },
};

function camoCanvas(pal, seed) {
  const S = 256, r = rng(seed), [c, x] = cv(S);
  x.fillStyle = pal.base;
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const px = r() * S, py = r() * S, rw = 10 + r() * 30, rh = 8 + r() * 22, rot = r() * 3;
    x.fillStyle = pal.cols[(r() * pal.cols.length) | 0];
    wrap(S, (ox, oy) => {
      x.beginPath();
      x.ellipse(px + ox, py + oy, rw, rh, rot, 0, Math.PI * 2);
      x.fill();
    });
  }
  x.fillStyle = 'rgba(0,0,0,.08)';
  for (let i = 0; i < S; i += 2) {
    x.fillRect(i, 0, 1, S);
    x.fillRect(0, i, S, 1);
  }
  grain(x, 28, r);
  return c;
}

function nylonCanvas() {
  const S = 128, r = rng(12), [c, x] = cv(S);
  x.fillStyle = '#808080';
  x.fillRect(0, 0, S, S);
  x.fillStyle = 'rgba(0,0,0,.1)';
  for (let i = 0; i < S; i += 3) {
    x.fillRect(i, 0, 1, S);
    x.fillRect(0, i, S, 1);
  }
  grain(x, 24, r);
  return c;
}

function gunmetalCanvas() {
  const S = 128, r = rng(44), [c, x] = cv(S);
  x.fillStyle = '#6a6a6e';
  x.fillRect(0, 0, S, S);
  const n = Math.round(220 * D);
  for (let i = 0; i < n; i++) {
    x.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.1)';
    const y = r() * S, px = r() * S, l = 20 + r() * 80;
    x.beginPath();
    x.moveTo(px, y);
    x.lineTo(px + l, y);
    x.stroke();
  }
  grain(x, 26, r);
  return c;
}

function barkCanvas() {
  const S = 256, r = rng(55), [c, x] = cv(S);
  x.fillStyle = '#4a3a2a';
  x.fillRect(0, 0, S, S);
  const n = Math.round(160 * D);
  for (let i = 0; i < n; i++) {
    x.fillStyle = r() < 0.5 ? 'rgba(20,12,6,.35)' : 'rgba(120,90,60,.2)';
    x.fillRect(r() * S, 0, 1 + r() * 3, S);
  }
  grain(x, 22, r);
  return c;
}

function skyCanvas() {
  const W = 1024, H = 512, r = rng(9), [c, x] = cv(W, H, Math.min(K, 2));
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2c64ad');
  g.addColorStop(0.3, '#5b97d6');
  g.addColorStop(0.46, '#b9d4ec');
  g.addColorStop(0.5, '#dfeaf2');
  g.addColorStop(0.5001, '#9aa890');
  g.addColorStop(1, '#59664d');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 38; i++) {
    const cx = r() * W, cy = H * (0.12 + r() * 0.3), n = 5 + ((r() * 5) | 0);
    for (let k = 0; k < n; k++) {
      const px = cx + (r() - 0.5) * 140, py = cy + (r() - 0.5) * 18, rad = 28 + r() * 50;
      for (const ox of [-W, 0, W]) {
        x.save();
        x.translate(px + ox, py);
        x.scale(2.2, 1);
        const gg = x.createRadialGradient(0, 0, 0, 0, 0, rad);
        gg.addColorStop(0, 'rgba(255,255,255,.26)');
        gg.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = gg;
        x.fillRect(-rad, -rad, rad * 2, rad * 2);
        x.restore();
      }
    }
  }
  return c;
}

function glowCanvas() {
  const S = 64, [c, x] = cv(S, S, 1);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return c;
}

function flashCanvas() {
  const S = 128, [c, x] = cv(S, S, 1);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,220,1)');
  g.addColorStop(0.2, 'rgba(255,200,110,.9)');
  g.addColorStop(0.55, 'rgba(255,120,40,.25)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.translate(64, 64);
  for (let i = 0; i < 7; i++) {
    x.save();
    x.rotate((i / 7) * Math.PI * 2 + 0.3);
    const L = 38 + (i % 3) * 14;
    const gg = x.createLinearGradient(0, 0, L, 0);
    gg.addColorStop(0, 'rgba(255,235,170,.95)');
    gg.addColorStop(1, 'rgba(255,150,50,0)');
    x.fillStyle = gg;
    x.beginPath();
    x.moveTo(0, -4);
    x.lineTo(L, 0);
    x.lineTo(0, 4);
    x.closePath();
    x.fill();
    x.restore();
  }
  return c;
}

function tex(c, rx = 1, ry = rx, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = A;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** grey height map from an albedo canvas (used as a bump map) */
function bumpOf(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0);
  const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = A;
  return t;
}

export function createTextures(opts = {}) {
  K = opts.res || 1;
  D = Math.max(0.5, Math.min(2, K));
  A = Math.max(1, opts.aniso || 8);

  const sky = new THREE.CanvasTexture(skyCanvas());
  sky.mapping = THREE.EquirectangularReflectionMapping;
  sky.colorSpace = THREE.SRGBColorSpace;

  const glow = new THREE.CanvasTexture(glowCanvas());
  glow.colorSpace = THREE.SRGBColorSpace;
  const flash = new THREE.CanvasTexture(flashCanvas());
  flash.colorSpace = THREE.SRGBColorSpace;

  const out = {
    grass: tex(grassCanvas(), 40, 40),
    concrete: tex(concreteCanvas()),
    wood: tex(woodCanvas()),
    metal: tex(metalCanvas()),
    camoGreen: tex(camoCanvas(CAMO.green, 5), 3, 3),
    camoTan: tex(camoCanvas(CAMO.tan, 6), 3, 3),
    camoGrey: tex(camoCanvas(CAMO.grey, 8), 3, 3),
    nylon: tex(nylonCanvas(), 4, 4),
    gunmetal: tex(gunmetalCanvas(), 2, 2),
    bark: tex(barkCanvas(), 1, 2),
    sky,
    glow,
    flash,
    bump: {},
  };

  /** builds the optional bump maps (once) */
  out.ensureBump = () => {
    if (out.bump.done) return;
    for (const k of ['grass', 'concrete', 'wood', 'metal', 'bark']) out.bump[k] = bumpOf(out[k].image);
    out.bump.done = true;
  };
  return out;
}
