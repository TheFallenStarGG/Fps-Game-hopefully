import { resolveCircle, lineBlocked, nearestCoverAwayFrom } from './collision.js';

export function createEnemy(mesh) {
  return {
    x: 0, z: -28, yaw: 0,
    hp: 100, maxHp: 100,
    alive: true,
    fireCd: 0,
    state: 'hunt',
    stateT: 0,
    targetX: 0, targetZ: -28,
    speed: 5.2,
    radius: 0.45,
    lastHurt: 0,
    mesh,
  };
}

export function updateEnemy(dt, now, enemy, player, THREE, bullets, raycaster, hud, onPlayerHit) {
  if (!enemy.alive || !player.alive) {
    sync(enemy);
    return;
  }

  enemy.stateT -= dt;
  enemy.fireCd -= dt;

  const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
  const los = !lineBlocked(enemy.x, enemy.z, player.x, player.z, 1.4);
  const hurtRecent = now - enemy.lastHurt < 2.5;
  const lowHp = enemy.hp < 40;

  if (enemy.state === 'cover') {
    if (enemy.stateT <= 0 && !hurtRecent) enemy.state = lowHp ? 'flank' : 'attack';
  } else if (hurtRecent || lowHp) {
    if (enemy.state !== 'cover') {
      enemy.state = 'cover';
      enemy.stateT = lowHp ? 2.2 : 1.3;
      const cover = nearestCoverAwayFrom(enemy.x, enemy.z, player.x, player.z);
      if (cover) {
        enemy.targetX = cover.x;
        enemy.targetZ = cover.z;
      }
    }
  } else if (los && dist < 42) {
    enemy.state = 'attack';
  } else if (dist > 48) {
    enemy.state = 'hunt';
  } else if (enemy.state === 'hunt' && dist < 35) {
    enemy.state = Math.random() < 0.4 ? 'flank' : 'attack';
    enemy.stateT = 2;
  }

  let tx = player.x, tz = player.z;
  if (enemy.state === 'cover') {
    tx = enemy.targetX;
    tz = enemy.targetZ;
  } else if (enemy.state === 'flank') {
    const ang = Math.atan2(player.x - enemy.x, player.z - enemy.z) + (Math.random() < 0.5 ? 1.1 : -1.1);
    tx = player.x + Math.sin(ang) * 12;
    tz = player.z + Math.cos(ang) * 12;
  } else if (enemy.state === 'attack') {
    if (dist < 12) {
      const ang = Math.atan2(enemy.x - player.x, enemy.z - player.z);
      tx = player.x + Math.sin(ang) * 16;
      tz = player.z + Math.cos(ang) * 16;
    } else if (dist > 28) {
      tx = player.x;
      tz = player.z;
    } else {
      tx = enemy.x;
      tz = enemy.z;
    }
  }

  const dx = tx - enemy.x;
  const dz = tz - enemy.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.15) {
    const sp = enemy.state === 'cover' ? enemy.speed * 1.15 : enemy.speed;
    const nx = enemy.x + (dx / d) * sp * dt;
    const nz = enemy.z + (dz / d) * sp * dt;
    const resolved = resolveCircle(nx, nz, enemy.radius);
    enemy.x = resolved.x;
    enemy.z = resolved.z;
  }

  enemy.yaw = Math.atan2(player.x - enemy.x, player.z - enemy.z);

  const canShoot =
    enemy.state !== 'cover' &&
    los &&
    dist < 45 &&
    dist > 3 &&
    enemy.fireCd <= 0;

  if (canShoot) {
    enemy.fireCd = 0.48 + Math.random() * 0.2;
    const aim = new THREE.Vector3(player.x - enemy.x, 0.15, player.z - enemy.z).normalize();
    const err = 0.018 + (d > 1 ? 0.01 : 0.03);
    aim.x += (Math.random() - 0.5) * err;
    aim.y += (Math.random() - 0.5) * err * 0.6;
    aim.z += (Math.random() - 0.5) * err;
    aim.normalize();
    const muzzle = new THREE.Vector3(enemy.x, 1.35, enemy.z).addScaledVector(aim, 0.7);
    bullets.spawn(muzzle.clone(), aim, 55, true);

    raycaster.set(muzzle, aim);
    const toHead = new THREE.Vector3(player.x, 1.45, player.z).sub(muzzle);
    const t = toHead.dot(aim);
    if (t > 0 && t < 70) {
      const closest = muzzle.clone().addScaledVector(aim, t);
      if (closest.distanceTo(new THREE.Vector3(player.x, 1.45, player.z)) < 0.7) {
        if (!lineBlocked(enemy.x, enemy.z, player.x, player.z, 1.4)) {
          onPlayerHit(11);
        }
      }
    }
  }

  sync(enemy);
}

function sync(enemy) {
  enemy.mesh.position.set(enemy.x, 0, enemy.z);
  enemy.mesh.rotation.y = enemy.yaw;
  enemy.mesh.visible = enemy.alive;
    }
