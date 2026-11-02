/**
 * Solo bots: sight cone + hearing, awareness, reaction time, cover, peeking, flanking, suppression, reloading,
 * per-bot weapons, floors / stairs, and shooting down the player's walls when they hide behind builds.
 */
import * as THREE from 'three';
import { resolveCircle, lineBlocked, raycastWorld, floorAt, queryRect, along, STEP } from './collision.js';
import { updateHumanoidAnim, triggerShootKick, resetReloadAnim, setWeapon } from './anim.js';
import { SPAWNS } from './scene.js';
import { WEAPONS, reloadDuration } from './arsenal.js';

const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
/** Characters face -Z at yaw 0 */
const faceYaw = (dx, dz) => Math.atan2(-dx, -dz);
const angDiff = (a, b) => {
  let d = (a - b) % (PI * 2);
  if (d > PI) d -= PI * 2;
  if (d < -PI) d += PI * 2;
  return d;
};
const falloff = (f, d) => (!f || d <= f.start ? 1 : d >= f.end ? f.min : 1 + (f.min - 1) * ((d - f.start) / (f.end - f.start)));

const WALK = 2.5, RUN = 5.3, STAND_H = 1.8, BOT_DMG = 0.45, BOT_CAP = 55;
const ROLES = ['rusher', 'flanker', 'holder', 'holder'];
const NAMES = ['Viper', 'Ghost', 'Raven', 'Wolf', 'Hawk', 'Cobra', 'Lynx', 'Fox'];
const BOT_GUNS = { rusher: ['breacher', 'stinger', 'stinger'], flanker: ['stinger', 'vanguard'], holder: ['vanguard', 'vanguard', 'longbow'] };
const _m = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _e = new THREE.Vector3();

// ---------- navigation helpers ----------
/** Entry t (0..1) of the segment into the box inflated by m, or -1 */
function segBox(ax, az, dx, dz, c, m) {
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < c.minX - m || ax > c.maxX + m) return -1;
  } else {
    let a = (c.minX - m - ax) / dx, b = (c.maxX + m - ax) / dx;
    if (a > b) { const k = a; a = b; b = k; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < c.minZ - m || az > c.maxZ + m) return -1;
  } else {
    let a = (c.minZ - m - az) / dz, b = (c.maxZ + m - az) / dz;
    if (a > b) { const k = a; a = b; b = k; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  return t0;
}

/** First collider that blocks a walker at height y along the segment (ramps, step-ups and overhead slabs don't) */
function firstBlocker(ax, az, bx, bz, m, y) {
  const dx = bx - ax, dz = bz - az;
  let best = null, bt = 2;
  const list = along(ax, az, bx, bz);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.ramp || c.y0 >= y + 1.7 || c.h <= y + STEP) continue;
    const t = segBox(ax, az, dx, dz, c, m);
    if (t >= 0 && t < bt) { bt = t; best = c; }
  }
  return best;
}

/** Next point to steer towards; detours around the first obstacle on the straight path */
function nextPoint(e, tx, tz) {
  if (e.wp && e.wpT > 0 && dist2(e.x, e.z, e.wp.x, e.wp.z) > 0.7) return e.wp;
  e.wp = null;
  const b = firstBlocker(e.x, e.z, tx, tz, 0.3, e.y);
  if (!b) return { x: tx, z: tz };
  const m = 0.9;
  const cs = [[b.minX - m, b.minZ - m], [b.maxX + m, b.minZ - m], [b.minX - m, b.maxZ + m], [b.maxX + m, b.maxZ + m]];
  let best = null, bs = 1e9;
  for (const [cx, cz] of cs) {
    if (firstBlocker(e.x, e.z, cx, cz, 0.3, e.y)) continue;
    const s = dist2(e.x, e.z, cx, cz) + dist2(cx, cz, tx, tz);
    if (s < bs) { bs = s; best = { x: cx, z: cz }; }
  }
  if (best) { e.wp = best; e.wpT = 1.5; return best; }
  return { x: tx, z: tz };
}

function findCover(e, away) {
  const P = e.ctx.player, all = e.ctx.enemies, eyeP = P.y + P.eyeH;
  const list = queryRect(e.x - 34, e.z - 34, e.x + 34, e.z + 34);
  const cs = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.noCover || c.ramp || c.w * c.d < 1.5 || c.h - c.y0 < 0.95 || c.y0 > e.y + 0.5 || c.h > e.y + 5) continue;
    cs.push(c);
  }
  cs.sort((a, b) => dist2(a.cx, a.cz, e.x, e.z) - dist2(b.cx, b.cz, e.x, e.z));
  let best = null, bs = -1e9;
  for (const c of cs.slice(0, 10)) {
    const o = 0.95;
    const pts = [
      [c.minX - o, c.cz], [c.maxX + o, c.cz], [c.cx, c.minZ - o], [c.cx, c.maxZ + o],
      [c.minX - o, c.minZ - o], [c.maxX + o, c.minZ - o], [c.minX - o, c.maxZ + o], [c.maxX + o, c.maxZ + o],
    ];
    for (const [sx, sz] of pts) {
      const r = resolveCircle(sx, sz, 0.5, e.y, STAND_H);
      if (Math.abs(r.x - sx) > 0.05 || Math.abs(r.z - sz) > 0.05) continue;
      const dP = dist2(sx, sz, P.x, P.z);
      if (dP < 6) continue;
      const dE = dist2(sx, sz, e.x, e.z);
      const hidden = lineBlocked(P.x, P.z, sx, sz, eyeP, e.y + 0.9);
      let s = (hidden ? 60 : -30) - dE * (away ? 0.15 : 0.7);
      s += away ? dP * 0.8 : -Math.abs(dP - 20) * 0.3;
      for (const o2 of all) {
        if (o2 !== e && o2.alive && o2.hasCover && dist2(sx, sz, o2.coverX, o2.coverZ) < 2.5) s -= 25;
      }
      if (s > bs) { bs = s; best = { x: sx, z: sz }; }
    }
  }
  return best;
}

function setState(e, s, t) {
  e.state = s;
  e.stateT = t;
  e.wp = null;
}

function goCover(e, state, dur, away) {
  const c = findCover(e, away);
  if (!c) return false;
  e.hasCover = true;
  e.coverX = c.x; e.coverZ = c.z;
  e.destX = c.x; e.destZ = c.z;
  e.coverWaitT = rnd(1.0, 2.2);
  setState(e, state, dur);
  return true;
}

function startPeek(e, P) {
  const dx = P.x - e.coverX, dz = P.z - e.coverZ, l = Math.hypot(dx, dz) || 1;
  const fx = dx / l, fz = dz / l, eyeP = P.y + P.eyeH;
  let pick = null;
  for (const s of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
    const px = e.coverX - fz * s * 1.5 + fx * 0.2, pz = e.coverZ + fx * s * 1.5 + fz * 0.2;
    const r = resolveCircle(px, pz, 0.5, e.y, STAND_H);
    if (!lineBlocked(r.x, r.z, P.x, P.z, e.y + 1.55, eyeP)) { pick = r; break; }
  }
  e.destX = pick ? pick.x : e.coverX;
  e.destZ = pick ? pick.z : e.coverZ;
  setState(e, 'peek', rnd(1.4, 2.4));
}

function pickPatrol(e, P) {
  let x = 0, z = 0;
  for (let i = 0; i < 6; i++) {
    if (Math.random() < 0.6) { const a = rnd(0, PI * 2), r = rnd(18, 55); x = P.x + Math.cos(a) * r; z = P.z + Math.sin(a) * r; }
    else { x = rnd(-270, 270); z = rnd(-270, 270); }
    x = clamp(x, -285, 285); z = clamp(z, -285, 285);
    const r = resolveCircle(x, z, 0.6, 0, STAND_H);
    if (Math.hypot(r.x - x, r.z - z) < 0.05) break;
  }
  e.destX = x; e.destZ = z;
  setState(e, 'idle', rnd(10, 16));
}

function pickSearch(e) {
  const r = resolveCircle(e.focusX + rnd(-9, 9), e.focusZ + rnd(-9, 9), 0.6, e.y, STAND_H);
  e.destX = r.x; e.destZ = r.z;
}

function hear(e, x, z, amt) {
  e.focusX = x; e.focusZ = z;
  e.awareness = Math.max(e.awareness, amt);
  if (!e.engaged && (e.state === 'idle' || e.state === 'investigate')) {
    e.destX = x; e.destZ = z;
    setState(e, 'investigate', 8);
  }
}

function announce(e) {
  const P = e.ctx.player;
  for (const o of e.ctx.enemies) {
    if (o === e || !o.alive || o.engaged) continue;
    if (dist2(o.x, o.z, e.x, e.z) > 60) continue;
    o.awareness = Math.max(o.awareness, 0.7);
    o.focusX = P.x; o.focusZ = P.z;
    o.destX = P.x + rnd(-4, 4); o.destZ = P.z + rnd(-4, 4);
    setState(o, 'investigate', 8);
  }
}

export function startReload(e) {
  if (e.reloading) return;
  e.reloadMissing = Math.max(1, e.mag - e.ammo);
  e.reloadTotal = reloadDuration(e.def, e.reloadMissing);
  e.reloading = true;
  e.reloadT = 0;
  e.burstLeft = 0;
  resetReloadAnim(e.mesh.userData);
}

function chooseTactic(e, P, dist) {
  const r = Math.random();
  if (e.role === 'flanker' && dist > 14 && r < 0.6) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const a = Math.atan2(e.x - P.x, e.z - P.z) + side * rnd(0.9, 1.4);
    const rad = clamp(dist * 0.75, 11, 26);
    const p = resolveCircle(P.x + Math.sin(a) * rad, P.z + Math.cos(a) * rad, 0.6, e.y, STAND_H);
    e.destX = p.x; e.destZ = p.z;
    setState(e, 'flank', 7);
  } else if ((e.role === 'holder' && r < 0.5) || r < 0.2) {
    if (!goCover(e, 'cover', 10, false)) setState(e, 'engage', rnd(2, 3));
  } else setState(e, 'engage', rnd(2, 4));
}

function think(e, now, dist, vis) {
  const P = e.ctx.player, ctx = e.ctx;
  e.thinkT = rnd(0.3, 0.55);
  const arrived = dist2(e.x, e.z, e.destX, e.destZ) < 1.2;

  // is a player build blocking the line? then shoot it down
  e.wallPiece = null;
  if (e.engaged && !vis && dist < 32 && ctx.build && P.alive) {
    const dx = P.x - e.x, dz = P.z - e.z, ey = e.y + 1.5, dy = P.y + P.eyeH - 0.3 - ey, l = Math.hypot(dx, dy, dz) || 1;
    const w = raycastWorld(e.x, ey, e.z, dx / l, dy / l, dz / l, l);
    if (w && w.c && w.c.piece && ctx.build.pieces.has(w.c.piece.key)) e.wallPiece = w.c.piece;
  }

  if (!e.engaged) {
    if (e.state === 'idle') { if (arrived || e.stateT <= 0) pickPatrol(e, P); }
    else if (e.state === 'investigate') { if (arrived || e.stateT <= 0) { setState(e, 'search', rnd(5, 8)); pickSearch(e); } }
    else if (e.state === 'search') { if (arrived) pickSearch(e); if (e.stateT <= 0) setState(e, 'idle', 0); }
    else setState(e, 'idle', 0);
    return;
  }
  if (now - e.combatT > 12) { e.engaged = false; e.awareness = 0.2; setState(e, 'idle', 0); return; }

  const atCover = e.hasCover && dist2(e.x, e.z, e.coverX, e.coverZ) < 0.8;
  const hurtRecent = now - e.lastHurt < 1.2;

  if (e.ammo <= 0) startReload(e);
  else if (e.ammo < e.mag * 0.25 && !vis) startReload(e);

  if (e.hp > 60) e.retreatDone = false;
  if (e.hp < 30 && !e.retreatDone && e.state !== 'retreat') {
    e.retreatDone = true;
    if (goCover(e, 'retreat', 8, true)) return;
  }
  if (e.reloading && e.state !== 'cover' && e.state !== 'retreat') {
    if (goCover(e, 'cover', 10, false)) return;
  }
  if ((e.suppression > 0.6 || (hurtRecent && Math.random() < 0.45)) && !['cover', 'peek', 'retreat'].includes(e.state)) {
    if (goCover(e, 'cover', 10, false)) return;
  }
  if (!vis && !e.wallPiece && now - e.lastSeenT > 2.5 && (e.state === 'engage' || e.state === 'peek')) {
    setState(e, 'search', 9);
    pickSearch(e);
    return;
  }

  switch (e.state) {
    case 'cover':
      if (e.stateT <= 0) setState(e, 'engage', 2);
      else if (atCover && e.coverWaitT <= 0 && !e.reloading) startPeek(e, P);
      break;
    case 'peek':
      if (e.stateT <= 0) {
        if (Math.random() < 0.7 && goCover(e, 'cover', 10, false)) break;
        setState(e, 'engage', rnd(2, 3.5));
      }
      break;
    case 'retreat':
      if (atCover) { setState(e, 'cover', 10); e.coverWaitT = rnd(2.5, 4); }
      else if (e.stateT <= 0) setState(e, 'engage', 2);
      break;
    case 'flank':
      if (arrived || e.stateT <= 0) setState(e, 'engage', rnd(2, 3.5));
      break;
    case 'search': case 'investigate': case 'idle':
      if (vis) setState(e, 'engage', rnd(1.5, 2.5));
      else if (arrived) pickSearch(e);
      break;
    default:
      if (e.stateT <= 0) chooseTactic(e, P, dist);
  }
}

// ---------- creation / damage ----------
export function createEnemy(mesh, ctx, index = 0) {
  const sp = SPAWNS.enemy[index % SPAWNS.enemy.length];
  const role = ROLES[index % ROLES.length], skill = rnd(0.72, 1);
  const pool = BOT_GUNS[role], wid = pool[Math.floor(Math.random() * pool.length)], def = WEAPONS[wid];
  const e = {
    id: 'bot' + index, name: NAMES[index % NAMES.length], role, mesh, ctx, skill, reactTime: rnd(0.32, 0.6) / skill,
    wid, def, mag: def.mag, ammo: def.mag, reloadMissing: 1, reloadTotal: 2, reloading: false, reloadT: 0,
    x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw || 0, pitch: 0, vx: 0, vz: 0, radius: 0.45,
    hp: 100, maxHp: 100, alive: true, deathT: 0, respawnT: 0,
    state: 'idle', stateT: 0, thinkT: rnd(0, 0.4), strafeT: 0, strafeDir: Math.random() < 0.5 ? 1 : -1,
    awareness: 0, engaged: false, engagedT: 0, combatT: -99, focus: 0, suppression: 0,
    focusX: sp.x, focusZ: sp.z, lastSeenT: -99, heardShotT: -99, heardFootT: -99,
    destX: sp.x, destZ: sp.z, wp: null, wpT: 0, stuckT: 0, wallPiece: null,
    hasCover: false, coverX: 0, coverZ: 0, coverWaitT: 0, retreatDone: false,
    fireCd: 0, burstLeft: 0, burstCd: 0,
    crouch: false, moving: false, speedNow: 0, sprintFlag: false, vis: false, lastHurt: -99, flinch: 0,
    team: 0, teamName: 'Alpha', isLeader: true, strategy: 'pressure', order: null, orderT: 0,
  };
  setWeapon(mesh, wid, true);
  e.flash = ctx.bullets.attachFlash(mesh.userData.muzzle, 0.5);
  sync(e);
  return e;
}

export function respawnEnemy(e) {
  const P = e.ctx.player;
  const deathX = e.x, deathZ = e.z;
  const minDist = 90;
  let pool = SPAWNS.enemy.filter((s) => {
    const fromP = P ? dist2(s.x, s.z, P.x, P.z) : 999;
    const fromDeath = dist2(s.x, s.z, deathX, deathZ);
    return fromP >= minDist && fromDeath >= 50;
  });
  if (!pool.length) {
    pool = SPAWNS.enemy.slice().sort((a, b) => {
      const da = (P ? dist2(a.x, a.z, P.x, P.z) : 0) + dist2(a.x, a.z, deathX, deathZ);
      const db = (P ? dist2(b.x, b.z, P.x, P.z) : 0) + dist2(b.x, b.z, deathX, deathZ);
      return db - da;
    });
  }
  const sp = pool[Math.floor(Math.random() * Math.min(6, pool.length))] || SPAWNS.enemy[0];
  e.x = sp.x + rnd(-4, 4); e.z = sp.z + rnd(-4, 4); e.y = sp.y;
  e.hp = e.maxHp; e.alive = true; e.deathT = 0;
  e.ammo = e.mag; e.reloading = false; e.burstLeft = 0;
  e.engaged = false; e.awareness = 0; e.engagedT = 0; e.focus = 0; e.suppression = 0; e.flinch = 0;
  e.hasCover = false; e.retreatDone = false; e.crouch = false; e.vx = e.vz = 0; e.wallPiece = null;
  e.order = null; e.strategy = 'patrol';
  e.mesh.userData.rlPrev = -1;
  e.mesh.visible = true;
  e.destX = e.x + rnd(-40, 40); e.destZ = e.z + rnd(-40, 40);
  e.focusX = e.destX; e.focusZ = e.destZ;
  setState(e, 'investigate', 18);
  e.respawnT = 0;
}

/** returns { killed, headshot } */
export function damageEnemy(e, dmg, zone = 'body') {
  if (!e.alive) return { killed: false, headshot: false };
  const ctx = e.ctx, P = ctx.player, now = performance.now() / 1000;
  e.hp -= dmg;
  e.lastHurt = now;
  e.flinch = 0.22;
  e.focus *= 0.35;
  e.suppression = Math.min(1, e.suppression + 0.35);
  e.awareness = 1;
  e.combatT = now;
  e.focusX = P.x; e.focusZ = P.z;
  if (!e.engaged) { e.engaged = true; setState(e, 'engage', rnd(1.5, 2.5)); announce(e); }
  e.engagedT = Math.max(e.engagedT, e.reactTime * 0.6);
  const headshot = zone === 'head';
  if (e.hp <= 0) {
    e.hp = 0; e.alive = false; e.deathT = 0; e.respawnT = rnd(14, 22);
    e.reloading = false; e.burstLeft = 0; e.crouch = false;
    ctx.audio.play('death', e.x, e.z);
    return { killed: true, headshot };
  }
  return { killed: false, headshot };
}

// ---------- shooting ----------
/** tgt = { x, y, z, player } (player: aim at them; otherwise it is a build piece to break) */
function enemyShoot(e, tgt, dist) {
  const ctx = e.ctx, P = ctx.player, ud = e.mesh.userData, d = e.def;
  ud.muzzle.getWorldPosition(_m);
  let ty = tgt.y;
  if (tgt.player && e.skill > 0.88 && e.focus > 0.8 && Math.random() < 0.25) ty = P.y + P.eyeH - 0.08;
  _d.set(tgt.x - _m.x, ty - _m.y, tgt.z - _m.z).normalize();

  let err = 0.07 * (1.35 - e.skill * 0.55);
  err *= 1.7 - e.focus;
  err *= 1 + clamp(e.speedNow / 6, 0, 1) * 0.7;
  err *= 1 + dist / 70;
  err *= 1 + e.suppression * 1.2;
  if (tgt.player) err *= 1 + clamp((P.speed2d || 0) / 8, 0, 1) * 0.5;
  if (e.flinch > 0) err *= 1.5;
  if (d.id === 'longbow') err *= 0.5;

  const n = d.pellets, cone = n > 1 ? Math.max(err, d.spread.hip * 0.8) : err;
  let hits = 0, headHit = false, pieceHits = new Map();
  for (let i = 0; i < n; i++) {
    _v.set(
      _d.x + (Math.random() + Math.random() - 1) * cone,
      _d.y + (Math.random() + Math.random() - 1) * cone * 0.7,
      _d.z + (Math.random() + Math.random() - 1) * cone,
    ).normalize();
    // distance along the ray to the player's axis
    const h2 = _v.x * _v.x + _v.z * _v.z;
    const t = h2 > 1e-6 ? ((P.x - _m.x) * _v.x + (P.z - _m.z) * _v.z) / h2 : 0;
    const w = raycastWorld(_m.x, _m.y, _m.z, _v.x, _v.y, _v.z, tgt.player ? Math.max(1, t) : 70);
    if (w && w.c && w.c.piece && ctx.build) {
      const k = w.c.piece.key, g = pieceHits.get(k);
      if (g) g.n++; else pieceHits.set(k, { piece: w.c.piece, n: 1 });
    } else if (!w && tgt.player && t > 0.5 && t < 110) {
      const lat = Math.hypot(_m.x + _v.x * t - P.x, _m.z + _v.z * t - P.z);
      const y = _m.y + _v.y * t, top = P.y + P.eyeH + 0.12;
      if (lat < 0.34 && y > P.y && y < top) { hits++; if (y > top - 0.26) headHit = true; }
    }
    else if (!w && tgt.bot && t > 0.5 && t < 110) {
      const B = tgt.bot;
      const lat = Math.hypot(_m.x + _v.x * t - B.x, _m.z + _v.z * t - B.z);
      const y = _m.y + _v.y * t, top = B.y + 1.75;
      if (lat < 0.36 && y > B.y && y < top) { hits++; if (y > top - 0.28) headHit = true; }
    }
    if (i < 3) ctx.bullets.spawn(_m, _v, 150, true);
  }

  const per = Math.min(BOT_CAP, d.dmg[headHit ? 'head' : 'body'] * BOT_DMG * falloff(d.falloff, dist) * (0.85 + 0.25 * e.skill));
  if (hits > 0) {
    const amount = Math.min(BOT_CAP * 1.4, per * hits);
    if (tgt.bot) {
      const res = damageEnemy(tgt.bot, amount, headHit ? 'head' : 'body');
      if (res.killed && ctx.onBotKill) ctx.onBotKill(e, tgt.bot, res.headshot);
    } else ctx.onPlayerHit(amount, e.x, e.z, headHit ? 'head' : 'body', e.name);
  }
  for (const g of pieceHits.values()) {
    if (ctx.build.pieces.has(g.piece.key)) ctx.build.damage(g.piece, d.dmg.body * BOT_DMG * 1.5 * g.n);
  }

  e.flash.fire();
  ctx.audio.play('shot', e.x, e.z, { enemy: true, snd: e.wid });
  if (ud.eject && e.wid !== 'breacher' && e.wid !== 'longbow') {
    ud.eject.getWorldPosition(_e);
    const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
    _v.set(cy * rnd(1.6, 2.6), rnd(1, 1.8), -sy * rnd(1.6, 2.6));
    ctx.bullets.ejectShell(_e, _v);
  }
  triggerShootKick(ud);
  e.ammo--;
  if (e.ammo <= 0) startReload(e);
}

function enemyEvent(e, name, info) {
  const { audio, bullets } = e.ctx;
  if (name === 'toss' && info) {
    const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
    _v.set(-cy * 2.3 - sy * 0.3 + rnd(-0.3, 0.3), rnd(0.7, 1.3), sy * 2.3 - cy * 0.3 + rnd(-0.3, 0.3));
    bullets.dropMag(info.pos, _v);
  } else if (name === 'eject' && info) {
    const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
    _v.set(cy * rnd(1, 2), rnd(0.8, 1.5), -sy * rnd(1, 2));
    bullets.ejectShell(info.pos, _v);
  } else if (name !== 'toss') audio.play(name, e.x, e.z);
}

function sync(e) {
  e.mesh.position.set(e.x, e.y, e.z);
  e.mesh.rotation.y = e.yaw;
  e.mesh.visible = e.alive || e.deathT < 5;
}

// ---------- main update ----------

const TEAM_PREFIX = ['A', 'B', 'C', 'D', 'E', 'F'];

export function applyTeam(e, slot) {
  e.team = slot.team;
  e.teamName = slot.teamName;
  e.isLeader = !!slot.isLeader;
  e.name = (slot.isLeader ? 'Ld ' : '') + TEAM_PREFIX[slot.team % TEAM_PREFIX.length] + '-' + (NAMES[slot.index % NAMES.length]);
}

function alliesAndFoes(e) {
  const all = e.ctx.enemies || [];
  const allies = [], foes = [];
  for (const o of all) {
    if (!o.alive || o === e) continue;
    if (o.team === e.team) allies.push(o);
    else foes.push(o);
  }
  return { allies, foes };
}

function nearestOf(list, x, z) {
  let best = null, bd = 1e9;
  for (const o of list) {
    const d = dist2(x, z, o.x, o.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function leaderCommand(e, now) {
  if (!e.isLeader) return;
  if (now - (e.orderT || 0) < 1.4) return;
  e.orderT = now;
  const P = e.ctx.player;
  const { allies, foes } = alliesAndFoes(e);
  const foe = nearestOf(foes, e.x, e.z);
  const pAlive = P && P.alive;
  const pd = pAlive ? dist2(e.x, e.z, P.x, P.z) : 999;
  const fd = foe ? dist2(e.x, e.z, foe.x, foe.z) : 999;

  if (fd < 35 && foe) e.strategy = 'war';
  else if (pd < 28 && pAlive) e.strategy = Math.random() < 0.5 ? 'pressure' : 'flank';
  else if (pd < 55 && pAlive && Math.random() < 0.35) e.strategy = 'pressure';
  else if (Math.random() < 0.12) e.strategy = 'camp';
  else e.strategy = 'patrol';

  let order;
  if (e.strategy === 'war' && foe) {
    order = { type: 'attack', x: foe.x, z: foe.z, targetId: foe.id, t: now };
    e.focusX = foe.x; e.focusZ = foe.z; e.engaged = true;
    e.destX = foe.x; e.destZ = foe.z;
  } else if (e.strategy === 'camp') {
    order = { type: 'hold', x: e.x, z: e.z, t: now };
  } else if (e.strategy === 'flank' && pAlive) {
    const ang = faceYaw(P.x - e.x, P.z - e.z) + (Math.random() < 0.5 ? 1.2 : -1.2);
    const tx = P.x + Math.sin(ang) * 28, tz = P.z + Math.cos(ang) * 28;
    order = { type: 'move', x: tx, z: tz, t: now };
    e.destX = tx; e.destZ = tz;
  } else if (e.strategy === 'pressure' && pAlive) {
    order = { type: 'attack', x: P.x, z: P.z, targetId: 'player', t: now };
    e.focusX = P.x; e.focusZ = P.z;
    e.destX = P.x + rnd(-12, 12); e.destZ = P.z + rnd(-12, 12);
  } else {
    const spots = SPAWNS.enemy || [];
    let tx, tz;
    if (spots.length && Math.random() < 0.65) {
      const sp = spots[Math.floor(Math.random() * spots.length)];
      tx = sp.x + rnd(-20, 20); tz = sp.z + rnd(-20, 20);
    } else {
      tx = e.x + rnd(-80, 80); tz = e.z + rnd(-80, 80);
    }
    order = { type: 'move', x: tx, z: tz, t: now };
    e.destX = tx; e.destZ = tz;
    e.focusX = tx; e.focusZ = tz;
    e.engaged = false;
  }
  e.order = order;
  for (const a of allies) {
    if (a.isLeader) continue;
    if (order.type === 'move' || order.type === 'attack') {
      a.order = {
        type: order.type,
        x: order.x + rnd(-8, 8),
        z: order.z + rnd(-8, 8),
        targetId: order.targetId,
        t: now,
      };
    } else {
      a.order = { type: 'hold', x: e.x + rnd(-6, 6), z: e.z + rnd(-6, 6), t: now };
    }
    a.orderT = now;
  }
  if (e.ctx.net && e.ctx.net.isConnected && e.ctx.net.isConnected()) {
    e.ctx.net.sendBotOrder(e.team, {
      type: order.type,
      x: order.x,
      z: order.z,
      targetId: order.targetId || null,
    });
  }
}

function pickCombatTarget(e, visPlayer, distPlayer) {
  const P = e.ctx.player;
  const { foes } = alliesAndFoes(e);
  const foe = nearestOf(foes, e.x, e.z);
  if (foe) {
    const fd = dist2(e.x, e.z, foe.x, foe.z);
    const canSee = fd < 55 && !lineBlocked(e.x, e.z, foe.x, foe.z, e.y + 1.45, foe.y + 1.45);
    if (canSee && (e.strategy === 'war' || fd + 10 < distPlayer || !visPlayer)) {
      return { x: foe.x, y: foe.y + 1.25, z: foe.z, player: false, bot: foe, dist: fd };
    }
  }
  if (visPlayer && P && P.alive) {
    return { x: P.x, y: P.y + (P.eyeH || 1.5) * 0.55, z: P.z, player: true, bot: null, dist: distPlayer };
  }
  return null;
}

function updateFollower(dt, now, e) {
  const ctx = e.ctx, P = ctx.player, ud = e.mesh.userData, d = e.def;
  e.fireCd = Math.max(0, e.fireCd - dt);
  e.burstCd = Math.max(0, e.burstCd - dt);
  e.flinch = Math.max(0, e.flinch - dt);
  if (e.reloading) {
    e.reloadT += dt;
    if (e.reloadT >= reloadDuration(d, e.reloadMissing || 1)) {
      e.ammo = e.mag; e.reloading = false; e.reloadT = 0;
    }
  } else if (e.ammo <= 0) {
    e.reloading = true; e.reloadT = 0; e.reloadMissing = e.mag;
  }
  const order = e.order;
  let tx = e.destX, tz = e.destZ, spd = WALK * 1.2;
  if (order) {
    if (order.type === 'hold') { tx = order.x; tz = order.z; spd = dist2(e.x, e.z, tx, tz) > 1.2 ? WALK : 0; }
    else { tx = order.x; tz = order.z; spd = RUN * 0.85; }
  }
  e.destX = tx; e.destZ = tz;
  const dx = tx - e.x, dz = tz - e.z, dd = Math.hypot(dx, dz);
  if (spd > 0 && dd > 0.6) {
    const step = Math.min(dd, spd * dt);
    let nx = e.x + (dx / dd) * step, nz = e.z + (dz / dd) * step;
    const hit = resolveCircle(nx, nz, e.radius, e.y + 0.9);
    if (hit && typeof hit === 'object' && 'x' in hit) { e.x = hit.x; e.z = hit.z; }
    else { e.x = nx; e.z = nz; }
    e.yaw = faceYaw(dx, dz);
    e.moving = true; e.speedNow = spd;
  } else {
    e.moving = false; e.speedNow = 0;
  }
  try { const fy = floorAt(e.x, e.z, e.y); if (typeof fy === 'number') e.y = fy; } catch (_) {}
  const distP = P && P.alive ? dist2(e.x, e.z, P.x, P.z) : 999;
  const visP = !!(P && P.alive && distP < 70 && !lineBlocked(e.x, e.z, P.x, P.z, e.y + 1.4, P.y + (P.eyeH || 1.5)));
  const tgt = pickCombatTarget(e, visP, distP);
  if (tgt && e.ammo > 0 && !e.reloading && e.fireCd <= 0) {
    enemyShoot(e, tgt, tgt.dist);
    e.fireCd = d.cd * rnd(1.05, 1.4);
    e.ammo = Math.max(0, e.ammo - 1);
  }
  updateHumanoidAnim(ud, {
    dt, moving: e.moving, speed: e.speedNow, grounded: true,
    ads: !!tgt, sprint: e.speedNow > 4, crouch: false, pitch: 0,
    reloading: e.reloading, reloadT: e.reloadT, missing: e.reloadMissing || 1, ammo: e.ammo, weapon: e.wid,
    onEvent: (n, i) => enemyEvent(e, n, i),
  });
  sync(e);
}

export function updateEnemy(dt, now, e) {
  if (!e.isLeader) {
    if (!e.alive) {
      e.deathT += dt;
      updateHumanoidAnim(e.mesh.userData, { dt, dead: true });
      if (e.respawnT > 0) { e.respawnT -= dt; if (e.respawnT <= 0) respawnEnemy(e); }
      sync(e);
      return;
    }
    updateFollower(dt, now, e);
    return;
  }
  leaderCommand(e, now);

  const ctx = e.ctx, P = ctx.player, ud = e.mesh.userData, d = e.def;

  if (!e.alive) {
    e.deathT += dt;
    updateHumanoidAnim(ud, { dt, dead: true });
    e.respawnT -= dt;
    if (e.respawnT <= 0) respawnEnemy(e);
    sync(e);
    return;
  }

  e.stateT -= dt; e.thinkT -= dt; e.fireCd -= dt; e.burstCd -= dt; e.wpT -= dt; e.strafeT -= dt;
  e.flinch = Math.max(0, e.flinch - dt);
  e.suppression = Math.max(0, e.suppression - dt * 0.3);
  if (now - e.lastHurt > 7 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + dt * 4);

  if (e.reloading) {
    e.reloadT += dt;
    if (e.reloadT >= e.reloadTotal) { e.reloading = false; e.ammo = e.mag; }
  }

  // ----- perception -----
  const pAlive = P.alive;
  const dx = P.x - e.x, dz = P.z - e.z;
  const dist = Math.hypot(dx, dz);
  const eyeE = e.y + (e.crouch ? 1.15 : 1.55), eyeP = P.y + P.eyeH;
  let vis = false;
  if (pAlive && dist < 100) {
    const inFov = Math.abs(angDiff(e.yaw, faceYaw(dx, dz))) < 1.15 || dist < 7 || e.engaged;
    vis = inFov && !lineBlocked(e.x, e.z, P.x, P.z, eyeE, eyeP);
  }
  e.vis = vis;

  if (vis) {
    e.focusX = P.x; e.focusZ = P.z; e.lastSeenT = now;
    const gain = (0.9 + 5 / (dist + 2)) * (P.crouching ? 0.75 : 1) * (P.sprinting ? 1.3 : 1);
    e.awareness = Math.min(1, e.awareness + gain * dt);
    e.engagedT += dt;
    e.focus = Math.min(1, e.focus + dt * (e.moving ? 0.25 : 0.55));
    if (e.awareness >= 0.999) {
      if (!e.engaged) { e.engaged = true; setState(e, 'engage', rnd(1.5, 2.5)); announce(e); }
      e.combatT = now;
    }
    if (e.engaged && (e.state === 'idle' || e.state === 'investigate' || e.state === 'search')) setState(e, 'engage', rnd(1.5, 2.5));
  } else {
    if (now - e.lastSeenT > 1.2) e.engagedT = 0;
    e.focus = Math.max(0, e.focus - dt * 0.5);
    if (!e.engaged) e.awareness = Math.max(0, e.awareness - dt * 0.2);
  }

  if (pAlive) {
    if (P.lastShotT > e.heardShotT) {
      e.heardShotT = P.lastShotT;
      if (dist < 120) hear(e, P.x, P.z, 0.65);
    }
    if (!vis && dist < (P.noise || 0) * 16 && now - e.heardFootT > 1.2) {
      e.heardFootT = now;
      hear(e, P.x, P.z, 0.3);
    }
  } else if (e.engaged) {
    e.engaged = false; e.awareness = 0; setState(e, 'idle', 0);
  }

  if (e.thinkT <= 0) think(e, now, dist, vis);

  // ----- movement -----
  const atCover = e.hasCover && dist2(e.x, e.z, e.coverX, e.coverZ) < 0.8;
  if (e.state === 'cover' && atCover) e.coverWaitT -= dt;
  e.crouch = e.state === 'cover' && atCover;

  const runSpd = RUN * (0.92 + 0.15 * e.skill);
  let tx = e.destX, tz = e.destZ, spd = 0, sprint = false;
  switch (e.state) {
    case 'idle': spd = WALK; break;
    case 'investigate': spd = WALK * 1.4; break;
    case 'search': spd = WALK * 1.5; break;
    case 'engage': {
      if (!vis) { tx = e.focusX; tz = e.focusZ; spd = e.wallPiece ? 0 : runSpd * 0.85; break; }
      const fx = dx / (dist || 1), fz = dz / (dist || 1);
      const want = d.id === 'longbow' ? 50 : d.id === 'breacher' ? 8 : e.role === 'rusher' ? 11 : e.role === 'flanker' ? 17 : 22;
      const rad = dist > want + 4 ? 1 : dist < want - 5 ? -0.9 : 0.15;
      if (e.strafeT <= 0) { e.strafeDir *= -1; e.strafeT = rnd(1.0, 2.2); }
      tx = e.x + (fx * rad - fz * e.strafeDir * 0.85) * 5;
      tz = e.z + (fz * rad + fx * e.strafeDir * 0.85) * 5;
      spd = runSpd * (rad > 0.5 ? 0.95 : 0.75);
      break;
    }
    case 'cover':
      if (!atCover) { spd = runSpd * 1.15; sprint = true; }
      break;
    case 'peek': spd = runSpd * 0.7; break;
    case 'flank': spd = runSpd * 1.1; sprint = !vis; break;
    case 'retreat': spd = runSpd * 1.2; sprint = true; break;
    default: break;
  }
  e.sprintFlag = sprint;

  let dvx = 0, dvz = 0;
  if (spd > 0 && dist2(e.x, e.z, tx, tz) > 0.2) {
    const wp = nextPoint(e, tx, tz);
    const wx = wp.x - e.x, wz = wp.z - e.z, wd = Math.hypot(wx, wz);
    if (wd > 0.15) { dvx = (wx / wd) * spd; dvz = (wz / wd) * spd; }
  }
  const slow = (e.flinch > 0 ? 0.5 : 1) * (e.reloading ? 0.85 : 1) * (d.move || 1);
  dvx *= slow; dvz *= slow;
  const k = Math.min(1, dt * 7);
  e.vx += (dvx - e.vx) * k;
  e.vz += (dvz - e.vz) * k;

  let nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
  for (const o of ctx.enemies) {
    if (o === e || !o.alive) continue;
    const dd = dist2(nx, nz, o.x, o.z);
    if (dd < 1.1 && dd > 1e-3) { nx += ((nx - o.x) / dd) * (1.1 - dd) * 0.5; nz += ((nz - o.z) / dd) * (1.1 - dd) * 0.5; }
  }
  const res = resolveCircle(nx, nz, e.radius, e.y, STAND_H);
  if (spd > 0 && dist2(res.x, res.z, e.x, e.z) < spd * dt * 0.25) e.stuckT += dt; else e.stuckT = 0;
  if (e.stuckT > 0.6) {
    e.stuckT = 0;
    const a = rnd(0, PI * 2);
    e.wp = { x: e.x + Math.cos(a) * 3, z: e.z + Math.sin(a) * 3 };
    e.wpT = 0.8;
  }
  e.x = res.x; e.z = res.z;
  e.y += (floorAt(e.x, e.z, e.y, 0.3) - e.y) * Math.min(1, dt * 16);
  e.speedNow = Math.hypot(e.vx, e.vz);
  e.moving = e.speedNow > 0.25;

  // ----- facing -----
  const wp2 = e.wallPiece && ctx.build && ctx.build.pieces.has(e.wallPiece.key) ? e.wallPiece : null;
  let wantYaw = e.yaw;
  if (pAlive && vis) wantYaw = faceYaw(dx, dz);
  else if (wp2) wantYaw = faceYaw(wp2.geom.x - e.x, wp2.geom.z - e.z);
  else if (e.engaged && now - e.lastSeenT < 2) wantYaw = faceYaw(e.focusX - e.x, e.focusZ - e.z);
  else if (e.moving) wantYaw = faceYaw(e.vx, e.vz);
  const turn = (vis ? 9 : 4.5) * dt;
  e.yaw += clamp(angDiff(wantYaw, e.yaw), -turn, turn);

  // ----- firing -----
  const running = (e.state === 'cover' && !atCover) || e.state === 'retreat';
  const maxRange = Math.min(100, d.falloff ? d.falloff.end * 1.5 : 100);
  const facing = pAlive && Math.abs(angDiff(e.yaw, faceYaw(dx, dz))) < 0.3;
  const canShoot = vis && e.engaged && !running && !e.reloading && e.ammo > 0 &&
    e.engagedT > e.reactTime && dist > 2.5 && dist < maxRange && facing;
  const canBreak = !canShoot && !!wp2 && e.engaged && !running && !e.reloading && e.ammo > 0 &&
    Math.abs(angDiff(e.yaw, faceYaw(wp2.geom.x - e.x, wp2.geom.z - e.z))) < 0.3;
  const combat = pickCombatTarget(e, vis, dist);
  const tgt = combat
    || (typeof canBreak !== 'undefined' && canBreak && wp2 ? { x: wp2.geom.x, y: (wp2.geom.y0 + wp2.geom.top) / 2, z: wp2.geom.z, player: false, bot: null } : null);
  if (tgt) {
    if (e.burstLeft <= 0 && e.burstCd <= 0) e.burstLeft = d.auto ? Math.round(rnd(3, 6)) : 1;
    if (e.burstLeft > 0 && e.fireCd <= 0) {
      enemyShoot(e, tgt, tgt.player ? dist : dist2(e.x, e.z, tgt.x, tgt.z));
      e.burstLeft--;
      e.fireCd = d.cd * rnd(1.0, 1.3);
      if (e.burstLeft <= 0) e.burstCd = (d.auto ? rnd(0.4, 1.0) : rnd(0.15, 0.5)) / e.skill;
    }
  } else e.burstLeft = 0;

  // ----- animation -----
  const aimPitch = vis ? Math.atan2(eyeP - 0.4 - (e.y + 1.35), dist) : 0;
  e.pitch += (aimPitch - e.pitch) * Math.min(1, dt * 8);
  const aiming = (vis || !!wp2) && e.engaged && !running && !e.reloading;
  updateHumanoidAnim(ud, {
    dt, moving: e.moving, speed: e.speedNow, grounded: true,
    ads: aiming && e.speedNow < 4.2,
    sprint: sprint && !aiming,
    crouch: e.crouch,
    pitch: e.pitch,
    reloading: e.reloading, reloadT: e.reloadT, missing: e.reloadMissing, ammo: e.ammo, weapon: e.wid,
    onEvent: (n, i) => enemyEvent(e, n, i),
    onStep: () => ctx.audio.play('step', e.x, e.z, { vol: e.crouch ? 0.35 : e.speedNow > 4.5 ? 0.9 : 0.6 }),
  });

  sync(e);
}
