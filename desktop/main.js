/**
 * Rift Horizon — desktop shell (Electron).
 * Loads the static web build (offline Three via ./vendor when packaged).
 * Also handles auto-update download + portable replace / setup launch.
 */
const { app, BrowserWindow, shell, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
const gameRoot = isDev
  ? path.join(__dirname, '..')
  : path.join(process.resourcesPath, 'game');

function readVersion() {
  try {
    const v = fs.readFileSync(path.join(gameRoot, 'version.txt'), 'utf8').trim();
    if (v) return v;
  } catch (_) {}
  try {
    return require('./package.json').version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

const APP_VERSION = readVersion();

/** Remember window bounds */
function boundsPath() {
  return path.join(app.getPath('userData'), 'window-bounds.json');
}
function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsPath(), 'utf8'));
  } catch (_) {
    return null;
  }
}
function saveBounds(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    fs.writeFileSync(boundsPath(), JSON.stringify({ ...b, isMaximized: win.isMaximized() }));
  } catch (_) {}
}

function createWindow() {
  const prev = loadBounds();
  const win = new BrowserWindow({
    width: (prev && prev.width) || 1280,
    height: (prev && prev.height) || 720,
    x: prev && typeof prev.x === 'number' ? prev.x : undefined,
    y: prev && typeof prev.y === 'number' ? prev.y : undefined,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#0a0c10',
    title: `Rift Horizon ${APP_VERSION}`,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.setMenu(null);

  if (prev && prev.isMaximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(gameRoot, 'index.html'));

  win.on('close', () => saveBounds(win));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  return win;
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { file.close(); } catch (_) {}
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    };
    const get = (u, redirects) => {
      if (redirects > 8) return fail(new Error('Too many redirects'));
      const lib = u.startsWith('https') ? https : http;
      const req = lib.get(u, { headers: { 'User-Agent': 'RiftHorizon-Updater' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error('HTTP ' + res.statusCode));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
        let got = 0;
        res.on('data', (chunk) => {
          got += chunk.length;
          if (onProgress && total) onProgress(Math.min(0.99, got / total));
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            if (settled) return;
            settled = true;
            if (onProgress) onProgress(1);
            resolve(dest);
          });
        });
      });
      req.on('error', fail);
    };
    get(url, 0);
  });
}

function schedulePortableReplace(downloadedPath) {
  const exePath = process.execPath;
  const bat = path.join(app.getPath('temp'), `rift-update-${Date.now()}.cmd`);
  const lines = [
    '@echo off',
    'setlocal',
    `set "SRC=${downloadedPath}"`,
    `set "DST=${exePath}"`,
    'echo Waiting for Rift Horizon to exit...',
    ':wait',
    'timeout /t 1 /nobreak >nul',
    `tasklist /FI "PID eq ${process.pid}" | find "${process.pid}" >nul`,
    'if not errorlevel 1 goto wait',
    'timeout /t 1 /nobreak >nul',
    'copy /Y "%SRC%" "%DST%" >nul',
    'if errorlevel 1 (',
    '  echo Copy failed — leaving downloaded file at %SRC%',
    '  start "" "%SRC%"',
    ') else (',
    '  del "%SRC%" >nul 2>&1',
    '  start "" "%DST%"',
    ')',
    'del "%~f0" >nul 2>&1',
  ];
  fs.writeFileSync(bat, lines.join('\r\n'), 'utf8');
  spawn('cmd.exe', ['/c', bat], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

ipcMain.handle('rift:get-version', () => APP_VERSION);

ipcMain.handle('rift:download-update', async (event, opts) => {
  const url = opts && opts.url;
  if (!url || typeof url !== 'string') throw new Error('Missing download URL');
  const kind = (opts && opts.kind) || 'portable';
  const version = (opts && opts.version) || 'update';
  const dest = path.join(
    app.getPath('temp'),
    kind === 'setup'
      ? `RiftHorizon-${version}-setup.exe`
      : `RiftHorizon-${version}-portable.exe`
  );

  const sendProg = (p) => {
    try {
      if (!event.sender.isDestroyed()) event.sender.send('rift:update-progress', p);
    } catch (_) {}
  };

  await downloadFile(url, dest, sendProg);

  if (kind === 'setup') {
    shell.openPath(dest);
    setTimeout(() => app.quit(), 800);
    return { ok: true, kind: 'setup', path: dest };
  }

  schedulePortableReplace(dest);
  setTimeout(() => app.quit(), 600);
  return { ok: true, kind: 'portable', path: dest };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
