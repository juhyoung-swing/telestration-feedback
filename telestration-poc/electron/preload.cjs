// Preload (contextIsolation on). Exposes a tiny, typed bridge for local ML so the
// renderer can trigger analysis without any Node access. Present only under
// Electron — the web/dev build must feature-detect `window.ml`.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ml', {
  // Analyze a video (ArrayBuffer of the file) → { fragments, players, stats }.
  analyze: (video, options) => ipcRenderer.invoke('ml:analyze', { video, options }),
  // Subscribe to 0..1 progress; returns an unsubscribe fn.
  onProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('ml:analyze:progress', listener);
    return () => ipcRenderer.removeListener('ml:analyze:progress', listener);
  },
});

// Export bridge: save a screenshot (PNG bytes) or transcode a recorded WebM → MP4 via the
// bundled ffmpeg, each behind a native Save dialog. Returns the saved path, or null if cancelled.
contextBridge.exposeInMainWorld('exportApi', {
  savePng: (buf, suggestedName) => ipcRenderer.invoke('export:save-png', { buf, suggestedName }),
  saveMp4: (webm, suggestedName) => ipcRenderer.invoke('export:save-mp4', { webm, suggestedName }),
});
