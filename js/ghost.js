/*
 * LUMEN — the ghost you race
 * -------------------------------------------------------------
 * You play today's daily, send a friend a link, and they run the same course
 * with your orb replayed beside them.
 *
 * WHY THE GHOST TRAVELS INSIDE THE LINK
 *   Because there is nowhere else to put it. The leaderboard table has held five
 *   rows in the game's entire life, and the next-update poll has zero votes:
 *   anything that needs other players to already be present does nothing on the
 *   day it ships. A link needs no server, no account and no database, and it
 *   works the moment two people have each other's phone number.
 *
 * WHY POSITIONS AND NOT INPUTS
 *   Recording taps would be a quarter of the size and it is the wrong answer
 *   twice. The physics is semi-implicit Euler over a VARIABLE step —
 *   `p.vy += a*gdt` then `p.y += p.vy*gdt` — so the same taps replayed at a
 *   different frame rate land somewhere else; measured, a 60fps recording
 *   replayed at 30fps gains about 2% of the playfield per crossing, which is
 *   the difference between threading a gap and dying in it. And `gdt` is not
 *   even dt: it is dt scaled by `timeScale`, itself an exponential smoother
 *   over frame-sized steps. On top of that, any future tweak to gravity would
 *   silently invalidate every ghost ever shared. Sampled positions are
 *   drift-free, frame-rate-proof and version-proof.
 *
 * WHY A FRACTION OF THE PLAYFIELD AND NOT A PIXEL
 *   playTop includes the measured safe-area inset and playH comes from the
 *   window, so a pixel means something different on a notched phone and a
 *   desktop — and both can change MID-RUN when iOS collapses its URL bar or the
 *   perf watchdog re-tiers quality. The engine already stores the whole daily
 *   course this way, and resize() re-anchors the player by the same fraction.
 *
 * WHY `elapsed` AND NOT THE WALL CLOCK
 *   The corridor is a function of `elapsed`, which accumulates SCALED time and
 *   is clamped to 1/30s a frame with no catch-up. Two players at the same
 *   `elapsed` are at the same place in the course; two players at the same
 *   wall-clock second are not, and a stuttering device never makes up the
 *   difference.
 *
 * WHAT IT MAY NEVER DO
 *   Consume a seeded draw. The ghost is drawn, never simulated into the world:
 *   no collision, no motes, no effect on anything. If it ever touched
 *   `this.rng` it would move the course out from under one of the two players,
 *   which is the one bug this whole feature cannot survive.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  // ---- the shape of a recording --------------------------------------------
  //
  // The link must be a link, so the payload has a CEILING rather than a length.
  // A long run is sampled coarsely; it is never allowed to grow the URL.
  const HZ = 10;                 // samples per second at divisor 1
  const MAX_SAMPLES = 700;       // the hard ceiling — see the arithmetic below
  const MAX_NAME = 12;           // bytes of the sender's name that travel
  const EPOCH = Date.UTC(2026, 0, 1) / 86400000;   // day 0, so a date is 2 bytes
  const VERSION = 1;

  // 700 samples at one byte each, plus a header of 8 + name, is ~720 bytes.
  // base64 is ceil(n/3)*4, so that is ~960 characters, and with the 33-character
  // share base and '?g=' the whole URL is about 995 — comfortably inside the
  // ~2000 that survives a messaging app. At divisor 1 that buys 70 seconds; the
  // divisor doubles the span each time it climbs, so 4 covers nearly five
  // minutes at 2.5Hz, which is coarse but the ghost is interpolated anyway.

  // base64url, and it is NOT optional.
  //
  // URLSearchParams.get() decodes '+' as a SPACE, because a query string is
  // form-encoded. Standard base64 emits '+' for roughly one byte in 42 of random
  // data, so a plain-alphabet payload would be silently corrupted in almost
  // every ghost — and corrupted in a way that still decodes to plausible
  // numbers. Padding is dropped too: it survives link-unfurlers less reliably
  // and carries no information.
  //
  // Deliberately NOT js/save.js's b64encode. That one is
  // `btoa(unescape(encodeURIComponent(s)))`, which UTF-8-expands every code unit
  // >= 0x80 — binary bytes would inflate about 1.5x BEFORE base64 and blow the
  // budget for no reason. It is right for its own job, which is JSON text.
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function toB64url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      const n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
      if (b === undefined) break;
      out += B64[(n >> 6) & 63];
      if (c === undefined) break;
      out += B64[n & 63];
    }
    return out;
  }
  function fromB64url(str) {
    const s = String(str || '');
    const lut = {};
    for (let i = 0; i < 64; i++) lut[B64[i]] = i;
    const out = [];
    let acc = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
      const v = lut[s[i]];
      if (v === undefined) return null;          // one bad character, no ghost
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    }
    return out;
  }

  // The same FNV-1a the save code uses, over the bytes. Not security — it is
  // what makes a link truncated by a chat app fail loudly instead of replaying
  // a ghost made of noise.
  function sum(bytes) {
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dayNum = (dateStr) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return -1;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 - EPOCH);
  };
  const dayStr = (n) => {
    const d = new Date((n + EPOCH) * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
      + '-' + String(d.getUTCDate()).padStart(2, '0');
  };

  const Ghost = {
    HZ, MAX_SAMPLES, VERSION,

    // ---- recording ---------------------------------------------------------
    // A live buffer on the game, filled from update(). Deliberately not a
    // closure: the game owns its run state, and reset() has to be able to drop
    // this the same way it drops every other thing a run owns.
    start(game) {
      game._ghostRec = { at: 0, div: 1, ys: [] };
    },

    // Called once per frame with the run's OWN clock. Returns nothing and reads
    // nothing seeded.
    sample(game) {
      const r = game && game._ghostRec;
      if (!r) return;
      const step = r.div / HZ;
      if (game.elapsed < r.at) return;
      r.at += step;
      // Playfield fraction, computed fresh every time: playTop and playH can
      // both change mid-run and a cached copy would bend the whole tail of the
      // recording.
      const f = clamp((game.player.y - game.playTop) / (game.playH || 1), 0, 1);
      r.ys.push(Math.round(f * 255));
      // Out of room: halve the rate, keep every other sample, and carry on. The
      // run is never cut short and the link never grows.
      if (r.ys.length >= MAX_SAMPLES) {
        const keep = [];
        for (let i = 0; i < r.ys.length; i += 2) keep.push(r.ys[i]);
        r.ys = keep;
        r.div *= 2;
      }
    },

    // ---- encoding ----------------------------------------------------------
    encode(rec) {
      if (!rec || !rec.ys || !rec.ys.length) return '';
      const d = dayNum(rec.date);
      if (d < 0 || d > 65535) return '';
      const name = String(rec.name || '').slice(0, MAX_NAME);
      const nb = [];
      for (let i = 0; i < name.length; i++) {
        const c = name.charCodeAt(i);
        nb.push(c > 255 ? 63 : c);            // '?' for anything not one byte
      }
      const score = clamp(Math.floor(rec.score || 0), 0, 16777215);
      const head = [
        VERSION,
        (d >> 8) & 255, d & 255,
        (score >> 16) & 255, (score >> 8) & 255, score & 255,
        clamp(rec.div || 1, 1, 255),
        nb.length,
      ].concat(nb);
      const body = head.concat(rec.ys);
      const c = sum(body);
      // checksum last, so a truncated payload cannot pass
      return toB64url(body.concat([(c >> 24) & 255, (c >> 16) & 255, (c >> 8) & 255, c & 255]));
    },

    // Returns null for anything that is not a ghost. NEVER throws: this runs on
    // the boot path with a string a stranger pasted, and a link that takes the
    // game down is worse than a link that does nothing.
    decode(str) {
      try {
        const b = fromB64url(str);
        if (!b || b.length < 13) return null;
        const c = b.slice(-4), body = b.slice(0, -4);
        const want = ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) >>> 0;
        if (sum(body) !== want) return null;
        if (body[0] !== VERSION) return null;
        const d = (body[1] << 8) | body[2];
        const score = (body[3] << 16) | (body[4] << 8) | body[5];
        const div = body[6] || 1;
        const nlen = body[7];
        if (8 + nlen > body.length) return null;
        let name = '';
        for (let i = 0; i < nlen; i++) name += String.fromCharCode(body[8 + i]);
        const ys = body.slice(8 + nlen);
        if (!ys.length) return null;
        return { date: dayStr(d), score, div, name, ys };
      } catch (e) { return null; }
    },

    // ---- replay ------------------------------------------------------------
    // Where the ghost was at this moment of the run, as a playfield fraction,
    // or null once its run has ended. Interpolated, so a coarse recording still
    // moves smoothly.
    at(rec, elapsed) {
      if (!rec || !rec.ys || !rec.ys.length) return null;
      const step = (rec.div || 1) / HZ;
      const t = elapsed / step;
      const i = Math.floor(t);
      if (i < 0) return rec.ys[0] / 255;
      if (i >= rec.ys.length - 1) {
        return i >= rec.ys.length ? null : rec.ys[rec.ys.length - 1] / 255;
      }
      const a = rec.ys[i], b = rec.ys[i + 1];
      return (a + (b - a) * (t - i)) / 255;
    },

    // How long the ghost's run lasted, in the same scaled seconds the game uses.
    duration(rec) {
      if (!rec || !rec.ys || !rec.ys.length) return 0;
      return (rec.ys.length - 1) * ((rec.div || 1) / HZ);
    },
  };

  LUMEN.Ghost = Ghost;
})();
