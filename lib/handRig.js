/**
 * First-person hands: the Polyfork "Base Hand" (left hand, skinned, 25 WebXR joints, lying flat: fingers +Z, palm -Y, thumb -X).
 * Turned into the same convention the old glove used (origin = wrist, fingers along -Y, palm faces +Z) and given
 * the same `userData.curl(c)` API, so anim.js drives it unchanged. The right hand is the left one mirrored.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const cloneSkinned = SkeletonUtils.clone || (SkeletonUtils.SkeletonUtils && SkeletonUtils.SkeletonUtils.clone);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** 1 = real size (the model is about 19 cm long) */
export const HAND_SCALE = 1;

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const FINGER_JOINTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB_JOINTS = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
/** bend per joint at curl = 1 (radians). Fingers bend about the model's x axis (towards the palm, -Y) */
const FINGER_BEND = [0, 1.3, 1.5, 0.9, 0];
const FINGER_AXIS = V3(1, 0, 0);
/** the thumb closes across the palm */
const THUMB_BEND = [0.18, 0.4, 0.5, 0];
const THUMB_AXIS = V3(0.6, 0.6, 0.46).normalize();

/** loads the GLB once and turns the flat joint list into finger chains (bind pose unchanged) */
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
      c.position.copy(P.get(c)).sub(P.get(par)).applyQuaternion(inv); // bind position in the parent's frame
      c.quaternion.copy(inv).multiply(Q.get(c));                    // bind rotation in the parent's frame
      if (i > 0) par.add(c);
      qa.push(inv);
      qb.push(Q.get(c).clone());
    }
    chains.push({ names, bend, axis, qa, qb });
  };
  for (const f of FINGERS) build(FINGER_JOINTS.map((j) => f + '-' + j), FINGER_BEND, FINGER_AXIS);
  build(THUMB_JOINTS, THUMB_BEND, THUMB_AXIS);

  console.info('[hand] loaded', { wristY: +P.get(wrist).y.toFixed(4), chains: chains.length });
  return { scene, chains, wrist: P.get(wrist).clone() };
}

// model space (fingers +Z, palm -Y, thumb -X)  ->  game hand space (fingers -Y, palm +Z, thumb +X for the left hand)
const MAP = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3(-1, 0, 0), V3(0, 0, -1), V3(0, -1, 0)));
const _r = new THREE.Quaternion();

/**
 * One hand. mat = the viewmodel's glove material (made vertex-coloured here). side: 'L' | 'R'.
 * Returns a Group with userData.curl(c), c = 0 open ... ~1.05 fist.
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
  function curl(c) {
    for (const ch of chains) {
      for (let i = 0; i < ch.bones.length; i++) {
        _r.setFromAxisAngle(ch.axis, ch.bend[i] * c);
        ch.bones[i].quaternion.copy(ch.qa[i]).multiply(_r).multiply(ch.qb[i]);
      }
    }
  }

  // the wrist sits at the origin; the right hand is the model mirrored in X
  const s = HAND_SCALE;
  model.scale.set(side === 'R' ? -s : s, s, s);
  model.position.set(0, -tpl.wrist.y * s, 0);
  const pivot = new THREE.Group();
  pivot.quaternion.copy(MAP);
  pivot.add(model);
  const h = new THREE.Group();
  h.add(pivot);
  h.userData.curl = curl;
  curl(0.5);
  return h;
}
