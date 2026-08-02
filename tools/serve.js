// Minimal no-cache static server for local development.
//
// The service worker caches aggressively (that is its job in production), which
// during development means you edit a file and the browser confidently serves
// you the old one. Everything here goes out with no-store so what you see is
// always what is on disk.
//
//   node tools/serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2]) || 5180;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  // never serve anything outside the project directory
  if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html');
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(buf);
  });
}).listen(port, () => console.log(`LUMEN on http://localhost:${port}`));
