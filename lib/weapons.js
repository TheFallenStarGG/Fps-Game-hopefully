/** Tracers, muzzle flash + light, impacts, bullet holes, shell casings, thrown magazines */
import * as THREE from 'three';
import { makeMag } from './parts.js';
import { colliders, raycastWorld } from './collision.js';

const ZAXIS = new THREE.Vector3(0, 0, 1);
const rnd = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;

function holeTexture() {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,.95)');
  g.addColorStop(0.22, 'rgba(8,8,8,.9)');
  g.addColorStop(0.45, 'rgba(20,18,16,.35)');
  g.addColorStop(1, 'rgba(20,18,16,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(15,15,15,.45)';
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * 6.28, l = 10 + Math.random() * 16;
    x.beginPath();
    x.moveTo(32 + Math.cos(a) * 5, 32 + Math.sin(a) * 5);
    x.lineTo(32 + Math.cos(a) * l, 32 + Math.sin(a) * l);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createBulletSystem(scene, tex, hooks = {}) {
  const _p = new THREE.Vector3(), _v = new THREE.Vector3();
  const listener = new THREE.Vector3(0, 1.5, 0);

  // ---------- particle pools ----------
  function makePool(n, blending) {
    const items = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex.glow, transparent: true, depthWrite: false, blending });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      items.push({ s, mat, v: new THREE.Vector3(), life: 0, max: 1, s0: 0.1, s1: 0.1, a0: 1, g: 0, drag: 0 });
    }
    let idx = 0;
    return {
      items,
      emit(pos, vx, vy, vz, life, s0, s1, color, a0, g, drag) {
        const p = items[idx++ % n];
        p.s.position.copy(pos);
        p.v.set(vx, vy, vz);
        p.life = p.max = life;
        p.s0 = s0; p.s1 = s1; p.a0 = a0; p.g = g; p.drag = drag;
        p.mat.color.setHex(color);
        p.mat.opacity = a0;
        p.s.scale.setScalar(s0);
        p.s.visible = true;
      },
    };
  }
  const sparks = makePool(120, THREE.AdditiveBlending);
  const puffs = makePool(100, THREE.NormalBlending);

  function updatePool(pool, dt) {
    for (const p of pool.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.v.y -= p.g * dt;
      p.v.multiplyScalar(Math.exp(-p.drag * dt));
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(lerp(p.s0, p.s1, t));
      p.mat.opacity = p.a0 * (1 - t);
    }
  }

  // ---------- muzzle lights (fixed pool: no shader recompiles) ----------
  const lights = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffb060, 0, 14, 2);
    scene.add(l);
    lights.push({ l, life: 0 });
  }
  let li = 0;
  function lightAt(pos) {
    const o = lights[li++ % lights.length];
    o.l.position.copy(pos);
    o.life = 0.07;
    o.l.intensity = 28;
  }

  // ---------- flash sprites ----------
  const flashes = [];
  function makeFlash(parent, size) {
    const mat = new THREE.SpriteMaterial({
      map: tex.flash, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    parent.add(s);
    const f = { s, mat, life: 0, size, k0: 1 };
    flashes.push(f);
    return f;
  }
  function fireFlash(f) {
    f.life = 0.055;
    f.k0 = rnd(0.8, 1.2);
    f.mat.rotation = rnd(0, 6.28);
    f.s.visible = true;
  }
  const worldFlashes = [];
  for (let i = 0; i < 5; i++) worldFlashes.push(makeFlash(scene, 0.55));
  let wf = 0;

  function smoke(pos) {
    puffs.emit(pos, rnd(-0.1, 0.1), rnd(0.2, 0.5), rnd(-0.1, 0.1), rnd(0.5, 0.9), 0.05, 0.3, 0xcfcfcf, 0.22, -0.1, 1.5);
  }

  /** Flash in the main scene (remote players, enemies, 3rd person). */
  function muzzleFlash(pos) {
    const f = worldFlashes[wf++ % worldFlashes.length];
    f.s.position.copy(pos);
    fireFlash(f);
    lightAt(pos);
    smoke(pos);
  }

  /**
   * Parent a flash sprite to a muzzle Object3D. fire(lightWorldPos): in first person the muzzle
   * lives in the viewmodel scene, so pass a main-world position for the light. Omit it for 3rd person.
   */
  function attachFlash(muzzle, size = 0.5) {
    const f = makeFlash(muzzle, size);
    return {
      fire(lightWorldPos) {
        fireFlash(f);
        if (lightWorldPos) lightAt(lightWorldPos);
        else { muzzle.getWorldPosition(_p); lightAt(_p); smoke(_p); }
      },
    };
  }

  // ---------- tracers ----------
  const tracerGeo = new THREE.BoxGeometry(0.012, 0.012, 1);
  const trMat = (c) => new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const trPlayer = trMat(0xffe9a8), trEnemy = trMat(0xff6a4a);
  const bullets = [];

  function spawn(origin, dir, speed, fromEnemy) {
    const mesh = new THREE.Mesh(tracerGeo, fromEnemy ? trEnemy : trPlayer);
    mesh.frustumCulled = false;
    const d = dir.clone().normalize();
    mesh.quaternion.setFromUnitVectors(ZAXIS, d);
    scene.add(mesh);
    bullets.push({
      mesh, p: origin.clone(), d, speed, travel: 0, life: 1.4,
      len: Math.min(3, speed * 0.03), enemy: !!fromEnemy, whizzed: false,
    });
  }

  // ---------- decals ----------
  const holeMat = new THREE.MeshStandardMaterial({
    map: holeTexture(), transparent: true, depthWrite: false, roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const holeGeo = new THREE.PlaneGeometry(0.16, 0.16);
  const holes = [];
  let hi = 0;
  function bulletHole(point, normal) {
    let m;
    if (holes.length < 70) {
      m = new THREE.Mesh(holeGeo, holeMat);
      scene.add(m);
      holes.push(m);
    } else m = holes[hi++ % 70];
    m.position.copy(point).addScaledVector(normal, 0.012);
    m.lookAt(_p.copy(m.position).add(normal));
    m.rotateZ(rnd(0, 6.28));
    m.scale.setScalar(rnd(0.7, 1.4));
  }

  /** kind: 'world' | 'ground' | 'body'  ('body' = blood puff, no decal) */
  function impact(point, normal, kind = 'world') {
    const n = normal;
    if (kind === 'body') {
      for (let i = 0; i < 5; i++) {
        puffs.emit(point, n.x * 1.2 + rnd(-1, 1), n.y * 1.2 + rnd(-0.3, 1.2), n.z * 1.2 + rnd(-1, 1),
          rnd(0.35, 0.6), 0.06, 0.2, 0x8a1010, 0.85, 6, 2);
      }
      return;
    }
    const ns = kind === 'world' ? 7 : 2;
    for (let i = 0; i < ns; i++) {
      const sp = rnd(2, 5);
      sparks.emit(point, n.x * sp + rnd(-2, 2), n.y * sp + rnd(-1, 2.5), n.z * sp + rnd(-2, 2),
        rnd(0.2, 0.4), 0.06, 0.01, 0xffd58a, 1, 9, 0.5);
    }
    const dust = kind === 'ground' ? 0x7d6b4c : 0xb5b0a6;
    for (let i = 0; i < 4; i++) {
      puffs.emit(point, n.x * 0.8 + rnd(-0.6, 0.6), n.y * 0.8 + rnd(0, 0.8), n.z * 0.8 + rnd(-0.6, 0.6),
        rnd(0.5, 0.9), 0.12, 0.45, dust, 0.5, -0.2, 3);
    }
    bulletHole(point, n);
  }

  // ---------- physical debris: shell casings + thrown magazines ----------
  const shellGeo = new THREE.CylinderGeometry(0.0046, 0.0046, 0.038, 8);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xd0a850, metalness: 0.95, roughness: 0.3 });
  const debris = [];

  function disposeMesh(m) {
    if (m.userData.shared) return;
    m.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  function spawnDebris(kind, make, max, r, pos, vel, spin, life) {
    const same = debris.filter((d) => d.kind === kind);
    if (same.length >= max) {
      const old = same[0];
      scene.remove(old.mesh);
      disposeMesh(old.mesh);
      debris.splice(debris.indexOf(old), 1);
    }
    const mesh = make();
    mesh.position.copy(pos);
    mesh.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
    scene.add(mesh);
    debris.push({ mesh, kind, r, v: vel.clone(), w: spin.clone(), life, landed: false, rest: false, py: pos.y });
  }

  function ejectShell(pos, vel) {
    spawnDebris('shell', () => {
      const m = new THREE.Mesh(shellGeo, shellMat);
      m.userData.shared = true;
      return m;
    }, 28, 0.005, pos, vel, _v.set(rnd(-30, 30), rnd(-30, 30), rnd(-30, 30)), 14);
  }

  function dropMag(pos, vel, spin) {
    spawnDebris('mag', () => makeMag(tex), 4, 0.03, pos, vel,
      spin || _v.set(rnd(-9, 9), rnd(-4, 4), rnd(-9, 9)), 25);
  }

  function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        scene.remove(d.mesh);
        disposeMesh(d.mesh);
        debris.splice(i, 1);
        continue;
      }
      if (d.rest) continue;
      const m = d.mesh, p = m.position, r = d.r;
      d.v.y -= 9.81 * dt;
      p.addScaledVector(d.v, dt);
      m.rotation.x += d.w.x * dt;
      m.rotation.y += d.w.y * dt;
      m.rotation.z += d.w.z * dt;

      for (const c of colliders) {
        if (p.y >= c.h + r || p.x < c.minX - r || p.x > c.maxX + r || p.z < c.minZ - r || p.z > c.maxZ + r) continue;
        if (d.py >= c.h + r - 0.02 && d.v.y <= 0) {
          p.y = c.h + r; d.v.y *= -0.3; d.v.x *= 0.7; d.v.z *= 0.7; // lands on top
        } else {
          const l = p.x - (c.minX - r), rr = c.maxX + r - p.x, a = p.z - (c.minZ - r), b = c.maxZ + r - p.z;
          const mn = Math.min(l, rr, a, b);
          if (mn === l) { p.x = c.minX - r; d.v.x *= -0.3; }
          else if (mn === rr) { p.x = c.maxX + r; d.v.x *= -0.3; }
          else if (mn === a) { p.z = c.minZ - r; d.v.z *= -0.3; }
          else { p.z = c.maxZ + r; d.v.z *= -0.3; }
        }
      }

      if (p.y <= r) {
        p.y = r;
        if (d.v.y < -1.0) {
          d.v.y *= -0.32; d.v.x *= 0.65; d.v.z *= 0.65; d.w.multiplyScalar(0.6);
          if (!d.landed) {
            d.landed = true;
            if (hooks.onLand) hooks.onLand(d.kind, p.x, p.y, p.z);
          }
        } else {
          d.v.y = 0;
          const f = Math.exp(-8 * dt);
          d.v.x *= f; d.v.z *= f; d.w.multiplyScalar(f);
          if (d.v.lengthSq() < 0.01 && d.w.lengthSq() < 0.4) {
            d.rest = true;
            m.rotation.set(Math.PI / 2, 0, rnd(0, 6.28)); // lie flat
            p.y = d.kind === 'mag' ? 0.03 : 0.005;
          }
        }
      }
      d.py = p.y;
    }
  }

  // ---------- main update ----------
  function setListener(x, y, z) {
    listener.set(x, y, z);
  }

  function update(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const step = b.speed * dt;
      let end = step, dead = false, hx = 0, hy = 0, hz = 0, hn = null, hk = 'world';
      const hit = raycastWorld(b.p.x, b.p.y, b.p.z, b.d.x, b.d.y, b.d.z, step);
      if (hit) {
        end = hit.t; dead = true;
        hx = b.p.x + b.d.x * end; hy = b.p.y + b.d.y * end; hz = b.p.z + b.d.z * end;
        hn = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
        hk = hit.ground ? 'ground' : 'world';
      }
      if (b.enemy && !b.whizzed) {
        _v.copy(listener).sub(b.p);
        const t = Math.max(0, Math.min(end, _v.dot(b.d)));
        if (_p.copy(b.p).addScaledVector(b.d, t).distanceTo(listener) < 1.8) {
          b.whizzed = true;
          if (hooks.onWhiz) hooks.onWhiz();
        }
      }
      b.p.addScaledVector(b.d, end);
      b.travel += end;
      b.life -= dt;

      const len = Math.min(b.len, b.travel + 0.3);
      b.mesh.position.copy(b.p).addScaledVector(b.d, -len / 2);
      b.mesh.scale.z = len;

      if (dead) impact(_p.set(hx, hy, hz), hn, hk);
      if (dead || b.life <= 0 || b.p.y > 200) {
        scene.remove(b.mesh);
        bullets.splice(i, 1);
      }
    }

    for (const f of flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.s.visible = false; continue; }
      const k = f.life / 0.055;
      f.mat.opacity = k;
      f.s.scale.setScalar(f.size * f.k0 * (1.2 - 0.4 * k));
    }
    for (const o of lights) {
      if (o.life <= 0) continue;
      o.life -= dt;
      o.l.intensity = o.life > 0 ? 28 * (o.life / 0.07) : 0;
    }
    updatePool(sparks, dt);
    updatePool(puffs, dt);
    updateDebris(dt);
  }

  return { spawn, update, muzzleFlash, attachFlash, ejectShell, dropMag, impact, bulletHole, setListener };
}
