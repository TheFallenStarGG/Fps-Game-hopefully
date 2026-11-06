/**
 * Rift Horizon — desktop shell (Electron).
 * Loads the static web build (offline Three via ./vendor when packaged).
 */
const { app, BrowserWindow, shell, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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
    },
  });

  // No application menu (cleaner game window)
  win.setMenu(null);

  if (prev && prev.isMaximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(gameRoot, 'index.html'));

  win.on('close', () => saveBounds(win));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // F11 / Alt+Enter fullscreen
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
