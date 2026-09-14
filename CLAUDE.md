# LUMEN — working notes

Neon gravity-flip arcade game. Vanilla JS + Canvas + Web Audio, **zero
dependencies**, PWA, wrapped for iOS/Android with Capacitor.

- Live web build: <https://kaanipek.github.io/lumen/> (GitHub Pages deploys on every push to `main`)
- Repo: `KaanIpek/lumen` — **public**, deliberately (free Pages hosting + free macOS CI runner)
- Package: `com.rldgames.lumen` · Play app `4973199188286450484` · ASC app `6797276640`

State below was measured on **2026-09-14**, not assumed. Anything marked
*last known* was not re-checked; verify before acting on it. **This file records
a state, and state expires.**

---

## Where we are

| | |
|---|---|
| Web | 1.0.6 live, includes ghost racing |
| App Store | **1.0.6 (build 97) READY_FOR_DISTRIBUTION** — verified today |
| Play closed testing | 97 (1.0.6) — *last known* live on the Alpha track |
| Play production access | Applied **2026-09-06 21:47**. Google said ≤7 days. **Decision is due — check first.** |
| Tests | 337, all green |
| Content | 13 modes, 23 worlds, 16 signatures (derive these, never quote from memory) |

`release.json` currently reads `version 1.0.6, build 92, iosBuild 96, androidBuild 92`.

---

## Next tasks, in order

1. **Check the Play production decision.** Applied 6 Sep, ≤7 days promised, so it
   has landed one way or the other. Console → Dashboard → Production.
2. **`release.json` iosBuild 96 → 97.** iOS 1.0.6 is live on build 97, so 96 now
   understates it. Do the same for `androidBuild` **only after confirming** what
   Play actually serves. The rule below is not optional.
3. **If production access is granted:** promote to production, then link the Play
   listing in AdMob. That is what lifts LUMEN Android out of *Limited ad serving*.
4. **AdMob payout** — identity verification and bank details are both incomplete,
   and there is a $10 threshold. This one is the owner's to do, not ours.
5. **Play promotional video** — blocked twice over: the field takes a YouTube URL
   only, the owning Google account's Studio access is blocked by a channel-appeal
   interstitial, and all four videos we have are **vertical** (1080×1920 /
   886×1920) while Play's frame is landscape. Needs a landscape cut and a working
   channel.
6. **Intermittent trap bug** — 'Traps: nothing collectable is ever parked inside a
   lethal trap' still fails roughly one run in five on `tidal`, reported as
   "mote/mine on-gate". Commit `eeb4956` fixed one cause; it was not the only one.
   Look at the gate-arrives-beside-an-existing-trap path, not the reservation
   band again.

---

## Decisions already made — do not relitigate

**No real-time versus multiplayer.** One player dies at 20 seconds, the other at
3 minutes; the rest of the "match" is one person alone. Ghost racing replaces it.

**THE CHASE is pace-first on purpose.** The daily board held 5 rows in the game's
entire life and the next-update poll has 0 votes. Getting onto the board costs an
account **and** a name **and** an explicit consent tick. So the target is your own
pace, and the named-rival path switches itself on the day real people appear. The
rung ladder / mercy demotion from the original spec were deliberately **not**
built — they are tuning for a population that does not exist.

**Ghost racing records POSITIONS, not inputs.** The physics is semi-implicit
Euler over a variable step, so identical taps at 60fps and 30fps land in
different places (~2% of the playfield per crossing), and any later gravity tweak
would invalidate every ghost ever shared. Positions are stored as a **fraction of
playH** (pixels mean different things on a notched phone) and sampled against
`elapsed` (scaled game time), never the wall clock.

**The ghost link carries the DATE.** `todayStr()` is built from local date parts,
so two friends either side of midnight are on different courses. Without the date
they would race different corridors and neither could tell. `startDaily(dateStr)`
and `Daily.seedFor/twistFor` exist for this.

**base64url is mandatory in the link.** `URLSearchParams.get()` decodes `+` as a
space, and standard base64 emits `+` for about one byte in 42 — every ghost would
be silently corrupted into plausible-looking numbers.

**Ads are rewarded and opt-in only, by design.** No banners, no interstitials —
it is a selling point in the store copy. Low ad revenue is therefore a *volume*
problem, not a setup problem: match rate is 100% and eCPM is $3.17, so mediation
would change nothing.

**A transfer code carries progress, never identity.** `lumen_session` holds
Supabase access + refresh tokens; `export()` filters them out and `parse()` strips
them from incoming codes rather than rejecting the code.

**`config.js` is committed on purpose.** The Supabase key is the publishable one
(RLS is what protects the table) and the AdMob ids ship inside the binary anyway.

---

## House rules that keep biting

**Derive the content counts from source, never from memory.** The store copy said
"20 worlds" when there were 23, and called Aloft a world when it is a mode.

```
node -e "const f=require('fs');
 console.log('modes', [...f.readFileSync('js/modes.js','utf8').matchAll(/id:\s*'([a-z0-9]+)'/g)].length);
 const c=f.readFileSync('js/cosmetics.js','utf8'), s=c.indexOf('const MAPS = ['), e=c.indexOf('\n  ];', s);
 console.log('worlds', [...c.slice(s,e).matchAll(/\bid:\s*'([a-z0-9]+)'/g)].length);"
```

**`release.json` must never name a build nobody can install.** Advertising one
sends every player to a store that says they are current, and says it again
tomorrow — a loop they cannot leave. Bump *after* the binary is live, per
platform, and read the store to confirm rather than assuming the submission
landed.

**Measure store copy before pasting it.** Play release notes are 500 characters
*per language*; the Play production form is 300 per answer; Apple's subtitle and
name are 30. Every one of these has been hit.

**Run the suite in a real viewport.** `node tools/serve.js 5178` then
`http://localhost:5178/tests/` in a window wider than 200px — the layout test
refuses to measure a zero-width window and reports itself as failed.

---

## How a release actually ships (it is half manual)

The GitHub `mobile` workflow builds and signs, then uploads the .aab as a
**GitHub artifact**. There is no Play service account in the repo, so:

```
gh workflow run mobile --field platform=android   # or ios, or both
gh run download <id> -n android                   # .aab lands in build-out/
```

The **owner uploads the .aab by hand** — `file_upload` caps at 10 MB and the
bundle is ~16 MB. Everything after that (Add from library, release notes,
review, submit) can be driven.

iOS is different: the workflow uploads to App Store Connect itself, and the
version/build/notes/submission are all doable through the ASC API
(`tools/asc.js`, `tools/asc-preview.js`).

**Play Console paths that work** (the obvious guesses 404):
- track: `/app/<id>/tracks/4698973344213237434`
- bundle library: `/app/<id>/bundle-explorer-selector`
- publishing overview: `/app/<id>/publishing`

**The publishing overview is SHARED.** Submitting there sends *everything*
pending, including another session's half-finished work. Read every row first.

**`/u/N` is not stable.** The account index shifts; if the console 404s or shows
a terms page, try `/u/1`.

**The console lies about geometry.** Menu items report `height: 0` and buttons
report coordinates tens of pixels off. When a click does nothing, screenshot and
click what you can see.

---

## Moving to another machine

`git clone` gets almost everything, including `config.js`. What does **not**
travel:

- **The Apple ASC key** — `AuthKey_HM6QQBPLWW.p8`, currently outside the repo in
  `Documents/Apple Developer Keys/`. Never commit it; the ASC tools take the
  *path*. Key id `HM6QQBPLWW`, issuer `4ed2d86a-7565-4cb4-8095-8d40ec6b60b9`.
- `work/`, `build-out/`, `review/`, `docs/LAUNCH.md`, `docs/STORE_LISTING.md` —
  gitignored on purpose (scratch, binaries, recordings, commercial notes).
- `node_modules/`, `dist/`, `mobile/www/`, `mobile/android|ios/` — all regenerated
  (`node mobile/sync-web.js`, `node tools/build-web.js`).

GitHub Actions secrets (the Android keystore, the ASC key) live on GitHub and
follow the repo, so CI needs nothing on the new machine.
