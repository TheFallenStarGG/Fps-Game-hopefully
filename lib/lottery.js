/**
 * Ridgeback Lottery — utility.
 * Arm it (utility fire) and the rune ritual plays (lotteryKit.js: the hands, the model and these timings line up).
 * Once it's loaded, your next gunshot becomes a single Ridgeback-class round: delete-on-hit damage, a heavy upward kick,
 * a golden beam + shockwave and a short golden whiteout. One charge per life.
 */
import * as THREE from 'three';
import { LOT, LOT_DEPLOY, lotteryFx } from './lotteryKit.js';
import { raycastWorld } from './collision.js';

const ARM_TIME = LOT_DEPLOY.armAt + 0.1; // the seal lands at armAt; you're loaded a beat later
const BLIND_TIME = 0.55;
const RECOVER_TIME = 0.35;
const CHARGE_PER_LIFE = 1;
const RIDGE_DMG = { head: 300, body: 300, limb: 300 };
const HP = Math.PI / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const _tmp = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _end = new THREE.Vector3();

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createLottery({ scene, hud, audio, camera }) {
  let charges = CHARGE_PER_LIFE;
  let phase = 'idle'; // idle | arming | armed | blind | recover
  let t = 0, lastMsg = 0, P = null, pitchAtShot = null;
  const fxv = {};
  LOT.state = 'idle';

  // ---------- screen FX ----------
  const layer = (id, css) => {
    const d = document.createElement('div');
    d.id = id;
    d.style.cssText = 'position:fixed;pointer-events:none;' + css;
    document.body.appendChild(d);
    return d;
  };
  const flash = layer('lotteryFlash', 'inset:0;z-index:45;opacity:0;mix-blend-mode:screen;background:radial-gradient(circle at 50% 50%,rgba(255,248,222,1) 0%,rgba(255,214,110,.88) 38%,rgba(255,150,30,.55) 100%);');
  const edge = layer('lotteryEdge', 'inset:0;z-index:44;opacity:0;mix-blend-mode:screen;background:radial-gradient(ellipse at 50% 50%,rgba(255,170,40,0) 52%,rgba(255,170,40,.42) 100%);');
  const badge = layer('lotteryBadge', 'left:50%;bottom:132px;transform:translateX(-50%);z-index:44;display:none;padding:6px 16px;border:1px solid rgba(255,200,90,.75);border-radius:999px;background:rgba(20,12,2,.65);color:#ffd98a;font:700 12px/1 system-ui,sans-serif;letter-spacing:.2em;text-shadow:0 0 8px rgba(255,160,40,.9);box-shadow:0 0 18px rgba(255,170,40,.45);');
  badge.textContent = '✦ RIDGEBACK LOADED ✦';

  // ---------- world FX ----------
  const glowTex = glowTexture();
  const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
  const sprite = (color) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, opacity: 0, ...add }));
    s.visible = false;
    scene.add(s);
    return s;
  };
  const burst = sprite(0xffd27a), hitBurst = sprite(0xffe9b0);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(HP),
    new THREE.MeshBasicMaterial({ color: 0xffc860, opacity: 0, side: THREE.DoubleSide, ...add }),
  );
  beam.visible = false; beam.frustumCulled = false;
  scene.add(beam);
  const shock = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 1, 56),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, opacity: 0, side: THREE.DoubleSide, ...add }),
  );
  shock.visible = false;
  scene.add(shock);
  let burstT = 9, hitT = 9, beamT = 9, shockT = 9, beamLen = 1;

  // sparks (pooled)
  const SN = 72;
  const sPos = new Float32Array(SN * 3), sVel = new Float32Array(SN * 3), sCol = new Float32Array(SN * 3);
  const sLife = new Float32Array(SN), sMax = new Float32Array(SN);
  for (let i = 0; i < SN; i++) sPos[i * 3 + 1] = -9999;
  const sGeo = new THREE.BufferGeometry();
  const sPosAttr = new THREE.BufferAttribute(sPos, 3), sColAttr = new THREE.BufferAttribute(sCol, 3);
  sGeo.setAttribute('position', sPosAttr);
  sGeo.setAttribute('color', sColAttr);
  const sparks = new THREE.Points(sGeo, new THREE.PointsMaterial({ map: glowTex, size: 0.07, sizeAttenuation: true, vertexColors: true, ...add }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sIdx = 0, sActive = 0;
  function emit(o, d, n, v0, v1, spread) {
    for (let k = 0; k < n; k++) {
      const i = sIdx, j = i * 3;
      sIdx = (sIdx + 1) % SN;
      _tmp.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(spread).add(d).normalize().multiplyScalar(rnd(v0, v1));
      sPos[j] = o.x; sPos[j + 1] = o.y; sPos[j + 2] = o.z;
      sVel[j] = _tmp.x; sVel[j + 1] = _tmp.y; sVel[j + 2] = _tmp.z;
      sMax[i] = sLife[i] = rnd(0.45, 0.9);
    }
    sActive = 1;
  }
  function updateSparks(dt) {
    if (!sActive) return;
    let any = false;
    for (let i = 0; i < SN; i++) {
      if (sLife[i] <= 0) continue;
      const j = i * 3;
      sLife[i] -= dt;
      if (sLife[i] <= 0) { sPos[j + 1] = -9999; sCol[j] = sCol[j + 1] = sCol[j + 2] = 0; continue; }
      any = true;
      sVel[j + 1] -= 7 * dt;
      sPos[j] += sVel[j] * dt; sPos[j + 1] += sVel[j + 1] * dt; sPos[j + 2] += sVel[j + 2] * dt;
      const k = sLife[i] / sMax[i];
      sCol[j] = k; sCol[j + 1] = 0.72 * k; sCol[j + 2] = 0.25 * k;
    }
    sPosAttr.needsUpdate = true;
    sColAttr.needsUpdate = true;
    if (!any) sActive = 0;
  }

  // embers orbiting your body while loaded (third person)
  const AN = 16, aPos = new Float32Array(AN * 3), aPh = Array.from({ length: AN }, () => Math.random() * Math.PI * 2);
  const aAttr = new THREE.BufferAttribute(aPos, 3);
  const aGeo = new THREE.BufferGeometry();
  aGeo.setAttribute('position', aAttr);
  const aura = new THREE.Points(aGeo, new THREE.PointsMaterial({ map: glowTex, color: 0xffc247, size: 0.05, sizeAttenuation: true, opacity: 0.8, ...add }));
  aura.visible = false; aura.frustumCulled = false;
  scene.add(aura);

  function setPhase(p) {
    phase = p;
    t = 0;
    LOT.state = p === 'arming' ? 'arming' : p === 'armed' ? 'armed' : charges > 0 ? 'idle' : 'spent';
  }

  const canArm = () => phase === 'idle' && charges > 0;
  const say = (msg, ms) => {
    const n = performance.now() / 1000;
    if (n - lastMsg < 1.2) return;
    lastMsg = n;
    hud.setMsg(msg, ms);
  };

  /** Called when the player fires the utility. Returns true if the ritual started. */
  function arm() {
    if (!canArm()) {
      if (charges <= 0) say('Lottery spent — next life', 1600);
      else if (phase === 'armed') say('Loaded — switch to a gun and fire', 1400);
      return false;
    }
    setPhase('arming');
    audio.play('draw');
    hud.setMsg('Drawing the Ridgeback round…', 1100);
    return true;
  }

  const isArmed = () => phase === 'armed';
  const busy = () => phase === 'arming' || phase === 'blind';

  /** Describe the next shot. Called from shoot() when loaded. */
  function consumeShot() {
    if (phase !== 'armed') return null;
    charges = Math.max(0, charges - 1);
    pitchAtShot = P ? P.pitch : null;
    setPhase('blind');
    audio.play('shot', undefined, undefined, { snd: 'ridgeback', vol: 0.8 });
    audio.play('clang', undefined, undefined, { vol: 0.6 });
    hud.setMsg('RIDGEBACK LOTTERY', 900);
    return {
      dmg: RIDGE_DMG, pellets: 1, spread: 0.001, recoil: 0.22, fireCd: 0.85, bulletSpeed: 330, shake: 0.3,
      silent: false, soundId: 'ridgeback',
    };
  }

  /** Called right after the shot: golden beam, shockwave, sparks — and the camera kick. */
  function fireBurst(origin, dir) {
    if (P) {
      // the Lottery owns its kick: never let this shot push the aim down, kick it UP
      if (pitchAtShot != null && P.pitch < pitchAtShot) P.pitch = pitchAtShot;
      P.pitch = Math.min(1.4, P.pitch + 0.05);
    }
    _o.copy(origin);
    _d.copy(dir).normalize();

    const w = raycastWorld(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, 150);
    const dist = w ? w.t : 90;
    _end.copy(_o).addScaledVector(_d, dist);

    burst.position.copy(_o); burst.visible = true; burstT = 0;
    shock.position.copy(_o);
    shock.lookAt(_tmp.copy(_o).add(_d));
    shock.visible = true; shockT = 0;
    beamLen = dist;
    beam.position.copy(_o).addScaledVector(_d, dist / 2);
    beam.lookAt(_end);
    beam.visible = true; beamT = 0;
    emit(_o, _d, 18, 5, 12, 0.35);
    if (w) {
      hitBurst.position.copy(_end); hitBurst.visible = true; hitT = 0;
      emit(_end, _tmp.copy(_d).negate(), 22, 2, 8, 1.2);
    }
  }

  function updateFx(dt) {
    if (burstT < 0.25) {
      burstT += dt;
      const k = Math.min(1, burstT / 0.25);
      burst.scale.setScalar(0.3 + k * 1.8); burst.material.opacity = 1 - k;
      if (k >= 1) burst.visible = false;
    }
    if (hitT < 0.3) {
      hitT += dt;
      const k = Math.min(1, hitT / 0.3);
      hitBurst.scale.setScalar(0.5 + k * 2.2); hitBurst.material.opacity = 1 - k;
      if (k >= 1) hitBurst.visible = false;
    }
    if (shockT < 0.35) {
      shockT += dt;
      const k = Math.min(1, shockT / 0.35);
      shock.scale.setScalar(0.25 + k * 3.2); shock.material.opacity = 0.9 * (1 - k);
      if (k >= 1) shock.visible = false;
    }
    if (beamT < 0.3) {
      beamT += dt;
      const k = Math.min(1, beamT / 0.3), wd = 0.05 * (1 - k) + 0.004;
      beam.scale.set(wd, wd, beamLen); beam.material.opacity = 0.9 * (1 - k);
      if (k >= 1) beam.visible = false;
    }
    updateSparks(dt);
  }

  function update(dt, player) {
    t += dt;
    P = player;
    const now = performance.now() / 1000;
    let edgeA = 0, flashA = 0;

    if (phase === 'arming') {
      const f = lotteryFx(Math.min(t, LOT_DEPLOY.dur), fxv);
      edgeA = clamp(0.1 + 0.2 * f.heat, 0, 0.5);
      flashA = 0.5 * f.flash;
      if (t >= ARM_TIME) {
        setPhase('armed');
        hud.setMsg('Ridgeback loaded — your next shot is the round', 2200);
      }
    } else if (phase === 'armed') {
      edgeA = 0.16 + 0.06 * Math.sin(now * 3.2);
    } else if (phase === 'blind') {
      const k = Math.min(1, t / BLIND_TIME);
      flashA = (k < 0.12 ? 1 : 1 - (k - 0.12) / 0.88) * 0.92; // hard flash, then ease out
      edgeA = 0.4 * (1 - k);
      if (t >= BLIND_TIME) setPhase('recover');
    } else if (phase === 'recover') {
      if (t >= RECOVER_TIME) setPhase('idle');
    }
    flash.style.opacity = flashA.toFixed(3);
    edge.style.opacity = edgeA.toFixed(3);
    badge.style.display = phase === 'armed' ? 'block' : 'none';
    if (phase === 'armed') badge.style.opacity = (0.78 + 0.22 * Math.sin(now * 4)).toFixed(2);

    // embers around your body while loaded (only visible in third person)
    const showAura = phase === 'armed' && !!player && !!player.thirdPerson;
    aura.visible = showAura;
    if (showAura) {
      for (let i = 0; i < AN; i++) {
        const a = aPh[i] + now * 1.6, rad = 0.55 + 0.08 * Math.sin(now * 2 + i);
        aPos[i * 3] = player.x + Math.cos(a) * rad;
        aPos[i * 3 + 1] = player.y + 1.0 + Math.sin(now * 1.3 + i) * 0.45;
        aPos[i * 3 + 2] = player.z + Math.sin(a) * rad;
      }
      aAttr.needsUpdate = true;
    }
    updateFx(dt);
  }

  function onRespawn() {
    charges = CHARGE_PER_LIFE;
    for (const o of [burst, hitBurst, beam, shock, aura]) o.visible = false;
    burstT = hitT = beamT = shockT = 9;
    for (let i = 0; i < SN; i++) { sLife[i] = 0; sPos[i * 3 + 1] = -9999; }
    sPosAttr.needsUpdate = true;
    sActive = 0;
    flash.style.opacity = '0';
    edge.style.opacity = '0';
    badge.style.display = 'none';
    setPhase('idle');
  }

  function dispose() {
    for (const o of [burst, hitBurst, beam, shock, sparks, aura]) scene.remove(o);
    flash.remove(); edge.remove(); badge.remove();
  }

  return {
    arm, canArm, isArmed, busy, consumeShot, fireBurst, update, onRespawn, dispose,
    get charges() { return charges; },
    get phase() { return phase; },
    RIDGE_DMG,
  };
}
