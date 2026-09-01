// Minimal zero-dependency static server for the PACKAGED app. It serves the
// built `dist/` over http://127.0.0.1:<port> so the renderer keeps normal web
// semantics — absolute `/court.mp4` & `/players.json` paths, fetch(), a real
// origin, IndexedDB — exactly like the dev/web build, instead of brittle
// `file://` loading. This is "method A": no app code changes needed.
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json',
};

function serveWhole(file, type, res) {
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type }); res.end(data);
  });
}

// Serve `distDir` on a random loopback port. Resolves to { server, port }.
function startServer(distDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch { res.writeHead(400); res.end(); return; }
      if (pathname === '/') pathname = '/index.html';

      const filePath = path.join(distDir, pathname);
      // block path traversal outside distDir
      if (filePath !== distDir && !filePath.startsWith(distDir + path.sep)) {
        res.writeHead(403); res.end(); return;
      }

      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
          serveWhole(path.join(distDir, 'index.html'), 'text/html', res); // SPA fallback
          return;
        }
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        const range = req.headers.range;
        if (range) {
          const m = /bytes=(\d+)-(\d*)/.exec(range); // media seeking → HTTP Range
          if (m) {
            const start = parseInt(m[1], 10);
            const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
            res.writeHead(206, {
              'Content-Type': type,
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': end - start + 1,
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
            return;
          }
        }
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(filePath).pipe(res);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

module.exports = { startServer };
