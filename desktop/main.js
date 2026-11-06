/**
 * Rift Horizon — desktop shell (Electron).
 * Loads the same static web build used by Pages.
 */
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;
const gameRoot = isDev
  ? path.join(__dirname, '..')
  : path.join(process.resourcesPath, 'game');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#0a0c10',
    title: 'Rift Horizon',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(gameRoot, 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Game',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
