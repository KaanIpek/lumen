/*
 * LUMEN — assemble the web build.
 *
 * There is no bundler and there never will be: the game IS the source. This
 * only copies the files a player actually needs into `dist/`, so uploading is
 * "drag this folder" rather than "remember which nine directories are not for
 * production".
 *
 *   node tools/bump-version.js && node tools/build-web.js
 *
 * Left out on purpose: tests/, tools/, docs/, server/, desktop/, mobile/,
 * landing/ (that is a separate site) and anything dot-prefixed.
 *
 * Also left out: the store-submission artwork under assets/. It lives in the
 * repository because App Store Connect and Play Console need it, but no browser
 * ever requests it, and it is FIVE TIMES the size of the entire game. Shipping
 * it would mean every deploy pushed 25 MB of screenshots that exist to be looked
 * at by one reviewer.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

// Everything else in the root is developer-facing.
// NOTICE ships because the music licence requires the attribution to travel
// "as a part of such copies" — a deployed site is a copy.
// release.json ships too: it is what an INSTALLED app fetches to find out that
// a newer build exists. Pages serves it from the deploy root, so the check has
// no server behind it and no key -- the same push that publishes the web build
// publishes the answer the phones ask for.
const FILES = ['index.html', 'privacy.html', 'delete-account.html', 'support.html', 'manifest.json', 'sw.js', 'config.js', 'NOTICE', 'release.json'];
const DIRS = ['js', 'css', 'assets'];

// Store-submission material: in the repo, never in the build. Matched against
// the path relative to ROOT, with forward slashes on every platform.
const SKIP = [
  /^assets\/store\//,          // 1290x2796 and 1242x2208 App Store screenshots
  /^assets\/icon-1024/,        // the marketing icons, incl. the flattened iOS one
];

function rm(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let n = 0, bytes = 0, skipped = 0, skippedBytes = 0;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    const rel = path.relative(ROOT, a).split(path.sep).join('/') + (e.isDirectory() ? '/' : '');
    if (SKIP.some((re) => re.test(rel))) {
      const s = fs.statSync(a);
      skipped++; skippedBytes += s.isDirectory() ? dirBytes(a) : s.size;
      continue;
    }
    if (e.isDirectory()) {
      const r = copyDir(a, b);
      n += r.n; bytes += r.bytes; skipped += r.skipped; skippedBytes += r.skippedBytes;
    } else { fs.copyFileSync(a, b); n++; bytes += fs.statSync(a).size; }
  }
  return { n, bytes, skipped, skippedBytes };
}
function dirBytes(p) {
  let t = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    t += e.isDirectory() ? dirBytes(q) : fs.statSync(q).size;
  }
  return t;
}

rm(OUT);
fs.mkdirSync(OUT, { recursive: true });

let files = 0, bytes = 0;
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) {
    // config.js is genuinely optional — without it the board is simply off.
    if (f === 'config.js') { console.log('  (no config.js — the leaderboard will be disabled)'); continue; }
    throw new Error('missing required file: ' + f);
  }
  fs.copyFileSync(src, path.join(OUT, f));
  files++; bytes += fs.statSync(src).size;
}
let skipped = 0, skippedBytes = 0;
for (const d of DIRS) {
  const r = copyDir(path.join(ROOT, d), path.join(OUT, d));
  files += r.n; bytes += r.bytes; skipped += r.skipped; skippedBytes += r.skippedBytes;
}

// The one mistake that silently breaks a returning player: shipping without
// bumping, so the service worker serves a mix of two builds.
const sw = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8');
const stamp = (sw.match(/lumen-(\d+)/) || [])[1];
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
if (!stamp || html.indexOf('v=' + stamp) < 0) {
  throw new Error('index.html and sw.js disagree about the version — run tools/bump-version.js first');
}

// A key that can WRITE anything it likes must never leave this machine.
//
// Scan the VALUES, not the file: config.js documents the danger in a comment
// ("service_role key — it ignores every security policy you wrote"), and a
// naive text search flags that warning as though it were the key itself. A
// guard that cries wolf on its own documentation is a guard people switch off.
if (fs.existsSync(path.join(OUT, 'config.js'))) {
  const cfg = fs.readFileSync(path.join(OUT, 'config.js'), 'utf8');
  const stripped = cfg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const values = [...stripped.matchAll(/['"`]([^'"`\n]{8,})['"`]/g)].map((m) => m[1]);
  const secret = values.find((v) =>
    /^sb_secret_/.test(v)                                   // Supabase secret key
    || /service_role/.test(v)                               // a role name in a real value
    || /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(v)); // a raw JWT
  if (secret) {
    rm(OUT);
    throw new Error('config.js holds what looks like a SECRET key — only the publishable key may ship.');
  }
}

console.log('dist/ built — ' + files + ' files, ' + (bytes / 1024 / 1024).toFixed(2) + ' MB');
if (skipped) {
  console.log('  (left out ' + skipped + ' store-only path(s), '
    + (skippedBytes / 1024 / 1024).toFixed(2) + ' MB — see SKIP in this file)');
}
console.log('version stamp: ' + stamp);
console.log('');
console.log('Upload the CONTENTS of dist/ to any static host.');
console.log('Nothing else is needed: no build step, no server, no env vars.');
