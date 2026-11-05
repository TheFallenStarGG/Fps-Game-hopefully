/**
 * First-person hands: the Polyfork "Base Hand" (left hand, skinned, 25 WebXR joints).
 * Turned into game convention (origin = wrist, fingers along -Y, palm faces +Z) with
 * userData.curl(c) and userData.curlEach({thumb,index,middle,ring,pinky}) so anim.js
 * can wrap individual fingers onto a grip surface.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const cloneSkinned = SkeletonUtils.clone || (SkeletonUtils.SkeletonUtils && SkeletonUtils.SkeletonUtils.clone);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export const HAND_SCALE = 1;

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const FINGER_JOINTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB_JOINTS = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
const FINGER_BEND = [0, 1.3, 1.5, 0.9, 0];
const FINGER_AXIS = V3(1, 0, 0);
const THUMB_BEND = [0.18, 0.4, 0.5, 0];
const THUMB_AXIS = V3(0.6, 0.6, 0.46).normalize();

export async function loadHand(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const need = (n) => {
    const o = scene.getObjectByName(n);
    if (!o) throw new Error('hand model is missing "' + n + '"');
    return o;
  };
  const hand = need('hand'), wrist = need('wrist');
  const P = new Map(), Q = new Map();
  scene.traverse((o) => {
    P.set(o, o.getWorldPosition(new THREE.Vector3()));
    Q.set(o, o.getWorldQuaternion(new THREE.Quaternion()));
  });

  const chains = [];
  const build = (names, bend, axis) => {
    const objs = names.map(need);
    const qa = [], qb = [];
    for (let i = 0; i < objs.length; i++) {
      const par = i === 0 ? hand : objs[i - 1], c = objs[i];
      const inv = Q.get(par).clone().conjugate();
      c.position.copy(P.get(c)).sub(P.get(par)).applyQuaternion(inv);
      c.quaternion.copy(inv).multiply(Q.get(c));
      if (i > 0) par.add(c);
      qa.push(inv);
      qb.push(Q.get(c).clone());
    }
    chains.push({ names, bend, axis, qa, qb });
  };
  for (const f of FINGERS) build(FINGER_JOINTS.map((j) => f + '-' + j), FINGER_BEND, FINGER_AXIS);
  build(THUMB_JOINTS, THUMB_BEND, THUMB_AXIS);

  return { scene, chains, wrist: P.get(wrist).clone() };
}

const MAP = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(V3(-1, 0, 0), V3(0, 0, -1), V3(0, -1, 0))
);
const _r = new THREE.Quaternion();

/**
 * One hand. side: 'L' | 'R'.
 * userData.curl(c) — uniform curl 0..~1.15
 * userData.curlEach({ thumb, index, middle, ring, pinky }) — per-finger 0..1.2
 * userData.tips() — world positions of tips [index, middle, ring, pinky, thumb]
 * userData.chains — bone chains for advanced solvers
 */
export function createHand(tpl, mat, side) {
  const model = cloneSkinned(tpl.scene);
  const skinned = [];
  model.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  if (!skinned.length) throw new Error('hand model has no skinned meshes');

  if (!mat.vertexColors) { mat.vertexColors = true; mat.map = null; mat.needsUpdate = true; }
  const skeleton = skinned[0].skeleton;
  for (const m of skinned) {
    if (m.skeleton !== skeleton) m.bind(skeleton, m.bindMatrix);
    m.material = mat;
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = false;
  }

  const chains = tpl.chains.map((ch) => ({
    bones: ch.names.map((n) => {
      const b = model.getObjectByName(n);
      if (!b) throw new Error('hand bone "' + n + '" missing');
      return b;
    }),
    bend: ch.bend, axis: ch.axis, qa: ch.qa, qb: ch.qb,
  }));
  // order: index, middle, ring, pinky, thumb
  const keys = ['index', 'middle', 'ring', 'pinky', 'thumb'];

  function applyChain(ch, c) {
    const v = Math.max(0, Math.min(1.25, c));
    for (let i = 0; i < ch.bones.length; i++) {
      _r.setFromAxisAngle(ch.axis, ch.bend[i] * v);
      ch.bones[i].quaternion.copy(ch.qa[i]).multiply(_r).multiply(ch.qb[i]);
    }
  }

  function curl(c) {
    for (const ch of chains) applyChain(ch, c);
  }

  function curlEach(amounts) {
    if (typeof amounts === 'number') { curl(amounts); return; }
    for (let i = 0; i < chains.length; i++) {
      const k = keys[i];
      const v = amounts[k] != null ? amounts[k] : (amounts.default != null ? amounts.default : 0.7);
      applyChain(chains[i], v);
    }
  }

  const _tip = new THREE.Vector3();
  function tips(out) {
    const arr = out || [];
    arr.length = 0;
    for (const ch of chains) {
      const tip = ch.bones[ch.bones.length - 1];
      tip.getWorldPosition(_tip);
      arr.push(_tip.clone());
    }
    return arr;
  }

  const s = HAND_SCALE;
  model.scale.set(side === 'R' ? -s : s, s, s);
  model.position.set(0, -tpl.wrist.y * s, 0);
  const pivot = new THREE.Group();
  pivot.quaternion.copy(MAP);
  pivot.add(model);
  const h = new THREE.Group();
  h.add(pivot);
  h.userData.curl = curl;
  h.userData.curlEach = curlEach;
  h.userData.tips = tips;
  h.userData.chains = chains;
  h.userData.side = side;
  curl(0.5);
  return h;
}
