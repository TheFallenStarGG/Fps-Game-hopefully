import { createTerrain } from './terrain.js';
import { POIS } from './mapLayout.js';

/** Ground height in metres at world (x, z), with every POI footprint levelled. */
export const heightAt = createTerrain(POIS.map((p) => ({ x: p.x, z: p.z, r: p.r })));
