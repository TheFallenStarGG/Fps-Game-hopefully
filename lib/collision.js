/** World colliders (axis-aligned boxes) + movement / LOS / ray helpers */

export const colliders = [];
export const WORLD_HALF = 92;

export function addCollider(x, z, w, h, d, opts = {}) {
  const c = {
    mesh: opts.mesh || null,
    minX: x - w / 2, maxX: x + w / 2,
    minZ: z - d / 2, maxZ: z + d / 2,
    h, cx: x, cz: z, w, d,
    noCover: !!opts.noCover,
  };
  colliders.push(c);
  return c;
}

export function clearColliders() {
  colliders.length = 0;
}

/** Push a circle out of every box. y = feet height (a jumping player can clear low boxes). */
export function resolveCircle(x, z, radius, y = 0) {
  let px = x, pz = z;
  for (const c of colliders) {
    if (y > c.h - 0.05) continue;
    const nearestX = Math.max(c.minX, Math.min(px, c.maxX));
    const nearestZ = Math.max(c.minZ, Math.min(pz, c.maxZ));
    const dx = px - nearestX;
    const dz = pz - nearestZ;
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
  px = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, px));
  pz = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, pz));
  return { x: px, z: pz };
}

// ---------- 2D segment vs box (Liang-Barsky), result in _t0/_t1 ----------
let _t0 = 0, _t1 = 1;
function clip(p, q) {
  if (Math.abs(p) < 1e-9) return q >= 0;
  const r = q / p;
  if (p < 0) {
    if (r > _t1) return false;
    if (r > _t0) _t0 = r;
  } else {
    if (r < _t0) return false;
    if (r < _t1) _t1 = r;
  }
  return true;
}
function clipSeg(x1, z1, x2, z2, c) {
  _t0 = 0; _t1 = 1;
  const dx = x2 - x1, dz = z2 - z1;
  return (
    clip(-dx, x1 - c.minX) && clip(dx, c.maxX - x1) &&
    clip(-dz, z1 - c.minZ) && clip(dz, c.maxZ - z1) && _t0 < _t1
  );
}

/**
 * Is the line of sight between two points blocked? ya / yb are the heights at each end
 * (eye height standing ~1.4-1.65, crouched ~1.1). Low cover only blocks when the ray is lower than it.
 */
export function lineBlocked(ax, az, bx, bz, ya = 1.4, yb = ya) {
  for (const c of colliders) {
    if (!clipSeg(ax, az, bx, bz, c)) continue;
    const h0 = ya + (yb - ya) * _t0;
    const h1 = ya + (yb - ya) * _t1;
    if (c.h >= Math.min(h0, h1) - 0.05) return true;
  }
  return false;
}

// ---------- 3D ray vs world (boxes + ground) ----------
const O = [0, 0, 0], D = [0, 0, 0], MN = [0, 0, 0], MX = [0, 0, 0];
const _hit = { t: 0, nx: 0, ny: 1, nz: 0, ground: false, c: null };

/** Returns a shared result object {t, nx, ny, nz, ground, c} or null. Use it immediately. */
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxT) {
  let bestT = maxT, found = false;
  O[0] = ox; O[1] = oy; O[2] = oz;
  D[0] = dx; D[1] = dy; D[2] = dz;

  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t >= 0 && t < bestT) {
      bestT = t; found = true;
      _hit.nx = 0; _hit.ny = 1; _hit.nz = 0; _hit.ground = true; _hit.c = null;
    }
  }

  for (const c of colliders) {
    MN[0] = c.minX; MN[1] = 0; MN[2] = c.minZ;
    MX[0] = c.maxX; MX[1] = c.h; MX[2] = c.maxZ;
    let t0 = 0, t1 = bestT, ni = -1, ns = 0, ok = true;
    for (let a = 0; a < 3; a++) {
      const o = O[a], d = D[a];
      if (Math.abs(d) < 1e-9) {
        if (o < MN[a] || o > MX[a]) { ok = false; break; }
        continue;
      }
      let ta = (MN[a] - o) / d, tb = (MX[a] - o) / d, s = -1;
      if (ta > tb) { const k = ta; ta = tb; tb = k; s = 1; }
      if (ta > t0) { t0 = ta; ni = a; ns = s; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && ni >= 0 && t0 < bestT) {
      bestT = t0; found = true;
      _hit.nx = ni === 0 ? ns : 0;
      _hit.ny = ni === 1 ? ns : 0;
      _hit.nz = ni === 2 ? ns : 0;
      _hit.ground = false; _hit.c = c;
    }
  }
  if (!found) return null;
  _hit.t = bestT;
  return _hit;
}

export function nearestCoverAwayFrom(px, pz, threatX, threatZ) {
  let best = null, bestScore = -Infinity;
  for (const c of colliders) {
    if (c.noCover) continue;
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
