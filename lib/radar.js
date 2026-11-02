/**
 * Player finder: a corner minimap plus a full-map overlay (toggle with M) showing every other player and the points of interest.
 */
import { MAP_HALF, LAKE } from './terrain.js';

const MINI_SIZE = 200, MINI_RANGE = 220, FULL_SIZE = 640;
const COL = { land: '#3f5a3a', lake: '#2f6a86', poi: '#e9e4d8', major: '#f5c76b', me: '#ffffff', foe: '#ff6b5a', down: '#7a7a7a' };

function makeCanvas(size, css) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.style.cssText = `position:fixed;pointer-events:none;${css}`;
  document.body.appendChild(c);
  return c;
}

function drawLand(ctx, size, toPx, scale) {
  ctx.fillStyle = COL.land;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = COL.lake;
  const c = toPx(LAKE.x, LAKE.z);
  ctx.beginPath();
  ctx.ellipse(c[0], c[1], LAKE.rx * scale, LAKE.rz * scale, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPois(ctx, pois, toPx, scale, labels) {
  for (const p of pois) {
    const [x, y] = toPx(p.x, p.z);
    if (x < -8 || y < -8 || x > ctx.canvas.width + 8 || y > ctx.canvas.height + 8) continue;
    const major = p.tier === 'major';
    ctx.fillStyle = major ? COL.major : COL.poi;
    ctx.beginPath();
    ctx.arc(x, y, major ? 4 : 1.6, 0, Math.PI * 2);
    ctx.fill();
    if (labels && major) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.fillText(p.name, x + 6, y + 4);
    }
  }
}

function drawDots(ctx, me, remotes, toPx) {
  for (const r of remotes.values()) {
    const [x, y] = toPx(r.x, r.z);
    ctx.fillStyle = r.alive ? COL.foe : COL.down;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  const [mx, my] = toPx(me.x, me.z);
  ctx.fillStyle = COL.me;
  ctx.beginPath();
  ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

export function createRadar(pois) {
  const mini = makeCanvas(MINI_SIZE, 'top:16px;right:16px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);display:none;');
  const full = makeCanvas(FULL_SIZE, 'left:50%;top:50%;transform:translate(-50%,-50%);border-radius:10px;display:none;');
  const miniCtx = mini.getContext('2d');
  const fullCtx = full.getContext('2d');
  const legend = document.createElement('div');
  legend.style.cssText = 'position:fixed;left:50%;top:calc(50% + 336px);transform:translateX(-50%);color:#f2f2f2;font:14px sans-serif;display:none;pointer-events:none;';
  document.body.appendChild(legend);

  const fullScale = FULL_SIZE / (2 * MAP_HALF);
  const fullPx = (x, z) => [(x + MAP_HALF) * fullScale, (z + MAP_HALF) * fullScale];
  let fullOpen = false, active = false, legendT = 0;

  function drawFull(me, remotes) {
    fullCtx.clearRect(0, 0, FULL_SIZE, FULL_SIZE);
    drawLand(fullCtx, FULL_SIZE, fullPx, fullScale);
    drawPois(fullCtx, pois, fullPx, fullScale, true);
    drawDots(fullCtx, me, remotes, fullPx);
  }

  function updateLegend(me, remotes) {
    legend.replaceChildren();
    if (remotes.size === 0) {
      legend.textContent = 'No other players in range';
      return;
    }
    for (const r of remotes.values()) {
      const d = Math.round(Math.hypot(r.x - me.x, r.z - me.z));
      const line = document.createElement('div');
      line.textContent = `${r.name}  ${d} m  ${r.alive ? 'alive' : 'down'}`;
      legend.appendChild(line);
    }
  }

  return {
    update(me, remotes, dt, multi) {
      if (!multi) {
        mini.style.display = full.style.display = legend.style.display = 'none';
        return;
      }
      active = true;
      mini.style.display = fullOpen ? 'none' : 'block';
      full.style.display = legend.style.display = fullOpen ? 'block' : 'none';
      if (!fullOpen) {
        const s = MINI_SIZE / (2 * MINI_RANGE);
        const toMini = (x, z) => [(x - me.x) * s + MINI_SIZE / 2, (z - me.z) * s + MINI_SIZE / 2];
        miniCtx.clearRect(0, 0, MINI_SIZE, MINI_SIZE);
        drawLand(miniCtx, MINI_SIZE, toMini, s);
        drawPois(miniCtx, pois, toMini, s, false);
        drawDots(miniCtx, me, remotes, toMini);
        return;
      }
      drawFull(me, remotes);
      legendT -= dt;
      if (legendT <= 0) { legendT = 0.25; updateLegend(me, remotes); }
    },
    toggleFull() {
      if (!active) return;
      fullOpen = !fullOpen;
      legendT = 0;
    },
    isFullOpen: () => fullOpen,
    close() {
      fullOpen = false;
      active = false;
      mini.style.display = full.style.display = legend.style.display = 'none';
    },
  };
}
