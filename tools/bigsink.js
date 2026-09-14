/*
 * Receives a large binary in base64 chunks and writes it to disk.
 *
 *   node tools/bigsink.js [outDir] [port]
 *
 * WHY
 *   shotsink takes one data URL per file, which is fine for a screenshot and
 *   hopeless for a 50 MB video: the browser can hold the bytes but a single
 *   JSON body that size is a bad idea on both ends. This appends instead, so the
 *   page can hand the file over in slices.
 *
 * POST {name, seq, data, done}
 *   seq 0 truncates, later seqs append, done:true closes and reports the size.
 * Localhost-only, refuses any name that could escape outDir, never ships.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const OUT = path.resolve(process.argv[2] || 'work/rec');
const PORT = parseInt(process.argv[3] || '5182', 10);
fs.mkdirSync(OUT, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end('post only'); }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 64e6) { res.writeHead(413); req.destroy(); } });
  req.on('end', () => {
    let m; try { m = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('bad json'); }
    const name = String(m.name || '');
    if (!/^[\w.-]+\.(mp4|mov|m4v|webm|png|jpg)$/i.test(name)) { res.writeHead(400); return res.end('bad name'); }
    const p = path.join(OUT, name);
    try {
      const buf = Buffer.from(String(m.data || ''), 'base64');
      if (Number(m.seq) === 0) fs.writeFileSync(p, buf); else fs.appendFileSync(p, buf);
      const size = fs.statSync(p).size;
      if (m.done) console.log(name + ' -> ' + (size / 1048576).toFixed(1) + ' MB');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, size }));
    } catch (e) { res.writeHead(500); res.end(String(e.message)); }
  });
}).listen(PORT, '127.0.0.1', () => console.log('bigsink ' + OUT + ' :' + PORT));
