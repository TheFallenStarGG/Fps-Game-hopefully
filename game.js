import * as THREE from 'three';
import { createWorld } from './lib/scene.js';
import { makeHumanoid } from './lib/humanoid.js';
import { createBulletSystem } from './lib/weapons.js';
import { createHud } from './lib/hud.js';
import { createInput } from './lib/input.js';
import { createPlayerState, createPlayerController } from './lib/player.js';
import { createEnemy, updateEnemy } from './lib/enemy.js';
import { colliders } from './lib/collision.js';

const canvas = document.getElementById('c');
const startEl = document.getElementById('start');
const btnStart = document.getElementById('btnStart');

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('mobile');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;

const scene = createWorld(THREE);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 200);
scene.add(camera);

const playerMesh = makeHumanoid(THREE, 0x3d6b9a, 0x1e2a38, true);
scene.add(playerMesh);

const viewmodel = playerMesh.userData.viewmodel;
if (viewmodel) {
  camera.add(viewmodel);
  viewmodel.visible = false;
  viewmodel.position.set(0, 0, 0);
  viewmodel.rotation.set(0, 0, 0);
}

const enemyMesh = makeHumanoid(THREE, 0x8b2e2e, 0x2a1515, false);
scene.add(enemyMesh);

const player = createPlayerState();
const enemy = createEnemy(enemyMesh);
const bullets = createBulletSystem(THREE, scene);
const hud = createHud();
const raycaster = new THREE.Raycaster();
const keys = new Set();
const moveStick = { x: 0, y: 0 };
let firingMobile = false;

const ctrl = createPlayerController({
  THREE, camera, playerMesh, player, keys, moveStick,
  isTouch,
  getFiringMobile: () => firingMobile,
  bullets, hud, enemy, raycaster,
});

function onPlayerHit(dmg) {
  player.hp -= dmg;
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    player.ads = false;
    hud.update(player, enemy);
    hud.setMsg('You were dropped — respawning…', 2000);
    setTimeout(() => ctrl.respawn(), 2000);
  } else {
    hud.update(player, enemy);
  }
}

createInput(canvas, {
  isTouch,
  keys,
  moveStick,
  onShoot: () => ctrl.shoot(),
  onReload: () => ctrl.startReload(),
  onToggleCamera: () => {
    ctrl.toggleCamera();
    if (viewmodel) viewmodel.visible = !player.thirdPerson;
  },
  onToggleAim: () => ctrl.toggleAim(),
  getPlayer: () => player,
  setFiringMobile: (v) => { firingMobile = v; },
});

if (viewmodel) viewmodel.visible = false;

let last = performance.now();
let running = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  ctrl.update(dt);
  updateEnemy(dt, t, enemy, player, THREE, bullets, raycaster, hud, onPlayerHit);
  bullets.update(dt, colliders, 0);
  if (viewmodel) {
    const showFp = !player.thirdPerson && player.alive;
    viewmodel.visible = showFp;
    if (showFp && viewmodel.parent !== camera) camera.add(viewmodel);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

btnStart.addEventListener('click', async () => {
  startEl.style.display = 'none';
  running = true;
  last = performance.now();
  hud.update(player, enemy);
  if (!isTouch) { try { await canvas.requestPointerLock(); } catch (_) {} }
  hud.setMsg(
    isTouch
      ? 'Stick · look · fire · AIM toggles · reload · CAM'
      : 'V cam · RMB toggle aim · R reload',
    2800
  );
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
});

hud.update(player, enemy);
