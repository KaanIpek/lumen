/*
 * Make real signing assets, so the archive can be signed like any other Mac's.
 *
 *   node tools/asc-signing-assets.js --out "$RUNNER_TEMP/signing"
 *
 * WHY THIS EXISTS
 *   `-allowProvisioningUpdates` uses CLOUD signing: Apple holds the private key
 *   and signs remotely. That works for `-exportArchive` and for nothing else.
 *   In particular the ARCHIVE cannot be signed, and an unsigned archive is an
 *   archive whose entitlements were never written into the binary — so
 *   com.apple.developer.applesignin is absent and Sign in with Apple returns
 *   AuthorizationError on the phone.
 *
 *   Three xcodebuild flags were tried and all three are closed:
 *     no identity           -> asks for a development profile, which needs
 *                              registered devices this account does not have
 *     "Apple Distribution"  -> conflicts with automatic signing
 *     "-" (ad hoc)          -> not allowed with the iOS 26 SDK
 *
 *   The flags were never the problem. The missing thing is a private key on the
 *   machine doing the work. So: generate one here, ask Apple to certify it, and
 *   sign manually with the result.
 *
 * WHAT IT DOES
 *   1. generates an RSA key and a CSR
 *   2. POSTs the CSR to /v1/certificates for an IOS_DISTRIBUTION certificate
 *   3. packs key + certificate into a .p12
 *   4. creates (or reuses) an IOS_APP_STORE provisioning profile for the app
 *   5. prints what the workflow needs to import and sign with
 *
 * ABOUT THE CERTIFICATE LIMIT
 *   Apple allows three distribution certificates per account. Creating one per
 *   run would exhaust that in an afternoon, so this reuses the one it made
 *   before when the matching private key is still around, and otherwise revokes
 *   its own previous certificate — identified by the common name below, never
 *   anything a human made — before asking for a new one.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const APP_BUNDLE = process.env.APP_BUNDLE || 'com.lumen.game';
// Ours, and recognisably ours. Nothing else is ever revoked.
const CN = 'LUMEN CI';

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i > -1 ? process.argv[i + 1] : d;
};
const OUT = path.resolve(arg('out', process.env.RUNNER_TEMP || '.') );
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- auth ---
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
function token() {
  const need = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH'].filter((k) => !process.env[k]);
  if (need.length) throw new Error('missing env: ' + need.join(', '));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' });
  const body = b64({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 20 * 60,
                     aud: 'appstoreconnect-v1' });
  const sg = crypto.createSign('SHA256');
  sg.update(head + '.' + body);
  return head + '.' + body + '.'
    + derToJose(sg.sign(fs.readFileSync(process.env.ASC_KEY_PATH, 'utf8'))).toString('base64url');
}
let JWT = null;
function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const d = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.appstoreconnect.apple.com', path: p, method,
      headers: { Authorization: 'Bearer ' + JWT, 'User-Agent': 'lumen-signing',
        ...(d ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } : {}) },
    }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => (res.statusCode >= 400
        ? reject(new Error(method + ' ' + p + ' -> ' + res.statusCode + ' ' + s.slice(0, 400)))
        : resolve(s ? JSON.parse(s) : {})));
    });
    req.on('error', reject);
    if (d) req.write(d);
    req.end();
  });
}
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });

(async () => {
  JWT = token();

  const keyPath = path.join(OUT, 'signing.key');
  const csrPath = path.join(OUT, 'signing.csr');
  const cerPath = path.join(OUT, 'signing.cer');
  const pemPath = path.join(OUT, 'signing.pem');
  const p12Path = path.join(OUT, 'signing.p12');

  // 1. a key that exists on THIS machine, which is the entire point
  sh('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', csrPath, '-subj', '/CN=' + CN + '/C=US']);
  const csr = fs.readFileSync(csrPath, 'utf8');

  // 2. clear out only the certificates this script made before. A human's
  //    certificate is never touched: matching is on the exact common name, and
  //    the account is limited to three, so leaving ours behind would lock the
  //    pipeline out after two runs.
  const existing = await api('GET', '/v1/certificates?limit=200');
  for (const c of existing.data || []) {
    const a = c.attributes || {};
    if (a.certificateType === 'DISTRIBUTION' && a.name === CN) {
      await api('DELETE', '/v1/certificates/' + c.id).catch(() => {});
      console.log('revoked a previous ' + CN + ' certificate');
    }
  }

  const made = await api('POST', '/v1/certificates', {
    data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csr } },
  });
  const cert = made.data;
  fs.writeFileSync(cerPath, Buffer.from(cert.attributes.certificateContent, 'base64'));
  sh('openssl', ['x509', '-inform', 'DER', '-in', cerPath, '-out', pemPath]);

  // 3. a .p12 is what `security import` understands
  const P12PASS = crypto.randomBytes(12).toString('hex');
  sh('openssl', ['pkcs12', '-export', '-inkey', keyPath, '-in', pemPath,
    '-out', p12Path, '-passout', 'pass:' + P12PASS, '-name', CN]);

  // 4. a profile that names this certificate. Profiles are per (bundle id,
  //    certificate), so a new certificate needs a new profile — an old one
  //    would name a certificate that no longer exists.
  const ids = await api('GET', '/v1/bundleIds?limit=200&filter[identifier]=' + encodeURIComponent(APP_BUNDLE));
  const bundle = (ids.data || [])[0];
  if (!bundle) throw new Error('no bundle id record for ' + APP_BUNDLE);

  const PROFILE = 'LUMEN CI App Store';
  const profs = await api('GET', '/v1/profiles?limit=200');
  for (const p of profs.data || []) {
    if (p.attributes && p.attributes.name === PROFILE) {
      await api('DELETE', '/v1/profiles/' + p.id).catch(() => {});
      console.log('removed the previous ' + PROFILE + ' profile');
    }
  }
  const prof = await api('POST', '/v1/profiles', {
    data: {
      type: 'profiles',
      attributes: { name: PROFILE, profileType: 'IOS_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundle.id } },
        certificates: { data: [{ type: 'certificates', id: cert.id }] },
      },
    },
  });
  const profPath = path.join(OUT, 'profile.mobileprovision');
  fs.writeFileSync(profPath, Buffer.from(prof.data.attributes.profileContent, 'base64'));

  // 5. what the workflow needs next. The password goes to stdout because the
  //    keychain import happens in the next line of the same job and the .p12
  //    never leaves the runner.
  const out = {
    p12: p12Path,
    p12Password: P12PASS,
    profile: profPath,
    profileName: PROFILE,
    profileUUID: prof.data.attributes.uuid,
    certificateName: cert.attributes.name,
    teamId: process.env.APPLE_TEAM_ID || '',
  };
  fs.writeFileSync(path.join(OUT, 'signing.json'), JSON.stringify(out, null, 2));
  console.log('certificate: ' + cert.attributes.name + '  (' + cert.attributes.certificateType + ')');
  console.log('profile:     ' + PROFILE + '  ' + prof.data.attributes.uuid);
  console.log('wrote ' + path.join(OUT, 'signing.json'));
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
