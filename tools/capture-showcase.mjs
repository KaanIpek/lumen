/*
 * LUMEN — showcase capture.
 *
 *   node tools/serve.js 5180                     # game
 *   node tools/shotsink.js work/showcase 5181    # sink
 *   node tools/capture-showcase.mjs [--probe] [--seconds 8]
 *
 * WHY A SEPARATE CHROME
 *   The MCP browser tab is always backgrounded, and a hidden tab never paints:
 *   requestAnimationFrame does not fire and timers are throttled to about one a
 *   second. Nothing that needs the game to ANIMATE can be captured there. So
 *   this spawns its own Chrome with --headless=new, which renders offscreen but
 *   on a real frame clock, and drives it over CDP.
 *
 * WHY THE FOOTAGE IS HONEST
 *   The runs are played by the game's own attract autopilot — the same one
 *   behind the main menu. Its author's note: "It plays well but not perfectly,
 *   which reads as a person rather than a machine." It aims at gap centres and
 *   detours for a mote, so the flying has the hesitation a person has; it is not
 *   a machine hammering the button.
 *
 *   Cheats are used for exactly ONE thing: unlockAll(), so every world and skin
 *   can be shown. That does NOT taint the footage — start() recomputes
 *   `cheated` from god mode alone (game.js:2794), and god mode is never turned
 *   on, so no run carries the "DEV RUN — NOT COUNTED" badge and every score on
 *   screen is one the autopilot actually earned.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const GAME = process.env.GAME_URL || 'http://localhost:5180/';
const SINK = process.env.SINK_URL || 'http://127.0.0.1:5181/';
const PORT = 9444;
const W = Number(process.env.CAP_W || 1080);
const H = Number(process.env.CAP_H || 1920);

const argv = process.argv.slice(2);
const PROBE = argv.includes('--probe');
const SECONDS = Number((argv[argv.indexOf('--seconds') + 1] || 8));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = path.join(os.tmpdir(), 'lumen-capture-profile');
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-features=Translate,MediaRouter',
  '--autoplay-policy=no-user-gesture-required',
  '--hide-scrollbars',
  `--window-size=${W},${H}`,
  'about:blank',
], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const tabs = await r.json();
        const page = tabs.find((t) => t.type === 'page');
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome debugger never came up');
}

const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}

/** Evaluate in the page and return the value, or throw the page's error. */
async function evaluate(expr) {
  const r = await cdp('Runtime.evaluate', {
    expression: `(async () => { ${expr} })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.result?.exceptionDetails) {
    throw new Error('page: ' + (r.result.exceptionDetails.exception?.description
      || r.result.exceptionDetails.text));
  }
  return r.result?.result?.value;
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 1, mobile: true,
  screenOrientation: { type: 'portraitPrimary', angle: 0 },
});

const loaded = new Promise((res) => {
  ws.addEventListener('message', function onMsg(ev) {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.loadEventFired') { ws.removeEventListener('message', onMsg); res(); }
  });
});
await cdp('Page.navigate', { url: GAME });
await loaded;
await sleep(3500);

// ---- does this Chrome actually paint? -------------------------------------
// Measured, never assumed: a hidden tab reports 0 here and every later step
// would silently record a frozen frame.
const raf = await evaluate(`
  let n = 0; const t0 = performance.now();
  await new Promise(done => {
    const tick = () => { n++; (performance.now() - t0 < 1000) ? requestAnimationFrame(tick) : done(); };
    requestAnimationFrame(tick);
  });
  return { fps: n, ms: Math.round(performance.now() - t0) };
`);
console.log(`rAF: ${raf.fps} frames in ${raf.ms}ms`);
if (raf.fps < 20) {
  console.error('This Chrome is not painting — MediaRecorder would capture a still frame. Aborting.');
  ws.close(); chrome.kill(); process.exit(1);
}

const info = await evaluate(`
  const L = window.LUMEN;
  if (!L || !L.game) return { ready: false };
  return {
    ready: true,
    devOrigin: !!(L.Cheats && L.Cheats.available),
    modes: (L.Modes ? L.Modes.MODES.map(m => m.id) : []),
    maps: (L.Cosmetics && L.Cosmetics.MAPS ? L.Cosmetics.MAPS.map(m => m.id) : []),
    skins: (L.Cosmetics && L.Cosmetics.SKINS ? L.Cosmetics.SKINS.map(m => m.id) : []),
    canvas: (() => { const c = document.querySelector('canvas'); return c ? [c.width, c.height] : null; })(),
  };
`);
console.log('game:', JSON.stringify({ ...info, maps: info.maps?.length, skins: info.skins?.length, modes: info.modes?.length }));
if (!info.ready) { console.error('LUMEN did not boot'); ws.close(); chrome.kill(); process.exit(1); }
if (!info.devOrigin) { console.error('cheats unavailable on this origin — cosmetics cannot be shown'); }

if (PROBE) {
  console.log('modes:', info.modes.join(' '));
  console.log('maps :', info.maps.join(' '));
  console.log('skins:', info.skins.slice(0, 12).join(' '), '…');
  ws.close(); chrome.kill(); process.exit(0);
}

// ---- own every cosmetic, WITHOUT god mode ---------------------------------
await evaluate(`
  const L = window.LUMEN;
  if (L.Cheats && L.Cheats.available) { L.Cheats.unlockAll(); L.Cheats.god = false; }
  L.game.cheated = false;
  return true;
`);

/*
 * STAGGER: why every captured run forces jump/jumpMin.
 *
 * The first cut of the modes Short measured 2.02/255 of inter-frame change
 * against 9.97 for the Shelves Short. The gates scrolled, but the ball - the
 * thing the eye actually tracks - flew a nearly flat line, and a showcase where
 * the player barely moves reads as fake.
 *
 * The cause is the course, not the autopilot. Gate centres are a random walk,
 * _c = lastC + rr(-maxJump, maxJump), and a walk with a symmetric step stays
 * near where it started; pad then clamps the outliers back toward the middle.
 * game.js:4218 says it outright: "what actually staggers the corridor is a
 * floor under the distance, not a bigger ceiling over it."
 *
 * jumpMin is that floor, and it is the game's own parameter rather than a hack:
 * HOLD ships with jump 1.55 / jumpMin 0.40 (modes.js:251). Copying HOLD's PAIR
 * is the part that matters. jumpMin on its own would become the new worst-case
 * reach; with jump 1.55 the ceiling (~0.55 playH at these run lengths) stays
 * above the floor, so the corridor is threadable under the same guarantee HOLD
 * already ships under.
 *
 * It is written onto the live mode object inside the throwaway headless
 * profile. Nothing is persisted and js/modes.js is untouched, so the attract
 * wallpaper real players see is exactly as it was.
 */
/** One showcase run: pick mode + world + skin, let the autopilot fly, record. */
async function segment({ name, mode, map, skin, equip = [], seconds = SECONDS }) {
  const setup = await evaluate(`
    const L = window.LUMEN, g = L.game;
    if (g.attract) g.stopAttract();
    ${mode ? `L.Modes.setCurrent(${JSON.stringify(mode)});` : ''}
    ${map ? `L.Cosmetics.equip(${JSON.stringify(map)});` : ''}
    ${skin ? `L.Cosmetics.equip(${JSON.stringify(skin)});` : ''}
    // A theme pack is four slots. equip() routes each id to its own category,
    // so a whole look goes on by listing the set's items.
    ${JSON.stringify(equip)}.forEach((id) => L.Cosmetics.equip(id));
    g.state = 'menu' in g ? g.state : g.state;
    g.startAttract();
    // The seasonal preview overrides the equipped world in attract mode, which
    // would quietly show the wrong map for every segment.
    if (L.Cosmetics) { L.Cosmetics.setPreview(null); g.resolveMode(); g.bg.resize(g.viewW, g.H); }
    // Capture-only corridor stagger — see STAGGER note above segment().
    if (g.mode) {
      g.mode.jump = Math.max(g.mode.jump || 1, 1.55);
      g.mode.jumpMin = Math.max(g.mode.jumpMin || 0, 0.40);
    }
    return { mode: g.mode && g.mode.id, map: L.Store.map, skin: L.Store.skin,
             trail: L.Store.trail, signature: L.Store.signature,
             jump: g.mode && g.mode.jump, jumpMin: g.mode && g.mode.jumpMin,
             attract: g.attract, cheated: g.cheated };
  `);
  if (!setup.attract) throw new Error(name + ': attract did not start');
  if (setup.cheated) throw new Error(name + ': run is flagged cheated — footage would carry the DEV badge');
  if (mode && setup.mode !== mode) throw new Error(`${name}: mode is ${setup.mode}, wanted ${mode}`);
  if (!(setup.jumpMin >= 0.40)) throw new Error(`${name}: jumpMin is ${setup.jumpMin} — the stagger knob did not take`);
  if (map && setup.map !== map) throw new Error(`${name}: map is ${setup.map}, wanted ${map}`);

  await sleep(900);   // let the world settle before the recorder opens

  await evaluate(`
    const c = document.querySelector('canvas');
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 9000000 });
    window.__chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) window.__chunks.push(e.data); };
    window.__rec = rec; rec.start();
    return true;
  `);
  await sleep(seconds * 1000);
  const stats = await evaluate(`
    const g = window.LUMEN.game;
    await new Promise(done => { window.__rec.onstop = done; window.__rec.stop(); });
    const blob = new Blob(window.__chunks, { type: 'video/webm' });
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    const resp = await fetch(${JSON.stringify(SINK)}, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ${JSON.stringify(name)} + '.webm', data: dataUrl }),
    });
    return { bytes: blob.size, saved: resp.ok, score: g.score, flips: g.__flips | 0, cheated: g.cheated };
  `);
  if (!stats.saved) throw new Error(name + ': sink refused the clip');
  console.log(`  ${name.padEnd(22)} ${(stats.bytes / 1048576).toFixed(2)} MB  score ${stats.score}`
    + `  ${setup.skin}/${setup.trail}/${setup.map}/${setup.signature}  cheated=${stats.cheated}`);
  return stats;
}

// Modes first (each on its own world so the segments do not look alike), then
// worlds, then skins. Ids are resolved against what the build actually has.
const has = (list, id) => list.includes(id) ? id : null;
const MODE_SEGS = [
  ['classic', 'deepfield'], ['vortex', 'emberfall'], ['mirror', 'monolith'],
  ['blackout', 'pitch'], ['precision', 'hoarfrost'], ['zen', 'bloomward'],
].filter(([m]) => info.modes.includes(m))
  .map(([m, w]) => ({ name: 'mode-' + m, mode: m, map: has(info.maps, w) || info.maps[0] }));

const WORLD_SEGS = ['solaris', 'tidal', 'lanternmoon', 'eventhorizon']
  .filter((w) => info.maps.includes(w))
  .map((w) => ({ name: 'world-' + w, mode: 'classic', map: w }));

const SKIN_SEGS = info.skins.slice(0, 3).map((s, i) => ({
  name: 'skin-' + s, mode: 'classic', map: info.maps[(i * 5) % info.maps.length], skin: s,
}));

// SEGS lets a second pass target specific cosmetics without re-shooting the
// whole plan: SEGS='[{"name":"skin-sakura","skin":"sakura","map":"bloomward"}]'
const plan = process.env.SEGS
  ? JSON.parse(process.env.SEGS).map((s) => ({ mode: 'classic', ...s }))
  : [...MODE_SEGS, ...WORLD_SEGS, ...SKIN_SEGS];
console.log(`\n${plan.length} segment × ${SECONDS}s\n`);
const done = [];
for (const seg of plan) {
  try { done.push({ ...seg, ...(await segment(seg)) }); }
  catch (e) { console.error('  ! ' + e.message); }
}
console.log(`\n${done.length}/${plan.length} captured`);
ws.close();
chrome.kill();
