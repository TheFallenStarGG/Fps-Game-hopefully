/** Player: movement (sprint / crouch / jump / step-up), recoil + spread, hitscan, reload wiring, damage + respawn, cameras */
import * as THREE from 'three';
import { resolveCircle, raycastWorld, colliders } from './collision.js';
import {
  updateHumanoidAnim, updateViewmodel, triggerShootKick, resetViewmodelReload, resetReloadAnim, RELOAD,
} from './anim.js';
import { damageEnemy } from './enemy.js';
import { SPAWNS } from './scene.js';
import { EYE_H, CROUCH_EYE, settings } from './settings.js';

const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

export const DMG = { head: 40, body: 20, limb: 14 };
const WALK = 5.4, SPRINT = 8.4, CROUCH_SPEED = 2.8, ADS_SPEED = 3.2, RELOAD_SPEED = 4.4;
const FIRE_CD = 0.095;

export function createPlayerState() {
  return {
    x: 0, z: 8, y: 0, yaw: 0, pitch: 0.04,
    vx: 0, vz: 0, velY: 0, onGround: true,
    hp: 100, maxHp: 100, alive: true,
    fireCd: 0, ammo: 30, magSize: 30, reserve: 120,
    reloading: false, reloadT: 0,
    ads: false, recoil: 0, bloom: 0,
    radius: 0.42, eyeH: EYE_H,
    thirdPerson: false, moving: false, sprinting: false, crouching: false, crouchBlend: 0,
    speed2d: 0, noise: 0, lastShotT: -99, lastHurtT: -99,
    kills: 0, deaths: 0, respawnT: 0, shake: 0, landDip: 0, deadRoll: 0, lean: 0,
  };
}

function floorAt(x, z, y) {
  let f = 0;
  for (const c of colliders) {
    if (c.h > f && c.h <= y + 0.4 && x > c.minX - 0.1 && x < c.maxX + 0.1 && z > c.minZ - 0.1 && z < c.maxZ + 0.1) f = c.h;
  }
  return f;
}

const hitCache = new WeakMap();
function hitMeshes(root) {
  let l = hitCache.get(root);
  if (!l) {
    l = [];
    root.traverse((o) => { if (o.isMesh && o.userData.hitZone) l.push(o); });
    hitCache.set(root, l);
  }
  return l;
}

export function createPlayerController({
  camera, playerMesh, viewmodel, player, input, bullets, hud, audio,
  getEnemies, getRemotes, isMulti, onLocalShoot,
}) {
  const raycaster = new THREE.Raycaster();
  const _look = new THREE.Vector3(), _dir = new THREE.Vector3(), _o = new THREE.Vector3();
  const _right = new THREE.Vector3(), _up = new THREE.Vector3();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const _m = new THREE.Vector3(), _vel = new THREE.Vector3();
  const bodyU = playerMesh.userData, vmU = viewmodel.userData;
  const fpFlash = bullets.attachFlash(vmU.muzzle, 0.32);
  const tpFlash = bullets.attachFlash(bodyU.muzzle, 0.55);
  let lastDry = 0, respawnCb = null;

  function getLookDir(out) {
    const pitch = clamp(player.pitch + player.recoil, -1.4, 1.4);
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    return out.set(-sy * cp, sp, -cy * cp).normalize();
  }

  function spread() {
    let s = player.ads ? 0.0035 : 0.016;
    s += clamp(player.speed2d / WALK, 0, 1.6) * (player.ads ? 0.004 : 0.014);
    if (!player.onGround) s += 0.04;
    if (player.crouching) s *= 0.65;
    return s + player.bloom * (player.ads ? 0.006 : 0.014);
  }

  // ---------- aim / camera mode ----------
  function setAim(down) {
    if (!player.alive) return;
    if (player.reloading) { if (!down && !settings.adsToggle) player.ads = false; return; }
    if (settings.adsToggle) { if (down) player.ads = !player.ads; }
    else player.ads = down;
  }

  function toggleCamera() {
    player.thirdPerson = !player.thirdPerson;
    hud.setMsg(player.thirdPerson ? 'Third person' : 'First person', 1000);
  }

  // ---------- reload ----------
  function startReload() {
    if (player.reloading || !player.alive || player.ammo >= player.magSize || player.reserve <= 0) return;
    player.reloading = true;
    player.reloadT = 0;
    player.ads = false;
    resetViewmodelReload(viewmodel);
    resetReloadAnim(bodyU);
  }

  function finishReload() {
    const take = Math.min(player.magSize - player.ammo, player.reserve);
    player.ammo += take;
    player.reserve -= take;
    player.reloading = false;
  }

  function reloadEvent(name, info, fp) {
    if (name !== 'toss') { audio.play(name); return; }
    const pos = info.pos.clone();
    if (fp) {
      camera.localToWorld(pos); // viewmodel space -> world
      _vel.set(rnd(-3, -2.1), rnd(0.5, 1.3), rnd(-1.2, 0.2)).applyQuaternion(camera.quaternion);
    } else {
      const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
      _vel.set(-cy * 2.4 - sy * 0.3, rnd(0.7, 1.3), sy * 2.4 - cy * 0.3);
    }
    _vel.x += player.vx * 0.5;
    _vel.z += player.vz * 0.5;
    bullets.dropMag(pos, _vel);
  }

  // ---------- shooting ----------
  function shoot() {
    if (!player.alive || player.reloading || player.fireCd > 0) return;
    const now = performance.now() / 1000;
    if (player.ammo <= 0) {
      if (player.reserve > 0) startReload();
      else if (now - lastDry > 0.4) { audio.play('dry'); lastDry = now; }
      return;
    }
    const tp = player.thirdPerson;
    player.ammo--;
    player.fireCd = FIRE_CD;
    player.lastShotT = now;
    player.bloom = Math.min(1, player.bloom + 0.12);

    // ray origin + direction (with spread)
    getLookDir(_look);
    if (tp) {
      _a.set(player.x, player.y + player.eyeH, player.z);
      _o.copy(camera.position).addScaledVector(_look, Math.max(0, _look.dot(_b.subVectors(_a, camera.position))));
    } else _o.copy(camera.position);
    _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    _up.crossVectors(_right, _look).normalize();
    const ang = rnd(0, PI * 2), rad = spread() * Math.sqrt(Math.random());
    _dir.copy(_look).addScaledVector(_right, Math.cos(ang) * rad).addScaledVector(_up, Math.sin(ang) * rad).normalize();

    // world, then characters
    const w = raycastWorld(_o.x, _o.y, _o.z, _dir.x, _dir.y, _dir.z, 200);
    let bestT = w ? w.t : 200, target = null, zone = null;
    raycaster.set(_o, _dir);

    const cands = [];
    for (const e of getEnemies()) if (e.alive) cands.push(e);
    if (isMulti()) for (const [id, r] of getRemotes()) if (r.alive) cands.push({ id, mesh: r.mesh, x: r.x, z: r.z, remote: true });
    const h2 = _dir.x * _dir.x + _dir.z * _dir.z;
    for (const c of cands) {
      if (h2 < 1e-6) break;
      const tt = ((c.x - _o.x) * _dir.x + (c.z - _o.z) * _dir.z) / h2;
      if (tt < 0 || tt > bestT) continue;
      const perp = Math.hypot(_o.x + _dir.x * tt - c.x, _o.z + _dir.z * tt - c.z);
      if (!c.remote && perp > 0.45 && perp < 1.8 && tt > 3) c.suppression = Math.min(1, c.suppression + 0.22);
      if (perp > 1.3) continue;
      c.mesh.updateMatrixWorld(true);
      raycaster.far = bestT;
      const hits = raycaster.intersectObjects(hitMeshes(c.mesh), false);
      if (hits.length && hits[0].distance < bestT) {
        bestT = hits[0].distance;
        target = c;
        zone = hits[0].object.userData.hitZone || 'body';
      }
    }
    const hitPoint = _c.copy(_o).addScaledVector(_dir, Math.min(bestT, 150)).clone();

    // muzzle position in world space
    if (tp) bodyU.muzzle.getWorldPosition(_m);
    else { vmU.muzzle.getWorldPosition(_m); camera.localToWorld(_m); }

    // flash, sound, tracer
    if (tp) tpFlash.fire(); else fpFlash.fire(_m);
    audio.play('shot');
    _b.subVectors(hitPoint, _m);
    const tl = _b.length();
    const sd = tl > 1.5 ? _b.divideScalar(tl).clone() : _dir.clone();
    if (!target) bullets.spawn(_m, sd, 230, false);

    // shell ejection
    const ej = tp ? bodyU.eject : vmU.eject;
    ej.getWorldPosition(_a);
    if (tp) _c.copy(_right); else { _c.set(1, 0, 0).applyQuaternion(camera.quaternion); camera.localToWorld(_a); }
    _vel.copy(_c).multiplyScalar(rnd(1.8, 2.8));
    _vel.y += rnd(1.0, 1.8);
    _vel.addScaledVector(_dir, rnd(-0.4, 0.2));
    _vel.x += player.vx * 0.5; _vel.z += player.vz * 0.5;
    bullets.ejectShell(_a, _vel);

    // recoil + kick
    player.recoil = Math.min(0.2, player.recoil + (player.ads ? 0.011 : 0.015) * (player.crouching ? 0.8 : 1));
    player.yaw += rnd(-0.003, 0.003);
    triggerShootKick(vmU);
    triggerShootKick(bodyU);

    // hit resolution
    let targetId = null, dmg = DMG.body;
    if (target) {
      dmg = DMG[zone] || DMG.body;
      const head = zone === 'head';
      bullets.impact(_a.copy(_o).addScaledVector(_dir, bestT), _c.copy(_dir).negate(), 'body');
      if (target.remote) {
        targetId = target.id;
        hud.hitMarker(head ? 'head' : 'hit');
        audio.play(head ? 'headshot' : 'hit');
      } else {
        const res = damageEnemy(target, dmg, zone);
        if (res.killed) {
          player.kills++;
          player.reserve = Math.min(240, player.reserve + 20);
          hud.hitMarker('kill');
          audio.play('kill');
          hud.addKill('You', target.name, head);
          hud.setScore(player.kills, player.deaths);
        } else {
          hud.hitMarker(head ? 'head' : 'hit');
          audio.play(head ? 'headshot' : 'hit');
        }
      }
    }
    if (onLocalShoot && isMulti()) onLocalShoot({ origin: _m.clone(), dir: sd, targetId, dmg });
  }

  // ---------- damage / death / respawn ----------
  function hurtFeedback(sx, sz) {
    player.lastHurtT = performance.now() / 1000;
    player.shake = Math.min(0.06, player.shake + 0.03);
    audio.play('hurt');
    if (typeof sx === 'number') {
      const dx = sx - player.x, dz = sz - player.z;
      const fwd = -Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz;
      const rgt = Math.cos(player.yaw) * dx - Math.sin(player.yaw) * dz;
      hud.damage(Math.atan2(rgt, fwd));
    } else hud.damage(null);
  }

  function queueRespawn(ms, cb) {
    player.respawnT = Math.max(0.05, ms / 1000);
    respawnCb = cb || null;
  }

  function die(by) {
    if (!player.alive) return;
    player.alive = false;
    player.hp = 0;
    player.ads = false;
    player.reloading = false;
    player.sprinting = false;
    player.deaths++;
    audio.play('death');
    if (by) hud.addKill(by, 'You', false);
    hud.setScore(player.kills, player.deaths);
    if (!isMulti()) queueRespawn(3000);
  }

  /** Solo damage from a bot */
  function applyDamage(dmg, sx, sz, by) {
    if (!player.alive) return;
    player.hp = Math.max(0, player.hp - dmg);
    hurtFeedback(sx, sz);
    if (player.hp <= 0) die(by);
  }

  /** Multiplayer: server-authoritative hp */
  function syncHp(hp, alive, sx, sz) {
    const was = player.hp;
    player.hp = hp;
    if (hp < was) hurtFeedback(sx, sz);
    if (!alive && player.alive) die();
  }

  function respawn() {
    const sp = SPAWNS.player[Math.floor(Math.random() * SPAWNS.player.length)];
    player.x = sp.x + rnd(-1, 1); player.z = sp.z + rnd(-1, 1); player.y = 0;
    player.vx = player.vz = player.velY = 0;
    player.onGround = true;
    player.yaw = 0; player.pitch = 0.05; player.recoil = 0; player.bloom = 0;
    player.hp = player.maxHp; player.alive = true;
    player.ammo = player.magSize; player.reserve = Math.max(player.reserve, 120);
    player.reloading = false; player.ads = false; player.respawnT = 0;
    player.eyeH = EYE_H; player.deadRoll = 0; player.crouchBlend = 0;
    hud.setRespawn(null);
    audio.play('respawn');
  }

  // ---------- camera ----------
  function syncCamera(dt) {
    const tp = player.thirdPerson;
    const tgtEye = player.alive ? lerp(EYE_H, CROUCH_EYE, player.crouchBlend) : 0.3;
    player.eyeH += (tgtEye - player.eyeH) * Math.min(1, dt * 12);
    player.deadRoll += ((player.alive ? 0 : 0.7) - player.deadRoll) * Math.min(1, dt * 4);
    player.landDip = Math.max(0, player.landDip - dt * 0.35);

    playerMesh.position.set(player.x, player.y, player.z);
    playerMesh.rotation.y = player.yaw;
    playerMesh.visible = tp;
    viewmodel.visible = !tp && player.alive;

    getLookDir(_look);
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    if (tp) {
      _a.set(player.x, player.y + player.eyeH, player.z);
      _right.set(cy, 0, -sy);
      const back = player.ads ? 1.9 : 3.0, side = player.ads ? 0.5 : 0.8;
      _b.copy(_a).addScaledVector(_look, -back).addScaledVector(_right, side);
      _b.y += 0.2;
      _c.subVectors(_b, _a);
      const L = _c.length();
      _c.divideScalar(L);
      const h = raycastWorld(_a.x, _a.y, _a.z, _c.x, _c.y, _c.z, L + 0.2);
      _b.copy(_a).addScaledVector(_c, h ? Math.max(0.3, h.t - 0.2) : L);
      _b.y = Math.max(0.25, _b.y);
      camera.position.copy(_b);
      camera.lookAt(_b.x + _look.x * 20, _b.y + _look.y * 20, _b.z + _look.z * 20);
    } else {
      camera.position.set(player.x, player.y + player.eyeH - player.landDip, player.z);
      camera.lookAt(camera.position.x + _look.x, camera.position.y + _look.y, camera.position.z + _look.z);
    }
    const lateral = player.vx * cy - player.vz * sy; // velocity along the view's right axis
    player.lean += (-lateral * 0.0025 - player.lean) * Math.min(1, dt * 8);
    const roll = player.lean + player.deadRoll + (Math.random() - 0.5) * player.shake;
    if (roll) camera.rotateZ(roll);

    const base = settings.fov;
    const tf = player.ads ? base * (tp ? 0.78 : 0.8) : base + (player.sprinting ? 4 : 0);
    camera.fov += (tf - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // ---------- per-frame ----------
  function update(dt) {
    const now = performance.now() / 1000;
    player.fireCd = Math.max(0, player.fireCd - dt);
    player.bloom = Math.max(0, player.bloom - dt * 1.6);
    player.recoil = Math.max(0, player.recoil - dt * (0.05 + 1.2 * player.recoil));
    player.shake = Math.max(0, player.shake - dt * 3);
    const look = input.consumeLook();
    const k = input.keys, st = input.stick;

    if (player.respawnT > 0) {
      player.respawnT -= dt;
      if (player.respawnT <= 0) {
        const cb = respawnCb;
        respawnCb = null;
        respawn();
        if (cb) cb();
      }
    }
    hud.setRespawn(player.alive ? null : Math.max(0, Math.ceil(player.respawnT)));

    if (player.reloading) {
      player.reloadT += dt;
      if (player.reloadT >= RELOAD.total) finishReload();
    }

    let landed = false;
    if (player.alive) {
      let ix = 0, iz = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) iz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) iz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
      ix += st.x; iz += st.y;
      const len = Math.hypot(ix, iz);
      if (len > 1) { ix /= len; iz /= len; }
      const wantMove = len > 0.1;

      player.crouching = k.has('KeyC');
      const sprintKey = k.has('ShiftLeft') || k.has('ShiftRight');
      player.sprinting = sprintKey && iz < -0.2 && wantMove && !player.ads && !player.reloading && !player.crouching && !input.firing;

      let speed = WALK;
      if (player.sprinting) speed = SPRINT;
      else if (player.crouching) speed = CROUCH_SPEED;
      else if (player.ads) speed = ADS_SPEED;
      else if (player.reloading) speed = RELOAD_SPEED;
      if (iz > 0.2) speed *= 0.8;

      const cos = Math.cos(player.yaw), sin = Math.sin(player.yaw);
      const dvx = (ix * cos + iz * sin) * speed, dvz = (-ix * sin + iz * cos) * speed;
      const acc = Math.min(1, dt * (player.onGround ? 12 : 3));
      player.vx += (dvx - player.vx) * acc;
      player.vz += (dvz - player.vz) * acc;
      const res = resolveCircle(player.x + player.vx * dt, player.z + player.vz * dt, player.radius, player.y);
      player.x = res.x;
      player.z = res.z;
      player.speed2d = Math.hypot(player.vx, player.vz);
      player.moving = wantMove && player.speed2d > 0.3;

      if (player.onGround && k.has('Space') && !player.crouching) { player.velY = 6.4; player.onGround = false; }
      const fl = floorAt(player.x, player.z, player.y);
      player.velY -= 18 * dt;
      const pv = player.velY;
      player.y += player.velY * dt;
      if (player.y <= fl) {
        if (!player.onGround && pv < -4.5) { audio.play('land'); player.landDip = Math.min(0.14, -pv * 0.012); landed = true; }
        player.y = fl; player.velY = 0; player.onGround = true;
      } else if (player.y > fl + 0.03) player.onGround = false;

      player.noise = player.sprinting ? 1 : player.crouching ? 0.2 : player.speed2d > 0.8 ? 0.55 : 0;
      if (!isMulti() && player.hp < player.maxHp && now - player.lastHurtT > 5) {
        player.hp = Math.min(player.maxHp, player.hp + dt * 12);
      }
    } else {
      player.vx = player.vz = player.speed2d = player.noise = 0;
      player.sprinting = player.crouching = player.moving = false;
    }
    player.crouchBlend += ((player.crouching ? 1 : 0) - player.crouchBlend) * Math.min(1, dt * 10);

    syncCamera(dt);

    // animate BOTH rigs every frame (so reload progress is shared); only the visible one fires events
    const tp = player.thirdPerson;
    const common = {
      dt, moving: player.moving, grounded: player.onGround, ads: player.ads, sprint: player.sprinting,
      reloading: player.reloading, reloadT: player.reloadT,
    };
    updateHumanoidAnim(bodyU, {
      ...common, speed: player.speed2d, crouch: player.crouching, pitch: player.pitch + player.recoil,
      dead: !player.alive,
      onEvent: tp ? (n, i) => reloadEvent(n, i, false) : undefined,
      onStep: () => audio.play('step', undefined, undefined, { vol: player.crouching ? 0.3 : player.sprinting ? 1 : player.ads ? 0.5 : 0.6 }),
    });
    if (player.alive) {
      updateViewmodel(viewmodel, {
        ...common, lookDX: look.dx, lookDY: look.dy,
        onEvent: tp ? undefined : (n, i) => reloadEvent(n, i, true),
      });
    }

    if (player.alive && input.firing) shoot();

    audio.setListener(player.x, player.z, player.yaw);
    bullets.setListener(player.x, player.y + player.eyeH, player.z);
    hud.update(player);
    hud.setSpread(spread(), camera.fov);
    hud.setReload(player.reloading ? player.reloadT / RELOAD.total : -1);
  }

  return {
    update, shoot, startReload, toggleCamera, setAim, respawn, queueRespawn,
    applyDamage, syncHp, getLookDir,
  };
}
