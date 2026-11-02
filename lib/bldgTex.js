/** Procedural building textures (no downloads): plaster, brick, siding, shingles. Tinted per building via vertex colours. */
import * as THREE from 'three';

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

function make(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

function grain(x, S, amt, r) {
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
}

function blob(x, S, px, py, rad, col, a) {
  for (const ox of [-S, 0, S]) {
    for (const oy of [-S, 0, S]) {
      const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rad);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g;
      x.fillRect(px + ox - rad, py + oy - rad, rad * 2, rad * 2);
    }
  }
}

function plaster(S) {
  const r = rng(101), [c, x] = make(S);
  x.fillStyle = '#efece6';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 34; i++) blob(x, S, r() * S, r() * S, S * (0.06 + r() * 0.18), '120,112,100', 0.07 + r() * 0.07);
  x.fillStyle = 'rgba(70,60,50,.10)';
  for (let i = 0; i < Math.round(S * 1.4); i++) x.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5);
  for (let i = 0; i < 10; i++) {
    const px = r() * S, w = 2 + r() * 5, len = S * (0.3 + r() * 0.5);
    const g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(60,55,45,.12)');
    g.addColorStop(1, 'rgba(60,55,45,0)');
    x.fillStyle = g;
    x.fillRect(px, 0, w, len);
  }
  grain(x, S, 14, r);
  return c;
}

function brick(S) {
  const r = rng(202), [c, x] = make(S);
  const rows = 24, cols = 9, bh = S / rows, bw = S / cols;
  x.fillStyle = '#a8a196';
  x.fillRect(0, 0, S, S);
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * (bw / 2);
    for (let i = -1; i <= cols; i++) {
      const k = 0.82 + r() * 0.3, burnt = r() < 0.06 ? 0.7 : 1;
      x.fillStyle = `rgb(${Math.round(176 * k * burnt)},${Math.round(98 * k * burnt)},${Math.round(78 * k * burnt)})`;
      const bx = i * bw + off, by = j * bh;
      x.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
      x.fillStyle = 'rgba(255,255,255,.07)';
      x.fillRect(bx + 1, by + 1, bw - 2, 1.5);
      x.fillStyle = 'rgba(0,0,0,.12)';
      x.fillRect(bx + 1, by + bh - 2.5, bw - 2, 1.5);
    }
  }
  x.fillStyle = 'rgba(30,20,15,.12)';
  for (let i = 0; i < S * 2; i++) x.fillRect(r() * S, r() * S, 1 + r(), 1 + r());
  grain(x, S, 20, r);
  return c;
}

function siding(S) {
  const r = rng(303), [c, x] = make(S);
  const boards = 13, bh = S / boards;
  for (let j = 0; j < boards; j++) {
    const k = 0.94 + r() * 0.08, v = (n) => Math.round(n * k);
    const g = x.createLinearGradient(0, j * bh, 0, (j + 1) * bh);
    g.addColorStop(0, `rgb(${v(238)},${v(236)},${v(230)})`);
    g.addColorStop(0.75, `rgb(${v(222)},${v(220)},${v(214)})`);
    g.addColorStop(1, `rgb(${v(190)},${v(188)},${v(182)})`);
    x.fillStyle = g;
    x.fillRect(0, j * bh, S, bh);
    x.fillStyle = 'rgba(30,25,20,.55)';
    x.fillRect(0, (j + 1) * bh - 2, S, 2);
    for (let q = 0; q < 5; q++) {
      x.strokeStyle = `rgba(80,70,60,${0.05 + r() * 0.08})`;
      x.lineWidth = 1;
      const yy = j * bh + 3 + r() * (bh - 8);
      x.beginPath();
      x.moveTo(0, yy);
      x.lineTo(S, yy + (r() - 0.5) * 3);
      x.stroke();
    }
  }
  grain(x, S, 14, r);
  return c;
}

function shingle(S) {
  const r = rng(404), [c, x] = make(S);
  const rows = 12, cols = 6, rh = S / rows, cw = S / cols;
  x.fillStyle = '#34322f';
  x.fillRect(0, 0, S, S);
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * (cw / 2);
    for (let i = -1; i <= cols; i++) {
      const k = 0.78 + r() * 0.3, v = Math.round(200 * k);
      x.fillStyle = `rgb(${v},${Math.round(v * 0.98)},${Math.round(v * 0.95)})`;
      x.fillRect(i * cw + off + 1, j * rh, cw - 2, rh - 1);
      const g = x.createLinearGradient(0, j * rh, 0, (j + 1) * rh);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.35)');
      x.fillStyle = g;
      x.fillRect(i * cw + off + 1, j * rh, cw - 2, rh - 1);
    }
  }
  grain(x, S, 22, r);
  return c;
}

function toTex(c, aniso) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** Each texture covers 2 m x 2 m of wall (brick / siding) or 3-4 m (plaster); the builder picks the tile size. */
export function createBuildingTextures(tex) {
  const k = (tex.concrete.image && tex.concrete.image.width ? tex.concrete.image.width : 512) / 512;
  const S = Math.max(192, Math.min(768, Math.round(256 * k)));
  const a = tex.concrete.anisotropy || 4;
  return {
    plaster: toTex(plaster(S), a),
    brick: toTex(brick(S), a),
    siding: toTex(siding(S), a),
    shingle: toTex(shingle(S), a),
  };
}
