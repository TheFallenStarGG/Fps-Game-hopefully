/** Shared builders: materials, rifle, magazine, hand, arm */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const HIP_Y = 0.94;
export const ARM_A = 0.34; // upper arm length
export const ARM_B = 0.31; // forearm length
export const CHARGE_Z = -0.05; // charging handle rest position (rifle-local z)
export const CHARGE_TRAVEL = 0.09;
export const MAG_TILT = 0.14;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Rifle-local anchor points. -Z is forward, origin at the receiver centre. */
export const ANCHOR = {
  gripR: V(0.012, -0.15, 0.14), // right wrist: rear-bottom of the grip (the hand wraps up and forward)
  foreL: V(-0.012, -0.075, -0.15), // left wrist on the front of the receiver / handguard
  magHome: V(0, -0.0625, -0.085), // top of the magazine when seated
  magHold: V(0.025, 0.07, -0.05), // magazine origin relative to the left wrist
};

const matCache = new WeakMap();
export function makeMaterials(tex) {
  let m = matCache.get(tex);
  if (m) return m;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  m = {
    gun: S({ color: 0xffffff, map: tex.gunmetal, metalness: 0.8, roughness: 0.36 }),
    gunDark: S({ color: 0xc8c8c8, map: tex.gunmetal, metalness: 0.7, roughness: 0.5 }),
    poly: S({ color: 0x2b2d30, map: tex.nylon, roughness: 0.7, metalness: 0.05 }),
    rubber: S({ color: 0x141414, roughness: 0.95 }),
    brass: S({ color: 0xd0a850, metalness: 0.95, roughness: 0.28 }),
    glove: S({ color: 0x23251f, map: tex.nylon, roughness: 0.85 }),
    black: S({ color: 0x0b0b0c, roughness: 0.6 }),
  };
  matCache.set(tex, m);
  return m;
}

const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const RB = (w, h, d, r = 0.01) => new RoundedBoxGeometry(w, h, d, 2, r);
const CYL = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);

function part(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Detachable magazine. Origin = top (insert end), body extends down -Y. */
export function makeMag(tex) {
  const M = makeMaterials(tex);
  const g = new THREE.Group();
  part(g, RB(0.027, 0.17, 0.056, 0.004), M.poly, 0, -0.085, 0);
  part(g, B(0.03, 0.012, 0.06), M.gunDark, 0, -0.176, 0.002);
  part(g, B(0.022, 0.016, 0.05), M.gun, 0, 0.004, 0);
  part(g, B(0.012, 0.012, 0.02), M.brass, 0, 0.014, -0.012);
  g.rotation.x = MAG_TILT;
  return g;
}

export function makeRifle(tex) {
  const M = makeMaterials(tex);
  const g = new THREE.Group();
  const p = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g) => part(parent, geo, mat, x, y, z, rx, ry, rz);
  const H = Math.PI / 2;

  // receiver + top rail
  p(RB(0.05, 0.075, 0.24, 0.008), M.poly, 0, -0.025, 0);
  p(RB(0.054, 0.052, 0.34, 0.006), M.gun, 0, 0.026, -0.03);
  p(B(0.026, 0.012, 0.56), M.gunDark, 0, 0.058, -0.09);
  for (let i = 0; i < 17; i++) p(B(0.028, 0.005, 0.01), M.gun, 0, 0.0665, -0.34 + i * 0.032);
  p(B(0.004, 0.026, 0.05), M.black, 0.028, 0.03, 0.0); // ejection port

  // handguard, barrel, muzzle device
  p(RB(0.058, 0.06, 0.3, 0.012), M.poly, 0, 0.015, -0.37);
  for (let i = 0; i < 4; i++) p(B(0.062, 0.014, 0.03), M.black, 0, 0.015, -0.3 - i * 0.06);
  p(CYL(0.0095, 0.0095, 0.09, 10), M.gunDark, 0, 0.02, -0.565, H);
  p(CYL(0.016, 0.014, 0.07, 10), M.black, 0, 0.02, -0.645, H);

  // iron sights (sight line sits at y = 0.098)
  p(RB(0.02, 0.03, 0.035, 0.004), M.gun, 0, 0.059, -0.5);
  p(B(0.004, 0.024, 0.004), M.black, 0, 0.086, -0.5);
  p(B(0.004, 0.03, 0.012), M.gun, -0.011, 0.082, -0.5);
  p(B(0.004, 0.03, 0.012), M.gun, 0.011, 0.082, -0.5);
  p(B(0.03, 0.02, 0.03), M.gun, 0, 0.074, 0.1);
  p(new THREE.TorusGeometry(0.011, 0.0025, 8, 16), M.black, 0, 0.098, 0.1);
  p(B(0.004, 0.028, 0.012), M.gun, -0.016, 0.083, 0.1);
  p(B(0.004, 0.028, 0.012), M.gun, 0.016, 0.083, 0.1);

  // stock
  p(CYL(0.018, 0.018, 0.09, 10), M.gunDark, 0, 0.005, 0.17, H);
  p(RB(0.044, 0.095, 0.15, 0.01), M.poly, 0, -0.022, 0.245);
  p(RB(0.036, 0.02, 0.11, 0.006), M.poly, 0, 0.036, 0.24);
  p(B(0.046, 0.1, 0.015), M.rubber, 0, -0.022, 0.32);

  // grip, trigger guard, trigger, magwell
  p(RB(0.034, 0.105, 0.045, 0.01), M.poly, 0, -0.11, 0.085, -0.28);
  p(B(0.008, 0.006, 0.075), M.gunDark, 0, -0.072, -0.03);
  p(B(0.008, 0.03, 0.006), M.gunDark, 0, -0.057, -0.067);
  p(B(0.006, 0.028, 0.008), M.black, 0, -0.052, -0.012, 0.3);
  p(RB(0.052, 0.04, 0.078, 0.006), M.poly, 0, -0.08, -0.085);

  // magazine
  const mag = makeMag(tex);
  mag.position.copy(ANCHOR.magHome);
  g.add(mag);

  // side charging handle (left side)
  p(B(0.008, 0.014, 0.2), M.black, -0.029, 0.035, -0.06);
  const charge = new THREE.Group();
  charge.position.set(-0.03, 0.035, CHARGE_Z);
  p(RB(0.024, 0.018, 0.016, 0.004), M.gunDark, -0.012, 0, 0, 0, 0, 0, charge);
  g.add(charge);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.685);
  const eject = new THREE.Object3D();
  eject.position.set(0.03, 0.032, 0);
  g.add(muzzle, eject);

  g.userData = { mag, charge, muzzle, eject };
  return g;
}

/**
 * Optional detailed hand (see handRig.js): setHandFactory((M, side) => Group) before building a viewmodel.
 * The factory must return a group with userData.curl(c) (or null to fall back to the simple glove).
 */
let handFactory = null;
export function setHandFactory(fn) { handFactory = fn; }

/** Gloved hand. Origin = wrist, fingers extend along -Y, palm faces +Z. side ('L' | 'R') only matters for the detailed hand. */
export function makeHand(M, side = null) {
  if (side && handFactory) {
    try {
      const d = handFactory(M, side);
      if (d) return d;
    } catch (err) { console.error('[hand] detailed hand failed, using the simple glove:', err); }
  }
  const mat = M.glove;
  const h = new THREE.Group();
  const fingers = [];
  part(h, RB(0.082, 0.085, 0.034, 0.012), mat, 0, -0.045, 0);
  for (let i = 0; i < 4; i++) {
    const f1 = new THREE.Group();
    f1.position.set(-0.03 + i * 0.02, -0.085, 0);
    part(f1, RB(0.018, 0.04, 0.02, 0.006), mat, 0, -0.02, 0);
    const f2 = new THREE.Group();
    f2.position.set(0, -0.04, 0);
    part(f2, RB(0.016, 0.035, 0.018, 0.006), mat, 0, -0.0175, 0);
    f1.add(f2);
    h.add(f1);
    fingers.push([f1, f2]);
  }
  const th = new THREE.Group();
  th.position.set(0.045, -0.03, 0.005);
  th.rotation.z = 0.5;
  part(th, RB(0.02, 0.05, 0.02, 0.007), mat, 0, -0.025, 0);
  h.add(th);
  h.userData.curl = (c) => {
    for (const [a, b] of fingers) {
      a.rotation.x = -c * 1.25;
      b.rotation.x = -c * 1.45;
    }
    th.rotation.x = -c * 0.5;
  };
  h.userData.curl(0.5);
  return h;
}

/** Two-segment arm. `shoulder` is the root pivot; IK in anim.js drives shoulder + elbow. handSide: 'L' | 'R' for the detailed hand. */
export function makeArm(M, sleeve, r, zone = 'limb', handSide = null) {
  const shoulder = new THREE.Group();
  const upper = part(shoulder, new THREE.CapsuleGeometry(r, ARM_A - 2 * r, 4, 10), sleeve, 0, -ARM_A / 2, 0);
  const elbow = new THREE.Group();
  elbow.position.y = -ARM_A;
  shoulder.add(elbow);
  const rf = r * 0.88;
  const fore = part(elbow, new THREE.CapsuleGeometry(rf, ARM_B - 2 * rf, 4, 10), sleeve, 0, -ARM_B / 2, 0);
  upper.userData.hitZone = fore.userData.hitZone = zone;
  const hand = makeHand(M, handSide);
  hand.position.y = -ARM_B;
  elbow.add(hand);
  return { shoulder, elbow, hand, curl: hand.userData.curl };
}
