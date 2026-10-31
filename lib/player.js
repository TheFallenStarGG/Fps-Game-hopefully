import { resolveCircle, lineBlocked, nearestCoverAwayFrom } from './collision.js';
import { updateHumanoidAnim, triggerShootKick, updateViewmodel, resetViewmodelReload } from './anim.js';

export function createPlayerState() {
  return {
    x: 0, z: 8, y: 0,
    yaw: 0, pitch: 0.15,
    hp: 100, maxHp: 100,
    speed: 8.5, velY: 0, onGround: true,
    alive: true,
    fireCd: 0,
    ammo: 30, magSize: 30, reserve: 90,
    reloading: false, reloadT: 0,
    ads: false,
    recoil: 0,
    radius: 0.45,
    thirdPerson: true,
    moving: false,
  };
}

export function createPlayerController({
  THREE, camera, playerMesh, player, keys, moveStick,
  isTouch, getFiringMobile,
  bullets, hud, enemy, raycaster,
  onLocalShoot,
  getRemotes,
  isMulti,
}) {
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _muzzle = new THREE.Vector3();

  function getLookDir(out) {
    const pitch = player.pitch + player.recoil;
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    out.set(-sy * cp, sp, -cy * cp).normalize();
    return out;
  }

  function toggleAim() {
    if (!player.alive || player.reloading) return;
    player.ads = !player.ads;
  }

  function startReload() {
    if (player.reloading || player.ammo >= player.magSize || player.reserve <= 0 || !player.alive) return;
    player.reloading = true;
    player.reloadT = 1.6;
    player.ads = false;
    resetViewmodelReload(playerMesh.userData.viewmodel);
    hud.setMsg('Reloading…', 1600);
  }

  function finishReload() {
    const need = player.magSize - player.ammo;
    const take = Math.min(need, player.reserve);
    player.ammo += take;
    player.reserve -= take;
    player.reloading = false;
    resetViewmodelReload(playerMesh.userData.viewmodel);
    hud.update(player, enemy);
  }

  function shoot() {
    if (!player.alive || player.fireCd > 0 || player.reloading) return;
    if (player.ammo <= 0) {
      startReload();
      return;
    }
    player.ammo -= 1;
    player.fireCd = player.ads ? 0.11 : 0.13;
    player.recoil += player.ads ? 0.02 : 0.045;
    player.recoil = Math.min(player.recoil, 0.22);

    const dir = getLookDir(_v);
    const origin = _v2.set(player.x, 1.45 + (player.y || 0), player.z).addScaledVector(dir, 0.5);
    bullets.spawn(origin.clone(), dir, 90, false);

    if (!player.thirdPerson && playerMesh.userData.vmMuzzle) {
      playerMesh.userData.vmMuzzle.getWorldPosition(_muzzle);
      bullets.muzzleFlash(_muzzle);
    } else if (playerMesh.userData.muzzle) {
      playerMesh.userData.muzzle.getWorldPosition(_muzzle);
      bullets.muzzleFlash(_muzzle);
    } else {
      bullets.muzzleFlash(origin.clone());
    }

    triggerShootKick(playerMesh.userData);
    if (!player.thirdPerson && playerMesh.userData.viewmodel) {
      updateViewmodel(playerMesh.userData.viewmodel, {
        shot: true, dt: 0.016, ads: player.ads, moving: player.moving,
        grounded: player.onGround, reloading: false,
      });
    }

    const spread = player.ads ? 0.008 : 0.035;
    const shootDir = dir.clone();
    shootDir.x += (Math.random() - 0.5) * spread;
    shootDir.y += (Math.random() - 0.5) * spread;
    shootDir.z += (Math.random() - 0.5) * spread;
    shootDir.normalize();
    raycaster.set(origin, shootDir);

    if (enemy.alive) {
      const hits = raycaster.intersectObject(enemy.mesh, true);
      if (hits.length && hits[0].distance < 100) {
        if (!lineBlocked(player.x, player.z, enemy.x, enemy.z, 1.4)) {
          const dmg = player.ads ? 24 : 16;
          enemy.hp -= dmg;
          enemy.lastHurt = performance.now() / 1000;
          if (hits[0].face) {
            const n = hits[0].face.normal.clone()
              .transformDirection(hits[0].object.matrixWorld);
            bullets.bulletHole(hits[0].point, n);
          } else {
            bullets.bulletHole(hits[0].point, new THREE.Vector3(0, 0, 1));
          }
          if (enemy.hp > 0) {
            enemy.state = 'cover';
            enemy.stateT = 1.2 + Math.random();
            const cover = nearestCoverAwayFrom(enemy.x, enemy.z, player.x, player.z);
            if (cover) {
              enemy.targetX = cover.x;
              enemy.targetZ = cover.z;
            }
          }
          if (enemy.hp <= 0) {
            enemy.hp = 0;
            enemy.alive = false;
            enemy.mesh.visible = false;
            hud.setMsg('Hostile down', 2000);
            setTimeout(() => {
              enemy.hp = enemy.maxHp;
              enemy.alive = true;
              enemy.x = (Math.random() - 0.5) * 18;
              enemy.z = -24 - Math.random() * 12;
              enemy.state = 'hunt';
              enemy.stateT = 0;
              enemy.mesh.visible = true;
              hud.update(player, enemy);
            }, 2500);
          }
          hud.update(player, enemy);
        }
      }
    }

    let targetId = null;
    const dmgOut = player.ads ? 24 : 16;
    if (typeof isMulti === 'function' && isMulti() && typeof getRemotes === 'function') {
      const remotes = getRemotes();
      for (const [rid, r] of remotes) {
        if (!r.alive) continue;
        const hits = raycaster.intersectObject(r.mesh, true);
        if (hits.length && hits[0].distance < 100) {
          if (!lineBlocked(player.x, player.z, r.x, r.z, 1.4)) {
            targetId = rid;
            if (hits[0].face) {
              const n = hits[0].face.normal.clone()
                .transformDirection(hits[0].object.matrixWorld);
              bullets.bulletHole(hits[0].point, n);
            }
            break;
          }
        }
      }
    }
    if (typeof onLocalShoot === 'function') {
      onLocalShoot({
        origin: origin.clone(),
        dir: shootDir.clone(),
        targetId,
        dmg: dmgOut,
      });
    }

    hud.update(player, enemy);
  }

  function respawn() {
    player.hp = player.maxHp;
    player.alive = true;
    player.x = 0; player.z = 8; player.y = 0; player.velY = 0;
    player.onGround = true;
    player.yaw = 0; player.pitch = 0.12;
    player.ammo = player.magSize;
    player.reloading = false;
    player.recoil = 0;
    player.ads = false;
    hud.update(player, enemy);
    hud.setMsg('Respawned');
  }

  function toggleCamera() {
    player.thirdPerson = !player.thirdPerson;
    hud.update(player, enemy);
    hud.setMsg(player.thirdPerson ? 'Third person' : 'First person', 1200);
  }

  function syncCamera(dt) {
    const bodyY = player.y || 0;
    playerMesh.position.set(player.x, bodyY, player.z);
    playerMesh.rotation.y = player.yaw;
    playerMesh.visible = player.thirdPerson;

    if (player.recoil > 0) {
      player.recoil = Math.max(0, player.recoil - dt * 0.55);
    }
    const pitch = player.pitch + player.recoil;
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const lx = -sy, lz = -cy;
    const rx = cy, rz = -sy;

    if (player.thirdPerson) {
      const back = player.ads ? 2.4 : 3.6;
      const side = player.ads ? 0.45 : 0.75;
      const up = 1.55 + bodyY + (player.ads ? -0.1 : 0.1);
      let camX = player.x - lx * back + rx * side;
      let camZ = player.z - lz * back + rz * side;
      const mid = resolveCircle(camX, camZ, 0.25);
      camera.position.set(mid.x, up + Math.sin(pitch) * -0.2, mid.z);
      camera.lookAt(player.x + lx * 8, 1.4 + bodyY + pitch * 3, player.z + lz * 8);
    } else {
      const eyeY = 1.55 + bodyY;
      camera.position.set(player.x, eyeY, player.z);
      const look = getLookDir(_v);
      camera.lookAt(player.x + look.x, eyeY + look.y, player.z + look.z);
    }

    const targetFov = player.ads
      ? (player.thirdPerson ? 38 : 32)
      : 70;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }

  function update(dt) {
    if (player.reloading) {
      player.reloadT -= dt;
      if (player.reloadT <= 0) finishReload();
    }

    if (!player.alive) {
      syncCamera(dt);
      return;
    }

    let ix = 0, iz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    ix += moveStick.x;
    iz += moveStick.y;
    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }
    player.moving = len > 0.1;

    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const speed = player.speed * (player.ads ? 0.5 : 1);
    let nx = player.x + (ix * cos + iz * sin) * speed * dt;
    let nz = player.z + (-ix * sin + iz * cos) * speed * dt;
    const res = resolveCircle(nx, nz, player.radius);
    player.x = res.x;
    player.z = res.z;

    if (player.onGround && keys.has('Space')) {
      player.velY = 7;
      player.onGround = false;
    }
    player.velY -= 20 * dt;
    player.y = (player.y || 0) + player.velY * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.velY = 0;
      player.onGround = true;
    }

    player.fireCd = Math.max(0, player.fireCd - dt);
    if (getFiringMobile()) shoot();

    updateHumanoidAnim(playerMesh.userData, {
      dt,
      moving: player.moving,
      grounded: player.onGround,
      ads: player.ads,
      reloading: player.reloading,
      speed: speed * (player.moving ? 1 : 0),
      pitch: player.pitch,
    });

    const vm = playerMesh.userData.viewmodel;
    if (vm && !player.thirdPerson) {
      updateViewmodel(vm, {
        dt,
        moving: player.moving,
        grounded: player.onGround,
        ads: player.ads,
        reloading: player.reloading,
        shot: false,
      });
    }

    syncCamera(dt);
  }

  return { update, shoot, startReload, toggleCamera, toggleAim, respawn, getLookDir };
}
