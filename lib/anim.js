/** Procedural animation: walk / crouch / sprint, arm IK, first-person viewmodel and the full reload */
import * as THREE from 'three';
import { ANCHOR, HIP_Y, CHARGE_Z, CHARGE_TRAVEL, MAG_TILT } from './parts.js';

const PI = Math.PI;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const damp = (c, t, rate, dt) => c + (t - c) * (1 - Math.exp(-rate * dt));
const pulse = (t, at, len) => (t < at || t > at + len ? 0 : Math.sin(((t - at) / len) * PI));

/** Reload timeline (seconds). Events fire when playback passes each mark. */
export const RELOAD = {
  total: 2.85,
  marks: { magRelease: 0.5, magOut: 0.7, toss: 1.14, pouch: 1.46, magIn: 1.95, boltBack: 2.3, boltFwd: 2.44 },
};
const MK = RELOAD.marks;

/**
 * Tuning. p = position, r = rotation (x, y, z).
 * fp = viewmodel space (camera at origin, -Z forward). tp = chest space of the 3rd-person rig.
 * pouch = where the left hand goes to grab a fresh mag. pole = which way the elbows point.
 */
export const TUNE = {
  fp: {
    hip: { p: [0.19, -0.215, -0.5], r: [0.02, 0.05, 0] },
    ads: { p: [0, -0.098, -0.38], r: [0, 0, 0] },
    sprint: { p: [0.13, -0.27, -0.42], r: [0.55, -0.75, 0.18] },
    reload: { p: [0.1, -0.17, -0.44], r: [-0.12, 0.2, 0.36] },
    pouch: [-0.32, -0.75, -0.35],
    poleR: [0.6, -1, 0.3],
    poleL: [-0.5, -1, 0.2],
  },
  tp: {
    hip: { p: [0.13, 0.36, -0.36], r: [-0.12, 0.08, 0] },
    ads: { p: [0.12, 0.55, -0.38], r: [0, 0, 0] },
    sprint: { p: [0.1, 0.26, -0.3], r: [0.8, -0.5, 0.25] },
    reload: { p: [0.14, 0.4, -0.34], r: [-0.15, 0.22, 0.34] },
    pouch: [-0.1, 0.2, -0.15],
    poleR: [0.5, -1, 0.35],
    poleL: [-0.4, -1, 0.25],
  },
};

// ---------- two-bone IK ----------
const DOWN = new THREE.Vector3(0, -1, 0);
const _s = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _w = new THREE.Vector3(), _pp = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const ARM_A = 0.34, ARM_B = 0.31;

/** target + pole are in the shoulder's parent space. */
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

// ---------- left-hand reload keyframes ----------
// s:'r' = rifle-local wrist position, s:'p' = offset from the mag pouch
const FORE = ANCHOR.foreL.toArray();
const kR = (t, p, roll, curl) => ({ t, s: 'r', p, roll, curl });
const kP = (t, p, roll, curl) => ({ t, s: 'p', p, roll, curl });
const LH = [
  kR(0.0, FORE, PI * 0.8, 0.6),
  kR(0.36, [-0.075, -0.12, -0.02], PI * 0.5, 0.15), // reach for the mag
  kR(0.52, [-0.02, -0.14, -0.03], PI * 0.5, 0.9), // grip it
  kR(0.7, [-0.02, -0.2, -0.03], PI * 0.5, 0.9), // slide it out of the well
  kR(0.96, [-0.03, -0.37, -0.02], PI * 0.5, 0.9), // pull it clear
  kR(1.06, [-0.19, -0.33, -0.1], PI * 0.5, 0.7), // wind up
  kR(1.14, [-0.36, -0.3, -0.2], PI * 0.5, 0.1), // fling + release
  kP(1.3, [0, 0.06, 0], PI * 0.5, 0.15), // hand to the vest pouch
  kP(1.46, [0, 0, 0], PI * 0.5, 0.9), // grab fresh mag
  kP(1.6, [0.02, 0.1, -0.05], PI * 0.5, 0.9), // pull it out
  kR(1.82, [-0.03, -0.27, -0.02], PI * 0.5, 0.9), // bring it under the well
  kR(1.95, [-0.02, -0.13, -0.03], PI * 0.5, 0.9), // seat it
  kR(2.06, [-0.07, -0.12, -0.02], PI * 0.5, 0.2), // let go
  kR(2.18, [-0.07, 0.045, -0.01], PI * 0.5, 0.85), // grab charging handle
  kR(2.3, [-0.07, 0.045, 0.08], PI * 0.5, 0.9), // rack it back
  kR(2.44, [-0.07, 0.045, -0.01], PI * 0.5, 0.9), // let it slam forward
  kR(2.54, [-0.08, 0.02, -0.04], PI * 0.5, 0.2),
  kR(2.85, FORE, PI * 0.8, 0.6),
];

const _P = { p: [0, 0, 0], r: [0, 0, 0] };
const _lh = new THREE.Vector3(), _k0 = new THREE.Vector3(), _k1 = new THREE.Vector3();
const _wl = new THREE.Vector3(), _tr = new THREE.Vector3(), _pole = new THREE.Vector3();
const _pouch = new THREE.Vector3(), _inv = new THREE.Matrix4();
let _roll = 0, _curl = 0;

function keyBody(k, g, out) {
  out.fromArray(k.p);
  if (k.s === 'r') out.applyMatrix4(g.rifle.matrix);
  else out.add(_pouch);
}

function evalLH(t, g) {
  let i = 0;
  while (i < LH.length - 2 && t >= LH[i + 1].t) i++;
  const a = LH[i], b = LH[i + 1];
  const u = sstep((t - a.t) / (b.t - a.t));
  keyBody(a, g, _k0);
  keyBody(b, g, _k1);
  _lh.lerpVectors(_k0, _k1, u);
  _roll = lerp(a.roll, b.roll, u);
  _curl = lerp(a.curl, b.curl, u);
}

function basePose(T, a, s, out) {
  const k = s * (1 - a);
  for (let i = 0; i < 3; i++) {
    const p = lerp(T.hip.p[i], T.ads.p[i], a);
    const r = lerp(T.hip.r[i], T.ads.r[i], a);
    out.p[i] = lerp(p, T.sprint.p[i], k);
    out.r[i] = lerp(r, T.sprint.r[i], k);
  }
}

function driveMag(g, t, wl) {
  const mag = g.mag, home = ANCHOR.magHome;
  if (t < MK.magRelease) {
    mag.visible = true;
    mag.position.copy(home);
    mag.rotation.set(MAG_TILT, 0, 0);
    return;
  }
  if (t >= MK.toss && t < MK.pouch) { mag.visible = false; return; } // thrown away
  mag.visible = true;
  _k0.copy(wl).add(ANCHOR.magHold);
  let k = 1, tilt = 0, roll = 0;
  if (t < MK.toss) {
    k = sstep((t - MK.magRelease) / 0.12);
    roll = sstep((t - 0.96) / 0.18) * 0.9;
  } else if (t < MK.magIn) {
    const f = 1 - sstep((t - 1.62) / 0.3);
    tilt = f * 0.6;
    roll = -f * 0.5;
  } else {
    k = 1 - sstep((t - MK.magIn) / 0.06);
  }
  mag.position.lerpVectors(home, _k0, k);
  mag.rotation.set(MAG_TILT + tilt, 0, roll);
}

function fireMarks(g, t, st) {
  const prev = g.rlPrev;
  for (const name in MK) {
    const mt = MK[name];
    if (prev < mt && t >= mt && st.emit) {
      let info = null;
      if (name === 'toss') {
        const pos = _lh.clone();
        if (!st.fp && g.chest) g.chest.localToWorld(pos);
        info = { pos, fp: !!st.fp }; // fp: pos is in viewmodel space, caller converts
      }
      st.emit(name, info);
    }
  }
  g.rlPrev = t;
}

/** Places rifle, both hands, mag and charging handle for one frame. */
function poseRig(g, T, st) {
  const rifle = g.rifle;
  const rl = !!st.reloading;
  const t = rl ? st.t : 0;
  basePose(T, st.a, st.s, _P);
  const p = _P.p, r = _P.r;
  if (rl) {
    const w = sstep(t / 0.35) * (1 - sstep((t - 2.5) / 0.35));
    for (let i = 0; i < 3; i++) {
      p[i] = lerp(p[i], T.reload.p[i], w);
      r[i] = lerp(r[i], T.reload.r[i], w);
    }
    const j = pulse(t, MK.magIn, 0.12); // mag seating jolt
    p[1] -= 0.012 * j;
    r[0] += 0.06 * j;
    p[2] += 0.01 * pulse(t, MK.boltFwd, 0.1); // bolt slam
  }
  const k = st.kick;
  rifle.position.set(p[0] + st.ox, p[1] + st.oy + k * 0.008, p[2] + st.oz + k * 0.05);
  rifle.rotation.set(r[0] + st.rx + k * 0.09, r[1] + st.ry, r[2] + st.rz + k * st.kickRoll * 0.03);
  rifle.updateMatrix();

  _pouch.fromArray(T.pouch);
  if (rl) evalLH(t, g);
  else {
    _lh.copy(ANCHOR.foreL).applyMatrix4(rifle.matrix);
    _roll = PI * 0.8;
    _curl = 0.6;
  }
  _wl.copy(_lh).applyMatrix4(_inv.copy(rifle.matrix).invert());

  _tr.copy(ANCHOR.gripR).applyMatrix4(rifle.matrix);
  solveArm(g.armR, _tr, _pole.fromArray(T.poleR));
  g.armR.hand.rotation.y = -PI / 2;
  g.armR.curl(0.95);
  solveArm(g.armL, _lh, _pole.fromArray(T.poleL));
  g.armL.hand.rotation.y = _roll;
  g.armL.curl(_curl);

  if (rl) {
    driveMag(g, t, _wl);
    const pull = t > 2.1 && t < 2.6 ? clamp((_wl.z + 0.01) / CHARGE_TRAVEL) : 0;
    g.charge.position.z = CHARGE_Z + pull * CHARGE_TRAVEL;
    fireMarks(g, t, st);
  } else {
    g.mag.visible = true;
    g.mag.position.copy(ANCHOR.magHome);
    g.mag.rotation.set(MAG_TILT, 0, 0);
    g.charge.position.z = CHARGE_Z;
    g.rlPrev = -1;
  }
}

// ---------- public API ----------
export function triggerShootKick(ud) {
  if (!ud) return;
  ud.kick = 1;
  ud.kickRoll = Math.random() * 2 - 1;
}

export function resetViewmodelReload(vm) {
  if (vm && vm.userData) vm.userData.rlPrev = -1;
}
export function resetReloadAnim(ud) {
  if (ud) ud.rlPrev = -1;
}

/**
 * First-person viewmodel.
 * opts: dt, moving, sprint, grounded, ads, reloading, reloadT (seconds), lookDX, lookDY, shot,
 *       onEvent(name, info)
 */
export function updateViewmodel(vm, o) {
  if (!vm) return;
  const u = vm.userData;
  const dt = Math.min(o.dt || 0.016, 0.05);
  u.time += dt;
  const rl = !!o.reloading;
  u.aimBlend = damp(u.aimBlend, o.ads && !rl ? 1 : 0, 14, dt);
  u.sprintBlend = damp(u.sprintBlend, o.sprint && o.moving && !o.ads && !rl ? 1 : 0, 9, dt);
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
    a, s, kick: u.kick, kickRoll: u.kickRoll,
    ox: Math.sin(u.bob) * 0.012 * ba + u.swayX * sw,
    oy: Math.abs(Math.cos(u.bob)) * 0.011 * ba + Math.sin(u.time * 1.5) * 0.0012 * (1 - a * 0.5) + u.swayY * sw + (o.grounded === false ? -0.02 : 0),
    oz: 0,
    rx: u.swayY * 1.2,
    ry: u.swayX * 1.2,
    rz: -u.swayX * 1.5 + Math.sin(u.bob) * 0.01 * ba,
    reloading: rl, t: o.reloadT || 0, emit: o.onEvent, fp: true,
  });
}

/**
 * 3rd-person body (player, remotes, enemies).
 * opts: dt, moving, speed, grounded, ads, sprint, crouch, pitch, reloading, reloadT, dead,
 *       onEvent(name, info), onStep()
 */
export function updateHumanoidAnim(ud, o) {
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

  const grounded = o.grounded !== false;
  const spd = grounded ? Math.max(0, o.speed || 0) : 0;
  const moving = !!o.moving && spd > 0.2;
  const rl = !!o.reloading;

  ud.aimBlend = damp(ud.aimBlend, o.ads && !rl ? 1 : 0, 12, dt);
  ud.sprintBlend = damp(ud.sprintBlend, o.sprint && moving && !o.ads && !rl ? 1 : 0, 9, dt);
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
  ud.chest.rotation.x = pitch * 0.85 + lean;
  ud.head.rotation.x = pitch * 0.15 - lean * 0.8;

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
    a, s, kick: ud.kick, kickRoll: ud.kickRoll,
    ox: Math.sin(w) * 0.008 * bob,
    oy: Math.abs(Math.cos(w)) * 0.01 * bob + Math.sin(performance.now() * 0.0016) * 0.002,
    oz: 0, rx: 0, ry: 0, rz: 0,
    reloading: rl, t: o.reloadT || 0, emit: o.onEvent, fp: false,
  });
}
