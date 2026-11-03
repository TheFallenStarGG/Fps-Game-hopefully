/**
 * Driveable vehicles — sedan, truck, van, motorcycle.
 * Enter with E / USE near a vehicle. Cam toggles cabin FP vs chase cam.
 */
import * as THREE from 'three';
import { heightAt } from './ground.js';
import { resolveCircle, raycastWorld } from './collision.js';
import { POIS } from './mapLayout.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

/** Handling profiles */
export const VEHICLE_TYPES = {
  sedan: {
    id: 'sedan', name: 'Sedan',
    maxSpeed: 28, accel: 18, brake: 32, turn: 2.1, offroad: 0.55,
    tank: 55, hp: 120, seats: 1,
    size: { L: 4.4, W: 1.85, H: 1.45 },
    mass: 1.0,
  },
  truck: {
    id: 'truck', name: 'Truck',
    maxSpeed: 22, accel: 12, brake: 28, turn: 1.5, offroad: 0.95,
    tank: 80, hp: 200, seats: 1,
    size: { L: 5.6, W: 2.2, H: 2.1 },
    mass: 1.6,
  },
  van: {
    id: 'van', name: 'Van',
    maxSpeed: 24, accel: 14, brake: 26, turn: 1.7, offroad: 0.7,
    tank: 70, hp: 160, seats: 1,
    size: { L: 5.0, W: 2.0, H: 2.0 },
    mass: 1.3,
  },
  motorcycle: {
    id: 'motorcycle', name: 'Motorcycle',
    maxSpeed: 34, accel: 26, brake: 36, turn: 2.8, offroad: 0.4,
    tank: 28, hp: 70, seats: 1,
    size: { L: 2.2, W: 0.7, H: 1.1 },
    mass: 0.45,
  },
};

const COLORS = [0xc43c3c, 0x3a6fc4, 0xd4b03a, 0x3a9e5c, 0x8a3cb8, 0xd4782a, 0x2a2a2e, 0xe8e8ec];

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.25,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite !== false,
  });
}

/** Procedural vehicle mesh */
function buildMesh(typeId, colorHex) {
  const t = VEHICLE_TYPES[typeId] || VEHICLE_TYPES.sedan;
  const g = new THREE.Group();
  g.name = 'vehicle_' + typeId;
  const bodyCol = colorHex ?? COLORS[(Math.random() * COLORS.length) | 0];
  const bodyM = mat(bodyCol, { roughness: 0.4, metalness: 0.35 });
  const darkM = mat(0x1a1a1e, { roughness: 0.7, metalness: 0.4 });
  const glassM = mat(0x88b8d8, { roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.38, depthWrite: false });
  const tireM = mat(0x111111, { roughness: 0.95, metalness: 0.05 });
  const rimM = mat(0xbbbbbb, { roughness: 0.35, metalness: 0.8 });
  const chromeM = mat(0xcccccc, { roughness: 0.25, metalness: 0.9 });

  const L = t.size.L, W = t.size.W, H = t.size.H;
  const wheels = [];

  if (typeId === 'motorcycle') {
    // Frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, 0.18, 0.22), bodyM);
    frame.position.y = 0.55;
    g.add(frame);
    // Tank
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.35), bodyM);
    tank.position.set(0.1, 0.78, 0);
    g.add(tank);
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.32), darkM);
    seat.position.set(-0.25, 0.72, 0);
    g.add(seat);
    // Handlebars
    const bars = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.7), chromeM);
    bars.position.set(0.55, 0.95, 0);
    g.add(bars);
    // Wheels
    for (const lx of [0.7, -0.7]) {
      const wheel = makeWheel(0.38, 0.14, tireM, rimM);
      wheel.position.set(lx, 0.38, 0);
      g.add(wheel);
      wheels.push(wheel);
    }
    // Headlight
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), mat(0xfff2c0, { roughness: 0.2, metalness: 0.3 }));
    lamp.position.set(0.85, 0.7, 0);
    g.add(lamp);
  } else {
    // Chassis
    const chassisH = typeId === 'truck' ? 0.55 : typeId === 'van' ? 0.5 : 0.42;
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(L, chassisH, W), bodyM);
    chassis.position.y = chassisH * 0.5 + 0.28;
    chassis.castShadow = true;
    g.add(chassis);

    // Cabin / roof box
    let cab;
    if (typeId === 'truck') {
      cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.38, H * 0.55, W * 0.92), bodyM);
      cab.position.set(L * 0.22, chassisH + 0.28 + H * 0.28, 0);
      g.add(cab);
      // bed
      const bed = new THREE.Mesh(new THREE.BoxGeometry(L * 0.48, 0.35, W * 0.88), darkM);
      bed.position.set(-L * 0.18, chassisH + 0.45, 0);
      g.add(bed);
    } else if (typeId === 'van') {
      cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.88, H * 0.7, W * 0.92), bodyM);
      cab.position.set(0, chassisH + 0.28 + H * 0.35, 0);
      g.add(cab);
    } else {
      cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.55, H * 0.45, W * 0.9), bodyM);
      cab.position.set(-0.15, chassisH + 0.28 + H * 0.22, 0);
      g.add(cab);
    }

    // Glass (windows)
    const glassParts = [];
    if (typeId === 'sedan') {
      glassParts.push([0.55, chassisH + 0.55, 0, 1.1, 0.55, W * 0.86]);
      glassParts.push([-0.9, chassisH + 0.55, 0, 0.9, 0.5, W * 0.86]);
    } else if (typeId === 'van') {
      glassParts.push([L * 0.32, chassisH + 0.7, 0, 0.9, 0.65, W * 0.86]);
      glassParts.push([-0.2, chassisH + 0.75, 0, 2.2, 0.7, W * 0.86]);
    } else if (typeId === 'truck') {
      glassParts.push([L * 0.28, chassisH + 0.75, 0, 1.0, 0.6, W * 0.86]);
    }
    for (const [x, y, z, sx, sy, sz] of glassParts) {
      const gl = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), glassM);
      gl.position.set(x, y, z);
      g.add(gl);
    }

    // Wheels
    const wheelR = typeId === 'truck' ? 0.48 : 0.42;
    const axelY = wheelR;
    const axelZ = W * 0.48;
    const axelX = L * 0.32;
    for (const lx of [axelX, -axelX]) {
      for (const lz of [axelZ, -axelZ]) {
        const wheel = makeWheel(wheelR, 0.28, tireM, rimM);
        wheel.position.set(lx, axelY, lz);
        g.add(wheel);
        wheels.push(wheel);
      }
    }

    // Lights
    const head = mat(0xfff0c8, { roughness: 0.2, metalness: 0.4 });
    const tail = mat(0xaa2020, { roughness: 0.4, metalness: 0.3 });
    for (const lz of [W * 0.35, -W * 0.35]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.22), head);
      h.position.set(L * 0.48, chassisH + 0.35, lz);
      g.add(h);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.2), tail);
      tl.position.set(-L * 0.48, chassisH + 0.35, lz);
      g.add(tl);
    }
  }

  // Cabin interior ref (steering wheel for FP)
  const wheelHub = new THREE.Group();
  wheelHub.position.set(
    typeId === 'motorcycle' ? 0.5 : 0.55,
    typeId === 'motorcycle' ? 0.95 : 1.15,
    typeId === 'motorcycle' ? 0 : -0.35,
  );
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 16), darkM);
  rim.rotation.x = Math.PI / 2;
  wheelHub.add(rim);
  g.add(wheelHub);

  g.userData.wheels = wheels;
  g.userData.steer = wheelHub;
  g.userData.bodyMat = bodyM;
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

function makeWheel(radius, width, tireM, rimM) {
  const w = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 12), tireM);
  tire.rotation.z = Math.PI / 2;
  w.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.05, 10), rimM);
  rim.rotation.z = Math.PI / 2;
  w.add(rim);
  return w;
}

function smokeParticle() {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 6, 6),
    mat(0x666666, { transparent: true, opacity: 0.45, depthWrite: false }),
  );
  return m;
}

function defaultSpawns() {
  const out = [];
  const types = ['sedan', 'truck', 'van', 'motorcycle'];
  // Near each POI, offset off the road a bit
  POIS.forEach((p, i) => {
    const type = types[i % types.length];
    const ang = (i * 1.7) % (Math.PI * 2);
    out.push({
      type,
      x: p.x + Math.cos(ang) * 12,
      z: p.z + Math.sin(ang) * 14,
      yaw: ang + Math.PI / 2,
    });
    if (i % 2 === 0) {
      out.push({
        type: types[(i + 2) % types.length],
        x: p.x - Math.cos(ang) * 18,
        z: p.z - Math.sin(ang) * 16,
        yaw: ang,
      });
    }
  });
  // A few along map center roads
  for (let i = 0; i < 6; i++) {
    out.push({
      type: types[i % types.length],
      x: (i - 2.5) * 40,
      z: (i % 2 === 0 ? 1 : -1) * 25,
      yaw: i % 2 === 0 ? 0 : Math.PI,
    });
  }
  return out;
}

export function createVehicles(opts) {
  const { scene, audio, hud } = opts;
  const list = [];
  let occupied = null; // vehicle player is in
  let driveCam = 'chase'; // 'chase' | 'cabin'
  let smokeT = 0;

  // HUD
  let hudEl = document.getElementById('vehHud');
  if (!hudEl) {
    hudEl = document.createElement('div');
    hudEl.id = 'vehHud';
    hudEl.innerHTML = `
      <div class="veh-name"></div>
      <div class="veh-bars">
        <div class="veh-row"><span>SPD</span><div class="veh-track"><i id="vehSpd"></i></div><b id="vehSpdN">0</b></div>
        <div class="veh-row"><span>GAS</span><div class="veh-track gas"><i id="vehGas"></i></div><b id="vehGasN">100%</b></div>
        <div class="veh-row"><span>HP</span><div class="veh-track hp"><i id="vehHp"></i></div><b id="vehHpN">100%</b></div>
      </div>
      <div class="veh-hint">WASD drive · Space brake · E exit · V camera</div>
    `;
    document.body.appendChild(hudEl);
  }
  const $ = (id) => document.getElementById(id);
  const nameEl = hudEl.querySelector('.veh-name');

  function showHud(v) {
    hudEl.classList.toggle('on', !!v);
    document.body.classList.toggle('in-vehicle', !!v);
    if (!v) return;
    nameEl.textContent = v.type.name;
  }

  function updateHud(v) {
    if (!v) return;
    const spdPct = clamp(Math.abs(v.speed) / v.type.maxSpeed, 0, 1);
    const gasPct = clamp(v.gas / v.type.tank, 0, 1);
    const hpPct = clamp(v.hp / v.type.hp, 0, 1);
    $('vehSpd').style.width = (spdPct * 100) + '%';
    $('vehGas').style.width = (gasPct * 100) + '%';
    $('vehHp').style.width = (hpPct * 100) + '%';
    $('vehSpdN').textContent = Math.round(Math.abs(v.speed) * 3.6) + ' km/h';
    $('vehGasN').textContent = Math.round(gasPct * 100) + '%';
    $('vehHpN').textContent = Math.round(hpPct * 100) + '%';
    $('vehGas').parentElement.classList.toggle('low', gasPct < 0.2);
    $('vehHp').parentElement.classList.toggle('low', hpPct < 0.3);
  }

  function spawnOne(spec) {
    const type = VEHICLE_TYPES[spec.type] || VEHICLE_TYPES.sedan;
    const y = heightAt(spec.x, spec.z);
    const mesh = buildMesh(type.id, COLORS[(Math.random() * COLORS.length) | 0]);
    mesh.position.set(spec.x, y, spec.z);
    mesh.rotation.y = spec.yaw || 0;
    scene.add(mesh);

    const v = {
      type,
      mesh,
      x: spec.x, y, z: spec.z,
      yaw: spec.yaw || 0,
      speed: 0,
      gas: type.tank * rnd(0.55, 1),
      hp: type.hp,
      alive: true,
      wheels: mesh.userData.wheels || [],
      steer: mesh.userData.steer,
      smoke: null,
      wheelSpin: 0,
      steerAngle: 0,
    };
    list.push(v);
    return v;
  }

  for (const s of defaultSpawns()) spawnOne(s);

  function nearestFree(px, pz, maxD = 4.5) {
    let best = null, bestD = maxD;
    for (const v of list) {
      if (!v.alive || occupied === v) continue;
      const d = Math.hypot(v.x - px, v.z - pz);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  function enter(player, v) {
    if (!v || !v.alive || occupied) return false;
    occupied = v;
    player.inVehicle = true;
    player.vehicle = v;
    player.vx = 0; player.vz = 0;
    showHud(v);
    if (hud) hud.setMsg('Entered ' + v.type.name, 1200);
    if (audio) try { audio.play('click'); } catch (_) {}
    return true;
  }

  function exit(player) {
    if (!occupied) return false;
    const v = occupied;
    const side = 2.2;
    const sx = Math.sin(v.yaw), cz = Math.cos(v.yaw);
    // Exit to the left of the vehicle
    player.x = v.x - cz * side;
    player.z = v.z - sx * side;
    player.y = heightAt(player.x, player.z);
    player.yaw = v.yaw;
    player.inVehicle = false;
    player.vehicle = null;
    occupied = null;
    showHud(null);
    if (hud) hud.setMsg('Exited vehicle', 1000);
    return true;
  }

  function tryUse(player) {
    if (occupied) return exit(player);
    const v = nearestFree(player.x, player.z, 4.2);
    if (v) return enter(player, v);
    return false;
  }

  function toggleDriveCam() {
    if (!occupied) return false;
    driveCam = driveCam === 'chase' ? 'cabin' : 'chase';
    if (hud) hud.setMsg(driveCam === 'cabin' ? 'Cabin view' : 'Chase cam', 900);
    return true;
  }

  function damage(v, amount, srcX, srcZ) {
    if (!v.alive) return;
    v.hp -= amount;
    if (v.hp <= 0) explode(v);
  }

  function explode(v) {
    if (!v.alive) return;
    v.alive = false;
    v.speed = 0;
    v.hp = 0;
    // Visual: hide mesh, simple flash
    if (v.smoke) { scene.remove(v.smoke); v.smoke = null; }
    v.mesh.visible = false;
    if (audio) try { audio.play('thud', v.x, v.z); } catch (_) {}
    if (hud) hud.setMsg('Vehicle destroyed', 1500);

    // Damage nearby (player)
    return { x: v.x, z: v.z, radius: 6, dmg: 70 };
  }

  function ensureSmoke(v) {
    if (v.smoke) return;
    const s = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const p = smokeParticle();
      p.position.set(rnd(-0.3, 0.3), rnd(0.5, 1.2), rnd(-0.3, 0.3));
      s.add(p);
    }
    s.position.copy(v.mesh.position);
    scene.add(s);
    v.smoke = s;
  }

  function update(dt, player, input, camera) {
    // Smoke / wrecks
    smokeT += dt;
    for (const v of list) {
      if (!v.alive) continue;
      // Ground snap when idle
      if (occupied !== v) {
        const gy = heightAt(v.x, v.z);
        v.y += (gy - v.y) * Math.min(1, dt * 8);
        v.mesh.position.set(v.x, v.y, v.z);
        v.mesh.rotation.y = v.yaw;
      }
      if (v.hp < v.type.hp * 0.35) {
        ensureSmoke(v);
        if (v.smoke) {
          v.smoke.position.set(v.x, v.y + 1.2, v.z);
          for (const p of v.smoke.children) {
            p.position.y += dt * rnd(0.4, 1.2);
            p.material.opacity *= 0.98;
            if (p.position.y > 3) {
              p.position.y = 0.5;
              p.material.opacity = 0.45;
            }
          }
        }
      } else if (v.smoke) {
        scene.remove(v.smoke);
        v.smoke = null;
      }
    }

    if (!occupied || !player.inVehicle) return null;
    const v = occupied;
    if (!v.alive) {
      exit(player);
      return { explosion: true };
    }

    const t = v.type;
    const fwd = input.forward ? 1 : 0;
    const back = input.back ? 1 : 0;
    const left = input.left ? 1 : 0;
    const right = input.right ? 1 : 0;
    const braking = input.jump ? 1 : 0; // space = brake

    // Road vs offroad (simple: height variance)
    const h0 = heightAt(v.x, v.z);
    const h1 = heightAt(v.x + 2, v.z + 2);
    const rough = clamp(Math.abs(h1 - h0) * 2, 0, 1);
    const surface = 1 - rough * (1 - t.offroad) * 0.85;

    if (v.gas > 0) {
      const want = (fwd - back) * t.maxSpeed * surface;
      const acc = (fwd || back) ? t.accel : t.brake * 0.35;
      if (braking) {
        v.speed *= Math.max(0, 1 - t.brake * dt * 0.15);
      } else {
        v.speed += clamp(want - v.speed, -t.brake * dt, acc * dt);
      }
      // Steering scales with speed
      const steerIn = (left - right);
      const turnRate = t.turn * clamp(Math.abs(v.speed) / 8, 0.15, 1) * Math.sign(v.speed || 1);
      v.yaw += steerIn * turnRate * dt;
      v.steerAngle += (steerIn * 0.6 - v.steerAngle) * Math.min(1, dt * 8);

      // Gas use
      const use = (Math.abs(v.speed) * 0.015 + (fwd ? 0.35 : 0.08)) * dt;
      v.gas = Math.max(0, v.gas - use);
    } else {
      v.speed *= Math.max(0, 1 - 1.5 * dt);
      if (hud && Math.random() < 0.01) hud.setMsg('Out of gas', 800);
    }

    // Integrate
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    // yaw 0 → -Z forward (match player)
    let nx = v.x - sy * v.speed * dt;
    let nz = v.z - cy * v.speed * dt;

    // Simple collision with world
    const res = resolveCircle(nx, nz, t.size.W * 0.45, v.y, t.size.H);
    if (Math.hypot(res.x - nx, res.z - nz) > 0.05) {
      v.speed *= 0.4;
    }
    v.x = res.x;
    v.z = res.z;
    v.y = heightAt(v.x, v.z);

    // Mesh
    v.mesh.position.set(v.x, v.y, v.z);
    v.mesh.rotation.y = v.yaw;
    // Body roll lightly
    v.mesh.rotation.z = -v.steerAngle * 0.08 * clamp(Math.abs(v.speed) / t.maxSpeed, 0, 1);

    // Wheel spin + steer
    v.wheelSpin += v.speed * dt * 1.4;
    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i];
      w.rotation.x = v.wheelSpin;
      // Front wheels steer (first half of list)
      if (i < v.wheels.length / 2) w.rotation.y = v.steerAngle;
    }
    if (v.steer) v.steer.rotation.z = -v.steerAngle * 0.9;

    // Player rides along
    player.x = v.x;
    player.z = v.z;
    player.y = v.y;
    player.yaw = v.yaw;
    player.pitch = driveCam === 'cabin' ? player.pitch * 0.9 : 0;
    player.vx = 0;
    player.vz = 0;

    updateHud(v);

    // Camera
    if (camera) {
      if (driveCam === 'cabin') {
        // Inside cabin, looking forward
        const eyeX = v.x - sy * 0.3 - cy * 0.35;
        const eyeZ = v.z - cy * 0.3 + sy * 0.35;
        camera.position.set(eyeX, v.y + 1.25, eyeZ);
        camera.lookAt(v.x - sy * 8, v.y + 1.1, v.z - cy * 8);
      } else {
        // Chase cam behind
        const back = 8.5, up = 3.2;
        camera.position.set(v.x + sy * back, v.y + up, v.z + cy * back);
        camera.lookAt(v.x - sy * 4, v.y + 1.2, v.z - cy * 4);
      }
    }

    return { driving: true, vehicle: v };
  }

  function applyExplosionDamage(player, ctrl) {
    // called externally if needed
  }

  /** Shoot / explosion damage to nearest vehicle */
  function hurtAt(x, z, radius, dmg) {
    let blast = null;
    for (const v of list) {
      if (!v.alive) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < radius) {
        const fall = 1 - d / radius;
        damage(v, dmg * fall, x, z);
        if (!v.alive) blast = { x: v.x, z: v.z, radius: 6, dmg: 70 };
      }
    }
    return blast;
  }

  return {
    list,
    tryUse,
    toggleDriveCam,
    update,
    hurtAt,
    get occupied() { return occupied; },
    get driveCam() { return driveCam; },
    isDriving: () => !!occupied,
  };
}
