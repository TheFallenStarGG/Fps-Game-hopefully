/** Renders the map ground from the shared height function: chunked mesh, slope and altitude colouring, lake surface. */
import * as THREE from 'three';
import { heightAt } from './ground.js';
import { MAP_HALF, WATER_Y, LAKE } from './terrain.js';

const CELL = 5; // grid spacing in metres
const N = (MAP_HALF * 2) / CELL; // cells per side
const CHUNK_CELLS = 40; // 200 m chunks
const SAMPLES = N + 1;

const C = {
  grassA: new THREE.Color(0x6b8f3e), grassB: new THREE.Color(0x4a7431), dry: new THREE.Color(0x8e8f52),
  sand: new THREE.Color(0xc8b680), rock: new THREE.Color(0x7a746a), snow: new THREE.Color(0xe8edf0),
};
const _c = new THREE.Color();

const smooth01 = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function colourAt(x, z, h, ny, out) {
  const v = 0.5 + 0.5 * Math.sin(x * 0.013 + z * 0.021) * Math.cos(z * 0.017 - x * 0.007);
  _c.copy(C.grassB).lerp(C.grassA, v);
  _c.lerp(C.dry, smooth01(0.7, 0.9, Math.sin(x * 0.004 - z * 0.006) * 0.5 + 0.5) * 0.6);
  _c.lerp(C.sand, 1 - smooth01(WATER_Y + 0.4, WATER_Y + 2.2, h));
  _c.lerp(C.rock, Math.max(smooth01(0.82, 0.6, ny), smooth01(60, 95, h)));
  _c.lerp(C.snow, smooth01(150, 175, h));
  out[0] = _c.r; out[1] = _c.g; out[2] = _c.b;
}

/** Builds the ground for the whole map. Returns a Group of chunk meshes plus the lake surface. */
export function createTerrainMesh(tex) {
  const H = new Float32Array(SAMPLES * SAMPLES);
  for (let j = 0; j < SAMPLES; j++) {
    for (let i = 0; i < SAMPLES; i++) H[j * SAMPLES + i] = heightAt(-MAP_HALF + i * CELL, -MAP_HALF + j * CELL);
  }
  const at = (i, j) => H[Math.min(SAMPLES - 1, Math.max(0, j)) * SAMPLES + Math.min(SAMPLES - 1, Math.max(0, i))];

  tex.grass.wrapS = tex.grass.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.grass, vertexColors: true, roughness: 1 });
  const group = new THREE.Group();
  const V = CHUNK_CELLS + 1;
  const col = [0, 0, 0];

  for (let cz = 0; cz < N / CHUNK_CELLS; cz++) {
    for (let cx = 0; cx < N / CHUNK_CELLS; cx++) {
      const pos = [], nrm = [], clr = [], uv = [], idx = [];
      for (let j = 0; j < V; j++) {
        for (let i = 0; i < V; i++) {
          const gi = cx * CHUNK_CELLS + i, gj = cz * CHUNK_CELLS + j;
          const x = -MAP_HALF + gi * CELL, z = -MAP_HALF + gj * CELL;
          const h = at(gi, gj);
          const dhx = (at(gi + 1, gj) - at(gi - 1, gj)) / (2 * CELL);
          const dhz = (at(gi, gj + 1) - at(gi, gj - 1)) / (2 * CELL);
          const l = Math.hypot(dhx, 1, dhz);
          const ny = 1 / l;
          pos.push(x, h, z);
          nrm.push(-dhx / l, ny, -dhz / l);
          colourAt(x, z, h, ny, col);
          clr.push(col[0], col[1], col[2]);
          uv.push(x / 14, z / 14);
        }
      }
      for (let j = 0; j < V - 1; j++) {
        for (let i = 0; i < V - 1; i++) {
          const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshStandardMaterial({
    color: 0x2f6a86, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.86,
  }));
  water.rotation.x = -Math.PI / 2;
  water.scale.set(LAKE.rx * 0.9, LAKE.rz * 0.9, 1);
  water.position.set(LAKE.x, WATER_Y, LAKE.z);
  group.add(water);
  return group;
}
