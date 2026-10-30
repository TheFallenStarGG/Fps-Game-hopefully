import * as THREE from 'three';

const canvas = document.getElementById('c');
const hpYouEl = document.getElementById('hpYou');
const hpEnemyEl = document.getElementById('hpEnemy');
const msgEl = document.getElementById('msg');
const startEl = document.getElementById('start');
const btnStart = document.getElementById('btnStart');
const ammoEl = document.getElementById('ammo');
const scopeV = document.getElementById('scopeVignette');

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('mobile');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7a92a8);
scene.fog = new THREE.Fog(0x7a92a8, 50, 130);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 200);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xddeeff, 0x3a4028, 1.05));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.15);
sun.position.set(25, 40, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x3f5a38, roughness: 0.92 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const colliders = [];

function addCover(x, z, w, h, d, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
  );
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  colliders.push({
    mesh,
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
    h,
    cx: x,
    cz: z,
    w,
    d,
  });
  return mesh;
}

addCover(-8, -6, 3.2, 2.2, 3.2, 0x6b5b4a);
addCover(10, -12, 4.2, 1.4, 2.4, 0x5a6a5a);
addCover(0, -20, 5.5, 1.8, 2.2, 0x4a5560);
addCover(-14, -22, 2.5, 2.5, 2.5, 0x555045);
addCover(14, -28, 3.5, 1.6, 3.5, 0x4d5c4d);
addCover(2, -8, 2, 1.2, 4, 0x5c5346);

function resolveCircle(x, z, radius) {
  let px = x, pz = z;
  for (const c of colliders) {
    const nearestX = Math.max(c.minX, Math.min(px, c.maxX));
    const nearestZ = Math.max(c.minZ, Math.min(pz, c.maxZ));
    let dx = px - nearestX;
    let dz = pz - nearestZ;
    const dist = Math.hypot(dx, dz);
    if (dist < radius) {
      if (dist < 1e-6) {
        const left = px - c.minX, right = c.maxX - px;
        const up = pz - c.minZ, down = c.maxZ - pz;
        const m = Math.min(left, right, up, down);
        if (m === left) px = c.minX - radius;
        else if (m === right) px = c.maxX + radius;
        else if (m === up) pz = c.minZ - radius;
        else pz = c.maxZ + radius;
      } else {
        const push = (radius - dist) / dist;
        px += dx * push;
        pz += dz * push;
      }
    }
  }
  px = Math.max(-92, Math.min(92, px));
  pz = Math.max(-92, Math.min(92, pz));
  return { x: px, z: pz };
}

function lineBlocked(ax, az, bx, bz, eyeY = 1.4) {
  for (const c of colliders) {
    if (c.h < eyeY - 0.2) continue;
    if (segmentHitsAabb(ax, az, bx, bz, c.minX, c.maxX, c.minZ, c.maxZ)) return true;
  }
  return false;
}

function segmentHitsAabb(x1, z1, x2, z2, minX, maxX, minZ, maxZ) {
  let dx = x2 - x1, dz = z2 - z1;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, x1 - minX) &&
    clip(dx, maxX - x1) &&
    clip(-dz, z1 - minZ) &&
    clip(dz, maxZ - z1) &&
    t0 < t1
  );
}

function nearestCoverAwayFrom(px, pz, threatX, threatZ) {
  let best = null, bestScore = -Infinity;
  for (const c of colliders) {
    const awayX = c.cx - threatX;
    const awayZ = c.cz - threatZ;
    const len = Math.hypot(awayX, awayZ) || 1;
    const sx = c.cx + (awayX / len) * (c.w / 2 + 1.2);
    const sz = c.cz + (awayZ / len) * (c.d / 2 + 1.2);
    const distMe = Math.hypot(sx - px, sz - pz);
    const distThreat = Math.hypot(sx - threatX, sz - threatZ);
    const score = distThreat - distMe * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = { x: sx, z: sz, collider: c };
    }
  }
  return best;
}

function makeHumanoid(primary, secondary, isPlayer) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.65 });
  const skinMat = new THREE.MeshStandardMaterial({ color: isPlayer ? 0xc4a574 : 0x8a6a55, roughness: 0.75 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.32), bodyMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  root.add(torso);

  const headM = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.32), skinMat);
  headM.position.y = 1.7;
  headM.castShadow = true;
  root.add(headM);

  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.36), darkMat);
  helm.position.y = 1.88;
  root.add(helm);

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.22), darkMat);
  legL.position.set(-0.14, 0.35, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  root.add(legL, legR);

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), bodyMat);
  armL.position.set(-0.4, 1.15, 0);
  const armR = armL.clone();
  armR.position.x = 0.4;
  root.add(armL, armR);

  const rifle = new THREE.Group();
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.25), darkMat);
  stock.position.set(0.28, 1.15, -0.15);
  const rec = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.14, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.4, roughness: 0.4 })
  );
  rec.position.set(0.28, 1.18, -0.45);
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x111 })
  );
  bar.position.set(0.28, 1.2, -0.8);
  rifle.add(stock, rec, bar);
  root.add(rifle);

  root.userData = { torso, headM, armR, rifle };
  return root;
}

const playerMesh = makeHumanoid(0x3d6b9a, 0x1e2a38, true);
scene.add(playerMesh);

const enemyMesh = makeHumanoid(0x8b2e2e, 0x2a1515, false);
scene.add(enemyMesh);

const player = {
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
};

const enemy = {
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
  mesh: enemyMesh,
};

const keys = new Set();
const moveStick = { x: 0, y: 0 };
let stickTouchId = null, lookTouchId = null;
let firingMobile = false, aimMobile = false;
let lastLookX = null, lastLookY = null;
let rmbDown = false;

const bulletGeo = new THREE.SphereGeometry(0.05, 6, 6);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
const enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff5555 });
const bullets = [];
const raycaster = new THREE.Raycaster();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function setMsg(t, ms = 1800) {
  msgEl.textContent = t || '';
  if (t && ms) setTimeout(() => { if (msgEl.textContent === t) msgEl.textContent = ''; }, ms);
}

function updateHud() {
  hpYouEl.style.transform = `scaleX(${Math.max(0, player.hp / player.maxHp)})`;
  hpEnemyEl.style.transform = `scaleX(${Math.max(0, enemy.hp / enemy.maxHp)})`;
  if (ammoEl) {
    ammoEl.textContent = player.reloading
      ? 'RELOADING…'
      : `${player.ammo} / ${player.reserve}`;
  }
  if (scopeV) scopeV.style.display = player.ads ? 'block' : 'none';
}

function respawnPlayer() {
  player.hp = player.maxHp;
  player.alive = true;
  player.x = 0; player.z = 8; player.velY = 0;
  player.yaw = 0; player.pitch = 0.12;
  player.ammo = player.magSize;
  player.reloading = false;
  player.recoil = 0;
  updateHud();
  setMsg('Respawned');
}

function resetEnemy() {
  enemy.hp = enemy.maxHp;
  enemy.alive = true;
  enemy.x = (Math.random() - 0.5) * 18;
  enemy.z = -24 - Math.random() * 12;
  enemy.state = 'hunt';
  enemy.stateT = 0;
  enemy.mesh.visible = true;
  updateHud();
}

function startReload() {
  if (player.reloading || player.ammo >= player.magSize || player.reserve <= 0 || !player.alive) return;
  player.reloading = true;
  player.reloadT = 1.6;
  setMsg('Reloading…', 1600);
}

function finishReload() {
  const need = player.magSize - player.ammo;
  const take = Math.min(need, player.reserve);
  player.ammo += take;
  player.reserve -= take;
  player.reloading = false;
  updateHud();
}

function getLookDir(out) {
  const pitch = player.pitch + player.recoil;
  const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  out.set(-sy * cp, sp, -cy * cp).normalize();
  return out;
}

function playerShoot() {
  if (!player.alive || player.fireCd > 0 || player.reloading) return;
  if (player.ammo <= 0) {
    startReload();
    return;
  }
  player.ammo -= 1;
  player.fireCd = player.ads ? 0.11 : 0.13;
  player.recoil += player.ads ? 0.028 : 0.045;
  player.recoil = Math.min(player.recoil, 0.22);

  const dir = getLookDir(_v);
  const origin = _v2.set(player.x, 1.45, player.z).addScaledVector(dir, 0.4);
  spawnBullet(origin.clone(), dir, 90, false);

  const spread = player.ads ? 0.012 : 0.035;
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
        const dmg = player.ads ? 22 : 16;
        enemy.hp -= dmg;
        enemy.lastHurt = performance.now() / 1000;
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
          setMsg('Hostile down', 2000);
          setTimeout(resetEnemy, 2500);
        }
        updateHud();
      }
    }
  }
  updateHud();
}

function spawnBullet(origin, dir, speed, fromEnemy) {
  const mesh = new THREE.Mesh(bulletGeo, fromEnemy ? enemyBulletMat : bulletMat);
  mesh.position.copy(origin);
  scene.add(mesh);
  bullets.push({ mesh, vel: dir.clone().normalize().multiplyScalar(speed), life: 1.0 });
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

function enemyUpdate(dt, now) {
  if (!enemy.alive || !player.alive) {
    syncEnemyMesh();
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
  } else {
    tx = player.x;
    tz = player.z;
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
    enemy.yaw = Math.atan2(dx, dz);
  }

  const faceX = player.x - enemy.x;
  const faceZ = player.z - enemy.z;
  enemy.yaw = Math.atan2(faceX, faceZ);

  const canShoot =
    enemy.state !== 'cover' &&
    los &&
    dist < 45 &&
    dist > 3 &&
    enemy.fireCd <= 0;

  if (canShoot) {
    enemy.fireCd = 0.48 + Math.random() * 0.2;
    const aim = _v.set(player.x - enemy.x, 1.35 - 1.2, player.z - enemy.z).normalize();
    const err = 0.018 + (d > 1 ? 0.01 : 0.03);
    aim.x += (Math.random() - 0.5) * err;
    aim.y += (Math.random() - 0.5) * err * 0.6;
    aim.z += (Math.random() - 0.5) * err;
    aim.normalize();
    const muzzle = _v2.set(enemy.x, 1.35, enemy.z).addScaledVector(aim, 0.7);
    spawnBullet(muzzle.clone(), aim, 55, true);

    raycaster.set(muzzle, aim);
    const toHead = new THREE.Vector3(player.x, 1.45, player.z).sub(muzzle);
    const t = toHead.dot(aim);
    if (t > 0 && t < 70) {
      const closest = muzzle.clone().addScaledVector(aim, t);
      if (closest.distanceTo(new THREE.Vector3(player.x, 1.45, player.z)) < 0.7) {
        if (!lineBlocked(enemy.x, enemy.z, player.x, player.z, 1.4)) {
          player.hp -= 11;
          if (player.hp <= 0) {
            player.hp = 0;
            player.alive = false;
            updateHud();
            setMsg('You were dropped — respawning…', 2000);
            setTimeout(respawnPlayer, 2000);
          } else updateHud();
        }
      }
    }
  }

  syncEnemyMesh();
}

function syncEnemyMesh() {
  enemy.mesh.position.set(enemy.x, 0, enemy.z);
  enemy.mesh.rotation.y = enemy.yaw;
  enemy.mesh.visible = enemy.alive;
}

function syncPlayerMeshAndCamera(dt) {
  playerMesh.position.set(player.x, 0, player.z);
  playerMesh.rotation.y = player.yaw;

  if (player.recoil > 0) {
    player.recoil = Math.max(0, player.recoil - dt * 0.55);
  }

  const pitch = player.pitch + player.recoil;
  const back = player.ads ? 2.4 : 3.6;
  const side = player.ads ? 0.45 : 0.75;
  const up = player.ads ? 1.45 : 1.65;
  const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
  const lx = -sy, lz = -cy;
  const rx = cy, rz = -sy;
  let camX = player.x - lx * back + rx * side;
  let camZ = player.z - lz * back + rz * side;
  let camY = up + Math.sin(pitch) * -0.3;

  const mid = resolveCircle(camX, camZ, 0.25);
  camX = mid.x;
  camZ = mid.z;

  camera.position.set(camX, camY, camZ);
  const lookTarget = new THREE.Vector3(
    player.x + lx * 8,
    1.4 + pitch * 3,
    player.z + lz * 8
  );
  camera.lookAt(lookTarget);
  camera.fov = player.ads ? 42 : 70;
  camera.updateProjectionMatrix();
}

function updatePlayer(dt) {
  if (player.reloading) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) finishReload();
  }

  player.ads = (!isTouch && rmbDown) || aimMobile;
  if (!player.alive) {
    syncPlayerMeshAndCamera(dt);
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

  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const speed = player.speed * (player.ads ? 0.55 : 1);
  let nx = player.x + (ix * cos + iz * sin) * speed * dt;
  let nz = player.z + (-ix * sin + iz * cos) * speed * dt;
  const res = resolveCircle(nx, nz, player.radius);
  player.x = res.x;
  player.z = res.z;

  if (player.onGround && keys.has('Space')) {
    player.velY = 7;
    player.onGround = false;
  }
  player.velY -= 18 * dt;
  player.fireCd = Math.max(0, player.fireCd - dt);
  if (firingMobile) playerShoot();

  syncPlayerMeshAndCamera(dt);
}

addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR') startReload();
});
addEventListener('keyup', (e) => keys.delete(e.code));

canvas.addEventListener('click', () => {
  if (isTouch) return;
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  else playerShoot();
});
addEventListener('mousedown', (e) => {
  if (isTouch) return;
  if (e.button === 2) rmbDown = true;
  if (e.button === 0 && document.pointerLockElement === canvas) playerShoot();
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) rmbDown = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0020;
  player.pitch = Math.max(-0.55, Math.min(0.75, player.pitch));
});

const stick = document.getElementById('stick');
const knob = document.getElementById('knob');
const lookZone = document.getElementById('lookZone');
const btnFire = document.getElementById('btnFire');
const btnJump = document.getElementById('btnJump');
const btnAim = document.getElementById('btnAim');
const btnReload = document.getElementById('btnReload');

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
  for (const t of e.changedTouches) if (t.identifier === stickTouchId) stickFromTouch(t.clientX, t.clientY);
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
      player.pitch -= (t.clientY - lastLookY) * 0.0045;
      player.pitch = Math.max(-0.55, Math.min(0.75, player.pitch));
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
if (btnAim) {
  btnAim.addEventListener('touchstart', (e) => { e.preventDefault(); aimMobile = true; }, { passive: false });
  btnAim.addEventListener('touchend', () => { aimMobile = false; });
}
if (btnReload) {
  btnReload.addEventListener('touchstart', (e) => { e.preventDefault(); startReload(); }, { passive: false });
}

let last = performance.now();
let running = false;
function frame(now) {
  requestAnimationFrame(frame);
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  updatePlayer(dt);
  enemyUpdate(dt, t);
  updateBullets(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

btnStart.addEventListener('click', async () => {
  startEl.style.display = 'none';
  running = true;
  last = performance.now();
  updateHud();
  if (!isTouch) { try { await canvas.requestPointerLock(); } catch (_) {} }
  setMsg(isTouch ? 'Stick · look · fire · aim · reload' : 'RMB aim · R reload · click shoot', 2500);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
});

updateHud();
