/**
 * Hot drop: the intro for Bot Arena and Free For All.
 *   1. you stand inside a transport plane, the rear bay door lowers, the plane flies over the map (it keeps circling)
 *   2. press JUMP any time after the door is open to leave the plane (walk about the cabin first if you like)
 *   3. freefall: W dive / S flare / A D drift, mouse steers; press JUMP again to open the parachute (auto-opens low down)
 *   4. under canopy: W S speed, A D drift, mouse steers; touch down and the normal controller takes over
 * 100% client side. game.js calls begin() / update(dt) / tick(dt) / cancel(); player.js is untouched.
 */
import * as THREE from 'three';
import { floorAt, resolveCircle } from './collision.js';
import { updateHumanoidAnim, updateViewmodel } from './anim.js';
import { settings, EYE_H } from './settings.js';
import { HIP_Y } from './parts.js';

const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (c, t, r, dt) => c + (t - c) * (1 - Math.exp(-r * dt));
const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const rnd = (a, b) => a + Math.random() * (b - a);
const noop = () => {};

/** Tuning (metres, seconds) */
const T = {
  ALT: 820, SPEED: 78, DOOR_START: 1.6, DOOR_TIME: 4.2,
  FALL_FLAT: 54, FALL_DIVE: 86, FALL_FLARE: 44, HS_FLAT: 9, HS_DIVE: 38, HS_FLARE: 3, STRAFE: 9,
  CHUTE_V: 9.5, CHUTE_H: 11, AUTO_OPEN_AGL: 70, MIN_FREEFALL: 0.9,
};
const RAMP_OPEN = 0.17, RAMP_Z = 4.4;

// ---------- small helpers ----------
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(rx, ry);
  return t;
}
function disposeTree(o) {
  o.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    const m = n.material;
    if (m) for (const mm of Array.isArray(m) ? m : [m]) { if (mm.map) mm.map.dispose(); mm.dispose(); }
  });
}
const cardinal = (yaw) => {
  const deg = (((-yaw * 180) / PI) % 360 + 360) % 360;
  return { deg: Math.round(deg), dir: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8] };
};

// ---------- the plane ----------
function buildPlane(accent) {
  const g = new THREE.Group();
  const texs = [];
  const mk = (t) => { texs.push(t); return t; };
  const plate = mk(canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#464b51'; c.fillRect(0, 0, w, h); c.fillStyle = '#626970';
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      const o = (y / 16) % 2 ? 8 : 0;
      c.save(); c.translate(x + o + 4, y + 4); c.rotate(PI / 4); c.fillRect(-4, -1.2, 8, 2.4); c.restore();
      c.save(); c.translate(x + o + 12, y + 12); c.rotate(-PI / 4); c.fillRect(-4, -1.2, 8, 2.4); c.restore();
    }
  }, 3, 9));
  const ramp = mk(canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#464b51'; c.fillRect(0, 0, w, h); c.fillStyle = '#626970'; for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) c.fillRect(x + ((y / 16) % 2 ? 8 : 0), y + 6, 8, 3); }, 3, 3));
  const panel = (base, line) => (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.05})`; c.fillRect(Math.random() * w, Math.random() * h, rnd(2, 14), rnd(1, 4)); }
    c.strokeStyle = line; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2); c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
    c.fillStyle = 'rgba(0,0,0,.35)'; for (let x = 8; x < w; x += 24) { c.beginPath(); c.arc(x, 6, 1.6, 0, 7); c.arc(x, h - 6, 1.6, 0, 7); c.fill(); }
  };
  const hullT = mk(canvasTex(256, 256, panel('#5a6455', 'rgba(0,0,0,.4)'), 4, 3));
  const innerT = mk(canvasTex(256, 256, panel('#737c6c', 'rgba(0,0,0,.3)'), 3, 4));
  const glowTex = mk(canvasTex(64, 64, (c) => { const r = c.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = r; c.fillRect(0, 0, 64, 64); }));
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    plate: S({ map: plate, roughness: 0.65, metalness: 0.35 }), ramp: S({ map: ramp, roughness: 0.65, metalness: 0.35, side: THREE.DoubleSide }),
    hull: S({ map: hullT, roughness: 0.7, metalness: 0.25 }), hullD: S({ map: hullT, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide }),
    inner: S({ map: innerT, roughness: 0.85, metalness: 0.1 }), innerD: S({ map: innerT, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }),
    dark: S({ color: 0x24282c, roughness: 0.8, metalness: 0.4 }), seat: S({ color: 0x39432f, roughness: 0.95 }),
    strap: S({ color: accent, roughness: 0.7 }), yellow: S({ color: 0xe9b520, roughness: 0.6 }), steel: S({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.8 }),
    crate: S({ color: 0x5a4a30, roughness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xaad4ff, transparent: true, opacity: 0.14, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    light: new THREE.MeshBasicMaterial({ color: 0xfff1d6 }), lampR: new THREE.MeshBasicMaterial({ color: 0x400a08 }), lampG: new THREE.MeshBasicMaterial({ color: 0x0a3010 }),
    blur: new THREE.MeshBasicMaterial({ color: 0xcfd3d6, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  };
  const add = (geo, mat, x, y, z, parent = g, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = m.receiveShadow = false;
    parent.add(m);
    return m;
  };
  const box = (w, h, d, mat, x, y, z, parent, rx, ry, rz) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent, rx, ry, rz);

  const Z0 = -4.6, L = 9.0, ZC = Z0 + L / 2; // cabin: z -4.6 .. 4.4, floor y = 0, forward = -Z
  box(2.9, 0.14, L, M.plate, 0, -0.07, ZC);
  for (const s of [-1, 1]) {
    box(0.12, 1.0, L, M.inner, s * 1.4, 0.5, ZC);
    box(0.12, 0.32, L, M.inner, s * 1.4, 1.74, ZC);
    box(0.5, 0.08, L, M.dark, s * 1.15, 0.04, ZC); // floor rail
  }
  const arch = add(new THREE.CylinderGeometry(1.46, 1.46, L, 32, 1, true, PI / 2, PI), M.hullD, 0, 1.9, ZC, g, PI / 2);
  arch.scale.set(1, 1, 0.68);
  const belly = add(new THREE.CylinderGeometry(1.46, 1.46, L, 24, 1, true, -PI / 2, PI), M.hullD, 0, 0, ZC, g, PI / 2);
  belly.scale.set(1, 1, 0.42);
  const ribGeo = new THREE.TorusGeometry(1.4, 0.035, 6, 24, PI);
  for (let i = 0; i < 9; i++) {
    const z = Z0 + 0.1 + i * 1.1;
    const rib = add(ribGeo, M.dark, 0, 1.9, z); rib.scale.y = 0.68;
    for (const s of [-1, 1]) {
      box(0.1, 1.9, 0.14, M.dark, s * 1.31, 0.95, z);
      box(0.14, 0.64, 0.26, M.inner, s * 1.4, 1.3, z);
      if (i < 8) {
        const gl = add(new THREE.PlaneGeometry(0.8, 0.6), M.glass, s * 1.43, 1.3, z + 0.55, g, 0, PI / 2);
        void gl;
        box(0.1, 0.03, 0.9, M.light, s * 0.62, 2.72, z + 0.55);
      }
    }
  }
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.04, 0.04, L, 8), M.steel, s * 0.9, 2.5, ZC, g, PI / 2);
    // fold-down web seats + straps
    box(0.42, 0.05, 6.0, M.seat, s * 1.12, 0.48, -1.4);
    box(0.05, 0.55, 6.0, M.seat, s * 1.3, 0.82, -1.4);
    for (let i = 0; i < 6; i++) box(0.03, 0.62, 0.12, M.strap, s * 1.27, 0.84, -4.2 + i * 1.0);
    for (let i = 0; i < 4; i++) box(0.05, 0.46, 0.05, M.dark, s * 0.95, 0.24, -4.0 + i * 1.7);
  }
  add(new THREE.CylinderGeometry(0.02, 0.02, L, 6), new THREE.MeshStandardMaterial({ color: 0xc0392b }), -0.45, 2.7, ZC, g, PI / 2); // static line
  // front bulkhead, cockpit door, cargo
  box(2.9, 2.9, 0.12, M.inner, 0, 1.45, Z0 - 0.06);
  box(0.9, 1.9, 0.06, M.dark, 0.7, 0.95, Z0 + 0.02);
  box(0.4, 0.4, 0.04, M.glass, 0.7, 1.45, Z0 + 0.06);
  box(0.9, 0.7, 0.9, M.crate, -0.3, 0.35, -3.95); box(0.9, 0.7, 0.9, M.crate, -0.3, 1.05, -3.95, g, 0, 0.15, 0);
  box(0.8, 0.6, 0.8, M.crate, 0.55, 0.3, -3.1); box(0.9, 0.05, 0.12, M.strap, -0.3, 1.42, -3.95);
  box(2.6, 0.012, 0.14, M.yellow, 0, 0.007, 3.5);
  // jump light
  box(0.8, 0.26, 0.1, M.dark, 0, 2.6, 4.1);
  const lampRed = add(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16), M.lampR, -0.2, 2.6, 4.03, g, PI / 2);
  const lampGreen = add(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16), M.lampG, 0.2, 2.6, 4.03, g, PI / 2);
  const glow = (c) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.setScalar(0.7); g.add(s); return s; };
  const glowR = glow(0xff3020), glowG = glow(0x30ff60);
  glowR.position.set(-0.2, 2.6, 3.96); glowG.position.set(0.2, 2.6, 3.96);
  // rear ramp (hinged at the floor edge)
  const rampG = new THREE.Group();
  rampG.position.set(0, 0, RAMP_Z);
  g.add(rampG);
  box(2.6, 0.12, 2.9, M.ramp, 0, -0.06, 1.45, rampG);
  for (const s of [-1, 1]) box(0.1, 0.2, 2.9, M.dark, s * 1.3, 0.03, 1.45, rampG);
  box(2.4, 0.012, 0.2, M.yellow, 0, 0.007, 2.7, rampG);
  rampG.rotation.x = -PI / 2;
  // exterior: nose, tail, wings, engines
  add(new THREE.CylinderGeometry(0.4, 1.46, 3.4, 20), M.hull, 0, 1.2, Z0 - 1.7, g, -PI / 2).scale.set(1, 1, 0.9);
  add(new THREE.SphereGeometry(0.55, 14, 10, 0, PI * 2, 0, PI / 2), M.glass, 0, 1.75, Z0 - 2.9, g, -0.7);
  box(1.0, 1.2, 7.0, M.hull, 0, 3.55, 8.0); box(0.14, 3.2, 2.2, M.hull, 0, 5.3, 10.8, g, -0.15); box(5.0, 0.12, 1.5, M.hull, 0, 4.3, 11.0);
  const props = [];
  for (const s of [-1, 1]) {
    box(8.6, 0.22, 3.0, M.hull, s * 5.7, 0.5, 0.2, g, 0, 0, s * -0.04);
    add(new THREE.CylinderGeometry(0.44, 0.48, 2.6, 14), M.hull, s * 4.3, 0.85, -0.6, g, PI / 2);
    add(new THREE.ConeGeometry(0.2, 0.5, 12), M.steel, s * 4.3, 0.85, -2.15, g, -PI / 2);
    const p = new THREE.Group();
    p.position.set(s * 4.3, 0.85, -2.45);
    g.add(p);
    box(0.16, 1.9, 0.03, M.dark, 0, 0, 0, p); box(0.16, 1.9, 0.03, M.dark, 0, 0, 0, p, 0, 0, PI / 2); box(0.16, 1.9, 0.03, M.dark, 0, 0, 0, p, 0, 0, PI / 4);
    add(new THREE.CircleGeometry(0.98, 24), M.blur, 0, 0, 0, p);
    props.push(p);
  }
  return {
    group: g, ramp: rampG, lampRed, lampGreen, glowR, glowG, props, M,
    dispose() { disposeTree(g); for (const t of texs) t.dispose(); },
  };
}

// ---------- flight path: a stadium loop over the drop zone ----------
function makePath(bound) {
  const Ls = bound * 1.2, R = bound * 0.5, L2 = Ls * 2, ARC = PI * R, P = L2 * 2 + ARC * 2, h0 = rnd(0, PI * 2);
  const fx = -Math.sin(h0), fz = -Math.cos(h0), nx = Math.cos(h0), nz = -Math.sin(h0);
  return {
    P, Ls,
    at(s, o) {
      s = ((s % P) + P) % P;
      let a, l, hd = 0, bank = 0;
      if (s < L2) { a = -Ls + s; l = -R; }
      else if (s < L2 + ARC) { const u = (s - L2) / R; a = Ls + Math.sin(u) * R; l = -Math.cos(u) * R; hd = u; bank = sstep(u / 0.3) * sstep((PI - u) / 0.3); }
      else if (s < L2 * 2 + ARC) { a = Ls - (s - L2 - ARC); l = R; hd = PI; }
      else { const u = (s - L2 * 2 - ARC) / R; a = -Ls - Math.sin(u) * R; l = Math.cos(u) * R; hd = PI + u; bank = sstep(u / 0.3) * sstep((PI - u) / 0.3); }
      o.x = fx * a + nx * l; o.z = fz * a + nz * l; o.yaw = h0 - hd; o.bank = bank * 0.14;
      return o;
    },
  };
}

// ---------- audio (own context: engines, wind, chute) ----------
let ACTX = null;
function createDropAudio() {
  let master = null, noise = null, eng = null, wnd = null, vol = -1;
  const ensure = () => {
    if (!ACTX) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false; ACTX = new AC(); }
    if (ACTX.state !== 'running') { try { ACTX.resume(); } catch (_) {} }
    if (!master) {
      master = ACTX.createGain(); master.connect(ACTX.destination);
      noise = ACTX.createBuffer(1, ACTX.sampleRate * 2, ACTX.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return true;
  };
  const src = () => { const s = ACTX.createBufferSource(); s.buffer = noise; s.loop = true; return s; };
  function start() {
    if (!ensure() || eng) return;
    const c = ACTX, nodes = [];
    const g = c.createGain(); g.gain.value = 0; g.connect(master);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 2;
    const trem = c.createGain(); trem.gain.value = 0.7;
    const lfo = c.createOscillator(); lfo.frequency.value = 17;
    const lg = c.createGain(); lg.gain.value = 0.25; lfo.connect(lg); lg.connect(trem.gain);
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = o2.type = 'sawtooth'; o1.frequency.value = 58; o2.frequency.value = 87;
    const g1 = c.createGain(), g2 = c.createGain(); g1.gain.value = 0.16; g2.gain.value = 0.1;
    o1.connect(g1); o2.connect(g2); g1.connect(lp); g2.connect(lp); lp.connect(trem); trem.connect(g);
    const rs = src(), rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 170;
    const rg = c.createGain(); rg.gain.value = 0.9; rs.connect(rf); rf.connect(rg); rg.connect(g);
    for (const n of [o1, o2, lfo, rs]) n.start();
    nodes.push(o1, o2, lfo, rs);
    eng = { g, nodes };
    const wg = c.createGain(); wg.gain.value = 0; wg.connect(master);
    const ws = src(), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.6;
    ws.connect(bp); bp.connect(wg); ws.start();
    wnd = { g: wg, bp, nodes: [ws] };
  }
  const burst = (o) => {
    if (!ACTX || !master) return;
    const c = ACTX, t = c.currentTime + 0.01, { type = 'lowpass', f = 800, f2 = null, q = 0.7, dur = 0.3, gain = 0.5, att = 0.01 } = o;
    const s = c.createBufferSource(); s.buffer = noise;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur);
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(gain, t + att); e.gain.exponentialRampToValueAtTime(0.0001, t + att + dur);
    s.connect(fl); fl.connect(e); e.connect(master); s.start(t, Math.random()); s.stop(t + att + dur + 0.05);
  };
  const tone = (f, f2, dur, gain, type = 'sine', delay = 0) => {
    if (!ACTX || !master) return;
    const c = ACTX, t = c.currentTime + 0.01 + delay, o = c.createOscillator(), e = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(gain, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e); e.connect(master); o.start(t); o.stop(t + dur + 0.05);
  };
  return {
    start,
    mix(engine, wind, windF) {
      if (!master) return;
      const v = clamp(settings.volume, 0, 1) * 0.9;
      if (v !== vol) { vol = v; master.gain.value = v; }
      const t = ACTX.currentTime;
      if (eng) eng.g.gain.setTargetAtTime(engine, t, 0.15);
      if (wnd) { wnd.g.gain.setTargetAtTime(wind, t, 0.12); wnd.bp.frequency.setTargetAtTime(windF, t, 0.2); }
    },
    door() { burst({ type: 'bandpass', f: 3000, f2: 900, q: 1, dur: 1.4, gain: 0.3, att: 0.1 }); tone(70, 40, 0.5, 0.5, 'sine'); burst({ type: 'bandpass', f: 1200, f2: 500, dur: 3, gain: 0.12, att: 0.4 }); },
    clunk() { tone(90, 38, 0.3, 0.7); burst({ f: 700, f2: 120, dur: 0.25, gain: 0.5 }); },
    chime() { tone(880, 880, 0.18, 0.2, 'triangle'); tone(1320, 1320, 0.3, 0.2, 'triangle', 0.2); },
    beep() { tone(1500, 1500, 0.09, 0.22, 'square'); },
    gust() { burst({ type: 'bandpass', f: 400, f2: 2600, q: 0.8, dur: 0.7, gain: 0.55, att: 0.05 }); },
    whump() { burst({ f: 1800, f2: 160, dur: 0.6, gain: 0.8, att: 0.02 }); tone(95, 45, 0.5, 0.8); burst({ type: 'bandpass', f: 900, f2: 300, dur: 0.9, gain: 0.35, att: 0.2 }); },
    flap() { burst({ type: 'bandpass', f: 1400, q: 1.5, dur: 0.12, gain: 0.12 }); },
    stop() {
      const t = ACTX && ACTX.currentTime;
      for (const x of [eng, wnd]) if (x) { x.g.gain.setTargetAtTime(0, t, 0.1); setTimeout(() => { for (const n of x.nodes || []) { try { n.stop(); } catch (_) {} } try { x.g.disconnect(); } catch (_) {} }, 600); }
      eng = wnd = null;
    },
  };
}

// ---------- HUD overlay ----------
const CSS = `
#dropHud{position:fixed;inset:0;z-index:12;pointer-events:none;display:none;font-family:var(--mono,monospace);color:#eef2f7;text-shadow:0 1px 3px rgba(0,0,0,.85)}
#dropHud.on{display:block}
body.dropping #cross,body.dropping #ammoBox,body.dropping #stance,body.dropping #camMode,body.dropping #reloadWrap,body.dropping #buildBar{opacity:0!important}
body.dropping #slots{visibility:hidden}
#dropHud canvas{position:absolute;inset:0;width:100%;height:100%}
.dh-vig{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(220,235,255,.5) 100%)}
.dh-flare{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at 50% 60%,#fff 0,rgba(255,255,255,.4) 45%,transparent 80%)}
.dh-bar{position:absolute;left:0;right:0;height:8vh;background:#000;transition:transform .9s ease;transform:scaleY(0)}
.dh-bar.top{top:0;transform-origin:top}.dh-bar.bot{bottom:0;transform-origin:bottom}
#dropHud.cine .dh-bar{transform:scaleY(1)}
.dh-loc{position:absolute;top:calc(84px + var(--sa,0px));left:0;right:0;text-align:center;opacity:0;transition:opacity .3s}
.dh-loc.on{opacity:1}
.dh-loc b{display:block;font-size:20px;letter-spacing:.28em;font-weight:800}
.dh-loc span{display:block;margin-top:4px;font-size:12px;letter-spacing:.18em;opacity:.8}
.dh-alt{position:absolute;right:26px;top:50%;transform:translateY(-50%);text-align:right;opacity:0;transition:opacity .3s}
.dh-alt.on{opacity:1}
.dh-alt .n{font-size:40px;font-weight:800;line-height:1}.dh-alt .n i{font-size:15px;font-style:normal;margin-left:3px;opacity:.7}
.dh-alt .l{font-size:10px;letter-spacing:.22em;opacity:.7;margin:3px 0 10px}
.dh-gauge{position:relative;width:8px;height:200px;margin-left:auto;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25);border-radius:4px}
.dh-gauge .f{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(to top,#ff7a3c,var(--acc,#ffc247));border-radius:3px}
.dh-gauge .m{position:absolute;left:-8px;right:-8px;height:2px;background:#fff}
.dh-gauge .m.a{background:#ff4d4d}
.dh-spd{margin-top:10px;font-size:13px;opacity:.85}.dh-spd b{font-size:18px}
.dh-warn{position:absolute;left:0;right:0;top:34%;text-align:center;font-size:44px;font-weight:900;letter-spacing:.3em;color:#ff4d4d;opacity:0}
.dh-warn.on{opacity:1;animation:dhb .35s steps(2) infinite}
@keyframes dhb{50%{opacity:.25}}
.dh-zone{position:absolute;left:0;right:0;top:26%;text-align:center;font-size:14px;letter-spacing:.2em;color:#ffc247;opacity:0}
.dh-zone.on{opacity:1}
.dh-prompt{position:absolute;left:50%;bottom:calc(110px + var(--sb,0px));transform:translateX(-50%);text-align:center;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:10px 18px;min-width:280px;opacity:0;transition:opacity .25s}
.dh-prompt.on{opacity:1}
.dh-prompt .k{display:inline-block;padding:3px 10px;margin-right:10px;border-radius:5px;background:var(--acc,#ffc247);color:#1a1205;font-weight:900;font-size:13px;letter-spacing:.08em}
.dh-prompt .t{font-weight:800;font-size:16px;letter-spacing:.08em}
.dh-prompt .s{font-size:12px;opacity:.8;margin-top:5px}
.dh-fade{position:absolute;inset:0;background:#000;opacity:0;transition:opacity 1s ease;display:flex;align-items:center;justify-content:center;font-size:14px;letter-spacing:.5em;font-weight:800;color:var(--acc,#ffc247)}
.dh-fade.on{opacity:1;transition:none}
body.mobile .dh-alt{right:12px;transform:translateY(-50%) scale(.8);transform-origin:right}
body.mobile .dh-prompt{bottom:auto;top:calc(110px + var(--sa,0px))}
`;
function buildHud() {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const root = document.createElement('div'); root.id = 'dropHud';
  root.innerHTML = '<canvas class="lines"></canvas><div class="dh-vig"></div><div class="dh-flare"></div><div class="dh-bar top"></div><div class="dh-bar bot"></div>' +
    '<div class="dh-loc"><b></b><span></span></div>' +
    '<div class="dh-alt"><div class="n"><b>0</b><i>m</i></div><div class="l">ABOVE GROUND</div><div class="dh-gauge"><i class="f"></i><i class="m o"></i><i class="m a"></i></div><div class="dh-spd"><b>0</b> km/h</div></div>' +
    '<div class="dh-warn">PULL!</div><div class="dh-zone">TURN BACK · DROP ZONE EDGE</div>' +
    '<div class="dh-prompt"><span class="k"></span><span class="t"></span><div class="s"></div></div><div class="dh-fade"><span>BOARDING</span></div>';
  document.body.append(root);
  const q = (s) => root.querySelector(s);
  const H = {
    root, cv: q('.lines'), vig: q('.dh-vig'), flare: q('.dh-flare'), loc: q('.dh-loc'), locB: q('.dh-loc b'), locS: q('.dh-loc span'),
    alt: q('.dh-alt'), altN: q('.dh-alt .n b'), gaugeF: q('.dh-gauge .f'), mOpen: q('.dh-gauge .o'), mAad: q('.dh-gauge .a'), spd: q('.dh-spd b'),
    warn: q('.dh-warn'), zone: q('.dh-zone'), prompt: q('.dh-prompt'), pk: q('.dh-prompt .k'), pt: q('.dh-prompt .t'), ps: q('.dh-prompt .s'), fade: q('.dh-fade'),
  };
  H.txt = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
  H.cls = (el, c, on) => { if (el._c !== on) { el._c = on; el.classList.toggle(c, on); } };
  H.ctx = H.cv.getContext('2d');
  return H;
}

// ---------- poses (right arm; left mirrors x). Arm vectors are in chest space (+Y head, -Z belly) ----------
const POSE_FREE = { chestX: 0.18, headX: 0.75, thighX: -0.32, thighZ: 0.3, shinX: -0.85, u: [0.96, 0.1, -0.05], f: [0.28, 0.95, -0.12] };
const POSE_CHUTE = { chestX: 0.12, headX: -0.05, thighX: 0.2, thighZ: 0.06, shinX: -0.3, u: [0.2, 0.97, -0.05], f: [0.1, 0.99, -0.05] };
const POSE_FLARE = { chestX: -0.1, headX: -0.1, thighX: 0.95, thighZ: 0.05, shinX: -0.15, u: [0.18, 0.98, -0.05], f: [0.1, 0.99, -0.05] };
const _pose = { u: [0, 0, 0], f: [0, 0, 0] };
function blendPose(a, b, w) {
  for (const k of ['chestX', 'headX', 'thighX', 'thighZ', 'shinX']) _pose[k] = lerp(a[k], b[k], w);
  for (const k of ['u', 'f']) for (let i = 0; i < 3; i++) _pose[k][i] = lerp(a[k][i], b[k][i], w);
  return _pose;
}
const DOWN = new THREE.Vector3(0, -1, 0), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _eu = new THREE.Euler(0, 0, 0, 'YXZ');
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
function applyPose(u, p, k) {
  u.chest.rotation.x = lerp(u.chest.rotation.x, p.chestX, k);
  u.head.rotation.x = lerp(u.head.rotation.x, p.headX, k);
  for (const [leg, s] of [[u.legL, -1], [u.legR, 1]]) {
    leg.thigh.rotation.x = lerp(leg.thigh.rotation.x, p.thighX, k);
    leg.thigh.rotation.z = lerp(leg.thigh.rotation.z, s * p.thighZ, k);
    leg.shin.rotation.x = lerp(leg.shin.rotation.x, p.shinX, k);
  }
  for (const [arm, s] of [[u.armL, -1], [u.armR, 1]]) {
    _q1.setFromUnitVectors(DOWN, _v1.set(s * p.u[0], p.u[1], p.u[2]).normalize());
    _v2.set(s * p.f[0], p.f[1], p.f[2]).normalize().applyQuaternion(_q2.copy(_q1).invert());
    _q3.setFromUnitVectors(DOWN, _v2);
    arm.shoulder.quaternion.slerp(_q1, k);
    arm.elbow.quaternion.slerp(_q3, k);
  }
}
function resetBody(u) {
  for (const j of [u.hips, u.chest, u.head, u.legL.thigh, u.legL.shin, u.legR.thigh, u.legR.shin]) { j.rotation.x = 0; j.rotation.y = 0; j.rotation.z = 0; }
}

// ---------- the module ----------
export function createDropship(deps) {
  const { scene, camera, playerMesh, viewmodel, player, input, audio, hud, world, tex, bullets } = deps;
  const bodyU = playerMesh.userData;
  const dh = buildHud();
  const snd = createDropAudio();
  const H = HIP_Y;
  let S = null, tail = null, saved = null, sunHide = [], sunSprite = null, clouds = null, pack = null;
  const tmp = new THREE.Vector3(), pp = { x: 0, z: 0, yaw: 0, bank: 0 };

  // first user gesture: make sure our audio context is allowed to run on iOS / Safari
  const wake = () => { try { if (!ACTX) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ACTX = new AC(); } if (ACTX && ACTX.state !== 'running') ACTX.resume(); } catch (_) {} };
  addEventListener('pointerdown', wake, { once: true });
  addEventListener('keydown', wake, { once: true });

  // ----- clouds + sun -----
  function makeClouds() {
    const t = canvasTex(128, 128, (c) => {
      for (let i = 0; i < 14; i++) {
        const x = rnd(34, 94), y = rnd(46, 84), r = rnd(18, 34), g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, 128, 128);
      }
    });
    const list = [];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      const w = rnd(160, 380);
      s.scale.set(w, w * rnd(0.4, 0.6), 1);
      s.position.set(camera.position.x + rnd(-1600, 1600), rnd(380, 700), camera.position.z + rnd(-1600, 1600));
      s.userData.base = rnd(0.5, 0.85);
      scene.add(s);
      list.push(s);
    }
    return { list, t };
  }
  function updateClouds() {
    if (!clouds) return;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, hi = sstep((cy - 250) / 250);
    for (const s of clouds.list) {
      const p = s.position;
      if (p.x - cx > 1700) p.x -= 3400; else if (p.x - cx < -1700) p.x += 3400;
      if (p.z - cz > 1700) p.z -= 3400; else if (p.z - cz < -1700) p.z += 3400;
      const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz);
      s.material.opacity = s.userData.base * clamp((d - 70) / 220, 0, 1) * hi;
      s.visible = s.material.opacity > 0.01;
    }
  }
  function killClouds() {
    if (!clouds) return;
    for (const s of clouds.list) { scene.remove(s); s.material.dispose(); }
    clouds.t.dispose();
    clouds = null;
  }

  // ----- parachute -----
  function makeCanopy(accent) {
    const t = canvasTex(512, 32, (c, w, h) => {
      const n = 16;
      for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? '#f1ead8' : '#' + accent.toString(16).padStart(6, '0'); c.fillRect((i * w) / n, 0, w / n + 1, h); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect((i * w) / n, 0, 2, h); }
    });
    const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide });
    const group = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 14, 0, PI * 2, 0, PI / 2), mat);
    dome.castShadow = true;
    group.add(dome);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(16 * 6), 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.8 }));
    lines.frustumCulled = false;
    scene.add(group, lines);
    return { group, lines, tex: t, mat, scale: new THREE.Vector3(1, 1, 1) };
  }
  function killCanopy(c) {
    scene.remove(c.group, c.lines);
    c.group.children[0].geometry.dispose(); c.lines.geometry.dispose(); c.lines.material.dispose(); c.mat.dispose(); c.tex.dispose();
  }
  /** pos = feet position; u = 0..1 inflation; bank/yaw orient it */
  function placeCanopy(c, pos, yaw, bank, u, collapse = 0) {
    const e = sstep(u), over = 1 + Math.sin(clamp(u, 0, 1) * PI) * 0.1;
    const sxz = lerp(0.18, 1, e) * lerp(1, 1.35, collapse), sy = lerp(0.12, 1, e) * over * (1 - collapse * 0.93);
    c.group.scale.set(5.4 * sxz, 2.6 * sy, 5.4 * sxz);
    const lineLen = lerp(1.2, 7.6, e), cos = Math.cos(yaw), sin = Math.sin(yaw);
    _eu.set(-bank * 0.1, yaw, bank * 0.22, 'YXZ');
    c.group.quaternion.setFromEuler(_eu);
    const back = (1 - e) * 0.35;
    c.group.position.set(pos.x + sin * back, pos.y + H + 0.5 + lineLen, pos.z + cos * back);
    if (collapse > 0) c.group.position.y = lerp(c.group.position.y, pos.y + 0.4, collapse);
    c.group.updateMatrixWorld(true);
    const a = c.lines.geometry.attributes.position.array;
    const rx = cos, rz = -sin; // right vector
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * PI * 2, side = Math.cos(ang) > 0 ? 1 : -1;
      tmp.set(Math.cos(ang), 0, Math.sin(ang));
      c.group.localToWorld(tmp);
      a[i * 6] = tmp.x; a[i * 6 + 1] = tmp.y; a[i * 6 + 2] = tmp.z;
      a[i * 6 + 3] = pos.x + rx * side * 0.22; a[i * 6 + 4] = pos.y + H + 0.5; a[i * 6 + 5] = pos.z + rz * side * 0.22;
    }
    c.lines.geometry.attributes.position.needsUpdate = true;
    c.lines.visible = collapse < 0.6;
  }

  // ----- atmosphere / restore -----
  function atmos(agl) {
    const k = sstep((agl - 120) / 400);
    camera.far = lerp(saved.far, 2400, k);
    camera.updateProjectionMatrix();
    if (scene.fog) { scene.fog.near = lerp(saved.fogNear, 450, k); scene.fog.far = lerp(saved.fogFar, 2300, k); }
  }
  function restore() {
    if (saved) {
      camera.near = saved.near; camera.far = saved.far; camera.updateProjectionMatrix();
      if (scene.fog) { scene.fog.near = saved.fogNear; scene.fog.far = saved.fogFar; }
      saved = null;
    }
    for (const s of sunHide) s.visible = true;
    sunHide = [];
    if (sunSprite) { scene.remove(sunSprite); sunSprite.material.dispose(); sunSprite = null; }
    killClouds();
    if (pack) { bodyU.chest.remove(pack); pack.geometry.dispose(); pack.material.dispose(); pack = null; }
    resetBody(bodyU);
    playerMesh.quaternion.identity();
    playerMesh.rotation.set(0, player.yaw, 0);
    playerMesh.position.set(player.x, player.y, player.z);
    dh.root.classList.remove('on', 'cine');
    document.body.classList.remove('dropping');
    dh.fade.classList.remove('on');
    snd.stop();
  }

  function begin(opts = {}) {
    if (S) cancel();
    const bound = opts.bound || 290, accent = opts.accent == null ? 0xff8a2b : opts.accent;
    const plane = buildPlane(accent);
    scene.add(plane.group);
    const path = makePath(bound);
    S = {
      phase: 'plane', t: 0, pt: 0, bound, accent, plane, path,
      s: path.P + path.Ls - bound * 0.9 - T.SPEED * (T.DOOR_START + T.DOOR_TIME + 0.4),
      lx: 0, lz: -0.6, ly: PI, bob: 0, stepAcc: 0, door: 0, ready: false, prevJump: input.keys.has('Space'), jolt: 0, joltT: rnd(2, 5),
      pvx: 0, pvz: 0, exit: null, vx: 0, vy: 0, dive: 0, flare: 0, bank: 0, poseBlend: 0, camBlend: 0, camOff: new THREE.Vector3(), camQ: new THREE.Quaternion(),
      chute: null, chuteT: 0, shake: 0, lastYaw: 0, warnT: 0, hintT: 0, landed: false, agl: T.ALT, speed: 0, edge: false, zoneT: 0, beeped: 0,
    };
    saved = { near: camera.near, far: camera.far, fogNear: scene.fog ? scene.fog.near : 160, fogFar: scene.fog ? scene.fog.far : 720 };
    camera.near = 0.1; camera.updateProjectionMatrix();
    scene.traverse((o) => { if (o.isSprite && o.material && o.material.blending === THREE.AdditiveBlending && o.material.fog === false && o.scale.x >= 39 && o.visible) { sunHide.push(o); o.visible = false; } });
    sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex && tex.glow ? tex.glow : null, color: 0xfff4cf, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sunSprite.scale.setScalar(420);
    scene.add(sunSprite);
    clouds = makeClouds();
    // skydiver pack on your back
    pack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 0.18), new THREE.MeshStandardMaterial({ color: 0x3a4230, roughness: 0.9 }));
    pack.position.set(0, 0.28, 0.24);
    bodyU.chest.add(pack);
    pack.visible = false;
    path.at(S.s, pp);
    S.ly = PI; player.yaw = pp.yaw + S.ly; S.lastYaw = player.yaw; player.pitch = 0.03;
    Object.assign(player, { onGround: false, velY: 0, vx: 0, vz: 0, moving: false, sprinting: false, crouching: false, ads: false, reloading: false, speed2d: 0, noise: 0 });
    playerMesh.visible = false;
    viewmodel.visible = true;
    dh.root.classList.add('on', 'cine');
    document.body.classList.add('dropping');
    dh.fade.classList.add('on');
    dh.fade.firstChild.textContent = 'BOARDING';
    dh.txt(dh.pk, isTouchKey());
    dh.mOpen.style.bottom = '0'; dh.mAad.style.bottom = (T.AUTO_OPEN_AGL / T.ALT) * 100 + '%';
    snd.start();
    planeStep(0);
  }
  const isTouchKey = () => (deps.isTouch ? 'JUMP' : 'SPACE');

  function cancel() {
    if (!S) return;
    if (S.chute) killCanopy(S.chute);
    S.plane.group.parent && scene.remove(S.plane.group);
    S.plane.dispose();
    S = null;
    if (tail) { killCanopy(tail.c); tail = null; }
    restore();
  }
  function finish() {
    const c = S.chute;
    S.plane.group.parent && scene.remove(S.plane.group);
    S.plane.dispose();
    S = null;
    if (tail) killCanopy(tail.c);
    tail = c ? { c, t: 0, pos: new THREE.Vector3(player.x, player.y, player.z), yaw: player.yaw } : null;
    restore();
    player.pitch = 0; player.onGround = true; player.velY = 0; player.vx = player.vz = 0;
    player.landDip = 0.12; player.protectT = Math.max(player.protectT, 2);
    hud.setMsg('Boots on the ground — fight!', 1800);
  }
  function tickTail(dt) {
    if (!tail) return;
    tail.t += dt;
    placeCanopy(tail.c, tail.pos, tail.yaw, 0, 1, clamp(tail.t / 0.8, 0, 1));
    if (tail.t > 3) { killCanopy(tail.c); tail = null; }
  }

  // ----- plane motion + cabin -----
  function planeStep(dt) {
    const P = S.plane;
    S.s += T.SPEED * dt;
    S.path.at(S.s, pp);
    S.joltT -= dt;
    if (S.joltT <= 0) { S.jolt = rnd(0.5, 1); S.joltT = rnd(3, 8); }
    S.jolt = Math.max(0, S.jolt - dt * 1.6);
    const t = S.t;
    P.group.position.set(pp.x, T.ALT + Math.sin(t * 0.7) * 0.25 + S.jolt * 0.12 * Math.sin(t * 40), pp.z);
    P.group.rotation.set(Math.sin(t * 0.5) * 0.01, pp.yaw, -pp.bank + Math.sin(t * 0.9) * 0.008, 'YXZ');
    S.pvx = -Math.sin(pp.yaw) * T.SPEED; S.pvz = -Math.cos(pp.yaw) * T.SPEED;
    for (const p of P.props) p.rotation.z += 32 * dt;
    // door + lamp
    S.door = sstep((S.t - T.DOOR_START) / T.DOOR_TIME);
    P.ramp.rotation.x = lerp(-PI / 2, RAMP_OPEN, S.door) + (S.door > 0 && S.door < 1 ? Math.sin(t * 30) * 0.004 : 0);
    const ready = S.door >= 0.999;
    if (ready && !S.ready) { S.ready = true; snd.clunk(); snd.chime(); dh.root.classList.remove('cine'); }
    const blink = ((t * 2.2) % 1) < 0.5, red = !ready && S.t > T.DOOR_START - 0.3 && blink;
    P.lampRed.material.color.setHex(red ? 0xff2a1a : 0x400a08); P.lampGreen.material.color.setHex(ready ? 0x35ff66 : 0x0a3010);
    P.glowR.material.opacity = red ? 0.9 : 0; P.glowG.material.opacity = ready ? 0.9 : 0;
    P.group.updateMatrixWorld(true);
  }

  function groundAt(x, z, y) { return floorAt(x, z, y, 0.3); }

  function planePhase(dt, look, jumpEdge) {
    const P = S.plane;
    if (S.t > 0.35) dh.fade.classList.remove('on');
    if (S.t > 0.4) dh.fade.firstChild.textContent = '';
    if (S.t > T.DOOR_START && !S.doorSnd) { S.doorSnd = true; snd.door(); }
    // look (relative to the plane so the view turns with it)
    S.ly += player.yaw - S.lastYaw;
    S.ly = PI + Math.atan2(Math.sin(S.ly - PI), Math.cos(S.ly - PI));
    // walk
    const k = input.keys, st = input.stick;
    let ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + st.x;
    let iz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) + st.y;
    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }
    if (S.phase === 'plane' && len > 0.1) {
      const sp = 2.6, c = Math.cos(S.ly), s = Math.sin(S.ly);
      S.lx += (ix * c + iz * s) * sp * dt; S.lz += (-ix * s + iz * c) * sp * dt;
      S.stepAcc += sp * dt;
      if (S.stepAcc > 1.7) { S.stepAcc = 0; audio.play('step', undefined, undefined, { vol: 0.35 }); }
    }
    const xMax = S.lz < 1.7 ? 0.72 : 1.15, zMax = S.ready ? 6.7 : 4.0;
    if (S.phase === 'plane') { S.lx = clamp(S.lx, -xMax, xMax); S.lz = clamp(S.lz, -3.6, zMax); }
    S.bob += dt * (len > 0.1 ? 9 : 1.5);
    let fy = 0;
    if (S.lz > RAMP_Z) fy = -(S.lz - RAMP_Z) * Math.sin(RAMP_OPEN);
    if (S.phase === 'plane' && jumpEdge && S.ready) startExit();
    if (S.phase === 'exit') {
      const x = S.exit;
      x.t += dt;
      const dx = x.tx - S.lx, dz = x.tz - S.lz, d = Math.hypot(dx, dz);
      if (d > 0.1) { const step = Math.min(d, 5.5 * dt); S.lx += (dx / d) * step; S.lz += (dz / d) * step; }
      S.ly = damp(S.ly, PI, 3, dt);
      player.pitch = damp(player.pitch, -0.3, 3, dt);
      if (S.lz > 6.1 || x.t > 1.2) { leavePlane(fy); return; }
    }
    // feet + camera in plane space
    tmp.set(S.lx, fy, S.lz);
    P.group.localToWorld(tmp);
    player.x = tmp.x; player.y = tmp.y; player.z = tmp.z;
    player.yaw = pp.yaw + S.ly;
    S.lastYaw = player.yaw;
    const shake = 0.003 + S.door * 0.003 + S.jolt * 0.01;
    tmp.set(S.lx, fy + EYE_H + Math.sin(S.bob) * 0.02 * (len > 0.1 ? 1 : 0.2), S.lz);
    P.group.localToWorld(tmp);
    camera.position.set(tmp.x + rnd(-1, 1) * shake, tmp.y + rnd(-1, 1) * shake, tmp.z + rnd(-1, 1) * shake);
    _q1.copy(P.group.quaternion);
    _eu.set(clamp(player.pitch, -1.35, 1.35), S.ly, rnd(-1, 1) * shake, 'YXZ');
    camera.quaternion.copy(_q1.multiply(_q2.setFromEuler(_eu)));
    const fovT = settings.fov + (S.phase === 'exit' ? 12 : 0);
    camera.fov = damp(camera.fov, fovT, 6, dt); camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // viewmodel idle
    updateViewmodel(viewmodel, {
      dt, moving: len > 0.1, sprint: false, grounded: true, ads: false, reloading: false, reloadT: 0, missing: 1, ammo: player.ammo,
      weapon: player.weaponId, weaponHidden: false, lookDX: look.dx, lookDY: look.dy, onEvent: noop,
    });
    viewmodel.visible = true;
    // hud
    const name = locationName(player.x, player.z);
    dh.txt(dh.locB, name); dh.txt(dh.locS, `HDG ${cardinal(pp.yaw).dir} ${cardinal(pp.yaw).deg}° · ALT ${Math.round(T.ALT)} m · ${Math.round(T.SPEED * 3.6)} km/h`);
    dh.cls(dh.loc, 'on', S.t > 1.2);
    dh.cls(dh.alt, 'on', false);
    if (S.phase === 'plane') {
      dh.cls(dh.prompt, 'on', S.t > 0.8);
      dh.pk.style.display = S.ready ? '' : 'none';
      dh.txt(dh.pk, isTouchKey());
      dh.txt(dh.pt, S.ready ? 'JUMP OUT' : 'BAY DOOR OPENING…');
      dh.txt(dh.ps, S.ready ? 'Pick your spot — the plane keeps circling the zone' : 'Stand by');
    } else dh.cls(dh.prompt, 'on', false);
    dh.flare.style.opacity = (Math.sin(S.door * PI) * 0.18).toFixed(3);
    const loud = S.door * 0.35 + 0.15;
    snd.mix(0.75 - S.door * 0.2, loud, 500 + S.door * 400);
    atmos(T.ALT);
    dh.vig.style.opacity = '0';
  }

  function startExit() {
    S.phase = 'exit';
    S.exit = { t: 0, tx: clamp(S.lx, -0.8, 0.8), tz: 6.6 };
    snd.gust();
  }
  function leavePlane(fy) {
    const P = S.plane;
    tmp.set(S.lx, fy, S.lz);
    P.group.localToWorld(tmp);
    const dx = S.exit.tx - S.lx, dz = S.exit.tz - S.lz, l = Math.hypot(dx, dz) || 1;
    const c = Math.cos(pp.yaw), s = Math.sin(pp.yaw), ldx = dx / l, ldz = dz / l;
    S.vx = S.pvx + (ldx * c + ldz * s) * 4; S.vz = S.pvz + (-ldx * s + ldz * c) * 4; S.vy = 1.5;
    player.x = tmp.x; player.y = tmp.y - 0.5; player.z = tmp.z;
    player.yaw = pp.yaw;
    S.camOff.copy(camera.position).sub(_v1.set(player.x, player.y + H, player.z));
    S.camQ.copy(camera.quaternion);
    S.phase = 'free'; S.pt = 0; S.camBlend = 0; S.poseBlend = 0;
    playerMesh.visible = true;
    viewmodel.visible = false;
    if (pack) pack.visible = true;
    dh.flare.style.opacity = '0.6';
    dh.root.classList.remove('cine');
    S.flash = 0.25;
    snd.gust();
  }

  // ----- diving / canopy -----
  function steerInput(out) {
    const k = input.keys, st = input.stick;
    out.f = clamp((k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - st.y, -1, 1);
    out.r = clamp((k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + st.x, -1, 1);
  }
  const inp = { f: 0, r: 0 };

  function moveDiver(dt, hsT, vyT, rate, vrate) {
    const yaw = player.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const tx = fx * hsT + rx * inp.r * (S.phase === 'free' ? T.STRAFE : 6), tz = fz * hsT + rz * inp.r * (S.phase === 'free' ? T.STRAFE : 6);
    S.vx = damp(S.vx, tx, rate, dt); S.vz = damp(S.vz, tz, rate, dt); S.vy = damp(S.vy, vyT, vrate, dt);
    const nx = clamp(player.x + S.vx * dt, -S.bound, S.bound), nz = clamp(player.z + S.vz * dt, -S.bound, S.bound);
    const edge = Math.abs(nx) >= S.bound - 1 || Math.abs(nz) >= S.bound - 1;
    S.edge = edge || Math.abs(nx) > S.bound - 22 || Math.abs(nz) > S.bound - 22;
    const r = resolveCircle(nx, nz, 0.45, player.y, 1.7);
    player.x = r.x; player.z = r.z;
    player.y += S.vy * dt;
    S.speed = Math.hypot(S.vx, S.vy, S.vz);
    player.vx = S.vx; player.vz = S.vz; player.velY = S.vy;
  }

  function driveBody(dt, tilt, twist, bankZ, pose, k, crouch) {
    const yaw = player.yaw;
    _q3.setFromAxisAngle(AY, yaw);
    _q4.copy(_q3).multiply(_q1.setFromAxisAngle(AX, tilt)).multiply(_q2.setFromAxisAngle(AY, twist)).multiply(_q1.setFromAxisAngle(AZ, bankZ));
    playerMesh.quaternion.copy(_q4);
    tmp.set(0, H, 0).applyQuaternion(_q4);
    playerMesh.position.set(player.x - tmp.x, player.y + H - tmp.y, player.z - tmp.z);
    playerMesh.visible = true;
    updateHumanoidAnim(bodyU, {
      dt, moving: false, speed: 0, grounded: false, ads: false, sprint: false, crouch: !!crouch, pitch: 0, reloading: false, reloadT: 0,
      missing: 1, ammo: 0, weapon: player.weaponId, weaponHidden: true, dead: false, onEvent: noop, onStep: noop,
    });
    applyPose(bodyU, pose, k);
  }

  function thirdPersonCam(dt, dist, up, lookAtUp) {
    const yaw = player.yaw, p = clamp(player.pitch, -1.25, 0.9), cp = Math.cos(p);
    _v1.set(-Math.sin(yaw) * cp, Math.sin(p), -Math.cos(yaw) * cp);
    const base = tmp.set(player.x, player.y + H + up, player.z);
    const target = _v2.copy(base).addScaledVector(_v1, -dist);
    const gy = groundAt(target.x, target.z, target.y) + 0.6;
    if (target.y < gy) target.y = gy;
    // camera pose from the plane, blended into this one
    if (S && S.camBlend < 1) {
      S.camBlend = Math.min(1, S.camBlend + dt / 0.9);
      const b = sstep(S.camBlend);
      const from = _v1.set(player.x, player.y + H, player.z).add(S.camOff);
      camera.position.copy(from.lerp(target, b));
      camera.lookAt(player.x, player.y + H + lookAtUp, player.z);
      _q2.copy(camera.quaternion);
      camera.quaternion.copy(_q3.copy(S.camQ).slerp(_q2, b));
    } else {
      camera.position.copy(target);
      camera.lookAt(player.x, player.y + H + lookAtUp, player.z);
    }
    if (S && S.shake > 0.001) {
      camera.position.x += rnd(-1, 1) * S.shake * 0.25; camera.position.y += rnd(-1, 1) * S.shake * 0.25; camera.position.z += rnd(-1, 1) * S.shake * 0.25;
      S.shake = Math.max(0, S.shake - dt * 2.2);
    }
    camera.updateMatrixWorld();
  }

  function startDeploy() {
    S.phase = 'deploy'; S.pt = 0; S.shake = 1;
    S.chute = makeCanopy(S.accent);
    if (pack) pack.visible = false;
    snd.whump();
    hud.setMsg('', 1);
  }

  function airPhase(dt, jumpEdge) {
    S.pt += dt;
    steerInput(inp);
    const fl = groundAt(player.x, player.z, player.y);
    const agl = player.y - fl;
    S.agl = agl;
    if (S.phase === 'free') {
      S.dive = damp(S.dive, clamp(inp.f, 0, 1), 3, dt);
      S.flare = damp(S.flare, clamp(-inp.f, 0, 1), 3, dt);
      S.bank = damp(S.bank, inp.r, 4, dt);
      const hsT = T.HS_FLAT + (T.HS_DIVE - T.HS_FLAT) * S.dive - (T.HS_FLAT - T.HS_FLARE) * S.flare;
      const vyT = -(T.FALL_FLAT + (T.FALL_DIVE - T.FALL_FLAT) * S.dive - (T.FALL_FLAT - T.FALL_FLARE) * S.flare);
      moveDiver(dt, hsT, vyT, 1.1, 1.0);
      S.poseBlend = damp(S.poseBlend, 1, 5, dt);
      const tilt = -1.46 - 0.85 * S.dive + 0.45 * S.flare + Math.sin(S.pt * 3.1) * 0.03;
      driveBody(dt, tilt, 0.5 * S.bank, 0, POSE_FREE, S.poseBlend, false);
      if ((jumpEdge && S.pt > T.MIN_FREEFALL) || agl <= T.AUTO_OPEN_AGL) {
        if (agl <= T.AUTO_OPEN_AGL && !jumpEdge) hud.setMsg('AUTO-OPEN', 900);
        startDeploy();
      }
    } else {
      const u = S.phase === 'deploy' ? S.pt / 1.25 : 1;
      S.chuteT += dt;
      const f = inp.f, hsT = S.phase === 'deploy' ? lerp(S.vxSpeed || 20, T.CHUTE_H, sstep(S.pt / 1.2)) : T.CHUTE_H + (f > 0 ? 5 * f : 3.5 * f);
      let vyT = -(T.CHUTE_V + (f > 0 ? 3 * f : 2.8 * f));
      if (S.phase === 'deploy' && S.pt < 0.28) vyT = S.vy; // pilot chute: no braking yet
      else if (S.phase === 'deploy') vyT = -T.CHUTE_V;
      const flare = agl < 6 ? 1 - agl / 6 : 0;
      if (flare > 0) vyT = lerp(vyT, -2.2, flare);
      S.bank = damp(S.bank, inp.r, 3, dt);
      moveDiver(dt, hsT, vyT, S.phase === 'deploy' ? 2.2 : 2.6, S.phase === 'deploy' ? 4.2 : 3);
      const cb = S.phase === 'deploy' ? sstep((S.pt - 0.2) / 0.9) : 1;
      const freeTilt = -1.46 - 0.85 * S.dive + 0.45 * S.flare;
      blendPose(POSE_FREE, POSE_CHUTE, cb);
      const p2 = flare > 0 ? blendPose(_pose, POSE_FLARE, flare) : _pose;
      driveBody(dt, lerp(freeTilt, -0.05 - flare * 0.25, cb), lerp(0.5 * S.bank, 0, cb), S.bank * -0.12 * cb, p2, 1, S.phase === 'land');
      placeCanopy(S.chute, { x: player.x, y: player.y, z: player.z }, player.yaw, S.bank, u);
      if (S.phase === 'deploy' && S.pt >= 1.25) { S.phase = 'chute'; S.pt = 0; }
      if (S.chuteT > 0.5 && Math.random() < dt * 1.4) snd.flap();
      if (agl <= 0.05 && S.vy <= 0) {
        player.y = fl; S.phase = 'land'; S.pt = 0; audio.play('land'); S.shake = 0.5;
        S.land = { x: player.x, y: player.y, z: player.z };
      }
    }
    if (S.phase !== 'free' && S.phase !== 'deploy' && S.phase !== 'chute') return;
    thirdPersonCam(dt, S.phase === 'free' ? 6.2 + S.dive * 1.4 : 8.5, S.phase === 'free' ? 0.5 : 1.3, S.phase === 'free' ? 0.4 : 1.6);
    const fovT = settings.fov + (S.phase === 'free' ? clamp((S.speed - 30) / 60, 0, 1) * 16 : S.phase === 'deploy' ? -4 : 0);
    camera.fov = damp(camera.fov, fovT, 5, dt); camera.updateProjectionMatrix();
  }

  function landPhase(dt) {
    S.pt += dt;
    player.vx = player.vz = 0;
    const L = S.land;
    player.x = L.x; player.y = L.y; player.z = L.z;
    const col = clamp(S.pt / 0.8, 0, 1);
    driveBody(dt, 0, 0, 0, POSE_FLARE, 1, true);
    placeCanopy(S.chute, L, player.yaw, 0, 1, col);
    thirdPersonCam(dt, 7, 1.2, 1.2);
    if (S.pt > 0.4) finish();
  }

  // ----- hud + overlays for the air phases -----
  function airHud(dt) {
    dh.cls(dh.alt, 'on', true);
    const agl = Math.max(0, S.agl);
    dh.txt(dh.altN, String(Math.round(agl)));
    dh.gaugeF.style.height = clamp((agl / T.ALT) * 100, 0, 100) + '%';
    dh.txt(dh.spd, String(Math.round(S.speed * 3.6)));
    const name = locationName(player.x, player.z);
    dh.txt(dh.locB, name); dh.txt(dh.locS, `HDG ${cardinal(player.yaw).dir} ${cardinal(player.yaw).deg}°`);
    dh.cls(dh.loc, 'on', true);
    const free = S.phase === 'free';
    dh.pk.style.display = free ? '' : 'none';
    dh.txt(dh.pk, isTouchKey());
    if (free) { dh.txt(dh.pt, 'DEPLOY PARACHUTE'); dh.txt(dh.ps, `W dive · S flare · A/D drift · auto-opens at ${T.AUTO_OPEN_AGL} m`); }
    else { dh.txt(dh.pt, S.phase === 'land' ? 'TOUCHDOWN' : 'UNDER CANOPY'); dh.txt(dh.ps, 'W / S speed · A / D drift · mouse steers'); }
    S.hintT += dt;
    dh.cls(dh.prompt, 'on', free || (S.phase !== 'land' && S.hintT < 9));
    const warn = free && agl < 230 && S.pt > 1;
    dh.cls(dh.warn, 'on', warn);
    if (warn && S.pt - S.warnT > 0.45) { S.warnT = S.pt; snd.beep(); }
    dh.cls(dh.zone, 'on', S.edge && S.phase !== 'land');
    const sp = free ? clamp((S.speed - 35) / 55, 0, 1) : 0;
    dh.vig.style.opacity = (sp * 0.7).toFixed(2);
    // speed lines
    const cv = dh.cv, w = (cv.clientWidth / 2) | 0, h = (cv.clientHeight / 2) | 0;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const c = dh.ctx;
    c.clearRect(0, 0, w, h);
    if (sp > 0.05) {
      c.strokeStyle = `rgba(255,255,255,${0.35 * sp})`; c.lineWidth = 1.2; c.beginPath();
      for (let i = 0; i < 38; i++) {
        const a = rnd(0, PI * 2), r0 = Math.max(w, h) * rnd(0.22, 0.5), r1 = r0 + Math.max(w, h) * rnd(0.05, 0.22) * sp;
        c.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0 * 0.8); c.lineTo(w / 2 + Math.cos(a) * r1, h / 2 + Math.sin(a) * r1 * 0.8);
      }
      c.stroke();
    }
    if (S.flash > 0) { S.flash = Math.max(0, S.flash - dt); dh.flare.style.opacity = (S.flash * 2).toFixed(2); } else dh.flare.style.opacity = '0';
    const wind = free ? 0.1 + sp * 0.9 : 0.1 + clamp(S.speed / 60, 0, 0.25);
    const distPlane = S.plane.group.parent ? S.plane.group.position.distanceTo(camera.position) : 9999;
    snd.mix(Math.exp(-distPlane / 90) * 0.6, wind, 500 + sp * 2200);
    atmos(Math.max(0, S.agl));
  }

  function locationName(x, z) {
    let best = null, bd = 1e9;
    for (const p of world.pois || []) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < p.r * 1.25 && d / p.r < bd && (p.tier === 'major' || p.r < 40)) { bd = d / p.r; best = p; }
    }
    return best ? 'OVER · ' + String(best.name).toUpperCase() : 'OPEN COUNTRY';
  }

  // ----- public -----
  function update(dt) {
    if (!S) return;
    const look = input.consumeLook();
    if (!player.alive) { cancel(); return; }
    const jumpDown = input.keys.has('Space'), jumpEdge = jumpDown && !S.prevJump;
    S.prevJump = jumpDown;
    S.t += dt;
    player.protectT = Math.max(player.protectT, 2);
    player.onGround = false; player.moving = player.sprinting = player.crouching = player.ads = false;
    if (S.phase === 'plane' || S.phase === 'exit') {
      planeStep(dt);
      planePhase(dt, look, jumpEdge);
      if (!S) return;
    } else {
      // plane flies on until it is a speck
      if (S.plane.group.parent) {
        planeStep(dt);
        if (S.plane.group.position.distanceTo(camera.position) > 1800) { scene.remove(S.plane.group); S.plane.dispose(); }
      }
      S.lastYaw = player.yaw;
      if (S.phase === 'land') landPhase(dt); else airPhase(dt, jumpEdge);
      if (!S) { tickTail(dt); return; }
      airHud(dt);
    }
    audio.setListener(player.x, player.z, player.yaw);
    if (bullets) bullets.setListener(player.x, player.y + 1.6, player.z);
    updateClouds();
    if (sunSprite) sunSprite.position.copy(camera.position).addScaledVector(world.sunDir, 1800);
    hud.update(player);
  }
  const active = () => !!S;
  /** true while nothing on the ground should be able to see or hurt you */
  const airborne = () => !!S && S.phase !== 'land' && !(S.phase === 'chute' && S.agl < 30);
  const phase = () => (S ? S.phase : null);
  return { begin, update, tick: tickTail, cancel, active, airborne, phase };
}
