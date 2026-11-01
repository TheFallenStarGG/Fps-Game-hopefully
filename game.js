/** Realm Range — bootstrap: renderer (world pass + viewmodel pass), solo bots, multiplayer remotes, menus */
import * as THREE from 'three';
import { settings, saveSettings } from './lib/settings.js';
import { createTextures } from './lib/textures.js';
import { createAudio } from './lib/audio.js';
import { createWorld } from './lib/scene.js';
import { makeHumanoid, makeViewmodel } from './lib/humanoid.js';
import { createBulletSystem } from './lib/weapons.js';
import { createHud } from './lib/hud.js';
import { createInput } from './lib/input.js';
import { createPlayerState, createPlayerController } from './lib/player.js';
import { createEnemy, updateEnemy, respawnEnemy } from './lib/enemy.js';
import { updateHumanoidAnim, triggerShootKick } from './lib/anim.js';
import { createNet, WORKER_URL } from './lib/net.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const lobby = $('lobby'), panel = $('panel');
const btnJoin = $('btnJoin'), btnSolo = $('btnSolo'), btnSettings = $('btnSettings');
const btnResume = $('btnResume'), btnLeave = $('btnLeave'), btnPause = $('btnPause');
const nameInput = $('nameInput'), roomInput = $('roomInput'), lobbyStatus = $('lobbyStatus');
const chatLog = $('chatLog'), chatForm = $('chatForm'), chatInput = $('chatInput'), playerListEl = $('playerList');

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('mobile');

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
};
nameInput.value = store.get('rr.name', '');
roomInput.value = store.get('rr.room', '');

let mode = 'solo', running = false, panelOpen = false;
let myName = 'Player', currentRoom = 'lobby';
let last = performance.now(), fpsT = 0, fpsN = 0, listT = 0;
const chatFocused = () => document.activeElement === chatInput;
const lockPointer = () => { if (!isTouch) { try { canvas.requestPointerLock(); } catch (_) {} } };

// ---------- renderer / world ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.autoClear = false;

const tex = createTextures();
const audio = createAudio(settings);
audio.setVolume(settings.volume);
const world = createWorld(renderer, tex);
const scene = world.scene;
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 400);
scene.add(camera);

// viewmodel renders in its own scene with a fixed FOV (no growing gun when aiming, no wall clipping)
const vmScene = new THREE.Scene();
vmScene.environment = scene.environment;
vmScene.environmentIntensity = 0.9;
vmScene.add(new THREE.HemisphereLight(0xdde8ff, 0x5a5040, 1.0));
const vmSun = new THREE.DirectionalLight(0xfff0d8, 2.2);
vmSun.position.set(0.6, 1, 0.5);
vmScene.add(vmSun);
const vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);

const hud = createHud();
const bullets = createBulletSystem(scene, tex, {
  onLand: (kind, x, y, z) => audio.play(kind === 'mag' ? 'magDrop' : 'shell', x, z),
  onWhiz: () => audio.play('whiz'),
});

const playerMesh = makeHumanoid(tex, 'player');
playerMesh.visible = false;
scene.add(playerMesh);
const viewmodel = makeViewmodel(tex);
viewmodel.visible = false;
vmScene.add(viewmodel);

const player = createPlayerState();
const enemies = [];
const remotes = new Map();

// ---------- input + controller ----------
const input = createInput(canvas, {
  isTouch,
  getPlayer: () => player,
  isActive: () => running && !panelOpen && !chatFocused(),
  onReload: () => ctrl.startReload(),
  onToggleCamera: () => ctrl.toggleCamera(),
  onAim: (down) => ctrl.setAim(down),
});

const ctrl = createPlayerController({
  camera, playerMesh, viewmodel, player, input, bullets, hud, audio,
  getEnemies: () => (mode === 'solo' ? enemies : []),
  getRemotes: () => remotes,
  isMulti: () => mode === 'multi',
  onLocalShoot: (i) => {
    if (!net.isConnected()) return;
    net.sendShoot({
      ox: i.origin.x, oy: i.origin.y, oz: i.origin.z,
      dx: i.dir.x, dy: i.dir.y, dz: i.dir.z,
      targetId: i.targetId || null, dmg: i.dmg,
    });
  },
});

// ---------- solo bots ----------
const enemyCtx = {
  bullets, audio, hud, player, enemies,
  onPlayerHit: (dmg, sx, sz, zone, name) => {
    if (mode === 'solo' && running) ctrl.applyDamage(dmg, sx, sz, name);
  },
};
for (let i = 0; i < 3; i++) {
  const m = makeHumanoid(tex, 'enemy');
  m.visible = false;
  scene.add(m);
  enemies.push(createEnemy(m, enemyCtx, i));
  m.visible = false;
}
function setEnemiesActive(on) {
  for (const e of enemies) {
    if (on) respawnEnemy(e);
    else e.mesh.visible = false;
  }
}

// ---------- multiplayer ----------
function addRemote(p) {
  if (!p || remotes.has(p.id)) return;
  const mesh = makeHumanoid(tex, 'remote');
  scene.add(mesh);
  const x = p.x || 0, z = p.z || 0, yaw = p.yaw || 0;
  mesh.position.set(x, 0, z);
  remotes.set(p.id, {
    id: p.id, mesh, name: p.name || 'Player',
    x, z, tx: x, tz: z, px: x, pz: z, yaw, tyaw: yaw, pitch: p.pitch || 0,
    hp: p.hp ?? 100, alive: p.alive !== false, ads: !!p.ads, speed: 0,
    flash: bullets.attachFlash(mesh.userData.muzzle, 0.55),
  });
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.mesh);
  remotes.delete(id);
}
function clearRemotes() {
  for (const id of [...remotes.keys()]) removeRemote(id);
}

function updateRemotes(dt) {
  for (const r of remotes.values()) {
    const dx = r.tx - r.x, dz = r.tz - r.z;
    if (Math.hypot(dx, dz) > 8) { r.x = r.tx; r.z = r.tz; }
    else { const k = Math.min(1, dt * 14); r.x += dx * k; r.z += dz * k; }
    let dy = r.tyaw - r.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.yaw += dy * Math.min(1, dt * 14);
    const sp = Math.hypot(r.x - r.px, r.z - r.pz) / Math.max(dt, 1e-3);
    r.px = r.x; r.pz = r.z;
    r.speed += (Math.min(sp, 12) - r.speed) * Math.min(1, dt * 8);
    r.mesh.position.set(r.x, 0, r.z);
    r.mesh.rotation.y = r.yaw;
    updateHumanoidAnim(r.mesh.userData, {
      dt, moving: r.speed > 0.4, speed: r.speed, grounded: true, ads: r.ads, sprint: r.speed > 7,
      crouch: false, pitch: r.pitch, reloading: false, dead: !r.alive,
      onStep: () => audio.play('step', r.x, r.z, { vol: 0.6 }),
    });
  }
}

function refreshPlayerList() {
  if (mode !== 'multi') { playerListEl.textContent = ''; return; }
  const lines = [`You — ${Math.round(player.hp)} hp`];
  for (const r of remotes.values()) lines.push(`${r.name} — ${r.alive ? Math.round(r.hp) + ' hp' : 'down'}`);
  playerListEl.textContent = lines.join('\n');
}

function onKillMsg(k, v) {
  hud.addKill(k === myName ? 'You' : k, v === myName ? 'You' : v, false);
  if (k === myName && v !== myName) {
    player.kills++;
    hud.setScore(player.kills, player.deaths);
    hud.hitMarker('kill');
    audio.play('kill');
  }
}

function appendChat(msg, quiet) {
  const div = document.createElement('div');
  if (msg.id === 'system' || msg.name === 'System') {
    div.className = 'sys';
    div.textContent = msg.text;
    if (!quiet) {
      const m = /^(.+) eliminated (.+)$/.exec(msg.text);
      if (m) onKillMsg(m[1], m[2]);
    }
  } else {
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = msg.name;
    div.append(n, ': ' + msg.text);
  }
  chatLog.appendChild(div);
  while (chatLog.children.length > 60) chatLog.firstChild.remove();
  chatLog.scrollTop = chatLog.scrollHeight;
}

const net = createNet({
  onWelcome(msg) {
    lobbyStatus.textContent = 'Connected';
    startRun();
    for (const p of msg.players || []) addRemote(p);
    chatLog.textContent = '';
    for (const c of msg.chat || []) appendChat(c, true);
    player.kills = player.deaths = 0;
    hud.setScore(0, 0);
    ctrl.respawn();
    net.startStateLoop(() => player);
    hud.setMsg(`Room “${currentRoom}” — fight + chat`, 2500);
    lockPointer();
    refreshPlayerList();
  },
  onJoin(p) { addRemote(p); refreshPlayerList(); },
  onLeave(id) { removeRemote(id); refreshPlayerList(); },
  onState(msg) {
    const r = remotes.get(msg.id);
    if (!r) return;
    r.tx = msg.x; r.tz = msg.z; r.tyaw = msg.yaw; r.pitch = msg.pitch || 0;
    r.hp = msg.hp; r.alive = msg.alive; r.ads = !!msg.ads;
  },
  onShoot(msg) {
    if (msg.ox == null) return;
    const o = new THREE.Vector3(msg.ox, msg.oy, msg.oz);
    const d = new THREE.Vector3(msg.dx, msg.dy, msg.dz).normalize();
    const r = remotes.get(msg.id);
    if (r) { r.flash.fire(); triggerShootKick(r.mesh.userData); }
    else bullets.muzzleFlash(o);
    bullets.spawn(o, d, 230, true);
    audio.play('shot', o.x, o.z, { enemy: true });
  },
  onDamage(msg) {
    const src = remotes.get(msg.from);
    ctrl.syncHp(msg.hp, msg.alive, src ? src.x : undefined, src ? src.z : undefined);
  },
  onHp(msg) {
    const r = remotes.get(msg.id);
    if (r) { r.hp = msg.hp; r.alive = msg.alive; }
    refreshPlayerList();
  },
  onChat(msg) { appendChat(msg); },
  onRespawnIn(ms) { ctrl.queueRespawn(ms || 2000, () => net.sendRespawn()); },
  onClose() {
    if (mode === 'multi' && running) {
      clearRemotes();
      showLobby('Disconnected');
    }
  },
  onError() { lobbyStatus.textContent = 'Connection error — check WORKER_URL in lib/net.js'; },
});

// ---------- lobby / panel / run state ----------
function startRun() {
  running = true;
  last = performance.now();
  lobby.classList.add('hide');
  input.clear();
}
function showLobby(status) {
  running = false;
  panelOpen = false;
  panel.classList.remove('on');
  lobby.classList.remove('hide');
  lobbyStatus.textContent = status || '';
  input.clear();
  playerMesh.visible = false;
  viewmodel.visible = false;
  for (const e of enemies) e.mesh.visible = false;
  hud.setRespawn(null);
  if (document.pointerLockElement) document.exitPointerLock();
}
function openPanel(fromLobby) {
  panelOpen = true;
  input.clear();
  panel.classList.add('on');
  panel.classList.toggle('lobby', !!fromLobby);
  btnResume.textContent = fromLobby ? 'Back' : 'Resume';
}
function closePanel() {
  panelOpen = false;
  panel.classList.remove('on');
  if (running) lockPointer();
}

btnSettings.addEventListener('click', () => openPanel(true));
btnResume.addEventListener('click', closePanel);
btnPause.addEventListener('click', () => { if (running) openPanel(false); });
btnLeave.addEventListener('click', () => {
  running = false;
  net.disconnect();
  clearRemotes();
  mode = 'solo';
  showLobby('');
});
document.addEventListener('pointerlockchange', () => {
  if (isTouch) return;
  if (document.pointerLockElement !== canvas && running && !panelOpen && !chatFocused()) openPanel(false);
});

btnSolo.addEventListener('click', () => {
  audio.unlock();
  mode = 'solo';
  clearRemotes();
  player.kills = player.deaths = 0;
  hud.setScore(0, 0);
  ctrl.respawn();
  setEnemiesActive(true);
  startRun();
  lockPointer();
  playerListEl.textContent = '';
  hud.setMsg('Solo — 3 hostiles in the area', 2500);
});

btnJoin.addEventListener('click', () => {
  audio.unlock();
  const name = (nameInput.value || 'Player').trim().slice(0, 20) || 'Player';
  const room = (roomInput.value || 'lobby').trim().toLowerCase().slice(0, 24) || 'lobby';
  if (WORKER_URL.includes('YOUR_SUBDOMAIN')) {
    lobbyStatus.textContent = 'Edit WORKER_URL in lib/net.js first (deploy worker)';
    return;
  }
  myName = name;
  currentRoom = room;
  store.set('rr.name', nameInput.value.trim());
  store.set('rr.room', roomInput.value.trim());
  mode = 'multi';
  setEnemiesActive(false);
  lobbyStatus.textContent = 'Connecting…';
  net.connect(room, name);
});

// ---------- chat ----------
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) {
    if (mode === 'multi' && net.isConnected()) net.sendChat(text);
    else appendChat({ id: 'local', name: 'You', text }, true);
  }
  chatInput.value = '';
  chatInput.blur();
  if (running && !panelOpen) lockPointer();
});
chatInput.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { chatInput.blur(); lockPointer(); }
  e.stopPropagation();
});
addEventListener('keydown', (e) => {
  if (!running || panelOpen || chatFocused()) return;
  if (e.code === 'KeyT' || e.code === 'Enter') {
    e.preventDefault();
    input.clear();
    chatInput.focus();
    if (document.pointerLockElement) document.exitPointerLock();
  }
});

// ---------- settings UI ----------
function bindRange(id, key, fmt, apply) {
  const el = $(id), out = $(id + 'Val');
  el.value = settings[key];
  const show = () => { out.textContent = fmt(settings[key]); };
  show();
  el.addEventListener('input', () => {
    settings[key] = parseFloat(el.value);
    show();
    if (apply) apply();
    saveSettings();
  });
}
function bindCheck(id, key, apply) {
  const el = $(id);
  el.checked = !!settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked;
    if (apply) apply();
    saveSettings();
  });
}
bindRange('setSens', 'sens', (v) => v.toFixed(2) + '×');
bindRange('setFov', 'fov', (v) => Math.round(v) + '°');
bindRange('setVol', 'volume', (v) => Math.round(v * 100) + '%', () => audio.setVolume(settings.volume));
bindCheck('setAdsToggle', 'adsToggle');
bindCheck('setInvert', 'invertY');
bindCheck('setFps', 'showFps', () => { if (!settings.showFps) hud.setFps(null); });

// ---------- loop ----------
function lobbyCam(t) {
  const a = t * 0.06;
  camera.position.set(Math.sin(a) * 36, 9 + Math.sin(t * 0.13) * 1.5, -14 + Math.cos(a) * 36);
  camera.lookAt(0, 2, -14);
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
  world.update(0, -14);
}

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;

  if (running) {
    const paused = panelOpen && mode === 'solo';
    if (!paused) {
      const now = performance.now() / 1000;
      ctrl.update(dt);
      if (mode === 'solo') {
        for (const e of enemies) updateEnemy(dt, now, e);
      } else {
        updateRemotes(dt);
        listT -= dt;
        if (listT <= 0) { listT = 0.25; refreshPlayerList(); }
      }
      bullets.update(dt);
      world.update(player.x, player.z);
    }
    fpsT += dt; fpsN++;
    if (fpsT >= 0.5) {
      if (settings.showFps) hud.setFps(Math.round(fpsN / fpsT));
      fpsT = fpsN = 0;
    }
  } else {
    lobbyCam(nowMs / 1000);
    bullets.update(dt);
  }

  renderer.clear();
  renderer.render(scene, camera);
  if (running && viewmodel.visible) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.setSize(w, h, false);
  camera.aspect = vmCamera.aspect = w / h;
  camera.updateProjectionMatrix();
  vmCamera.updateProjectionMatrix();
});

hud.update(player);
hud.setScore(0, 0);
