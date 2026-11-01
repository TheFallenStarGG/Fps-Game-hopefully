/** Soldier model (3rd person rig) + first-person viewmodel. Weapons are attached by anim.js (equipNow / setWeapon). */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeMaterials, makeArm, HIP_Y } from './parts.js';
import { initRig, equipNow } from './anim.js';

const DEFAULT_WEAPON = 'vanguard';

const KIND = {
  player: { camo: 'camoGrey', vest: 0x3a424c, helmet: 0x3b434d, accent: 0x4aa8ff, skin: 0xc29a78 },
  enemy: { camo: 'camoTan', vest: 0x5b4a38, helmet: 0x4b4034, accent: 0xff4636, skin: 0x8d6a52 },
  remote: { camo: 'camoGreen', vest: 0x364636, helmet: 0x3a4a38, accent: 0x5dff9a, skin: 0xb88d6c },
};

const RB = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 3, r);
const CYL = (rt, rb, h, s = 14) => new THREE.CylinderGeometry(rt, rb, h, s);
const CAP = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

function P(parent, geo, mat, x, y, z, hz = 'body', rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.userData.hitZone = hz;
  parent.add(m);
  return m;
}

/** kind: 'player' | 'enemy' | 'remote' */
export function makeHumanoid(tex, kind = 'enemy') {
  const K = KIND[kind] || KIND.enemy;
  const M = makeMaterials(tex);
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const uni = S({ color: 0xffffff, map: tex[K.camo], roughness: 0.92 });
  const vest = S({ color: K.vest, map: tex.nylon, roughness: 0.9 });
  const vestDark = S({ color: 0x1e2022, map: tex.nylon, roughness: 0.85 });
  const helmetM = S({ color: K.helmet, map: tex.nylon, roughness: 0.6, metalness: 0.1 });
  const skin = S({ color: K.skin, roughness: 0.72 });
  const boot = S({ color: 0x1b1713, roughness: 0.85 });
  const lens = S({ color: K.accent, emissive: K.accent, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.5 });
  const patch = S({ color: K.accent, roughness: 0.8 });
  const mask = S({ color: 0x17181a, roughness: 0.9 });

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  root.add(hips);
  P(hips, RB(0.34, 0.2, 0.22, 0.06), uni, 0, 0, 0);
  P(hips, RB(0.36, 0.05, 0.24, 0.015), vestDark, 0, 0.09, 0);
  P(hips, RB(0.05, 0.11, 0.07, 0.01), vestDark, 0.19, -0.02, 0.02);

  function makeLeg(x) {
    const thigh = new THREE.Group();
    thigh.position.set(x, -0.04, 0);
    hips.add(thigh);
    P(thigh, CAP(0.075, 0.3), uni, 0, -0.22, 0, 'limb');
    const shin = new THREE.Group();
    shin.position.y = -0.44;
    thigh.add(shin);
    P(shin, CAP(0.062, 0.26), uni, 0, -0.2, 0, 'limb');
    P(shin, RB(0.1, 0.05, 0.09, 0.02), vestDark, 0, -0.04, -0.06, 'limb');
    P(shin, RB(0.105, 0.14, 0.28, 0.03), boot, 0, -0.385, -0.045, 'limb');
    return { thigh, shin };
  }
  const legL = makeLeg(-0.095);
  const legR = makeLeg(0.095);

  // torso + plate carrier
  const chest = new THREE.Group();
  chest.position.y = 0.1;
  hips.add(chest);
  P(chest, RB(0.36, 0.52, 0.22, 0.07), uni, 0, 0.26, 0);
  P(chest, RB(0.41, 0.36, 0.26, 0.05), vest, 0, 0.29, 0);
  P(chest, RB(0.27, 0.3, 0.03, 0.01), vestDark, 0, 0.32, -0.14);
  P(chest, RB(0.27, 0.3, 0.03, 0.01), vestDark, 0, 0.32, 0.14);
  for (const x of [-0.14, -0.065, 0.065, 0.14]) {
    P(chest, RB(0.065, 0.12, 0.05, 0.012), vestDark, x, 0.14, -0.165);
    P(chest, RB(0.055, 0.02, 0.04, 0.008), vest, x, 0.205, -0.165);
  }
  P(chest, RB(0.3, 0.36, 0.14, 0.04), vest, 0, 0.3, 0.2);
  P(chest, CAP(0.04, 0.22), vestDark, 0, 0.5, 0.2, 'body', 0, 0, Math.PI / 2);
  P(chest, CYL(0.05, 0.055, 0.09), skin, 0, 0.55, 0, 'head');
  for (const sx of [-1, 1]) P(chest, new THREE.SphereGeometry(0.065, 12, 10), vest, sx * 0.2, 0.47, 0, 'limb');

  // head
  const head = new THREE.Group();
  head.position.y = 0.58;
  chest.add(head);
  P(head, new THREE.SphereGeometry(0.1, 20, 16), skin, 0, 0.09, 0, 'head').scale.set(0.92, 1.1, 1);
  if (kind === 'enemy') {
    P(head, new THREE.SphereGeometry(0.103, 20, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.4), mask, 0, 0.09, 0, 'head').scale.set(0.92, 1.1, 1);
  }
  P(head, RB(0.17, 0.045, 0.05, 0.015), lens, 0, 0.105, -0.085, 'head');
  const dome = P(head, new THREE.SphereGeometry(0.125, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), helmetM, 0, 0.11, 0.01, 'head');
  dome.scale.set(1, 0.9, 1.12);
  P(head, CYL(0.13, 0.135, 0.02, 24), helmetM, 0, 0.113, 0.012, 'head').scale.z = 1.12;
  P(head, RB(0.05, 0.035, 0.03, 0.008), vestDark, 0, 0.17, -0.12, 'head');
  P(head, RB(0.05, 0.02, 0.012, 0.004), patch, 0, 0.14, 0.14, 'head');

  // arms (IK driven in anim.js)
  const sleeve = uni;
  const armR = makeArm(M, sleeve, 0.052);
  const armL = makeArm(M, sleeve, 0.052);
  armR.shoulder.position.set(0.2, 0.45, 0);
  armL.shoulder.position.set(-0.2, 0.45, 0);
  chest.add(armR.shoulder, armL.shoulder);
  P(armL.shoulder, CYL(0.057, 0.057, 0.07), patch, 0, -0.14, 0, 'limb');

  // weapons attach here (anim.js). Weapon meshes carry no hitZone, so bullets pass through them.
  const hold = new THREE.Group();
  chest.add(hold);

  root.userData = {
    kind, root, hips, chest, head, legL, legR, armL, armR, hold,
    walkPhase: 0, stepIdx: 0,
    aimBlend: 0, sprintBlend: 0, crouchBlend: 0, airBlend: 0, moveBlend: 0,
    kick: 0, kickRoll: 0, deathT: 0,
  };
  initRig(root.userData, tex);
  equipNow(root.userData, DEFAULT_WEAPON);
  return root;
}

/** First-person arms + weapon. Render it in its own scene/camera (see game.js). */
export function makeViewmodel(tex) {
  const M = makeMaterials(tex);
  const vm = new THREE.Group();
  const hold = new THREE.Group();
  vm.add(hold);
  const sleeve = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.camoGrey, roughness: 0.92 });
  const armR = makeArm(M, sleeve, 0.05);
  const armL = makeArm(M, sleeve, 0.05);
  armR.shoulder.position.set(0.2, -0.3, 0.12);
  armL.shoulder.position.set(-0.14, -0.3, -0.12);
  vm.add(armR.shoulder, armL.shoulder);
  vm.traverse((o) => {
    if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; }
  });
  vm.userData = {
    fp: true, armR, armL, hold,
    time: 0, bob: 0, bobAmp: 0, swayX: 0, swayY: 0,
    aimBlend: 0, sprintBlend: 0, kick: 0, kickRoll: 0,
  };
  initRig(vm.userData, tex);
  equipNow(vm.userData, DEFAULT_WEAPON);
  return vm;
}
