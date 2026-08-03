/*
 * The launch image: 2732x2732 of the game's own backdrop, and nothing else.
 *
 *   node tools/make-splash.js
 *
 * WHY IT IS BLANK ON PURPOSE
 *   `npx cap add ios` ships a placeholder splash, and nothing in this project
 *   ever replaced it — so the app opened on a stale picture that had no relation
 *   to the icon on the home screen. The first frame a player sees should not be
 *   a second, worse logo.
 *
 *   A flat #05060f is the same colour as the menu that follows it, so the launch
 *   reads as the app appearing rather than as two screens fighting. It also
 *   cannot go stale: there is nothing in it to update.
 *
 *   2732 square is the size Capacitor's storyboard expects; it is aspect-filled,
 *   so one square covers every device and orientation.
 *
 * Written with zlib and a hand-rolled PNG chunk writer, like
 * tools/make-ios-icon.js — this project has no dependencies and a solid colour
 * is not a reason to start.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 2732;
const RGB = [0x05, 0x06, 0x0f];                 // --bg, the menu's own colour
const OUT = path.resolve(__dirname, '../assets/splash-2732.png');

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

// One scanline, repeated: filter byte 0 then S pixels of the same colour.
const row = Buffer.alloc(1 + S * 3);
for (let x = 0; x < S; x++) {
  row[1 + x * 3] = RGB[0]; row[2 + x * 3] = RGB[1]; row[3 + x * 3] = RGB[2];
}
const raw = Buffer.concat(Array.from({ length: S }, () => row));

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 2;                        // 8-bit, RGB, no alpha

fs.writeFileSync(OUT, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]));

const w = fs.readFileSync(OUT);
console.log('wrote assets/splash-2732.png — ' + w.readUInt32BE(16) + 'x' + w.readUInt32BE(20)
  + ', ' + (w.length / 1024).toFixed(1) + ' kB');
