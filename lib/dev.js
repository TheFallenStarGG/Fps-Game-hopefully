/**
 * Developer tools — gated to the project owner.
 * Unlock: callsign in ALLOWLIST, or ?dev=rift-dev, or unlock code in Settings.
 */
import * as THREE from 'three';
import { settings, saveSettings } from './settings.js';
import { ALL, SLOTS } from './arsenal.js';

const ALLOWLIST = new Set(['thefallenstargg', 'thefallenstar', 'fallenstargg']);
const UNLOCK_CODE = 'rift-dev'; // also works as ?dev=rift-dev
const LS_KEY = 'rift.dev.unlocked';

let _unlocked = false;
let _fly = false;
let _god = false;
let _infAmmo = false;
let _hooks = null;
let _bar = null;
let _toastT = 0;

try {
  if (localStorage.getItem(LS_KEY) === '1') _unlocked = true;
  if (/[?&]dev=rift-dev\b/.test(location.search)) {
    _unlocked = true;
    localStorage.setItem(LS_KEY, '1');
  }
} catch (_) {}

export function devUnlocked() {
  return _unlocked;
}

export function tryUnlock(nameOrCode) {
  const s = String(nameOrCode || '').trim().toLowerCase();
  if (!s) return false;
  if (ALLOWLIST.has(s) || s === UNLOCK_CODE) {
    _unlocked = true;
    try { localStorage.setItem(LS_KEY, '1'); } catch (_) {}
    return true;
  }
  return false;
}

export function lockDev() {
  _unlocked = false;
  _fly = false;
  _god = false;
  _infAmmo = false;
  try { localStorage.removeItem(LS_KEY); } catch (_) {}
  hideBar();
}

export function checkCallsign(name) {
  if (tryUnlock(name)) refreshDevUI();
}

export function flying() { return _unlocked && _fly; }
export function godMode() { return _unlocked && _god; }
export function infiniteAmmo() { return _unlocked && _infAmmo; }

export function setFly(v) { _fly = !!v && _unlocked; if (_bar) syncToggles(); }
export function setGod(v) { _god = !!v && _unlocked; if (_bar) syncToggles(); }
export function setInfAmmo(v) { _infAmmo = !!v && _unlocked; if (_bar) syncToggles(); }

function toast(msg) {
  if (!_hooks || !_hooks.hud) return;
  _hooks.hud.setMsg(msg, 1800);
}

function syncToggles() {
  if (!_bar) return;
  _bar.querySelectorAll('[data-dev-toggle]').forEach((btn) => {
    const k = btn.getAttribute('data-dev-toggle');
    const on = k === 'fly' ? _fly : k === 'god' ? _god : k === 'ammo' ? _infAmmo : false;
    btn.classList.toggle('on', on);
  });
}

export function hideBar() {
  if (_bar) _bar.classList.remove('on');
}

export function showBar() {
  if (!_unlocked || !_bar) return;
  _bar.classList.add('on');
  syncToggles();
}

/** Inject runtime hooks from game.js */
export function bindDev(hooks) {
  _hooks = hooks;
  buildBar();
  refreshDevUI();
}

function buildBar() {
  if (_bar) return;
  const style = document.createElement('style');
  style.textContent = `
#devBar{display:none;position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:60;
  width:min(920px,calc(100vw - 24px));pointer-events:none;font-family:system-ui,-apple-system,sans-serif}
#devBar.on{display:block}
#devBar .shell{pointer-events:auto;background:linear-gradient(180deg,rgba(16,20,28,.94),rgba(10,12,18,.96));
  border:1px solid rgba(255,194,71,.35);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06);
  backdrop-filter:blur(12px);padding:12px 14px 14px;color:#eef2f7}
#devBar .head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
#devBar .head h3{margin:0;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#ffc247;font-weight:700}
#devBar .head span{font-size:11px;opacity:.55}
#devBar .row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
#devBar .label{width:100%;font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.45;margin-top:4px}
#devBar button{appearance:none;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);
  color:#eef2f7;border-radius:10px;padding:8px 12px;font:600 12px system-ui;cursor:pointer;
  transition:background .15s,border-color .15s,transform .1s}
#devBar button:hover{background:rgba(255,194,71,.12);border-color:rgba(255,194,71,.45)}
#devBar button:active{transform:scale(.97)}
#devBar button.on{background:rgba(255,194,71,.2);border-color:#ffc247;color:#ffc247}
#devBar button.danger{border-color:rgba(255,77,77,.35)}
#devBar button.danger:hover{background:rgba(255,77,77,.15);border-color:#ff4d4d;color:#ff8a8a}
#devSec{display:none;margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)}
#devSec.on{display:block}
#devSec h3{margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#ffc247}
#devSec .note{font-size:12px;opacity:.6;margin:0 0 10px;line-height:1.4}
#devUnlockRow{display:flex;gap:8px;margin-bottom:10px}
#devUnlockRow input{flex:1;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:10px;
  color:#eef2f7;padding:8px 10px;font:13px system-ui}
#devUnlockRow button{border:1px solid rgba(255,194,71,.4);background:rgba(255,194,71,.12);color:#ffc247;
  border-radius:10px;padding:8px 12px;font:600 12px system-ui;cursor:pointer}
  `;
  document.head.appendChild(style);

  _bar = document.createElement('div');
  _bar.id = 'devBar';
  _bar.innerHTML = `
    <div class="shell">
      <div class="head">
        <h3>Developer Console</h3>
        <span>sandbox · not ranked</span>
      </div>
      <div class="label">Movement & combat</div>
      <div class="row">
        <button type="button" data-dev-toggle="fly">Fly</button>
        <button type="button" data-dev-toggle="god">God mode</button>
        <button type="button" data-dev-toggle="ammo">Infinite ammo</button>
        <button type="button" data-act="heal">Full heal</button>
        <button type="button" data-act="restock">Restock loadout</button>
      </div>
      <div class="label">Spawn vehicles</div>
      <div class="row" data-spawn-vehicles></div>
      <div class="label">Spawn weapons (ground pickups)</div>
      <div class="row" data-spawn-weapons></div>
      <div class="label">World</div>
      <div class="row">
        <button type="button" data-act="buildWall">Spawn wall</button>
        <button type="button" data-act="buildRamp">Spawn ramp</button>
        <button type="button" data-act="buildFloor">Spawn floor</button>
        <button type="button" data-act="clearBuilds">Clear builds</button>
        <button type="button" data-act="bot">Spawn bot</button>
        <button type="button" class="danger" data-act="killBots">Clear bots</button>
      </div>
      <div class="row" style="margin-top:10px">
        <button type="button" data-act="lobby">Return to lobby</button>
      </div>
    </div>`;
  document.body.appendChild(_bar);

  _bar.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !_unlocked) return;
    const toggle = t.getAttribute('data-dev-toggle');
    const act = t.getAttribute('data-act');
    const spawn = t.getAttribute('data-spawn');
    if (toggle === 'fly') { _fly = !_fly; syncToggles(); toast(_fly ? 'Fly ON — Space up · Ctrl down' : 'Fly OFF'); }
    if (toggle === 'god') { _god = !_god; syncToggles(); toast(_god ? 'God mode ON' : 'God mode OFF'); }
    if (toggle === 'ammo') { _infAmmo = !_infAmmo; syncToggles(); toast(_infAmmo ? 'Infinite ammo ON' : 'Infinite ammo OFF'); }
    if (act && _hooks && _hooks[act]) _hooks[act]();
    if (spawn && _hooks && _hooks.spawn) _hooks.spawn(spawn);
  });
}

export function fillSpawnButtons(vehicleIds, weaponIds) {
  if (!_bar) return;
  const vRow = _bar.querySelector('[data-spawn-vehicles]');
  const wRow = _bar.querySelector('[data-spawn-weapons]');
  if (vRow) {
    vRow.innerHTML = '';
    for (const id of vehicleIds) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = id;
      b.setAttribute('data-spawn', 'vehicle:' + id);
      vRow.appendChild(b);
    }
  }
  if (wRow) {
    wRow.innerHTML = '';
    for (const id of weaponIds) {
      const b = document.createElement('button');
      b.type = 'button';
      const def = ALL[id];
      b.textContent = def ? def.name : id;
      b.setAttribute('data-spawn', 'weapon:' + id);
      wRow.appendChild(b);
    }
  }
}

/** Settings panel: show/hide developer section */
export function refreshDevUI() {
  const sec = document.getElementById('devSec');
  if (!sec) return;
  sec.classList.toggle('on', _unlocked);
  // bind checkboxes if present
  const map = [
    ['setDevErrors', 'devShowErrors'],
    ['setDevLoadLogs', 'devShowLoadLogs'],
  ];
  for (const [id, key] of map) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.checked = !!settings[key];
    el.onchange = () => {
      settings[key] = el.checked;
      saveSettings();
      if (key === 'devShowErrors') applyErrorOverlaySetting();
    };
  }
  applyErrorOverlaySetting();
}

export function applyErrorOverlaySetting() {
  document.documentElement.classList.toggle('dev-errors', !!(settings.devShowErrors && _unlocked));
}

/** Install error overlay that respects the setting (off by default). */
export function installErrorOverlay() {
  const box = document.createElement('pre');
  box.id = 'devErrBox';
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:40%;overflow:auto;margin:0;padding:10px 12px;background:rgba(90,0,0,.94);color:#fff;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;z-index:99999;white-space:pre-wrap;display:none;user-select:text;pointer-events:auto;touch-action:pan-y;border-top:1px solid rgba(255,80,80,.5)';
  const style = document.createElement('style');
  style.textContent = 'html.dev-errors #devErrBox.show{display:block}';
  document.head.appendChild(style);
  function show(t) {
    if (!settings.devShowErrors || !_unlocked) return;
    if (!box.parentNode) document.body.appendChild(box);
    box.classList.add('show');
    box.textContent += t + '\n\n';
  }
  addEventListener('error', (e) => {
    if (e.target && e.target !== window && e.target.tagName) {
      show('Failed to load: ' + (e.target.src || e.target.href || e.target.tagName));
      return;
    }
    show((e.message || 'Error') + '\n' + String(e.filename || '').split('/').slice(-2).join('/') + ':' + e.lineno + ':' + e.colno);
  }, true);
  addEventListener('unhandledrejection', (e) => {
    show('Promise error: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
  });
  // gate console noise for load logs
  const rawInfo = console.info.bind(console);
  const rawWarn = console.warn.bind(console);
  console.info = (...args) => {
    if (settings.devShowLoadLogs && _unlocked) rawInfo(...args);
    else if (!String(args[0] || '').includes('[rifleman]') && !String(args[0] || '').includes('[humanoid]') && !String(args[0] || '').includes('[hand]')) rawInfo(...args);
  };
  console.warn = (...args) => {
    const s = String(args[0] || '');
    if (s.includes('[rifleman]') || s.includes('[humanoid]') || s.includes('[hand]')) {
      if (settings.devShowLoadLogs && _unlocked) rawWarn(...args);
      return;
    }
    rawWarn(...args);
  };
}

export function mountDevSettingsSection() {
  const panel = document.querySelector('#panel .card');
  if (!panel || document.getElementById('devSec')) return;
  const sec = document.createElement('div');
  sec.id = 'devSec';
  sec.innerHTML = `
    <h3>Developer</h3>
    <p class="note">Tools for testing. Only visible when unlocked. Errors and model load logs stay off unless you enable them.</p>
    <div id="devUnlockRow">
      <input id="devCode" type="password" placeholder="Unlock code" autocomplete="off" />
      <button type="button" id="devUnlockBtn">Unlock</button>
    </div>
    <label class="row chk"><input id="setDevErrors" type="checkbox" /><span>Show red error overlay</span></label>
    <label class="row chk"><input id="setDevLoadLogs" type="checkbox" /><span>Log model load messages</span></label>
    <div class="note" style="margin-top:8px">Tip: walk into the <b>DEV</b> portal in the lobby, or open this menu in the sandbox for the full console.</div>
  `;
  const keys = panel.querySelector('.keys');
  if (keys) panel.insertBefore(sec, keys);
  else panel.appendChild(sec);

  // Always show unlock row; rest only when unlocked via class
  const unlockBtn = sec.querySelector('#devUnlockBtn');
  const unlockIn = sec.querySelector('#devCode');
  const tryCode = () => {
    if (tryUnlock(unlockIn.value)) {
      unlockIn.value = '';
      refreshDevUI();
      toast('Developer mode unlocked');
    } else {
      unlockIn.value = '';
      unlockIn.placeholder = 'Invalid code';
    }
  };
  unlockBtn.addEventListener('click', tryCode);
  unlockIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryCode(); });

  // Show section always so unlock is possible; inner toggles only useful when unlocked
  sec.classList.add('on');
  refreshDevUI();
}
