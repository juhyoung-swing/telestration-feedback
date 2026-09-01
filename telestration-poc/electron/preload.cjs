// Preload (contextIsolation on). Exposes a tiny, typed bridge for local ML so the
// renderer can trigger analysis without any Node access. Present only under
// Electron — the web/dev build must feature-detect `window.ml`.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ml', {
  // Analyze a video file path → { fragments, players, stats }.
  analyze: (videoPath, options) => ipcRenderer.invoke('ml:analyze', { videoPath, options }),
  // Subscribe to 0..1 progress; returns an unsubscribe fn.
  onProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('ml:analyze:progress', listener);
    return () => ipcRenderer.removeListener('ml:analyze:progress', listener);
  },
});
