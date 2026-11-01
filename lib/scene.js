/** Map: textured ground, shipping containers, crates, barriers, sandbags, walls, trees, sky + sun + shadows */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addCollider, clearColliders } from './collision.js';

export const SPAWNS = {
  player: [{ x: 0, z: 8 }, { x: -6, z: 9 }, { x: 6, z: 9 }, { x: 0, z: 12 }],
  enemy: [{ x: -10, z: -34 }, { x: 0, z: -36 }, { x: 10, z: -34 }, { x: -16, z: -28 }, { x: 26, z: -26 }],
};

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

/** Scale box UVs so one texture tile = `tile` metres on every face */
function boxUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function planeUV(geo, w, d, tile) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile);
  uv.needsUpdate = true;
  return geo;
}

export function createWorld(renderer, tex) {
  clearColliders();
  const R = rng(1337);
  const scene = new THREE.Scene();
  scene.background = tex.sky;
  scene.fog = new THREE.Fog(0xd3e0ea, 45, 165);

  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(tex.sky).texture;
  scene.environmentIntensity = 0.65;
  pm.dispose();

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 0.7));
  const sunDir = new THREE.Vector3(25, 40, 12).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 140;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const sunMat = (s, o) => new THREE.SpriteMaterial({
    map: tex.glow, color: 0xfff4cf, transparent: true, opacity: o,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const sunSprite = new THREE.Sprite(sunMat(1, 1));
  sunSprite.scale.setScalar(40);
  const halo = new THREE.Sprite(sunMat(1, 0.28));
  halo.scale.setScalar(140);
  scene.add(sunSprite, halo);

  // ---------- materials ----------
  const mat = (o) => new THREE.MeshStandardMaterial(o);
  const concreteM = mat({ color: 0xffffff, map: tex.concrete, roughness: 0.95 });
  const woodM = mat({ color: 0xffffff, map: tex.wood, roughness: 0.82 });
  const darkM = mat({ color: 0x26292c, roughness: 0.6, metalness: 0.7 });
  const paintCache = {};
  const paint = (c) => (paintCache[c] ||= mat({ color: c, map: tex.metal, roughness: 0.5, metalness: 0.65 }));

  function box(x, y, z, w, h, d, material, tile, parent = scene) {
    const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, tile), material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // ---------- ground, pad, road ----------
  tex.grass.repeat.set(140, 140);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    mat({ color: 0xffffff, map: tex.grass, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  function flat(x, z, w, d, color, tile, y) {
    const m = new THREE.Mesh(
      planeUV(new THREE.PlaneGeometry(w, d), w, d, tile),
      mat({ color, map: tex.concrete, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
  }
  flat(0, -16, 46, 42, 0xffffff, 3, 0.01); // concrete pad
  flat(0, -30, 7, 150, 0x8a7757, 3, 0.012); // dirt road

  // ---------- props ----------
  function container(x, z, axis, color) {
    const L = 6.1, H = 2.6, W = 2.45;
    const g = new THREE.Group();
    box(0, H / 2, 0, L, H, W, paint(color), 2.4, g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * (L / 2 - 0.06), H / 2, sz * (W / 2 - 0.06), 0.12, H + 0.02, 0.12, darkM, 1, g);
    for (const sy of [0.04, H - 0.04]) for (const sz of [-1, 1]) box(0, sy, sz * (W / 2 - 0.05), L, 0.1, 0.1, darkM, 1, g);
    for (const sz of [-1, 1]) box(L / 2 + 0.015, H / 2, sz * 0.57, 0.03, H - 0.3, 1.1, paint(color), 2.4, g);
    for (const sz of [-0.85, -0.3, 0.3, 0.85]) box(L / 2 + 0.04, H / 2, sz, 0.02, H - 0.35, 0.03, darkM, 1, g);
    g.position.set(x, 0, z);
    if (axis === 'z') g.rotation.y = Math.PI / 2;
    scene.add(g);
    addCollider(x, z, axis === 'x' ? L : W, H, axis === 'x' ? W : L);
  }

  function crates(x, z, nx, nz, levels, extra = false) {
    const s = 1.2, e = s - 0.03;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) for (let k = 0; k < levels; k++) {
      box(x + (i - (nx - 1) / 2) * s, s / 2 + k * s, z + (j - (nz - 1) / 2) * s, e, e, e, woodM, s);
    }
    if (extra) {
      const m = box(x - ((nx - 1) / 2) * s, s / 2 + levels * s, z - ((nz - 1) / 2) * s, e, e, e, woodM, s);
      m.rotation.y = 0.25;
    }
    addCollider(x, z, nx * s, (levels + (extra ? 1 : 0)) * s, nz * s);
  }

  function barrier(x, z, axis = 'x') {
    const L = 3, W = 0.7;
    const g = new THREE.Group();
    box(0, 0.18, 0, L, 0.36, W, concreteM, 2, g);
    box(0, 0.68, 0, L, 0.64, 0.42, concreteM, 2, g);
    g.position.set(x, 0, z);
    if (axis === 'z') g.rotation.y = Math.PI / 2;
    scene.add(g);
    addCollider(x, z, axis === 'x' ? L : W, 1.0, axis === 'x' ? W : L);
  }

  const bagG = new RoundedBoxGeometry(0.52, 0.22, 0.34, 2, 0.08);
  const bagM = mat({ color: 0xd9c48c, map: tex.nylon, roughness: 1 });
  function sandbags(x, z, len, axis = 'x') {
    const per = Math.ceil(len / 0.5), rows = 5, cols = 2;
    const im = new THREE.InstancedMesh(bagG, bagM, per * rows * cols);
    const o = new THREE.Object3D(), col = new THREE.Color();
    let i = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (let k = 0; k < per; k++) {
      const u = (k - (per - 1) / 2) * 0.5 + (r % 2 ? 0.25 : 0) + (R() - 0.5) * 0.03;
      const v = (c - 0.5) * 0.34;
      o.position.set(axis === 'x' ? u : v, 0.11 + r * 0.22, axis === 'x' ? v : u);
      o.rotation.set(0, (axis === 'x' ? 0 : Math.PI / 2) + (R() - 0.5) * 0.12, 0);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
      const s = 0.8 + R() * 0.25;
      im.setColorAt(i, col.setRGB(s, s * 0.97, s * 0.9));
      i++;
    }
    im.position.set(x, 0, z);
    im.castShadow = im.receiveShadow = true;
    scene.add(im);
    addCollider(x, z, axis === 'x' ? len + 0.2 : 0.72, 1.12, axis === 'x' ? 0.72 : len + 0.2);
  }

  function ruinedWall(x, z, len, axis = 'x') {
    const t = 0.4, a = len * 0.62, b = len * 0.38;
    const piece = (u0, l, h) => {
      const cx = axis === 'x' ? x + u0 : x, cz = axis === 'x' ? z : z + u0;
      const w = axis === 'x' ? l : t, d = axis === 'x' ? t : l;
      box(cx, h / 2, cz, w, h, d, concreteM, 3);
      addCollider(cx, cz, w, h, d);
    };
    piece(-len / 2 + a / 2, a, 2.8);
    piece(len / 2 - b / 2, b, 1.4);
  }

  function barrel(x, z, color) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), paint(color));
    m.position.set(x, 0.45, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    for (const y of [0.12, 0.45, 0.78]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.014, 6, 20), darkM);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, y, z);
      scene.add(ring);
    }
    addCollider(x, z, 0.6, 0.9, 0.6);
  }

  // ---------- layout ----------
  container(-13, -8, 'x', 0x3b6a8c);
  container(13, -13, 'z', 0x93402f);
  container(-2, -24, 'x', 0x55743a);
  container(19, -32, 'z', 0xb8892f);
  container(-20, -30, 'z', 0x6d7479);

  crates(-4, -12, 2, 2, 1, true);
  crates(6, -6, 1, 2, 2);
  crates(-26, -12, 2, 1, 1, true);
  crates(8, -26, 2, 2, 1, true);
  crates(25, -16, 3, 1, 1);

  barrier(-12, 1); barrier(12, 1);
  barrier(-7, -18); barrier(5, -19);
  barrier(-22, -4, 'z'); barrier(24, -8, 'z');

  sandbags(-8, -15, 5);
  sandbags(10, -20, 4, 'z');
  sandbags(0, -30, 6);
  sandbags(-8, -22, 3, 'z');

  ruinedWall(-24, -20, 8);
  ruinedWall(22, -22, 7, 'z');

  barrel(-17, -12, 0x93402f); barrel(-18, -11.1, 0x3b6a8c);
  barrel(16, -18, 0x55743a); barrel(3, -34, 0xb8892f); barrel(-11, -28, 0x93402f);

  // perimeter walls
  const E = 96, T = 1.0, H = 3.4;
  const pw = (x, z, w, d) => {
    box(x, H / 2, z, w, H, d, concreteM, 3);
    addCollider(x, z, w, H, d, { noCover: true });
  };
  pw(0, -E, 2 * E + 2, T); pw(0, E, 2 * E + 2, T);
  pw(-E, 0, T, 2 * E + 2); pw(E, 0, T, 2 * E + 2);

  // ---------- trees (instanced) ----------
  const trees = [];
  for (let guard = 0; trees.length < 90 && guard < 3000; guard++) {
    const a = R() * Math.PI * 2, r = 48 + R() * 42;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) > 88 || Math.abs(z) > 88) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 4)) continue;
    trees.push({ x, z, s: 1.2 + R() * 0.9 });
  }
  const N = trees.length;
  const trunkG = new THREE.CylinderGeometry(0.2, 0.32, 1, 7); trunkG.translate(0, 0.5, 0);
  const coneG = new THREE.ConeGeometry(1, 1, 8); coneG.translate(0, 0.5, 0);
  const barkM = mat({ color: 0xffffff, map: tex.bark, roughness: 1 });
  const leafM = mat({ color: 0xffffff, flatShading: true, roughness: 0.95 });
  const trunk = new THREE.InstancedMesh(trunkG, barkM, N);
  const cones = [0, 1, 2].map(() => new THREE.InstancedMesh(coneG, leafM, N));
  const o = new THREE.Object3D(), col = new THREE.Color();
  const tiers = [[2.2, 2.1, 3.8], [3.9, 1.6, 3.4], [5.5, 1.05, 3.0]]; // base y, radius, height
  trees.forEach((t, i) => {
    const s = t.s, yaw = R() * 6.28;
    o.rotation.set(0, yaw, 0);
    o.position.set(t.x, 0, t.z);
    o.scale.set(s, 5.5 * s, s);
    o.updateMatrix();
    trunk.setMatrixAt(i, o.matrix);
    tiers.forEach(([by, rad, h], k) => {
      o.position.set(t.x, by * s, t.z);
      o.scale.set(rad * s, h * s, rad * s);
      o.updateMatrix();
      cones[k].setMatrixAt(i, o.matrix);
      cones[k].setColorAt(i, col.setHSL(0.27 + R() * 0.04, 0.4, 0.2 + R() * 0.08));
    });
    addCollider(t.x, t.z, 0.5 * s, 7, 0.5 * s);
  });
  for (const m of [trunk, ...cones]) {
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // ---------- per-frame ----------
  function update(fx, fz) {
    const sx = Math.round(fx / 2) * 2, sz = Math.round(fz / 2) * 2;
    sun.target.position.set(sx, 0, sz);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 70);
    sun.target.updateMatrixWorld();
    sunSprite.position.set(fx, 0, fz).addScaledVector(sunDir, 150);
    halo.position.copy(sunSprite.position);
  }

  return { scene, sun, sunDir, spawns: SPAWNS, update };
}
