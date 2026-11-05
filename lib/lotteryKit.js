/**
 * Ridgeback Lottery kit.
 *  - LOT_DEPLOY: the "draw the round -> conjure the rune rings -> seal it" hand sequence (same format as droneKit.js)
 *  - lotteryFx(): what the model does at time t of that sequence (round pop, ring unfurl, sigil, sparks, flash)
 *  - buildLotteryKit(): the rune-etched Ridgeback round, three orbiting rune rings, the casting sigil and spark motes
 * anim.js plays it (poseLottery); lottery.js reads the same timings so the gameplay (armed / flash) lines up with the hands.
 */
import * as THREE from 'three';

const PI = Math.PI, HP = PI / 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const eob = (u) => { const x = clamp01(u) - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; }; // ease-out-back
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** shared with lottery.js: 'idle' | 'arming' | 'armed' | 'spent' (decides what the round looks like when nothing is playing) */
export const LOT = { state: 'idle' };

// ---------- sequence ----------
// key = { t, R: hand / round position, rot: its rotation, L: left hand: null (rest) | [x,y,z] relative to the round }
const key = (t, R, rot, L = null) => ({ t, R, rot, L });
/** same pose as the idle melee rest, so the sequence starts / ends without a snap */
export const LOT_REST = key(0, [0.22, -0.26, -0.40], [0.15, 0, 0.08]);

export const LOT_DEPLOY = {
  dur: 2.6,
  armAt: 2.1, // the seal lands (flash + clack); lottery.js arms a beat later
  events: [[0.44, 'pouch'], [0.9, 'crossCock'], [1.38, 'respawn'], [1.95, 'crossLatch'], [2.06, 'boltFwd'], [2.08, 'clang']],
  keys: [
    LOT_REST,
    // dip towards the bandolier, grab the round, pull it free
    key(0.26, [0.10, -0.46, -0.30], [0.45, -0.20, 0.10]),
    key(0.46, [-0.04, -0.60, -0.26], [0.60, -0.40, 0.10]),
    key(0.64, [-0.02, -0.46, -0.30], [0.70, -0.25, 0.05]),
    // present it in front of the face, left hand comes in
    key(0.98, [0.04, -0.14, -0.44], [1.05, 0.05, 0.00], [-0.10, -0.04, 0.07]),
    // conjure: the left hand sweeps a half circle around the round while the rings spin up
    key(1.22, [0.04, -0.11, -0.46], [1.10, 0.18, 0.00], [-0.09, 0.07, 0.06]),
    key(1.50, [0.04, -0.09, -0.47], [1.15, -0.12, 0.00], [0.00, 0.12, 0.07]),
    key(1.80, [0.04, -0.10, -0.46], [1.10, 0.00, 0.00], [-0.03, 0.03, 0.05]),
    // CLACK: the rings snap onto the round
    key(2.06, [0.05, -0.12, -0.39], [0.98, 0.00, 0.00], [-0.03, 0.02, 0.03]),
    key(2.24, [0.05, -0.10, -0.45], [1.08, 0.00, 0.00]),
    // lower the glowing round, back to rest
    key(2.42, [0.14, -0.20, -0.42], [0.55, -0.25, 0.05]),
    key(2.60, LOT_REST.R, LOT_REST.rot),
  ],
};

/** What the model does t seconds into the ritual. Fills and returns o. */
export function lotteryFx(t, o) {
  const unfurl = clamp01((t - 0.9) / 0.5);
  const collapse = sstep((t - 1.72) / 0.34); // rings snap tight onto the round
  const fade = sstep((t - 2.12) / 0.3);
  const post = sstep((t - 2.4) / 0.2); // after the seal a tight halo stays around the loaded round
  const bloom = sstep((t - 0.92) / 0.45), gone = sstep((t - 1.9) / 0.22);
  const halo = LOT.state === 'armed' ? 0.4 * post : 0;
  o.show = t < 0.4 ? 0 : eob((t - 0.4) / 0.3);
  o.rings = Math.max(eob(unfurl) * (1 - fade), halo);
  o.ringR = lerp(1 - 0.78 * collapse, 0.3, post);
  o.spin = (0.5 + 6 * sstep((t - 0.9) / 0.9)) * (1 - 0.6 * fade) + 4 * collapse * (1 - fade);
  o.heat = clamp(0.35 + 0.2 * sstep((t - 0.44) / 0.3) + 0.55 * sstep((t - 0.9) / 0.9) + 0.9 * collapse - 0.55 * sstep((t - 2.12) / 0.4), 0, 2.2);
  o.sigil = bloom * (1 - gone);
  o.sigilS = 0.55 + 0.45 * bloom - 0.35 * gone;
  o.burst = t < 2.06 ? 0 : clamp01((t - 2.06) / 0.5);
  o.sparks = Math.max(sstep((t - 0.85) / 0.5) * (1 - sstep((t - 2.25) / 0.3)), 0.28 * post);
  o.flash = t < 2.03 ? 0.15 * collapse : Math.min(1, Math.exp(-Math.max(0, t - 2.06) * 8));
  return o;
}

/** Same thing when no sequence is playing (round in hand / loaded / spent). */
export function lotteryIdleFx(o, time, state) {
  const armed = state === 'armed', spent = state === 'spent';
  o.show = spent ? 0 : 1;
  o.rings = armed ? 0.4 : 0;
  o.ringR = 0.3;
  o.spin = armed ? 2.4 : 0.5;
  o.heat = spent ? 0 : armed ? 1.25 + 0.15 * Math.sin(time * 3.2) : 0.45 + 0.05 * Math.sin(time * 1.7);
  o.sigil = 0;
  o.sigilS = 0.6;
  o.sparks = spent ? 0 : armed ? 0.3 : 0.12;
  o.burst = 0;
  o.flash = 0;
  return o;
}

// ---------- textures ----------
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  draw(c, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** a made-up rune: a staff with a few branches (no font needed) */
function glyph(c, cx, cy, h, seed) {
  const r = (n) => { const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x); };
  c.beginPath();
  c.moveTo(cx, cy - h / 2); c.lineTo(cx, cy + h / 2);
  const n = 1 + Math.floor(r(1) * 3);
  for (let i = 0; i < n; i++) {
    const y0 = cy - h / 2 + r(2 + i) * h * 0.6, dir = r(7 + i) < 0.5 ? -1 : 1;
    const len = h * (0.22 + r(11 + i) * 0.3), dy = (r(13 + i) - 0.3) * h * 0.5;
    c.moveTo(cx, y0); c.lineTo(cx + dir * len, y0 + dy);
    if (r(17 + i) < 0.4) c.lineTo(cx, y0 + dy * 2);
  }
  c.stroke();
}

// ---------- model ----------
export function buildLotteryKit() {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };

  // runes around the case
  const bandTex = canvasTex(512, 64, (c, W, H) => {
    c.fillStyle = '#120a02'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#ffcf6a'; c.lineWidth = 3; c.lineCap = 'round';
    c.shadowColor = '#ff9a1a'; c.shadowBlur = 6;
    for (let i = 0; i < 14; i++) glyph(c, (i + 0.5) * (W / 14), H / 2, H * 0.62, i * 7 + 3);
    c.lineWidth = 2; c.beginPath();
    c.moveTo(0, 6); c.lineTo(W, 6); c.moveTo(0, H - 6); c.lineTo(W, H - 6);
    c.stroke();
  });
  // a ring of runes (drawn on a square so it maps onto a plane)
  const ringTex = canvasTex(256, 256, (c, W) => {
    c.translate(W / 2, W / 2);
    c.strokeStyle = '#ffd27a'; c.shadowColor = '#ff9a1a'; c.shadowBlur = 5; c.lineCap = 'round';
    c.lineWidth = 3; c.beginPath(); c.arc(0, 0, W * 0.47, 0, PI * 2); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.arc(0, 0, W * 0.385, 0, PI * 2); c.stroke();
    c.lineWidth = 2.5;
    for (let i = 0; i < 18; i++) { c.save(); c.rotate((i / 18) * PI * 2); glyph(c, 0, -W * 0.428, W * 0.06, i * 5 + 1); c.restore(); }
    c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * PI * 2, r0 = W * 0.385, r1 = r0 - (i % 6 === 0 ? W * 0.03 : W * 0.014);
      c.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); c.lineTo(Math.sin(a) * r1, -Math.cos(a) * r1);
    }
    c.stroke();
  });
  // the casting circle
  const sigilTex = canvasTex(512, 512, (c, W) => {
    c.translate(W / 2, W / 2);
    c.strokeStyle = '#ffd27a'; c.fillStyle = '#ffd27a'; c.shadowColor = '#ff9a1a'; c.shadowBlur = 9;
    c.lineCap = 'round'; c.lineJoin = 'round';
    const ring = (r, lw) => { c.lineWidth = lw; c.beginPath(); c.arc(0, 0, W * r, 0, PI * 2); c.stroke(); };
    ring(0.485, 4); ring(0.455, 2); ring(0.39, 3); ring(0.36, 1.5); ring(0.17, 2.5);
    c.lineWidth = 2.5;
    for (let i = 0; i < 28; i++) { c.save(); c.rotate((i / 28) * PI * 2); glyph(c, 0, -W * 0.422, W * 0.05, i * 3 + 2); c.restore(); }
    for (let i = 0; i < 10; i++) { c.save(); c.rotate((i / 10) * PI * 2); glyph(c, 0, -W * 0.13, W * 0.04, i * 11 + 5); c.restore(); }
    for (const off of [-HP, HP]) {
      c.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = off + (i * 2 * PI) / 3, x = Math.cos(a) * W * 0.36, y = Math.sin(a) * W * 0.36;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.closePath(); c.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const a = -HP + (i * PI) / 3;
      c.beginPath(); c.arc(Math.cos(a) * W * 0.36, Math.sin(a) * W * 0.36, W * 0.028, 0, PI * 2); c.stroke();
    }
    c.beginPath(); c.arc(0, 0, W * 0.02, 0, PI * 2); c.fill();
  });
  const glowTex = canvasTex(128, 128, (c) => {
    const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
  });

  // materials
  const brass = S({ color: 0xffc247, metalness: 1, roughness: 0.22, emissive: 0xff8a12, emissiveIntensity: 0.3 });
  const tipM = S({ color: 0xffe8a6, metalness: 1, roughness: 0.14, emissive: 0xffc860, emissiveIntensity: 0.3 });
  const dark = S({ color: 0x1a1208, metalness: 0.7, roughness: 0.4 });
  const band = S({ color: 0x1c1004, metalness: 0.6, roughness: 0.35, emissive: 0xffffff, emissiveMap: bandTex, emissiveIntensity: 0.6 });

  const g = new THREE.Group(); // origin = centre of the fist, forward (round tip) = -Z

  // ----- the round (axis along Z, base at +Z) -----
  const round = new THREE.Group();
  g.add(round);
  const cy = (rt, rb, h, s = 28) => new THREE.CylinderGeometry(rt, rb, h, s);
  const part = (geo, mat, z) => {
    geo.rotateX(HP);
    const m = new THREE.Mesh(geo, mat);
    m.position.z = z;
    m.castShadow = true;
    round.add(m);
    return m;
  };
  part(cy(0.0165, 0.0155, 0.062), brass, 0.008); // case
  part(cy(0.0168, 0.0168, 0.026), band, 0.012); // rune band
  part(cy(0.0155, 0.0112, 0.016), brass, -0.031); // shoulder
  part(cy(0.0112, 0.0112, 0.008), brass, -0.043); // neck
  part(cy(0.0135, 0.0135, 0.005), dark, 0.0415); // extractor groove
  part(cy(0.0182, 0.0182, 0.004), brass, 0.046); // rim
  part(cy(0.006, 0.006, 0.002), tipM, 0.049); // primer
  const prof = [[0.0001, 0.052], [0.0022, 0.0505], [0.005, 0.0455], [0.0078, 0.036], [0.0098, 0.02], [0.0108, 0.006], [0.0108, 0]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const bGeo = new THREE.LatheGeometry(prof, 28);
  bGeo.rotateX(-HP); // tip points down -Z
  const bullet = new THREE.Mesh(bGeo, tipM);
  bullet.position.z = -0.043;
  bullet.castShadow = true;
  round.add(bullet);

  // ----- effects (rings, motes, glow) -----
  const fx = new THREE.Group();
  g.add(fx);

  const ringMat = S({ color: 0xffc247, metalness: 1, roughness: 0.25, emissive: 0xff9a1a, emissiveIntensity: 0.4 });
  const gemGeo = new THREE.OctahedronGeometry(0.0055, 0);
  const gemMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, toneMapped: false });
  const rings = [];
  for (const d of [
    { r: 0.05, base: [0, 0, 0], dir: 1, gems: 3 },
    { r: 0.064, base: [0, HP, 0.35], dir: -1, gems: 4 },
    { r: 0.078, base: [HP, 0, 0.5], dir: 1, gems: 3 },
  ]) {
    const holder = new THREE.Group(), spinner = new THREE.Group();
    holder.add(spinner);
    holder.add(new THREE.Mesh(new THREE.TorusGeometry(d.r, 0.0016, 6, 72), ringMat));
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(d.r * 2.13, d.r * 2.13),
      new THREE.MeshBasicMaterial({ map: ringTex, color: 0xffc860, side: THREE.DoubleSide, opacity: 0, ...add }),
    );
    spinner.add(plane);
    for (let i = 0; i < d.gems; i++) {
      const a = (i / d.gems) * PI * 2, gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.set(Math.cos(a) * d.r, Math.sin(a) * d.r, 0);
      spinner.add(gem);
    }
    holder.visible = false;
    fx.add(holder);
    rings.push({ holder, spinner, plane, base: d.base, dir: d.dir });
  }

  const MN = 30, mPos = new Float32Array(MN * 3), mPh = [], mSp = [], mRr = [], mYy = [];
  for (let i = 0; i < MN; i++) {
    mPh.push(Math.random() * PI * 2); mSp.push(0.7 + Math.random() * 1.1);
    mRr.push(0.035 + Math.random() * 0.05); mYy.push(Math.random() * 2 - 1);
  }
  const mGeo = new THREE.BufferGeometry();
  const mAttr = new THREE.BufferAttribute(mPos, 3);
  mGeo.setAttribute('position', mAttr);
  const mMat = new THREE.PointsMaterial({ map: glowTex, color: 0xffc860, size: 0.014, sizeAttenuation: true, opacity: 0, ...add });
  const motes = new THREE.Points(mGeo, mMat);
  motes.visible = false;
  fx.add(motes);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa830, opacity: 0, ...add }));
  const hot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2d0, opacity: 0, ...add }));
  glow.visible = false; hot.visible = false;
  fx.add(glow, hot);

  // ----- casting sigil (anim.js turns it towards the operator's eyes) -----
  const sigil = new THREE.Group();
  const sigilMat = new THREE.MeshBasicMaterial({ map: sigilTex, color: 0xffc860, side: THREE.DoubleSide, opacity: 0, ...add });
  const sigilMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), sigilMat);
  sigil.add(sigilMesh);
  sigil.visible = false;
  g.add(sigil);

  const acc = { t: 0, spin: 0 };

  /** o = lotteryFx / lotteryIdleFx output + { time, dt, fxScale } */
  function setFx(o) {
    const heat = clamp(o.heat, 0, 2.2), h1 = clamp01(heat / 1.6), sc = o.fxScale || 1;
    acc.t += o.dt || 0;
    acc.spin += (o.dt || 0) * o.spin;

    // the round
    round.visible = o.show > 0.01;
    round.scale.setScalar(Math.max(0.001, o.show));
    brass.emissiveIntensity = 0.12 + 0.5 * heat;
    tipM.emissiveIntensity = 0.12 + 0.5 * heat;
    band.emissiveIntensity = 0.25 + 1.5 * heat;

    // rune rings (a gyroscope around the round)
    fx.scale.setScalar(sc);
    ringMat.emissiveIntensity = 0.25 + 0.9 * heat;
    for (let i = 0; i < rings.length; i++) {
      const R = rings[i], u = clamp01(o.rings * 1.25 - i * 0.12);
      R.holder.visible = u > 0.01;
      if (!R.holder.visible) continue;
      R.holder.scale.setScalar((0.2 + 0.8 * u) * Math.max(0.05, o.ringR));
      R.holder.rotation.set(R.base[0] + Math.sin(acc.t * 0.9 + i * 2.1) * 0.28, R.base[1] + Math.cos(acc.t * 0.7 + i) * 0.24, R.base[2]);
      R.spinner.rotation.z = acc.spin * R.dir * (1 + i * 0.35);
      R.plane.material.opacity = u * (0.3 + 0.5 * h1);
    }

    // sparks orbiting the round, flying outwards on the seal
    motes.visible = o.sparks > 0.01;
    if (motes.visible) {
      for (let i = 0; i < MN; i++) {
        const a = mPh[i] + acc.t * mSp[i] * (1 + 0.15 * o.spin);
        const rad = mRr[i] * (0.6 + 0.4 * clamp01(o.ringR)) * (1 + o.burst * 6) + 0.004;
        mPos[i * 3] = Math.cos(a) * rad;
        mPos[i * 3 + 1] = Math.sin(a * 1.7 + mPh[i]) * rad * 0.55 + mYy[i] * (0.02 + o.burst * 0.05);
        mPos[i * 3 + 2] = Math.sin(a) * rad * 0.9;
      }
      mAttr.needsUpdate = true;
      mMat.opacity = clamp01(o.sparks) * (1 - 0.85 * o.burst);
      mMat.size = 0.011 + 0.006 * h1;
    }

    // casting sigil
    sigil.visible = o.sigil > 0.01;
    if (sigil.visible) {
      sigilMat.opacity = clamp01(o.sigil) * 0.9;
      sigil.scale.setScalar(o.sigilS * sc);
      sigilMesh.rotation.z = acc.t * 0.45;
    }

    // glow + seal flash
    glow.visible = o.show > 0.01 || o.rings > 0.01;
    glow.scale.setScalar((0.1 + 0.12 * heat + 0.14 * o.rings) * sc);
    glow.material.opacity = clamp01(0.18 + 0.3 * heat) * clamp01(Math.max(o.show, o.rings));
    hot.visible = o.flash > 0.01;
    hot.scale.setScalar((0.12 + 0.6 * o.flash) * sc);
    hot.material.opacity = clamp01(o.flash);
  }

  g.traverse((o) => { if (o.isMesh || o.isPoints || o.isSprite) o.frustumCulled = false; });

  return {
    group: g, model: 'lottery', cls: 'melee', sightY: 0, adsZ: 0.38,
    anchors: { grip: V(0, 0, 0.012), fore: V(0, 0, -0.03), hold: V(0, 0, 0.012) },
    parts: {}, props: {}, mag: null, magHome: null, magTilt: 0, setAmmo() {}, muzzle: null, eject: null,
    droneParts: [], sigil, setFx,
  };
}
