/**
 * The big map (~600 x 600 m). Deterministic (seeded) so every client builds the identical world.
 * Geometry is emitted straight into per-material, per-96m-chunk buffers (frustum culling stays effective).
 * Returns { scene, sun, sunDir, spawns, arena, update(fx, fz, dt), pickups, nearestPickup, consumePickup }.
 */
import * as THREE from 'three';
import { addCollider, addRamp, clearColliders } from './collision.js';

const PI = Math.PI;
export const ARENA = { x: 220, z: 170, half: 32 };
const P = (x, z, yaw = 0) => ({ x, z, yaw });
export const SPAWNS = {
  player: [P(0, 8), P(-6, 9), P(6, 9), P(0, 12)],
  enemy: [P(-60, -60), P(60, -60), P(0, -120), P(0, 100), P(110, -20), P(-60, 40), P(110, 60), P(-30, 120), P(0, -262), P(110, -200)],
  ffa: [P(-14, 14), P(14, 14), P(0, -12), P(-120, -60), P(-190, -60), P(60, -60), P(200, -60), P(0, -120), P(0, 100),
    P(110, -20), P(-60, 60), P(-100, 120), P(60, 120), P(250, -60), P(0, -262)],
  teamA: [P(ARENA.x - 26, ARENA.z - 5, -PI / 2), P(ARENA.x - 26, ARENA.z + 5, -PI / 2), P(ARENA.x - 28, ARENA.z - 12, -PI / 2), P(ARENA.x - 28, ARENA.z + 12, -PI / 2)],
  teamB: [P(ARENA.x + 26, ARENA.z - 5, PI / 2), P(ARENA.x + 26, ARENA.z + 5, PI / 2), P(ARENA.x + 28, ARENA.z - 12, PI / 2), P(ARENA.x + 28, ARENA.z + 12, PI / 2)],
  duelA: P(ARENA.x - 26, ARENA.z, -PI / 2),
  duelB: P(ARENA.x + 26, ARENA.z, PI / 2),
};

const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
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

export function createWorld(renderer, tex) {
  clearColliders();
  const R = rng(1337);
  const scene = new THREE.Scene();
  scene.background = tex.sky;
  scene.fog = new THREE.Fog(0xd3e0ea, 80, 320);

  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(tex.sky).texture;
  scene.environmentIntensity = 0.65;
  pm.dispose();

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 0.75));
  const sunDir = new THREE.Vector3(25, 40, 12).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 150;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const sunSpriteMat = (o) => new THREE.SpriteMaterial({
    map: tex.glow, color: 0xfff4cf, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const sunSprite = new THREE.Sprite(sunSpriteMat(1));
  sunSprite.scale.setScalar(40);
  const halo = new THREE.Sprite(sunSpriteMat(0.28));
  halo.scale.setScalar(140);
  scene.add(sunSprite, halo);

  // ---------- materials (keys are used by the batcher) ----------
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

  // ---------- geometry batcher ----------
  const buckets = new Map();
  const CH = 96;
  const bucket = (mk, x, z) => {
    const key = mk + '|' + Math.floor((x + 300) / CH) + '|' + Math.floor((z + 300) / CH);
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

  // ---------- tree exclusion zones + pickup spots ----------
  const zones = [];
  const zone = (x, z, w, d, pad = 3) => zones.push([x - w / 2 - pad, z - d / 2 - pad, x + w / 2 + pad, z + d / 2 + pad]);
  const spots = [];

  // ---------- basic pieces ----------
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

    // slabs (floors + roof) with a stair hole, stairs zig-zag west / east and always rise north
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

    // interior props + pickup spots (kept away from the doors and the stair columns)
    const mx0 = ix0 + 2.2, mx1 = ix1 - 2.2;
    if (o.props !== false && mx1 - mx0 > 1.6 && iz1 - iz0 > 6.5) {
      for (let f = 0; f <= fl; f++) {
        const by = y0 + f * fh, n = f === fl ? (R() < 0.5 ? 1 : 0) : 1 + (R() < 0.5 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const px = mx0 + R() * (mx1 - mx0), pz = iz0 + 2.6 + R() * Math.max(0.1, iz1 - iz0 - 5.2), kind = R();
          if (f === fl) solid('metalD', px, by, pz, 1.6, 0.9, 1.2, { tile: 1 });
          else if (kind < 0.45) { const s = 0.9 + R() * 0.5; solid('wood', px, by, pz, s, s, s, { tile: 1.5 }); }
          else if (kind < 0.75) solid('woodD', px, by, pz, 1.8, 0.85, 0.9, { tile: 1.5 });
          else solid('metalD', px, by, pz, 0.7, 1.9, 0.6, { tile: 1 });
        }
      }
      if (R() < 0.7) spots.push({ x: mx0 + R() * (mx1 - mx0), z: cz + (R() - 0.5) * 2, y: y0 + 0.4 });
      if (fl >= 2 && R() < 0.8) spots.push({ x: cx + (R() - 0.5) * 3, z: cz + (R() - 0.5) * 3, y: top + 0.4 });
    }
    return { top };
  }

  const lamp = (x, z) => {
    solid('metalD', x, 0, z, 0.2, 5, 0.2, { tile: 1 });
    box('metalD', x, 5, z, 0.7, 0.12, 0.12, 1);
    box('lamp', x + 0.4, 4.9, z, 0.3, 0.12, 0.3, 1);
  };
  const crates = (x, z, nx, nz, lv, tile = 1.2) => {
    const s = 1.2, e = s - 0.03;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) for (let k = 0; k < lv; k++) {
      box('wood', x + (i - (nx - 1) / 2) * s, k * s, z + (j - (nz - 1) / 2) * s, e, e, e, tile);
    }
    addCollider(x, z, nx * s, lv * s, nz * s);
  };
  const jersey = (x, z, axis = 'x') => {
    const L = 3, Wd = 0.7, sx = axis === 'x' ? L : Wd, sz = axis === 'x' ? Wd : L;
    box('conc', x, 0, z, sx, 0.4, sz, 2);
    box('conc', x, 0.4, z, axis === 'x' ? L : 0.42, 0.65, axis === 'x' ? 0.42 : L, 2);
    addCollider(x, z, sx, 1.05, sz);
  };
  const sandbags = (x, z, len, axis = 'x') => {
    for (let r = 0; r < 4; r++) {
      const o = r % 2 ? 0.2 : 0;
      box('sand', axis === 'x' ? x + o : x, r * 0.28, axis === 'x' ? z : z + o, axis === 'x' ? len : 0.8, 0.28, axis === 'x' ? 0.8 : len, 1);
    }
    addCollider(x, z, axis === 'x' ? len : 0.8, 1.12, axis === 'x' ? 0.8 : len);
  };
  const barrel = (x, z, mk) => {
    geo(mk, new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), [x, 0.45, z]);
    addCollider(x, z, 0.6, 0.9, 0.6);
  };
  const fence = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / 3), ax = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let i = 0; i <= n; i++) box('woodD', x0 + ((x1 - x0) * i) / n, 0, z0 + ((z1 - z0) * i) / n, 0.15, 1.25, 0.15, 1);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (const y of [0.5, 0.95]) box('woodD', cx, y, cz, ax ? len : 0.06, 0.1, ax ? 0.06 : len, 1);
    addCollider(cx, cz, ax ? len : 0.2, 1.1, ax ? 0.2 : len);
  };
  const car = (x, z, ry, mk) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    box(mk, x, 0.3, z, 4.2, 0.7, 1.8, 2, ry);
    const cab = at(-0.3, 0);
    box('glass', cab[0], 1.0, cab[1], 2.2, 0.62, 1.6, 2, ry);
    for (const [lx, lz] of [[1.3, 0.95], [1.3, -0.95], [-1.3, 0.95], [-1.3, -0.95]]) {
      const w = at(lx, lz);
      box('tire', w[0], 0, w[1], 0.7, 0.7, 0.3, 1, ry);
    }
    const alongX = Math.abs(Math.sin(ry)) < 0.5;
    addCollider(x, z, alongX ? 4.2 : 1.8, 1.4, alongX ? 1.8 : 4.2);
  };
  function container(x, z, axis, mk, lvl = 0) {
    const L = 6.1, H = 2.6, W = 2.45, y0 = lvl * H, sw = axis === 'x' ? L : W, sd = axis === 'x' ? W : L;
    box(mk, x, y0, z, sw, H, sd, 2.4);
    for (const a of [-1, 1]) for (const b of [-1, 1]) box('metalD', x + a * (sw / 2 - 0.06), y0, z + b * (sd / 2 - 0.06), 0.12, H + 0.02, 0.12, 1);
    box('metalD', x + (axis === 'x' ? sw / 2 : 0), y0 + 0.15, z + (axis === 'x' ? 0 : sd / 2), axis === 'x' ? 0.05 : W - 0.3, H - 0.3, axis === 'x' ? W - 0.3 : 0.05, 1);
    addCollider(x, z, sw, y0 + H, sd, { y0, noCover: lvl > 0 });
  }
  function silo(x, z, r = 3, h = 14) {
    geo('metal', new THREE.CylinderGeometry(r, r, h, 14), [x, h / 2, z]);
    geo('roofB', new THREE.ConeGeometry(r * 1.05, 2, 14), [x, h + 1, z]);
    addCollider(x, z, r * 1.7, h, r * 1.7);
    zone(x, z, r * 2, r * 2, 3);
  }
  function watchtower(x, z, hgt = 7, dir = 0) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid('metalD', x + sx * 1.9, 0, z + sz * 1.9, 0.4, hgt, 0.4, { tile: 1 });
    solid('floor', x, hgt - 0.25, z, 4.8, 0.25, 4.8);
    for (let k = 0; k < 4; k++) {
      if (k === (dir + 2) % 4) continue;
      if (k % 2 === 0) solid('metalD', x + DX[k] * 2.3, hgt, z, 0.12, 1.0, 4.8, { tile: 1 });
      else solid('metalD', x, hgt, z + DZ[k] * 2.3, 4.8, 1.0, 0.12, { tile: 1 });
    }
    solid('roof', x, hgt + 2.6, z, 5.4, 0.2, 5.4);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('metalD', x + sx * 2.5, hgt, z + sz * 2.5, 0.15, 2.6, 0.15, 1);
    const len = hgt / 0.75;
    stairs(x - DX[dir] * (2.4 + len / 2), z - DZ[dir] * (2.4 + len / 2), dir, 1.6, len, 0, hgt, 'metalD');
    zone(x - DX[dir] * len / 2, z - DZ[dir] * len / 2, len + 8, len + 8, 2);
    spots.push({ x, z, y: hgt + 0.4 });
  }
  const ruinWall = (x, z, len, axis = 'x') => {
    const a = len * 0.62, b = len * 0.38, t = 0.4;
    const piece = (u0, l, h) => {
      const sx = axis === 'x' ? l : t, sz = axis === 'x' ? t : l;
      solid('concD', axis === 'x' ? x + u0 : x, 0, axis === 'x' ? z : z + u0, sx, h, sz, { tile: 3 });
    };
    piece(-len / 2 + a / 2, a, 2.8);
    piece(len / 2 - b / 2, b, 1.4);
  };

  // ---------- ground + water ----------
  tex.grass.repeat.set(160, 160);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.grass, roughness: 1 }));
  ground.rotation.x = -PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({
    color: 0x2f6a86, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.86,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  water.rotation.x = -PI / 2;
  water.scale.set(40, 32, 1);
  water.position.set(-200, 0.05, 100);
  scene.add(water);

  // ---------- roads ----------
  const road = (x, z, w, d) => { flat('road', x, z, w, d, 0.02, 0, 6); zone(x, z, w, d, 1); };
  road(0, 0, 9, 600); // R1 north-south highway
  road(0, -60, 600, 9); // R2 east-west
  road(95, 120, 390, 7); // R3 (x -100 .. 290)
  road(-60, 30, 6, 180); // R4 town -> south
  road(110, -65, 7, 370); // R5 industrial aisle (z -250 .. 120)
  for (let z = -290; z < 290; z += 9) flat('mark', 0, z, 0.25, 4, 0.03);
  for (let x = -290; x < 290; x += 9) flat('mark', x, -60, 4, 0.25, 0.03);
  flat('dirt', 155, -150, 90, 5, 0.02); zone(155, -150, 90, 5, 1); // track to the hill fort
  flat('dirt', 0, 0, 0.01, 0.01, 0.02);

  // ---------- central plaza (spawn) ----------
  flat('pad', 0, 10, 50, 50, 0.015, 0, 4);
  zone(0, 10, 90, 90, 0);
  for (const sx of [-1, 1]) {
    jersey(sx * 14, -4, 'x'); jersey(sx * 22, 0, 'z');
    sandbags(sx * 18, 30, 5, 'x');
    crates(sx * 24, 18, 2, 2, 1);
    lamp(sx * 22, 34); lamp(sx * 22, -8);
    barrel(sx * 16, 28, sx < 0 ? 'pRed' : 'pBlue');
    spots.push({ x: sx * 14, z: 12, y: 0.4 });
  }
  solid('concD', 0, 0, 30, 4, 1.0, 4);
  solid('stone', 0, 1.0, 30, 1.2, 6, 1.2);
  building(-38, 16, 10, 8, { mk: 'concW', door: 'e', stairs: true });
  building(38, 16, 10, 8, { mk: 'concC', door: 'w', stairs: true });

  // ---------- Port Haven town ----------
  for (const [x, w, f, m] of [[-196, 14, 2, 'conc'], [-176, 12, 3, 'concW'], [-152, 16, 2, 'brick'], [-128, 12, 1, 'concC'], [-104, 16, 3, 'conc']]) {
    building(x, -78, w, 14, { floors: f, mk: m, door: 's', doorAt: (R() - 0.5) * 4, part: true });
  }
  for (const [x, w, f, m] of [[-190, 16, 2, 'concW'], [-166, 12, 1, 'brick'], [-144, 14, 3, 'concC'], [-118, 16, 2, 'conc'], [-96, 12, 2, 'concW']]) {
    building(x, -42, w, 14, { floors: f, mk: m, door: 'n', doorAt: (R() - 0.5) * 4, part: true });
  }
  for (const [x, w, f, m] of [[-186, 18, 2, 'conc'], [-156, 14, 1, 'concW'], [-126, 18, 2, 'brick'], [-98, 12, 1, 'concC']]) {
    building(x, -106, w, 12, { floors: f, mk: m, door: 's', doorAt: (R() - 0.5) * 4 });
  }
  building(-80, -78, 8, 8, { floors: 4, fh: 3.4, mk: 'brick', roofMk: 'roofB', door: 's', t: 0.35 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('metalD', -80 + sx * 2.5, 13.6, -78 + sz * 2.5, 0.3, 3.2, 0.3, 1);
  geo('roofB', new THREE.ConeGeometry(4.2, 3, 4), [-80, 13.6 + 3.2 + 1.5, -78], [0, PI / 4, 0]);
  zone(-140, -75, 150, 90, 6);
  for (let x = -204; x < -70; x += 26) { lamp(x, -66.5); lamp(x + 13, -53.5); }
  car(-150, -58, 0, 'pRed'); car(-124, -62, 0, 'pBlue'); car(-176, -63, 0, 'pYellow'); car(-60, -20, PI / 2, 'pGrey'); car(-60, 70, PI / 2, 'pGreen');
  crates(-140, -92, 2, 1, 2); jersey(-120, -94, 'x'); jersey(-168, -92, 'x'); sandbags(-100, -92, 4, 'x');

  // ---------- industrial yard ----------
  for (const x of [80, 140]) building(x, -130, 28, 16, { floors: 2, fh: 4.5, mk: 'pGrey', roofMk: 'roofB', door: ['s', 'n'], dw: 5, dh: 3.8, winGap: 5 });
  const cm = ['pRed', 'pBlue', 'pGreen', 'pYellow', 'pGrey', 'pOrange'];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 4; c++) {
      for (const base of [66, 124]) {
        if (R() < 0.25) continue;
        const x = base + c * 9, z = -100 + r * 8, m = cm[(R() * cm.length) | 0];
        container(x, z, 'x', m);
        if (R() < 0.35) container(x, z, 'x', cm[(R() * cm.length) | 0], 1);
      }
    }
  }
  zone(115, -100, 120, 110, 3);
  for (const [x, z] of [[172, -80], [172, -92], [184, -80], [184, -92]]) silo(x, z);
  for (const x of [100, 120]) solid('pYellow', x, 0, -112, 1.2, 15, 1.2, { tile: 2 });
  solid('pYellow', 110, 15, -112, 22, 1.2, 1.6, { tile: 2 });
  for (const x of [80, 100]) { geo('metal', new THREE.CylinderGeometry(3.5, 3.5, 4, 14), [x - 18, 2, -166]); addCollider(x - 18, -166, 5.6, 4, 5.6); }
  zone(70, -166, 24, 12, 2);
  car(110, -30, PI / 2, 'pOrange'); car(95, -62, 0, 'pGrey'); crates(60, -52, 2, 2, 2); jersey(100, -48, 'x');

  // ---------- military compound ----------
  const mc = { x: 0, z: -200 };
  wallRun('concD', 'x', -235, -45, 45, 0, 3.6, 1.2, [{ c: 0, w: 10, lo: 0, hi: 3.6 }], 4);
  wallRun('concD', 'x', -165, -45, 45, 0, 3.6, 1.2, [{ c: 0, w: 10, lo: 0, hi: 3.6 }], 4);
  wallRun('concD', 'z', -45, -235, -165, 0, 3.6, 1.2, [{ c: -200, w: 6, lo: 0, hi: 3.6 }], 4);
  wallRun('concD', 'z', 45, -235, -165, 0, 3.6, 1.2, [{ c: -200, w: 6, lo: 0, hi: 3.6 }], 4);
  building(-24, -222, 20, 10, { mk: 'concC', roofMk: 'roofB', door: 's', part: true });
  building(24, -222, 20, 10, { mk: 'concC', roofMk: 'roofB', door: 's', part: true });
  building(-22, -182, 30, 20, { mk: 'pGrey', roofMk: 'roofB', fh: 8, door: 's', dw: 8, dh: 6.5, win: false, stairs: false });
  building(28, -178, 14, 10, { mk: 'concD', roofMk: 'roofB', t: 0.8, win: false, door: 'w', stairs: true });
  flat('hpad', 26, -200, 14, 14, 0.025); flat('mark', 22.6, -200, 1, 6, 0.03); flat('mark', 29.4, -200, 1, 6, 0.03); flat('mark', 26, -200, 6, 1, 0.03);
  watchtower(-41, -231, 7, 2); watchtower(41, -231, 7, 0); watchtower(-41, -169, 7, 2); watchtower(41, -169, 7, 0);
  car(12, -190, 0, 'pGreen'); car(-14, -212, PI / 2, 'pGreen'); car(14, -228, 0, 'pGrey');
  crates(-30, -200, 2, 2, 2); crates(36, -212, 2, 1, 2); jersey(-8, -170, 'x'); jersey(8, -170, 'x'); sandbags(-8, -200, 4, 'z'); sandbags(8, -230, 4, 'x');
  barrel(-38, -215, 'pRed'); barrel(-37, -214, 'pOrange'); barrel(38, -190, 'pYellow'); barrel(37, -189, 'pRed');
  zone(mc.x, mc.z, 100, 80, 4);

  // ---------- hill fort ----------
  const fx = 200, fz = -220;
  solid('rock', fx, 0, fz, 70, 6, 56, { tile: 4, nc: true });
  addRamp(200, -172, 12, 40, 0, 6, 3);
  wedge('rock', 200, 0, -172, 40, 12, 6, 3, 4);
  zone(fx, fz, 86, 76, 4); zone(200, -172, 16, 44, 2);
  wallRun('stone', 'x', fz - 27.4, fx - 35, fx + 35, 6, 2.8, 1.2, [], 4);
  wallRun('stone', 'x', fz + 27.4, fx - 35, fx + 35, 6, 2.8, 1.2, [{ c: 200, w: 12, lo: 0, hi: 2.8 }], 4);
  wallRun('stone', 'z', fx - 34.4, fz - 28, fz + 28, 6, 2.8, 1.2, [], 4);
  wallRun('stone', 'z', fx + 34.4, fz - 28, fz + 28, 6, 2.8, 1.2, [], 4);
  for (let x = fx - 33; x <= fx + 33; x += 3) {
    solid('stone', x, 8.8, fz - 27.4, 1.4, 0.7, 1.2, { tile: 2 });
    if (Math.abs(x - 200) > 6.5) solid('stone', x, 8.8, fz + 27.4, 1.4, 0.7, 1.2, { tile: 2 });
  }
  for (let z = fz - 25; z <= fz + 25; z += 3) {
    solid('stone', fx - 34.4, 8.8, z, 1.2, 0.7, 1.4, { tile: 2 });
    solid('stone', fx + 34.4, 8.8, z, 1.2, 0.7, 1.4, { tile: 2 });
  }
  building(fx, fz - 2, 16, 14, { floors: 3, y0: 6, mk: 'stone', roofMk: 'roofB', door: 's' });
  for (const [x, z, dr] of [[174, -240, 's'], [226, -240, 's'], [174, -200, 'n'], [226, -200, 'n']]) building(x, z, 8, 8, { floors: 3, y0: 6, mk: 'stone', roofMk: 'roofB', door: dr, t: 0.35 });
  crates(190, -208, 2, 1, 1); sandbags(210, -208, 4, 'x');

  // ---------- lake, pier, cabins ----------
  solid('woodD', -200, 0, 76, 2.6, 0.3, 20, { tile: 2 });
  for (let z = 68; z <= 85; z += 4) { box('woodD', -201.5, 0, z, 0.2, 1.1, 0.2, 1); box('woodD', -198.5, 0, z, 0.2, 1.1, 0.2, 1); }
  building(-200, 56, 10, 8, { mk: 'woodR', roofMk: 'roofB', door: 's', stairs: false });
  for (let k = 0; k < 6; k++) {
    const a = 0.4 + k * 1.0, r = 62 + (k % 2) * 16, x = -200 + Math.cos(a) * r, z = 100 + Math.sin(a) * r;
    const horiz = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
    const dr = horiz ? (Math.cos(a) > 0 ? 'w' : 'e') : (Math.sin(a) > 0 ? 'n' : 's');
    building(x, z, 7, 6, { mk: k % 2 ? 'wood' : 'woodD', roofMk: 'roofB', door: dr, stairs: false, parapet: false });
  }
  zone(-200, 100, 100, 80, 2);
  car(-130, 112, 0, 'pBlue');

  // ---------- farmland ----------
  building(180, 80, 24, 14, { floors: 2, fh: 3.8, mk: 'woodR', roofMk: 'roofB', door: 's', dw: 4.5, dh: 3.4, winGap: 5 });
  building(145, 62, 12, 10, { floors: 2, mk: 'concW', roofMk: 'roof', door: 's' });
  flat('wheat', 140, 25, 28, 30, 0.012); flat('crop', 172, 25, 30, 30, 0.012); flat('plow', 202, 25, 28, 30, 0.012); flat('crop', 165, 104, 60, 14, 0.012);
  zone(170, 50, 100, 100, 4);
  fence(126, 8, 126, 42); fence(126, 42, 216, 42); fence(216, 8, 216, 42); fence(126, 8, 216, 8);
  for (let i = 0; i < 7; i++) {
    const x = 160 + (i % 4) * 4 + R() * 3, z = 97 + ((i / 4) | 0) * 3;
    geo('hay', new THREE.CylinderGeometry(0.7, 0.7, 1.2, 10), [x, 0.7, z], [0, 0, PI / 2]);
    addCollider(x, z, 1.2, 1.4, 1.4);
  }
  silo(205, 60, 2.6, 11); silo(212, 60, 2.6, 11);
  solid('brick', 205, 0, 100, 5, 10, 5, { tile: 4 });
  box('woodD', 205, 7, 102.7, 0.4, 11, 0.12, 1); box('woodD', 205, 12, 102.7, 11, 0.4, 0.12, 1);
  spots.push({ x: 172, z: 104, y: 0.4 }, { x: 150, z: 28, y: 0.4 });

  // ---------- ruins, tents, crashed plane ----------
  for (let i = 0; i < 14; i++) {
    const a = R() * PI * 2, r = 14 + R() * 30;
    ruinWall(-60 + Math.cos(a) * r, 190 + Math.sin(a) * r * 0.8, 3 + R() * 5, R() < 0.5 ? 'x' : 'z');
  }
  for (const [x, z] of [[-86, 172], [-38, 176], [-60, 156]]) {
    wedge('canvas', x - 1.1, 0, z, 2.2, 3.2, 1.9, 0); wedge('canvas', x + 1.1, 0, z, 2.2, 3.2, 1.9, 2);
    addCollider(x, z, 4.4, 1.9, 3.2);
  }
  geo('pWhite', new THREE.CylinderGeometry(1.8, 1.5, 16, 10), [-60, 1.8, 226], [0, 0, PI / 2]);
  box('pWhite', -58, 1.4, 226, 3, 0.25, 20, 2); box('pWhite', -52, 2.2, 226, 1.4, 3.2, 0.25, 2);
  addCollider(-60, 226, 16, 3.6, 3.6); addCollider(-58, 226, 3, 1.6, 20);
  zone(-60, 200, 110, 80, 3);
  spots.push({ x: -62, z: 182, y: 0.4 }, { x: -44, z: 200, y: 0.4 });

  // ---------- radio tower ----------
  watchtower(-220, -210, 14, 0);
  geo('metalD', new THREE.CylinderGeometry(0.2, 0.3, 26, 8), [-220, 14 + 13, -210]);
  addCollider(-220, -210, 0.5, 40, 0.5);
  box('lamp', -220, 40.2, -210, 0.5, 0.4, 0.5, 1);

  // ---------- the Pit (arena) ----------
  {
    const ax = ARENA.x, az = ARENA.z, H = ARENA.half, wh = 5, wt = 1.2;
    wallRun('concD', 'x', az - H, ax - H, ax + H, 0, wh, wt, [{ c: ax, w: 8, lo: 0, hi: wh }], 4);
    wallRun('concD', 'x', az + H, ax - H, ax + H, 0, wh, wt, [{ c: ax, w: 8, lo: 0, hi: wh }], 4);
    wallRun('concD', 'z', ax - H, az - H, az + H, 0, wh, wt, [], 4);
    wallRun('concD', 'z', ax + H, az - H, az + H, 0, wh, wt, [], 4);
    flat('pad', ax, az, 2 * H, 2 * H, 0.015);
    zone(ax, az, 2 * H + 10, 2 * H + 10, 2);
    solid('floor', ax, 2.75, az, 12, 0.25, 12);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      solid('metalD', ax + sx * 5, 0, az + sz * 5, 1, 2.75, 1, { tile: 2 });
      solid('conc', ax + sx * 14, 0, az + sz * 14, 2, 4, 2, { tile: 3 });
      solid('conc', ax + sx * 14, 0, az + sz * 6, 6, 1.2, 0.8, { tile: 2 });
      solid('conc', ax + sx * 8, 0, az + sz * 20, 0.8, 1.2, 6, { tile: 2 });
      crates(ax + sx * 20, az + sz * 22, 2, 1, 2);
      solid('metalD', ax, 3.0, az + sz * 5.9, 12, 0.9, 0.15, { tile: 1 });
      spots.push({ x: ax + sx * 10, z: az + sz * 10, y: 0.4 });
    }
    stairs(ax - 11, az, 0, 4, 10, 0, 3);
    stairs(ax + 11, az, 2, 4, 10, 0, 3);
    spots.push({ x: ax, z: az, y: 3.4 });
  }

  // ---------- perimeter wall ----------
  for (let i = -300; i < 300; i += 100) {
    solid('conc', i + 50, 0, -299, 100, 4, 2, { tile: 4, nc: true });
    solid('conc', i + 50, 0, 299, 100, 4, 2, { tile: 4, nc: true });
    solid('conc', -299, 0, i + 50, 2, 4, 100, { tile: 4, nc: true });
    solid('conc', 299, 0, i + 50, 2, 4, 100, { tile: 4, nc: true });
  }

  // ---------- trees + rocks (instanced) ----------
  const blocked = (x, z) => {
    for (let i = 0; i < zones.length; i++) { const q = zones[i]; if (x > q[0] && x < q[2] && z > q[1] && z < q[3]) return true; }
    return false;
  };
  const trees = [], tset = new Set();
  for (let g = 0; g < 9000 && trees.length < 520; g++) {
    const x = (R() * 2 - 1) * 288, z = (R() * 2 - 1) * 288;
    const n = Math.sin(x * 0.018 + z * 0.011) + Math.sin(z * 0.023 - x * 0.009 + 1.7), r2 = R(), s = 1.2 + R() * 0.9;
    if ((n < -0.25 && r2 > 0.07) || blocked(x, z)) continue;
    const key = Math.round(x / 4) + ',' + Math.round(z / 4);
    if (tset.has(key)) continue;
    tset.add(key);
    trees.push({ x, z, s });
  }
  const NT = trees.length;
  const trunkG = new THREE.CylinderGeometry(0.2, 0.32, 1, 7); trunkG.translate(0, 0.5, 0);
  const coneG = new THREE.ConeGeometry(1, 1, 8); coneG.translate(0, 0.5, 0);
  const barkM = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.bark, roughness: 1 });
  const leafM = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 });
  const trunk = new THREE.InstancedMesh(trunkG, barkM, NT);
  const cones = [0, 1, 2].map(() => new THREE.InstancedMesh(coneG, leafM, NT));
  const o3 = new THREE.Object3D(), tcol = new THREE.Color();
  const tiers = [[2.2, 2.1, 3.8], [3.9, 1.6, 3.4], [5.5, 1.05, 3.0]];
  trees.forEach((t, i) => {
    o3.rotation.set(0, R() * 6.28, 0);
    o3.position.set(t.x, 0, t.z);
    o3.scale.set(t.s, 5.5 * t.s, t.s);
    o3.updateMatrix();
    trunk.setMatrixAt(i, o3.matrix);
    tiers.forEach(([by, rad, h], k) => {
      o3.position.set(t.x, by * t.s, t.z);
      o3.scale.set(rad * t.s, h * t.s, rad * t.s);
      o3.updateMatrix();
      cones[k].setMatrixAt(i, o3.matrix);
      cones[k].setColorAt(i, tcol.setHSL(0.27 + R() * 0.04, 0.4, 0.2 + R() * 0.08));
    });
    addCollider(t.x, t.z, 0.5 * t.s, 7, 0.5 * t.s);
  });
  for (const m of [trunk, ...cones]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }

  const rocks = [];
  for (let g = 0; g < 1500 && rocks.length < 190; g++) {
    const x = (R() * 2 - 1) * 285, z = (R() * 2 - 1) * 285, s = 0.8 + R() * 1.8;
    if (blocked(x, z)) continue;
    rocks.push({ x, z, s, ry: R() * 6.28, sy: 0.6 + R() * 0.5 });
  }
  const rockM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8b877d, flatShading: true, roughness: 1 }), rocks.length);
  rocks.forEach((r, i) => {
    o3.rotation.set(0, r.ry, 0);
    o3.position.set(r.x, r.s * r.sy * 0.5, r.z);
    o3.scale.set(r.s, r.s * r.sy, r.s);
    o3.updateMatrix();
    rockM.setMatrixAt(i, o3.matrix);
    addCollider(r.x, r.z, r.s * 1.5, r.s * r.sy * 1.2, r.s * 1.5);
  });
  rockM.castShadow = rockM.receiveShadow = true;
  rockM.frustumCulled = false;
  scene.add(rockM);

  finish();

  // ---------- pickups ----------
  const KINDS = ['ammo', 'mats', 'ammo', 'health', 'mats'];
  const pkMat = {
    ammo: new THREE.MeshStandardMaterial({ color: 0x4d6b2f, emissive: 0x2e5a1c, emissiveIntensity: 0.9, roughness: 0.5 }),
    mats: new THREE.MeshStandardMaterial({ color: 0x3b6a8c, emissive: 0x1f4a78, emissiveIntensity: 0.9, roughness: 0.5 }),
    health: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0x9a1c1c, emissiveIntensity: 0.8, roughness: 0.5 }),
  };
  const pkGeo = new THREE.BoxGeometry(0.55, 0.38, 0.38);
  const pickups = [];
  for (const s of spots) {
    if (pickups.length >= 76) break;
    const kind = KINDS[pickups.length % KINDS.length];
    const mesh = new THREE.Mesh(pkGeo, pkMat[kind]);
    mesh.position.set(s.x, s.y, s.z);
    mesh.castShadow = true;
    scene.add(mesh);
    pickups.push({ id: pickups.length, x: s.x, z: s.z, y: s.y, kind, mesh, active: true, t: 0 });
  }
  const nearestPickup = (x, y, z, r = 1.6) => {
    let best = null, bd = r * r;
    for (const p of pickups) {
      if (!p.active || Math.abs(p.y - y) > 2.4) continue;
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const consumePickup = (p) => { if (p && p.active) { p.active = false; p.mesh.visible = false; p.t = 45; } };

  // ---------- per-frame ----------
  let clock = 0;
  function update(fx, fz, dt = 0.016) {
    clock += dt;
    const sx = Math.round(fx / 2) * 2, sz = Math.round(fz / 2) * 2;
    sun.target.position.set(sx, 0, sz);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 70);
    sun.target.updateMatrixWorld();
    sunSprite.position.set(fx, 0, fz).addScaledVector(sunDir, 150);
    halo.position.copy(sunSprite.position);
    for (const p of pickups) {
      if (!p.active) {
        p.t -= dt;
        if (p.t <= 0) { p.active = true; p.mesh.visible = true; }
        continue;
      }
      if (Math.abs(p.x - fx) > 70 || Math.abs(p.z - fz) > 70) continue;
      p.mesh.position.y = p.y + 0.1 * Math.sin(clock * 2.2 + p.id);
      p.mesh.rotation.y = clock * 1.2 + p.id;
    }
  }

  return { scene, sun, sunDir, spawns: SPAWNS, arena: ARENA, update, pickups, nearestPickup, consumePickup };
}
