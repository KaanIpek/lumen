/*
 * A tiny sink that writes posted PNGs to disk.
 *
 * The browser can render the game at any size and hand back a data URL, but it
 * cannot save a file. This receives them.
 *
 *   node tools/shotsink.js [outDir] [port]
 *
 * Accepts PNG stills and WEBM recordings (see the name check below).
 *
 * Deliberately localhost-only and deliberately dumb: it accepts a filename and
 * a data URL, refuses anything that would escape the output directory, and does
 * nothing else. It is a development tool and never ships.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.argv[2] || 'assets/store');
const PORT = parseInt(process.argv[3] || '5180', 10);

fs.mkdirSync(OUT, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end('post only'); }

  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 40 * 1024 * 1024) { req.destroy(); }
  });
  req.on('end', () => {
    let msg;
    try { msg = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('bad json'); }
    // A filename from the page must never be able to write outside OUT.
    const name = path.basename(String(msg.name || 'shot.png'));
    // .webm too: an App Preview is recorded in the page with MediaRecorder off
    // canvas.captureStream and posted here as one file. Sending 600 PNG frames
    // over 600 round trips is the alternative, and it is neither fast nor robust.
    if (!/^[\w.-]+\.(png|webm)$/.test(name)) { res.writeHead(400); return res.end('bad name'); }
    const m = /^data:(?:image\/png|video\/webm[^;]*);base64,(.+)$/.exec(String(msg.data || ''));
    if (!m) { res.writeHead(400); return res.end('not a png or webm data url'); }
    const buf = Buffer.from(m[1], 'base64');
    fs.writeFileSync(path.join(OUT, name), buf);
    // eslint-disable-next-line no-console
    console.log('wrote ' + name + '  ' + (buf.length / 1024).toFixed(0) + ' kB');
    res.writeHead(200); res.end('ok');
  });
}).listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log('shot sink on http://127.0.0.1:' + PORT + ' -> ' + OUT);
});
