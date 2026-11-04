/**
 * Scout drone: deploy sequence, free flight with first / third person views, shoot-down and recall.
 * The player's body stays where it was deployed and is controlled by the normal player code while the drone is out.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { raycastWorld } from './collision.js';
import { buildWeapon } from './weaponModels.js';

const DEPLOY_T = 5.2, TRANS_T = 0.9, HP = 60, RADIUS = 0.45, BATTERY = 90, LEASH = 70;
const MOVE = 9, VERT = 5, GRAV = 9.8, MAX_Y = 40, MIN_Y = 0.4;
const MODEL_URL = new URL('../assets/survey-drone-7c71f9.glb', import.meta.url).href;

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _mv = new THREE.Vector3();
const _look = new THREE.Vector3(), _toPos = new THREE.Vector3(), _toQ = new THREE.Quaternion();
const _dummy = new THREE.PerspectiveCamera();

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
  const fallback = buildWeapon('drone', new THREE.Texture()).group;
  root.add(fallback);
  new GLTFLoader().load(MODEL_URL, (gltf) => {
    const g = gltf.scene;
    const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3());
    g.position.sub(box.getCenter(new THREE.Vector3()));
    g.scale.setScalar(0.6 / Math.max(0.01, size.x, size.y, size.z));
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    root.remove(fallback);
    root.add(g);
  }, undefined, () => {
    hud.setMsg('Drone model failed to load, using a placeholder', 2000);
  });

  let phase = 'off';
  let t = 0;
  let view = 'first';
  let hp = HP;
  let battery = BATTERY;
  let yaw = 0, pitch = 0;
  const pos = new THREE.Vector3();
  const fromPos = new THREE.Vector3(), fromQ = new THREE.Quaternion();
  let fallSpeed = 0;
  let bodyX = 0, bodyZ = 0;
  const touch = { up: false, down: false, sx: 0, sy: 0, lx: 0, ly: 0 };
  if (isTouch) buildTouchBar(touch, () => toggleView(), () => recall());
  const setBar = (on) => document.body.classList.toggle('in-drone', on);

  function placeCamera(cam) {
    const f = forwardOf(yaw, pitch, _fwd);
    if (view === 'first') {
      cam.position.copy(pos).addScaledVector(f, 0.25);
      _look.copy(pos).addScaledVector(f, 10);
    } else {
      cam.position.copy(pos).addScaledVector(f, -3.2).y += 1.1;
      _look.copy(pos).addScaledVector(f, 2);
    }
    cam.lookAt(_look);
  }

  function endFlight(msg) {
    phase = 'off';
    setBar(false);
    root.visible = false;
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
    bodyZ = player.z;
    const f = forwardOf(yaw, 0, _fwd);
    pos.set(player.x + f.x * 1.1, player.y + 0.9, player.z + f.z * 1.1);
    root.position.copy(pos);
    root.rotation.set(0, yaw, 0);
    setBar(true);
    root.visible = true;
    return true;
  }

  function update(dt, player, keys, cam, look, stick) {
    if (phase === 'off') return;
    if (phase === 'deploy') {
      t += dt;
      if (t >= DEPLOY_T) {
        phase = 'trans';
        t = 0;
        fromPos.copy(cam.position);
        fromQ.copy(cam.quaternion);
        pos.y = player.y + 1.6;
        root.position.copy(pos);
      }
      return;
    }
    if (phase === 'trans') {
      t += dt;
      const k = Math.min(1, t / TRANS_T), s = k * k * (3 - 2 * k);
      placeCamera(_dummy);
      _toPos.copy(_dummy.position);
      _toQ.copy(_dummy.quaternion);
      cam.position.lerpVectors(fromPos, _toPos, s);
      cam.quaternion.slerpQuaternions(fromQ, _toQ, s);
      if (k >= 1) { phase = 'fly'; setBar(true); hud.setMsg('Drone active. E to recall', 2200); }
      return;
    }
    if (phase === 'down') {
      fallSpeed += GRAV * dt;
      pos.y = Math.max(MIN_Y, pos.y - fallSpeed * dt);
      root.position.copy(pos);
      root.rotation.z += dt * 6;
      placeCamera(cam);
      t += dt;
      if (pos.y <= MIN_Y + 0.01 && t > 1.2) endFlight();
      return;
    }

    if (look || touch.lx || touch.ly) {
      yaw += ((look ? look.dx : 0) + touch.lx) * 0.004;
      pitch = Math.max(-1.2, Math.min(1.2, pitch - ((look ? look.dy : 0) + touch.ly) * 0.004));
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

    battery -= dt;
    const dist = Math.hypot(pos.x - bodyX, pos.z - bodyZ);
    if (battery <= 0) { phase = 'down'; fallSpeed = 0; t = 0; setBar(false); hud.setMsg('Drone battery empty', 1500); return; }

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
      pos.x += ax * k; pos.z += az * k;
    }
    pos.y = Math.max(MIN_Y, Math.min(MAX_Y, pos.y));
    root.position.copy(pos);
    root.rotation.set(0, yaw, 0);
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
    if (phase === 'off') return;
    endFlight('Drone recalled');
  }

  function toggleView() { if (phase === 'fly') view = view === 'first' ? 'third' : 'first'; }

  return {
    begin,
    update,
    hitDistance,
    damage,
    recall,
    toggleView,
    isActive: () => phase !== 'off',
    isFlying: () => phase === 'fly',
    busy: () => phase !== 'off' && phase !== 'fly' && phase !== 'down',
    takesCamera: () => phase === 'trans' || phase === 'fly' || phase === 'down',
    wantsCrouch: () => phase === 'deploy' && t > 1.7 && t < 2.7,
  };
}
