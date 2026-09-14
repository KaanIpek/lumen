/*
 * Tiny App Store Connect API client for one-off calls.
 *
 *   node tools/asc.js GET  /v1/apps/6797276640/appStoreVersions?limit=5
 *   node tools/asc.js POST /v1/appEvents  '{"data":{...}}'
 *
 * Reads ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH from the environment. The .p8
 * is read straight into crypto.sign and never printed — pass the PATH, never the
 * contents, and never let it reach a log.
 */
'use strict';
const fs = require('fs'), https = require('https'), crypto = require('crypto');
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env;
const miss = ['ASC_KEY_ID','ASC_ISSUER_ID','ASC_KEY_PATH'].filter(k => !process.env[k]);
if (miss.length) { console.error('missing env: ' + miss.join(', ')); process.exit(1); }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' });
  const pay = b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + pay),
    { key: fs.readFileSync(ASC_KEY_PATH), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return head + '.' + pay + '.' + sig;
}

function call(method, path, body) {
  return new Promise((res, rej) => {
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = https.request({
      host: 'api.appstoreconnect.apple.com', path, method,
      headers: Object.assign({ Authorization: 'Bearer ' + token() },
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    }, (r) => {
      let d = ''; r.on('data', (c) => d += c);
      r.on('end', () => res({ status: r.statusCode, body: d, headers: r.headers }));
    });
    req.on('error', rej);
    if (data) req.write(data);
    req.end();
  });
}
module.exports = { call, token };

if (require.main === module) {
  let [method, path, body] = process.argv.slice(2);
  // A JSON body on the command line gets mangled by the shell the moment it has
  // newlines. '@file' reads it from disk instead, which is the only reliable way.
  if (body && body[0] === '@') body = fs.readFileSync(body.slice(1), 'utf8');
  call(method, path, body).then((r) => {
    console.log('HTTP ' + r.status);
    try { console.log(JSON.stringify(JSON.parse(r.body), null, 1)); }
    catch (e) { console.log(r.body.slice(0, 900)); }
  });
}
