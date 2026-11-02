/**
 * Deterministic ground shape for the whole map. Pure functions of (x, z), so every client agrees on the ground.
 * Flat sites (POI footprints) are blended in by createTerrain() so buildings sit level.
 */
export const MAP_HALF = 1000; // map spans -MAP_HALF .. MAP_HALF on both axes
export const WATER_Y = 0.6; // lake surface height
export const LAKE = { x: -560, z: 220, rx: 230, rz: 170 };

const SEED = 1337;

function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + SEED;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function fbm(x, z, octaves) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(x, z) * amp;
    norm += amp;
    x = x * 2.03 + 17.1;
    z = z * 2.03 - 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Raw natural ground height in metres, before flat sites are applied. */
export function naturalHeight(x, z) {
  const broad = fbm(x / 420, z / 420, 3);
  const detail = fbm(x / 90, z / 90, 3) - 0.5;
  let h = (broad - 0.45) * 90 + detail * 14;

  const edge = Math.max(Math.abs(x), Math.abs(z)) / MAP_HALF;
  const ridge = 1 - Math.abs(fbm(x / 260 + 40, z / 260 - 40, 3) * 2 - 1);
  const range = smooth(Math.min(1, Math.max(0, (edge - 0.35) / 0.4)));
  h += range * ridge * ridge * 150;

  const lx = (x - LAKE.x) / LAKE.rx, lz = (z - LAKE.z) / LAKE.rz;
  const basin = Math.exp(-(lx * lx + lz * lz) * 1.6);
  h = h * (1 - basin) + (WATER_Y - 2.2) * basin;

  return h;
}

function siteWeight(x, z, s) {
  const d = Math.hypot(x - s.x, z - s.z);
  if (d >= s.r) return 0;
  const core = s.r * 0.6;
  if (d <= core) return 1;
  return 1 - smooth((d - core) / (s.r - core));
}

/**
 * sites = [{ x, z, r }] flatten the ground to the natural height at their centre within radius r.
 * Returns heightAt(x, z).
 */
export function createTerrain(sites) {
  const levelled = sites.map((s) => ({ x: s.x, z: s.z, r: s.r, h: naturalHeight(s.x, s.z) }));
  return function heightAt(x, z) {
    let h = naturalHeight(x, z);
    for (let i = 0; i < levelled.length; i++) {
      const s = levelled[i];
      if (Math.abs(x - s.x) >= s.r || Math.abs(z - s.z) >= s.r) continue;
      const w = siteWeight(x, z, s);
      if (w > 0) h = h + (s.h - h) * w;
    }
    return h;
  };
}
