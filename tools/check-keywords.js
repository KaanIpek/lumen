/*
 * Check the App Store keyword sets in docs/STORE_LISTING.md.
 *
 *   node tools/check-keywords.js
 *
 * Two ways a keyword field goes wrong, both silent:
 *
 * 1. It repeats a word from that locale's app name or subtitle. Apple indexes
 *    those separately, so the repeat buys nothing and costs characters. The
 *    English set carried `gravity` and `flip` for months — 13 of 100 characters
 *    spent on words already in the app name.
 *
 * 2. It makes a claim the build cannot keep. `no-ads` was in the list once; the
 *    build ships the Google Mobile Ads SDK and plays rewarded video, and Apple
 *    treats a false keyword as metadata to reject.
 *
 * Run this before `node tools/asc-listing.js --apply`.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DOC = path.join(path.resolve(__dirname, '..'), 'docs', 'STORE_LISTING.md');
const LANGS = ['en', 'tr', 'es', 'zh'];
const LIMIT = 100;

// The app name is one string across every locale — it is the record's name, and
// Apple indexes it in all of them.
const APP_NAME = 'LUMEN — flip · thread · flow';

// A keyword is a claim. The build plays rewarded video, so no locale may promise
// an ad-free game.
const FALSE_CLAIMS = [
  { re: /\bno.?ads?\b/i, why: 'the build plays rewarded video' },
  { re: /reklamsız/i, why: 'the build plays rewarded video' },
  { re: /sin anuncios/i, why: 'the build plays rewarded video' },
  { re: /无广告/, why: 'the build plays rewarded video' },
];

const md = fs.readFileSync(DOC, 'utf8');

function section(heading) {
  const at = md.indexOf(heading);
  if (at < 0) throw new Error('no heading: ' + heading);
  const rest = md.slice(at + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? md.slice(at) : md.slice(at, at + 1 + next);
}

function fencedFor(sec, lang) {
  const at = sec.indexOf('**' + lang + '**');
  if (at < 0) return null;
  const f = sec.indexOf('```', at);
  const e = sec.indexOf('```', f + 3);
  if (f < 0 || e < 0) return null;
  return sec.slice(f + 3, e).trim();
}

const kw = section('## Keywords');
const subs = section('## Short description');

// Subtitles are a table row: | **en** | <=30 subtitle | <=80 short |
function subtitleFor(lang) {
  const m = new RegExp('^\\|\\s*\\*\\*' + lang + '\\*\\*\\s*\\|([^|]*)\\|', 'm').exec(subs);
  return m ? m[1].trim() : '';
}

// Split on anything that is not a letter, digit or hyphen. CJK has no spaces, so
// a Chinese subtitle yields one long token — compare those by substring instead.
const words = (s) =>
  s.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length > 1);

let problems = 0;

for (const lang of LANGS) {
  const keywords = fencedFor(kw, lang);
  if (!keywords) {
    console.error(`${lang}: no keyword block`);
    problems++;
    continue;
  }

  const n = [...keywords].length;
  if (n > LIMIT) {
    console.error(`${lang}: ${n} characters, limit ${LIMIT}`);
    problems++;
  }

  if (/,\s/.test(keywords)) {
    console.error(`${lang}: space after a comma — every one costs a character`);
    problems++;
  }

  const indexed = new Set(words(APP_NAME + ' ' + subtitleFor(lang)));
  const cjk = (APP_NAME + subtitleFor(lang)).replace(/[^\p{Script=Han}]/gu, '');
  const terms = keywords.split(',').map((t) => t.trim()).filter(Boolean);

  for (const t of terms) {
    const latinDupe = indexed.has(t.toLowerCase());
    const hanDupe = /\p{Script=Han}/u.test(t) && cjk.includes(t);
    if (latinDupe || hanDupe) {
      console.error(`${lang}: "${t}" is already in the app name or subtitle — dead space`);
      problems++;
    }
  }

  for (const { re, why } of FALSE_CLAIMS) {
    if (re.test(keywords)) {
      console.error(`${lang}: claims "${re.source}" but ${why}`);
      problems++;
    }
  }

  const dupes = terms.filter((t, i) => terms.indexOf(t) !== i);
  if (dupes.length) {
    console.error(`${lang}: repeated term(s): ${[...new Set(dupes)].join(', ')}`);
    problems++;
  }

  console.log(`${lang.padEnd(3)} ${String(n).padStart(3)}/${LIMIT}  ${terms.length} terms`);
}

if (problems) {
  console.error(`\n${problems} problem(s).`);
  process.exit(1);
}
console.log('\nKeyword sets are clean.');
