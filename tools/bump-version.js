#!/usr/bin/env node
/*
 * LUMEN — asset version bump
 * -------------------------------------------------------------
 * Stamps every local css/js/manifest URL in index.html (and the
 * service worker's cache list) with a new ?v= value.
 *
 * Browsers hold onto scripts aggressively — even with no-store —
 * so a release MUST change the URL or returning players can end up
 * running a mix of old and new files. Run this before deploying:
 *
 *     node tools/bump-version.js            # timestamp version
 *     node tools/bump-version.js 1.4.0      # explicit version
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = process.argv[2] || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(2, 14);

function stamp(file, patterns) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  patterns.forEach((re) => {
    s = s.replace(re, (m, pre) => pre + '?v=' + version + m.slice(-1));
  });
  fs.writeFileSync(p, s);
}

// index.html: href="css/x.css?v=..", src="js/x.js?v=..", href="manifest.json?v=.."
stamp('index.html', [
  /(href="css\/[\w.-]+\.css)(?:\?v=[^"]*)?"/g,
  /(src="js\/[\w.-]+\.js)(?:\?v=[^"]*)?"/g,
  /(href="manifest\.json)(?:\?v=[^"]*)?"/g,
]);

// sw.js: './js/x.js?v=..' etc, plus a fresh cache name so old entries are evicted
const swPath = path.join(root, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(/('\.\/(?:js\/[\w.-]+\.js|css\/[\w.-]+\.css|manifest\.json))(?:\?v=[^']*)?'/g,
  (m, pre) => pre + '?v=' + version + "'");
sw = sw.replace(/const CACHE = '[^']+';/, "const CACHE = 'lumen-" + version + "';");
fs.writeFileSync(swPath, sw);

console.log('LUMEN assets stamped with v=' + version);
