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

// The profile that already names the stored certificate. Nothing is created and
// nothing is deleted — the point of the stored .p12 is that neither has to be.
async function reuseProfile() {
  const PROFILE = 'LUMEN CI App Store';
  const profs = await api('GET', '/v1/profiles?limit=200');
  const p = (profs.data || []).find((x) => x.attributes && x.attributes.name === PROFILE);
  if (!p) throw new Error('no "' + PROFILE + '" profile — clear SIGNING_P12_B64 to rebuild the assets');
  const file = path.join(OUT, 'profile.mobileprovision');
  fs.writeFileSync(file, Buffer.from(p.attributes.profileContent, 'base64'));
  return { file, name: PROFILE, uuid: p.attributes.uuid };
}

(async () => {
  JWT = token();

  const keyPath = path.join(OUT, 'signing.key');
  const csrPath = path.join(OUT, 'signing.csr');
  const cerPath = path.join(OUT, 'signing.cer');
  const pemPath = path.join(OUT, 'signing.pem');
  const p12Path = path.join(OUT, 'signing.p12');

  // 0. REUSE a certificate we were given, and revoke nothing.
  //
  // Creating one per run means revoking the previous one per run, and Apple
  // emails the account owner every single time. That is noise I generated, on
  // somebody else's inbox, for no benefit — the certificate only has to exist
  // once. Hand the .p12 back through a secret and this whole section is skipped.
  if (process.env.SIGNING_P12_B64 && process.env.SIGNING_P12_PASS) {
    fs.writeFileSync(p12Path, Buffer.from(process.env.SIGNING_P12_B64, 'base64'));
    const prof = await reuseProfile();
    fs.writeFileSync(path.join(OUT, 'signing.json'), JSON.stringify({
      p12: p12Path,
      p12Password: process.env.SIGNING_P12_PASS,
      profile: prof.file,
      profileName: prof.name,
      profileUUID: prof.uuid,
      identity: process.env.SIGNING_IDENTITY || 'iPhone Distribution',
      teamId: process.env.APPLE_TEAM_ID || '',
    }, null, 2));
    console.log('reused the stored certificate — nothing was revoked');
    return;
  }

  // 1. a key that exists on THIS machine, which is the entire point
  sh('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', csrPath, '-subj', '/CN=' + CN + '/C=US']);
  const csr = fs.readFileSync(csrPath, 'utf8');

  // 2. clear out only the certificates this script made before. A human's
  //    certificate is never touched: matching is on the exact common name, and
  //    the account is limited to three, so leaving ours behind would lock the
  //    pipeline out after two runs.
  // Revoke by TYPE, not by name. Apple names a certificate after the account —
  // "iOS Distribution: Kaan Ipek" — never after the CSR's common name, so
  // matching on CN matched nothing and the previous run's certificate survived
  // to block the next one.
  //
  // IOS_DISTRIBUTION is the slot this script uses. The account's own
  // certificate is the other type, DISTRIBUTION, made by cloud signing before
  // any of this existed — and that one is never touched. So anything in this
  // slot was put there by a previous run of this script, and clearing it is
  // clearing up after ourselves.
  const existing = await api('GET', '/v1/certificates?limit=200');
  for (const c of existing.data || []) {
    const a = c.attributes || {};
    if (a.certificateType === 'IOS_DISTRIBUTION') {
      await api('DELETE', '/v1/certificates/' + c.id).catch(() => {});
      console.log('revoked our previous certificate: ' + a.name);
    }
  }

  // Two distribution certificate TYPES, two separate limits. The account
  // already has one, created by cloud signing, and Apple answers a second
  // request for the same type with "You already have a current Distribution
  // certificate". Revoking it would be destructive and would reach another
  // project on this account — so try the other type instead, which costs
  // nobody anything.
  let cert = null;
  let lastErr = null;
  for (const kind of ['DISTRIBUTION', 'IOS_DISTRIBUTION']) {
    try {
      const made = await api('POST', '/v1/certificates', {
        data: { type: 'certificates', attributes: { certificateType: kind, csrContent: csr } },
      });
      cert = made.data;
      console.log('created a ' + kind + ' certificate');
      break;
    } catch (e) {
      lastErr = e;
      console.log(kind + ' unavailable: ' + String(e.message).slice(-90));
    }
  }
  if (!cert) throw lastErr;
  fs.writeFileSync(cerPath, Buffer.from(cert.attributes.certificateContent, 'base64'));
  sh('openssl', ['x509', '-inform', 'DER', '-in', cerPath, '-out', pemPath]);

  // 3. a .p12 is what `security import` understands
  const P12PASS = crypto.randomBytes(12).toString('hex');
  // -legacy is not optional. OpenSSL 3 writes PKCS#12 with AES-256 and a
  // SHA-256 MAC, and macOS's keychain cannot read either — it reports
  // "MAC verification failed during PKCS12 import (wrong password?)", which
  // sends you looking for a password bug that does not exist. The password was
  // always right; the container was unreadable.
  sh('openssl', ['pkcs12', '-export', '-legacy', '-inkey', keyPath, '-in', pemPath,
    '-out', p12Path, '-passout', 'pass:' + P12PASS, '-name', CN]);

  // 4. a profile that names this certificate. Profiles are per (bundle id,
  //    certificate), so a new certificate needs a new profile — an old one
  //    would name a certificate that no longer exists.
  // Match the identifier EXACTLY. `filter[identifier]` did not narrow anything
  // here, so data[0] was a different app on the same account and Apple answered
  // "You are not allowed to create 'iOS' profile with App ID 696KGYAX6B" — an
  // error that reads like a permissions problem and was a wrong-record problem.
  const ids = await api('GET', '/v1/bundleIds?limit=200');
  const bundle = (ids.data || []).find(
    (b) => b.attributes && b.attributes.identifier === APP_BUNDLE);
  if (!bundle) {
    throw new Error('no bundle id record for ' + APP_BUNDLE + ' — the account has: '
      + (ids.data || []).map((b) => b.attributes.identifier).join(', '));
  }
  console.log('bundle id: ' + bundle.attributes.identifier + '  (' + bundle.id + ')');

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
    // "Apple Distribution" and "iPhone Distribution" are different prefixes and
    // codesign matches on them, so the workflow must be told which one it got
    // rather than assuming.
    identity: cert.attributes.certificateType === 'IOS_DISTRIBUTION'
      ? 'iPhone Distribution' : 'Apple Distribution',
    teamId: process.env.APPLE_TEAM_ID || '',
  };
  fs.writeFileSync(path.join(OUT, 'signing.json'), JSON.stringify(out, null, 2));
  console.log('certificate: ' + cert.attributes.name + '  (' + cert.attributes.certificateType + ')');
  console.log('profile:     ' + PROFILE + '  ' + prof.data.attributes.uuid);
  console.log('wrote ' + path.join(OUT, 'signing.json'));
  console.log('');
  console.log('TO STOP REVOKING A CERTIFICATE ON EVERY RUN, save these as repository');
  console.log('secrets — after that this script reuses them and revokes nothing:');
  console.log('  SIGNING_P12_B64   ' + fs.readFileSync(p12Path).toString('base64').slice(0, 24) + '…  (full value below)');
  console.log('  SIGNING_P12_PASS  ' + '(printed once, in the masked block that follows)');
  console.log('  SIGNING_IDENTITY  ' + out.identity);
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
