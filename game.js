/** Realm Range: bootstrap. Renderer (world pass + viewmodel pass), lobby, bot arena, online modes, menus. */
import * as THREE from 'three';
import { settings, saveSettings } from './lib/settings.js';
import { createTextures } from './lib/textures.js';
import { createAudio } from './lib/audio.js';
import { createWorld } from './lib/scene.js';
import { createRadar } from './lib/radar.js';
import { makeHumanoid, makeViewmodel } from './lib/humanoid.js';
import { createBulletSystem } from './lib/weapons.js';
import { createHud } from './lib/hud.js';
import { createInput } from './lib/input.js';
import { createPlayerState, createPlayerController } from './lib/player.js';
import { createEnemy, updateEnemy, respawnEnemy, applyTeam } from './lib/enemy.js';
import { clampArenaCfg, assignRoles } from './lib/botTeams.js';
import { updateHumanoidAnim, triggerShootKick, triggerMelee, ensureWeapon, LOD } from './lib/anim.js';
import { createBuild } from './lib/build.js';
import { createLobby, LOBBY_SPAWN } from './lib/lobby.js';
import { createMatch, MODES } from './lib/modes.js';
import { loadout, setSlot, loadoutString } from './lib/loadout.js';
import { ALL, SLOTS, bySlot, reloadDuration } from './lib/arsenal.js';
import { createNet, WORKER_URL } from './lib/net.js';
import { initMenus } from './lib/menus.js';
import { createRecorder } from './lib/recorder.js';
import { applyLayout } from './lib/layout.js';
import { look, applyLook, decodeLook } from './lib/look.js';
import { canon } from './lib/keybinds.js';
import { createGfx } from './lib/gfx.js';

// let the loading card paint before the big map is built
await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const startEl = $('start'), panel = $('panel'), loadoutPanel = $('loadoutPanel');
const nameInput = $('nameInput'), roomInput = $('roomInput');
const btnStart = $('btnStart'), btnResume = $('btnResume'), btnLobby = $('btnLobby'), btnLoadout = $('btnLoadout');
const chatLog = $('chatLog'), chatForm = $('chatForm'), chatInput = $('chatInput'), playerListEl = $('playerList');

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('mobile');
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
};
nameInput.value = store.get('rr.name', '');
roomInput.value = store.get('rr.room', '');

let where = 'lobby'; // 'lobby' | 'bots' | 'multi'
let running = false, panelOpen = false, loadoutOpen = false, joining = false;
let myName = 'Player', last = performance.now(), fpsT = 0, fpsN = 0, listT = 0;
const chatFocused = () => document.activeElement === chatInput;
const lockPointer = () => { if (!isTouch) { try { canvas.requestPointerLock(); } catch (_) {} } };
const isMulti = () => where === 'multi';

// ---------- renderer / world ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch && settings.aa, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2)); // gfx.apply() applies the render-scale setting
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.autoClear = false;

const tex = createTextures({ res: settings.texRes, aniso: Math.min(settings.aniso, renderer.capabilities.getMaxAnisotropy()) });
const audio = createAudio(settings);
audio.setVolume(settings.volume);
const world = createWorld(renderer, tex);
const radar = createRadar(world.pois);
const scene = world.scene;
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 400);
scene.add(camera);

// the viewmodel renders in its own scene with a fixed FOV (no growing gun when aiming, no wall clipping)
const vmScene = new THREE.Scene();
vmScene.environment = scene.environment;
vmScene.environmentIntensity = 0.9;
vmScene.add(new THREE.HemisphereLight(0xdde8ff, 0x5a5040, 1.0));
const vmSun = new THREE.DirectionalLight(0xfff0d8, 2.2);
vmSun.position.set(0.6, 1, 0.5);
vmScene.add(vmSun);
const vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);

const hud = createHud();
const match = createMatch();
const bullets = createBulletSystem(scene, tex, {
  onLand: (kind, x, y, z) => audio.play(kind === 'mag' ? 'magDrop' : 'shell', x, z),
  onWhiz: () => audio.play('whiz'),
});

const playerMesh = makeHumanoid(tex, 'player', look);
playerMesh.visible = false;
scene.add(playerMesh);
const viewmodel = makeViewmodel(tex);
viewmodel.visible = false;
vmScene.add(viewmodel);
applyLook(viewmodel, look, tex);
const player = createPlayerState();
const enemies = []; // active bots
const allEnemies = []; // full pool
const remotes = new Map();
let ctrl = null;

// ---------- multiplayer remotes ----------
function makeTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(0, 8, 256, 48);
  x.font = '700 30px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = color; x.fillText(name, 128, 33, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(1.5, 0.375, 1);
  s.position.y = 2.25;
  return s;
}

function addRemote(p) {
  if (!p || remotes.has(p.id)) return;
  const mesh = makeHumanoid(tex, 'remote', p.lk ? decodeLook(p.lk) : null);  scene.add(mesh);
  const col = match.cfg.teams ? (p.team && p.team === match.team ? '#4aa8ff' : '#ff6b4a') : '#ffffff';
  const tag = makeTag(p.name || 'Player', col);
  mesh.add(tag);
  const x = p.x || 0, y = p.y || 0, z = p.z || 0, yaw = p.yaw || 0;
  mesh.position.set(x, y, z);
  remotes.set(p.id, {
    id: p.id, mesh, tag, name: p.name || 'Player', team: p.team || null,
    x, y, z, tx: x, ty: y, tz: z, px: x, pz: z, yaw, tyaw: yaw, pitch: p.pitch || 0,
    hp: p.hp ?? 100, alive: p.alive !== false, ads: !!p.ads, crouch: !!p.crouch, sprint: !!p.sprint,
    rl: !!p.rl, wasRl: false, rlT: 0, weapon: p.weapon || 'vanguard', speed: 0, flashes: {},
  });
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.mesh);
  r.tag.material.map.dispose();
  r.tag.material.dispose();
  remotes.delete(id);
}
function clearRemotes() { for (const id of [...remotes.keys()]) removeRemote(id); }

function remoteFlash(r, id) {
  return r.flashes[id] || (r.flashes[id] = bullets.attachFlash(ensureWeapon(r.mesh.userData, id).muzzle, 0.55));
}
const _v = new THREE.Vector3();
function remoteEvent(r, name, info) {
  if (name === 'toss' && info) bullets.dropMag(info.pos, _v.set(-1.5, 1, 0.3));
  else if (name === 'eject' && info) bullets.ejectShell(info.pos, _v.set(1.2, 1.2, 0));
  else if (name === 'swing') audio.play('swing', r.x, r.z);
  else if (!['toss', 'eject', 'meleeHit', 'throwStart', 'throwRelease'].includes(name)) audio.play(name, r.x, r.z);
}

function updateRemotes(dt) {
  for (const r of remotes.values()) {
    const dx = r.tx - r.x, dz = r.tz - r.z, dy = r.ty - r.y;
    if (Math.hypot(dx, dz, dy) > 8) { r.x = r.tx; r.y = r.ty; r.z = r.tz; }
    else { const k = Math.min(1, dt * 14); r.x += dx * k; r.y += dy * k; r.z += dz * k; }
    r.yaw += Math.atan2(Math.sin(r.tyaw - r.yaw), Math.cos(r.tyaw - r.yaw)) * Math.min(1, dt * 14);
    const sp = Math.hypot(r.x - r.px, r.z - r.pz) / Math.max(dt, 1e-3);
    r.px = r.x; r.pz = r.z;
    r.speed += (Math.min(sp, 12) - r.speed) * Math.min(1, dt * 8);
    const wid = ALL[r.weapon] ? r.weapon : 'vanguard', def = ALL[wid];
    if (r.rl && !r.wasRl) r.rlT = 0;
    r.wasRl = r.rl;
    if (r.rl) r.rlT += dt;
    r.mesh.position.set(r.x, r.y, r.z);
    r.mesh.rotation.y = r.yaw;
    r.tag.visible = r.alive;
    updateHumanoidAnim(r.mesh.userData, {
      dt, moving: r.speed > 0.4, speed: r.speed, grounded: true, ads: r.ads, sprint: r.sprint, crouch: r.crouch,
      pitch: r.pitch, reloading: r.rl && def.kind === 'gun', reloadT: r.rlT, missing: def.mag || 1, ammo: 1,
      weapon: wid, dead: !r.alive,
      onEvent: (n, i) => remoteEvent(r, n, i),
      onStep: () => audio.play('step', r.x, r.z, { vol: 0.6 }),
    });
  }
}

function refreshPlayerList() {
  if (!isMulti()) { playerListEl.textContent = ''; return; }
  const lines = [`You — ${Math.round(player.hp)} hp`];
  for (const r of remotes.values()) lines.push(`${r.name} — ${r.alive ? Math.round(r.hp) + ' hp' : 'down'}`);
  playerListEl.textContent = lines.join('\n');
}

function appendChat(msg) {
  const div = document.createElement('div');
  if (msg.id === 'system' || msg.name === 'System') { div.className = 'sys'; div.textContent = msg.text; }
  else {
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = msg.name;
    div.append(n, ': ' + msg.text);
  }
  chatLog.appendChild(div);
  while (chatLog.children.length > 60) chatLog.firstChild.remove();
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---------- network ----------
let build = null;
const net = createNet({
  // bot arena server followers

  onWelcome(msg) {
    if (msg.mode === 'lobby') { onLobbyWelcome(msg); return; }
    if (msg.mode === 'bots') {
      // bot arena already set where; keep local leaders
      return;
    }
    where = 'multi';
    joining = false;
    lobby.setActive(false);
    for (const e of allEnemies) e.mesh.visible = false;
    build.clear();
    player.canBuild = true;
    match.begin(msg.mode);
    match.apply(msg);
    clearRemotes();
    for (const p of msg.players || []) addRemote(p);
    chatLog.textContent = '';
    for (const c of msg.chat || []) appendChat(c);
    for (const spec of msg.builds || []) build.placeRemote(spec);
    player.kills = player.deaths = 0;
    hud.setScore(0, 0);
    ctrl.respawnAt(msg.spawn);
    net.startStateLoop(() => player);
    hud.setMode('multi');
    hud.setMsg(match.cfg.name, 2200);
    refreshPlayerList();
    lockPointer();
  },
  onJoin(p) { addRemote(p); refreshPlayerList(); },
  onLeave(id) { removeRemote(id); refreshPlayerList(); },
  onState(msg) {
    const r = remotes.get(msg.id);
    if (!r) return;
    r.tx = msg.x; r.ty = msg.y || 0; r.tz = msg.z; r.tyaw = msg.yaw; r.pitch = msg.pitch || 0;
    r.hp = msg.hp; r.alive = msg.alive; r.ads = !!msg.ads; r.crouch = !!msg.crouch; r.sprint = !!msg.sprint;
    r.rl = !!msg.rl;
    if (msg.weapon) r.weapon = msg.weapon;
  },
  onShoot(msg) {
    const def = ALL[msg.weapon];
    if (!def || def.kind !== 'gun' || msg.ox == null) return;
    const o = new THREE.Vector3(msg.ox, msg.oy, msg.oz);
    const d = new THREE.Vector3(msg.dx, msg.dy, msg.dz).normalize();
    const r = remotes.get(msg.id);
    if (r) { remoteFlash(r, msg.weapon).fire(); triggerShootKick(r.mesh.userData); }
    else bullets.muzzleFlash(o);
    for (let i = 0; i < Math.min(3, def.pellets || 1); i++) bullets.spawn(o, d, def.bulletSpeed || 230, true);
    audio.play('shot', o.x, o.z, { enemy: true, snd: msg.weapon });
  },
  onMelee(msg) {
    const r = remotes.get(msg.id);
    if (r) triggerMelee(r.mesh, msg.thrown ? 'throw' : 'swing');
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
  onHeal(msg) { ctrl.heal(msg.hp); },
  onKill(msg) {
    const me = net.getMyId();
    hud.addKill(msg.killer === me ? 'You' : msg.kname, msg.victim === me ? 'You' : msg.vname, msg.head);
    if (msg.killer === me) { hud.hitMarker('kill'); audio.play('kill'); }
    const r = remotes.get(msg.victim);
    if (r) { r.alive = false; audio.play('death', r.x, r.z); }
  },
  onScores(msg) {
    match.apply(msg);
    const mine = (msg.list || []).find((s) => s.id === net.getMyId());
    if (mine) { player.kills = mine.k; player.deaths = mine.d; hud.setScore(mine.k, mine.d); }
  },
  onPhase(msg) { match.apply(msg); },
  onSpawn(msg) { ctrl.respawnAt(msg); },
  onRespawnIn(ms) { ctrl.queueRespawn(ms); },
  onChat(msg) { appendChat(msg); },
  onBuild(ev) {
    if (ev.kind === 'place') build.placeRemote(ev.spec);
    else if (ev.kind === 'hit') build.damageByKey(ev.key, ev.dmg);
    else if (ev.kind === 'break') build.destroyByKey(ev.key);
    else if (ev.kind === 'clear') build.clear();
  },
  onBots(msg) {
    if (where !== 'bots' || !msg.list) return;
    const byId = new Map(msg.list.map((b) => [b.id, b]));
    for (const e of enemies) {
      if (!e.serverSide || !e.serverId) continue;
      const b = byId.get(e.serverId);
      if (!b) continue;
      e.sx = b.x; e.sy = b.y; e.sz = b.z; e.syaw = b.yaw;
      e.sMoving = !!b.moving;
      e.sAds = !!b.ads;
      e.sReloading = !!b.reloading;
      e.sAmmo = b.ammo;
      e.hp = b.hp;
      const was = e.alive;
      e.alive = !!b.alive;
      if (!e.alive && was) { e.deathT = 0; audio.play('death', e.x, e.z); }
      if (e.alive) e.mesh.visible = true;
    }
  },
  onBotShoot(msg) {
    if (!msg) return;
    const o = new THREE.Vector3(msg.x, msg.y || 1.4, msg.z);
    const d = new THREE.Vector3(msg.dx || 0, msg.dy || 0, msg.dz || 1).normalize();
    bullets.spawn(o, d, 150, true);
    audio.play('shot', msg.x, msg.z, { enemy: true, snd: 'stinger' });
    for (const e of enemies) {
      if (e.serverId === msg.id && e.mesh) {
        try { triggerShootKick(e.mesh.userData); } catch (_) {}
        break;
      }
    }
  },
  onFull() { joining = false; hud.setMsg('That room is full', 2200); },
  onClose() {
    if (isMulti() && running) enterLobby('Disconnected from the match');
    else if (where === 'lobby' && running) { clearRemotes(); joinGlobalLobby(); }
  },
  onError(reason) { joining = false; hud.setMsg(reason || 'Connection error', 2500); },
});

function onLobbyWelcome(msg) {
  clearRemotes();
  for (const p of msg.players || []) addRemote(p);
  chatLog.textContent = '';
  for (const c of msg.chat || []) appendChat(c);
  net.startStateLoop(() => player);
  hud.setMsg(`Global lobby · ${(msg.players || []).length + 1} online`, 2200);
}

// ---------- building ----------
build = createBuild(scene, tex, {
  onPlace: (spec, piece, remote) => {
    if (remote) return;
    audio.play('click');
    if (isMulti()) net.sendBuild(spec);
  },
  onBreak: (piece) => audio.play('thud', piece.geom.x, piece.geom.z),
  onHit: (piece) => audio.play('clang', piece.geom.x, piece.geom.z, { vol: 0.4 }),
  onDenied: (why) => hud.setMsg(why === 'mats' ? 'Not enough materials' : why === 'blocked' ? 'Blocked' : why === 'level' ? "Can't build this high" : '', 800),
});

// ---------- lobby ----------
const lobby = createLobby(scene, tex, {
  onEquip: () => { ctrl.refreshLoadout(); refreshSlotsUI(); audio.play('click'); },
  onRangeHit: (bull) => { audio.play(bull ? 'headshot' : 'hit'); hud.hitMarker(bull ? 'head' : 'hit'); },
});

// ---------- bots ----------
const enemyCtx = {
  bullets, audio, hud, player, enemies, build, net, net: null,
  onPlayerHit: (dmg, sx, sz, zone, name) => { if (where === 'bots' && running) ctrl.applyDamage(dmg, sx, sz, name); },
  onBotKill: (killer, victim, head) => {
    if (where !== 'bots') return;
    hud.addKill(killer.name, victim.name, head);
  },
};
const MAX_ARENA_BOTS = 40;
for (let i = 0; i < MAX_ARENA_BOTS; i++) {
  const m = makeHumanoid(tex, 'enemy');
  m.visible = false;
  scene.add(m);
  const e = createEnemy(m, enemyCtx, i);
  enemies.push(e);
  allEnemies.push(e);
  m.visible = false;
}

/** Build Bot Arena roster from team/size/leader settings. */
function setupArenaFromSettings() {
  const cfg = clampArenaCfg(settings);
  const roles = assignRoles(cfg);
  enemies.length = 0;
  allEnemies.forEach((e, i) => {
    if (i < roles.length) {
      applyTeam(e, roles[i]);
      enemies.push(e);
    } else {
      e.mesh.visible = false;
      e.alive = false;
    }
  });
  enemyCtx.enemies = enemies;
  if (where === 'bots') {
    for (const e of enemies) respawnEnemy(e);
  }
}

function setBotCount(n) {
  const teams = Math.max(2, Math.min(4, settings.botTeams || 2));
  settings.botTeamSize = Math.max(4, Math.min(10, Math.round((n || 12) / teams)));
  saveSettings();
  setupArenaFromSettings();
}

// ---------- graphics (quality settings, post effects, menu) ----------
const gfx = createGfx({
  renderer, scene, camera, vmScene, vmCamera, world, tex, isTouch,
  getCharacters: () => {
    const l = [playerMesh];
    for (const e of allEnemies) l.push(e.mesh);
    for (const r of remotes.values()) l.push(r.mesh);
    return l;
  },
  maxBots: MAX_ARENA_BOTS,
  onBots: setBotCount,
  say: (t) => hud.setMsg(t, 2400),
});
gfx.apply();

// optional: skip shell casings / dropped mags (physics + collision checks every frame)
const _eject = bullets.ejectShell, _drop = bullets.dropMag;
bullets.ejectShell = (...a) => { if (settings.debris) _eject(...a); };
bullets.dropMag = (...a) => { if (settings.debris) _drop(...a); };

// ---------- input + controller ----------
const input = createInput(canvas, {
  isTouch,
  getPlayer: () => player,
  isActive: () => running && !panelOpen && !loadoutOpen && !chatFocused(),
  onReload: () => ctrl.startReload(),
  onToggleCamera: () => ctrl.toggleCamera(),
  onAim: (down) => ctrl.setAim(down),
  onToggleBuild: () => {
    if (!player.canBuild) { hud.setMsg('Building is disabled in the lobby', 1200); return; }
    ctrl.toggleBuild();
  },
  onBuildTier,
  onQuickMelee: () => ctrl.quickMelee(),
  onDigit: (i) => ctrl.digit(i),
  onScroll: (d) => ctrl.scroll(d),
});
function onBuildTier() {
  if (!player.building) return;
  hud.setMsg(ctrl.buildTier(), 700);
}

ctrl = createPlayerController({
  scene, camera, playerMesh, viewmodel, player, input, bullets, hud, audio, build, world, net,
  getEnemies: () => (where === 'bots' ? enemies : []),
  getRemotes: () => remotes,
  isMulti,
  isBots: () => where === 'bots',
  isFrozen: () => isMulti() && match.frozen,
  isTouch,
  isFriend: (c) => !!(c.remote && match.cfg.teams && c.team && c.team === match.team),
});
hud.onSlot = (i) => ctrl.digit(i);
hud.onBuildPick = (i) => ctrl.digit(i);
hud.onTier = onBuildTier;

// ---------- game flow ----------
function refreshSlotsUI() {
  hud.setSlots(SLOTS.map((s, i) => ({ key: String(i + 1), name: ALL[loadout[s]].name })));
}

const GLOBAL_LOBBY_ROOM = 'global-lobby';
function joinGlobalLobby() {
  if (WORKER_URL.includes('YOUR_SUBDOMAIN')) return;
  net.connect(GLOBAL_LOBBY_ROOM, myName, 'lobby', loadoutString());
}

function enterLobby(msg) {
  where = 'lobby';
  joining = false;
  net.disconnect();
  clearRemotes();
  for (const e of allEnemies) e.mesh.visible = false;
  build.clear();
  build.setActive(false);
  match.begin('bots');
  lobby.setActive(true);
  player.canBuild = false;
  player.kills = player.deaths = 0;
  hud.setScore(0, 0);
  ctrl.respawnAt(LOBBY_SPAWN);
  hud.setMode('lobby');
  hud.setBanner(null);
  hud.setStatus('');
  playerListEl.textContent = '';
  if (msg) hud.setMsg(msg, 2500);
  if (running) joinGlobalLobby();
}

async function startBots() {
  where = 'bots';
  lobby.setActive(false);
  build.clear();
  match.begin('bots');
  player.canBuild = true;
  player.kills = player.deaths = 0;
  hud.setScore(0, 0);
  if (typeof setupArenaFromSettings === 'function') setupArenaFromSettings();
  else {
    for (const e of enemies) { e.mesh.visible = true; }
  }
  ctrl.respawn();
  for (const e of enemies) {
    if (e.isLeader) respawnEnemy(e);
    else { e.mesh.visible = true; e.alive = true; e.hp = e.maxHp; }
  }
  const cfg = typeof clampArenaCfg === 'function' ? clampArenaCfg(settings) : { teams: 2, size: 6, leaders: 1 };
  hud.setMode('bots');
  hud.setMsg(`Bot Arena — connecting followers to server…`, 2000);
  const room = 'bots-' + Math.random().toString(36).slice(2, 8);
  const ok = await net.connect(room, 'Player', 'bots', loadoutString(), {
    teams: cfg.teams, size: cfg.size, leaders: cfg.leaders,
  });
  if (ok) {
    net.startStateLoop(() => player);
    hud.setMsg(`Bot Arena — ${cfg.teams} teams × ${cfg.size} (${cfg.leaders} leaders client / rest server)`, 3500);
  } else {
    hud.setMsg('Server followers unavailable — local followers fallback', 3500);
    for (const e of enemies) { e.serverSide = false; if (!e.isLeader) respawnEnemy(e); }
  }
}

async function startOnline(modeId) {
  if (joining) return;
  if (WORKER_URL.includes('YOUR_SUBDOMAIN')) { hud.setMsg('Set WORKER_URL in lib/net.js first', 3000); return; }
  joining = true;
  const code = roomInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  hud.setMsg(code ? `Joining room “${code}”…` : `Finding a ${MODES[modeId].name} match…`, 0);
  let ok;
  if (code) ok = await net.connect(code, myName, modeId, loadoutString());
  else ok = !!(await net.join(modeId, myName, loadoutString(), { onTry: (n) => hud.setMsg(`Searching… room ${n}`, 0) }));
  if (!ok) {
    joining = false;
    hud.setMsg('No match found — try again', 2500);
    if (where === 'lobby') joinGlobalLobby();
  }
}

const enterPortal = (id) => (id === 'bots' ? startBots() : startOnline(id));

// ---------- panels ----------
function openPanel() {
  panelOpen = true;
  input.clear();
  panel.classList.add('on');
  btnResume.textContent = running ? 'Resume' : 'Back';
  btnLobby.style.display = running && where !== 'lobby' ? '' : 'none';
  btnLoadout.style.display = where === 'lobby' ? '' : 'none';
  if (document.pointerLockElement) document.exitPointerLock();
}
function closePanel() {
  panelOpen = false;
  panel.classList.remove('on');
  store.set('rr.room', roomInput.value.trim());
  if (running) lockPointer();
}

const describe = (d) => (d.kind === 'melee' ? d.blurb : `${d.mag}/${d.total} ammo · ${Math.round(60 / d.cd)} rpm · ${reloadDuration(d, d.mag).toFixed(1)}s reload`);
const SLOT_LABEL = { main: 'MAIN', side: 'SECONDARY', melee: 'MELEE' };
function renderLoadout() {
  const grid = $('loadoutGrid');
  grid.textContent = '';
  for (const slot of SLOTS) {
    const col = document.createElement('div');
    col.className = 'lcol';
    const h = document.createElement('h3');
    h.textContent = SLOT_LABEL[slot];
    col.appendChild(h);
    for (const d of bySlot(slot)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lw' + (loadout[slot] === d.id ? ' on' : '');
      const n = document.createElement('b'), s = document.createElement('span');
      n.textContent = d.name; s.textContent = describe(d);
      b.append(n, s);
      b.addEventListener('click', () => {
        setSlot(slot, d.id);
        lobby.refresh();
        ctrl.refreshLoadout();
        refreshSlotsUI();
        audio.play('click');
        renderLoadout();
      });
      col.appendChild(b);
    }
    grid.appendChild(col);
  }
}
function openLoadout() {
  loadoutOpen = true;
  input.clear();
  renderLoadout();
  loadoutPanel.classList.add('on');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeLoadout() {
  loadoutOpen = false;
  loadoutPanel.classList.remove('on');
  if (running && !panelOpen) lockPointer();
}

btnStart.addEventListener('click', () => {
  audio.unlock();
  myName = (nameInput.value || 'Player').trim().slice(0, 20) || 'Player';
  store.set('rr.name', nameInput.value.trim());
  running = true;
  last = performance.now();
  startEl.classList.add('hide');
  input.clear();
  joinGlobalLobby();
  lockPointer();
});
$('btnSettingsStart').addEventListener('click', openPanel);
$('btnLoadoutStart').addEventListener('click', openLoadout);
$('btnLoadoutDone').addEventListener('click', closeLoadout);
btnResume.addEventListener('click', closePanel);
btnLoadout.addEventListener('click', () => { closePanel(); openLoadout(); });
btnLobby.addEventListener('click', () => { closePanel(); enterLobby('Back in the lobby'); });
$('btnPause').addEventListener('click', () => { if (running) openPanel(); });
document.addEventListener('pointerlockchange', () => {
  if (isTouch) return;
  if (document.pointerLockElement !== canvas && running && !panelOpen && !loadoutOpen && !chatFocused()) openPanel();
});

// ---------- chat ----------
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) {
    if (net.isConnected()) net.sendChat(text);
    else appendChat({ id: 'local', name: myName, text });
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
  if (!running || panelOpen || loadoutOpen || chatFocused()) return;
  if (canon(e.code) === 'KeyM' && running && where !== 'lobby') { radar.toggleFull(); return; }
  if (canon(e.code) === 'KeyT' || e.code === 'Enter') {
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
bindCheck('setMinimap', 'showMinimap');
bindRange('setMinimapSize', 'minimapSize', (v) => Math.round(v) + 'px');

// Graphics button in the pause menu
{
  const pc = panel.querySelector('.card');
  const gb = document.createElement('div');
  gb.className = 'btns';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Graphics & performance';
  b.addEventListener('click', () => gfx.openMenu());
  gb.append(b);
  pc.insertBefore(gb, pc.querySelector('.keys'));
}

// ---------- loop ----------
function introCam(t) {
  const a = t * 0.06;
  camera.position.set(Math.sin(a) * 40, 12 + Math.sin(t * 0.13) * 2, 10 + Math.cos(a) * 40);
  camera.lookAt(0, 4, 10);
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
}

function frame(nowMs) {
  requestAnimationFrame(frame);
  const raw = (nowMs - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = nowMs;
  const interact = input.consumeInteract();
  LOD.on = !!settings.animLod; LOD.x = player.x; LOD.z = player.z;
  gfx.tick(raw);

  if (running) {
    const paused = panelOpen && !live && where !== 'multi';
    if (!paused) {
      const now = performance.now() / 1000;
      ctrl.update(dt);
      if (where === 'lobby') {
        const act = lobby.update(dt, player, interact);
        hud.setPrompt(joining ? { text: 'Searching for a match…', sub: 'Hang tight', progress: 0 } : lobby.prompt);
        if (act && act.type === 'portal' && !joining) enterPortal(act.mode);
        updateRemotes(dt);
      } else {
        hud.setPrompt(null);
        if (where === 'bots') {
          for (const e of enemies) updateEnemy(dt, now, e);
        } else {
          updateRemotes(dt);
          match.tick(dt);
          hud.setBanner(match.banner());
          hud.setStatus(match.status());
          listT -= dt;
          if (listT <= 0) { listT = 0.25; refreshPlayerList(); }
        }
      }
      bullets.update(dt);
      world.update(player.x, player.z, dt);
      radar.update(player, remotes, dt, {
        active: running && where !== 'lobby',
        enemies: where === 'bots' ? enemies : null,
        build,
      });
    }
    if (isMulti() && input.keys.has('Tab')) hud.setBoard(match.rows(net.getMyId()), match.cfg.teams ? 'TEAMS' : 'SCOREBOARD');
    else hud.setBoard(null);
    fpsT += Math.min(raw, 1); fpsN++; // real frame time (not the clamped sim step)
    if (fpsT >= 0.5) {
      if (settings.showFps) hud.setFps(Math.round(fpsN / fpsT));
      fpsT = fpsN = 0;
    }
  } else {
    introCam(nowMs / 1000);
    world.update(0, 10, dt);
    bullets.update(dt);
  }

  gfx.render(running && viewmodel.visible);
  recorder.frame(nowMs);
}

addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight;
  gfx.resize();
  camera.aspect = vmCamera.aspect = w / h;
  camera.updateProjectionMatrix();
  vmCamera.updateProjectionMatrix();
});

// ---------- recording, extra menus, touch layout ----------
let live = false;
const recorder = createRecorder({
  canvas, audio,
  onStatus: (m) => hud.setMsg(m, 2500),
  getState: () => ({
    hp: Math.ceil(player.hp), weapon: player.weaponName, kind: player.weaponKind, ammo: player.ammo, reserve: player.reserve,
    kills: player.kills, deaths: player.deaths, scope: player.scope,
  }),
});
const _addKill = hud.addKill;
hud.addKill = (a, b, head) => { recorder.feedKill(a, b, head); _addKill(a, b, head); };
const _hitMarker = hud.hitMarker;
hud.hitMarker = (kind) => { recorder.hitMarker(kind); _hitMarker(kind); };
initMenus({
  isTouch, player, ctrl, tex, playerMesh, viewmodel, recorder, panel,
  startCard: document.querySelector('#start .card'),
  ui: {
    hidePanel: () => panel.classList.remove('on'),
    showPanel: () => { if (panelOpen) panel.classList.add('on'); },
    live: (on) => { live = on; },
  },
});
applyLayout();

// ---------- boot ----------
refreshSlotsUI();
enterLobby();
hud.update(player);
btnStart.disabled = false;
btnStart.textContent = 'Enter lobby';
requestAnimationFrame(frame);
