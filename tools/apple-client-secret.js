/*
 * Print the client secret Supabase needs for Sign in with Apple.
 *
 *   node tools/apple-client-secret.js \
 *     --key "C:/path/AuthKey_XXXXXXXXXX.p8" \
 *     --key-id XXXXXXXXXX \
 *     --team-id 6U7VZ57P8K \
 *     --service-id com.lumen.game.web
 *
 * RUN THIS YOURSELF. The .p8 is a private key and the JWT it produces is a
 * credential: anything that can read either can sign in as your app. Neither
 * should be pasted into a chat, committed, or sent anywhere except the Supabase
 * dashboard field it is meant for.
 *
 * WHAT IT IS
 *   Apple does not issue a static client secret. It wants an ES256 JWT you sign
 *   yourself, valid for at most six months. So this is not a lookup — it is the
 *   secret, generated on the spot.
 *
 *   Which also means it EXPIRES. Put a reminder somewhere for five months from
 *   now: when it lapses, sign-in stops working for everyone at once, and the
 *   error Apple returns says nothing about a date.
 *
 * Same hand-rolled ES256 as tools/asc-listing.js — this project has no
 * dependencies and a JWT is not a reason to start.
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : null;
}

const keyPath = arg('key');
const keyId = arg('key-id');
const teamId = arg('team-id') || '6U7VZ57P8K';
const serviceId = arg('service-id') || 'com.lumen.game.web';
const months = Math.min(6, parseInt(arg('months') || '6', 10));

const missing = [];
if (!keyPath) missing.push('--key (path to the AuthKey_*.p8 you downloaded)');
if (!keyId) missing.push('--key-id (the ten characters in the file name)');
if (missing.length) {
  console.error('Missing:\n  ' + missing.join('\n  '));
  console.error('\nExample:\n  node tools/apple-client-secret.js --key "C:/Users/you/Downloads/AuthKey_ABC1234DEF.p8" \\\n    --key-id ABC1234DEF --team-id ' + teamId + ' --service-id ' + serviceId);
  process.exit(1);
}
if (!fs.existsSync(keyPath)) {
  console.error('No such file: ' + keyPath);
  process.exit(1);
}

// DER (r,s) -> JOSE (r||s). Node signs in DER; JWT wants the raw pair.
function derToJose(der) {
  let o = 2;
  const len = der[1];
  if (len & 0x80) o += len & 0x7f;
  const read = () => {
    const l = der[o + 1];
    let s = o + 2;
    const e = s + l;
    while (der[s] === 0 && e - s > 32) s++;
    const b = Buffer.alloc(32);
    der.copy(b, 32 - (e - s), s, e);
    o = e;
    return b;
  };
  return Buffer.concat([read(), read()]);
}

const now = Math.floor(Date.now() / 1000);
const exp = now + months * 30 * 24 * 60 * 60;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'ES256', kid: keyId });
const body = b64({
  iss: teamId,
  iat: now,
  exp,
  aud: 'https://appleid.apple.com',
  sub: serviceId,
});
const sign = crypto.createSign('SHA256');
sign.update(head + '.' + body);
const jwt = head + '.' + body + '.'
  + derToJose(sign.sign(fs.readFileSync(keyPath, 'utf8'))).toString('base64url');

console.log('\nExpires: ' + new Date(exp * 1000).toISOString().slice(0, 10)
  + '  <- sign-in breaks for everyone on this date unless you regenerate\n');
console.log('Paste this into Supabase -> Authentication -> Providers -> Apple -> Secret Key:\n');
console.log(jwt);
console.log('\nDo not commit it, and do not paste it into a chat.\n');
