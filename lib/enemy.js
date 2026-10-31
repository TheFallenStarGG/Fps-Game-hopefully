import { resolveCircle, lineBlocked, nearestCoverAwayFrom, colliders } from './collision.js';
import { updateHumanoidAnim, triggerShootKick } from './anim.js';

export function createEnemy(mesh) {
  return {
    x: 0, z: -28, yaw: 0,
    hp: 100, maxHp: 100,
    alive: true,
    fireCd: 0,
    state: 'hunt',
    stateT: 0,
    targetX: 0, targetZ: -28,
    speed: 5.4,
    radius: 0.45,
    lastHurt: 0,
    mesh,
    moving: false,
    lastSeenX: 0,
    lastSeenZ: -8,
    lastSeenT: 0,
    hasSeen: false,
    strafeDir: 1,
    peekSide: 1,
    accuracy: 1,
    coverX: 0,
    coverZ: 0,
    shotsInBurst: 0,
    rethinkT: 0,
  };
}

function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.hypot(dx, dz);
}

function hasLos(ex, ez, px, pz) {
  return !lineBlocked(ex, ez, px, pz, 1.4);
}

function pickBestCover(ex, ez, px, pz) {
  let best = null;
  let bestScore = -Infinity;
  for (const c of colliders) {
    for (const side of [-1, 1]) {
      for (const axis of ['x', 'z']) {
        let sx, sz;
        if (axis === 'x') {
          sx = side < 0 ? c.minX - 1.15 : c.maxX + 1.15;
          sz = c.cz;
        } else {
          sx = c.cx;
          sz = side < 0 ? c.minZ - 1.15 : c.maxZ + 1.15;
        }
        const toPlayer = dist2(sx, sz, px, pz);
        if (toPlayer < 6) continue;
        const toMe = dist2(sx, sz, ex, ez);
        if (toMe > 45) continue;
        const blocked = !hasLos(sx, sz, px, pz);
        let score = (blocked ? 40 : 0) + toPlayer * 0.35 - toMe * 0.5;
        score += c.h * 2 + (c.w + c.d) * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = { x: sx, z: sz, blocked };
        }
      }
    }
  }
  return best;
}

function peekPoint(coverX, coverZ, px, pz) {
  const dx = px - coverX;
  const dz = pz - coverZ;
  const len = Math.hypot(dx, dz) || 1;
  const fx = dx / len, fz = dz / len;
  const rx = -fz, rz = fx;
  const side = Math.random() < 0.5 ? 1 : -1;
  return {
    x: coverX + rx * side * 1.4 + fx * 0.4,
    z: coverZ + rz * side * 1.4 + fz * 0.4,
  };
}

function setState(enemy, state, duration) {
  enemy.state = state;
  enemy.stateT = duration;
}

export function updateEnemy(dt, now, enemy, player, THREE, bullets, raycaster, hud, onPlayerHit) {
  if (!enemy.alive) {
    sync(enemy);
    return;
  }
  if (!player.alive) {
    enemy.moving = false;
    updateHumanoidAnim(enemy.mesh.userData, {
      dt, moving: false, grounded: true, ads: false, reloading: false, speed: 0, pitch: 0,
    });
    sync(enemy);
    return;
  }

  enemy.stateT -= dt;
  enemy.fireCd -= dt;
  enemy.rethinkT -= dt;

  const px = player.x;
  const pz = player.z;
  const py = 1.45 + (player.y || 0);
  const dist = dist2(enemy.x, enemy.z, px, pz);
  const los = hasLos(enemy.x, enemy.z, px, pz);
  const hurtRecent = now - enemy.lastHurt < 2.8;
  const lowHp = enemy.hp < 45;
  const critical = enemy.hp < 25;

  if (los) {
    enemy.lastSeenX = px;
    enemy.lastSeenZ = pz;
    enemy.lastSeenT = now;
    enemy.hasSeen = true;
    enemy.accuracy = Math.min(1.15, enemy.accuracy + dt * 0.35);
  } else {
    enemy.accuracy = Math.max(0.35, enemy.accuracy - dt * 0.15);
  }

  if (hurtRecent && enemy.state !== 'cover' && enemy.state !== 'peek') {
    const cover = pickBestCover(enemy.x, enemy.z, px, pz) || nearestCoverAwayFrom(enemy.x, enemy.z, px, pz);
    if (cover) {
      enemy.coverX = cover.x;
      enemy.coverZ = cover.z;
      enemy.targetX = cover.x;
      enemy.targetZ = cover.z;
      setState(enemy, 'cover', critical ? 3.5 : 2.2);
    }
  }

  if (enemy.rethinkT <= 0 || enemy.stateT <= 0) {
    enemy.rethinkT = 0.35 + Math.random() * 0.4;

    if (enemy.state === 'cover') {
      const atCover = dist2(enemy.x, enemy.z, enemy.targetX, enemy.targetZ) < 1.2;
      if (atCover && enemy.stateT <= 0.8) {
        if (lowHp && Math.random() < 0.4) {
          const cover = pickBestCover(enemy.x, enemy.z, px, pz);
          if (cover) {
            enemy.coverX = cover.x;
            enemy.coverZ = cover.z;
            enemy.targetX = cover.x;
            enemy.targetZ = cover.z;
            setState(enemy, 'cover', 2.5);
          } else {
            setState(enemy, 'peek', 1.2);
            const pk = peekPoint(enemy.coverX, enemy.coverZ, px, pz);
            enemy.targetX = pk.x;
            enemy.targetZ = pk.z;
          }
        } else {
          setState(enemy, 'peek', 1.0 + Math.random() * 0.8);
          const pk = peekPoint(enemy.coverX || enemy.x, enemy.coverZ || enemy.z, px, pz);
          enemy.targetX = pk.x;
          enemy.targetZ = pk.z;
        }
      }
    } else if (enemy.state === 'peek') {
      if (enemy.stateT <= 0) {
        if (los && dist < 40 && !critical) {
          setState(enemy, Math.random() < 0.55 ? 'strafe' : 'attack', 1.5 + Math.random());
          enemy.strafeDir = Math.random() < 0.5 ? 1 : -1;
        } else {
          setState(enemy, 'cover', 2);
          enemy.targetX = enemy.coverX || enemy.x;
          enemy.targetZ = enemy.coverZ || enemy.z;
        }
      }
    } else if (!los && enemy.hasSeen) {
      if (enemy.state !== 'search' && enemy.state !== 'cover') {
        setState(enemy, 'search', 4);
        enemy.targetX = enemy.lastSeenX;
        enemy.targetZ = enemy.lastSeenZ;
      } else if (enemy.state === 'search' && enemy.stateT <= 0) {
        setState(enemy, 'hunt', 3);
      }
    } else if (los) {
      if (critical) {
        const cover = pickBestCover(enemy.x, enemy.z, px, pz);
        if (cover) {
          enemy.coverX = cover.x;
          enemy.coverZ = cover.z;
          enemy.targetX = cover.x;
          enemy.targetZ = cover.z;
          setState(enemy, 'cover', 3);
        }
      } else if (dist > 38) {
        setState(enemy, 'advance', 2);
      } else if (dist < 10) {
        setState(enemy, 'strafe', 1.2);
        enemy.strafeDir = Math.random() < 0.5 ? 1 : -1;
      } else if (enemy.state === 'hunt' || enemy.state === 'search' || enemy.stateT <= 0) {
        const r = Math.random();
        if (r < 0.35) {
          setState(enemy, 'strafe', 1.8);
          enemy.strafeDir = Math.random() < 0.5 ? 1 : -1;
        } else if (r < 0.55) {
          setState(enemy, 'flank', 2.5);
        } else {
          setState(enemy, 'attack', 1.6);
        }
      }
    } else {
      setState(enemy, 'hunt', 2);
    }
  }

  let tx = enemy.targetX;
  let tz = enemy.targetZ;
  let moveSpeed = enemy.speed;

  if (enemy.state === 'advance' || (enemy.state === 'hunt' && los)) {
    tx = px;
    tz = pz;
    moveSpeed = enemy.speed * 1.05;
  } else if (enemy.state === 'attack') {
    if (dist < 14) {
      const ang = Math.atan2(enemy.x - px, enemy.z - pz);
      tx = px + Math.sin(ang) * 18;
      tz = pz + Math.cos(ang) * 18;
    } else if (dist > 26) {
      tx = px;
      tz = pz;
    } else {
      tx = enemy.x;
      tz = enemy.z;
    }
    moveSpeed = enemy.speed * 0.75;
  } else if (enemy.state === 'strafe') {
    const ang = Math.atan2(px - enemy.x, pz - enemy.z);
    const side = enemy.strafeDir;
    tx = enemy.x + Math.cos(ang) * side * 8 - Math.sin(ang) * (dist > 20 ? 3 : -1);
    tz = enemy.z - Math.sin(ang) * side * 8 - Math.cos(ang) * (dist > 20 ? 3 : -1);
    if (dist < 12) {
      tx += (enemy.x - px) * 0.15;
      tz += (enemy.z - pz) * 0.15;
    }
    moveSpeed = enemy.speed * 1.1;
  } else if (enemy.state === 'flank') {
    const ang = Math.atan2(px - enemy.x, pz - enemy.z) + enemy.strafeDir * 1.2;
    tx = px + Math.sin(ang) * 14;
    tz = pz + Math.cos(ang) * 14;
    moveSpeed = enemy.speed * 1.15;
  } else if (enemy.state === 'cover') {
    tx = enemy.targetX;
    tz = enemy.targetZ;
    moveSpeed = enemy.speed * 1.25;
  } else if (enemy.state === 'peek') {
    tx = enemy.targetX;
    tz = enemy.targetZ;
    moveSpeed = enemy.speed * 0.9;
  } else if (enemy.state === 'search') {
    tx = enemy.lastSeenX;
    tz = enemy.lastSeenZ;
    if (dist2(enemy.x, enemy.z, tx, tz) < 2) {
      tx = enemy.lastSeenX + (Math.random() - 0.5) * 10;
      tz = enemy.lastSeenZ + (Math.random() - 0.5) * 10;
    }
    moveSpeed = enemy.speed * 0.95;
  } else {
    if (enemy.hasSeen) {
      tx = enemy.lastSeenX;
      tz = enemy.lastSeenZ;
    } else {
      tx = px;
      tz = pz;
    }
  }

  const mdx = tx - enemy.x;
  const mdz = tz - enemy.z;
  const md = Math.hypot(mdx, mdz);
  enemy.moving = md > 0.25;
  if (md > 0.2) {
    const nx = enemy.x + (mdx / md) * moveSpeed * dt;
    const nz = enemy.z + (mdz / md) * moveSpeed * dt;
    const resolved = resolveCircle(nx, nz, enemy.radius);
    enemy.x = resolved.x;
    enemy.z = resolved.z;
  }

  if (los || now - enemy.lastSeenT < 3) {
    enemy.yaw = Math.atan2(
      (los ? px : enemy.lastSeenX) - enemy.x,
      (los ? pz : enemy.lastSeenZ) - enemy.z
    );
  } else if (enemy.moving) {
    enemy.yaw = Math.atan2(mdx, mdz);
  }

  const canShootState =
    enemy.state === 'attack' ||
    enemy.state === 'strafe' ||
    enemy.state === 'peek' ||
    enemy.state === 'flank' ||
    (enemy.state === 'advance' && dist < 32);

  const inCoverDeep =
    enemy.state === 'cover' && dist2(enemy.x, enemy.z, enemy.targetX, enemy.targetZ) > 1.5;

  if (
    canShootState &&
    !inCoverDeep &&
    los &&
    dist > 4 &&
    dist < 48 &&
    enemy.fireCd <= 0
  ) {
    if (enemy.shotsInBurst >= 3) {
      enemy.fireCd = 0.55 + Math.random() * 0.3;
      enemy.shotsInBurst = 0;
    } else {
      enemy.fireCd = 0.14 + Math.random() * 0.08;
      enemy.shotsInBurst += 1;
    }

    const aim = new THREE.Vector3(
      px - enemy.x,
      py - 1.35,
      pz - enemy.z
    ).normalize();

    let err = 0.04;
    err *= 1.4 - enemy.accuracy * 0.5;
    if (enemy.moving) err *= 1.35;
    if (enemy.state === 'peek' || enemy.state === 'attack') err *= 0.7;
    if (enemy.state === 'strafe') err *= 1.15;
    if (dist > 30) err *= 1.3;
    if (hurtRecent) err *= 1.25;

    aim.x += (Math.random() - 0.5) * err;
    aim.y += (Math.random() - 0.5) * err * 0.55;
    aim.z += (Math.random() - 0.5) * err;
    aim.normalize();

    const muzzle = new THREE.Vector3(enemy.x, 1.35, enemy.z).addScaledVector(aim, 0.7);
    bullets.spawn(muzzle.clone(), aim, 58, true);
    if (enemy.mesh.userData.muzzle) {
      const mp = new THREE.Vector3();
      enemy.mesh.userData.muzzle.getWorldPosition(mp);
      bullets.muzzleFlash(mp);
    } else {
      bullets.muzzleFlash(muzzle);
    }
    triggerShootKick(enemy.mesh.userData);

    raycaster.set(muzzle, aim);
    const toHead = new THREE.Vector3(px, py, pz).sub(muzzle);
    const t = toHead.dot(aim);
    if (t > 0 && t < 75) {
      const closest = muzzle.clone().addScaledVector(aim, t);
      if (closest.distanceTo(new THREE.Vector3(px, py, pz)) < 0.72) {
        if (hasLos(enemy.x, enemy.z, px, pz)) {
          onPlayerHit(10 + (enemy.state === 'peek' ? 2 : 0));
        }
      }
    }
  } else if (enemy.fireCd <= 0) {
    enemy.shotsInBurst = 0;
  }

  updateHumanoidAnim(enemy.mesh.userData, {
    dt,
    moving: enemy.moving,
    grounded: true,
    ads: enemy.state === 'peek' || enemy.state === 'attack' || (los && dist < 28),
    reloading: false,
    speed: enemy.moving ? moveSpeed : 0,
    pitch: 0,
  });

  sync(enemy);
}

function sync(enemy) {
  enemy.mesh.position.set(enemy.x, 0, enemy.z);
  enemy.mesh.rotation.y = enemy.yaw;
  enemy.mesh.visible = enemy.alive;
}
