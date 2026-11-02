/**
 * Geometry toolkit for the map: materials, a chunked geometry batcher, and building/prop primitives.
 * Everything placed here adds colliders in a deterministic order so every client builds the same world.
 */
import * as THREE from 'three';
import { addCollider, addRamp } from './collision.js';

const PI = Math.PI;
export const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const RAMP_ROT = [0, -PI / 2, PI, PI / 2];
const Q = [0, 1, 2, 0, 2, 3];
const FACES = [
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], u: 'z', w: 'y' },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], u: 'z', w: 'y' },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], u: 'x', w: 'z' },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], u: 'x', w: 'z' },
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], u: 'x', w: 'y' },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], u: 'x', w: 'y' },
];

const CH = 128; // batch chunk size in metres

function makeMaterials(tex) {
  const mats = {};
  const def = (k, map, color, o = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, map: map || null, roughness: o.r ?? 0.9, metalness: o.m ?? 0 });
    if (o.po !== undefined) { m.polygonOffset = true; m.polygonOffsetFactor = o.po; m.polygonOffsetUnits = o.po; m.userData.flat = true; }
    if (o.em) { m.emissive = new THREE.Color(o.em); m.emissiveIntensity = o.ei ?? 1; }
    mats[k] = m;
  };
  const tc = tex.concrete, tw = tex.wood, tm = tex.metal;
  def('conc', tc, 0xffffff); def('concW', tc, 0xe8d9bf); def('concC', tc, 0xc4ced8); def('concD', tc, 0x8e9096);
  def('brick', tc, 0xc79a85); def('stone', tc, 0xb2ab9f); def('rock', tc, 0x857f72); def('floor', tc, 0xb0aa9e);
  def('stair', tc, 0x9a968c); def('sand', tc, 0xd6c291);
  def('wood', tw, 0xffffff, { r: 0.8 }); def('woodD', tw, 0xb4947a, { r: 0.8 }); def('woodR', tw, 0xc2655a, { r: 0.8 });
  def('hay', null, 0xc9ab4e, { r: 1 }); def('canvas', null, 0xc9bf9f, { r: 1 });
  def('metal', tm, 0xd0d4d8, { r: 0.5, m: 0.6 }); def('metalD', tm, 0x555a60, { r: 0.5, m: 0.6 });
  def('roof', tm, 0x6b5f58, { r: 0.7, m: 0.4 }); def('roofB', tm, 0x4c5864, { r: 0.7, m: 0.4 });
  const paints = { pRed: 0x93402f, pBlue: 0x3b6a8c, pGreen: 0x55743a, pYellow: 0xb8892f, pGrey: 0x7c848a, pOrange: 0xc3662a, pWhite: 0xd2d4d6 };
  for (const k in paints) def(k, tm, paints[k], { r: 0.5, m: 0.6 });
  def('glass', null, 0x1c2a36, { r: 0.15, m: 0.8 }); def('tire', null, 0x121212, { r: 0.9 });
  def('lamp', null, 0xfff2c0, { em: 0xffe9a0, ei: 1.2 });
  def('road', tc, 0x66686a, { po: -3 }); def('dirt', tc, 0x8a7757, { po: -2 }); def('mark', null, 0xdedede, { po: -5 });
  def('pad', tc, 0xb8b8b4, { po: -2 }); def('wheat', null, 0x9b8a45, { po: -1 }); def('crop', null, 0x4f7a35, { po: -1 });
  def('plow', null, 0x6a4b33, { po: -1 }); def('hpad', null, 0x4a4f55, { po: -4 });
  return mats;
}

/**
 * Builder with the geometry primitives. Every call takes absolute world coordinates; y0 is the base height.
 * Geometry is batched per material and per CH-metre chunk so frustum culling stays effective.
 */
export function createBuilder(scene, tex) {
  const mats = makeMaterials(tex);
  const buckets = new Map();
  const zones = [];
  const spots = [];
  const R = { rng: null };

  const bucket = (mk, x, z) => {
    const key = mk + '|' + Math.floor(x / CH) + '|' + Math.floor(z / CH);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mk, p: [], n: [], u: [] }));
    return b;
  };

  /** axis-aligned (optionally Y-rotated) box with world-scaled UVs. y0 = base height. */
  function box(mk, x, y0, z, w, h, d, tile = 3, ry = 0) {
    const b = bucket(mk, x, z), c = Math.cos(ry), s = Math.sin(ry), hy = h / 2, cy = y0 + hy;
    const dim = { x: w, y: h, z: d };
    for (const f of FACES) {
      if (f.n[1] < 0 && y0 < 0.02) continue;
      const U = dim[f.u] / tile, V = dim[f.w] / tile;
      const nx = f.n[0] * c + f.n[2] * s, nz = -f.n[0] * s + f.n[2] * c, ny = f.n[1];
      for (const k of Q) {
        const v = f.v[k], lx = (v[0] * w) / 2, lz = (v[2] * d) / 2;
        b.p.push(x + lx * c + lz * s, cy + v[1] * hy, z - lx * s + lz * c);
        b.n.push(nx, ny, nz);
        b.u.push(k === 1 || k === 2 ? U : 0, k >= 2 ? V : 0);
      }
    }
  }

  function flat(mk, x, z, w, d, y = 0.02, ry = 0, tile = 4) {
    const b = bucket(mk, x, z), c = Math.cos(ry), s = Math.sin(ry);
    const pts = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    const uv = [[0, 0], [w / tile, 0], [w / tile, d / tile], [0, d / tile]];
    for (const k of Q) {
      const lx = (pts[k][0] * w) / 2, lz = (pts[k][1] * d) / 2;
      b.p.push(x + lx * c + lz * s, y, z - lx * s + lz * c);
      b.n.push(0, 1, 0);
      b.u.push(uv[k][0], uv[k][1]);
    }
  }

  /** ramp-shaped prism rising toward `dir` (0 +x, 1 +z, 2 -x, 3 -z). L = run, W = width, Rr = rise */
  function wedge(mk, x, y0, z, L, W, Rr, dir, tile = 3) {
    const b = bucket(mk, x, z), ry = RAMP_ROT[dir], c = Math.cos(ry), s = Math.sin(ry);
    const A = [-L / 2, 0, -W / 2], B = [-L / 2, 0, W / 2], C = [L / 2, 0, -W / 2], D = [L / 2, 0, W / 2];
    const E = [L / 2, Rr, -W / 2], F = [L / 2, Rr, W / 2];
    for (const tri of [[A, C, D], [A, D, B], [C, E, F], [C, F, D], [A, B, F], [A, F, E], [A, E, C], [B, D, F]]) {
      const w3 = tri.map(([lx, ly, lz]) => [x + lx * c + lz * s, y0 + ly, z - lx * s + lz * c, lx, ly, lz]);
      const ux = w3[1][0] - w3[0][0], uy = w3[1][1] - w3[0][1], uz = w3[1][2] - w3[0][2];
      const vx = w3[2][0] - w3[0][0], vy = w3[2][1] - w3[0][1], vz = w3[2][2] - w3[0][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (const p of w3) {
        b.p.push(p[0], p[1], p[2]);
        b.n.push(nx, ny, nz);
        b.u.push((p[3] + p[5]) / tile, (p[4] + p[5] * 0.5) / tile);
      }
    }
  }

  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
  /** any THREE geometry (cylinder, cone, ...). pos = [x,y,z] */
  function geo(mk, g0, pos, rot = [0, 0, 0], scl = [1, 1, 1]) {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    _m4.compose(_v3.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_eu.set(rot[0], rot[1], rot[2])), _s3.set(scl[0], scl[1], scl[2]));
    g.applyMatrix4(_m4);
    const b = bucket(mk, pos[0], pos[2]);
    const pa = g.attributes.position.array, na = g.attributes.normal.array, ua = g.attributes.uv.array;
    for (let i = 0; i < pa.length; i++) { b.p.push(pa[i]); b.n.push(na[i]); }
    for (let i = 0; i < ua.length; i++) b.u.push(ua[i]);
    g.dispose();
    g0.dispose();
  }

  function finish() {
    for (const b of buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[b.mk]);
      m.receiveShadow = true;
      m.castShadow = !mats[b.mk].userData.flat;
      scene.add(m);
    }
    buckets.clear();
  }

  const zone = (x, z, w, d, pad = 3) => zones.push([x - w / 2 - pad, z - d / 2 - pad, x + w / 2 + pad, z + d / 2 + pad]);
  const blocked = (x, z) => {
    for (let i = 0; i < zones.length; i++) { const q = zones[i]; if (x > q[0] && x < q[2] && z > q[1] && z < q[3]) return true; }
    return false;
  };

  function solid(mk, x, y0, z, w, h, d, o = {}) {
    box(mk, x, y0, z, w, h, d, o.tile || 3, 0);
    if (o.col === false) return null;
    return addCollider(x, z, w, y0 + h, d, { y0, noCover: o.nc ?? y0 > 0.5 });
  }

  /** straight wall with openings. axis 'x': runs along x at z = fixed. ops = [{c, w, lo, hi}] sorted by c. */
  function wallRun(mk, axis, fixed, a0, a1, y0, h, t, ops, tile = 3) {
    let cur = a0;
    const seg = (s, e, lo, hi) => {
      if (e - s < 0.04 || hi - lo < 0.04) return;
      const mid = (s + e) / 2, len = e - s;
      if (axis === 'x') solid(mk, mid, y0 + lo, fixed, len, hi - lo, t, { tile });
      else solid(mk, fixed, y0 + lo, mid, t, hi - lo, len, { tile });
    };
    for (const o of ops) {
      const s = o.c - o.w / 2, e = o.c + o.w / 2;
      seg(cur, s, 0, h);
      if (o.lo > 0) seg(s, e, 0, o.lo);
      seg(s, e, o.hi, h);
      cur = e;
    }
    seg(cur, a1, 0, h);
  }

  /** walkable stair: ramp collider + stepped visual. (x,z) = footprint centre; len along the rise direction */
  function stairs(x, z, dir, w, len, y0, rise, mk = 'stair') {
    const alongX = dir % 2 === 0;
    addRamp(x, z, alongX ? len : w, alongX ? w : len, y0, y0 + rise, dir);
    const n = Math.max(3, Math.round(rise / 0.28)), r = rise / n, ln = len / n;
    for (let k = 0; k < n; k++) {
      const off = -len / 2 + (k + 0.5) * ln;
      box(mk, x + DX[dir] * off, y0, z + DZ[dir] * off, alongX ? ln : w, (k + 0.5) * r, alongX ? w : ln, 2);
    }
  }

  /** Enterable building: walls with doors + windows, floor slabs, zig-zag stairs, roof with parapet, interior props. */
  function building(cx, cz, w, d, o = {}) {
    const fl = o.floors || 1, fh = o.fh || 3.2, t = o.t || 0.3, y0 = o.y0 || 0;
    const mk = o.mk || 'conc', roofMk = o.roofMk || 'roof';
    const doors = [].concat(o.door === undefined ? 's' : o.door);
    const dw = o.dw || 1.6, dh = Math.min(o.dh || 2.4, fh - 0.4);
    const ix0 = cx - w / 2 + t, ix1 = cx + w / 2 - t, iz0 = cz - d / 2 + t, iz1 = cz + d / 2 - t;
    const Lr = fh / 0.75;
    const stairsOn = (o.stairs ?? true) && iz1 - iz0 >= Lr + 2.4 && ix1 - ix0 >= 4.2;
    zone(cx, cz, w, d, 4);
    const sides = {
      n: { ax: 'x', fixed: cz - d / 2 + t / 2, a0: cx - w / 2, a1: cx + w / 2, c0: cx },
      s: { ax: 'x', fixed: cz + d / 2 - t / 2, a0: cx - w / 2, a1: cx + w / 2, c0: cx },
      w: { ax: 'z', fixed: cx - w / 2 + t / 2, a0: iz0, a1: iz1, c0: cz },
      e: { ax: 'z', fixed: cx + w / 2 - t / 2, a0: iz0, a1: iz1, c0: cz },
    };
    for (let f = 0; f < fl; f++) {
      const by = y0 + f * fh;
      for (const k of ['n', 's', 'w', 'e']) {
        const s = sides[k], ops = [];
        if (f === 0 && doors.includes(k)) ops.push({ c: s.c0 + (o.doorAt || 0), w: dw, lo: 0, hi: dh });
        if (o.win !== false) {
          for (let c = s.a0 + 1.8; c <= s.a1 - 1.8; c += o.winGap || 3.6) {
            if (ops.some((q) => Math.abs(q.c - c) < q.w / 2 + 1.0)) continue;
            ops.push({ c, w: 1.2, lo: 0.95, hi: 2.15 });
          }
        }
        ops.sort((a, b) => a.c - b.c);
        wallRun(mk, s.ax, s.fixed, s.a0, s.a1, by, fh, t, ops, 4);
      }
    }
    if (o.part && w >= 14) {
      for (let f = 0; f < fl; f++) wallRun(mk, 'z', cx + 1.5, iz0, iz1, y0 + f * fh, fh, 0.25, [{ c: cz, w: 1.4, lo: 0, hi: Math.min(2.3, fh - 0.4) }], 4);
    }

    const hz0 = iz0 + 0.6, hz1 = hz0 + Lr;
    const col = (i) => (i % 2 === 0 ? [ix0, ix0 + 1.4] : [ix1 - 1.4, ix1]);
    const slab = (x0, x1, z0, z1, sy, m) => {
      if (x1 - x0 > 0.05 && z1 - z0 > 0.05) solid(m, (x0 + x1) / 2, sy, (z0 + z1) / 2, x1 - x0, 0.25, z1 - z0, { tile: 3 });
    };
    for (let j = 1; j <= fl; j++) {
      const sy = y0 + j * fh - 0.25, m = j === fl ? roofMk : 'floor';
      if (stairsOn) {
        const [hx0, hx1] = col(j - 1);
        slab(ix0, hx0, iz0, iz1, sy, m); slab(hx1, ix1, iz0, iz1, sy, m);
        slab(hx0, hx1, hz1, iz1, sy, m); slab(hx0, hx1, iz0, hz0, sy, m);
      } else slab(ix0, ix1, iz0, iz1, sy, m);
    }
    if (stairsOn) {
      for (let i = 0; i < fl; i++) {
        const [a, b] = col(i);
        stairs((a + b) / 2, (hz0 + hz1) / 2, 3, 1.4, Lr, y0 + i * fh, fh);
      }
    }
    flat('pad', cx, cz, w - 2 * t, d - 2 * t, y0 + 0.02);

    const top = y0 + fl * fh;
    if (o.parapet !== false) {
      solid(mk, cx, top, cz - d / 2 + t / 2, w, 1.0, t, { tile: 4 });
      solid(mk, cx, top, cz + d / 2 - t / 2, w, 1.0, t, { tile: 4 });
      solid(mk, cx - w / 2 + t / 2, top, cz, t, 1.0, d - 2 * t, { tile: 4 });
      solid(mk, cx + w / 2 - t / 2, top, cz, t, 1.0, d - 2 * t, { tile: 4 });
    }

    const mx0 = ix0 + 2.2, mx1 = ix1 - 2.2;
    if (o.props !== false && mx1 - mx0 > 1.6 && iz1 - iz0 > 6.5) {
      for (let f = 0; f <= fl; f++) {
        const by = y0 + f * fh, n = f === fl ? (R.rng() < 0.5 ? 1 : 0) : 1 + (R.rng() < 0.5 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const px = mx0 + R.rng() * (mx1 - mx0), pz = iz0 + 2.6 + R.rng() * Math.max(0.1, iz1 - iz0 - 5.2), kind = R.rng();
          if (f === fl) solid('metalD', px, by, pz, 1.6, 0.9, 1.2, { tile: 1 });
          else if (kind < 0.45) { const s = 0.9 + R.rng() * 0.5; solid('wood', px, by, pz, s, s, s, { tile: 1.5 }); }
          else if (kind < 0.75) solid('woodD', px, by, pz, 1.8, 0.85, 0.9, { tile: 1.5 });
          else solid('metalD', px, by, pz, 0.7, 1.9, 0.6, { tile: 1 });
        }
      }
      if (R.rng() < 0.7) spots.push({ x: mx0 + R.rng() * (mx1 - mx0), z: cz + (R.rng() - 0.5) * 2, y: y0 + 0.4 });
      if (fl >= 2 && R.rng() < 0.8) spots.push({ x: cx + (R.rng() - 0.5) * 3, z: cz + (R.rng() - 0.5) * 3, y: top + 0.4 });
    }
    return { top };
  }

  const lamp = (x, y, z) => {
    solid('metalD', x, y, z, 0.2, 5, 0.2, { tile: 1 });
    box('metalD', x, y + 5, z, 0.7, 0.12, 0.12, 1);
    box('lamp', x + 0.4, y + 4.9, z, 0.3, 0.12, 0.3, 1);
  };
  const crates = (x, y, z, nx, nz, lv, tile = 1.2) => {
    const s = 1.2, e = s - 0.03;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) for (let k = 0; k < lv; k++) {
      box('wood', x + (i - (nx - 1) / 2) * s, y + k * s, z + (j - (nz - 1) / 2) * s, e, e, e, tile);
    }
    addCollider(x, z, nx * s, y + lv * s, nz * s, { y0: y });
  };
  const jersey = (x, y, z, axis = 'x') => {
    const L = 3, Wd = 0.7, sx = axis === 'x' ? L : Wd, sz = axis === 'x' ? Wd : L;
    box('conc', x, y, z, sx, 0.4, sz, 2);
    box('conc', x, y + 0.4, z, axis === 'x' ? L : 0.42, 0.65, axis === 'x' ? 0.42 : L, 2);
    addCollider(x, z, sx, y + 1.05, sz, { y0: y });
  };
  const sandbags = (x, y, z, len, axis = 'x') => {
    for (let r = 0; r < 4; r++) {
      const o = r % 2 ? 0.2 : 0;
      box('sand', axis === 'x' ? x + o : x, y + r * 0.28, axis === 'x' ? z : z + o, axis === 'x' ? len : 0.8, 0.28, axis === 'x' ? 0.8 : len, 1);
    }
    addCollider(x, z, axis === 'x' ? len : 0.8, y + 1.12, axis === 'x' ? 0.8 : len, { y0: y });
  };
  const barrel = (x, y, z, mk) => {
    geo(mk, new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), [x, y + 0.45, z]);
    addCollider(x, z, 0.6, y + 0.9, 0.6, { y0: y });
  };
  const fence = (x0, y0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / 3), ax = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let i = 0; i <= n; i++) box('woodD', x0 + ((x1 - x0) * i) / n, y0, z0 + ((z1 - z0) * i) / n, 0.15, 1.25, 0.15, 1);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (const y of [0.5, 0.95]) box('woodD', cx, y0 + y, cz, ax ? len : 0.06, 0.1, ax ? 0.06 : len, 1);
    addCollider(cx, cz, ax ? len : 0.2, y0 + 1.1, ax ? 0.2 : len, { y0 });
  };
  const car = (x, y, z, ry, mk) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    box(mk, x, y + 0.3, z, 4.2, 0.7, 1.8, 2, ry);
    const cab = at(-0.3, 0);
    box('glass', cab[0], y + 1.0, cab[1], 2.2, 0.62, 1.6, 2, ry);
    for (const [lx, lz] of [[1.3, 0.95], [1.3, -0.95], [-1.3, 0.95], [-1.3, -0.95]]) {
      const w = at(lx, lz);
      box('tire', w[0], y, w[1], 0.7, 0.7, 0.3, 1, ry);
    }
    const alongX = Math.abs(Math.sin(ry)) < 0.5;
    addCollider(x, z, alongX ? 4.2 : 1.8, y + 1.4, alongX ? 1.8 : 4.2, { y0: y });
  };
  function container(x, y, z, axis, mk, lvl = 0) {
    const L = 6.1, H = 2.6, W = 2.45, y0 = y + lvl * H, sw = axis === 'x' ? L : W, sd = axis === 'x' ? W : L;
    box(mk, x, y0, z, sw, H, sd, 2.4);
    for (const a of [-1, 1]) for (const b of [-1, 1]) box('metalD', x + a * (sw / 2 - 0.06), y0, z + b * (sd / 2 - 0.06), 0.12, H + 0.02, 0.12, 1);
    box('metalD', x + (axis === 'x' ? sw / 2 : 0), y0 + 0.15, z + (axis === 'x' ? 0 : sd / 2), axis === 'x' ? 0.05 : W - 0.3, H - 0.3, axis === 'x' ? W - 0.3 : 0.05, 1);
    addCollider(x, z, sw, y0 + H, sd, { y0, noCover: lvl > 0 });
  }
  function silo(x, y, z, r = 3, h = 14) {
    geo('metal', new THREE.CylinderGeometry(r, r, h, 14), [x, y + h / 2, z]);
    geo('roofB', new THREE.ConeGeometry(r * 1.05, 2, 14), [x, y + h + 1, z]);
    addCollider(x, z, r * 1.7, y + h, r * 1.7, { y0: y });
    zone(x, z, r * 2, r * 2, 3);
  }
  function watchtower(x, y, z, hgt = 7, dir = 0) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid('metalD', x + sx * 1.9, y, z + sz * 1.9, 0.4, hgt, 0.4, { tile: 1 });
    solid('floor', x, y + hgt - 0.25, z, 4.8, 0.25, 4.8);
    for (let k = 0; k < 4; k++) {
      if (k === (dir + 2) % 4) continue;
      if (k % 2 === 0) solid('metalD', x + DX[k] * 2.3, y + hgt, z, 0.12, 1.0, 4.8, { tile: 1 });
      else solid('metalD', x, y + hgt, z + DZ[k] * 2.3, 4.8, 1.0, 0.12, { tile: 1 });
    }
    solid('roof', x, y + hgt + 2.6, z, 5.4, 0.2, 5.4);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('metalD', x + sx * 2.5, y + hgt, z + sz * 2.5, 0.15, 2.6, 0.15, 1);
    const len = hgt / 0.75;
    stairs(x - DX[dir] * (2.4 + len / 2), z - DZ[dir] * (2.4 + len / 2), dir, 1.6, len, y, hgt, 'metalD');
    zone(x - DX[dir] * len / 2, z - DZ[dir] * len / 2, len + 8, len + 8, 2);
    spots.push({ x, z, y: y + hgt + 0.4 });
  }
  const ruinWall = (x, y, z, len, axis = 'x') => {
    const a = len * 0.62, b = len * 0.38, t = 0.4;
    const piece = (u0, l, h) => {
      const sx = axis === 'x' ? l : t, sz = axis === 'x' ? t : l;
      solid('concD', axis === 'x' ? x + u0 : x, y, axis === 'x' ? z : z + u0, sx, h, sz, { tile: 3 });
    };
    piece(-len / 2 + a / 2, a, 2.8);
    piece(len / 2 - b / 2, b, 1.4);
  };

  return {
    mats, box, flat, wedge, geo, solid, wallRun, stairs, building, lamp, crates, jersey, sandbags, barrel, fence,
    car, container, silo, watchtower, ruinWall, zone, blocked, zones, spots, finish, setRng: (r) => { R.rng = r; },
  };
}
