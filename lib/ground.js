/**
 * THE ground. heightAt() returns exactly the height of the rendered terrain mesh (same 5 m grid, same triangles),
 * so physics, bullets, props and visuals can never disagree. Built lazily on first use.
 */
import { createTerrain, MAP_HALF } from './terrain.js';
import { POIS } from './mapLayout.js';

export const CELL = 5; // grid spacing in metres (terrainMesh uses the same grid)
export const CELLS = (MAP_HALF * 2) / CELL;
export const SAMPLES = CELLS + 1;

// some POIs have content that reaches past their listed radius, so their level area is widened
const FLAT_SCALE = { arena: 1.9 };

/** the smooth analytic height (used only to build the grid) */
export const heightExact = createTerrain(POIS.map((p) => ({ x: p.x, z: p.z, r: p.r * (FLAT_SCALE[p.type] || 1) })));

let H = null;
export function groundGrid() {
  if (!H) {
    H = new Float32Array(SAMPLES * SAMPLES);
    for (let j = 0; j < SAMPLES; j++) {
      for (let i = 0; i < SAMPLES; i++) H[j * SAMPLES + i] = heightExact(-MAP_HALF + i * CELL, -MAP_HALF + j * CELL);
    }
  }
  return H;
}

/** Ground height in metres at world (x, z): the exact surface of the terrain mesh. */
export function heightAt(x, z) {
  const g = H || groundGrid();
  let gx = (x + MAP_HALF) / CELL, gz = (z + MAP_HALF) / CELL;
  if (gx < 0) gx = 0; else if (gx > CELLS) gx = CELLS;
  if (gz < 0) gz = 0; else if (gz > CELLS) gz = CELLS;
  let i = gx | 0, j = gz | 0;
  if (i >= CELLS) i = CELLS - 1;
  if (j >= CELLS) j = CELLS - 1;
  const fx = gx - i, fz = gz - j, k = j * SAMPLES + i;
  const a = g[k], b = g[k + 1], c = g[k + SAMPLES], d = g[k + SAMPLES + 1];
  // the mesh splits each cell along the b-c diagonal
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
