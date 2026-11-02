/**
 * Graphics manager: applies the quality settings (shadows, view distance, render scale, effects), owns the optional
 * post-processing (lib/post.js), the auto-performance helper and the Graphics menu.
 */
import * as THREE from 'three';
import { settings, saveSettings, PRESETS, applyPreset, detectPreset } from './settings.js';
import { createPost } from './post.js';

const SHADOWS = [
  null,
  { size: 1024, half: 38, every: 2, chars: false }, // basic
  { size: 2048, half: 45, every: 1, chars: true }, // normal (original)
  { size: 4096, half: 60, every: 1, chars: true }, // high
];
const VIEW = [null, { far: 170, fog: [35, 150] }, { far: 250, fog: [60, 215] }, { far: 400, fog: [80, 320] }];
const BUMP = [['grass', 0.5], ['concrete', 1.2], ['wood', 1.0], ['metal', 0.6], ['bark', 1.0]];

const CSS = `
#gfxPanel{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(6,8,12,.9)}
#gfxPanel.on{display:flex}
#gfxPanel .card{width:min(520px,100%)}
#gfxPanel h4{font:800 12px var(--mono);letter-spacing:.18em;color:var(--acc);margin:16px 0 4px}
#gfxPanel select{padding:.45rem;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff}
#gfxPanel select option{color:#000}
.gp{padding:.55rem .8rem;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;font-weight:700}
.gp.on{background:var(--acc);color:#1a1205;border-color:var(--acc)}
#gfxRestart{display:none;margin-top:12px;padding:8px 10px;border-radius:6px;background:rgba(255,194,71,.18);font-size:13px}
#gfxRestart.on{display:flex;gap:10px;align-items:center;justify-content:space-between}`;

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c) e.append(c);
  return e;
}

export function createGfx(o) {
  const { renderer, scene, camera, vmScene, vmCamera, world, tex, isTouch } = o;
  const sun = world.sun;
  const post = createPost(renderer);
  const muzzle = [];
  scene.traverse((n) => { if (n.isPointLight) muzzle.push(n); });
  const boot = { texRes: settings.texRes, aa: settings.aa, aniso: settings.aniso };
  const bumped = new Map();
  let frame = 0, shadowEvery = 1, charShadows = true, bumpOn = false, charT = 0, perfAcc = 0, perfN = 0, perfLow = 0;
  const v2 = new THREE.Vector2();

  // ---------- applying settings ----------
  function setChars(on) {
    for (const root of o.getCharacters()) root.traverse((n) => { if (n.isMesh && n.castShadow !== on) n.castShadow = on; });
  }

  function applyShadows() {
    const q = SHADOWS[settings.shadows];
    sun.castShadow = !!q;
    if (!q) { shadowEvery = 1; charShadows = true; return; }
    const size = isTouch ? Math.min(q.size, 1024) : q.size, s = sun.shadow, c = s.camera;
    if (s.mapSize.x !== size) { s.mapSize.set(size, size); if (s.map) { s.map.dispose(); s.map = null; } }
    if (c.right !== q.half) { c.left = -q.half; c.right = q.half; c.top = q.half; c.bottom = -q.half; c.updateProjectionMatrix(); }
    s.normalBias = ((2 * q.half) / size) * 1.2;
    shadowEvery = q.every;
    charShadows = q.chars;
    renderer.shadowMap.needsUpdate = true;
    setChars(charShadows);
  }

  function applyView() {
    const v = VIEW[settings.viewDist] || VIEW[3];
    camera.far = v.far;
    camera.updateProjectionMatrix();
    if (scene.fog) { scene.fog.near = v.fog[0]; scene.fog.far = v.fog[1]; }
  }

  function applyScale() {
    const base = Math.min(devicePixelRatio || 1, isTouch ? 1.5 : 2);
    renderer.setPixelRatio(base * Math.max(0.4, Math.min(1.5, settings.renderScale)));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.getDrawingBufferSize(v2);
    post.setSize(v2.x, v2.y);
  }

  function applyBump() {
    const want = !!settings.bump;
    if (want === bumpOn) return;
    bumpOn = want;
    if (!want) {
      for (const [m, prev] of bumped) { m.bumpMap = prev; m.needsUpdate = true; }
      bumped.clear();
      return;
    }
    tex.ensureBump();
    const table = new Map();
    for (const [name, s] of BUMP) if (tex[name] && tex.bump[name]) table.set(tex[name], [tex.bump[name], s]);
    scene.traverse((n) => {
      const m = n.material;
      if (!n.isMesh || !m || Array.isArray(m) || !m.map || bumped.has(m)) return;
      const e = table.get(m.map);
      if (!e) return;
      e[0].repeat.copy(m.map.repeat);
      bumped.set(m, m.bumpMap || null);
      m.bumpMap = e[0]; m.bumpScale = e[1]; m.needsUpdate = true;
    });
  }

  function apply() {
    applyShadows();
    applyView();
    applyScale();
    for (const l of muzzle) if (l.visible !== !!settings.muzzleLights) l.visible = !!settings.muzzleLights;
    post.configure({ rays: settings.godRays, ao: settings.ao, bloom: settings.bloom, grade: settings.grade, msaa: settings.aa && !isTouch });
    applyBump();
    if (o.onBots) o.onBots(settings.bots);
  }

  // ---------- frame ----------
  function failPost(e) {
    console.error('post-processing disabled:', e);
    settings.godRays = settings.ao = settings.bloom = settings.grade = false;
    saveSettings();
    post.configure({});
    if (o.say) o.say('Post effects turned off (not supported here)');
  }

  function render(vmOn) {
    frame++;
    if (sun.castShadow && shadowEvery > 1) {
      renderer.shadowMap.autoUpdate = false;
      if (frame % shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
    } else renderer.shadowMap.autoUpdate = true;
    let done = false;
    if (post.active) {
      try { post.render(scene, camera, world.sunDir); done = true; } catch (e) { failPost(e); }
    }
    if (!done) { renderer.setRenderTarget(null); renderer.clear(); renderer.render(scene, camera); }
    if (vmOn) { renderer.setRenderTarget(null); renderer.clearDepth(); renderer.render(vmScene, vmCamera); }
  }

  /** rawDt = real frame time in seconds */
  function tick(rawDt) {
    if (!charShadows && sun.castShadow && (charT += rawDt) > 1.5) { charT = 0; setChars(false); }
    if (!settings.autoPerf || rawDt > 0.5) return;
    perfAcc += rawDt; perfN++;
    if (perfAcc < 2) return;
    const fps = perfN / perfAcc;
    perfAcc = perfN = 0;
    perfLow = fps < 28 ? perfLow + 1 : Math.max(0, perfLow - 1);
    if (perfLow >= 2) { perfLow = 0; stepDown(); }
  }

  function stepDown() {
    const s = settings;
    let msg = '';
    if (s.godRays || s.ao || s.bloom || s.grade) { s.godRays = s.ao = s.bloom = s.grade = false; msg = 'post effects off'; }
    else if (s.shadows >= 3) { s.shadows = 2; msg = 'shadows: normal'; }
    else if (s.renderScale > 0.85) { s.renderScale = 0.85; msg = 'render scale 85%'; }
    else if (s.shadows === 2) { s.shadows = 1; msg = 'shadows: basic'; }
    else if (s.viewDist === 3) { s.viewDist = 2; msg = 'view distance: medium'; }
    else if (s.muzzleLights) { s.muzzleLights = false; msg = 'muzzle lights off'; }
    else if (s.renderScale > 0.7) { s.renderScale = 0.7; msg = 'render scale 70%'; }
    else if (s.shadows === 1) { s.shadows = 0; msg = 'shadows off'; }
    else if (s.viewDist === 2) { s.viewDist = 1; msg = 'view distance: short'; }
    else if (s.bots > 4) { s.bots = 4; msg = 'fewer bots'; }
    else if (s.renderScale > 0.55) { s.renderScale = 0.55; msg = 'render scale 55%'; }
    else return;
    s.preset = detectPreset();
    apply();
    if (o.say) o.say('Auto performance: ' + msg);
  }

  // ---------- menu ----------
  let panel = null;
  function openMenu() {
    if (!panel) {
      document.head.append(h('style', {}, CSS));
      panel = h('div', { id: 'gfxPanel' }, h('div', { class: 'card' }));
      document.body.append(panel);
    }
    fill();
    panel.classList.add('on');
  }
  const closeMenu = () => panel && panel.classList.remove('on');

  function fill() {
    const card = panel.firstChild;
    const needsRestart = () => settings.texRes !== boot.texRes || settings.aa !== boot.aa || settings.aniso !== boot.aniso;
    const bar = h('div', { id: 'gfxRestart' }, h('span', {}, 'Texture / anti-aliasing changes need a restart.'),
      h('button', { class: 'gp', type: 'button', onclick: () => location.reload() }, 'Restart now'));
    const presetBtns = [];
    const refresh = () => {
      const p = detectPreset();
      presetBtns.forEach(([n, b]) => b.classList.toggle('on', n === p));
      bar.classList.toggle('on', needsRestart());
    };
    const changed = (restart) => { settings.preset = detectPreset(); saveSettings(); apply(); refresh(); };
    const row = (label, ctrl) => h('label', { class: 'row' }, h('span', {}, label), ctrl);
    const select = (label, key, opts, extra) => row(label, h('select', {
      onchange: (e) => { settings[key] = Number(e.target.value); if (extra) extra(settings[key]); changed(); },
    }, ...opts.map(([v, t]) => h('option', { value: v, selected: settings[key] === v }, t))));
    const check = (label, key) => h('label', { class: 'row chk' },
      h('input', { type: 'checkbox', checked: !!settings[key], onchange: (e) => { settings[key] = e.target.checked; changed(); } }), h('span', {}, label));
    const range = (label, key, min, max, step, fmt) => {
      const out = h('b', {}, fmt(settings[key]));
      return h('label', { class: 'row' }, h('span', {}, label), h('input', {
        type: 'range', min, max, step, value: settings[key],
        oninput: (e) => { settings[key] = Number(e.target.value); out.textContent = fmt(settings[key]); changed(); },
      }), out);
    };

    presetBtns.length = 0;
    const pr = h('div', { class: 'btns' });
    for (const [n, t] of [['perf', 'Performance'], ['def', 'Default'], ['high', 'High']]) {
      const b = h('button', { class: 'gp', type: 'button', onclick: () => { applyPreset(n); apply(); fill(); } }, t);
      presetBtns.push([n, b]);
      pr.append(b);
    }

    card.replaceChildren(
      h('h2', {}, 'GRAPHICS'),
      pr,
      h('h4', {}, 'PERFORMANCE'),
      select('Shadows', 'shadows', [[0, 'Off (fastest)'], [1, 'Basic'], [2, 'Normal'], [3, 'High']]),
      select('View distance', 'viewDist', [[1, 'Short'], [2, 'Medium'], [3, 'Far']]),
      range('Render scale', 'renderScale', 0.5, 1.5, 0.05, (v) => Math.round(v * 100) + '%'),
      range('Bots in Bot Arena', 'bots', 1, o.maxBots || 10, 1, (v) => String(Math.min(v, o.maxBots || 10))),
      check('Muzzle flash lighting', 'muzzleLights'),
      check('Shell casings & dropped mags', 'debris'),
      check('Animate distant characters less often', 'animLod'),
      check('Auto performance (lowers settings if FPS stays low)', 'autoPerf'),
      h('h4', {}, 'QUALITY'),
      select('Texture resolution (restart)', 'texRes', [[0.5, 'Low'], [1, 'Default'], [2, 'High'], [3, 'Ultra']], (v) => { settings.aniso = v >= 2 ? 16 : v < 1 ? 1 : 8; }),
      check('Anti-aliasing (restart)', 'aa'),
      check('Surface detail (bump maps)', 'bump'),
      h('h4', {}, 'HIGH-END EFFECTS' + (post.supported ? '' : ' (not supported on this device)')),
      check('Sun god rays', 'godRays'),
      check('Ambient occlusion (contact shadows)', 'ao'),
      check('Bloom', 'bloom'),
      check('Cinematic colour + vignette', 'grade'),
      bar,
      h('div', { class: 'note' }, 'If the screen ever breaks, add ?safe to the end of the game URL to reset graphics.'),
      h('div', { class: 'btns' }, h('button', { class: 'primary', type: 'button', onclick: closeMenu }, 'Back')),
    );
    refresh();
  }

  return { apply, render, tick, openMenu, closeMenu, resize: applyScale, post };
}
