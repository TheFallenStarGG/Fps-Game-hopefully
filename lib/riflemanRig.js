/**
 * Third-person soldier: the Polyfork "Infantry Rifleman" (skinned, Mixamo-named skeleton, T-pose, faces +Z).
 *
 * The game keeps animating the old procedural rig (anim.js: legs, chest, head, arm IK, weapon `hold`).
 * That rig is now INVISIBLE ("driver"). Every time the scene's matrices update, `sync` copies the driver's pose
 * onto the model's bones, re-solving the arm IK for the model's own (shorter) arms and pulling the weapon
 * towards the body when both hands can't reach it. Hit zones are invisible boxes parented to the bones.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { HIP_Y, ARM_A, ARM_B } from './parts.js';

const cloneSkinned = SkeletonUtils.clone || (SkeletonUtils.SkeletonUtils && SkeletonUtils.SkeletonUtils.clone);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q4 = () => new THREE.Quaternion();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const AXIS_Y = V3(0, 1, 0);
/** Arm bones point along these in the model's T-pose, in the game's axes (the model is turned 180° to face -Z) */
const BIND_AXIS = { L: V3(-1, 0, 0), R: V3(1, 0, 0) };
/** Fallback: which way the model's palm faces in the T-pose (towards the fingers' curl), in the game's axes */
const DEFAULT_PALM = V3(0, -0.908, -0.418);

// ---------- loading ----------
/** Loads the GLB once. Resolves to a template used by createRifleman(), or throws. */
export async function loadRifleman(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;

  // the carried rifle: the SECOND node called attach-righthand (the first is the empty attach point)
  const rifles = [];
  scene.traverse((o) => { if (o.name && o.name.startsWith('attach-righthand-mesh')) rifles.push(o); });
  for (const o of rifles) {
    const p = o.parent;
    if (!p) continue;
    p.remove(o);
    if (p.name.startsWith('attach-righthand') && p.children.length === 0 && p.parent) p.parent.remove(p);
  }

  scene.updateMatrixWorld(true);
  const need = (n) => {
    const o = scene.getObjectByName(n);
    if (!o) throw new Error('rifleman model is missing "' + n + '"');
    return o;
  };
  const wp = (o) => o.getWorldPosition(new THREE.Vector3());
  const spine = wp(need('Spine'));
  const lArm = wp(need('LeftArm')), rArm = wp(need('RightArm'));
  const lHand = wp(need('LeftHand'));
  const eye = scene.getObjectByName('Face_EyeL');
  // model space -> game axes, relative to the chest pivot (Spine): x and z flip because the model is turned 180°
  const chest = (p) => V3(-p.x, p.y - spine.y, -p.z);

  let palm = DEFAULT_PALM.clone();
  const att = scene.getObjectByName('attach-lefthand');
  if (att) {
    const o = wp(att).sub(lHand);          // wrist -> grip centre (model space)
    const perp = V3(0, o.y, o.z);          // drop the part along the arm (x)
    if (perp.length() > 0.02) palm = V3(0, perp.y, -perp.z).normalize();
  }

  const tpl = {
    scene,
    shoulder: { L: chest(lArm), R: chest(rArm) },
    A: need('LeftForeArm').position.length(),
    B: need('LeftHand').position.length(),
    eyeY: (eye ? wp(eye).y : 1.6) - spine.y,
    palm,
  };
  // load details only in verbose/dev sessions (see rrlog + settings.devShowLoadLogs)
  return tpl;
}

// ---------- hit boxes (invisible, parented to bones, picked up by player.js through userData.hitZone) ----------
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const HIT_MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
function addHit(bone, zone, cx, cy, cz, sx, sy, sz) {
  const m = new THREE.Mesh(UNIT, HIT_MAT);
  m.position.set(cx, cy, cz);
  m.scale.set(sx, sy, sz);
  m.visible = false;
  m.castShadow = false;
  m.userData.hitZone = zone;
  bone.add(m);
}

// ---------- the driver rig (no meshes: anim.js poses it, `sync` copies it to the bones) ----------
function driverArm() {
  const shoulder = new THREE.Group();
  const elbow = new THREE.Group();
  elbow.position.y = -ARM_A;
  shoulder.add(elbow);
  const hand = new THREE.Group();
  hand.position.y = -ARM_B;
  elbow.add(hand);
  return { shoulder, elbow, hand, curl() {} };
}

// ---------- pose sync ----------
const _u = V3(), _f = V3(), _w = V3(), _pole = V3(), _dir = V3(), _pp = V3(), _e = V3(), _wr = V3(), _p = V3();
const _e1 = V3(), _e2 = V3(), _e3 = V3(), _tmp = V3(), _v = V3();
const _qse = Q4(), _qh = Q4(), _qroll = Q4(), _qb = Q4(), _qd = Q4(), _qUp = Q4(), _qFore = Q4(), _qHand = Q4(), _qt = Q4();
const _m = new THREE.Matrix4();

/** the model is turned 180° about Y, so a rotation expressed in game axes becomes (-x, y, -z, w) in bone space */
function setConj(bone, q) { bone.quaternion.set(-q.x, q.y, -q.z, q.w); }

/** rotation whose columns are (axis, side orthogonalised against it, axis x side) */
function frameQuat(out, axis, side) {
  _e1.copy(axis).normalize();
  _e2.copy(side).addScaledVector(_e1, -side.dot(_e1));
  if (_e2.lengthSq() < 1e-8) { _e2.set(0, 0, 1).addScaledVector(_e1, -_e1.z); if (_e2.lengthSq() < 1e-8) _e2.set(1, 0, 0); }
  _e2.normalize();
  _e3.crossVectors(_e1, _e2);
  _m.makeBasis(_e1, _e2, _e3);
  return out.setFromRotationMatrix(_m);
}

/**
 * refs: { hips, chest, head, legL{thigh,shin}, legR, armL{shoulder,elbow,hand}, armR, hold }  (driver)
 *       bones: model bones by name
 *       info: { shoulder:{L,R}, A, B, palm, hipsBind }
 */
export function makeSync(refs, bones, info) {
  const { hips, chest, head, legL, legR, hold } = refs;
  const A = info.A, B = info.B, REACH = (A + B) * 0.97;
  const side = {
    L: { arm: refs.armL, S: info.shoulder.L, ax: BIND_AXIS.L, w: V3(), d: V3(), bUp: bones.lArm, bFore: bones.lFore, bHand: bones.lHand },
    R: { arm: refs.armR, S: info.shoulder.R, ax: BIND_AXIS.R, w: V3(), d: V3(), bUp: bones.rArm, bFore: bones.rFore, bHand: bones.rHand },
  };
  const shift = V3();
  const hipsBind = info.hipsBind;
  const palmBind = info.palm.clone();

  /** driver arm -> wrist target, elbow pole and palm direction (chest space) */
  function read(s) {
    const a = s.arm;
    _u.set(0, -ARM_A, 0).applyQuaternion(a.shoulder.quaternion);                       // shoulder -> elbow
    _qse.copy(a.shoulder.quaternion).multiply(a.elbow.quaternion);
    _f.set(0, -ARM_B, 0).applyQuaternion(_qse);                                        // elbow -> wrist
    s.w.copy(a.shoulder.position).add(_u).add(_f);
    _dir.copy(_u).add(_f).normalize();
    s.pole = (s.pole || V3()).copy(_u).addScaledVector(_dir, -_u.dot(_dir));            // elbow side
    _qroll.setFromAxisAngle(AXIS_Y, a.hand.rotation.y);
    _qh.copy(_qse).multiply(_qroll);
    s.palm = (s.palm || V3()).set(0, 0, 1).applyQuaternion(_qh);                      // palm side (driver hand: +Z)
  }

  function solve(s) {
    // wrist the model must reach: driver wrist + the weapon shift
    _w.copy(s.w).add(shift);
    _v.subVectors(_w, s.S);
    let dist = _v.length();
    if (dist < 1e-5) { _v.set(0, 0, -1); dist = 1e-5; } else _v.divideScalar(dist);
    dist = clamp(dist, Math.abs(A - B) * 1.05 + 0.01, (A + B) * 0.999);
    const x = (A * A - B * B + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, A * A - x * x));
    _pp.copy(s.pole).addScaledVector(_v, -s.pole.dot(_v));
    if (_pp.lengthSq() < 1e-6) { _pp.set(s.ax.x * -1, -1, 0).addScaledVector(_v, 0); _pp.addScaledVector(_v, -_pp.dot(_v)); }
    _pp.normalize();
    _e.copy(s.S).addScaledVector(_v, x).addScaledVector(_pp, h);                       // elbow
    _wr.copy(s.S).addScaledVector(_v, dist);                                           // wrist
    const up = _tmp.subVectors(_e, s.S).normalize();
    _qUp.setFromUnitVectors(s.ax, up);
    const fore = _dir.subVectors(_wr, _e).normalize();
    _qFore.setFromUnitVectors(s.ax, fore);
    // hand: its forearm axis + palm side go to (forearm direction, driver palm side)
    frameQuat(_qb, s.ax, palmBind);
    frameQuat(_qd, fore, s.palm);
    _qHand.copy(_qd).multiply(_qb.conjugate());

    setConj(s.bUp, _qUp);
    _qt.copy(_qUp).conjugate().multiply(_qFore);
    setConj(s.bFore, _qt);
    _qt.copy(_qFore).conjugate().multiply(_qHand);
    setConj(s.bHand, _qt);
  }

  return function sync() {
    // hips (position delta + rotation), spine, head, legs: the driver's local rotations map 1:1
    setConj(bones.hips, hips.quaternion);
    bones.hips.position.set(hipsBind.x - hips.position.x, hipsBind.y + (hips.position.y - HIP_Y), hipsBind.z - hips.position.z);
    setConj(bones.spine, chest.quaternion);
    setConj(bones.head, head.quaternion);
    setConj(bones.lUp, legL.thigh.quaternion);
    setConj(bones.lLeg, legL.shin.quaternion);
    setConj(bones.rUp, legR.thigh.quaternion);
    setConj(bones.rLeg, legR.shin.quaternion);

    // arms: the model's arms are shorter than the driver's, so move the weapon (and both hands) towards the body
    read(side.L);
    read(side.R);
    shift.set(0, 0, 0);
    for (let it = 0; it < 4; it++) {
      for (const k of ['L', 'R']) {
        const s = side[k];
        _v.copy(s.w).add(shift).sub(s.S);
        const len = _v.length();
        if (len > REACH) shift.addScaledVector(_v, -(len - REACH) / len);
      }
    }
    if (shift.length() > 0.3) shift.setLength(0.3);
    hold.position.copy(shift);
    solve(side.L);
    solve(side.R);
  };
}

class SkinRig extends THREE.Group {
  constructor() { super(); this.sync = null; this.failed = false; }
  updateMatrixWorld(force) {
    if (this.sync && !this.failed && this.parent && this.parent.visible) {
      try { this.sync(); } catch (err) { this.failed = true; console.error('[rifleman] pose sync failed', err); }
    }
    super.updateMatrixWorld(force);
  }
}

/**
 * One soldier. Returns { model, hips, legL, legR, chest, head, armL, armR, hold, skin } where `model` and `hips`
 * must be added to the character root, `model` FIRST (it reads the driver's pose before the driver's matrices update).
 */
export function createRifleman(tpl, tint) {
  const model = cloneSkinned(tpl.scene);
  const skinned = [];
  model.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  if (!skinned.length) throw new Error('rifleman model has no skinned meshes');

  // one material per soldier (team tint) and ONE skeleton shared by all its parts (one bone update per frame)
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  mat.color.setHex(tint);
  const skeleton = skinned[0].skeleton;
  for (const m of skinned) {
    if (m.skeleton !== skeleton) m.bind(skeleton, m.bindMatrix);
    m.material = mat;
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
  }

  const bone = (n) => {
    const b = model.getObjectByName(n);
    if (!b) throw new Error('rifleman bone "' + n + '" missing');
    return b;
  };
  const bones = {
    hips: bone('Hips'), spine: bone('Spine'), head: bone('Head'),
    lArm: bone('LeftArm'), lFore: bone('LeftForeArm'), lHand: bone('LeftHand'),
    rArm: bone('RightArm'), rFore: bone('RightForeArm'), rHand: bone('RightHand'),
    lUp: bone('LeftUpLeg'), lLeg: bone('LeftLeg'), lFoot: bone('LeftFoot'),
    rUp: bone('RightUpLeg'), rLeg: bone('RightLeg'), rFoot: bone('RightFoot'),
  };

  // hit zones
  addHit(bones.head, 'head', 0, 0.12, 0, 0.21, 0.3, 0.24);
  addHit(bones.spine, 'body', 0, 0.18, 0, 0.38, 0.42, 0.26);
  addHit(bones.hips, 'body', 0, -0.03, 0, 0.36, 0.26, 0.25);
  for (const [S, up, leg, foot, arm, fore, hand, sx] of [
    ['Left', bones.lUp, bones.lLeg, bones.lFoot, bones.lArm, bones.lFore, bones.lHand, 1],
    ['Right', bones.rUp, bones.rLeg, bones.rFoot, bones.rArm, bones.rFore, bones.rHand, -1],
  ]) {
    addHit(up, 'limb', 0, -0.215, 0, 0.17, 0.44, 0.17);
    addHit(leg, 'limb', 0, -0.19, 0, 0.13, 0.4, 0.13);
    addHit(foot, 'limb', 0, -0.04, 0.05, 0.11, 0.1, 0.26);
    addHit(arm, 'limb', sx * 0.1275, 0, 0, 0.27, 0.12, 0.12);
    addHit(fore, 'limb', sx * 0.1125, 0, 0, 0.235, 0.11, 0.11);
    addHit(hand, 'limb', sx * 0.07, -0.02, 0.01, 0.14, 0.12, 0.12);
    void S;
  }

  // the driver rig (same layout as the old procedural soldier, no meshes)
  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  const mkLeg = (x) => {
    const thigh = new THREE.Group();
    thigh.position.set(x, -0.04, 0);
    hips.add(thigh);
    const shin = new THREE.Group();
    shin.position.y = -0.44;
    thigh.add(shin);
    return { thigh, shin };
  };
  const legL = mkLeg(-0.095), legR = mkLeg(0.095);
  const chest = new THREE.Group();
  chest.position.y = 0.1;
  hips.add(chest);
  const head = new THREE.Group();
  head.position.y = 0.58;
  chest.add(head);
  const armR = driverArm(), armL = driverArm();
  // the driver's shoulders sit exactly where the model's do, so the IK targets stay reachable
  armR.shoulder.position.copy(tpl.shoulder.R);
  armL.shoulder.position.copy(tpl.shoulder.L);
  chest.add(armR.shoulder, armL.shoulder);
  const hold = new THREE.Group();
  chest.add(hold);

  const rig = new SkinRig();
  rig.rotation.y = Math.PI;
  rig.add(model);
  rig.sync = makeSync(
    { hips, chest, head, legL, legR, armL, armR, hold },
    bones,
    { shoulder: tpl.shoulder, A: tpl.A, B: tpl.B, palm: tpl.palm, hipsBind: bones.hips.position.clone() },
  );

  return {
    model: rig, hips, legL, legR, chest, head, armL, armR, hold,
    skin: { mat, baseTint: tint, model, hat: model.getObjectByName('attach-hat-mesh') || null, beard: model.getObjectByName('attach-face-mesh') || null },
  };
}
