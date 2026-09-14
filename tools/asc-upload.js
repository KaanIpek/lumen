/*
 * Upload image assets to App Store Connect.
 *
 *   node tools/asc-upload.js cpp   <localizationId> <file...>   custom product page shots
 *   node tools/asc-upload.js event <localizationId> <file...>   in-app event card
 *
 * WHY A SECOND UPLOADER
 *   asc-listing.js uploads screenshots for an app STORE VERSION. Custom product
 *   pages and in-app events hang off different parents and, in the event case, a
 *   different resource type entirely (appEventScreenshots, not appScreenshots).
 *   The three-step dance is the same everywhere: reserve, PUT the bytes to every
 *   uploadOperation, then PATCH uploaded:true with the md5 Apple re-checks.
 */
'use strict';
const fs = require('fs'), path = require('path'), https = require('https'), crypto = require('crypto');
const { call } = require('./asc.js');

async function api(method, p, body) {
  const r = await call(method, p, body);
  if (r.status >= 300) throw new Error(method + ' ' + p + ' -> ' + r.status + ' ' + r.body.slice(0, 400));
  return r.body ? JSON.parse(r.body) : null;
}
function putBytes(op, buf) {
  return new Promise((res, rej) => {
    const u = new URL(op.url);
    const slice = buf.slice(op.offset, op.offset + op.length);
    const headers = {};
    for (const h of op.requestHeaders || []) headers[h.name] = h.value;
    headers['Content-Length'] = slice.length;
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: op.method || 'PUT', headers },
      (r) => { r.resume(); r.on('end', () => (r.statusCode < 300 ? res() : rej(new Error('chunk -> ' + r.statusCode)))); });
    req.on('error', rej); req.write(slice); req.end();
  });
}

(async () => {
  const [kind, locId, ...files] = process.argv.slice(2);
  const isEvent = kind === 'event';
  let setId = null;

  if (!isEvent) {
    const have = await api('GET', '/v1/appCustomProductPageLocalizations/' + locId + '/appScreenshotSets?limit=10');
    const DTYPE = process.env.SHOT_DISPLAY_TYPE || 'APP_IPHONE_67';
    const found = (have.data || []).find((s) => s.attributes.screenshotDisplayType === DTYPE);
    if (found) {
      setId = found.id;
      const old = await api('GET', '/v1/appScreenshotSets/' + setId + '/appScreenshots?limit=20');
      for (const s of old.data || []) await api('DELETE', '/v1/appScreenshots/' + s.id);
      if ((old.data || []).length) console.log('removed ' + old.data.length + ' existing');
    } else {
      const made = await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: DTYPE },
        relationships: { appCustomProductPageLocalization: { data: { type: 'appCustomProductPageLocalizations', id: locId } } } } });
      setId = made.data.id; console.log('created screenshot set');
    }
  }

  for (const f of files) {
    const buf = fs.readFileSync(f), name = path.basename(f);
    const type = isEvent ? 'appEventScreenshots' : 'appScreenshots';
    const rel = isEvent
      ? { appEventLocalization: { data: { type: 'appEventLocalizations', id: locId } } }
      : { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } };
    const res = await api('POST', '/v1/' + type, { data: { type,
      attributes: Object.assign({ fileSize: buf.length, fileName: name },
        // Event assets are typed; the card is the 1920x1080 one the App Store
        // shows on the event page and in discovery.
        isEvent ? { appEventAssetType: process.env.EVENT_ASSET_TYPE || 'EVENT_CARD' } : {}),
      relationships: rel } });
    const asset = res.data;
    for (const op of asset.attributes.uploadOperations || []) await putBytes(op, buf);
    // appScreenshots takes a checksum Apple re-verifies; appEventScreenshots
    // does NOT have that attribute and rejects the whole PATCH if you send it.
    const attrs = { uploaded: true };
    if (!isEvent) attrs.sourceFileChecksum = crypto.createHash('md5').update(buf).digest('hex');
    await api('PATCH', '/v1/' + type + '/' + asset.id, { data: { type, id: asset.id, attributes: attrs } });
    console.log('uploaded ' + name + ' (' + (buf.length / 1048576).toFixed(2) + ' MB)');
  }
})().catch((e) => { console.error(String(e.message).slice(0, 500)); process.exit(1); });
