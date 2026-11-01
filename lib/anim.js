/**
 * Procedural animation: walk / crouch / sprint, arm IK, per-weapon poses, data-driven reloads (arsenal.js),
 * bolt / pump cycles, melee swings, weapon swaps.
 * All functions accept the rig's userData (or the group that owns it).
 */
import * as THREE from 'three';
import { HIP_Y, ARM_A, ARM_B } from './parts.js';
import { ALL, reloadSpec } from './arsenal.js';
import { buildWeapon } from './weaponModels.js';

const PI = Math.PI;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const damp = (c, t, rate, dt) => c + (t - c) * (1 - Math.exp(-rate * dt));
const pulse = (t, at, len) => (t < at || t > at + len ? 0 : Math.sin(((t - at) / len) * PI));

/** legacy export (reload time is per weapon now: see arsenal.reloadDuration) */
export const RELOAD = { total: 2.85, marks: {} };

/**
 * Tuning. p = position, r = rotation (x, y, z).
 * fp = viewmodel space (camera at origin, -Z forward). tp = chest space of the 3rd-person rig.
 */
export const TUNE = {
  fp: {
    long: {
      hip: { p: [0.19, -0.215, -0.5], r: [0.02, 0.05, 0] },
      sprint: { p: [0.13, -0.27, -0.42], r: [0.55, -0.75, 0.18] },
      reload: { p: [0.1, -0.17, -0.44], r: [-0.12, 0.2, 0.36] },
    },
    short: {
      hip: { p: [0.14, -0.19, -0.42], r: [0.02, 0.04, 0] },
      sprint: { p: [0.12, -0.25, -0.36], r: [0.5, -0.5, 0.1] },
      reload: { p: [0.07, -0.16, -0.36], r: [-0.1, 0.15, 0.3] },
    },
    ads: { x: 0, y: 0 },
    lower: { y: -0.3, rx: 0.9 },
    pouch: [-0.32, -0.75, -0.35],
    poleR: [0.6, -1, 0.3],
    poleL: [-0.5, -1, 0.2],
    meleeOff: [0, 0, 0],
    restL: [-0.22, -0.32, -0.32],
  },
  tp: {
    long: {
      hip: { p: [0.13, 0.36, -0.36], r: [-0.12, 0.08, 0] },
      sprint: { p: [0.1, 0.26, -0.3], r: [0.8, -0.5, 0.25] },
      reload: { p: [0.14, 0.4, -0.34], r: [-0.15, 0.22, 0.34] },
    },
    short: {
      hip: { p: [0.12, 0.38, -0.28], r: [-0.1, 0.06, 0] },
      sprint: { p: [0.1, 0.3, -0.24], r: [0.7, -0.4, 0.2] },
      reload: { p: [0.12, 0.42, -0.26], r: [-0.12, 0.18, 0.3] },
    },
    ads: { x: 0.12, y: 0.648 },
    lower: { y: -0.25, rx: 0.8 },
    pouch: [-0.1, 0.2, -0.15],
    poleR: [0.5, -1, 0.35],
    poleL: [-0.4, -1, 0.25],
    meleeOff: [0, 0.75, -0.12],
    restL: [-0.22, 0.43, -0.44],
  },
};

const IDLE = PI * 0.8;
const REST_PARTS = ['charge', 'bolt', 'pump', 'slide', 'cyl', 'break'];
const MAG_HOLD = new THREE.Vector3(-0.005, 0.01, -0.02); // mag origin (top) relative to the gripping wrist, weapon space
const JOLT = { // [drop y, tilt x, push z] on named events
  magIn: [0.012, 0.06, 0], boltFwd: [0, 0, 0.01], pumpFwd: [0, 0, 0.012], close: [0.004, 0.02, 0.01],
  cylIn: [0.004, 0.03, 0], boltLock: [0, 0, 0.008], shellIn: [0.004, 0.02, 0],
};

// ---------- scratch ----------
const DOWN = new THREE.Vector3(0, -1, 0), NEGZ = new THREE.Vector3(0, 0, -1), IDQ = new THREE.Quaternion();
const Z3 = [0, 0, 0];
const _s = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _w = new THREE.Vector3();
const _pp = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _qi = new THREE.Quaternion();
const _P = { p: [0, 0, 0], r: [0, 0, 0] };
const _pouch = new THREE.Vector3(), _zero = new THREE.Vector3();
const _tr = new THREE.Vector3(), _lh = new THREE.Vector3(), _lw = new THREE.Vector3(), _le = new THREE.Vector3();
const _wl = new THREE.Vector3(), _k0 = new THREE.Vector3(), _k1 = new THREE.Vector3(), _mh = new THREE.Vector3();
const _dir = new THREE.Vector3(), _hp = new THREE.Vector3(), _tmp = new THREE.Vector3(), _pole = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _resR = { roll: 0, curl: 0 }, _resL = { roll: 0, curl: 0 };
const _vals = {};
let _active = null, _ts = 0;

const U = (r) => (r && r.userData && r.userData.hold ? r.userData : r);

// ---------- two-bone IK ----------
/** target + pole are in the shoulder's parent space. Leaves the elbow in _e and the wrist in _w. */
function solveArm(arm, target, pole) {
  _s.copy(arm.shoulder.position);
  _d.subVectors(target, _s);
  let dist = _d.length();
  dist = clamp(dist, Math.abs(ARM_A - ARM_B) * 1.05 + 0.01, (ARM_A + ARM_B) * 0.999);
  _d.normalize();
  const x = (ARM_A * ARM_A - ARM_B * ARM_B + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, ARM_A * ARM_A - x * x));
  _pp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_pp.lengthSq() < 1e-6) _pp.set(1, 0, 0).addScaledVector(_d, -_d.x);
  _pp.normalize();
  _e.copy(_s).addScaledVector(_d, x).addScaledVector(_pp, h);
  _w.copy(_s).addScaledVector(_d, dist);
  _u.subVectors(_e, _s).normalize();
  arm.shoulder.quaternion.setFromUnitVectors(DOWN, _u);
  _f.subVectors(_w, _e).normalize().applyQuaternion(_qi.copy(arm.shoulder.quaternion).invert());
  arm.elbow.quaternion.setFromUnitVectors(DOWN, _f);
}

// ---------- keyframe evaluation ----------
function evalTrack(tr, t) {
  if (t <= tr[0][0]) return tr[0][1];
  for (let i = 1; i < tr.length; i++) {
    if (t < tr[i][0]) {
      const a = tr[i - 1], b = tr[i];
      return lerp(a[1], b[1], (t - a[0]) / Math.max(1e-4, b[0] - a[0]));
    }
  }
  return tr[tr.length - 1][1];
}

/** Wrist position for an anchor + offset, in rig space (offsets on weapon anchors are in weapon space) */
function anchorRig(w, name, o, out) {
  if (name === 'pouch') return out.set(_pouch.x + o[0], _pouch.y + o[1], _pouch.z + o[2]);
  const b = name === 'origin' ? _zero : (w.anchors[name] || w.anchors.fore);
  return out.set(b.x + o[0], b.y + o[1], b.z + o[2]).applyMatrix4(w.group.matrix);
}

function evalHand(keys, t, w, out, res) {
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const u = sstep((t - a.t) / Math.max(1e-4, b.t - a.t));
  anchorRig(w, a.a, a.o, _k0);
  anchorRig(w, b.a, b.o, _k1);
  out.lerpVectors(_k0, _k1, u);
  res.roll = lerp(a.roll, b.roll, u);
  res.curl = lerp(a.curl, b.curl, u);
}

// ---------- weapon management ----------
export function initRig(ud, tex) {
  Object.assign(ud, {
    tex, cache: {}, w: null, def: null, id: null, pending: null,
    swapState: 0, swapping: false, lower: 0,
    mel: null, swingIdx: 0, cyOn: false, cycleT: 0, cyPrev: -1, rlPrev: -1, rlSpec: null, wasReloading: false,
  });
  return ud;
}

export function ensureWeapon(r, id) {
  const g = U(r);
  let w = g.cache[id];
  if (!w) {
    const def = ALL[id];
    w = buildWeapon(def.model, g.tex);
    w.def = def;
    g.cache[id] = w;
  }
  return w;
}

function resetMag(w) {
  if (!w.mag) return;
  w.mag.visible = true;
  w.mag.position.copy(w.magHome);
  w.mag.rotation.set(w.magTilt, 0, 0);
}

/** Put a weapon in the hands immediately (no swap animation) */
export function equipNow(r, id) {
  const g = U(r);
  if (!ALL[id]) return;
  const w = ensureWeapon(g, id);
  if (g.w && g.w !== w) g.hold.remove(g.w.group);
  g.hold.add(w.group);
  g.w = w; g.def = ALL[id]; g.id = id;
  g.muzzle = w.muzzle; g.eject = w.eject; g.mag = w.mag;
  g.rlPrev = -1; g.cyPrev = -1; g.cyOn = false; g.mel = null; g.rlSpec = null; g.wasReloading = false;
  w.group.visible = true;
  for (const n of REST_PARTS) if (w.parts[n]) w.parts[n].set(0);
  for (const k in w.props) w.props[k].visible = false;
  resetMag(w);
}

/** Request a weapon (animated lower -> swap -> raise). instant = skip the animation. */
export function setWeapon(r, id, instant) {
  const g = U(r);
  if (!ALL[id]) return;
  if (instant || !g.w) {
    equipNow(g, id);
    g.swapState = 0; g.lower = 0; g.pending = null; g.swapping = false;
    return;
  }
  if (id === g.id) {
    if (g.swapState === 1) { g.pending = null; g.swapState = 2; }
    return;
  }
  g.pending = id;
  g.swapState = 1;
  g.swapping = true;
}

function syncWeapon(g, o, dt) {
  const want = o.weapon || g.id || 'vanguard';
  if (!g.w) equipNow(g, want);
  else if (want !== (g.pending || g.id)) setWeapon(g, want);
  if (g.swapState === 1) {
    g.lower = Math.min(1, g.lower + dt / 0.16);
    if (g.lower >= 1) {
      if (g.pending) { equipNow(g, g.pending); g.pending = null; }
      g.swapState = 2;
    }
  } else if (g.swapState === 2) {
    g.lower = Math.max(0, g.lower - dt / Math.max(0.12, g.def.draw || 0.4));
    if (g.lower <= 0) g.swapState = 0;
  }
  g.swapping = g.swapState !== 0;
}

function beginReload(g, o) {
  const rl = !!o.reloading && g.def.kind === 'gun' && !g.swapping;
  if (rl && !g.wasReloading) { g.rlSpec = reloadSpec(g.def, o.missing || 1); g.rlPrev = -1; g.cyOn = false; }
  if (!rl && g.wasReloading) { g.rlSpec = null; g.rlPrev = -1; }
  g.wasReloading = rl;
  return rl;
}

function stepCycle(g, dt, rl) {
  if (rl) g.cyOn = false;
  if (!g.cyOn) return;
  g.cycleT += dt;
  if (!g.def.cycle || g.cycleT >= g.def.cycle.dur) g.cyOn = false;
}

function outPos(g, v) {
  const p = v.clone();
  if (!g.fp && g.chest) { g.chest.updateWorldMatrix(true, false); g.chest.localToWorld(p); }
  return p;
}

// ---------- per-frame weapon driving ----------
function fireEvents(g, w, evs, t, key, emit) {
  const prev = g[key];
  if (emit && evs) {
    for (const e of evs) {
      if (prev < e[0] && t >= e[0]) {
        let info = null;
        if (e[1] === 'toss') info = { pos: outPos(g, _lh), fp: !!g.fp };
        else if (e[1] === 'eject' && w.eject) info = { pos: outPos(g, _tmp.copy(w.eject.position).applyMatrix4(w.group.matrix)), fp: !!g.fp };
        emit(e[1], info);
      }
    }
  }
  g[key] = t;
}

function driveMag(w, spec, t) {
  const mk = spec.mag, mag = w.mag;
  if (!mk || t < mk.rel) { resetMag(w); return; }
  if (t >= mk.toss && t < mk.pouch) { mag.visible = false; return; } // thrown away
  mag.visible = true;
  _mh.copy(_wl).add(MAG_HOLD);
  let k = 1, tilt = 0, roll = 0;
  if (t < mk.toss) {
    k = sstep((t - mk.rel) / 0.1);
    roll = sstep((t - (mk.toss - 0.18)) / 0.18) * 0.9;
  } else if (t < mk.ins) {
    const a0 = mk.pouch + (mk.ins - mk.pouch) * 0.32, len = (mk.ins - mk.pouch) * 0.62;
    const f = 1 - sstep((t - a0) / len);
    tilt = f * 0.6;
    roll = -f * 0.5;
  } else k = 1 - sstep((t - mk.ins) / 0.06);
  mag.position.lerpVectors(w.magHome, _mh, k);
  mag.rotation.set(w.magTilt + tilt, 0, roll);
}

function driveProps(w, spec, t) {
  for (const k in w.props) w.props[k].visible = false;
  if (!spec || !spec.held) return;
  for (const h of spec.held) {
    if (t < h.t0 || t >= h.t1) continue;
    const pr = w.props[h.kind];
    if (!pr) continue;
    pr.visible = true;
    _dir.subVectors(_lw, _le).normalize();
    _hp.copy(_lw).addScaledVector(_dir, 0.09).applyMatrix4(_inv);
    _dir.transformDirection(_inv);
    const u = sstep((t - (h.t1 - 0.18)) / 0.18);
    pr.position.lerpVectors(_hp, w.anchors.port, u);
    pr.quaternion.setFromUnitVectors(NEGZ, _dir).slerp(IDQ, u);
  }
}

function driveParts(g, w, spec, t) {
  for (const k in _vals) delete _vals[k];
  if (spec && spec.tracks) for (const n in spec.tracks) _vals[n] = evalTrack(spec.tracks[n], t);
  for (const n of REST_PARTS) if (w.parts[n]) w.parts[n].set(_vals[n] || 0);
  if (_vals.string !== undefined && w.parts.string) w.parts.string.set(_vals.string);
  if (_vals.loaded !== undefined && w.parts.loaded) w.parts.loaded.set(_vals.loaded);
  if (w.parts.kick) w.parts.kick.set(g.kick);
}

// ---------- poses ----------
function poseGun(g, T, st) {
  const w = g.w, def = g.def, m = w.group;
  const rlSpec = st.rl ? g.rlSpec : null;
  _active = rlSpec || (g.cyOn && g.cycleT >= 0 && def.cycle ? def.cycle : null);
  _ts = rlSpec ? Math.min(st.t, rlSpec.total) : g.cycleT;
  m.visible = !st.hidden;

  const cls = def.cls === 'short' ? T.short : T.long;
  const a = st.a, k = st.s * (1 - a);
  const ads = [T.ads.x, T.ads.y - w.sightY, -w.adsZ];
  const p = _P.p, r = _P.r;
  for (let i = 0; i < 3; i++) {
    p[i] = lerp(lerp(cls.hip.p[i], ads[i], a), cls.sprint.p[i], k);
    r[i] = lerp(lerp(cls.hip.r[i], 0, a), cls.sprint.r[i], k);
  }
  if (rlSpec) {
    const wgt = sstep(_ts / 0.35) * (1 - sstep((_ts - (rlSpec.total - 0.35)) / 0.35));
    for (let i = 0; i < 3; i++) {
      p[i] = lerp(p[i], cls.reload.p[i], wgt);
      r[i] = lerp(r[i], cls.reload.r[i], wgt);
    }
  }
  if (_active) {
    for (const e of _active.events) {
      const j = JOLT[e[1]];
      if (!j) continue;
      const pl = pulse(_ts, e[0], 0.11);
      p[1] -= j[0] * pl; r[0] += j[1] * pl; p[2] += j[2] * pl;
    }
  }

  const ks = clamp(0.5 + def.recoil * 30, 0.6, 2.4), kk = st.kick, low = st.lower;
  m.position.set(p[0] + st.ox, p[1] + st.oy + kk * 0.008 * ks + T.lower.y * low, p[2] + st.oz + kk * 0.05 * ks);
  m.rotation.set(r[0] + st.rx + kk * 0.09 * ks + T.lower.rx * low, r[1] + st.ry, r[2] + st.rz + kk * st.kickRoll * 0.03);
  m.updateMatrix();

  if (_active && _active.lh) evalHand(_active.lh, _ts, w, _lh, _resL);
  else { anchorRig(w, 'fore', Z3, _lh); _resL.roll = IDLE; _resL.curl = 0.6; }
  const rh = _active && _active.rh;
  if (rh && _ts >= rh[0].t && _ts <= rh[rh.length - 1].t) evalHand(rh, _ts, w, _tr, _resR);
  else { anchorRig(w, 'grip', Z3, _tr); _resR.roll = -PI / 2; _resR.curl = 0.95; }
}

function postGun(g, st) {
  const w = g.w;
  _inv.copy(w.group.matrix).invert();
  _wl.copy(_lh).applyMatrix4(_inv);
  driveParts(g, w, _active, _ts);
  driveProps(w, st.rl ? _active : null, _ts);
  if (w.mag) { if (st.rl && _active && _active.mag) driveMag(w, _active, _ts); else resetMag(w); }
  if (_active) fireEvents(g, w, _active.events, _ts, st.rl ? 'rlPrev' : 'cyPrev', st.emit);
  else {
    g.rlPrev = -1; g.cyPrev = -1;
    if (st.ammo !== undefined) w.setAmmo(st.ammo);
  }
}

function poseMelee(g, T, st) {
  const w = g.w, def = g.def, m = w.group, off = T.meleeOff;
  let a = def.idle, b = def.idle, u = 0, done = false;
  const mel = g.mel;
  let spec = null;
  if (mel) {
    spec = mel.kind === 'throw' ? def.throw : def.swings[mel.i];
    mel.t += st.dt;
    const keys = spec.keys;
    let i = 0;
    while (i < keys.length - 2 && mel.t >= keys[i + 1].t) i++;
    a = keys[i]; b = keys[i + 1];
    u = sstep((mel.t - a.t) / Math.max(1e-4, b.t - a.t));
    done = mel.t >= spec.dur;
  }
  const sp = st.s, low = st.lower;
  const R = [0, 0, 0], rot = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    R[i] = lerp(a.R[i], b.R[i], u) + off[i];
    rot[i] = lerp(a.rot[i], b.rot[i], u);
  }
  m.position.set(R[0] + 0.04 * sp + st.ox * 0.5, R[1] - 0.06 * sp + st.oy * 0.5 + T.lower.y * low, R[2] + 0.1 * sp + st.oz);
  m.rotation.set(rot[0] + 0.3 * sp + T.lower.rx * low, rot[1], rot[2]);
  m.updateMatrix();

  if (mel) {
    if (!mel.started) { mel.started = true; if (st.emit) st.emit(mel.kind === 'throw' ? 'throwStart' : 'swing', { i: mel.i }); }
    if (mel.kind === 'swing' && !mel.hit && mel.t >= spec.hit) { mel.hit = true; if (st.emit) st.emit('meleeHit', { i: mel.i }); }
    if (mel.kind === 'throw' && !mel.rel && mel.t >= spec.release) {
      mel.rel = true;
      if (st.emit) st.emit('throwRelease', { pos: outPos(g, m.position), fp: !!g.fp });
    }
  }
  const thrown = !!(mel && mel.kind === 'throw' && mel.rel);
  m.visible = !st.hidden && !thrown;

  anchorRig(w, 'grip', Z3, _tr);
  _resR.roll = -PI / 2;
  _resR.curl = thrown ? 0.3 : (def.model === 'fists' ? 1.05 : 0.95);

  const lp = (key, out) => {
    if (Array.isArray(key.L)) return out.set(key.L[0] + off[0], key.L[1] + off[1], key.L[2] + off[2]);
    if (key.L === 'weapon') return anchorRig(w, 'fore', Z3, out);
    return out.set(T.restL[0], T.restL[1], T.restL[2]);
  };
  lp(a, _k0); lp(b, _k1);
  _lh.lerpVectors(_k0, _k1, u);
  _resL.roll = PI / 2;
  _resL.curl = def.model === 'fists' ? 1.05 : (a.L === 'weapon' ? 0.95 : 0.8);

  if (done) g.mel = null;
}

function finishArms(g, T) {
  solveArm(g.armR, _tr, _pole.fromArray(T.poleR));
  g.armR.hand.rotation.y = _resR.roll;
  g.armR.curl(_resR.curl);
  solveArm(g.armL, _lh, _pole.fromArray(T.poleL));
  _lw.copy(_w); _le.copy(_e);
  g.armL.hand.rotation.y = _resL.roll;
  g.armL.curl(_resL.curl);
}

function poseRig(g, T, st) {
  if (!g.w) return;
  _pouch.fromArray(T.pouch);
  if (g.def.kind === 'melee') {
    poseMelee(g, T, st);
    finishArms(g, T);
  } else {
    poseGun(g, T, st);
    finishArms(g, T);
    postGun(g, st);
  }
}

// ---------- public API ----------
export function triggerShootKick(r) {
  const g = U(r);
  if (!g) return;
  g.kick = 1;
  g.kickRoll = Math.random() * 2 - 1;
  if (g.def && g.def.cycle) { g.cyOn = true; g.cycleT = -0.12; g.cyPrev = -1; }
}

/** Start a melee animation. kind: 'swing' | 'throw'. Returns false if busy / not a melee weapon. */
export function triggerMelee(r, kind = 'swing') {
  const g = U(r);
  if (!g || !g.def || g.def.kind !== 'melee' || g.mel || g.swapping) return false;
  if (kind === 'throw' && !g.def.throw) return false;
  const i = kind === 'swing' ? (g.swingIdx++ % g.def.swings.length) : 0;
  g.mel = { kind, i, t: 0, hit: false, rel: false, started: false };
  return true;
}
export function meleeBusy(r) {
  const g = U(r);
  return !!(g && g.mel);
}

export function resetViewmodelReload(vm) { const g = U(vm); if (g) g.rlPrev = -1; }
export function resetReloadAnim(ud) { const g = U(ud); if (g) g.rlPrev = -1; }

/**
 * First-person viewmodel.
 * opts: dt, moving, sprint, grounded, ads, reloading, reloadT, missing, ammo, weapon, weaponHidden,
 *       lookDX, lookDY, shot, onEvent(name, info)
 */
export function updateViewmodel(vm, o) {
  const u = U(vm);
  if (!u) return;
  const dt = Math.min(o.dt || 0.016, 0.05);
  u.time += dt;
  syncWeapon(u, o, dt);
  const def = u.def, gun = def.kind === 'gun';
  const rl = beginReload(u, o);
  stepCycle(u, dt, rl);

  const adsOn = !!o.ads && gun && !rl && !u.swapping;
  u.aimBlend = damp(u.aimBlend, adsOn ? 1 : 0, clamp(6 / (def.draw || 0.4), 7, 22), dt);
  u.sprintBlend = damp(u.sprintBlend, o.sprint && o.moving && !adsOn && !rl ? 1 : 0, 9, dt);
  const a = u.aimBlend, s = u.sprintBlend;
  const mv = !!o.moving && o.grounded !== false;
  u.bobAmp = damp(u.bobAmp, mv ? 1 : 0, 8, dt);
  if (mv) u.bob += dt * (o.sprint ? 12 : 8.5);
  const ba = u.bobAmp * (1 - a * 0.85) * (1 + s * 0.8);

  u.swayX = clamp(u.swayX - (o.lookDX || 0) * 0.0006, -0.05, 0.05);
  u.swayY = clamp(u.swayY + (o.lookDY || 0) * 0.0006, -0.05, 0.05);
  u.swayX = damp(u.swayX, 0, 8, dt);
  u.swayY = damp(u.swayY, 0, 8, dt);
  if (o.shot) triggerShootKick(u);
  u.kick = damp(u.kick, 0, 16, dt);
  const sw = 1 - a * 0.7;

  poseRig(u, TUNE.fp, {
    a, s, kick: u.kick, kickRoll: u.kickRoll, lower: sstep(u.lower), dt,
    ox: Math.sin(u.bob) * 0.012 * ba + u.swayX * sw,
    oy: Math.abs(Math.cos(u.bob)) * 0.011 * ba + Math.sin(u.time * 1.5) * 0.0012 * (1 - a * 0.5) + u.swayY * sw + (o.grounded === false ? -0.02 : 0),
    oz: 0, rx: u.swayY * 1.2, ry: u.swayX * 1.2, rz: -u.swayX * 1.5 + Math.sin(u.bob) * 0.01 * ba,
    rl, t: o.reloadT || 0, ammo: o.ammo, hidden: !!o.weaponHidden, emit: o.onEvent,
  });
}

/**
 * 3rd-person body (player, remotes, enemies).
 * opts: dt, moving, speed, grounded, ads, sprint, crouch, pitch, reloading, reloadT, missing, ammo, weapon,
 *       weaponHidden, dead, onEvent(name, info), onStep()
 */
export function updateHumanoidAnim(r, o) {
  const ud = U(r);
  if (!ud || !ud.hips) return;
  const dt = Math.min(o.dt || 0.016, 0.05);

  if (o.dead) {
    ud.deathT += dt;
    const k = sstep(ud.deathT / 0.55);
    ud.hips.rotation.x = k * 1.5;
    ud.hips.position.y = lerp(HIP_Y, 0.17, k);
    ud.hips.position.z = 0;
    return;
  }
  ud.deathT = 0;
  ud.hips.rotation.x = 0;

  syncWeapon(ud, o, dt);
  const def = ud.def, gun = def.kind === 'gun';
  const rl = beginReload(ud, o);
  stepCycle(ud, dt, rl);

  const grounded = o.grounded !== false;
  const spd = grounded ? Math.max(0, o.speed || 0) : 0;
  const moving = !!o.moving && spd > 0.2;
  const adsOn = !!o.ads && gun && !rl && !ud.swapping;

  ud.aimBlend = damp(ud.aimBlend, adsOn ? 1 : 0, clamp(6 / (def.draw || 0.4), 7, 20), dt);
  ud.sprintBlend = damp(ud.sprintBlend, o.sprint && moving && !adsOn && !rl ? 1 : 0, 9, dt);
  ud.crouchBlend = damp(ud.crouchBlend, o.crouch ? 1 : 0, 10, dt);
  ud.airBlend = damp(ud.airBlend, grounded ? 0 : 1, 9, dt);
  ud.moveBlend = damp(ud.moveBlend, moving ? 1 : 0, 10, dt);
  const a = ud.aimBlend, s = ud.sprintBlend, c = ud.crouchBlend, air = ud.airBlend, m = ud.moveBlend;

  if (moving) ud.walkPhase += dt * spd * 1.5;
  const w = ud.walkPhase;
  const ampN = clamp(spd / 8.5);
  const swing = Math.sin(w) * (0.35 + 0.45 * ampN) * m * (1 - c * 0.4);
  const flexAmp = (0.5 + 0.5 * ampN) * m;
  const flexL = Math.max(0, Math.cos(w)) * flexAmp;
  const flexR = Math.max(0, -Math.cos(w)) * flexAmp;

  ud.legL.thigh.rotation.x = swing + c * 0.9 + air * 0.5;
  ud.legR.thigh.rotation.x = -swing + c * 0.9 + air * 0.35;
  ud.legL.shin.rotation.x = -(flexL + 0.04 + c * 1.4 + air * 0.9);
  ud.legR.shin.rotation.x = -(flexR + 0.04 + c * 1.4 + air * 0.6);

  ud.hips.position.y = HIP_Y - 0.23 * c + Math.abs(Math.sin(w)) * 0.04 * ampN * m * (1 - c);
  ud.hips.position.z = 0.127 * c;

  const pitch = o.pitch || 0;
  const lean = s * 0.18 + c * 0.15;
  ud.chest.rotation.x = pitch * 0.85 - lean; // negative = lean forward
  ud.head.rotation.x = pitch * 0.15 + lean * 0.8;

  if (o.onStep && moving && grounded) {
    const idx = Math.floor(w / PI);
    if (idx !== ud.stepIdx) {
      ud.stepIdx = idx;
      o.onStep();
    }
  }

  ud.kick = damp(ud.kick, 0, 16, dt);
  const bob = m * (1 - a * 0.8);
  poseRig(ud, TUNE.tp, {
    a, s, kick: ud.kick, kickRoll: ud.kickRoll, lower: sstep(ud.lower), dt,
    ox: Math.sin(w) * 0.008 * bob,
    oy: Math.abs(Math.cos(w)) * 0.01 * bob + Math.sin(performance.now() * 0.0016) * 0.002,
    oz: 0, rx: 0, ry: 0, rz: 0,
    rl, t: o.reloadT || 0, ammo: o.ammo, hidden: !!o.weaponHidden, emit: o.onEvent,
  });
}
