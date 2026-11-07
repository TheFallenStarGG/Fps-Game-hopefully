/**
 * Auto-update checker for Rift Horizon (Electron EXE + Capacitor APK + web).
 *
 * - Local version comes from ./version.txt stamped by CI (no manual bumps).
 * - Remote version comes from GitHub Releases /latest.
 * - Update button: Electron downloads+relaunches; Android downloads APK and
 *   fires the system package-installer intent; web opens the release page.
 * - Cancel locks multiplayer until the installed version catches up.
 */
const REPO = 'TheFallenStarGG/Rift-Horizon';
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const CACHE_KEY = 'rift.update.cache.v1';
const OFFLINE_KEY = 'rift.forceOfflineUntil';
const CACHE_MS = 30 * 60 * 1000; // 30 min

function parseVer(s) {
  return String(s || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => parseInt(n, 10) || 0);
}

/** true if a is strictly newer than b */
export function isNewer(a, b) {
  const A = parseVer(a);
  const B = parseVer(b);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i] || 0;
    const y = B[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export function detectPlatform() {
  try {
    if (window.riftDesktop && typeof window.riftDesktop.downloadUpdate === 'function') {
      return 'electron';
    }
  } catch (_) {}
  // Real native Capacitor only — normal mobile browsers must stay 'web'
  try {
    const Cap = window.Capacitor;
    if (Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform()) {
      const p = (Cap.getPlatform && Cap.getPlatform()) || '';
      if (p === 'android') return 'android';
      if (p === 'ios') return 'ios';
      return 'native';
    }
  } catch (_) {}
  try {
    if (typeof window.__riftInstallApk === 'function' || (window.Android && window.Android.installApkBase64)) {
      return 'android';
    }
  } catch (_) {}
  return 'web';
}

/** Browser / GitHub Pages — always live, never update-prompt or offline-lock */
export function isWebClient() {
  const p = detectPlatform();
  return p === 'web' || p === 'ios';
}

async function readLocalVersion() {
  try {
    const r = await fetch(new URL('../version.txt', import.meta.url).href, { cache: 'no-store' });
    if (r.ok) {
      const t = (await r.text()).trim();
      if (t) return t.replace(/^v/i, '');
    }
  } catch (_) {}
  try {
    const r = await fetch('version.txt', { cache: 'no-store' });
    if (r.ok) {
      const t = (await r.text()).trim();
      if (t) return t.replace(/^v/i, '');
    }
  } catch (_) {}
  return '0.0.0';
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !o.at || Date.now() - o.at > CACHE_MS) return null;
    return o;
  } catch (_) {
    return null;
  }
}

function saveCache(info) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), info }));
  } catch (_) {}
}

export function getOfflineLock() {
  try {
    return localStorage.getItem(OFFLINE_KEY) || '';
  } catch (_) {
    return '';
  }
}

export function setOfflineLock(version) {
  try {
    if (version) localStorage.setItem(OFFLINE_KEY, String(version).replace(/^v/i, ''));
    else localStorage.removeItem(OFFLINE_KEY);
  } catch (_) {}
}

/** true when multiplayer must stay disabled until user updates */
export function isForcedOffline(localVersion) {
  if (isWebClient()) return false;
  const until = getOfflineLock();
  if (!until) return false;
  return isNewer(until, localVersion || '0.0.0');
}

function pickAssets(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const by = (re) => {
    const a = list.find((x) => re.test(x.name || ''));
    return a ? a.browser_download_url : null;
  };
  return {
    apk: by(/android\.apk$/i) || by(/\.apk$/i),
    portable: by(/portable\.exe$/i),
    setup: by(/setup\.exe$/i) || by(/windows.*\.exe$/i),
  };
}

/**
 * @returns {Promise<null|{local, remote, notes, htmlUrl, assets, platform}>}
 */
export async function checkForUpdate({ force = false } = {}) {
  // Packaged clients only. Browser / GitHub Pages is always the live build.
  if (isWebClient()) return null;
const local = await readLocalVersion();
  const until = getOfflineLock();
  // Clear lock once the installed build is no longer older than the skipped version
  if (until && !isNewer(until, local)) setOfflineLock('');

  if (!force) {
    const c = loadCache();
    if (c && c.info) {
      if (c.info.remote && isNewer(c.info.remote, local)) {
        return { ...c.info, local, platform: detectPlatform() };
      }
      if (c.info.remote && !isNewer(c.info.remote, local)) return null;
    }
  }

  let data;
  try {
    const r = await fetch(API_LATEST, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    data = await r.json();
  } catch (e) {
    console.warn('[update] check failed', e);
    return null;
  }

  const remote = String(data.tag_name || data.name || '')
    .replace(/^v/i, '')
    .trim();
  if (!remote || !isNewer(remote, local)) {
    saveCache({ remote, local, upToDate: true });
    return null;
  }

  const info = {
    local,
    remote,
    notes: String(data.body || '').slice(0, 4000),
    htmlUrl: data.html_url || RELEASES_PAGE,
    assets: pickAssets(data.assets),
    platform: detectPlatform(),
  };
  saveCache(info);
  return info;
}

function ensureModalStyles() {
  if (document.getElementById('riftUpdateStyles')) return;
  const s = document.createElement('style');
  s.id = 'riftUpdateStyles';
  s.textContent = `
#riftUpdate {
  position:fixed; inset:0; z-index:200; display:none; align-items:center; justify-content:center;
  padding:18px; background:radial-gradient(ellipse at center, rgba(6,8,12,.75), rgba(4,6,9,.96));
}
#riftUpdate.on { display:flex; }
#riftUpdate .card {
  width:min(440px, 96vw); background:rgba(10,14,20,.94); border:1px solid rgba(255,255,255,.16);
  border-radius:12px; padding:22px 22px 18px; box-shadow:0 20px 60px rgba(0,0,0,.55);
  animation:riftUpIn .28s ease-out;
}
@keyframes riftUpIn { from { opacity:0; transform:translateY(12px) scale(.97); } }
#riftUpdate h2 {
  font:900 15px var(--mono, ui-monospace, monospace); letter-spacing:.22em; color:var(--acc,#ffc247);
  margin:0 0 10px;
}
#riftUpdate .ver {
  font:800 22px/1.2 var(--mono, ui-monospace, monospace); margin:0 0 8px;
}
#riftUpdate .ver b { color:var(--acc,#ffc247); }
#riftUpdate .note {
  font-size:13px; line-height:1.45; opacity:.82; margin:0 0 14px; white-space:pre-wrap;
  max-height:9em; overflow:auto;
}
#riftUpdate .prog {
  display:none; height:6px; border-radius:3px; background:rgba(255,255,255,.1); overflow:hidden; margin:0 0 14px;
}
#riftUpdate .prog.on { display:block; }
#riftUpdate .prog > i {
  display:block; height:100%; width:0%; background:linear-gradient(90deg,#ffc247,#ff8a2b);
  transition:width .15s linear;
}
#riftUpdate .status {
  font:600 12px var(--mono, ui-monospace, monospace); opacity:.75; min-height:1.2em; margin:0 0 12px;
}
#riftUpdate .btns { display:flex; flex-wrap:wrap; gap:8px; }
#riftUpdate .btns button {
  flex:1; min-width:120px; padding:12px 14px; border-radius:8px; border:1px solid rgba(255,255,255,.2);
  font:800 13px var(--mono, ui-monospace, monospace); letter-spacing:.08em; text-transform:uppercase;
}
#riftUpdate .btns .primary {
  background:linear-gradient(180deg,#ffd470,#f0a51a); color:#1a1205; border-color:#ffc247;
}
#riftUpdate .btns .ghost {
  background:rgba(255,255,255,.06); color:#eef2f7;
}
#riftUpdate .btns button:disabled { opacity:.45; cursor:default; }
#riftOfflineBanner {
  position:fixed; left:50%; top:calc(8px + env(safe-area-inset-top,0px)); transform:translateX(-50%);
  z-index:40; display:none; pointer-events:auto; max-width:min(520px,94vw);
  background:rgba(40,12,8,.88); border:1px solid rgba(255,90,90,.45); border-radius:8px;
  padding:8px 14px; font:700 12px var(--mono, ui-monospace, monospace); letter-spacing:.04em;
  text-align:center; color:#ffc9c9; text-shadow:0 1px 2px #000;
}
#riftOfflineBanner.on { display:block; }
#riftOfflineBanner button {
  margin-left:10px; padding:4px 10px; border-radius:5px; border:1px solid rgba(255,194,71,.5);
  background:rgba(255,194,71,.18); color:#ffc247; font:800 11px var(--mono, ui-monospace, monospace);
  letter-spacing:.06em; text-transform:uppercase; cursor:pointer;
}
`;
  document.head.appendChild(s);
}

function ensureModal() {
  ensureModalStyles();
  let el = document.getElementById('riftUpdate');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'riftUpdate';
  el.innerHTML = `
    <div class="card">
      <h2>UPDATE AVAILABLE</h2>
      <p class="ver">v<span data-local></span> → <b>v<span data-remote></span></b></p>
      <p class="note" data-notes></p>
      <div class="prog" data-prog><i></i></div>
      <p class="status" data-status></p>
      <div class="btns">
        <button type="button" class="primary" data-update>Update</button>
        <button type="button" class="ghost" data-cancel>Play offline</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function ensureOfflineBanner() {
  ensureModalStyles();
  let el = document.getElementById('riftOfflineBanner');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'riftOfflineBanner';
  el.innerHTML = `Offline mode — update required for multiplayer <button type="button" data-upd>Update</button>`;
  document.body.appendChild(el);
  return el;
}

async function downloadToBlob(url, onProgress) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('Download failed (' + r.status + ')');
  const total = parseInt(r.headers.get('content-length') || '0', 10) || 0;
  if (!r.body || !r.body.getReader) {
    const buf = await r.arrayBuffer();
    if (onProgress) onProgress(1);
    return new Blob([buf]);
  }
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    if (onProgress && total) onProgress(Math.min(0.99, got / total));
  }
  if (onProgress) onProgress(1);
  return new Blob(chunks);
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Perform the platform-specific update.
 * @param {object} info from checkForUpdate
 * @param {{onProgress?:(p:number)=>void, onStatus?:(s:string)=>void}} hooks
 */
export async function applyUpdate(info, hooks = {}) {
  const platform = info.platform || detectPlatform();
  const status = (s) => hooks.onStatus && hooks.onStatus(s);
  const prog = (p) => hooks.onProgress && hooks.onProgress(p);

  if (platform === 'electron') {
    const url = info.assets.portable || info.assets.setup;
    if (!url) throw new Error('No Windows build in this release');
    status('Downloading update…');
    // Prefer native Electron path (streams to disk, can relaunch)
    if (window.riftDesktop && window.riftDesktop.downloadUpdate) {
      const kind = info.assets.portable ? 'portable' : 'setup';
      await window.riftDesktop.downloadUpdate({
        url,
        version: info.remote,
        kind,
        onProgress: prog,
      });
      status('Installing…');
      return;
    }
    // Fallback: open in browser
    window.open(url, '_blank');
    return;
  }

  if (platform === 'android') {
    const url = info.assets.apk;
    if (!url) throw new Error('No APK in this release');
    status('Downloading APK…');
    const blob = await downloadToBlob(url, prog);
    status('Preparing installer…');
    // Preferred: native bridge installed by polish-android.sh
    if (typeof window.__riftInstallApk === 'function') {
      const b64 = await blobToBase64(blob);
      const ok = window.__riftInstallApk(b64, `RiftHorizon-${info.remote}.apk`);
      if (!ok) throw new Error('Installer rejected the APK');
      status('System installer opened — confirm to finish');
      return;
    }
    // Capacitor Filesystem + FileOpener style fallback via injected bridge
    if (window.Android && window.Android.installApkBase64) {
      const b64 = await blobToBase64(blob);
      window.Android.installApkBase64(b64, `RiftHorizon-${info.remote}.apk`);
      status('System installer opened — confirm to finish');
      return;
    }
    // Last resort: open download URL (user installs from Downloads)
    status('Opening download…');
    window.open(url, '_blank');
    return;
  }

  // web / ios / unknown
  status('Opening release page…');
  window.open(info.htmlUrl || info.assets.apk || info.assets.portable || RELEASES_PAGE, '_blank');
}

/**
 * Show the update modal. Returns a promise that resolves when the user acts
 * ('updated' | 'offline' | 'dismissed').
 */
export function showUpdateModal(info) {
  const el = ensureModal();
  const localEl = el.querySelector('[data-local]');
  const remoteEl = el.querySelector('[data-remote]');
  const notesEl = el.querySelector('[data-notes]');
  const progEl = el.querySelector('[data-prog]');
  const fill = progEl.querySelector('i');
  const statusEl = el.querySelector('[data-status]');
  const btnUp = el.querySelector('[data-update]');
  const btnCancel = el.querySelector('[data-cancel]');

  localEl.textContent = info.local;
  remoteEl.textContent = info.remote;
  const note = (info.notes || '').replace(/^### Changelog\s*/i, '').trim();
  notesEl.textContent = note
    ? note.slice(0, 600) + (note.length > 600 ? '…' : '')
    : 'A newer build is ready. Multiplayer requires the latest version.';
  statusEl.textContent = '';
  progEl.classList.remove('on');
  fill.style.width = '0%';
  btnUp.disabled = false;
  btnCancel.disabled = false;
  el.classList.add('on');

  return new Promise((resolve) => {
    const done = (r) => {
      btnUp.onclick = btnCancel.onclick = null;
      el.classList.remove('on');
      resolve(r);
    };

    btnCancel.onclick = () => {
      setOfflineLock(info.remote);
      refreshOfflineBanner(info.local, info);
      done('offline');
    };

    btnUp.onclick = async () => {
      btnUp.disabled = true;
      btnCancel.disabled = true;
      progEl.classList.add('on');
      try {
        await applyUpdate(info, {
          onProgress: (p) => {
            fill.style.width = Math.round(p * 100) + '%';
          },
          onStatus: (s) => {
            statusEl.textContent = s;
          },
        });
        // Electron relaunches; Android waits for user to confirm install.
        // Keep modal up with a message on Android.
        if ((info.platform || detectPlatform()) === 'android') {
          statusEl.textContent = 'Confirm the install when prompted, then relaunch the app.';
          btnCancel.disabled = false;
          btnCancel.textContent = 'Close';
          btnCancel.onclick = () => {
            setOfflineLock(info.remote);
            refreshOfflineBanner(info.local, info);
            done('updated');
          };
        } else {
          done('updated');
        }
      } catch (e) {
        statusEl.textContent = (e && e.message) || 'Update failed';
        btnUp.disabled = false;
        btnCancel.disabled = false;
        btnCancel.textContent = 'Play offline';
      }
    };
  });
}

export function refreshOfflineBanner(localVersion, pendingInfo) {
  const el = ensureOfflineBanner();
  if (isWebClient()) {
    setOfflineLock('');
    el.classList.remove('on');
    return false;
  }
  const forced = isForcedOffline(localVersion);
  el.classList.toggle('on', forced);
  const btn = el.querySelector('[data-upd]');
  if (btn) {
    btn.onclick = async () => {
      const info = pendingInfo || (await checkForUpdate({ force: true }));
      if (info) await showUpdateModal(info);
    };
  }
  return forced;
}

/**
 * Boot-time entry: check, prompt, apply offline lock.
 * Call once after the game shell is ready (before or right after Enter lobby).
 * @param {{onLockChange?:(forced:boolean)=>void}} opts
 */
export async function initUpdater(opts = {}) {
  // Web is always up to date — clear any stale lock and never prompt
  if (isWebClient()) {
    setOfflineLock('');
    try {
      const b = document.getElementById('riftOfflineBanner');
      if (b) b.classList.remove('on');
    } catch (_) {}
    return {
      local: 'web',
      forcedOffline: () => false,
      recheck: async () => null,
    };
  }

  const local = await readLocalVersion();
  const until = getOfflineLock();
  if (until && !isNewer(until, local)) setOfflineLock('');

  let info = null;
  try {
    info = await checkForUpdate();
  } catch (_) {}

  if (info) {
    setTimeout(async () => {
      await showUpdateModal(info);
      const forced = refreshOfflineBanner(local, info);
      if (opts.onLockChange) opts.onLockChange(forced);
    }, 600);
  } else {
    const forced = refreshOfflineBanner(local, null);
    if (opts.onLockChange) opts.onLockChange(forced);
  }

  return {
    local,
    forcedOffline: () => isForcedOffline(local),
    recheck: async () => {
      if (isWebClient()) return null;
      const i = await checkForUpdate({ force: true });
      if (i) await showUpdateModal(i);
      const f = refreshOfflineBanner(await readLocalVersion(), i);
      if (opts.onLockChange) opts.onLockChange(f);
      return i;
    },
  };
} {
  // Web / GitHub Pages always serves the live tree — no packaged binary to update.
  // Never prompt or lock offline mode in the browser.
  const platform = detectPlatform();
  if (platform === 'web' || platform === 'ios') {
    return {
      local: 'web',
      forcedOffline: () => false,
      recheck: async () => null,
    };
  }

  const local = await readLocalVersion();
  // clear lock if we already updated past it
  const until = getOfflineLock();
  if (until && !isNewer(until, local)) setOfflineLock('');

  let info = null;
  try {
    info = await checkForUpdate();
  } catch (_) {}

  if (info) {
    // Non-blocking prompt shortly after boot so the start screen is usable
    setTimeout(async () => {
      await showUpdateModal(info);
      const forced = refreshOfflineBanner(local, info);
      if (opts.onLockChange) opts.onLockChange(forced);
    }, 600);
  } else {
    const forced = refreshOfflineBanner(local, null);
    if (opts.onLockChange) opts.onLockChange(forced);
  }

  return {
    local,
    forcedOffline: () => isForcedOffline(local),
    recheck: async () => {
      if (detectPlatform() === 'web' || detectPlatform() === 'ios') return null;
      const i = await checkForUpdate({ force: true });
      if (i) await showUpdateModal(i);
      const f = refreshOfflineBanner(await readLocalVersion(), i);
      if (opts.onLockChange) opts.onLockChange(f);
      return i;
    },
  };
}
