/*
 * Fill the App Store listing from docs/STORE_LISTING.md, over the App Store
 * Connect API.
 *
 *   node tools/asc-listing.js                 # DRY RUN — prints, changes nothing
 *   node tools/asc-listing.js --apply         # actually writes
 *   node tools/asc-listing.js --apply --screenshots
 *
 * WHY THIS EXISTS
 *   The listing is 4 languages x (subtitle, promo text, description, keywords),
 *   plus 6 screenshots. Typed into a web form that is roughly an hour of
 *   copy-paste, in two languages nobody here can proofread by eye, and a single
 *   dropped character in the Chinese description is invisible until a reviewer
 *   or a player finds it. The text already exists, correct, in the repo. This
 *   moves it without a human retyping it.
 *
 * WHAT IT CANNOT DO, AND WHY
 *   Apple does not expose app-record CREATION. `POST /v1/apps` does not exist —
 *   the endpoint allows GET_COLLECTION, GET_INSTANCE and UPDATE only. The record
 *   has to be made once, by hand, at appstoreconnect.apple.com. Everything after
 *   that is what this script does. It also will not submit for review: pressing
 *   that button is a decision, not a chore.
 *
 * CREDENTIALS
 *   Never passed as arguments and never written to this repo — an API key that
 *   lands in shell history or a file is an API key you have to rotate. Set:
 *
 *     ASC_KEY_ID     the key id            (App Store Connect -> Users and
 *     ASC_ISSUER_ID  the issuer id          Access -> Integrations -> App Store
 *     ASC_KEY_PATH   path to AuthKey_*.p8   Connect API)
 *
 *   Keep the .p8 OUTSIDE this folder. Apple lets you download it exactly once.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'STORE_LISTING.md');
const SHOTS = path.join(ROOT, 'assets', 'store');
const BUNDLE_ID = 'com.lumen.game';

const APPLY = process.argv.includes('--apply');
const WITH_SHOTS = process.argv.includes('--screenshots');

// Apple's locale codes for the four languages the game speaks.
const LOCALES = { en: 'en-US', tr: 'tr', es: 'es-ES', zh: 'zh-Hans' };

// ---------------------------------------------------------------- the copy ---
// Parsed from the document rather than duplicated into this file. Two copies of
// a description drift, and the one that drifts is always the one nobody reads.

function readListing() {
  const md = fs.readFileSync(DOC, 'utf8');
  const out = {};
  for (const k of Object.keys(LOCALES)) out[k] = {};

  // Subtitles live in a table: | **en** | <=30 subtitle | <=80 short |
  for (const k of Object.keys(LOCALES)) {
    const row = new RegExp('^\\|\\s*\\*\\*' + k + '\\*\\*\\s*\\|([^|]*)\\|', 'm').exec(md);
    if (!row) throw new Error('no subtitle row for ' + k);
    out[k].subtitle = row[1].trim();
  }

  // Promotional text:  **en** — `...`
  for (const k of Object.keys(LOCALES)) {
    const m = new RegExp('\\*\\*' + k + '\\*\\*\\s*[—-]\\s*`([^`]+)`').exec(md);
    if (!m) throw new Error('no promotional text for ' + k);
    out[k].promo = m[1].trim();
  }

  // Full descriptions: a fenced block under each language heading.
  const heads = { en: 'English', tr: 'Türkçe', es: 'Español', zh: '中文（简体）' };
  for (const [k, h] of Object.entries(heads)) {
    const at = md.indexOf('### ' + h);
    if (at < 0) throw new Error('no description heading for ' + k);
    const fence = md.indexOf('```', at);
    const end = md.indexOf('```', fence + 3);
    if (fence < 0 || end < 0) throw new Error('no fenced description for ' + k);
    out[k].description = md.slice(fence + 3, end).replace(/^\n/, '').trimEnd();
  }

  // Keywords: the single fenced block under the Keywords heading. Apple applies
  // them per-locale, and these are latin words a Turkish or Spanish speaker
  // types too, so the same list goes to every locale.
  const kAt = md.indexOf('## Keywords');
  const kF = md.indexOf('```', kAt), kE = md.indexOf('```', kF + 3);
  const keywords = md.slice(kF + 3, kE).trim();
  for (const k of Object.keys(LOCALES)) out[k].keywords = keywords;

  return out;
}

// Apple rejects anything over the limit with a validation error that names the
// field but not the language, so check here where we can say exactly which.
const LIMITS = { subtitle: 30, promo: 170, description: 4000, keywords: 100 };
function checkLimits(listing) {
  const bad = [];
  for (const [lang, f] of Object.entries(listing)) {
    for (const [field, max] of Object.entries(LIMITS)) {
      const n = [...(f[field] || '')].length;   // count characters, not UTF-16 units
      if (n > max) bad.push(`${lang}.${field}: ${n} chars, limit ${max}`);
    }
  }
  return bad;
}

// ------------------------------------------------------------------- auth ---
// ES256 JWT, signed with the .p8. Node can do this without a JWT library: the
// only fiddly part is that createSign emits DER and JOSE wants raw r||s.

function derToJose(der) {
  let o = 2, len = der[1];
  if (len & 0x80) o += len & 0x7f;
  const read = () => {
    const l = der[o + 1]; let s = o + 2, e = s + l;
    while (der[s] === 0 && e - s > 32) s++;          // strip DER's sign padding
    const b = Buffer.alloc(32);
    der.copy(b, 32 - (e - s), s, e);
    o = e;
    return b;
  };
  return Buffer.concat([read(), read()]);
}

function token() {
  const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env;
  const missing = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH'].filter((k) => !process.env[k]);
  if (missing.length) throw new Error('missing env: ' + missing.join(', '));
  if (!fs.existsSync(ASC_KEY_PATH)) throw new Error('no .p8 at ' + ASC_KEY_PATH);

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' });
  // No `scope` claim on purpose. It is optional, and when present it RESTRICTS
  // the token to exactly the routes listed — a token scoped to "GET /v1/apps"
  // 401s on the first PATCH, which reads like a bad key rather than a bad claim.
  // Apple also caps the lifetime at 20 minutes; longer is rejected outright.
  const body = b64({
    iss: ASC_ISSUER_ID, iat: now, exp: now + 20 * 60,
    aud: 'appstoreconnect-v1',
  });
  const signer = crypto.createSign('SHA256');
  signer.update(head + '.' + body);
  const der = signer.sign(fs.readFileSync(ASC_KEY_PATH, 'utf8'));
  return head + '.' + body + '.' + derToJose(der).toString('base64url');
}

// ------------------------------------------------------------------- rest ---

let JWT = null;
function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.appstoreconnect.apple.com', path: p, method,
      headers: {
        Authorization: 'Bearer ' + JWT,
        'User-Agent': 'lumen-listing',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => {
        let j = null;
        try { j = s ? JSON.parse(s) : {}; } catch (e) { /* Apple sends 204 with no body */ }
        if (res.statusCode >= 400) {
          const detail = (j && j.errors || []).map((e) => e.title + ': ' + e.detail).join(' | ');
          return reject(new Error(method + ' ' + p + ' -> ' + res.statusCode + (detail ? ' — ' + detail : ' ' + s.slice(0, 200))));
        }
        resolve(j);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// -------------------------------------------------------------------- run ---

(async () => {
  const listing = readListing();

  const bad = checkLimits(listing);
  console.log('Parsed docs/STORE_LISTING.md:\n');
  for (const [lang, f] of Object.entries(listing)) {
    console.log('  [' + lang + '] ' + LOCALES[lang]);
    console.log('      subtitle    (' + [...f.subtitle].length + '/30)  ' + f.subtitle);
    console.log('      promo       (' + [...f.promo].length + '/170) ' + f.promo.slice(0, 64) + '…');
    console.log('      description (' + [...f.description].length + '/4000)');
    console.log('      keywords    (' + [...f.keywords].length + '/100)');
  }
  if (bad.length) {
    console.error('\nOVER THE LIMIT — Apple would reject these:');
    bad.forEach((b) => console.error('  ' + b));
    process.exit(1);
  }
  console.log('\nEvery field is inside Apple\'s limit.');

  if (!APPLY) {
    console.log('\nDRY RUN. Nothing was sent. Re-run with --apply once');
    console.log('ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH are set and the app');
    console.log('record for ' + BUNDLE_ID + ' exists in App Store Connect.');
    return;
  }

  JWT = token();
  const apps = await api('GET', '/v1/apps?filter[bundleId]=' + encodeURIComponent(BUNDLE_ID));
  if (!apps.data || !apps.data.length) {
    throw new Error('no app record for ' + BUNDLE_ID
      + '. Apple has no API to create one — make it once at appstoreconnect.apple.com.');
  }
  const app = apps.data[0];
  console.log('\nApp: ' + app.attributes.name + '  (' + app.id + ')');

  // The editable version is the one not yet on the store.
  const vers = await api('GET', '/v1/apps/' + app.id + '/appStoreVersions?limit=5');
  const editable = (vers.data || []).find((v) =>
    ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(v.attributes.appStoreState));
  if (!editable) throw new Error('no editable version — every version is submitted or live.');
  console.log('Version ' + editable.attributes.versionString + ' (' + editable.attributes.appStoreState + ')');

  // --- per-locale version text -------------------------------------------
  const locs = await api('GET', '/v1/appStoreVersions/' + editable.id + '/appStoreVersionLocalizations?limit=50');
  const byLocale = Object.fromEntries((locs.data || []).map((l) => [l.attributes.locale, l]));

  for (const [lang, f] of Object.entries(listing)) {
    const locale = LOCALES[lang];
    const attrs = {
      description: f.description,
      keywords: f.keywords,
      promotionalText: f.promo,
      supportUrl: 'https://kaanipek.github.io/lumen/',
      marketingUrl: 'https://kaanipek.github.io/lumen/',
    };
    if (byLocale[locale]) {
      await api('PATCH', '/v1/appStoreVersionLocalizations/' + byLocale[locale].id, {
        data: { type: 'appStoreVersionLocalizations', id: byLocale[locale].id, attributes: attrs },
      });
      console.log('  updated ' + locale);
    } else {
      await api('POST', '/v1/appStoreVersionLocalizations', {
        data: {
          type: 'appStoreVersionLocalizations',
          attributes: { locale, ...attrs },
          relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: editable.id } } },
        },
      });
      console.log('  created ' + locale);
    }
  }

  // --- name and subtitle live on the APP INFO, not the version -----------
  const infos = await api('GET', '/v1/apps/' + app.id + '/appInfos?limit=5');
  const info = (infos.data || [])[0];
  if (info) {
    const iLocs = await api('GET', '/v1/appInfos/' + info.id + '/appInfoLocalizations?limit=50');
    const iBy = Object.fromEntries((iLocs.data || []).map((l) => [l.attributes.locale, l]));
    for (const [lang, f] of Object.entries(listing)) {
      const locale = LOCALES[lang];
      const attrs = { name: 'LUMEN', subtitle: f.subtitle, privacyPolicyUrl: 'https://kaanipek.github.io/lumen/privacy.html' };
      if (iBy[locale]) {
        await api('PATCH', '/v1/appInfoLocalizations/' + iBy[locale].id, {
          data: { type: 'appInfoLocalizations', id: iBy[locale].id, attributes: attrs },
        });
        console.log('  info ' + locale + ' — subtitle + privacy URL');
      } else {
        await api('POST', '/v1/appInfoLocalizations', {
          data: {
            type: 'appInfoLocalizations',
            attributes: { locale, ...attrs },
            relationships: { appInfo: { data: { type: 'appInfos', id: info.id } } },
          },
        });
        console.log('  info ' + locale + ' created');
      }
    }
  }

  if (WITH_SHOTS) {
    console.log('\nScreenshots are a three-step reservation upload and are deliberately');
    console.log('not automated here yet: getting them wrong leaves half-uploaded assets');
    console.log('on the version that you then have to clear by hand. Six drag-and-drops');
    console.log('from assets/store/ is five minutes and cannot half-fail.');
  }

  console.log('\nDone. Read it back in App Store Connect before you submit —');
  console.log('this script has never been run against a live account.');
})().catch((e) => { console.error('\n' + e.message); process.exit(1); });
