/**
 * Scout drone: cinematic deploy, free flight with first / third person views,
 * rotor animations, shoot-down and recall.
 * The player's body stays where it was deployed.
 * Deploy / stow timings come from droneKit.js, so the world drone stays in sync with the hand animation.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { raycastWorld, floorAt } from './collision.js';
import { buildWeapon } from './weaponModels.js';
import { settings } from './settings.js';
import { DEPLOY, STOW } from './droneKit.js';

const eventT = (name) => DEPLOY.events.find((e) => e[1] === name)[0];
const DEPLOY_T = DEPLOY.dur, STOW_T = STOW.dur, PLACE_T = eventT('place'), TAP_T = eventT('tap');
const TRANS_T = 1.25, HP = 60, RADIUS = 0.45, BATTERY = 90, LEASH = 70;
const MOVE = 9, VERT = 5, GRAV = 9.8, MAX_Y = 40, MIN_Y = 0.4;
const REST_H = 0.07; // body height above the ground when it sits on it
const SET_DOWN = 0.5; // it's released this high above the ground (the hand can't reach the floor)
const LIFT = 0.42; // takeoff hover before the camera moves over
const MODEL_URL = new URL('../assets/survey-drone-7c71f9.glb', import.meta.url).href;

const PI = Math.PI;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const smoother = (x) => { x = clamp01(x); return x * x * x * (x * (6 * x - 15) + 10); };
const damp = (c, t, rate, dt) => c + (t - c) * (1 - Math.exp(-rate * dt));

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _mv = new THREE.Vector3();
const _look = new THREE.Vector3();
const _dummy = new THREE.PerspectiveCamera();
const fromQ = new THREE.Quaternion();

function forwardOf(yaw, pitch, out) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

function buildTouchBar(touch, onView, onRecall) {
  const style = document.createElement('style');
  style.textContent = '#droneTouch{display:none;position:fixed;inset:0;z-index:30;touch-action:none;pointer-events:none}'
    + 'body.mobile.in-drone #droneTouch{display:block}body.mobile.in-drone #mobile{display:none}'
    + '#droneTouch *{touch-action:none;user-select:none;-webkit-user-select:none}'
    + '#droneLook{position:absolute;inset:0;pointer-events:auto}'
    + '#droneMove{position:absolute;left:24px;bottom:24px;width:150px;height:150px;border-radius:50%;pointer-events:auto;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.3)}'
    + '#droneKnob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(255,255,255,.3);border:2px solid rgba(255,255,255,.5);pointer-events:none}'
    + '#droneTouch .db{position:absolute;pointer-events:auto;width:84px;height:56px;border-radius:12px;border:2px solid rgba(255,255,255,.4);background:rgba(0,0,0,.45);color:#fff;font:800 12px system-ui;display:flex;align-items:center;justify-content:center}'
    + '#droneTouch .db.down{background:rgba(255,194,71,.5);border-color:#ffc247}';
  document.head.appendChild(style);

  const ui = document.createElement('div');
  ui.id = 'droneTouch';
  ui.innerHTML = '<div id="droneLook"></div><div id="droneMove"><div id="droneKnob"></div></div>'
    + '<div class="db" id="droneUp" style="right:24px;bottom:220px">UP</div>'
    + '<div class="db" id="droneDown" style="right:24px;bottom:140px">DOWN</div>'
    + '<div class="db" id="droneView" style="right:120px;bottom:60px">CAM</div>'
    + '<div class="db" id="droneRecall" style="right:24px;bottom:60px">RECALL</div>';
  document.body.appendChild(ui);
  const $ = (id) => ui.querySelector('#' + id);

  const press = (el, onDown, onUp) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); onDown(); });
    const up = (e) => { e.preventDefault(); el.classList.remove('down'); onUp(); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  press($('droneUp'), () => { touch.up = true; }, () => { touch.up = false; });
  press($('droneDown'), () => { touch.down = true; }, () => { touch.down = false; });
  press($('droneView'), onView, () => {});
  press($('droneRecall'), onRecall, () => {});

  const cl = (v) => Math.max(-1, Math.min(1, v));
  const mv = $('droneMove'), knob = $('droneKnob');
  let mid = null;
  const setStick = (e) => {
    const r = mv.getBoundingClientRect(), R = r.width / 2;
    const dx = cl((e.clientX - (r.left + R)) / R), dy = cl((e.clientY - (r.top + R)) / R);
    touch.sx = dx; touch.sy = dy;
    knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
  };
  const endStick = () => { mid = null; touch.sx = touch.sy = 0; knob.style.transform = ''; };
  mv.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); mid = e.pointerId; try { mv.setPointerCapture(mid); } catch (_) {} setStick(e); });
  mv.addEventListener('pointermove', (e) => { if (e.pointerId === mid) setStick(e); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) mv.addEventListener(ev, endStick);

  const lk = $('droneLook');
  let lid = null, lx = 0, ly = 0;
  lk.addEventListener('pointerdown', (e) => { e.preventDefault(); lid = e.pointerId; lx = e.clientX; ly = e.clientY; try { lk.setPointerCapture(lid); } catch (_) {} });
  lk.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lid) return;
    touch.lx += e.clientX - lx; touch.ly += e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) lk.addEventListener(ev, () => { lid = null; });
}

export function createDrone({ scene, hud, isTouch }) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  let model = null;
  let mixer = null;
  const actions = [];
  const fallback = buildWeapon('drone', new THREE.Texture()).group;
  root.add(fallback);

  new GLTFLoader().load(MODEL_URL, (gltf) => {
    const g = gltf.scene;
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    g.position.sub(box.getCenter(new THREE.Vector3()));
    g.scale.setScalar(0.55 / Math.max(0.01, size.x, size.y, size.z));
    g.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    root.remove(fallback);
    root.add(g);
    model = g;

    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(g);
      for (const clip of gltf.animations) {
        const act = mixer.clipAction(clip);
        act.setLoop(THREE.LoopRepeat, Infinity);
        act.clampWhenFinished = false;
        act.play();
        actions.push(act);
      }
    } else {
      const rotors = [];
      g.traverse((o) => {
        const n = (o.name || '').toLowerCase();
        if (n.includes('rotor') || n.includes('prop') || n.includes('blade') || n.includes('spin')) {
          rotors.push(o);
        }
      });
      if (rotors.length) root.userData.spinRotors = rotors;
    }
  }, undefined, () => {
    hud.setMsg('Drone model failed to load, using a placeholder', 2000);
  });

  // prop-wash dust ring on the ground under the drone
  const dustTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 6, 64, 64, 62);
    gr.addColorStop(0, 'rgba(205,190,165,0)');
    gr.addColorStop(0.45, 'rgba(205,190,165,0.55)');
    gr.addColorStop(0.75, 'rgba(205,190,165,0.22)');
    gr.addColorStop(1, 'rgba(205,190,165,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.center.set(0.5, 0.5);
    return t;
  })();
  const dust = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  dust.rotation.x = -PI / 2;
  dust.visible = false;
  dust.renderOrder = 2;
  dust.frustumCulled = false;
  scene.add(dust);

  let phase = 'off', stowAnimSent = false;
  let t = 0;
  let view = 'first';
  let hp = HP;
  let battery = BATTERY;
  let yaw = 0, pitch = 0;
  const pos = new THREE.Vector3();
  const fromPos = new THREE.Vector3();
  let fromFov = 70, trY0 = 0, trY1 = 0;
  let fallSpeed = 0;
  let bodyX = 0, bodyY = 0, bodyZ = 0, bodyYaw = 0;
  let spinT = 0;
  // deploy state
  let placed = false, groundY = 0, dropY = 0, dropV = 0, bounced = false, liftY = 0;
  // rotors spin up / down smoothly instead of jumping between speeds
  let rotor = 0, rotorTo = 0, rotorRate = 2, spinAng = 0;
  const touch = { up: false, down: false, sx: 0, sy: 0, lx: 0, ly: 0 };
  if (isTouch) buildTouchBar(touch, () => toggleView(), () => recall());
  const setBar = (on) => document.body.classList.toggle('in-drone', on);

  /** ground (or the highest surface just below y) under a point */
  const groundAt = (x, z, y) => floorAt(x, z, y + 0.3, 0.3);

  function placeCamera(cam) {
    const f = forwardOf(yaw, pitch, _fwd);
    if (view === 'first') {
      // slightly behind / above so rotors and body stay visible in FP
      cam.position.copy(pos).addScaledVector(f, -0.18);
      cam.position.y += 0.1;
      _look.copy(pos).addScaledVector(f, 12);
    } else {
      cam.position.copy(pos).addScaledVector(f, -3.6).y += 1.35;
      _look.copy(pos).addScaledVector(f, 2.5);
    }
    cam.lookAt(_look);
  }

  function stepRotors(dt) {
    rotor = damp(rotor, rotorTo, rotorRate, dt);
    if (rotorTo === 0 && rotor < 0.004) rotor = 0;
    for (const a of actions) a.timeScale = rotor;
    const rs = root.userData.spinRotors;
    if (rs) {
      spinAng += dt * 30 * rotor;
      for (const r of rs) r.rotation.y = spinAng;
    }
  }

  /** small hover wobble that grows with how far off the ground it is */
  function hoverPose(amount, bankX = 0, bankZ = 0) {
    root.rotation.set(bankX + Math.sin(spinT * 2.3) * 0.018 * amount, yaw, bankZ + Math.sin(spinT * 1.7) * 0.022 * amount);
  }

  function updateDust() {
    if (!root.visible || !placed || rotor < 0.2) { dust.visible = false; return; }
    const gy = groundAt(pos.x, pos.z, pos.y);
    const h = Math.max(0, pos.y - gy);
    const a = Math.min(1, rotor) * (1 - Math.min(1, h / 3.5));
    if (a < 0.03) { dust.visible = false; return; }
    dust.visible = true;
    dust.position.set(pos.x, gy + 0.05, pos.z);
    const sc = 1.3 + h * 0.6;
    dust.scale.set(sc, sc, 1);
    dust.material.opacity = 0.4 * a;
    dustTex.rotation = spinT * 0.5;
  }

  function endFlight(msg) {
    phase = 'off';
    stowAnimSent = false;
    placed = false;
    setBar(false);
    root.visible = false;
    root.scale.setScalar(1);
    dust.visible = false;
    rotor = rotorTo = 0;
    stepRotors(0);
    if (msg) hud.setMsg(msg, 1800);
  }

  function begin(player) {
    if (phase !== 'off') return false;
    phase = 'deploy';
    t = 0;
    hp = HP;
    battery = BATTERY;
    view = 'first';
    yaw = player.yaw;
    pitch = 0;
    bodyX = player.x;
    bodyY = player.y;
    bodyZ = player.z;
    bodyYaw = player.yaw;
    placed = false;
    liftY = 0;
    const f = forwardOf(yaw, 0, _fwd);
    pos.set(player.x + f.x * 0.95, player.y + REST_H, player.z + f.z * 0.95);
    root.position.copy(pos);
    root.rotation.set(0, yaw, 0);
    root.scale.setScalar(1);
    root.visible = false;
    dust.visible = false;
    rotor = rotorTo = 0;
    stepRotors(0);
    setBar(false);
    return true;
  }

  /** the operator sets the drone on the ground: snap to the real ground height, short drop, one small bounce */
  function place() {
    placed = true;
    const f = forwardOf(bodyYaw, 0, _fwd);
    pos.x = bodyX + f.x * 0.95;
    pos.z = bodyZ + f.z * 0.95;
    groundY = groundAt(pos.x, pos.z, bodyY);
    dropY = SET_DOWN; dropV = 0; bounced = false; liftY = 0;
    pos.y = groundY + REST_H + dropY;
    root.position.copy(pos);
    root.rotation.set(0, bodyYaw, 0);
    root.scale.setScalar(1);
    root.visible = true;
    rotor = rotorTo = 0;
  }

  // The drone follows its own timer (same shared timings as the hand animation), so the rig events aren't needed.
  function onDeployEvent() {}

  function update(dt, player, keys, cam, look, stick) {
    if (phase === 'off') return;

    if (mixer) mixer.update(dt);
    spinT += dt;

    if (phase === 'deploy') {
      t += dt;
      if (!placed && t >= PLACE_T) place();
      if (placed) {
        // set down: short fall, one small bounce
        dropV += GRAV * dt;
        dropY -= dropV * dt;
        if (dropY <= 0) {
          dropY = 0;
          if (dropV > 1.4 && !bounced) { bounced = true; dropV = -dropV * 0.22; } else dropV = 0;
        }
        // after the second tap on the tablet: props spin up, then it lifts off the ground
        if (t >= TAP_T && rotorTo === 0) { rotorTo = 1; rotorRate = 1.7; }
        const lf = smoother((t - TAP_T - 0.45) / Math.max(0.1, DEPLOY_T - TAP_T - 0.45));
        liftY = LIFT * lf;
        pos.y = groundY + REST_H + dropY + liftY;
        root.position.copy(pos);
        hoverPose(lf);
      }
      stepRotors(dt);
      updateDust();
      if (t >= DEPLOY_T) {
        if (!placed) place();
        phase = 'trans';
        t = 0;
        fromPos.copy(cam.position);
        fromQ.copy(cam.quaternion);
        fromFov = cam.fov;
        trY0 = pos.y;
        trY1 = bodyY + 1.55;
        root.visible = true;
        rotorTo = 1.05; rotorRate = 2.2;
        setBar(true);
      }
      return;
    }

    if (phase === 'trans') {
      t += dt;
      const k = Math.min(1, t / TRANS_T);
      const s = smoother(k);
      pos.y = lerp(trY0, trY1, s);
      root.position.copy(pos);
      hoverPose(1);
      placeCamera(_dummy);
      cam.position.lerpVectors(fromPos, _dummy.position, s);
      cam.position.y += Math.sin(PI * s) * 0.2; // sweep over instead of sliding in a straight line
      cam.quaternion.slerpQuaternions(fromQ, _dummy.quaternion, s);
      cam.fov = lerp(fromFov, settings.fov, s) + 7 * Math.sin(PI * s);
      cam.updateProjectionMatrix();
      stepRotors(dt);
      updateDust();
      if (k >= 1) {
        phase = 'fly';
        cam.fov = settings.fov;
        cam.updateProjectionMatrix();
        setBar(true);
        rotorTo = 1.1; rotorRate = 3;
        hud.setMsg('Drone active. E to recall', 2200);
      }
      return;
    }

    if (phase === 'down') {
      fallSpeed += GRAV * dt;
      const floor = groundAt(pos.x, pos.z, pos.y) + 0.14;
      pos.y = Math.max(floor, pos.y - fallSpeed * dt);
      root.position.copy(pos);
      const air = pos.y > floor + 0.02;
      if (air) {
        root.rotation.z += dt * 6;
        root.rotation.x += dt * 2.2;
      }
      placeCamera(cam);
      t += dt;
      rotorTo = 0; rotorRate = 0.9;
      stepRotors(dt);
      updateDust();
      if (!air && t > 1.2) endFlight();
      return;
    }

    if (phase === 'stowing') {
      t += dt;
      rotorTo = 0; rotorRate = 1.8;
      stepRotors(dt);
      // keep the drone body visible in the world while the operator stows the tablet, then fold it away
      root.visible = true;
      const k = (t - (STOW_T - 0.4)) / 0.4;
      root.scale.setScalar(k > 0 ? Math.max(0.001, 1 - sstep(k)) : 1);
      updateDust();
      if (t >= STOW_T) {
        endFlight('Drone recalled');
      }
      return;
    }

    // free flight — match player look signs (yaw -= dx, pitch -= dy * invert)
    if (look || touch.lx || touch.ly) {
      const sens = 0.004 * (settings.sens || 1);
      const inv = settings.invertY ? -1 : 1;
      const dx = (look ? look.dx : 0) + touch.lx;
      const dy = (look ? look.dy : 0) + touch.ly;
      yaw -= dx * sens;
      pitch = Math.max(-1.25, Math.min(1.25, pitch - dy * sens * inv));
      touch.lx = touch.ly = 0;
    }

    let ix = stick.x + touch.sx, iz = stick.y + touch.sy, iy = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('Space') || touch.up) iy += 1;
    if (keys.has('KeyC') || touch.down) iy -= 1;

    forwardOf(yaw, 0, _fwd);
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    _mv.set(0, 0, 0).addScaledVector(_fwd, -iz).addScaledVector(_right, ix);
    if (_mv.lengthSq() > 1) _mv.normalize();
    _mv.multiplyScalar(MOVE);
    _mv.y = iy * VERT;
    rotorTo = _mv.lengthSq() > 0.01 ? 1.3 : 1.1;
    rotorRate = 3;

    battery -= dt;
    const dist = Math.hypot(pos.x - bodyX, pos.z - bodyZ);
    if (battery <= 0) {
      phase = 'down';
      fallSpeed = 0;
      t = 0;
      setBar(false);
      hud.setMsg('Drone battery empty', 1500);
      return;
    }

    const step = _mv.length() * dt;
    if (step > 1e-5) {
      const dx = _mv.x * dt / step, dy = _mv.y * dt / step, dz = _mv.z * dt / step;
      const w = raycastWorld(pos.x, pos.y, pos.z, dx, dy, dz, step + RADIUS);
      const blocked = w && w.t < step + RADIUS;
      if (!blocked) pos.addScaledVector(_mv, dt);
    }
    if (dist > LEASH) {
      const ax = bodyX - pos.x, az = bodyZ - pos.z;
      const k = (dist - LEASH) / dist;
      pos.x += ax * k;
      pos.z += az * k;
    }
    pos.y = Math.max(MIN_Y, Math.min(MAX_Y, pos.y));
    root.position.copy(pos);
    const bank = Math.max(-0.35, Math.min(0.35, ix * 0.28));
    const nose = Math.max(-0.22, Math.min(0.22, -iz * 0.12 + pitch * 0.15));
    root.rotation.set(nose, yaw, bank);
    stepRotors(dt);
    updateDust();
    placeCamera(cam);
  }

  function hitDistance(o, dir, maxT) {
    if (phase !== 'fly' && phase !== 'trans') return null;
    const ox = o.x - pos.x, oy = o.y - pos.y, oz = o.z - pos.z;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    const c = ox * ox + oy * oy + oz * oz - RADIUS * RADIUS;
    const disc = b * b - c;
    if (disc < 0) return null;
    const tt = -b - Math.sqrt(disc);
    if (tt < 0 || tt > maxT) return null;
    return tt;
  }

  function damage(amount) {
    if (phase !== 'fly') return;
    hp -= amount;
    if (hp <= 0) {
      phase = 'down';
      fallSpeed = 0;
      t = 0;
      setBar(false);
      hud.setMsg('Drone shot down', 1800);
    }
  }

  function recall() {
    if (phase === 'off' || phase === 'stowing') return;
    // while still in deploy (before control transfer) just cancel
    if (phase === 'deploy') {
      endFlight('Drone cancelled');
      return;
    }
    // flying / trans / down → put the tablet away, then close out
    phase = 'stowing';
    t = 0;
    stowAnimSent = false;
    setBar(false);
  }

  function toggleView() {
    if (phase === 'fly') view = view === 'first' ? 'third' : 'first';
  }

  return {
    begin,
    update,
    hitDistance,
    damage,
    recall,
    toggleView,
    onDeployEvent,
    isActive: () => phase !== 'off',
    isFlying: () => phase === 'fly',
    busy: () => phase !== 'off' && phase !== 'fly' && phase !== 'down',
    takesCamera: () => phase === 'trans' || phase === 'fly' || phase === 'down' || phase === 'stowing',
    wantsCrouch: () => phase === 'deploy' && t > DEPLOY.crouch[0] && t < DEPLOY.crouch[1],
    bodyPos: () => ({ x: bodyX, y: bodyY, z: bodyZ, yaw: bodyYaw }),
    hideHands: () => phase === 'trans' || phase === 'fly' || phase === 'down',
    isStowing: () => phase === 'stowing',
    /** true once when stowing begins so the player can start the put-away anim */
    needsStowAnim() {
      if (phase !== 'stowing' || stowAnimSent) return false;
      stowAnimSent = true;
      return true;
    },
    /** body should keep the tablet pose while the drone is out */
    wantsTabletHold: () => phase === 'fly' || phase === 'trans' || phase === 'down',
  };
}
