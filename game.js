import * as THREE from 'three';
import { createWorld } from './lib/scene.js';
import { makeHumanoid } from './lib/humanoid.js';
import { createBulletSystem } from './lib/weapons.js';
import { createHud } from './lib/hud.js';
import { createInput } from './lib/input.js';
import { createPlayerState, createPlayerController } from './lib/player.js';
import { createEnemy, updateEnemy } from './lib/enemy.js';
import { colliders } from './lib/collision.js';
import { createNet, WORKER_URL } from './lib/net.js';

const canvas = document.getElementById('c');
const startEl = document.getElementById('lobby');
const btnJoin = document.getElementById('btnJoin');
const btnSolo = document.getElementById('btnSolo');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const lobbyStatus = document.getElementById('lobbyStatus');
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const playerListEl = document.getElementById('playerList');

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

/** @type {'solo'|'multi'} */
let mode = 'solo';
const remotes = new Map();

const net = createNet({
  onWelcome(msg) {
    lobbyStatus.textContent = 'Connected';
    startEl.style.display = 'none';
    running = true;
    last = performance.now();
    hud.update(player, enemy);
    if (msg.players) {
      for (const p of msg.players) addRemote(p);
    }
    if (msg.chat) {
      chatLog.innerHTML = '';
      for (const c of msg.chat) appendChat(c);
    }
    net.startStateLoop(() => player);
    player.x = (Math.random() - 0.5) * 10;
    player.z = 6 + Math.random() * 4;
    hud.setMsg('Multiplayer — fight + chat', 2500);
    if (!isTouch) {
      try { canvas.requestPointerLock(); } catch (_) {}
    }
    refreshPlayerList();
  },
  onJoin(p) {
    addRemote(p);
    refreshPlayerList();
  },
  onLeave(id) {
    removeRemote(id);
    refreshPlayerList();
  },
  onState(msg) {
    const r = remotes.get(msg.id);
    if (!r) return;
    r.x = msg.x; r.z = msg.z; r.yaw = msg.yaw;
    r.hp = msg.hp; r.alive = msg.alive; r.ads = msg.ads;
    r.mesh.position.set(msg.x, 0, msg.z);
    r.mesh.rotation.y = msg.yaw;
    r.mesh.visible = !!msg.alive;
  },
  onShoot(msg) {
    if (msg.ox == null) return;
    const origin = new THREE.Vector3(msg.ox, msg.oy, msg.oz);
    const dir = new THREE.Vector3(msg.dx, msg.dy, msg.dz).normalize();
    bullets.spawn(origin, dir, 90, true);
    bullets.muzzleFlash(origin.clone());
  },
  onDamage(msg) {
    player.hp = msg.hp;
    player.alive = msg.alive;
    if (!player.alive) {
      player.ads = false;
      hud.setMsg('You were eliminated', 2000);
    }
    hud.update(player, enemy);
  },
  onHp(msg) {
    const r = remotes.get(msg.id);
    if (r) {
      r.hp = msg.hp;
      r.alive = msg.alive;
      r.mesh.visible = !!msg.alive;
    }
    refreshPlayerList();
  },
  onChat(msg) {
    appendChat(msg);
  },
  onRespawnIn(ms) {
    setTimeout(() => {
      net.sendRespawn();
      player.hp = 100;
      player.alive = true;
      player.x = (Math.random() - 0.5) * 12;
      player.z = 4 + Math.random() * 8;
      player.ads = false;
      hud.update(player, enemy);
      hud.setMsg('Respawned');
    }, ms || 2000);
  },
  onClose() {
    if (mode === 'multi') {
      lobbyStatus.textContent = 'Disconnected';
      startEl.style.display = 'flex';
      running = false;
      net.stopStateLoop();
    }
  },
  onError() {
    lobbyStatus.textContent = 'Connection error — check WORKER_URL in lib/net.js';
  },
});

function addRemote(p) {
  if (!p || remotes.has(p.id)) return;
  const mesh = makeHumanoid(THREE, 0x4a8f5c, 0x1e3020, false);
  mesh.position.set(p.x || 0, 0, p.z || 0);
  scene.add(mesh);
  remotes.set(p.id, {
    mesh,
    name: p.name || 'Player',
    x: p.x || 0,
    z: p.z || 0,
    yaw: p.yaw || 0,
    hp: p.hp ?? 100,
    alive: p.alive !== false,
  });
}

function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.mesh);
  remotes.delete(id);
}

function appendChat(msg) {
  const div = document.createElement('div');
  if (msg.id === 'system' || msg.name === 'System') {
    div.className = 'sys';
    div.textContent = msg.text;
  } else {
    div.innerHTML = `<span class="name">${escapeHtml(msg.name)}</span>: ${escapeHtml(msg.text)}`;
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function refreshPlayerList() {
  const lines = [`You (${Math.round(player.hp)}hp)`];
  for (const r of remotes.values()) {
    lines.push(`${r.name} (${Math.round(r.hp)}hp)${r.alive ? '' : ' ✖'}`);
  }
  playerListEl.textContent = mode === 'multi' ? lines.join('\n') : '';
}

const ctrl = createPlayerController({
  THREE, camera, playerMesh, player, keys, moveStick,
  isTouch,
  getFiringMobile: () => firingMobile,
  bullets, hud, enemy, raycaster,
  onLocalShoot: (info) => {
    if (mode !== 'multi' || !net.isConnected()) return;
    net.sendShoot({
      ox: info.origin.x,
      oy: info.origin.y,
      oz: info.origin.z,
      dx: info.dir.x,
      dy: info.dir.y,
      dz: info.dir.z,
      targetId: info.targetId || null,
      dmg: info.dmg || 16,
    });
  },
  getRemotes: () => remotes,
  isMulti: () => mode === 'multi',
});

function onPlayerHit(dmg) {
  if (mode === 'multi') return;
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

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  if (mode === 'multi' && net.isConnected()) {
    net.sendChat(text);
  } else {
    appendChat({ id: 'local', name: 'You', text });
  }
  chatInput.value = '';
  chatInput.blur();
  if (!isTouch) {
    try { canvas.requestPointerLock(); } catch (_) {}
  }
});

addEventListener('keydown', (e) => {
  if (e.code === 'KeyT' && document.activeElement !== chatInput) {
    e.preventDefault();
    chatInput.focus();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  if (e.code === 'Escape' && document.activeElement === chatInput) {
    chatInput.blur();
  }
});

let last = performance.now();
let running = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  ctrl.update(dt);
  if (mode === 'solo') {
    updateEnemy(dt, t, enemy, player, THREE, bullets, raycaster, hud, onPlayerHit);
  } else {
    enemy.mesh.visible = false;
  }
  bullets.update(dt, colliders, 0);
  if (viewmodel) {
    const showFp = !player.thirdPerson && player.alive;
    viewmodel.visible = showFp;
    if (showFp && viewmodel.parent !== camera) camera.add(viewmodel);
  }
  if (mode === 'multi') refreshPlayerList();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

btnJoin.addEventListener('click', () => {
  const name = (nameInput.value || 'Player').trim().slice(0, 20);
  const room = (roomInput.value || 'lobby').trim().toLowerCase().slice(0, 24);
  if (WORKER_URL.includes('YOUR_SUBDOMAIN')) {
    lobbyStatus.textContent = 'Edit WORKER_URL in lib/net.js first (deploy worker)';
    return;
  }
  mode = 'multi';
  enemy.mesh.visible = false;
  lobbyStatus.textContent = 'Connecting…';
  net.connect(room, name);
});

btnSolo.addEventListener('click', () => {
  mode = 'solo';
  enemy.mesh.visible = true;
  startEl.style.display = 'none';
  running = true;
  last = performance.now();
  hud.update(player, enemy);
  if (!isTouch) {
    try { canvas.requestPointerLock(); } catch (_) {}
  }
  hud.setMsg('Solo vs AI', 2000);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
});

hud.update(player, enemy);
