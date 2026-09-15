# LUMEN — working notes

Neon gravity-flip arcade game. Vanilla JS + Canvas + Web Audio, **zero
dependencies**, PWA, wrapped for iOS/Android with Capacitor.

- Live web build: <https://kaanipek.github.io/lumen/> (GitHub Pages deploys on every push to `main`)
- Repo: `KaanIpek/lumen` — **public**, deliberately (free Pages hosting + free macOS CI runner)
- Package: `com.rldgames.lumen` (Android) / bundle `com.lumen.game` (iOS) · Play app `4973199188286450484` · ASC app `6797276640`

State below was measured on **2026-09-15**, not assumed. Anything marked
*last known* was not re-checked; verify before acting on it. **This file records
a state, and state expires.**

---

## Where we are

| | |
|---|---|
| Web | 1.0.6 live, includes ghost racing |
| App Store | **1.0.6 (build 97) READY_FOR_SALE** — ASC API, 15 Sep |
| Play closed testing | 97 (1.0.6) on Alpha, full rollout, 177/177 countries — console, 15 Sep |
| Play production | Access **GRANTED** (dashboard, seen 15 Sep). 97 (1.0.6) promoted with 177 countries and **in review since 15 Sep** (quick checks passed). Managed publishing is off, so approval = live. |
| Play internal testing | 85 (1.0.1) plus an empty Draft. Stale, nobody's work, harmless |
| Tests | 337, all green |
| Content | 13 modes, 23 worlds, 16 signatures (derive these, never quote from memory) |

`release.json` reads `version 1.0.6, build 97, iosBuild 97, androidBuild 97`
(`c24d4a2`, confirmed live on Pages). Until production is approved the public
Play URL is a 404 and the only Android players are testers, who are offered 97.

---

## Next tasks, in order

1. **Watch the production review.** "Reviews are typically completed within 7
   days." Publishing overview shows it; so does the public listing going from
   404 to 200 (`curl -s -o /dev/null -w "%{http_code}"` on the Play URL).
2. **Once production is live:** link the Play listing in AdMob. That is what
   lifts LUMEN Android out of *Limited ad serving*, and it cannot be done while
   the listing is not public — tried 15 Sep: AdMob's Play search answers "Can't
   find your app?" for `com.rldgames.lumen`. The path is Apps → **LUMEN
   (Android, `~7519300859`)** → *Add store*. Do **not** use *Apps to confirm →
   Finish setup*: that is `/apps/create`, a second AdMob app with a new id that
   the binary does not use, so the real one would stay limited. LUMEN iOS
   (`~9285134085`) is already Ready and linked.
3. **AdMob payout** — identity verification and bank details are both incomplete,
   and there is a $10 threshold. This one is the owner's to do, not ours.
4. **Play promotional video** — blocked twice over: the field takes a YouTube URL
   only, the owning Google account's Studio access is blocked by a channel-appeal
   interstitial, and all four videos we have are **vertical** (1080×1920 /
   886×1920) while Play's frame is landscape. Needs a landscape cut and a working
   channel.

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
would change nothing. Read AdMob *requests* as sessions: `Ads.preload()` fires
on boot, on every foreground and after every ad, so a week of 1 request is a
week of about one launch, not a broken SDK. (Checked 15 Sep when requests fell
from 72 to 2 a week across both platforms: ads code unchanged since 26 Aug, and
build 97's CI log lists the ads plugin on both.)

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
refuses to measure a zero-width window and reports itself as failed. The
desktop app's own Browser pane reports `innerWidth` 0 while it is hidden, which
gives exactly that "1 of 337 FAILED"; emulate a 1280×900 viewport first.

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
- closed testing (Alpha): `/app/<id>/tracks/4698973344213237434`
- production: `/app/<id>/tracks/production` (track id `4697841224391315890`)
- all tracks at a glance: `/app/<id>/releases/overview`
- bundle library: `/app/<id>/bundle-explorer-selector`
- publishing overview: `/app/<id>/publishing`

**The publishing overview is SHARED.** Submitting there sends *everything*
pending, including another session's half-finished work. Read every row first.

**`/u/N` is not stable.** The account index shifts; if the console 404s or shows
a terms page, try `/u/1`. On 15 Sep the console was `/u/1` (developer
`8639829071472741025`); `/u/0` is `rldgameslumen@outlook.com`, which has no
developer account and lands on a "create a developer account" page. AdMob is
the same: `?authuser=1`. Without it AdMob opens a **sign-up form with terms to
accept** — a new, empty account. Never fill it in.

**Promoting to production** is Alpha → *Promote release* → Production → Next →
Save → publishing overview → Submit. Production has its **own** country list
and starts empty; adding countries there is flagged "affects other tracks"
because Open testing shares production's targeting. The one warning on 97 —
"no deobfuscation file" — is expected (the game is JS in a WebView, there is
no R8 mapping) and does not block.

**The console lies about geometry.** Menu items report `height: 0` and buttons
report coordinates tens of pixels off. When a click does nothing, screenshot and
click what you can see.

---

## Moving to another machine

`git clone` gets almost everything, including `config.js`. What does **not**
travel:

- **The Apple ASC key** — `AuthKey_HM6QQBPLWW.p8`, outside the repo. On the
  current machine it is `D:\cowork\_secrets\home\Documents\Apple Developer Keys\`,
  **not** the profile's Documents. Never commit it; the ASC tools take the
  *path*. Key id `HM6QQBPLWW`, issuer `4ed2d86a-7565-4cb4-8095-8d40ec6b60b9`.
- **Folder ownership.** D: came across with the old machine's owner SID, so git
  refuses the repo as "dubious ownership". `git -c safe.directory=D:/cowork/Lumen
  <cmd>` works per command without touching global config.
- **Browsers.** The Claude desktop Browser pane is not signed in to Google. Play
  Console work goes through Claude in Chrome; three extension instances are
  connected with generic names, and on 15 Sep the signed-in one was "Browser 1"
  (`6f55b314-ef4f-4698-b147-9334b618f4da`).
- `work/`, `build-out/`, `review/`, `docs/LAUNCH.md`, `docs/STORE_LISTING.md` —
  gitignored on purpose (scratch, binaries, recordings, commercial notes).
- `node_modules/`, `dist/`, `mobile/www/`, `mobile/android|ios/` — all regenerated
  (`node mobile/sync-web.js`, `node tools/build-web.js`).

GitHub Actions secrets (the Android keystore, the ASC key) live on GitHub and
follow the repo, so CI needs nothing on the new machine.
