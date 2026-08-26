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
// Replace the artwork that is already there instead of stepping around it.
//
// Leaving existing screenshots alone is the right default -- a re-run should not
// silently churn a live listing -- but it made the ONE case that matters
// impossible from here: a version inherits the previous release's three
// screenshots into every locale the moment that locale is created, so a new
// locale is never empty and never gets the new set. And App Store Connect's own
// Delete All refuses to fire on the iPad panel in an automated browser, which is
// how this flag came to exist.
const REPLACE_SHOTS = process.argv.includes('--replace-screenshots');

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

  // Keywords: one fenced block per locale under the Keywords heading, each
  // introduced by **<lang>**. They used to be a single latin list copied to all
  // four languages; most people search in their own, so English in the Chinese
  // store bought nothing. Scoped to the section so the **en** here is not
  // confused with the promotional-text lines above, which use the same marker.
  const kAt = md.indexOf('## Keywords');
  if (kAt < 0) throw new Error('no Keywords heading');
  const rest = md.slice(kAt + 1);
  const nextHead = rest.search(/^## /m);
  const section = nextHead < 0 ? md.slice(kAt) : md.slice(kAt, kAt + 1 + nextHead);
  for (const k of Object.keys(LOCALES)) {
    const at = section.indexOf('**' + k + '**');
    if (at < 0) throw new Error('no keywords for ' + k);
    const f = section.indexOf('```', at), e = section.indexOf('```', f + 3);
    if (f < 0 || e < 0) throw new Error('no fenced keywords for ' + k);
    out[k].keywords = section.slice(f + 3, e).trim();
  }

  // Release notes, one fenced block per locale, same shape as the keywords.
  //
  // Apple asks for these PER LOCALE on every update, and a version whose other
  // three languages are blank is a version those players are shown nothing for.
  // The first run of this script left exactly that: en-US had 935 characters and
  // tr, es-ES and zh-Hans had none, because nothing here read them.
  const wAt = md.indexOf("## What's new");
  if (wAt < 0) throw new Error('no release-notes heading');
  const wRest = md.slice(wAt + 1);
  const wNext = wRest.search(/^## /m);
  const wSection = wNext < 0 ? md.slice(wAt) : md.slice(wAt, wAt + 1 + wNext);
  for (const k of Object.keys(LOCALES)) {
    const at = wSection.indexOf('**' + k + '**');
    if (at < 0) throw new Error('no release notes for ' + k);
    const f = wSection.indexOf('```', at), e = wSection.indexOf('```', f + 3);
    if (f < 0 || e < 0) throw new Error('no fenced release notes for ' + k);
    out[k].whatsNew = wSection.slice(f + 3, e).replace(/^\r?\n/, '').trimEnd();
  }

  return out;
}

// Apple rejects anything over the limit with a validation error that names the
// field but not the language, so check here where we can say exactly which.
const LIMITS = { subtitle: 30, promo: 170, description: 4000, keywords: 100, whatsNew: 4000 };
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

// ------------------------------------------------------------ screenshots ---
// Three steps per image, and the middle one does not go to Apple's API host:
//   1. POST /v1/appScreenshots  reserves a slot and hands back uploadOperations
//   2. PUT  each operation's url with that byte range (a signed storage URL)
//   3. PATCH the screenshot with uploaded:true and the file's MD5
// Skipping step 3 leaves an asset that exists, occupies a slot, and never
// appears — the failure mode that made this worth doing carefully.

// 1290x2796 lives in the slot App Store Connect labels "6.9-inch", which also
// takes 6.5" and 6.7" art. Apple's enum for it is still the older 67 name.
//
// Two sets, because the app ships for iPhone AND iPad and Apple requires
// artwork for each device family it is offered on. A single-set uploader was
// fine while this was an iPhone-only build and became a submission blocker the
// moment iPad went back in.
// Eight per slot, not three. Apple allows ten, and the old three were raw
// gameplay from the same world — at the size a search result renders them they
// were one purple smear with nothing to read. The numbered files carry a caption
// and each one is a different world; `tools/caption-shots.js` builds them. The
// -a/-b/-c originals are left in assets/store as a fallback.
const SHOT_SETS = [
  { type: 'APP_IPHONE_67',
    files: Array.from({ length: 8 }, (_, i) => `apple-67-${i + 1}.png`) },
  // 2048x2732 is the 12.9"/13" iPad slot.
  { type: 'APP_IPAD_PRO_3GEN_129',
    files: Array.from({ length: 8 }, (_, i) => `apple-ipad13-${i + 1}.png`) },
];

function putBytes(op, buf) {
  return new Promise((resolve, reject) => {
    const u = new URL(op.url);
    const slice = buf.slice(op.offset, op.offset + op.length);
    const headers = {};
    for (const h of op.requestHeaders || []) headers[h.name] = h.value;
    headers['Content-Length'] = slice.length;
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: op.method || 'PUT', headers,
    }, (res) => {
      res.resume();
      res.on('end', () => (res.statusCode < 300 ? resolve()
        : reject(new Error('upload chunk -> ' + res.statusCode))));
    });
    req.on('error', reject);
    req.write(slice);
    req.end();
  });
}

async function uploadScreenshots(versionId) {
  console.log('\nScreenshots:');
  const locs = await api('GET', '/v1/appStoreVersions/' + versionId + '/appStoreVersionLocalizations?limit=50');
  const en = (locs.data || []).find((l) => l.attributes.locale === 'en-US');
  if (!en) throw new Error('no en-US localization to attach screenshots to');
  // EVERY localization, not just the primary one. A localization that exists
  // with no artwork leaves the version in a state App Store Connect will not
  // review, and the API says only "not in valid state" — it never names the
  // locale. Three empty ones sat there while the submission was refused.
  for (const loc of locs.data || []) {
    console.log('  [' + loc.attributes.locale + ']');
    for (const spec of SHOT_SETS) await uploadOneSet(loc, spec);
  }
}

async function uploadOneSet(en, spec) {
  const SHOT_TYPE = spec.type, SHOT_FILES = spec.files;
  console.log('  ' + SHOT_TYPE + ':');

  // Reuse the set if one exists; a second set for the same display type is
  // rejected, and creating one per run would fail every run after the first.
  const sets = await api('GET', '/v1/appStoreVersionLocalizations/' + en.id + '/appScreenshotSets?limit=20');
  let set = (sets.data || []).find((s) => s.attributes.screenshotDisplayType === SHOT_TYPE);
  if (set) {
    const existing = await api('GET', '/v1/appScreenshotSets/' + set.id + '/appScreenshots?limit=20');
    if ((existing.data || []).length) {
      if (!REPLACE_SHOTS) {
        console.log('  ' + existing.data.length + ' already uploaded — leaving them alone.');
        console.log('  Pass --replace-screenshots to swap them.');
        return;
      }
      for (const shot of existing.data) {
        await api('DELETE', '/v1/appScreenshots/' + shot.id);
      }
      console.log('  removed ' + existing.data.length + ' existing');
    }
  } else {
    const made = await api('POST', '/v1/appScreenshotSets', {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: SHOT_TYPE },
        relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: en.id } } },
      },
    });
    set = made.data;
    console.log('  created a ' + SHOT_TYPE + ' set');
  }

  for (const name of SHOT_FILES) {
    const file = path.join(SHOTS, name);
    const buf = fs.readFileSync(file);
    const res = await api('POST', '/v1/appScreenshots', {
      data: {
        type: 'appScreenshots',
        attributes: { fileSize: buf.length, fileName: name },
        relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
      },
    });
    const shot = res.data;
    for (const op of shot.attributes.uploadOperations || []) await putBytes(op, buf);
    // Apple verifies this checksum; a wrong one fails the asset AFTER upload.
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    await api('PATCH', '/v1/appScreenshots/' + shot.id, {
      data: { type: 'appScreenshots', id: shot.id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
    });
    console.log('  uploaded ' + name + ' (' + (buf.length / 1024 / 1024).toFixed(2) + ' MB)');
  }

  // Apple processes asynchronously, so "uploaded" is not yet "accepted".
  const after = await api('GET', '/v1/appScreenshotSets/' + set.id + '/appScreenshots?limit=20');
  for (const s of after.data || []) {
    const st = (s.attributes.assetDeliveryState || {}).state;
    console.log('  ' + s.attributes.fileName + ' -> ' + st);
  }
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
      whatsNew: f.whatsNew,
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
  // An app with a released version carries TWO appInfos: the one frozen against
  // the live version, and an editable one that exists while a version is being
  // prepared. This used to take [0] and got whichever the API listed first —
  // once 1.0 was live that was the frozen one, and every write came back 409
  // "The field 'name' can not be modified in the current state", which reads
  // like a naming problem and is really the wrong record.
  const infos = await api('GET', '/v1/apps/' + app.id + '/appInfos?limit=5');
  const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'WAITING_FOR_REVIEW'];
  const all = infos.data || [];
  const info =
    all.find((i) => EDITABLE.includes(i.attributes.appStoreState)) ||
    all.find((i) => EDITABLE.includes(i.attributes.state)) ||
    all[0];
  if (info) {
    console.log(
      '\nApp info ' + info.id +
        ' (' + (info.attributes.appStoreState || info.attributes.state || 'state unknown') + ')' +
        (all.length > 1 ? '  — ' + all.length + ' records, picked the editable one' : '')
    );
    const iLocs = await api('GET', '/v1/appInfos/' + info.id + '/appInfoLocalizations?limit=50');
    const iBy = Object.fromEntries((iLocs.data || []).map((l) => [l.attributes.locale, l]));
    for (const [lang, f] of Object.entries(listing)) {
      const locale = LOCALES[lang];
      // Take the name from the RECORD, never a constant. `LUMEN` was already
      // taken on the App Store, so the record carries the documented fallback —
      // and a hardcoded name here answers Apple with a 409 that reads like a
      // trademark problem when it is really a stale string in this file.
      const attrs = {
        name: app.attributes.name,
        subtitle: f.subtitle,
        privacyPolicyUrl: 'https://kaanipek.github.io/lumen/privacy.html',
      };
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

  if (WITH_SHOTS) await uploadScreenshots(editable.id);

  console.log('\nDone. Read it back in App Store Connect before you submit —');
  console.log('this script has never been run against a live account.');
})().catch((e) => { console.error('\n' + e.message); process.exit(1); });
