// Electron main process. Wraps the existing Vite/React web app in a desktop
// shell so a non-developer can run it by double-clicking — no Node/npm/server.
// Dev (ELECTRON_DEV=1): load the Vite dev server (HMR). Packaged/preview: serve
// the built dist/ via an internal loopback http server (static-server.cjs) so
// the app's absolute paths & fetch() work unchanged.
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const { startServer } = require('./static-server.cjs');

const isDev = process.env.ELECTRON_DEV === '1';
const DEV_URL = 'http://localhost:5178'; // must match vite.config.ts server.port + the electron:dev wait-on
const DIST = path.join(__dirname, '..', 'dist');

let serverRef = null;

// Bundled binaries/models: in the packaged app onnxruntime-node/ffmpeg live under
// app.asar.unpacked, and require('ffmpeg-static') hands back an in-asar path we must
// remap. The model is shipped via extraResources next to the app.
const unpack = (p) => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace('app.asar/', 'app.asar.unpacked/');
function modelFile(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'models', name)
    : path.join(__dirname, '..', 'resources', 'models', name);
}
function mlPaths() {
  return {
    modelPath: modelFile('yolov8x.onnx'),      // person detection (position analysis)
    posePath: modelFile('yolov8n-pose.onnx'),  // pose/keypoints (form analysis)
    ffmpegPath: unpack(require('ffmpeg-static')),
    ffprobePath: unpack(require('ffprobe-static').path),
  };
}

// Renderer → main: analyze a video (raw bytes) into tracking JSON. Uploaded
// videos live as blobs in the renderer's IndexedDB (no path), so we receive the
// bytes, write a temp file, run the heavy ONNX+ffmpeg work here, then clean up.
// Progress streams back by event.
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
ipcMain.handle('ml:analyze', async (evt, { video, options = {} }) => {
  const { analyzeVideo } = require('./ml/analyze.cjs'); // lazy: only load ORT when used
  const paths = mlPaths();
  const tmp = path.join(os.tmpdir(), `tele-${crypto.randomUUID()}.mp4`);
  await fs.promises.writeFile(tmp, Buffer.from(video));
  try {
    return await analyzeVideo(tmp, {
      ...options, ...paths,
      onProgress: (p) => { if (!evt.sender.isDestroyed()) evt.sender.send('ml:analyze:progress', p); },
    });
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
});

// Renderer → main: pose/form analysis (separate model, separate progress channel
// so it can run independently of position analysis).
ipcMain.handle('ml:analyzePose', async (evt, { video, options = {} }) => {
  const { analyzePoseVideo } = require('./ml/pose.cjs'); // lazy: only load ORT when used
  const paths = mlPaths();
  const tmp = path.join(os.tmpdir(), `tele-pose-${crypto.randomUUID()}.mp4`);
  await fs.promises.writeFile(tmp, Buffer.from(video));
  try {
    return await analyzePoseVideo(tmp, {
      ...options, ...paths,
      onProgress: (p) => { if (!evt.sender.isDestroyed()) evt.sender.send('ml:analyzePose:progress', p); },
    });
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
});

// ── Export: save screenshot / transcode recorded WebM → MP4 ────────────────
const { dialog } = require('electron');
const { execFile } = require('child_process');

ipcMain.handle('export:save-png', async (evt, { buf, suggestedName }) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName || 'telestration.png',
    filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
  });
  if (canceled || !filePath) return null;
  await fs.promises.writeFile(filePath, Buffer.from(buf));
  return filePath;
});

ipcMain.handle('export:save-video', async (evt, { webm, suggestedName, format }) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const isMp4 = format !== 'webm';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName || (isMp4 ? 'telestration.mp4' : 'telestration.webm'),
    filters: isMp4 ? [{ name: 'MP4 영상', extensions: ['mp4'] }] : [{ name: 'WebM 영상', extensions: ['webm'] }],
  });
  if (canceled || !filePath) return null;
  // WebM is what MediaRecorder produced → write it straight through, no transcode.
  if (!isMp4) { await fs.promises.writeFile(filePath, Buffer.from(webm)); return filePath; }
  // MP4 → transcode the recorded WebM with the bundled ffmpeg (H.264 / AAC).
  const tmp = path.join(os.tmpdir(), `tele-export-${crypto.randomUUID()}.webm`);
  await fs.promises.writeFile(tmp, Buffer.from(webm));
  try {
    const ffmpeg = mlPaths().ffmpegPath;
    await new Promise((resolve, reject) => {
      execFile(ffmpeg, [
        '-y', '-i', tmp,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        filePath,
      ], (err, _stdout, stderr) => (err ? reject(new Error(String(stderr || err))) : resolve(null)));
    });
    return filePath;
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
});

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
