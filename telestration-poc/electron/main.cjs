// Electron main process. Wraps the existing Vite/React web app in a desktop
// shell so a non-developer can run it by double-clicking — no Node/npm/server.
// Dev (ELECTRON_DEV=1): load the Vite dev server (HMR). Packaged/preview: serve
// the built dist/ via an internal loopback http server (static-server.cjs) so
// the app's absolute paths & fetch() work unchanged.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { startServer } = require('./static-server.cjs');

const isDev = process.env.ELECTRON_DEV === '1';
const DEV_URL = 'http://localhost:5173';
const DIST = path.join(__dirname, '..', 'dist');

let serverRef = null;

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // external links → OS browser, never a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  win.webContents.on('did-finish-load', () => console.log('[main] loaded', win.webContents.getURL()));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[main] load failed', code, desc, url));

  if (isDev) {
    await win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const { server, port } = await startServer(DIST);
    serverRef = server;
    await win.loadURL(`http://127.0.0.1:${port}/`);
  }
}

app.whenReady().then(createWindow);

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => {
  if (serverRef) { try { serverRef.close(); } catch { /* ignore */ } }
  if (process.platform !== 'darwin') app.quit();
});
