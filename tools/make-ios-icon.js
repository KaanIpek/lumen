/*
 * Flatten the 1024 marketing icon onto an opaque background.
 *
 * App Store Connect rejects a marketing icon that has an alpha channel — not a
 * warning, an upload failure — and every icon this project generated is RGBA
 * because that is what a browser canvas produces. This composites it over the
 * game's own background colour and writes a straight RGB copy.
 *
 *   node tools/make-ios-icon.js
 *
 * Uses the browser-free path: a tiny hand-rolled PNG reader/writer via zlib.
 * No image library, because this project has no dependencies and one icon is
 * not a reason to start.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.resolve(__dirname, '../assets/icon-1024.png');
const OUT = path.resolve(__dirname, '../assets/icon-1024-ios.png');
const BG = [5, 6, 15];            // #05060f — the game's own backdrop

function chunks(buf) {
  const out = [];
  let p = 8;                       // skip the signature
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    out.push({ type, data: buf.slice(p + 8, p + 8 + len) });
    p += 12 + len;                 // len + type + data + crc
  }
  return out;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// undo the per-scanline filter PNG applies before compressing
function unfilter(raw, w, h, bpp) {
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return out;
}

const src = fs.readFileSync(SRC);
const cs = chunks(src);
const ihdr = cs.find((c) => c.type === 'IHDR').data;
const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
const depth = ihdr[8], colour = ihdr[9];
if (depth !== 8 || colour !== 6) {
  throw new Error('expected 8-bit RGBA, got depth ' + depth + ' colour type ' + colour);
}

const raw = zlib.inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)));
const px = unfilter(raw, w, h, 4);

// The art was drawn with its OWN rounded corners — a ~202px radius painted in
// the flat backdrop colour. Apple masks the icon itself, so shipping a
// pre-rounded one means it gets rounded twice and the corners read as dark
// wedges against a light App Store page.
//
// So fill the painted corners back in: any pixel that is exactly the backdrop
// takes the colour of the first real pixel on the ray toward the centre. Those
// regions are almost flat dark, so the join is invisible, and the result is a
// full-bleed square for Apple to mask however it likes this year.
const isBackdrop = (x, y) => {
  const i = (y * w + x) * 4;
  return px[i] === BG[0] && px[i + 1] === BG[1] && px[i + 2] === BG[2];
};
const cx = (w - 1) / 2, cy = (h - 1) / 2;
const fill = (x, y) => {
  const dx = cx - x, dy = cy - y;
  const steps = Math.ceil(Math.hypot(dx, dy));
  for (let s = 1; s <= steps; s++) {
    const sx = Math.round(x + (dx * s) / steps), sy = Math.round(y + (dy * s) / steps);
    if (!isBackdrop(sx, sy)) return (sy * w + sx) * 4;
  }
  return (Math.round(cy) * w + Math.round(cx)) * 4;
};

const rgb = Buffer.alloc(h * (w * 3 + 1));
let o = 0, patched = 0;
for (let y = 0; y < h; y++) {
  rgb[o++] = 0;                                  // filter type 0: none
  for (let x = 0; x < w; x++) {
    let i = (y * w + x) * 4;
    if (isBackdrop(x, y)) { i = fill(x, y); patched++; }
    const a = px[i + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[o++] = Math.round(px[i + c] * a + BG[c] * (1 - a));
  }
}

const newIhdr = Buffer.alloc(13);
newIhdr.writeUInt32BE(w, 0); newIhdr.writeUInt32BE(h, 4);
newIhdr[8] = 8; newIhdr[9] = 2;                  // 8-bit, RGB, no alpha
fs.writeFileSync(OUT, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', newIhdr),
  chunk('IDAT', zlib.deflateSync(rgb, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]));

const written = fs.readFileSync(OUT);
console.log('filled ' + patched + ' painted-corner pixels');
console.log('wrote assets/icon-1024-ios.png — ' + written.readUInt32BE(16) + 'x' + written.readUInt32BE(20)
  + ', colour type ' + written[25] + ' (2 = RGB, no alpha), ' + (written.length / 1024).toFixed(0) + ' kB');
