import * as THREE from 'three';

const canvas = document.getElementById('c');
const hpYouEl = document.getElementById('hpYou');
const hpEnemyEl = document.getElementById('hpEnemy');
const msgEl = document.getElementById('msg');
const startEl = document.getElementById('start');
const btnStart = document.getElementById('btnStart');

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('mobile');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a0b8);
scene.fog = new THREE.Fog(0x87a0b8, 40, 120);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);
const camPitch = new THREE.Object3D();
const head = new THREE.Object3D();
head.position.y = 1.6;
head.add(camPitch);
camPitch.add(camera);
scene.add(head);

scene.add(new THREE.HemisphereLight(0xddeeff, 0x334422, 1.1));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.2);
sun.position.set(30, 50, 10);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x3d5c3a, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function box(x, z, w, h, d, color) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color })
  );
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  scene.add(m);
}
box(-8, -6, 3, 2, 3, 0x6b5b4a);
box(10, -12, 4, 1.2, 2, 0x5a6a5a);
box(0, -20, 6, 1.5, 1.5, 0x4a5560);

const gun = new THREE.Group();
const gunBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.12, 0.12, 0.55),
  new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.4, roughness: 0.4 })
);
gunBody.position.set(0.22, -0.18, -0.45);
const barrel = new THREE.Mesh(
  new THREE.BoxGeometry(0.05, 0.05, 0.35),
  new THREE.MeshStandardMaterial({ color: 0x111113 })
);
barrel.position.set(0.22, -0.14, -0.78);
gun.add(gunBody, barrel);
camPitch.add(gun);

const player = {
  hp: 100, maxHp: 100, speed: 9, velY: 0, onGround: true,
  yaw: 0, pitch: 0, alive: true, fireCd: 0,
};
const keys = new Set();
const moveStick = { x: 0, y: 0 };
let stickTouchId = null, lookTouchId = null, firingMobile = false;
let lastLookX = null, lastLookY = null;

const enemy = { hp: 100, maxHp: 100, mesh: null, fireCd: 0, alive: true, hitFlash: 0 };
const enemyMat = new THREE.MeshStandardMaterial({ color: 0xb33a3a });
enemy.mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.9, 4, 8), enemyMat);
enemy.mesh.position.set(0, 1.1, -28);
enemy.mesh.castShadow = true;
scene.add(enemy.mesh);
const enemyGun = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.08, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x111 })
);
enemyGun.position.set(0.35, 0.2, -0.3);
enemy.mesh.add(enemyGun);

const bulletGeo = new THREE.SphereGeometry(0.06, 6, 6);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
const enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff5555 });
const bullets = [];
const raycaster = new THREE.Raycaster();
const _fwd = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _enemyAim = new THREE.Vector3();

function setMsg(t, ms = 1800) {
  msgEl.textContent = t || '';
  if (t && ms) setTimeout(() => { if (msgEl.textContent === t) msgEl.textContent = ''; }, ms);
}
function updateBars() {
  hpYouEl.style.transform = `scaleX(${Math.max(0, player.hp / player.maxHp)})`;
  hpEnemyEl.style.transform = `scaleX(${Math.max(0, enemy.hp / enemy.maxHp)})`;
}
function respawnPlayer() {
  player.hp = player.maxHp;
  player.alive = true;
  player.velY = 0;
  head.position.set(0, 1.6, 8);
  player.yaw = 0;
  player.pitch = 0;
  updateBars();
  setMsg('Respawned');
}
function resetEnemy() {
  enemy.hp = enemy.maxHp;
  enemy.alive = true;
  enemy.mesh.visible = true;
  enemy.mesh.position.set((Math.random() - 0.5) * 16, 1.1, -24 - Math.random() * 10);
  enemyMat.color.setHex(0xb33a3a);
  updateBars();
}
function spawnBullet(origin, dir, speed, fromEnemy) {
  const mesh = new THREE.Mesh(bulletGeo, fromEnemy ? enemyBulletMat : bulletMat);
  mesh.position.copy(origin);
  scene.add(mesh);
  bullets.push({ mesh, vel: dir.clone().normalize().multiplyScalar(speed), life: 1.2, fromEnemy: !!fromEnemy });
}

function playerShoot() {
  if (!player.alive || player.fireCd > 0) return;
  player.fireCd = 0.12;
  camera.getWorldDirection(_fwd);
  const origin = camera.getWorldPosition(_tmp.set(0, 0, 0));
  spawnBullet(origin.clone().add(_fwd.clone().multiplyScalar(0.6)), _fwd, 80, false);
  raycaster.set(origin, _fwd);
  if (enemy.alive) {
    const hits = raycaster.intersectObject(enemy.mesh, true);
    if (hits.length && hits[0].distance < 90) {
      enemy.hp -= 18;
      enemy.hitFlash = 0.12;
      if (enemy.hp <= 0) {
        enemy.hp = 0;
        enemy.alive = false;
        enemy.mesh.visible = false;
        setMsg('Target down — new hostile inbound', 2200);
        setTimeout(resetEnemy, 2200);
      }
      updateBars();
    }
  }
  player.pitch = Math.max(-1.4, player.pitch - 0.02);
}

function enemyShoot(dt) {
  if (!enemy.alive || !player.alive) return;
  enemy.fireCd -= dt;
  const ep = enemy.mesh.position;
  const pp = head.position;
  enemy.mesh.lookAt(pp.x, ep.y, pp.z);
  const dist = ep.distanceTo(pp);
  if (dist > 55 || dist < 2) return;
  if (enemy.fireCd > 0) return;
  enemy.fireCd = 0.55 + Math.random() * 0.25;
  _enemyAim.subVectors(pp, ep).normalize();
  _enemyAim.x += (Math.random() - 0.5) * 0.08;
  _enemyAim.y += (Math.random() - 0.5) * 0.05;
  _enemyAim.z += (Math.random() - 0.5) * 0.08;
  _enemyAim.normalize();
  const muzzle = ep.clone().add(new THREE.Vector3(0, 0.4, 0)).add(_enemyAim.clone().multiplyScalar(0.8));
  spawnBullet(muzzle, _enemyAim, 42, true);
  raycaster.set(muzzle, _enemyAim);
  const toHead = _tmp.copy(pp).sub(muzzle);
  const t = toHead.dot(_enemyAim);
  if (t > 0 && t < 70) {
    const closest = muzzle.clone().addScaledVector(_enemyAim, t);
    if (closest.distanceTo(pp) < 0.65) {
      player.hp -= 12;
      if (player.hp <= 0) {
        player.hp = 0;
        player.alive = false;
        updateBars();
        setMsg('You were dropped — respawning…', 2000);
        setTimeout(respawnPlayer, 2000);
      } else updateBars();
    }
  }
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    if (b.life <= 0 || b.mesh.position.y < 0) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
    }
  }
}

addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('click', () => {
  if (isTouch) return;
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  else playerShoot();
});
addEventListener('mousedown', (e) => {
  if (isTouch || document.pointerLockElement !== canvas) return;
  if (e.button === 0) playerShoot();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0022;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
});

const stick = document.getElementById('stick');
const knob = document.getElementById('knob');
const lookZone = document.getElementById('lookZone');
const btnFire = document.getElementById('btnFire');
const btnJump = document.getElementById('btnJump');

function stickFromTouch(clientX, clientY) {
  const r = stick.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = (clientX - cx) / (r.width / 2), dy = (clientY - cy) / (r.height / 2);
  const mag = Math.hypot(dx, dy) || 1;
  if (mag > 1) { dx /= mag; dy /= mag; }
  moveStick.x = dx; moveStick.y = dy;
  knob.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
}

stick.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  stickTouchId = t.identifier;
  stickFromTouch(t.clientX, t.clientY);
}, { passive: false });
stick.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === stickTouchId) stickFromTouch(t.clientX, t.clientY);
  }
}, { passive: false });

lookZone.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  lookTouchId = t.identifier;
  lastLookX = t.clientX; lastLookY = t.clientY;
}, { passive: false });
lookZone.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== lookTouchId) continue;
    if (lastLookX != null) {
      player.yaw -= (t.clientX - lastLookX) * 0.005;
      player.pitch -= (t.clientY - lastLookY) * 0.005;
      player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
    }
    lastLookX = t.clientX; lastLookY = t.clientY;
  }
}, { passive: false });

function endTouch(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === stickTouchId) {
      stickTouchId = null; moveStick.x = 0; moveStick.y = 0;
      knob.style.transform = 'translate(0,0)';
    }
    if (t.identifier === lookTouchId) {
      lookTouchId = null; lastLookX = lastLookY = null;
    }
  }
}
addEventListener('touchend', endTouch);
addEventListener('touchcancel', endTouch);

btnFire.addEventListener('touchstart', (e) => { e.preventDefault(); firingMobile = true; playerShoot(); }, { passive: false });
btnFire.addEventListener('touchend', () => { firingMobile = false; });
btnJump.addEventListener('touchstart', (e) => { e.preventDefault(); keys.add('Space'); }, { passive: false });
btnJump.addEventListener('touchend', () => keys.delete('Space'));

function updatePlayer(dt) {
  head.rotation.y = player.yaw;
  camPitch.rotation.x = player.pitch;
  if (!player.alive) return;
  let ix = 0, iz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  ix += moveStick.x; iz += moveStick.y;
  const len = Math.hypot(ix, iz);
  if (len > 1) { ix /= len; iz /= len; }
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  head.position.x += (ix * cos + iz * sin) * player.speed * dt;
  head.position.z += (-ix * sin + iz * cos) * player.speed * dt;
  head.position.x = Math.max(-90, Math.min(90, head.position.x));
  head.position.z = Math.max(-90, Math.min(90, head.position.z));
  if (player.onGround && keys.has('Space')) { player.velY = 7; player.onGround = false; }
  player.velY -= 18 * dt;
  head.position.y += player.velY * dt;
  if (head.position.y <= 1.6) { head.position.y = 1.6; player.velY = 0; player.onGround = true; }
  player.fireCd = Math.max(0, player.fireCd - dt);
  if (firingMobile) playerShoot();
}

let last = performance.now();
let running = false;
function frame(now) {
  requestAnimationFrame(frame);
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updatePlayer(dt);
  if (enemy.hitFlash > 0) {
    enemy.hitFlash -= dt;
    enemyMat.color.setHex(enemy.hitFlash > 0 ? 0xff8888 : 0xb33a3a);
  }
  enemyShoot(dt);
  updateBullets(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

btnStart.addEventListener('click', async () => {
  startEl.style.display = 'none';
  running = true;
  last = performance.now();
  updateBars();
  if (!isTouch) { try { await canvas.requestPointerLock(); } catch (_) {} }
  setMsg(isTouch ? 'Move · look · fire' : 'Click to shoot', 2000);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
});

head.position.set(0, 1.6, 8);
updateBars();
