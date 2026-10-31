/** Cover colliders + movement / LOS helpers */

export const colliders = [];

export function addCover(scene, THREE, x, z, w, h, d, color) {
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

export function resolveCircle(x, z, radius) {
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

export function lineBlocked(ax, az, bx, bz, eyeY = 1.4) {
  for (const c of colliders) {
    if (c.h < eyeY - 0.2) continue;
    if (segmentHitsAabb(ax, az, bx, bz, c.minX, c.maxX, c.minZ, c.maxZ)) return true;
  }
  return false;
}

export function nearestCoverAwayFrom(px, pz, threatX, threatZ) {
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
