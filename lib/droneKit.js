/**
 * Scout drone kit.
 *  - DEPLOY / STOW: the hand sequences. Keyframes are in rig space (viewmodel space in first person, chest space in third).
 *    key = { t, R: hand/prop position, rot: its rotation, L: left hand: null | 'drone' | 'grip' | 'hover' | 'tap' | [x,y,z] }
 *  - buildDroneKit(): the folded drone you pull off your pack and the handheld control tablet.
 * anim.js plays it (poseDrone); drone.js reads the same timings so the world drone stays in sync with the hands.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PI = Math.PI, HP = PI / 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const eob = (u) => { const x = clamp01(u) - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; }; // ease-out-back
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- sequences ----------
const key = (t, R, rot, L = null) => ({ t, R, rot, L });
const HOLD_R = [0.04, -0.35, -0.36], HOLD_ROT = [-0.2, 0, 0];
const hold = (t, L) => key(t, HOLD_R, HOLD_ROT, L);
/** same pose as the idle melee rest, so the sequence starts / ends without a snap */
export const REST = key(0, [0.22, -0.26, -0.40], [0.15, 0, 0.08]);

export const DEPLOY = {
  dur: 6.1,
  events: [[0.98, 'grab'], [2.52, 'place'], [3.45, 'tablet'], [4.72, 'tap']],
  drone: { show: [0.98, 2.52], unfold: [1.55, 2.15] },
  tablet: { show: 3.45, ant: [4.0, 4.4], boot: [4.05, 4.6], taps: [4.72, 4.96], live: 5.05 },
  crouch: [1.55, 3.05], // the body crouches (drone.js asks the player for it)
  bend: [1.6, 2.15, 2.65, 3.1], // third person: lean forward while placing (ramp up start/end, ramp down start/end)
  keys: [
    REST,
    // reach over the shoulder to the pack
    key(0.32, [0.30, -0.04, -0.24], [0.45, 0.70, 0.30]),
    key(0.66, [0.22, 0.10, -0.02], [0.80, 1.15, 0.50]),
    key(0.98, [0.14, 0.10, 0.06], [0.75, 1.10, 0.40]), // grab
    // pull it out, bring it in front, steady it with the left hand
    key(1.30, [0.16, 0.00, -0.20], [0.50, 0.75, 0.22]),
    key(1.62, [0.16, -0.14, -0.38], [0.25, 0.30, 0.05], 'drone'),
    // lower + unfold, crouch, set it down
    key(1.95, [0.13, -0.32, -0.40], [0.80, 0.10, 0.00], 'drone'),
    key(2.25, [0.12, -0.50, -0.40], [1.10, 0.05, 0.00], 'drone'),
    key(2.52, [0.12, -0.62, -0.34], [1.45, 0.00, 0.00], 'drone'), // place
    // let go, stand, go for the tablet
    key(2.80, [0.14, -0.52, -0.34], [1.05, 0.10, 0.00]),
    key(3.12, [0.10, -0.56, -0.30], [0.55, -0.30, 0.15]),
    key(3.45, [-0.02, -0.62, -0.30], [0.30, -0.30, 0.20]), // tablet comes out
    key(3.85, [0.03, -0.46, -0.34], [0.05, 0.00, 0.00], 'grip'),
    // hold at chest height, tap CONNECT twice, hold
    hold(4.25, 'grip'), hold(4.50, 'grip'),
    hold(4.62, 'hover'), hold(4.72, 'tap'), hold(4.84, 'hover'), hold(4.96, 'tap'), hold(5.10, 'hover'),
    hold(5.40, 'grip'), hold(6.10, 'grip'),
  ],
};

export const STOW = {
  dur: 1.15, hide: 0.82, shrink: [0.5, 0.82], ant: [0.08, 0.45], off: 0.14,
  keys: [
    hold(0.00, 'grip'),
    key(0.18, [0.04, -0.40, -0.36], [-0.10, 0, 0], 'grip'),
    key(0.55, [0.02, -0.58, -0.30], [0.30, -0.30, 0.20], 'grip'),
    key(0.82, [0.00, -0.60, -0.30], [0.30, -0.30, 0.20]),
    key(1.15, REST.R, REST.rot),
  ],
};

// ---------- tablet screen (canvas texture) ----------
function makeScreen() {
  const W = 512, Ht = 304;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Ht;
  const c = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const G = '#3dff9a', GD = '#1f9d62', BG = '#03120c';
  const font = (n, w = 700) => `${w} ${n}px ui-monospace, Menlo, Consolas, monospace`;
  const rr = (x, y, w, h, r) => {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };
  const scan = (a = 0.22) => { c.fillStyle = `rgba(0,0,0,${a})`; for (let y = 0; y < Ht; y += 4) c.fillRect(0, y, W, 1); };
  const base = (label) => {
    c.fillStyle = BG; c.fillRect(0, 0, W, Ht);
    c.strokeStyle = 'rgba(61,255,154,.07)'; c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= W; x += 32) { c.moveTo(x, 0); c.lineTo(x, Ht); }
    for (let y = 0; y <= Ht; y += 32) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    c.fillStyle = 'rgba(61,255,154,.14)'; c.fillRect(0, 0, W, 34);
    c.fillStyle = G; c.font = font(17); c.textBaseline = 'middle';
    c.textAlign = 'left'; c.fillText('SCOUT-7', 14, 18);
    c.textAlign = 'right'; c.fillText(label, W - 14, 18);
  };
  const draw = {
    off() { c.fillStyle = '#000'; c.fillRect(0, 0, W, Ht); },
    boot(p) {
      base('BOOT');
      c.textAlign = 'center'; c.fillStyle = G; c.font = font(48, 800); c.fillText('SCOUT·7', W / 2, 108);
      c.fillStyle = GD; c.font = font(14, 600); c.fillText('SURVEY DRONE CONTROLLER', W / 2, 146);
      c.strokeStyle = G; c.lineWidth = 2; rr(96, 176, W - 192, 18, 4); c.stroke();
      if (p > 0.02) { c.fillStyle = G; rr(100, 180, (W - 200) * p, 10, 2); c.fill(); }
      const items = ['GIMBAL', 'MOTORS', 'RADIO', 'CAMERA'];
      c.font = font(14, 700); c.textAlign = 'center';
      items.forEach((s, i) => { const ok = p > (i + 0.6) / items.length; c.fillStyle = ok ? G : GD; c.fillText((ok ? '✓ ' : '· ') + s, 76 + i * 120, 236); });
      scan();
    },
    link(time, press) {
      base('NO LINK');
      const cx = W / 2, cy = 112;
      for (let i = 0; i < 3; i++) {
        const k = (time * 0.8 + i / 3) % 1;
        c.strokeStyle = `rgba(61,255,154,${(1 - k) * 0.8})`; c.lineWidth = 3;
        c.beginPath(); c.arc(cx, cy, 10 + k * 56, 0, PI * 2); c.stroke();
      }
      c.fillStyle = G; c.beginPath(); c.arc(cx, cy, 7, 0, PI * 2); c.fill();
      c.textAlign = 'center'; c.font = font(16); c.fillStyle = GD; c.fillText('DRONE READY · TAP TO CONNECT', cx, 190);
      c.fillStyle = press ? G : 'rgba(61,255,154,.16)'; rr(161, 211, 190, 50, 10); c.fill();
      c.strokeStyle = G; c.lineWidth = 3; rr(161, 211, 190, 50, 10); c.stroke();
      c.fillStyle = press ? BG : G; c.font = font(24, 800); c.fillText('CONNECT', cx, 237);
      scan();
    },
    live(time, p) {
      const gr = c.createLinearGradient(0, 0, 0, Ht);
      gr.addColorStop(0, '#0f3d2e'); gr.addColorStop(0.5, '#0a2b20'); gr.addColorStop(0.5, '#06190f'); gr.addColorStop(1, '#020a06');
      c.fillStyle = gr; c.fillRect(0, 0, W, Ht);
      c.textBaseline = 'middle';
      // horizon + pitch ladder
      c.save(); c.translate(W / 2, Ht / 2 + 6); c.rotate(Math.sin(time * 0.6) * 0.035);
      const hy = Math.sin(time * 0.9) * 5;
      c.strokeStyle = 'rgba(61,255,154,.55)'; c.lineWidth = 2; c.beginPath(); c.moveTo(-W, hy); c.lineTo(W, hy); c.stroke();
      c.strokeStyle = 'rgba(61,255,154,.25)'; c.lineWidth = 1; c.beginPath();
      for (let i = 1; i <= 3; i++) { c.moveTo(-60, hy - i * 32); c.lineTo(60, hy - i * 32); c.moveTo(-40, hy + i * 32); c.lineTo(40, hy + i * 32); }
      c.stroke(); c.restore();
      // crosshair + corner brackets
      c.strokeStyle = G; c.lineWidth = 2; c.beginPath();
      c.moveTo(W / 2 - 16, Ht / 2); c.lineTo(W / 2 - 5, Ht / 2); c.moveTo(W / 2 + 5, Ht / 2); c.lineTo(W / 2 + 16, Ht / 2);
      c.moveTo(W / 2, Ht / 2 - 16); c.lineTo(W / 2, Ht / 2 - 5); c.moveTo(W / 2, Ht / 2 + 5); c.lineTo(W / 2, Ht / 2 + 16);
      for (const [x, y, sx, sy] of [[26, 48, 1, 1], [W - 26, 48, -1, 1], [26, Ht - 44, 1, -1], [W - 26, Ht - 44, -1, -1]]) {
        c.moveTo(x, y + sy * 22); c.lineTo(x, y); c.lineTo(x + sx * 22, y);
      }
      c.stroke();
      // top / bottom bars
      c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(0, 0, W, 32); c.fillRect(0, Ht - 30, W, 30);
      if (Math.floor(time * 1.6) % 2 === 0) { c.fillStyle = '#ff4a3a'; c.beginPath(); c.arc(22, 16, 6, 0, PI * 2); c.fill(); }
      c.fillStyle = G; c.font = font(15); c.textAlign = 'left'; c.fillText('REC', 36, 17); c.fillText('LIVE · 1080p', 88, 17);
      for (let i = 0; i < 4; i++) c.fillRect(W - 150 + i * 8, 24 - (i + 1) * 4, 5, (i + 1) * 4);
      c.strokeStyle = G; c.lineWidth = 2; c.strokeRect(W - 108, 9, 30, 15); c.fillRect(W - 78, 13, 3, 7); c.fillRect(W - 106, 11, 26, 11);
      c.textAlign = 'right'; c.fillText('100%', W - 14, 17);
      c.textAlign = 'left'; c.fillText(`ALT ${(1.5 + Math.sin(time * 0.8) * 0.1).toFixed(1)}m`, 16, Ht - 15);
      c.textAlign = 'center'; c.fillText(`HDG ${Math.round(180 + Math.sin(time * 0.3) * 6)}°`, W / 2, Ht - 15);
      c.textAlign = 'right'; c.fillText('SPD 0.0', W - 16, Ht - 15);
      if (p < 0.9) {
        c.globalAlpha = 1 - p / 0.9;
        c.fillStyle = 'rgba(3,18,12,.85)'; rr(W / 2 - 150, 120, 300, 44, 8); c.fill();
        c.fillStyle = G; c.font = font(20, 800); c.textAlign = 'center'; c.fillText('LINK ESTABLISHED', W / 2, 143);
        c.globalAlpha = 1;
      }
      scan(0.18);
      c.fillStyle = 'rgba(61,255,154,.05)'; c.fillRect(0, (time * 70) % Ht, W, 5);
    },
  };
  let last = '';
  /** redraws only when something visible changed (screen animates at ~12 Hz) */
  function update(state, p, time, press) {
    const k = state === 'boot' ? 'boot' + Math.round(p * 36)
      : state === 'off' ? 'off'
        : state + Math.floor(time * 12) + (press ? 'p' : '') + (state === 'live' ? (p < 0.9 ? Math.round(p * 20) : 'x') : '');
    if (k === last) return;
    last = k;
    if (state === 'boot') draw.boot(p);
    else if (state === 'link') draw.link(time, press);
    else if (state === 'live') draw.live(time, p);
    else draw.off();
    tex.needsUpdate = true;
  }
  return { tex, update };
}

// ---------- models ----------
export function buildDroneKit() {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    shell: S({ color: 0xd9dde0, roughness: 0.45, metalness: 0.1 }),
    dark: S({ color: 0x1c2127, roughness: 0.5, metalness: 0.45 }),
    plate: S({ color: 0x2b323b, roughness: 0.5, metalness: 0.5 }),
    rubber: S({ color: 0x14171a, roughness: 0.92 }),
    steel: S({ color: 0x9aa1a8, roughness: 0.3, metalness: 1 }),
    glass: S({ color: 0x0a141c, roughness: 0.05, metalness: 0.9 }),
    accent: S({ color: 0xff9d1c, roughness: 0.5 }),
    blade: S({ color: 0x262b31, roughness: 0.6 }),
    ledR: S({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 1.6 }),
    ledG: S({ color: 0x002200, emissive: 0x2aff6a, emissiveIntensity: 1.6 }),
    ledW: S({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 1.6 }),
  };
  const RB = (w, h, d, r = 0.006) => new RoundedBoxGeometry(w, h, d, 3, r);
  const CY = (rt, rb, h, s = 14) => new THREE.CylinderGeometry(rt, rb, h, s);
  const SP = (r) => new THREE.SphereGeometry(r, 14, 10);
  const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const mk = (geo, mat, x, y, z, parent, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true;
    parent.add(m);
    return m;
  };

  const g = new THREE.Group();

  // ----- folded drone (origin = body centre, forward = -Z) -----
  const prop = new THREE.Group();
  g.add(prop);
  mk(RB(0.11, 0.038, 0.16, 0.014), M.shell, 0, 0.02, 0, prop);
  mk(RB(0.07, 0.024, 0.09, 0.011), M.shell, 0, 0.045, 0.012, prop);
  mk(BX(0.012, 0.002, 0.1), M.accent, 0, 0.0575, 0.012, prop);
  mk(RB(0.08, 0.02, 0.1, 0.006), M.dark, 0, -0.004, 0.02, prop);
  mk(SP(0.02), M.dark, 0, 0.014, -0.085, prop);
  mk(SP(0.011), M.glass, 0, 0.014, -0.103, prop).scale.z = 0.6;
  mk(BX(0.01, 0.006, 0.006), M.ledR, -0.032, 0.03, -0.074, prop);
  mk(BX(0.01, 0.006, 0.006), M.ledG, 0.032, 0.03, -0.074, prop);
  mk(BX(0.014, 0.006, 0.004), M.ledW, 0, 0.036, 0.083, prop);
  // carry handle (the fist closes around the bar, along Z)
  mk(RB(0.008, 0.046, 0.012, 0.003), M.dark, 0, 0.078, -0.04, prop);
  mk(RB(0.008, 0.046, 0.012, 0.003), M.dark, 0, 0.078, 0.04, prop);
  mk(CY(0.0075, 0.0075, 0.1, 10), M.rubber, 0, 0.101, 0, prop, HP);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mk(CY(0.007, 0.009, 0.016, 8), M.rubber, sx * 0.04, -0.012, sz * 0.055, prop);
  // four arms: folded back along the body, swing out to X (rotation.y per arm)
  const arms = [];
  for (const [sx, sz, open] of [[1, -1, PI / 4], [-1, -1, -5 * PI / 4], [1, 1, -PI / 4], [-1, 1, -3 * PI / 4]]) {
    const piv = new THREE.Group();
    piv.position.set(sx * 0.05, sz > 0 ? 0.04 : 0.028, sz * 0.055);
    prop.add(piv);
    mk(RB(0.14, 0.014, 0.022, 0.005), M.shell, 0.07, 0, 0, piv);
    mk(CY(0.019, 0.021, 0.026), M.dark, 0.14, 0.008, 0, piv);
    mk(CY(0.006, 0.006, 0.01, 8), M.steel, 0.14, 0.026, 0, piv);
    mk(BX(0.125, 0.003, 0.015), M.blade, 0.14, 0.03, 0, piv, 0, HP);
    arms.push({ piv, fold: -HP, open });
  }

  // ----- control tablet (origin = screen centre, screen faces +Z) -----
  const tab = new THREE.Group();
  g.add(tab);
  const screen = makeScreen();
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: screen.tex, emissiveIntensity: 0, roughness: 0.1, metalness: 0 });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3a2a, emissiveIntensity: 1.2 });
  mk(RB(0.23, 0.15, 0.016, 0.008), M.plate, 0, 0, 0, tab);
  mk(RB(0.218, 0.138, 0.004, 0.002), M.rubber, 0, 0, 0.0085, tab);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.196, 0.116), screenMat);
  scr.position.z = 0.0108;
  tab.add(scr);
  mk(BX(0.03, 0.0025, 0.001), ledMat, 0, 0.0635, 0.0111, tab);
  for (const sx of [-1, 1]) {
    mk(RB(0.046, 0.14, 0.04, 0.016), M.rubber, sx * 0.12, -0.005, -0.012, tab); // side grip
    for (let i = 0; i < 3; i++) mk(BX(0.03, 0.003, 0.002), M.dark, sx * 0.12, -0.04 + i * 0.012, -0.0325, tab);
    mk(CY(0.011, 0.012, 0.006), M.steel, sx * 0.12, 0.034, 0.011, tab, HP); // thumbstick
    mk(CY(0.0085, 0.0085, 0.008), M.rubber, sx * 0.12, 0.034, 0.016, tab, HP);
    mk(SP(0.0075), M.rubber, sx * 0.12, 0.034, 0.0195, tab).scale.z = 0.5;
    mk(CY(0.0055, 0.0055, 0.004, 10), M.accent, sx * 0.12, 0.002, 0.0095, tab, HP); // buttons
    mk(CY(0.0055, 0.0055, 0.004, 10), M.shell, sx * 0.12, -0.014, 0.0095, tab, HP);
    mk(RB(0.05, 0.008, 0.016, 0.003), M.dark, sx * 0.1, 0.078, -0.004, tab); // shoulder trigger
  }
  mk(RB(0.12, 0.1, 0.01, 0.004), M.dark, 0, 0, -0.0125, tab); // back: battery + vents
  for (let i = 0; i < 5; i++) mk(BX(0.09, 0.003, 0.002), M.rubber, 0, -0.028 + i * 0.014, -0.0185, tab);
  mk(BX(0.03, 0.006, 0.002), M.accent, 0.03, 0.04, -0.0185, tab);
  const antenna = (sx) => {
    const piv = new THREE.Group();
    piv.position.set(sx * 0.095, 0.075, -0.004);
    tab.add(piv);
    mk(CY(0.0035, 0.0045, 0.09, 8), M.rubber, 0, 0.045, 0, piv);
    mk(SP(0.0048), M.rubber, 0, 0.09, 0, piv);
    return piv;
  };
  const antR = antenna(1), antL = antenna(-1);
  antR.rotation.z = 1.45; antL.rotation.z = -1.45; // folded along the top edge

  const setDrone = (visible, unfold, scale = 1) => {
    prop.visible = visible;
    if (!visible) return;
    prop.scale.setScalar(1.15 * scale);
    for (const a of arms) a.piv.rotation.y = a.fold + (a.open - a.fold) * eob(unfold);
  };
  const setTablet = (visible, o) => {
    tab.visible = visible;
    if (!visible) return;
    const r = lerp(1.45, -0.22, eob(o.ant));
    antR.rotation.z = r; antL.rotation.z = -r;
    screen.update(o.state, o.p, o.time, o.press);
    screenMat.emissiveIntensity = o.state === 'off' ? 0 : 1.25;
    ledMat.emissive.setHex(o.state === 'off' ? 0xff3a2a : o.state === 'live' ? 0x3dff9a : 0xffb02e);
    ledMat.emissiveIntensity = o.state === 'link' ? (Math.sin(o.time * 8) > 0 ? 1.2 : 0.5) : 1.2;
  };

  prop.visible = false;
  tab.visible = false;
  g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  return {
    group: g, model: 'drone', cls: 'melee', sightY: 0, adsZ: 0.38,
    anchors: { grip: V(0, 0, 0), fore: V(0, 0, -0.1), hold: V(0, 0.101, 0) },
    parts: {}, props: {}, mag: null, magHome: null, magTilt: 0, setAmmo() {}, muzzle: null, eject: null,
    prop, droneParts: [prop], handleY: 0.101, tablet: tab, setDrone, setTablet,
    // tablet-local points for the hands: fist centres on the grips, fingertip target on the CONNECT button
    tab: { gripR: V(0.12, -0.005, -0.012), gripL: V(-0.12, -0.005, -0.012), tap: V(0, -0.032, 0.0115) },
  };
}
