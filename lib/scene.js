/**
 * The big map: real terrain, POIs, roads, forests, rocks, grass and pickups.
 * Deterministic (seeded) so every client builds the same world and collision.
 * Returns { scene, sun, sunDir, spawns, arena, pois, update(fx, fz, dt), setDetail, pickups, nearestPickup, consumePickup }.
 */
import * as THREE from 'three';
import { addCollider, clearColliders } from './collision.js';
import { heightAt } from './ground.js';
import { makeRng } from './rng.js';
import { createBuilder } from './sceneBuild.js';
import { createTerrainMesh } from './terrainMesh.js';
import { ARENA, POIS, ROADS } from './mapLayout.js';
import { buildPoi } from './poiBuilders.js';
import { MAP_HALF, WATER_Y } from './terrain.js';

const PI = Math.PI;
export { ARENA };

const at = (x, z, yaw = 0) => ({ x, z, yaw, y: heightAt(x, z) });
const poi = (name) => POIS.find((p) => p.name === name);
const near = (name, dx, dz, yaw = 0) => {
  const p = poi(name);
  return at(p.x + dx, p.z + dz, yaw);
};

export const SPAWNS = {
  player: [at(0, 8), at(-6, 9), at(6, 9), at(0, 12)],
  enemy: [
    near('Port Haven', 0, 40), near('Iron Works', -40, 0), near('Fort Keller', 0, 60), near('Green Acres', 40, 0),
    near('Hill Fort', -60, 0), near('Standing Stones', 0, -60), near('Mercy Airfield', 0, -40), near('Ridgeback Camp', 30, 30),
    near('Summit Lodge', 20, -20), near('Granite Quarry', 0, 40),
  ],
  ffa: [
    near('Crossroads', 0, 14), near('Port Haven', 20, 0), near('Iron Works', 40, 0), near('Fort Keller', 0, -60),
    near('Hill Fort', 0, 20), near('Lakeside', -20, -20), near('Green Acres', 60, 0), near('Standing Stones', 30, 0),
    near('Sky Tower', 8, 0), near('Granite Quarry', -40, 0), near('Mercy Airfield', 40, 0), near('Summit Lodge', -20, 0),
    near('Ridgeback Camp', -40, 0), near('Crossroads', -30, 0), near('Iron Works', -30, 30),
  ],
  teamA: [at(ARENA.x - 26, ARENA.z - 5, -PI / 2), at(ARENA.x - 26, ARENA.z + 5, -PI / 2), at(ARENA.x - 28, ARENA.z - 12, -PI / 2), at(ARENA.x - 28, ARENA.z + 12, -PI / 2)],
  teamB: [at(ARENA.x + 26, ARENA.z - 5, PI / 2), at(ARENA.x + 26, ARENA.z + 5, PI / 2), at(ARENA.x + 28, ARENA.z - 12, PI / 2), at(ARENA.x + 28, ARENA.z + 12, PI / 2)],
  duelA: at(ARENA.x - 26, ARENA.z, -PI / 2),
  duelB: at(ARENA.x + 26, ARENA.z, PI / 2),
};

const LEVEL_GRASS_N = 120000;
const TREE_BASE = 1400, TREE_MAX = 2400, ROCK_BASE = 700, ROCK_MAX = 1000;

function slopeAt(x, z) {
  const dx = (heightAt(x + 2, z) - heightAt(x - 2, z)) / 4;
  const dz = (heightAt(x, z + 2) - heightAt(x, z - 2)) / 4;
  return Math.hypot(dx, dz);
}

function distToRoads(x, z, segs) {
  let best = Infinity;
  for (const [x0, z0, x1, z1] of segs) {
    const vx = x1 - x0, vz = z1 - z0, L2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / L2));
    best = Math.min(best, Math.hypot(x0 + vx * t - x, z0 + vz * t - z));
  }
  return best;
}

function forestNoise(x, z) {
  return Math.sin(x * 0.0031 + z * 0.0017) + Math.sin(z * 0.0047 - x * 0.0023 + 1.7) + 0.6 * Math.sin((x + z) * 0.0113 + 0.4);
}

export function createWorld(renderer, tex) {
  clearColliders();
  const scene = new THREE.Scene();
  scene.background = tex.sky;
  scene.fog = new THREE.Fog(0xd3e0ea, 160, 720);

  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(tex.sky).texture;
  scene.environmentIntensity = 0.65;
  pm.dispose();

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 0.75));
  const sunDir = new THREE.Vector3(25, 40, 12).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 220;
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

  scene.add(createTerrainMesh(tex));

  const b = createBuilder(scene, tex);
  const { blocked } = b;

  // road centrelines (known first so town/minor buildings can stay off the roads)
  const roadSegs = [];
  for (const [i, j] of ROADS) roadSegs.push([POIS[i].x, POIS[i].z, POIS[j].x, POIS[j].z]);
  b.setRoads(roadSegs);

  POIS.forEach((p, i) => buildPoi(b, p, i));

  // roads: continuous ribbons draped over the ground, skipping building footprints and water
  const skip = (x, z) => b.inRect(x, z) || heightAt(x, z) < WATER_Y + 0.25;
  const nodes = new Set();
  for (const [i, j] of ROADS) {
    const A = POIS[i], B = POIS[j];
    b.road('road', A.x, A.z, B.x, B.z, 7, { skip });
    b.roadMarks('mark', A.x, A.z, B.x, B.z, { skip });
    nodes.add(i); nodes.add(j);
  }
  for (const i of nodes) {
    const p = POIS[i];
    if (!skip(p.x, p.z)) b.disc('roadJ', p.x, p.z, 4.1); // junction patch so every road meets cleanly
  }

  const rng = makeRng(1337);
  const trees = [], tkeys = new Set();
  for (let g = 0; g < 80000 && trees.length < TREE_MAX; g++) {
    const x = (rng() * 2 - 1) * (MAP_HALF - 20), z = (rng() * 2 - 1) * (MAP_HALF - 20);
    const r2 = rng(), s = 1.2 + rng() * 0.9, ry = rng() * 6.28;
    const h = heightAt(x, z);
    if (forestNoise(x, z) < 0.15 && r2 > 0.04) continue;
    if (h < WATER_Y + 1.2 || h > 95 || slopeAt(x, z) > 0.55) continue;
    if (blocked(x, z) || distToRoads(x, z, roadSegs) < 6) continue;
    const key = Math.round(x / 4) + ',' + Math.round(z / 4);
    if (tkeys.has(key)) continue;
    tkeys.add(key);
    trees.push({ x, z, s, ry, h });
  }
  const NT = trees.length;
  const NT0 = Math.min(TREE_BASE, NT);

  const trunkG = new THREE.CylinderGeometry(0.2, 0.32, 1, 7); trunkG.translate(0, 0.5, 0);
  const coneLoG = new THREE.ConeGeometry(1, 1, 8); coneLoG.translate(0, 0.5, 0);
  const coneHiG = new THREE.ConeGeometry(1, 1, 14); coneHiG.translate(0, 0.5, 0);
  const barkM = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.bark, roughness: 1 });
  const leafM = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 });
  const trunk = new THREE.InstancedMesh(trunkG, barkM, NT);
  const loCones = [0, 1, 2].map(() => new THREE.InstancedMesh(coneLoG, leafM, NT));
  const hiCones = [0, 1, 2, 3].map(() => new THREE.InstancedMesh(coneHiG, leafM, NT));
  const o3 = new THREE.Object3D(), tcol = new THREE.Color();
  const tiers = [[2.2, 2.1, 3.8], [3.9, 1.6, 3.4], [5.5, 1.05, 3.0], [7.0, 0.7, 2.4]];
  trees.forEach((t, i) => {
    o3.rotation.set(0, t.ry, 0);
    o3.position.set(t.x, t.h - 0.15, t.z); // trunk base sunk a little so it never hovers on a slope
    o3.scale.set(t.s, 5.5 * t.s, t.s);
    o3.updateMatrix();
    trunk.setMatrixAt(i, o3.matrix);
    let color = null;
    const rnd = makeRng(i * 7919 + 17);
    tiers.forEach(([by, rad, hh], k) => {
      o3.position.set(t.x, t.h + by * t.s, t.z);
      o3.scale.set(rad * t.s, hh * t.s, rad * t.s);
      o3.updateMatrix();
      if (k < 3) {
        color = tcol.setHSL(0.27 + rnd() * 0.04, 0.4, 0.2 + rnd() * 0.08);
        loCones[k].setMatrixAt(i, o3.matrix);
        loCones[k].setColorAt(i, color);
      }
      hiCones[k].setMatrixAt(i, o3.matrix);
      hiCones[k].setColorAt(i, color);
    });
    addCollider(t.x, t.z, 0.5 * t.s, t.h + 7 * t.s, 0.5 * t.s, { y0: t.h });
  });
  for (const m of [trunk, ...loCones, ...hiCones]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }

  const rocks = [];
  const rockRng = makeRng(9001);
  for (let g = 0; g < 30000 && rocks.length < ROCK_MAX; g++) {
    const x = (rockRng() * 2 - 1) * (MAP_HALF - 20), z = (rockRng() * 2 - 1) * (MAP_HALF - 20);
    const s = 0.8 + rockRng() * 1.8, ry = rockRng() * 6.28, sy = 0.6 + rockRng() * 0.5;
    if (blocked(x, z) || distToRoads(x, z, roadSegs) < 4) continue;
    rocks.push({ x, z, s, ry, sy, h: heightAt(x, z) });
  }
  const NR = rocks.length;
  const NR0 = Math.min(ROCK_BASE, NR);
  const rockM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8b877d, flatShading: true, roughness: 1 }), NR);
  rocks.forEach((r, i) => {
    o3.rotation.set(0, r.ry, 0);
    o3.position.set(r.x, r.h + r.s * r.sy * 0.3, r.z); // half-buried
    o3.scale.set(r.s, r.s * r.sy, r.s);
    o3.updateMatrix();
    rockM.setMatrixAt(i, o3.matrix);
    addCollider(r.x, r.z, r.s * 1.5, r.h + r.s * r.sy * 1.2, r.s * 1.5, { y0: r.h });
  });
  rockM.castShadow = rockM.receiveShadow = true;
  rockM.frustumCulled = false;
  scene.add(rockM);

  const windU = { value: 0 };
  const bladePos = [], bladeCol = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * PI) / 3, cx = Math.cos(a) * 0.05, cz = Math.sin(a) * 0.05;
    bladePos.push(-cx, 0, -cz, cx, 0, cz, 0, 0.6, 0);
    bladeCol.push(0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 1, 1, 1);
  }
  const grassG = new THREE.BufferGeometry();
  grassG.setAttribute('position', new THREE.Float32BufferAttribute(bladePos, 3));
  grassG.setAttribute('color', new THREE.Float32BufferAttribute(bladeCol, 3));
  const grassM = new THREE.MeshStandardMaterial({ color: 0x7aa048, vertexColors: true, side: THREE.DoubleSide, roughness: 1 });
  grassM.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windU;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 gp = vec3(instanceMatrix[3]);
      float sway = sin(uWind * 1.7 + gp.x * 0.35 + gp.z * 0.27) * 0.12 * position.y;
      transformed.x += sway; transformed.z += sway * 0.5;`);
  };
  const grass = new THREE.InstancedMesh(grassG, grassM, LEVEL_GRASS_N);
  const grassRng = makeRng(2024);
  let gi = 0;
  for (let g = 0; g < LEVEL_GRASS_N * 4 && gi < LEVEL_GRASS_N; g++) {
    const x = (grassRng() * 2 - 1) * (MAP_HALF - 20), z = (grassRng() * 2 - 1) * (MAP_HALF - 20);
    const ry = grassRng() * 6.28, s = 0.7 + grassRng() * 0.8, hy = 0.8 + grassRng() * 0.5;
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.3 || h > 110 || slopeAt(x, z) > 0.7 || blocked(x, z)) continue;
    if (forestNoise(x, z) > 0.9) continue;
    if (distToRoads(x, z, roadSegs) < 4.2) continue; // keep the road surface clear
    o3.rotation.set(0, ry, 0);
    o3.position.set(x, h, z);
    o3.scale.set(s, s * hy, s);
    o3.updateMatrix();
    grass.setMatrixAt(gi, o3.matrix);
    grass.setColorAt(gi, tcol.setHSL(0.2 + grassRng() * 0.07, 0.45, 0.26 + grassRng() * 0.14));
    gi++;
  }
  grass.receiveShadow = true;
  grass.frustumCulled = false;
  scene.add(grass);

  // Detail levels: 0 off, 1 normal, 2 high, 3 ultra. Only counts change, so this is live.
  const LEVELS = [
    { grass: 0, trees: NT0, hi: false, top: false, rocks: NR0 },
    { grass: 30000, trees: NT0, hi: false, top: false, rocks: NR0 },
    { grass: 70000, trees: Math.min(NT, NT0 + 500), hi: true, top: false, rocks: Math.min(NR, NR0 + 150) },
    { grass: LEVEL_GRASS_N, trees: NT, hi: true, top: true, rocks: NR },
  ];
  function setDetail(level) {
    const L = LEVELS[Math.max(0, Math.min(3, level | 0))];
    grass.count = Math.min(L.grass, gi);
    trunk.count = L.trees;
    for (const m of loCones) m.count = L.hi ? 0 : L.trees;
    hiCones.forEach((m, k) => { m.count = L.hi && (k < 3 || L.top) ? L.trees : 0; });
    rockM.count = L.rocks;
  }
  setDetail(1);

  b.finish();

  const KINDS = ['ammo', 'mats', 'ammo', 'health', 'mats'];
  const pkMat = {
    ammo: new THREE.MeshStandardMaterial({ color: 0x4d6b2f, emissive: 0x2e5a1c, emissiveIntensity: 0.9, roughness: 0.5 }),
    mats: new THREE.MeshStandardMaterial({ color: 0x3b6a8c, emissive: 0x1f4a78, emissiveIntensity: 0.9, roughness: 0.5 }),
    health: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0x9a1c1c, emissiveIntensity: 0.8, roughness: 0.5 }),
  };
  const pkGeo = new THREE.BoxGeometry(0.55, 0.38, 0.38);
  const pickups = [];
  for (const s of b.spots) {
    if (pickups.length >= 140) break;
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

  let clock = 0;
  function update(fx, fz, dt = 0.016) {
    clock += dt;
    windU.value = clock;
    const sx = Math.round(fx / 2) * 2, sz = Math.round(fz / 2) * 2;
    sun.target.position.set(sx, 0, sz);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 90);
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

  return { scene, sun, sunDir, spawns: SPAWNS, arena: ARENA, pois: POIS, update, setDetail, pickups, nearestPickup, consumePickup };
}
