/*
 * Hand the build that was just uploaded to the internal TestFlight group.
 *
 *   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=… node tools/asc-assign-build.js
 *
 * WHY THIS EXISTS
 *   `altool --upload-app` puts a build in App Store Connect and stops there. A
 *   build nobody is assigned to is a build nobody can install: it sits in the
 *   account, VALID and invisible, while the tester's phone keeps offering the
 *   previous one.
 *
 *   That happened twice here, and both times the person who noticed was the
 *   person waiting for the update — they reported bugs against code that had
 *   already been fixed, because the fix was in a build their phone had never
 *   been offered. A step a human has to remember after every upload is a step
 *   that will be forgotten, and its failure mode is silent.
 *
 *   THE ORDER MATTERS. Apple's /v1/apps/{id}/builds does not promise a sort —
 *   it returned 2, 3, 1 on this account. Taking data[0] as "newest" is what
 *   caused the first miss: it looked at an older build, saw it was already
 *   assigned, and did nothing. Sort by uploadedDate.
 */
'use strict';
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const APP_ID = process.env.ASC_APP_ID || '6797276640';
const GROUP = process.env.ASC_GROUP || 'Internal';

function derToJose(der) {
  let o = 2, len = der[1];
  if (len & 0x80) o += len & 0x7f;
  const read = () => {
    const l = der[o + 1]; let s = o + 2; const e = s + l;
    while (der[s] === 0 && e - s > 32) s++;
    const b = Buffer.alloc(32);
    der.copy(b, 32 - (e - s), s, e);
    o = e;
    return b;
  };
  return Buffer.concat([read(), read()]);
}
function token() {
  const missing = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH'].filter((k) => !process.env[k]);
  if (missing.length) throw new Error('missing env: ' + missing.join(', '));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' });
  // No `scope`: present, it RESTRICTS the token to the routes listed, and this
  // script needs several.
  const body = b64({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 20 * 60,
                     aud: 'appstoreconnect-v1' });
  const sg = crypto.createSign('SHA256');
  sg.update(head + '.' + body);
  return head + '.' + body + '.'
    + derToJose(sg.sign(fs.readFileSync(process.env.ASC_KEY_PATH, 'utf8'))).toString('base64url');
}

let JWT = null;
function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.appstoreconnect.apple.com', path, method,
      headers: {
        Authorization: 'Bearer ' + JWT, 'User-Agent': 'lumen-assign',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => (res.statusCode >= 400
        ? reject(new Error(method + ' ' + path + ' -> ' + res.statusCode + ' ' + s.slice(0, 240)))
        : resolve(s ? JSON.parse(s) : {})));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  JWT = token();

  // Resolve the group FIRST, because what it already offers is how we recognise
  // the build that was just uploaded.
  let groups = await api('GET', '/v1/apps/' + APP_ID + '/betaGroups?limit=20');
  let group = (groups.data || []).find((g) => g.attributes.name === GROUP)
    || (groups.data || []).find((g) => g.attributes.isInternalGroup);
  if (!group) {
    const made = await api('POST', '/v1/betaGroups', {
      data: { type: 'betaGroups', attributes: { name: GROUP, isInternalGroup: true },
              relationships: { app: { data: { type: 'apps', id: APP_ID } } } },
    });
    group = made.data;
    console.log('created the ' + GROUP + ' group');
  }

  const already = await api('GET', '/v1/betaGroups/' + group.id + '/builds?limit=50');
  const assigned = new Set((already.data || []).map((b) => b.id));

  // Now wait for a build the group does NOT already have.
  //
  // Sorting by uploadedDate was necessary and still not enough: this runs
  // seconds after altool returns, and Apple has not always created the record
  // yet. "Newest" was therefore the PREVIOUS build — already assigned — so the
  // script printed "nothing to do" and exited 0. The step went green, the phone
  // kept offering the old build, and the person who found out was the tester.
  //
  // Membership is the signal that cannot lie: a build that was just uploaded is
  // by definition not in the group yet. And if nothing new ever shows up, say so
  // with a non-zero exit — a silent success is worse than a red step, because
  // only one of the two gets looked at.
  //
  // Better still: do not infer at all. The workflow reads CFBundleVersion out of
  // the .ipa it just uploaded and passes it here, so the build can be NAMED.
  // Guessing failed on runs 62 and 63 — Apple returned a page of twenty builds
  // in no promised order, the newest one was not on it, and the script settled
  // on build 32, then failed the job trying to assign a build that old. The
  // upload had been fine both times; only this step was wrong.
  const WANT = process.env.ASC_BUILD_VERSION || '';
  if (WANT) console.log('looking for build ' + WANT);

  let build = null;
  for (let i = 0; i < 40; i++) {                       // ~20 minutes
    const r = WANT
      ? await api('GET', '/v1/builds?filter[app]=' + APP_ID +
                  '&filter[version]=' + encodeURIComponent(WANT) + '&limit=1')
      : await api('GET', '/v1/apps/' + APP_ID + '/builds?limit=20');
    build = WANT
      ? (r.data || [])[0] || null
      : [...(r.data || [])]
        .filter((b) => !assigned.has(b.id))
        .sort((a, b) => new Date(b.attributes.uploadedDate) - new Date(a.attributes.uploadedDate))[0] || null;
    if (build && assigned.has(build.id)) {
      console.log('build ' + build.attributes.version + ' is already in "' + group.attributes.name + '"');
      return;
    }
    if (!build) {
      console.log('the upload has not appeared in App Store Connect yet');
    } else {
      const state = build.attributes.processingState;
      console.log('build ' + build.attributes.version + ': ' + state);
      if (state === 'VALID') break;
      if (state === 'FAILED' || state === 'INVALID') throw new Error('build ' + state);
    }
    await sleep(30000);
  }
  if (!build || build.attributes.processingState !== 'VALID') {
    throw new Error('no new build reached VALID within 20 minutes — assign it by hand');
  }

  await api('POST', '/v1/betaGroups/' + group.id + '/relationships/builds',
            { data: [{ type: 'builds', id: build.id }] });

  // Say what a tester will actually see, not merely that a request returned 204.
  const after = await api('GET', '/v1/betaGroups/' + group.id + '/builds?limit=20');
  console.log('assigned build ' + build.attributes.version + ' to "' + group.attributes.name + '"');
  console.log('group now offers: ' + (after.data || []).map((b) => b.attributes.version).join(', '));
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
