/** Tracer bullets, muzzle flash, bullet holes */

export function createBulletSystem(THREE, scene) {
  const bulletGeo = new THREE.SphereGeometry(0.05, 6, 6);
  const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
  const enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff5555 });
  const bullets = [];
  const flashes = [];
  const holes = [];
  const holeGeo = new THREE.CircleGeometry(0.08, 8);
  const holeMat = new THREE.MeshBasicMaterial({
    color: 0x1a1a1a,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  function spawn(origin, dir, speed, fromEnemy) {
    const mesh = new THREE.Mesh(bulletGeo, fromEnemy ? enemyBulletMat : bulletMat);
    mesh.position.copy(origin);
    scene.add(mesh);
    bullets.push({
      mesh,
      vel: dir.clone().normalize().multiplyScalar(speed),
      life: 1.0,
      fromEnemy: !!fromEnemy,
    });
  }

  function muzzleFlash(worldPos) {
    const light = new THREE.PointLight(0xffcc66, 3, 8, 2);
    light.position.copy(worldPos);
    scene.add(light);
    const sprite = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.9 })
    );
    sprite.position.copy(worldPos);
    scene.add(sprite);
    flashes.push({ light, sprite, life: 0.06 });
  }

  function bulletHole(point, normal) {
    const m = new THREE.Mesh(holeGeo, holeMat.clone());
    m.position.copy(point);
    const n = normal.clone().normalize();
    m.lookAt(point.clone().add(n));
    m.position.addScaledVector(n, 0.02);
    scene.add(m);
    holes.push({ mesh: m, life: 12 });
    if (holes.length > 40) {
      const old = holes.shift();
      scene.remove(old.mesh);
    }
  }

  function update(dt, colliders, groundY = 0) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const prev = b.mesh.position.clone();
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;

      if (b.mesh.position.y <= groundY + 0.05) {
        const p = b.mesh.position.clone();
        p.y = groundY + 0.02;
        bulletHole(p, new THREE.Vector3(0, 1, 0));
        scene.remove(b.mesh);
        bullets.splice(i, 1);
        continue;
      }

      let hit = false;
      for (const c of colliders || []) {
        const p = b.mesh.position;
        if (p.x >= c.minX && p.x <= c.maxX && p.z >= c.minZ && p.z <= c.maxZ && p.y >= 0 && p.y <= c.h) {
          let nx = 0, ny = 0, nz = 0;
          if (prev.x < c.minX) nx = -1;
          else if (prev.x > c.maxX) nx = 1;
          else if (prev.z < c.minZ) nz = -1;
          else if (prev.z > c.maxZ) nz = 1;
          else ny = 1;
          const n = new THREE.Vector3(nx, ny, nz).normalize();
          if (n.lengthSq() < 0.1) n.set(0, 1, 0);
          bulletHole(p.clone(), n);
          hit = true;
          break;
        }
      }
      if (hit || b.life <= 0) {
        scene.remove(b.mesh);
        bullets.splice(i, 1);
      }
    }

    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.life -= dt;
      if (f.sprite.material) f.sprite.material.opacity = Math.max(0, f.life / 0.06);
      f.light.intensity = 3 * Math.max(0, f.life / 0.06);
      if (f.life <= 0) {
        scene.remove(f.light);
        scene.remove(f.sprite);
        flashes.splice(i, 1);
      }
    }

    for (let i = holes.length - 1; i >= 0; i--) {
      const h = holes[i];
      h.life -= dt;
      if (h.life < 2 && h.mesh.material) {
        h.mesh.material.opacity = 0.85 * (h.life / 2);
      }
      if (h.life <= 0) {
        scene.remove(h.mesh);
        holes.splice(i, 1);
      }
    }
  }

  return { spawn, update, muzzleFlash, bulletHole };
        }
