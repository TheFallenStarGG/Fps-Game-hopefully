/**
 * The physical main lobby — a sealed exhibition hall floating above the map.
 * Portals start modes, pedestals equip weapons across four loadout slots, a range tests them.
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

export const LOBBY = { x: -240, y: 400, z: 240, w: 72, d: 52, h: 11 };
export const LOBBY_SPAWN = { x: LOBBY.x, y: LOBBY.y, z: LOBBY.z + 18, yaw: 0 };

const PI = Math.PI;
const PORTALS = [['ffa', -24], ['duel', -8], ['team', 8], ['bots', 24]];
// four loadout rows: main / side / melee / utility
const ROW_Z = [-8, 2, 12, 20];
const COL_X = [-28, -22, -16, -10, -4];
const SLOT_COLOR = { main: 0xff8a2b, side: 0x4aa8ff, melee: 0xd05bff, utility: 0x3dff9a };
const SLOT_NAME = { main: 'PRIMARY', side: 'SECONDARY', melee: 'MELEE', utility: 'UTILITY' };
const HOLD = 1.15;
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
  const S = 512, [c, x] = cv(S, S), [e, y] = cv(S, S);
  // polished dark plate
  x.fillStyle = '#0e1218'; x.fillRect(0, 0, S, S);
  // micro noise
  for (let i = 0; i < 2400; i++) {
    x.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    x.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 1);
  }
  // large tile grid
  x.strokeStyle = '#1c2633'; x.lineWidth = 3;
  for (let i = 0; i <= S; i += S / 8) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, S); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(S, i); x.stroke();
  }
  // inner accent
  x.strokeStyle = '#2a3a4d'; x.lineWidth = 1.5;
  for (let i = S / 16; i < S; i += S / 8) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, S); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(S, i); x.stroke();
  }
  // emissive channel — cool edge glow
  y.fillStyle = '#000'; y.fillRect(0, 0, S, S);
  y.strokeStyle = '#1a7ab0'; y.lineWidth = 4;
  for (let i = 0; i <= S; i += S / 8) {
    y.beginPath(); y.moveTo(i, 0); y.lineTo(i, S); y.stroke();
    y.beginPath(); y.moveTo(0, i); y.lineTo(S, i); y.stroke();
  }
  y.strokeStyle = '#3dff9a'; y.lineWidth = 1.5;
  y.strokeRect(S * 0.08, S * 0.08, S * 0.84, S * 0.84);

  const m = canvasTex(c), g = canvasTex(e);
  for (const t of [m, g]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / 5, d / 5); }
  return { map: m, glow: g };
}

function swirlTexture(color) {
  const S = 256, [c, x] = cv(S, S), col = rgb(color);
  x.translate(S / 2, S / 2);
  const g = x.createRadialGradient(0, 0, 8, 0, 0, S / 2);
  g.addColorStop(0, `rgba(${col},0.08)`);
  g.addColorStop(0.55, `rgba(${col},0.4)`);
  g.addColorStop(1, `rgba(${col},0.85)`);
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, S / 2, 0, PI * 2); x.fill();
  x.lineCap = 'round';
  for (const [style, lw] of [[`rgba(${col},0.9)`, 11], ['rgba(255,255,255,0.45)', 4]]) {
    x.strokeStyle = style; x.lineWidth = lw;
    for (let k = 0; k < 6; k++) {
      x.beginPath();
      for (let i = 0; i <= 48; i++) {
        const t = i / 48, r = t * (S / 2 - 8), a = (k / 6) * PI * 2 + t * 3.8;
        if (i === 0) x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.stroke();
    }
  }
  x.strokeStyle = `rgba(${col},0.95)`; x.lineWidth = 6;
  x.beginPath(); x.arc(0, 0, S / 2 - 5, 0, PI * 2); x.stroke();
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
  // glass panel look
  const grd = x.createLinearGradient(0, 0, 0, py);
  grd.addColorStop(0, 'rgba(10,14,22,0.92)');
  grd.addColorStop(1, 'rgba(6,10,16,0.96)');
  x.fillStyle = grd; x.fillRect(0, 0, px, py);
  x.strokeStyle = hex(color); x.lineWidth = 6; x.strokeRect(6, 6, px - 12, py - 12);
  x.strokeStyle = `rgba(${rgb(color)},0.35)`; x.lineWidth = 2; x.strokeRect(14, 14, px - 28, py - 28);
  // corner accents
  x.strokeStyle = hex(color); x.lineWidth = 3;
  for (const [ax, ay] of [[20, 20], [px - 20, 20], [20, py - 20], [px - 20, py - 20]]) {
    x.beginPath();
    x.moveTo(ax + (ax < px / 2 ? 18 : -18), ay);
    x.lineTo(ax, ay);
    x.lineTo(ax, ay + (ay < py / 2 ? 18 : -18));
    x.stroke();
  }
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  x.font = `800 ${sub ? py * 0.38 : py * 0.48}px system-ui, sans-serif`;
  x.fillText(title, px / 2, sub ? py * 0.38 : py * 0.52, px - 48);
  if (sub) {
    x.fillStyle = hex(color);
    x.font = `600 ${py * 0.18}px system-ui, sans-serif`;
    x.fillText(sub, px / 2, py * 0.72, px - 48);
  }
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: canvasTex(c), toneMapped: false, side: THREE.DoubleSide, transparent: true })
  );
}

function slotBanner(name, color) {
  const [c, x] = cv(512, 128);
  x.fillStyle = 'rgba(6,10,16,0.9)'; x.fillRect(0, 0, 512, 128);
  x.strokeStyle = hex(color); x.lineWidth = 5; x.strokeRect(4, 4, 504, 120);
  x.fillStyle = hex(color);
  x.font = '800 52px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(name, 256, 64);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(5.5, 1.15),
    new THREE.MeshBasicMaterial({ map: canvasTex(c), toneMapped: false, transparent: true })
  );
}

function statLine(d) {
  if (d.kind === 'melee' || d.kind === 'utility') return d.blurb || '';
  const per = d.pellets > 1 ? `${d.pellets}×` : '', k = (v) => (v >= 100 ? 'KILL' : `${per}${v}`);
  return `Head ${k(d.dmg.head)} · Body ${k(d.dmg.body)} · ${d.mag}/${d.total} ammo · reload ${reloadDuration(d, d.mag).toFixed(1)}s`;
}

export function createLobby(scene, tex, hooks = {}) {
  const L = LOBBY, X = (v) => L.x + v, Y = (v) => L.y + v, Z = (v) => L.z + v;
  const M = makeMaterials(tex);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
  const wallM = std({ color: 0x4a5562, map: tex.concrete, roughness: 0.88, metalness: 0.08 });
  const darkM = std({ color: 0x1a2028, map: tex.metal, roughness: 0.4, metalness: 0.75 });
  const baseM = std({ color: 0x2a323c, map: tex.metal, roughness: 0.35, metalness: 0.8 });
  const ceilM = std({ color: 0x12161c, roughness: 0.92 });
  const glassM = std({ color: 0x88c8ff, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.9, side: THREE.DoubleSide });
  const root = new THREE.Group();
  scene.add(root);

  const mesh = (geo, mtl, x, y, z) => { const m = new THREE.Mesh(geo, mtl); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; root.add(m); return m; };
  const solid = (mtl, cx, y0, cz, w, h, d, tile = 3) => {
    mesh(boxGeo(w, h, d, tile), mtl, cx, y0 + h / 2, cz);
    return addCollider(cx, cz, w, y0 + h, d, { y0, noCover: true });
  };
  const glow = (color, cx, cy, cz, w, h, d) => mesh(new THREE.BoxGeometry(w, h, d), basic({ color }), cx, cy, cz);
  const put = (m, x, y, z, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; root.add(m); return m; };

  // ---------- shell ----------
  const ft = floorTextures(L.w, L.d);
  const floor = mesh(new THREE.PlaneGeometry(L.w, L.d), std({
    color: 0xffffff, map: ft.map, emissive: 0xffffff, emissiveMap: ft.glow, emissiveIntensity: 0.55,
    roughness: 0.28, metalness: 0.65,
  }), X(0), Y(0.01), Z(0));
  floor.rotation.x = -PI / 2;
  addCollider(X(0), Z(0), L.w + 4, Y(0), L.d + 4, { y0: Y(-1.5), noCover: true });

  // thicker walls + outer buttresses
  solid(wallM, X(0), Y(-1), Z(-L.d / 2 - 0.6), L.w + 8, L.h + 2, 2.2, 4);
  solid(wallM, X(0), Y(-1), Z(L.d / 2 + 0.6), L.w + 8, L.h + 2, 2.2, 4);
  solid(wallM, X(-L.w / 2 - 0.6), Y(-1), Z(0), 2.2, L.h + 2, L.d + 4, 4);
  solid(wallM, X(L.w / 2 + 0.6), Y(-1), Z(0), 2.2, L.h + 2, L.d + 4, 4);
  solid(ceilM, X(0), Y(L.h), Z(0), L.w + 8, 1.2, L.d + 4, 4);

  // ceiling light bars
  for (let ix = -30; ix <= 30; ix += 10) {
    for (const iz of [-16, -4, 8, 18]) {
      glow(0xe8f4ff, X(ix), Y(L.h - 0.08), Z(iz), 6.5, 0.1, 1.1);
      // soft volumetric-looking slabs under lights
      mesh(new THREE.BoxGeometry(5.5, 0.6, 0.8), basic({ color: 0xb8d8ff, transparent: true, opacity: 0.04 }), X(ix), Y(L.h - 1.1), Z(iz));
    }
  }
  // perimeter neon trim
  for (const [cx, cz, w, d] of [
    [0, -L.d / 2 + 0.15, L.w - 1, 0.08],
    [0, L.d / 2 - 0.15, L.w - 1, 0.08],
    [-L.w / 2 + 0.15, 0, 0.08, L.d - 1],
    [L.w / 2 - 0.15, 0, 0.08, L.d - 1],
  ]) glow(0x2fb7ff, X(cx), Y(0.18), Z(cz), w, 0.1, d);

  // secondary upper trim
  for (const [cx, cz, w, d] of [
    [0, -L.d / 2 + 0.15, L.w - 1, 0.06],
    [0, L.d / 2 - 0.15, L.w - 1, 0.06],
  ]) glow(0x3dff9a, X(cx), Y(L.h - 0.35), Z(cz), w, 0.06, d);

  // structural columns
  for (const ix of [-28, -14, 0, 14, 28]) {
    for (const iz of [-18, 18]) {
      solid(darkM, X(ix), Y(0), Z(iz), 1.1, L.h - 0.5, 1.1, 1);
      glow(0x2fb7ff, X(ix), Y(0.05), Z(iz), 1.4, 0.08, 1.4);
      glow(0x2fb7ff, X(ix), Y(L.h - 0.4), Z(iz), 1.4, 0.08, 1.4);
    }
  }

  // ---------- portals (north wall) ----------
  const portals = PORTALS.map(([id, ox], i) => {
    const mode = MODES[id] || { name: id.toUpperCase(), short: id };
    const px = X(ox), pz = Z(-L.d / 2 + 2.4);
    solid(darkM, px, Y(0), pz, 5.2, 0.45, 1.8, 1);
    // arch frame
    solid(darkM, px - 2.3, Y(0.45), pz, 0.35, 4.2, 0.45, 1);
    solid(darkM, px + 2.3, Y(0.45), pz, 0.35, 4.2, 0.45, 1);
    solid(darkM, px, Y(4.4), pz, 5.0, 0.35, 0.45, 1);
    const col = [0xff6b4a, 0x4aa8ff, 0x5dff9a, 0xffc247][i % 4];
    const swirl = mesh(new THREE.CircleGeometry(1.65, 48), basic({ map: swirlTexture(col), transparent: true, side: THREE.DoubleSide }), px, Y(2.5), pz + 0.35);
    glow(col, px, Y(0.5), pz + 0.2, 4.6, 0.06, 0.12);
    put(sign(mode.name || id.toUpperCase(), mode.short || 'enter to play', 4.4, 0.85, col), px, Y(5.3), pz + 0.2);
    return { id, mode, x: px, z: pz, swirl, dir: i % 2 ? 1 : -1, color: col };
  });

  /** Purple DEV portal — only built when the operator is unlocked. */
  function enableDevPortal() {
    if (portals.some((q) => q.id === 'dev')) return;
    // sit on the north wall just past Bots (hall is ±36 wide)
    const ox = 32;
    const id = 'dev';
    const mode = { name: 'DEVELOPER', short: 'sandbox · fly · spawn' };
    const px = X(ox), pz = Z(-L.d / 2 + 2.4);
    const col = 0xb56bff;
    solid(darkM, px, Y(0), pz, 5.2, 0.45, 1.8, 1);
    solid(darkM, px - 2.3, Y(0.45), pz, 0.35, 4.2, 0.45, 1);
    solid(darkM, px + 2.3, Y(0.45), pz, 0.35, 4.2, 0.45, 1);
    solid(darkM, px, Y(4.4), pz, 5.0, 0.35, 0.45, 1);
    const swirl = mesh(new THREE.CircleGeometry(1.65, 48), basic({ map: swirlTexture(col), transparent: true, side: THREE.DoubleSide }), px, Y(2.5), pz + 0.35);
    glow(col, px, Y(0.5), pz + 0.2, 4.6, 0.06, 0.12);
    put(sign(mode.name, mode.short, 4.4, 0.85, col), px, Y(5.3), pz + 0.2);
    portals.push({ id, mode, x: px, z: pz, swirl, dir: 1, color: col });
  }

  // ---------- weapon pedestals ----------
  const stands = [];
  const slotOrder = ['main', 'side', 'melee', 'utility'];
  slotOrder.forEach((slot, row) => {
    const items = bySlot(slot);
    const z = Z(ROW_Z[row]);
    // row label banner
    put(slotBanner(SLOT_NAME[slot], SLOT_COLOR[slot]), X(-31.2), Y(2.8), z, PI / 2);
    // row floor accent strip
    glow(SLOT_COLOR[slot], X(-16), Y(0.03), z, 28, 0.04, 0.18);

    items.forEach((def, col) => {
      const x = X(COL_X[col] ?? (-28 + col * 6));
      // pedestal base — stepped
      solid(baseM, x, Y(0), z, 2.2, 0.22, 2.2, 1);
      solid(darkM, x, Y(0.22), z, 1.7, 0.55, 1.7, 1);
      solid(baseM, x, Y(0.77), z, 1.35, 0.18, 1.35, 1);
      // glass case uprights
      for (const [ox, oz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) {
        mesh(new THREE.BoxGeometry(0.06, 1.55, 0.06), darkM, x + ox, Y(1.55), z + oz);
      }
      // glass panels
      for (const [ox, oz, w, d, ry] of [
        [0, -0.55, 1.1, 0.03, 0],
        [0, 0.55, 1.1, 0.03, 0],
        [-0.55, 0, 0.03, 1.1, 0],
        [0.55, 0, 0.03, 1.1, 0],
      ]) {
        mesh(new THREE.BoxGeometry(w, 1.45, d), glassM, x + ox, Y(1.55), z + oz);
      }
      // top glass
      mesh(new THREE.BoxGeometry(1.2, 0.03, 1.2), glassM, x, Y(2.3), z);
      // glowing ring under weapon
      const ring = mesh(new THREE.RingGeometry(0.55, 0.72, 40), basic({ color: SLOT_COLOR[slot], side: THREE.DoubleSide }), x, Y(1.02), z);
      ring.rotation.x = -PI / 2;
      // inner pulse disc
      const disc = mesh(new THREE.CircleGeometry(0.48, 32), basic({ color: SLOT_COLOR[slot], transparent: true, opacity: 0.18 }), x, Y(1.015), z);
      disc.rotation.x = -PI / 2;

      // floating weapon
      const holder = new THREE.Group();
      holder.position.set(x, Y(1.65), z);
      root.add(holder);
      let wpn;
      try {
        wpn = buildWeapon(def.model, tex);
        const g = wpn.group;
        // keep long tools / sledge inside the glass; small arms read better slightly larger
        let sc = 1.1;
        if (def.model === 'sledge') sc = 0.55;
        else if (def.model === 'machete' || def.model === 'tomahawk') sc = 0.7;
        else if (def.cls === 'long') sc = 0.9;
        else if (def.kind === 'utility') sc = 1.25;
        else if (def.kind === 'melee') sc = 0.95;
        g.scale.setScalar(sc);
        // tip blade / head upward-forward so cases look intentional
        g.rotation.x = def.kind === 'utility' ? 0.15 : (def.kind === 'melee' ? 0.35 : -0.2);
        g.rotation.z = def.kind === 'melee' ? 0.0 : 0.08;
        holder.add(g);
      } catch (_) {
        mesh(new THREE.BoxGeometry(0.4, 0.15, 0.9), std({ color: 0x888888 }), 0, 0, 0);
      }

      // name plate
      const plate = sign(def.name, SLOT_NAME[slot], 2.4, 0.55, SLOT_COLOR[slot]);
      put(plate, x, Y(0.55), z + 1.15);

      stands.push({
        slot, id: def.id, def, x, z,
        ring, disc, holder, baseY: Y(1.65), phase: Math.random() * PI * 2,
      });
    });
  });

  // ---------- shooting range (east wing) ----------
  solid(darkM, X(26), Y(0), Z(4), 0.3, 0.15, 28, 1);
  const targets = [0, 1, 2, 3, 4, 5].map((i) => {
    const tz = Z(-6 + i * 3.5), tx = X(30.5);
    const hinge = new THREE.Group();
    hinge.position.set(tx, Y(1.1), tz);
    root.add(hinge);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.65), basic({ map: targetTexture() }));
    board.position.y = 0.85;
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
  glow(0xffd23f, X(18), Y(0.04), Z(4), 0.14, 0.05, 28);
  put(sign('SHOOTING RANGE', 'test every weapon · hold to fire', 7.2, 1.35, 0xffd23f), X(L.w / 2 - 0.2), Y(5.6), Z(4), -PI / 2);

  // ---------- centrepiece ----------
  solid(baseM, X(8), Y(0), Z(-4), 3.2, 0.35, 3.2, 1.5);
  solid(darkM, X(8), Y(0.35), Z(-4), 2.4, 0.55, 2.4, 1);
  // orbiting rings
  const orbitA = mesh(new THREE.TorusGeometry(1.9, 0.04, 12, 64), basic({ color: 0x2fb7ff }), X(8), Y(3.0), Z(-4));
  const orbitB = mesh(new THREE.TorusGeometry(1.45, 0.035, 12, 64), basic({ color: 0x3dff9a }), X(8), Y(3.0), Z(-4));
  orbitB.rotation.x = PI / 2.6;
  const holo = mesh(new THREE.IcosahedronGeometry(1.15, 1), basic({ color: 0x2fb7ff, wireframe: true }), X(8), Y(3.0), Z(-4));
  const core = mesh(new THREE.IcosahedronGeometry(0.42, 0), basic({ color: 0xdff1ff }), X(8), Y(3.0), Z(-4));
  put(sign('RIFT HORIZON', 'choose your loadout · step into a portal', 9.5, 1.7, 0x2fb7ff), X(8), Y(6.5), Z(-4));
  put(sign('ARMORY', '4 slots · Primary · Secondary · Melee · Utility', 8.2, 1.15, 0x5dff9a), X(8), Y(5.0), Z(-4));

  // welcome / controls at south
  put(sign('WELCOME, OPERATOR', 'E · interact   1-4 · slots   Q · build   V · camera', 9, 1.4, 0x5dff9a), X(0), Y(4.6), Z(L.d / 2 - 0.3), PI);
  const spawnPad = mesh(new THREE.RingGeometry(1.5, 2.0, 48), basic({ color: 0x5dff9a, side: THREE.DoubleSide }), X(0), Y(0.04), Z(18));
  spawnPad.rotation.x = -PI / 2;
  glow(0x5dff9a, X(0), Y(0.03), Z(18), 4.2, 0.04, 4.2);

  // floating decorative spheres near ceiling
  const floaters = [];
  for (let i = 0; i < 14; i++) {
    const s = 0.08 + Math.random() * 0.12;
    const f = mesh(
      new THREE.SphereGeometry(s, 10, 10),
      basic({ color: Math.random() > 0.5 ? 0x2fb7ff : 0x3dff9a, transparent: true, opacity: 0.55 }),
      X((Math.random() - 0.5) * 50), Y(6 + Math.random() * 3.5), Z((Math.random() - 0.5) * 36)
    );
    floaters.push({ m: f, baseY: f.position.y, phase: Math.random() * PI * 2, speed: 0.4 + Math.random() * 0.6 });
  }

  // ---------- state ----------
  let t = 0, hold = 0, active = true, prompt = null;
  const api = { rangeHits: 0 };

  function refresh() {
    for (const s of stands) {
      const eq = loadout[s.slot] === s.id;
      s.ring.material.color.setHex(eq ? 0x5dff9a : SLOT_COLOR[s.slot]);
      s.ring.scale.setScalar(eq ? 1.16 : 1);
      if (s.disc) s.disc.material.opacity = eq ? 0.35 : 0.15;
    }
  }
  refresh();

  const portalAt = (p) => portals.find((q) => Math.abs(p.x - q.x) < 3.2 && p.z < Z(-L.d / 2 + 4.5) && Math.abs(p.y - Y(0)) < 2.5);
  function standNear(p) {
    let best = null, bd = 3.6;
    for (const s of stands) {
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < bd && Math.abs(p.y - Y(0)) < 2.5) { bd = d; best = s; }
    }
    return best;
  }

  function update(dt, p, interact) {
    t += dt;
    for (const q of portals) q.swirl.rotation.z += dt * 0.55 * q.dir;
    holo.rotation.y = t * 0.55; holo.rotation.x = Math.sin(t * 0.35) * 0.2;
    core.rotation.y = -t * 1.1;
    orbitA.rotation.x = t * 0.35; orbitA.rotation.y = t * 0.22;
    orbitB.rotation.z = -t * 0.4;
    for (const s of stands) {
      s.holder.rotation.y = t * 0.7 + s.phase;
      s.holder.position.y = s.baseY + Math.sin(t * 1.5 + s.phase) * 0.06;
    }
    for (const f of floaters) {
      f.m.position.y = f.baseY + Math.sin(t * f.speed + f.phase) * 0.45;
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
      prompt = {
        text: eq ? `${st.def.name} — equipped` : `E — Equip ${st.def.name}`,
        sub: `${SLOT_NAME[st.slot]} · ${statLine(st.def)}`,
        progress: 0,
      };
      if (interact && !eq) {
        setSlot(st.slot, st.id);
        refresh();
        if (hooks.onEquip) hooks.onEquip(st.slot, st.id);
        return { type: 'equip', slot: st.slot, id: st.id };
      }
    } else if (p.x > X(16)) prompt = { text: 'Shooting range', sub: `Targets hit: ${api.rangeHits}`, progress: 0 };
    return null;
  }

  Object.assign(api, {
    group: root,
    spawn: LOBBY_SPAWN,
    update,
    refresh,
    setActive(on) { active = !!on; root.visible = !!on; hold = 0; },
    enableDevPortal,
    get prompt() { return prompt; },
  });
  return api;
}
