/**
 * The physical main lobby: a sealed hall floating at y = 400 above the map's SW corner, so it never collides
 * with the ground game. Portals start modes, pedestals equip weapons, a range tests them.
 * Call AFTER createWorld() (which clears all colliders). Same scene as the world.
 * update(dt, player, interact) returns null | { type:'portal', mode } | { type:'equip', slot, id }
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addCollider } from './collision.js';
import { ALL, SLOTS, bySlot, reloadDuration } from './arsenal.js';
import { buildWeapon } from './weaponModels.js';
import { makeMaterials } from './parts.js';
import { loadout, setSlot } from './loadout.js';
import { MODES } from './modes.js';

export const LOBBY = { x: -240, y: 400, z: 240, w: 60, d: 44, h: 9 };
export const LOBBY_SPAWN = { x: LOBBY.x, y: LOBBY.y, z: LOBBY.z + 16, yaw: 0 };

const PI = Math.PI;
const PORTALS = [['ffa', -21], ['duel', -7], ['team', 7], ['bots', 21]];
const ROW_Z = [-6, 4, 14];
const COL_X = [-24, -20, -16, -12, -8];
const SLOT_COLOR = { main: 0xff8a2b, side: 0x4aa8ff, melee: 0xd05bff };
const SLOT_NAME = { main: 'MAIN', side: 'SECONDARY', melee: 'MELEE' };
const HOLD = 1.2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rgb = (n) => `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function boxGeo(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile);
  }
  return g;
}

function floorTextures(w, d) {
  const S = 256, [c, x] = cv(S, S), [e, y] = cv(S, S);
  x.fillStyle = '#161b22'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; x.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
  x.strokeStyle = '#27323f'; x.lineWidth = 4; x.strokeRect(0, 0, S, S);
  y.fillStyle = '#000'; y.fillRect(0, 0, S, S);
  y.strokeStyle = '#1b6fa0'; y.lineWidth = 3; y.strokeRect(1.5, 1.5, S - 3, S - 3);
  const m = canvasTex(c), g = canvasTex(e);
  for (const t of [m, g]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / 4, d / 4); }
  return { map: m, glow: g };
}

function swirlTexture(color) {
  const S = 256, [c, x] = cv(S, S), col = rgb(color);
  x.translate(S / 2, S / 2);
  const g = x.createRadialGradient(0, 0, 10, 0, 0, S / 2);
  g.addColorStop(0, `rgba(${col},0.05)`); g.addColorStop(0.7, `rgba(${col},0.35)`); g.addColorStop(1, `rgba(${col},0.7)`);
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, S / 2, 0, PI * 2); x.fill();
  x.lineCap = 'round';
  for (const [style, lw] of [[`rgba(${col},0.8)`, 12], ['rgba(255,255,255,0.4)', 5]]) {
    x.strokeStyle = style; x.lineWidth = lw;
    for (let k = 0; k < 5; k++) {
      x.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, r = t * (S / 2 - 10), a = (k / 5) * PI * 2 + t * 3.4;
        if (i === 0) x.moveTo(Math.cos(a) * r, Math.sin(a) * r); else x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.stroke();
    }
  }
  x.strokeStyle = `rgba(${col},0.95)`; x.lineWidth = 6; x.beginPath(); x.arc(0, 0, S / 2 - 5, 0, PI * 2); x.stroke();
  const t = canvasTex(c);
  t.center.set(0.5, 0.5);
  return t;
}

function targetTexture() {
  const [c, x] = cv(256, 384);
  x.fillStyle = '#e9e4d6'; x.fillRect(0, 0, 256, 384);
  x.strokeStyle = '#222'; x.lineWidth = 8; x.strokeRect(4, 4, 248, 376);
  [110, 82, 54, 28].forEach((r, i) => {
    x.fillStyle = i % 2 ? '#e9e4d6' : '#c2382b';
    x.beginPath(); x.arc(128, 190, r, 0, PI * 2); x.fill();
    x.strokeStyle = '#222'; x.lineWidth = 3; x.stroke();
  });
  x.fillStyle = '#111'; x.beginPath(); x.arc(128, 190, 8, 0, PI * 2); x.fill();
  return canvasTex(c);
}

function sign(title, sub, w, h, color = 0x2fb7ff) {
  const px = 512, py = Math.round((512 * h) / w), [c, x] = cv(px, py);
  x.fillStyle = 'rgba(8,12,18,0.88)'; x.fillRect(0, 0, px, py);
  x.strokeStyle = hex(color); x.lineWidth = 8; x.strokeRect(4, 4, px - 8, py - 8);
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  x.font = `800 ${sub ? py * 0.4 : py * 0.5}px system-ui, sans-serif`;
  x.fillText(title, px / 2, sub ? py * 0.38 : py * 0.52, px - 40);
  if (sub) {
    x.fillStyle = hex(color); x.font = `600 ${py * 0.19}px system-ui, sans-serif`;
    x.fillText(sub, px / 2, py * 0.76, px - 40);
  }
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex(c), toneMapped: false, side: THREE.DoubleSide }));
}

function statLine(d) {
  if (d.kind === 'melee') return d.blurb;
  const per = d.pellets > 1 ? `${d.pellets}×` : '', k = (v) => (v >= 100 ? 'KILL' : `${per}${v}`);
  return `Head ${k(d.dmg.head)} · Body ${k(d.dmg.body)} · ${d.mag}/${d.total} ammo · reload ${reloadDuration(d, d.mag).toFixed(1)}s`;
}

export function createLobby(scene, tex, hooks = {}) {
  const L = LOBBY, X = (v) => L.x + v, Y = (v) => L.y + v, Z = (v) => L.z + v;
  const M = makeMaterials(tex);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
  const wallM = std({ color: 0x59616b, map: tex.concrete, roughness: 0.9 });
  const darkM = std({ color: 0x232a32, map: tex.metal, roughness: 0.5, metalness: 0.6 });
  const baseM = std({ color: 0x343c46, map: tex.metal, roughness: 0.45, metalness: 0.7 });
  const ceilM = std({ color: 0x1b2027, roughness: 0.9 });
  const root = new THREE.Group();
  scene.add(root);

  const mesh = (geo, mtl, x, y, z) => { const m = new THREE.Mesh(geo, mtl); m.position.set(x, y, z); root.add(m); return m; };
  const solid = (mtl, cx, y0, cz, w, h, d, tile = 3) => {
    mesh(boxGeo(w, h, d, tile), mtl, cx, y0 + h / 2, cz);
    return addCollider(cx, cz, w, y0 + h, d, { y0, noCover: true });
  };
  const glow = (color, cx, cy, cz, w, h, d) => mesh(new THREE.BoxGeometry(w, h, d), basic({ color }), cx, cy, cz);
  const put = (m, x, y, z, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; root.add(m); return m; };

  // ---------- shell ----------
  const ft = floorTextures(L.w, L.d);
  const floor = mesh(new THREE.PlaneGeometry(L.w, L.d), std({
    color: 0xffffff, map: ft.map, emissive: 0xffffff, emissiveMap: ft.glow, roughness: 0.4, metalness: 0.5,
  }), X(0), Y(0.01), Z(0));
  floor.rotation.x = -PI / 2;
  addCollider(X(0), Z(0), L.w + 4, Y(0), L.d + 4, { y0: Y(-1.5), noCover: true });
  solid(wallM, X(0), Y(-1), Z(-23), 64, L.h + 2, 2, 4);
  solid(wallM, X(0), Y(-1), Z(23), 64, L.h + 2, 2, 4);
  solid(wallM, X(-31), Y(-1), Z(0), 2, L.h + 2, 48, 4);
  solid(wallM, X(31), Y(-1), Z(0), 2, L.h + 2, 48, 4);
  solid(ceilM, X(0), Y(L.h), Z(0), 64, 1, 48, 4);
  for (let ix = -24; ix <= 24; ix += 12) for (const iz of [-12, 0, 12]) glow(0xdff1ff, X(ix), Y(L.h - 0.07), Z(iz), 7, 0.12, 1.4);
  for (const [cx, cz, w, d] of [[0, -21.95, 60, 0.1], [0, 21.95, 60, 0.1], [-29.95, 0, 0.1, 44], [29.95, 0, 0.1, 44]]) glow(0x2fb7ff, X(cx), Y(0.2), Z(cz), w, 0.12, d);

  // ---------- portals ----------
  const portals = PORTALS.map(([id, rx], i) => {
    const mode = MODES[id], px = X(rx), pz = Z(-21), col = mode.color;
    solid(darkM, px - 3.4, Y(0), pz, 0.9, 6.2, 1.2, 1.5);
    solid(darkM, px + 3.4, Y(0), pz, 0.9, 6.2, 1.2, 1.5);
    solid(darkM, px, Y(5.9), pz, 7.7, 0.9, 1.2, 1.5);
    glow(col, px - 2.9, Y(2.95), pz + 0.5, 0.08, 5.9, 0.08);
    glow(col, px + 2.9, Y(2.95), pz + 0.5, 0.08, 5.9, 0.08);
    glow(col, px, Y(5.85), pz + 0.5, 5.8, 0.08, 0.08);
    const swirl = swirlTexture(col);
    mesh(new THREE.PlaneGeometry(5.8, 5.9), basic({ map: swirl, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), px, Y(2.95), pz);
    const pad = mesh(new THREE.CircleGeometry(3.1, 40), basic({ color: col, transparent: true, opacity: 0.25, depthWrite: false }), px, Y(0.04), pz + 4.2);
    pad.rotation.x = -PI / 2;
    put(sign(mode.name, mode.short, 6.8, 1.6, col), px, Y(7.8), Z(-21.85));
    return { id, x: px, mode, swirl, dir: i % 2 ? -1 : 1 };
  });

  // ---------- armory ----------
  const fistsDisplay = () => {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.09, 0.12, 2, 0.03), M.glove);
      f.position.set(sx * 0.1, 0, 0);
      g.add(f);
      for (let i = 0; i < 4; i++) {
        const k = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), M.glove);
        k.position.set(sx * 0.1 - 0.03 + i * 0.02, 0.01, -0.065);
        g.add(k);
      }
    }
    return g;
  };
  const displayFor = (def) => {
    const wrap = new THREE.Group();
    const g = def.model === 'fists' ? fistsDisplay() : buildWeapon(def.model, tex).group;
    g.traverse((o) => { o.castShadow = false; });
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3());
    g.position.sub(box.getCenter(new THREE.Vector3()));
    wrap.add(g);
    wrap.scale.setScalar(Math.min(2.6, (def.kind === 'melee' ? 0.85 : 1.15) / Math.max(0.1, size.x, size.y, size.z)));
    return wrap;
  };

  const stands = [];
  SLOTS.forEach((slot, r) => {
    bySlot(slot).forEach((def, c) => {
      const sx = X(COL_X[c]), sz = Z(ROW_Z[r]);
      solid(baseM, sx, Y(0), sz, 1.2, 0.9, 1.2, 1.5);
      const ring = mesh(new THREE.TorusGeometry(0.62, 0.04, 8, 28), basic({ color: SLOT_COLOR[slot] }), sx, Y(0.93), sz);
      ring.rotation.x = PI / 2;
      const holder = new THREE.Group();
      holder.position.set(sx, Y(1.75), sz);
      holder.add(displayFor(def));
      root.add(holder);
      stands.push({ id: def.id, slot, def, x: sx, z: sz, ring, holder, baseY: Y(1.75), phase: c * 0.9 + r * 1.7 });
    });
    put(sign(SLOT_NAME[slot] + ' WEAPONS', 'walk up · press E', 5.4, 1.3, SLOT_COLOR[slot]), X(-29.85), Y(3.4), Z(ROW_Z[r]), PI / 2);
  });
  put(sign('ARMORY', 'pick one main · one secondary · one melee', 6.6, 1.3, 0xffffff), X(-29.85), Y(6.2), Z(4), PI / 2);

  // ---------- shooting range ----------
  const boardTex = targetTexture();
  const targets = [-6, 0, 6, 12, 18].map((rz) => {
    const tx = X(27.6), tz = Z(rz);
    const hinge = new THREE.Group();
    hinge.position.set(tx, Y(0.4), tz);
    root.add(hinge);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.8), std({ map: boardTex, roughness: 0.8, side: THREE.DoubleSide }));
    board.position.y = 0.9;
    board.rotation.y = -PI / 2;
    hinge.add(board);
    const t = { hinge, down: false, timer: 0, amt: 0, tz };
    t.col = addCollider(tx, tz, 0.3, Y(2.2), 1.3, { y0: Y(0.4), noCover: true });
    t.col.onShot = (dmg, pt) => {
      if (t.down) return;
      t.down = true; t.timer = 2.4; api.rangeHits++;
      const bull = pt ? Math.hypot(pt.y - Y(1.3), pt.z - t.tz) < 0.3 : false;
      if (hooks.onRangeHit) hooks.onRangeHit(bull);
    };
    return t;
  });
  glow(0xffd23f, X(10.5), Y(0.05), Z(6), 0.12, 0.06, 26);
  put(sign('SHOOTING RANGE', 'test every weapon here', 6.6, 1.4, 0xffd23f), X(29.85), Y(5.2), Z(6), -PI / 2);

  // ---------- centrepiece + signs ----------
  solid(baseM, X(0), Y(0), Z(-3), 2.4, 0.9, 2.4, 1.5);
  const holo = mesh(new THREE.IcosahedronGeometry(1.3, 1), basic({ color: 0x2fb7ff, wireframe: true }), X(0), Y(2.7), Z(-3));
  const core = mesh(new THREE.IcosahedronGeometry(0.55, 0), basic({ color: 0xdff1ff }), X(0), Y(2.7), Z(-3));
  put(sign('REALM RANGE', 'step into a portal to play', 8, 1.6, 0x2fb7ff), X(0), Y(6.2), Z(-3));
  put(sign('WELCOME', 'E · interact    Q · build    V · camera', 7, 1.3, 0x5dff9a), X(0), Y(4.3), Z(21.8), PI);
  const spawnPad = mesh(new THREE.RingGeometry(1.4, 1.8, 40), basic({ color: 0x5dff9a, side: THREE.DoubleSide }), X(0), Y(0.04), Z(16));
  spawnPad.rotation.x = -PI / 2;

  // ---------- state ----------
  let t = 0, hold = 0, active = true, prompt = null;
  const api = { rangeHits: 0 };

  function refresh() {
    for (const s of stands) {
      const eq = loadout[s.slot] === s.id;
      s.ring.material.color.setHex(eq ? 0x5dff9a : SLOT_COLOR[s.slot]);
      s.ring.scale.setScalar(eq ? 1.14 : 1);
    }
  }
  refresh();

  const portalAt = (p) => portals.find((q) => Math.abs(p.x - q.x) < 3 && p.z < Z(-16.5) && Math.abs(p.y - Y(0)) < 2);
  function standNear(p) {
    let best = null, bd = 4;
    for (const s of stands) {
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < bd && Math.abs(p.y - Y(0)) < 2.5) { bd = d; best = s; }
    }
    return best;
  }

  function update(dt, p, interact) {
    t += dt;
    for (const q of portals) q.swirl.rotation += dt * 0.55 * q.dir;
    holo.rotation.y = t * 0.6; holo.rotation.x = Math.sin(t * 0.4) * 0.25; core.rotation.y = -t;
    for (const s of stands) {
      s.holder.rotation.y = t * 0.8 + s.phase;
      s.holder.position.y = s.baseY + Math.sin(t * 1.6 + s.phase) * 0.05;
    }
    for (const g of targets) {
      if (g.down && (g.timer -= dt) <= 0) g.down = false;
      g.amt += ((g.down ? 1 : 0) - g.amt) * (1 - Math.exp(-12 * dt));
      g.hinge.rotation.z = -g.amt * (PI / 2);
    }

    prompt = null;
    if (!active || !p || !p.alive) { hold = 0; return null; }
    const pt = portalAt(p);
    if (pt) {
      hold += dt;
      prompt = { text: `E — Play ${pt.mode.name}`, sub: pt.mode.short, progress: clamp(hold / HOLD, 0, 1) };
      if (interact || hold >= HOLD) { hold = 0; return { type: 'portal', mode: pt.id }; }
      return null;
    }
    hold = 0;
    const st = standNear(p);
    if (st) {
      const eq = loadout[st.slot] === st.id;
      prompt = { text: eq ? `${st.def.name} — equipped` : `E — Equip ${st.def.name}`, sub: `${SLOT_NAME[st.slot]} · ${statLine(st.def)}`, progress: 0 };
      if (interact && !eq) {
        setSlot(st.slot, st.id);
        refresh();
        if (hooks.onEquip) hooks.onEquip(st.slot, st.id);
        return { type: 'equip', slot: st.slot, id: st.id };
      }
    } else if (p.x > X(9)) prompt = { text: 'Shooting range', sub: `Targets hit: ${api.rangeHits}`, progress: 0 };
    return null;
  }

  Object.assign(api, {
    group: root,
    spawn: LOBBY_SPAWN,
    update,
    refresh,
    setActive(on) { active = !!on; root.visible = !!on; hold = 0; },
    get prompt() { return prompt; },
  });
  return api;
}
