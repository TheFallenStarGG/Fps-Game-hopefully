/** Extra menus injected into the pause panel: controls, touch layout, character, recording, aim assist, pose tuner */
import { ACTIONS, getBind, setBind, resetBinds, keyName } from './keybinds.js';
import { editLayout } from './layout.js';
import { OPTIONS, look, setLook, applyLook, toHex } from './look.js';
import { recCfg, saveRecCfg } from './recorder.js';
import { settings, saveSettings } from './settings.js';
import { OVR } from './ovr.js';
import { ALL } from './arsenal.js';

const POSE_KEY = 'rr.pose.v1';
try { Object.assign(OVR, JSON.parse(localStorage.getItem(POSE_KEY) || '{}')); } catch (_) {}

const CSS = `
#sub{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(6,8,12,.86)}
#sub.on{display:flex}
#sub.tune{background:transparent;pointer-events:none;align-items:flex-start;justify-content:flex-start}
#sub.tune .card{width:min(330px,56vw);max-height:94vh;pointer-events:auto;opacity:.95}
#sub select,#sub input[type=password],#sub input[type=text]{padding:.5rem;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;max-width:55%}
.sb{padding:.55rem .8rem;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;font-weight:700}
.sb.on{background:var(--acc);color:#1a1205;border-color:var(--acc)}
.sw{width:30px;height:30px;border-radius:6px;border:2px solid rgba(255,255,255,.25);padding:0}
.sw.on{border-color:#fff;box-shadow:0 0 0 2px var(--acc)}
.opt{margin:10px 0}.opt h4{font:700 12px var(--mono);opacity:.8;margin-bottom:6px}.opt>div{display:flex;flex-wrap:wrap;gap:6px}
body.editing #panel{display:none!important}
body.editing .mb{outline:2px dashed rgba(255,255,255,.7)}
body.editing .mb.sel{outline:2px solid var(--acc)}
.mb.rec-on{background:rgba(255,0,0,.5)!important;border-color:#ff5a5a!important}
#btnRec{left:106px;top:calc(70px + var(--sa));width:38px;height:38px;font-size:10px}`;

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c) e.append(c);
  return e;
}

export function initMenus({ isTouch, player, ctrl, tex, playerMesh, viewmodel, recorder, panel, startCard, ui }) {
  document.head.append(h('style', {}, CSS));
  const card = h('div', { class: 'card' });
  const sub = h('div', { id: 'sub' }, card);
  document.body.append(sub);
  let timer = 0, onClose = null, lastW = '';

  function open(title, build, o = {}) {
    clearInterval(timer);
    card.replaceChildren(h('h2', {}, title), ...build(), h('div', { class: 'btns' }, h('button', { class: 'primary', onclick: close }, 'Back')));
    sub.classList.add('on');
    sub.classList.toggle('tune', !!o.tune);
    if (o.tune) { ui.hidePanel(); ui.live(true); }
    onClose = o.onClose || null;
    if (o.poll) timer = setInterval(o.poll, 400);
  }
  function close() {
    clearInterval(timer);
    sub.classList.remove('on', 'tune');
    ui.live(false);
    if (onClose) onClose();
    onClose = null;
    ui.showPanel();
  }

  const kv = (label, ...c) => h('label', { class: 'row' }, h('span', {}, label), ...c);
  const chk = (label, key) => h('label', { class: 'row chk' },
    h('input', { type: 'checkbox', checked: !!settings[key], onchange: (e) => { settings[key] = e.target.checked; saveSettings(); } }), h('span', {}, label));

  // ----- controls (PC) -----
  const controls = () => [
    ...ACTIONS.map(([id, label]) => kv(label, h('button', {
      class: 'sb',
      onclick: (ev) => {
        ev.currentTarget.textContent = 'press a key…';
        const on = (e) => {
          e.preventDefault(); e.stopPropagation();
          removeEventListener('keydown', on, true);
          if (e.code !== 'Escape') setBind(id, e.code);
          show('controls');
        };
        addEventListener('keydown', on, true);
      },
    }, keyName(getBind(id))))),
    h('div', { class: 'btns' }, h('button', { class: 'sb', onclick: () => { resetBinds(); show('controls'); } }, 'Reset to defaults')),
  ];

  // ----- touch layout -----
  const layout = () => [
    h('div', { class: 'note' }, 'Drag any button to move it. Tap a button to select it, then use the slider to resize it. Saved on this device.'),
    h('div', { class: 'btns' }, h('button', { class: 'sb', onclick: () => { close(); ui.hidePanel(); editLayout(() => ui.showPanel()); } }, 'Edit layout')),
  ];

  // ----- aim assist (mobile) -----
  const assist = () => [
    chk('Aim assist (slows + pulls toward targets)', 'aimAssist'),
    chk('Auto-fire when the crosshair is on a target', 'autoFire'),
    kv('Assist strength', h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: settings.assistStrength, oninput: (e) => { settings.assistStrength = +e.target.value; saveSettings(); } })),
  ];

  // ----- character -----
  const character = () => OPTIONS.map((o) => h('div', { class: 'opt' }, h('h4', {}, o.label),
    h('div', {}, ...(o.vals || o.pal).map((v, i) => {
      const on = look[o.k] === i;
      const pick = () => {
        setLook(o.k, i);
        applyLook(playerMesh, look, tex);
        applyLook(viewmodel, look, tex);
        [...b.parentNode.children].forEach((c, n) => c.classList.toggle('on', n === i));
      };
      const b = o.vals
        ? h('button', { class: 'sb' + (on ? ' on' : ''), onclick: pick }, v)
        : h('button', { class: 'sw' + (on ? ' on' : ''), style: `background:${toHex(v)}`, onclick: pick });
      return b;
    }))));
  const openChar = () => { player.showcase = true; show('character'); };

  // ----- recording -----
  const recording = () => {
    const field = (label, key, type = 'text') => kv(label, h('input', { type, value: recCfg[key], onchange: (e) => { recCfg[key] = e.target.value.trim(); saveRecCfg(); } }));
    const sel = (label, key, vals, unit) => kv(label, h('select', { onchange: (e) => { recCfg[key] = +e.target.value; saveRecCfg(); } },
      ...vals.map((m) => h('option', { value: m, selected: recCfg[key] === m }, m + unit))));
    const mp4 = window.MediaRecorder && MediaRecorder.isTypeSupported('video/mp4');
    return [
      h('div', { class: 'note' }, `Format: ${mp4 ? 'MP4 ✔' : window.MediaRecorder ? 'WebM only (this browser cannot record MP4)' : 'recording not supported here'}. Parts of ~45 s are uploaded to your repo's recordings folder. The token is stored only on this device, never in the repo.`),
      field('GitHub token', 'token', 'password'), field('Repo (owner/name)', 'repo'), field('Branch', 'branch'), field('Folder', 'folder'),
      sel('Quality', 'mbps', [1.5, 2.5, 4], ' Mbps'), sel('Width', 'width', [854, 1280, 1600], ' px'),
      h('div', { class: 'btns' },
        h('button', { class: 'sb', onclick: () => { recorder.toggle(); show('recording'); } }, recorder.active ? '■ Stop recording' : '● Start recording'),
        h('button', { class: 'sb', onclick: () => recorder.retry() }, 'Retry uploads'),
        h('button', { class: 'sb', onclick: () => recorder.downloadAll() }, 'Download unsent')),
    ];
  };

  // ----- pose tuner (first-person hands + gun) -----
  const tuner = () => {
    const id = player.weaponId, d = ALL[id];
    lastW = id;
    const o = (OVR[id] = OVR[id] || {});
    for (const k of ['grip', 'fore', 'hip']) o[k] = o[k] || [0, 0, 0];
    o.ads = o.ads || 0;
    const save = () => { try { localStorage.setItem(POSE_KEY, JSON.stringify(OVR)); } catch (_) {} };
    const slider = (label, get, set, min = -0.15, max = 0.15) => {
      const out = h('b', {}, get().toFixed(3));
      const r = h('input', { type: 'range', min, max, step: 0.005, value: get(), oninput: () => { set(+r.value); out.textContent = get().toFixed(3); save(); } });
      return h('label', { class: 'row' }, h('span', {}, label), r, out);
    };
    const v3 = (name, arr) => ['x', 'y', 'z'].map((a, i) => slider(`${name} ${a}`, () => arr[i], (v) => { arr[i] = v; }));
    return [
      h('div', { class: 'note' }, `${d.name}. Affects the first-person view only. Switch weapons with the slot bar at the top.`),
      h('div', { class: 'btns' },
        h('button', { class: 'sb', onclick: () => { if (d.kind === 'gun') player.ads = !player.ads; } }, 'Aim'),
        h('button', { class: 'sb', onclick: () => { if (d.kind !== 'gun') return; player.ammo = 0; player.reserve = Math.max(player.reserve, d.mag * 2); ctrl.startReload(); } }, 'Reload'),
        h('button', { class: 'sb', onclick: () => { delete OVR[id]; save(); show('tune'); } }, 'Reset'),
        h('button', { class: 'sb', onclick: () => navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(OVR)) }, 'Copy all')),
      ...v3('Right hand', o.grip), ...v3('Left hand', o.fore), ...v3('Gun (hip)', o.hip),
      slider('Gun distance (aim)', () => o.ads, (v) => { o.ads = v; }, -0.15, 0.25),
    ];
  };

  const SEC = {
    controls: { title: 'Controls', build: controls },
    layout: { title: 'Touch layout', build: layout },
    assist: { title: 'Aim assist', build: assist },
    character: { title: 'Character', build: character, opts: { tune: true, onClose: () => { player.showcase = false; } } },
    recording: { title: 'Recording', build: recording },
    tune: { title: 'Pose tuner', build: tuner, opts: { tune: true, poll: () => { if (player.weaponId !== lastW) show('tune'); } } },
  };
  function show(n) { open(SEC[n].title, SEC[n].build, SEC[n].opts); }

  // ----- buttons -----
  const mk = (txt, fn) => h('button', { type: 'button', class: 'ghost', onclick: fn }, txt);
  const extra = h('div', { class: 'btns' },
    !isTouch && mk('Controls', () => show('controls')),
    isTouch && mk('Touch layout', () => show('layout')),
    isTouch && mk('Aim assist', () => show('assist')),
    mk('Character', openChar), mk('Recording', () => show('recording')), mk('Pose tuner', () => show('tune')));
  const pc = panel.querySelector('.card');
  pc.insertBefore(extra, pc.querySelector('.btns'));
  startCard.append(h('div', { class: 'btns' }, mk('Character', openChar)));

  if (isTouch) {
    const rb = h('button', { id: 'btnRec', class: 'mb', type: 'button' }, 'REC');
    rb.addEventListener('touchstart', (e) => { e.preventDefault(); recorder.toggle(); }, { passive: false });
    document.getElementById('mobile').append(rb);
    setInterval(() => {
      const a = recorder.active, s = Math.floor(recorder.elapsed);
      rb.classList.toggle('rec-on', a);
      rb.textContent = a ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'REC';
    }, 500);
  }
}
