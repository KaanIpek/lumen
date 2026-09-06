/*
 * Upload an App Store PREVIEW VIDEO to one or more locales.
 *
 *   node tools/asc-preview.js <versionId> <file.mp4> <previewType> <locale> [locale...]
 *
 * Why this exists: a preview video only plays for the locales that have one.
 * LUMEN shipped with a video on en-US and nothing on tr, es-ES or zh-Hans, so a
 * Turkish, Spanish or Chinese visitor saw a still page while an English one saw
 * the game move. That is the single biggest conversion element on the product
 * page, missing from three of four storefronts.
 *
 * THE FOUR-STEP DANCE, and why each step is here:
 *   1. POST /v1/appPreviewSets      — a set per (locale, device type)
 *   2. POST /v1/appPreviews         — declare fileName + fileSize; Apple answers
 *                                     with uploadOperations, a list of byte
 *                                     RANGES and the URL each one goes to
 *   3. PUT every operation           — the ranges are Apple's, not ours; slicing
 *                                     the file our own way corrupts the asset in
 *                                     a way that only shows up at review time
 *   4. PATCH { uploaded: true, sourceFileChecksum } — the checksum is what makes
 *                                     a truncated upload fail LOUDLY here rather
 *                                     than silently becoming a broken video on
 *                                     the store page
 *
 * A version that is live cannot take new media: ASC answers 409
 * ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_STATE. Point this at a version that is
 * still editable.
 */
'use strict';
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const { call, token } = require('./asc.js');

const j = (r) => { try { return JSON.parse(r.body); } catch (e) { return {}; } };

// Apple hands back an absolute URL plus its own method and headers. Follow them
// exactly — this is not our request to shape.
function putChunk(op, buf) {
  return new Promise((res, rej) => {
    const u = new URL(op.url);
    const headers = {};
    for (const h of (op.requestHeaders || [])) headers[h.name] = h.value;
    headers['Content-Length'] = op.length;
    const req = https.request({
      host: u.hostname, path: u.pathname + u.search, method: op.method || 'PUT', headers,
    }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); });
    req.on('error', rej);
    req.end(buf.subarray(op.offset, op.offset + op.length));
  });
}

async function uploadOne(locId, file, previewType) {
  const buf = fs.readFileSync(file);
  const name = path.basename(file);

  let r = await call('POST', '/v1/appPreviewSets', {
    data: { type: 'appPreviewSets', attributes: { previewType },
            relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: locId } } } } });
  // A set may already exist for this (locale, device) pair — reuse it rather
  // than failing, so the script is safe to re-run after a partial upload.
  let setId;
  if (r.status === 201) setId = j(r).data.id;
  else {
    const sets = j(await call('GET', '/v1/appStoreVersionLocalizations/' + locId + '/appPreviewSets?limit=10&fields[appPreviewSets]=previewType'));
    const hit = (sets.data || []).find((s) => s.attributes.previewType === previewType);
    if (!hit) return { ok: false, step: 'preview set', status: r.status, body: r.body.slice(0, 300) };
    setId = hit.id;
  }

  r = await call('POST', '/v1/appPreviews', {
    data: { type: 'appPreviews', attributes: { fileName: name, fileSize: buf.length },
            relationships: { appPreviewSet: { data: { type: 'appPreviewSets', id: setId } } } } });
  if (r.status >= 300) return { ok: false, step: 'reserve', status: r.status, body: r.body.slice(0, 300) };
  const prev = j(r).data;
  const ops = prev.attributes.uploadOperations || [];
  if (!ops.length) return { ok: false, step: 'no upload operations' };

  for (let i = 0; i < ops.length; i++) {
    const up = await putChunk(ops[i], buf);
    if (up.status >= 300) return { ok: false, step: 'chunk ' + (i + 1) + '/' + ops.length, status: up.status };
  }

  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  r = await call('PATCH', '/v1/appPreviews/' + prev.id, {
    data: { type: 'appPreviews', id: prev.id, attributes: { uploaded: true, sourceFileChecksum: md5 } } });
  if (r.status >= 300) return { ok: false, step: 'commit', status: r.status, body: r.body.slice(0, 300) };
  return { ok: true, id: prev.id, chunks: ops.length, bytes: buf.length };
}

(async () => {
  const [versionId, file, previewType, ...locales] = process.argv.slice(2);
  if (!versionId || !file || !previewType || !locales.length) {
    console.error('usage: node tools/asc-preview.js <versionId> <file.mp4> <previewType> <locale...>');
    process.exit(1);
  }
  const locs = j(await call('GET', '/v1/appStoreVersions/' + versionId
    + '/appStoreVersionLocalizations?limit=20&fields[appStoreVersionLocalizations]=locale'));
  const byLocale = {};
  for (const l of (locs.data || [])) byLocale[l.attributes.locale] = l.id;

  for (const code of locales) {
    const id = byLocale[code];
    if (!id) { console.log(code.padEnd(8), 'SKIP — no localization on this version'); continue; }
    const res = await uploadOne(id, file, previewType);
    console.log(code.padEnd(8), res.ok
      ? 'uploaded ' + (res.bytes / 1048576).toFixed(1) + ' MB in ' + res.chunks + ' chunks'
      : 'FAILED at ' + res.step + ' ' + (res.status || '') + ' ' + (res.body || ''));
  }
})();
