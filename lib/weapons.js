/** Tracer bullets */

export function createBulletSystem(THREE, scene) {
  const bulletGeo = new THREE.SphereGeometry(0.05, 6, 6);
  const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
  const enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff5555 });
  const bullets = [];

  function spawn(origin, dir, speed, fromEnemy) {
    const mesh = new THREE.Mesh(bulletGeo, fromEnemy ? enemyBulletMat : bulletMat);
    mesh.position.copy(origin);
    scene.add(mesh);
    bullets.push({
      mesh,
      vel: dir.clone().normalize().multiplyScalar(speed),
      life: 1.0,
    });
  }

  function update(dt) {
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

  return { spawn, update };
}
