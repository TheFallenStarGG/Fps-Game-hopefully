/**
 * Corner minimap + full map (M). Terrain bake, structures, players, bots. Size is configurable.
 */
import { MAP_HALF, LAKE, WATER_Y, naturalHeight } from './terrain.js';
import { colliders } from './collision.js';
import { settings } from './settings.js';

const FULL_SIZE = 640;
const MINI_RANGE = 220;
const BAKE = 512;
const POS_KEY = 'realmrange.minimap.v1';
const DRAG_PX = 8;

const COL = {
  me: '#ffffff',
  foe: '#ff6b5a',
  bot: '#ff9a3c',
  botLeader: '#ffd24a',
  down: '#7a7a7a',
  ally: '#5dff9a',
  poi: '#e9e4d8',
  major: '#f5c76b',
  build: 'rgba(180,190,200,0.85)',
  struct: 'rgba(30,28,24,0.75)',
};

function loadPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch (_) {}
  return null;
}

function heightColor(h, x, z) {
  const lx = (x - LAKE.x) / LAKE.rx, lz = (z - LAKE.z) / LAKE.rz;
  if (lx * lx + lz * lz < 1.05 && h <= WATER_Y + 1.5) {
    const deep = Math.min(1, Math.max(0, (WATER_Y + 1 - h) / 6));
    const r = 30 + deep * 10, g = 80 + deep * 30, b = 110 + deep * 40;
    return `rgb(${r|0},${g|0},${b|0})`;
  }
  // elevation ramp: low valley green → mid olive → high rock/snow
  const t = Math.min(1, Math.max(0, (h + 20) / 160));
  if (t < 0.35) {
    const u = t / 0.35;
    return `rgb(${(40 + u * 30)|0},${(70 + u * 50)|0},${(35 + u * 20)|0})`;
  }
  if (t < 0.7) {
    const u = (t - 0.35) / 0.35;
    return `rgb(${(55 + u * 50)|0},${(90 + u * 20)|0},${(40 + u * 10)|0})`;
  }
  const u = (t - 0.7) / 0.3;
  return `rgb(${(110 + u * 80)|0},${(100 + u * 70)|0},${(70 + u * 80)|0})`;
}

function bakeTerrain() {
  const c = document.createElement('canvas');
  c.width = c.height = BAKE;
  const g = c.getContext('2d');
  const img = g.createImageData(BAKE, BAKE);
  const data = img.data;
  const step = (MAP_HALF * 2) / BAKE;
  for (let py = 0; py < BAKE; py++) {
    for (let px = 0; px < BAKE; px++) {
      const x = -MAP_HALF + (px + 0.5) * step;
      const z = -MAP_HALF + (py + 0.5) * step;
      const h = naturalHeight(x, z);
      const col = heightColor(h, x, z);
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(col);
      const i = (py * BAKE + px) * 4;
      data[i] = +m[1]; data[i + 1] = +m[2]; data[i + 2] = +m[3]; data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // soft grid
  g.strokeStyle = 'rgba(255,255,255,0.04)';
  g.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * BAKE;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, BAKE); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(BAKE, p); g.stroke();
  }
  return c;
}

function worldToBake(x, z) {
  return [
    ((x + MAP_HALF) / (MAP_HALF * 2)) * BAKE,
    ((z + MAP_HALF) / (MAP_HALF * 2)) * BAKE,
  ];
}

function makeCanvas(size, css) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.style.cssText = `position:fixed;pointer-events:none;z-index:20;${css}`;
  document.body.appendChild(c);
  return c;
}

function miniPx() {
  return Math.max(120, Math.min(320, Math.round(settings.minimapSize || 200)));
}

export function createRadar(pois) {
  const touch = document.body.classList.contains('mobile');
  let miniSize = miniPx();
  const terrain = bakeTerrain();
  const mini = makeCanvas(miniSize, 'top:16px;right:16px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);box-shadow:0 4px 18px rgba(0,0,0,.45);display:none;');
  const full = makeCanvas(FULL_SIZE, 'left:50%;top:50%;transform:translate(-50%,-50%);border-radius:10px;border:1px solid rgba(255,255,255,0.4);box-shadow:0 12px 40px rgba(0,0,0,.55);display:none;z-index:40;');
  const miniCtx = mini.getContext('2d');
  const fullCtx = full.getContext('2d');
  let fullOpen = false, active = false, legendT = 0;

  const legend = document.createElement('div');
  legend.style.cssText = 'position:fixed;left:50%;top:calc(50% + 330px);transform:translateX(-50%);color:#fff;font:12px monospace;background:rgba(0,0,0,.55);padding:6px 10px;border-radius:6px;display:none;z-index:41;max-width:90vw;text-align:center;';
  document.body.appendChild(legend);

  // drag minimap
  let drag = null;
  const saved = loadPos();
  if (saved) { mini.style.left = saved.x + 'px'; mini.style.top = saved.y + 'px'; mini.style.right = 'auto'; }
  mini.style.pointerEvents = 'auto';
  mini.addEventListener('pointerdown', (e) => {
    if (!settings.showMinimap) return;
    drag = { x: e.clientX, y: e.clientY, l: mini.offsetLeft, t: mini.offsetTop, moved: false };
    mini.setPointerCapture(e.pointerId);
  });
  mini.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > DRAG_PX) drag.moved = true;
    if (!drag.moved) return;
    mini.style.left = drag.l + dx + 'px';
    mini.style.top = drag.t + dy + 'px';
    mini.style.right = 'auto';
  });
  mini.addEventListener('pointerup', () => {
    if (drag && drag.moved) {
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: mini.offsetLeft, y: mini.offsetTop })); } catch (_) {}
    }
    drag = null;
  });

  function ensureMiniSize() {
    const want = miniPx();
    if (want === miniSize) return;
    miniSize = want;
    mini.width = mini.height = miniSize;
    mini.style.width = miniSize + 'px';
    mini.style.height = miniSize + 'px';
  }

  function drawTerrainPatch(ctx, size, cx, cz, range) {
    // blit from baked map: world range size covers `range` meters around (cx,cz)
    const half = range;
    const x0 = cx - half, z0 = cz - half, x1 = cx + half, z1 = cz + half;
    const [sx0, sy0] = worldToBake(x0, z0);
    const [sx1, sy1] = worldToBake(x1, z1);
    ctx.drawImage(terrain, sx0, sy0, sx1 - sx0, sy1 - sy0, 0, 0, size, size);
  }

  function drawFullTerrain(ctx) {
    ctx.drawImage(terrain, 0, 0, FULL_SIZE, FULL_SIZE);
  }

  function toMini(me, x, z, size, range) {
    const s = size / (2 * range);
    return [(x - me.x) * s + size / 2, (z - me.z) * s + size / 2];
  }

  function toFull(x, z) {
    return [
      ((x + MAP_HALF) / (MAP_HALF * 2)) * FULL_SIZE,
      ((z + MAP_HALF) / (MAP_HALF * 2)) * FULL_SIZE,
    ];
  }

  function drawStructures(ctx, toPx, scale, me, range) {
    // world colliders near the player (or all for full map when range is huge)
    const r = range || MAP_HALF;
    const list = me
      ? colliders.filter((c) => {
          const mx = (c.minX + c.maxX) * 0.5, mz = (c.minZ + c.maxZ) * 0.5;
          return Math.abs(mx - me.x) < r + 40 && Math.abs(mz - me.z) < r + 40;
        })
      : colliders;
    ctx.fillStyle = COL.struct;
    for (const c of list) {
      if (c.ramp) continue;
      const [x0, y0] = toPx(c.minX, c.minZ);
      const [x1, y1] = toPx(c.maxX, c.maxZ);
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (w < 0.5 && h < 0.5) continue;
      if (x1 < 0 && x0 < 0) continue;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.max(w, 1), Math.max(h, 1));
    }
  }

  function drawBuilds(ctx, build, toPx) {
    if (!build || !build.pieces) return;
    ctx.fillStyle = COL.build;
    for (const p of build.pieces.values()) {
      const g = p.geom;
      if (!g) continue;
      const [x0, y0] = toPx(g.minX ?? (g.x - g.w/2), g.minZ ?? (g.z - g.d/2));
      const [x1, y1] = toPx(g.maxX ?? (g.x + g.w/2), g.maxZ ?? (g.z + g.d/2));
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.max(Math.abs(x1 - x0), 1), Math.max(Math.abs(y1 - y0), 1));
    }
  }

  function drawPois(ctx, toPx, labels) {
    for (const p of pois || []) {
      const [x, y] = toPx(p.x, p.z);
      if (x < -10 || y < -10 || x > ctx.canvas.width + 10 || y > ctx.canvas.height + 10) continue;
      const major = p.tier === 'major';
      ctx.fillStyle = major ? COL.major : COL.poi;
      ctx.beginPath();
      ctx.arc(x, y, major ? 4 : 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (labels && major) {
        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.fillText(p.name || '', x + 6, y + 4);
      }
    }
  }

  function drawActors(ctx, me, remotes, enemies, toPx) {
    if (enemies) {
      for (const e of enemies) {
        if (!e.alive && (e.deathT || 0) > 4) continue;
        const [x, y] = toPx(e.x, e.z);
        if (x < -6 || y < -6 || x > ctx.canvas.width + 6 || y > ctx.canvas.height + 6) continue;
        ctx.fillStyle = !e.alive ? COL.down : e.isLeader ? COL.botLeader : COL.bot;
        ctx.beginPath();
        ctx.arc(x, y, e.isLeader ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (remotes) {
      for (const r of remotes.values()) {
        const [x, y] = toPx(r.x, r.z);
        ctx.fillStyle = r.alive ? COL.foe : COL.down;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const [mx, my] = toPx(me.x, me.z);
    // facing wedge
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(me.yaw || 0);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-6, -14);
    ctx.lineTo(6, -14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = COL.me;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawFrame(ctx, size, me, remotes, enemies, build, range, fullMap) {
    if (fullMap) drawFullTerrain(ctx);
    else drawTerrainPatch(ctx, size, me.x, me.z, range);

    const toPx = fullMap
      ? (x, z) => toFull(x, z)
      : (x, z) => toMini(me, x, z, size, range);

    const scale = fullMap ? FULL_SIZE / (MAP_HALF * 2) : size / (2 * range);
    drawStructures(ctx, toPx, scale, fullMap ? null : me, fullMap ? MAP_HALF * 2 : range);
    drawBuilds(ctx, build, toPx);
    drawPois(ctx, toPx, fullMap);
    drawActors(ctx, me, remotes, enemies, toPx);

    // border
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }

  function updateLegend(me, remotes, enemies) {
    legend.replaceChildren();
    const bits = [];
    if (remotes && remotes.size) {
      for (const r of remotes.values()) {
        const d = Math.round(Math.hypot(r.x - me.x, r.z - me.z));
        bits.push(`${r.name} ${d}m ${r.alive ? 'alive' : 'down'}`);
      }
    }
    if (enemies && enemies.length) {
      const alive = enemies.filter((e) => e.alive).length;
      bits.push(`Bots ${alive}/${enemies.length}`);
    }
    legend.textContent = bits.length ? bits.join(' · ') : 'Map';
  }

  function toggleFull() {
    if (!active) return;
    fullOpen = !fullOpen;
    legendT = 0;
  }

  return {
    /**
     * @param me player
     * @param remotes Map of remote players
     * @param dt
     * @param opts {{ active?: boolean, enemies?: array, build?: object }}
     */
    update(me, remotes, dt, opts = {}) {
      const show = opts.active !== false && settings.showMinimap;
      active = !!opts.active;
      const enemies = opts.enemies || null;
      const build = opts.build || null;

      if (!active) {
        mini.style.display = full.style.display = legend.style.display = 'none';
        return;
      }

      if (fullOpen) {
        mini.style.display = 'none';
        full.style.display = legend.style.display = 'block';
        fullCtx.clearRect(0, 0, FULL_SIZE, FULL_SIZE);
        drawFrame(fullCtx, FULL_SIZE, me, remotes, enemies, build, MAP_HALF, true);
        legendT -= dt;
        if (legendT <= 0) { legendT = 0.25; updateLegend(me, remotes, enemies); }
        return;
      }

      full.style.display = legend.style.display = 'none';
      if (!show) {
        mini.style.display = 'none';
        return;
      }
      ensureMiniSize();
      mini.style.display = 'block';
      miniCtx.clearRect(0, 0, miniSize, miniSize);
      drawFrame(miniCtx, miniSize, me, remotes, enemies, build, MINI_RANGE, false);
    },
    toggleFull,
    isFullOpen: () => fullOpen,
    close() {
      fullOpen = false;
      active = false;
      mini.style.display = full.style.display = legend.style.display = 'none';
    },
  };
}
