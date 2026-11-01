/** Fortnite-style building: walls, floors, ramps on a 4 m grid. Snap-to-look placement, ghost preview, damage + shatter. */
import * as THREE from 'three';
import { addCollider, addRamp, removeCollider, queryRect } from './collision.js';

export const TILE = 4;
export const HEIGHT = 3;
export const SLAB = 0.25;
export const WALL_T = 0.22;
export const MAX_PIECES = 450;
export const MAX_LEVEL = 12;
export const COST = { wall: 10, floor: 10, ramp: 10 };
export const TIERS = [
  { name: 'Wood', hp: 140, tex: 'wood', color: 0xffffff },
  { name: 'Stone', hp: 280, tex: 'concrete', color: 0xffffff },
  { name: 'Metal', hp: 420, tex: 'metal', color: 0xb4c2d4 },
];
export const TYPES = ['wall', 'floor', 'ramp'];

const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const RAMP_ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

// ---------- geometry ----------
function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / 2, (uv.getY(k) * dims[f][1]) / 2);
    }
  }
  return g;
}

/** Wedge rising toward +x (low edge at x = -L/2) */
function wedgeGeo(L, W, R) {
  const x0 = -L / 2, x1 = L / 2, z0 = -W / 2, z1 = W / 2;
  const A = [x0, 0, z0], B = [x0, 0, z1], C = [x1, 0, z0], D = [x1, 0, z1], E = [x1, R, z0], F = [x1, R, z1];
  const tris = [
    [A, C, D, 'y'], [A, D, B, 'y'],
    [C, E, F, 'x'], [C, F, D, 'x'],
    [A, B, F, 's'], [A, F, E, 's'],
    [A, E, C, 'z'], [B, D, F, 'z'],
  ];
  const pos = [], uv = [];
  for (const [a, b, c, m] of tris) {
    for (const v of [a, b, c]) {
      pos.push(v[0], v[1], v[2]);
      if (m === 'y' || m === 's') uv.push(v[0] / 2, v[2] / 2);
      else if (m === 'x') uv.push(v[2] / 2, v[1] / 2);
      else uv.push(v[0] / 2, v[1] / 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// ---------- spec helpers ----------
// spec = { type, ix, iz, lv, o, tier }
//   wall:  o 0 = wall on the +x edge of tile (ix, iz) (runs along z), o 1 = wall on the +z edge (runs along x)
//   floor: o 0
//   ramp:  o = direction it rises toward (0 +x, 1 +z, 2 -x, 3 -z)
export const specKey = (s) => `${s.type}:${s.ix}:${s.iz}:${s.lv}:${s.o}`;

function specGeom(s) {
  const cx = s.ix * TILE, cz = s.iz * TILE, yb = s.lv * HEIGHT;
  let g;
  if (s.type === 'wall') {
    const along = s.o === 0;
    g = {
      x: cx + (along ? TILE / 2 : 0), z: cz + (along ? 0 : TILE / 2), y: yb + HEIGHT / 2,
      w: along ? WALL_T : TILE, h: HEIGHT, d: along ? TILE : WALL_T, y0: yb, top: yb + HEIGHT, ry: 0,
    };
  } else if (s.type === 'floor') {
    g = { x: cx, z: cz, y: yb + SLAB / 2, w: TILE, h: SLAB, d: TILE, y0: yb, top: yb + SLAB, ry: 0 };
  } else {
    g = { x: cx, z: cz, y: yb + SLAB, w: TILE, h: HEIGHT, d: TILE, y0: yb + SLAB, top: yb + SLAB + HEIGHT, ry: RAMP_ROT[s.o] };
  }
  g.minX = g.x - g.w / 2; g.maxX = g.x + g.w / 2; g.minZ = g.z - g.d / 2; g.maxZ = g.z + g.d / 2;
  return g;
}
const geoKey = (s) => (s.type === 'wall' ? 'wall' + s.o : s.type);

/**
 * hooks: onPlace(spec, piece, remote), onBreak(piece), onHit(piece), onDenied(reason: 'mats'|'occupied'|'blocked'|'level')
 */
export function createBuild(scene, tex, hooks = {}) {
  const pieces = new Map();
  const order = [];
  const geos = {
    wall0: boxGeo(WALL_T, HEIGHT, TILE),
    wall1: boxGeo(TILE, HEIGHT, WALL_T),
    floor: boxGeo(TILE, SLAB, TILE),
    ramp: wedgeGeo(TILE, TILE, HEIGHT),
  };
  const tierMats = TIERS.map((t) => new THREE.MeshStandardMaterial({
    color: t.color, map: tex[t.tex], roughness: 0.85, metalness: t.tex === 'metal' ? 0.5 : 0,
  }));
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.38, depthWrite: false });
  const ghost = new THREE.Mesh(geos.wall0, ghostMat);
  ghost.visible = false;
  ghost.renderOrder = 5;
  scene.add(ghost);

  let active = false, type = 'wall', tier = 0, mats = 300, cd = 0;
  let lastWhy = null, lastSpec = null;

  function applyTransform(m, g) {
    m.position.set(g.x, g.type === 'ramp' ? g.y0 : g.y, g.z);
    m.rotation.set(0, g.ry, 0);
  }

  // ---------- placement target ----------
  function rampUnder(p) {
    const list = queryRect(p.x - 0.1, p.z - 0.1, p.x + 0.1, p.z + 0.1);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.ramp && c.piece && p.x >= c.minX && p.x <= c.maxX && p.z >= c.minZ && p.z <= c.maxZ &&
        p.y >= c.y0 - 0.1 && p.y <= c.h + 0.5) return c.piece;
    }
    return null;
  }

  /** p = { x, y, z, yaw, pitch } (pitch > 0 = looking up) */
  function target(p) {
    const ix = Math.round(p.x / TILE), iz = Math.round(p.z / TILE);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const dir = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 0 : 2) : (fz > 0 ? 1 : 3);
    let lv = Math.max(0, Math.round((p.y - SLAB) / HEIGHT));
    const up = p.pitch > 0.45, down = p.pitch < -0.6;
    let s;
    if (type === 'wall') {
      if (up) lv++;
      s = dir === 0 ? { ix, iz, o: 0 } : dir === 1 ? { ix, iz, o: 1 } : dir === 2 ? { ix: ix - 1, iz, o: 0 } : { ix, iz: iz - 1, o: 1 };
    } else if (type === 'floor') {
      if (up) lv++;
      s = down ? { ix, iz, o: 0 } : { ix: ix + DX[dir], iz: iz + DZ[dir], o: 0 };
    } else {
      const on = rampUnder(p);
      if (on) lv = on.spec.lv + 1; // keep climbing: the next ramp starts where this one ends
      s = { ix: ix + DX[dir], iz: iz + DZ[dir], o: dir };
    }
    s.type = type; s.lv = lv; s.tier = tier;
    return s;
  }

  function check(s, free) {
    if (s.lv < 0 || s.lv > MAX_LEVEL) return 'level';
    if (pieces.has(specKey(s))) return 'occupied';
    const g = specGeom(s);
    const list = queryRect(g.minX, g.minZ, g.maxX, g.maxZ);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.piece) continue;
      if (c.y0 < g.top - 0.1 && c.h > g.y0 + 0.1) {
        const ox = Math.min(c.maxX, g.maxX) - Math.max(c.minX, g.minX);
        const oz = Math.min(c.maxZ, g.maxZ) - Math.max(c.minZ, g.minZ);
        if (ox > 0.08 && oz > 0.08) return 'blocked';
      }
    }
    if (!free && mats < COST[s.type]) return 'mats';
    return null;
  }

  // ---------- pieces ----------
  function create(s) {
    const g = specGeom(s);
    g.type = s.type;
    const mesh = new THREE.Mesh(geos[geoKey(s)], tierMats[s.tier]);
    applyTransform(mesh, g);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const piece = {
      key: specKey(s), spec: { type: s.type, ix: s.ix, iz: s.iz, lv: s.lv, o: s.o, tier: s.tier },
      mesh, col: null, hp: TIERS[s.tier].hp, maxHp: TIERS[s.tier].hp, damaged: false, geom: g,
    };
    piece.col = s.type === 'ramp'
      ? addRamp(g.x, g.z, g.w, g.d, g.y0, g.top, s.o, { piece, mesh })
      : addCollider(g.x, g.z, g.w, g.top, g.d, { y0: g.y0, piece, mesh, noCover: s.type === 'floor' });
    pieces.set(piece.key, piece);
    order.push(piece.key);
    while (pieces.size > MAX_PIECES && order.length) {
      const old = pieces.get(order.shift());
      if (old) destroy(old, true);
    }
    return piece;
  }

  function place(spec, o = {}) {
    const why = check(spec, !!o.remote);
    if (why) {
      if (!o.remote && hooks.onDenied) hooks.onDenied(why);
      return null;
    }
    if (!o.remote) mats -= COST[spec.type];
    const piece = create(spec);
    if (hooks.onPlace) hooks.onPlace(piece.spec, piece, !!o.remote);
    return piece;
  }

  // ---------- break effects ----------
  const debGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const debris = [];
  let dIdx = 0;
  function burst(piece) {
    const g = piece.geom, s = piece.spec;
    for (let i = 0; i < 10; i++) {
      let d;
      if (debris.length < 48) {
        const m = new THREE.Mesh(debGeo, tierMats[s.tier]);
        m.castShadow = true;
        scene.add(m);
        d = { m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 };
        debris.push(d);
      } else d = debris[dIdx++ % debris.length];
      d.m.material = tierMats[s.tier];
      d.m.visible = true;
      d.m.scale.setScalar(0.6 + Math.random() * 1.2);
      d.m.position.set(
        g.x + (Math.random() - 0.5) * g.w,
        (g.y0 + g.top) / 2 + (Math.random() - 0.5) * (g.top - g.y0),
        g.z + (Math.random() - 0.5) * g.d,
      );
      d.v.set((Math.random() - 0.5) * 6, 1 + Math.random() * 4, (Math.random() - 0.5) * 6);
      d.w.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      d.life = 1.3 + Math.random() * 0.6;
    }
  }
  function updateDebris(dt) {
    for (const d of debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.m.visible = false; continue; }
      d.v.y -= 12 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < 0.1) {
        d.m.position.y = 0.1;
        d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.5);
      }
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      if (d.life < 0.3) d.m.scale.multiplyScalar(1 - dt * 3);
    }
  }

  function destroy(piece, silent) {
    if (!piece || !pieces.has(piece.key)) return;
    scene.remove(piece.mesh);
    if (piece.damaged) piece.mesh.material.dispose();
    removeCollider(piece.col);
    pieces.delete(piece.key);
    if (!silent) {
      burst(piece);
      if (hooks.onBreak) hooks.onBreak(piece);
    }
  }

  /** target: a collider (from raycastWorld result .c) or a piece. Returns { destroyed, hp } or null. */
  function damage(tg, dmg) {
    const pc = tg && (tg.spec ? tg : tg.piece);
    if (!pc || !pieces.has(pc.key)) return null;
    pc.hp -= dmg;
    if (pc.hp <= 0) { destroy(pc); return { destroyed: true, hp: 0 }; }
    if (!pc.damaged) { pc.damaged = true; pc.mesh.material = tierMats[pc.spec.tier].clone(); }
    pc.mesh.material.color.set(TIERS[pc.spec.tier].color).multiplyScalar(0.4 + 0.6 * (pc.hp / pc.maxHp));
    if (hooks.onHit) hooks.onHit(pc);
    return { destroyed: false, hp: pc.hp };
  }

  // ---------- per-frame ----------
  /** p = { x, y, z, yaw, pitch }; hold = place button is down (auto-repeats) */
  function update(dt, p, hold) {
    if (mats < 300) mats = Math.min(300, mats + 6 * dt);
    cd -= dt;
    updateDebris(dt);
    if (!active || !p) { ghost.visible = false; lastSpec = null; return; }
    const s = target(p);
    const why = check(s, false);
    lastSpec = s; lastWhy = why;
    const g = specGeom(s);
    g.type = s.type;
    ghost.geometry = geos[geoKey(s)];
    applyTransform(ghost, g);
    ghostMat.color.setHex(why ? 0xff5555 : 0x55ff88);
    ghost.visible = true;
    if (hold && cd <= 0) {
      if (!why) { place(s); cd = 0.11; }
      else { if (hooks.onDenied && why !== 'occupied') hooks.onDenied(why); cd = 0.3; }
    }
  }

  /** Place whatever the ghost shows right now (for a single tap) */
  function placeNow(p) {
    const s = target(p);
    return place(s);
  }

  function setActive(on) {
    active = !!on;
    if (!active) ghost.visible = false;
  }

  function clear() {
    for (const pc of [...pieces.values()]) destroy(pc, true);
    order.length = 0;
  }

  return {
    get active() { return active; },
    get type() { return type; },
    get tier() { return tier; },
    get mats() { return Math.floor(mats); },
    get lastWhy() { return lastWhy; },
    get preview() { return lastSpec; },
    get count() { return pieces.size; },
    pieces,
    setActive,
    toggle() { setActive(!active); return active; },
    select(t) { if (TYPES.includes(t)) type = t; },
    cycleType(dir = 1) { type = TYPES[(TYPES.indexOf(type) + dir + TYPES.length) % TYPES.length]; },
    setTier(i) { tier = Math.max(0, Math.min(TIERS.length - 1, i)); },
    cycleTier() { tier = (tier + 1) % TIERS.length; return TIERS[tier].name; },
    addMats(n) { mats = Math.min(999, mats + n); },
    update,
    placeNow,
    place,
    placeRemote(spec) { return place(spec, { remote: true }); },
    damage,
    damageByKey(key, dmg) { return damage(pieces.get(key), dmg); },
    destroy: (pc) => destroy(pc, false),
    destroyByKey(key) { destroy(pieces.get(key), false); },
    pieceFromCollider: (c) => (c && c.piece) || null,
    hasKey: (k) => pieces.has(k),
    serialize() { return [...pieces.values()].map((p) => ({ ...p.spec })); },
    clear,
  };
}
