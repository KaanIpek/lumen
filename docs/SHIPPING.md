# Shipping LUMEN — Steam and mobile

The game is one codebase. `index.html` is the whole thing; the desktop and
mobile builds are thin shells around exactly those files. **Never fork the game
folder for a platform** — a fix to the corridor has to be a fix everywhere.

Everything below is split into two lists: what is already built and working, and
what genuinely cannot be done without your accounts, your money, or your Mac.

---

## Steam / desktop

### Built and working

- `desktop/main.js` — Electron shell. Real window, real fullscreen (F11), single
  instance, external links open in the browser instead of replacing the game.
- `desktop/preload.js` — the only bridge between the page and Electron. Context
  isolation on, node integration off, five explicitly-listed calls.
- `js/steam.js` — the game's side of it. Achievements, leaderboards and Steam
  Cloud. **Inert on the web**, so nothing changes for browser players.
- Achievement ids are generated from the game's own list: `flow2` → `ACH_FLOW2`.
  You never maintain two lists.
- Steam Cloud stores the same transfer string as the in-game code, so there is
  one save format and one thing that can break.
- Cloud restore is deliberately one-way-safe: the cloud only wins on a device
  with **no local progress**. It will never silently overwrite a save that has
  more in it than the cloud copy.

### Run it now

```bash
cd desktop
npm install
npm start
```

That works today, without Steam, without an account. `steam_appid.txt` holds
`480` (Valve's public test app) so `steamworks.js` can initialise locally.

### Build a distributable

```bash
cd desktop
npm run dist:win      # or dist:mac / dist:linux
```

Output lands in `desktop/dist/`. The target is `dir` on purpose — Steam wants a
folder of files to upload, not an installer.

### What only you can do

1. **Steam partner account + app.** $100 USD per app, one-off, refundable
   against revenue. Your existing AppID belongs to a different game and cannot
   be reused for this one.
2. **Put the real AppID in `desktop/steam_appid.txt`.** Everything else reads it
   from there.
3. **Install the native module:** `npm install steamworks.js`. It is listed as
   an *optional* dependency so the build still runs without it.
4. **Create the achievements in the Steamworks partner site.** 26 of them, API
   name = the game's own id, uppercased, with an `ACH_` prefix:

   ```
   ACH_FIRSTLIGHT  ACH_SCORER1  ACH_SCORER2  ACH_SCORER3
   ACH_CHAIN1      ACH_CHAIN2   ACH_CHAIN3
   ACH_FLOW1       ACH_FLOW2    ACH_FLOW3
   ACH_ENDURE1     ACH_ENDURE2  ACH_ENDURE3   ACH_PHOENIX
   ACH_MOTES1      ACH_MOTES2   ACH_MOTES3
   ACH_CLOSE1      ACH_CLOSE2
   ACH_RUNS1       ACH_RUNS2    ACH_RUNS3
   ACH_STREAK1     ACH_STREAK2  ACH_CURATOR   ACH_CURATOR2
   ```

   The display name and description for each are already written and translated
   into four languages — they are the `ach_*` keys in `js/i18n.js`.
5. **Create two leaderboards** named `ALLTIME` and `DAILY`, sort descending,
   display Numeric.
6. **Store art.** Steam will not accept the build without it:
   | Asset | Size |
   | --- | --- |
   | Header capsule | 460×215 |
   | Small capsule | 231×87 |
   | Main capsule | 616×353 |
   | Vertical capsule | 374×448 |
   | Page background | 1438×810 |
   | Library capsule | 600×900 |
   | Library hero | 3840×1240 |
   | Library logo | 1280×720 (transparent) |
   `assets/icon-1024.png` and the screenshots in `assets/` are a starting point,
   but capsules need real layout work — they are marketing, not screenshots.
7. **Upload** with SteamPipe (`steamcmd`), and fill in the store page, age
   rating, and the tax/banking forms.

---

## Mobile (Android + iOS)

### Built and working

- `mobile/sync-web.js` — copies the game into `mobile/www`, deliberately leaving
  out the service worker (it caches a copy of a copy inside a WebView and then
  serves a stale build after an update) and the dev cheats.
- `mobile/capacitor.config.json` — app id, splash, status bar, no scroll bounce.
- `js/native.js` — Android **back button** behaves properly: closes a shop or a
  panel, pauses a run, and only exits from the menu itself. Without this, back
  killed the app from anywhere, which reads as a crash.
- Icons for every size a store asks for are in `assets/`, including proper
  **maskable** variants with an Android safe zone (the previous ones reused the
  full-bleed art and got cropped).
- Touch targets are all ≥44px. Safe areas, haptics and portrait/landscape were
  already handled.

### Build it

```bash
cd mobile
npm install
npm run sync
npm run add:android      # once
npm run open:android     # opens Android Studio
```

iOS is the same with `add:ios` / `open:ios`, **but it needs a Mac** — Xcode does
not exist on Windows, and there is no way around that.

### What only you can do

1. **Google Play** — developer account, $25 one-off. Signing key, store listing,
   content rating questionnaire, data-safety form, and a **publicly reachable
   privacy policy URL** (`privacy.html` is written; it needs hosting).
2. **Apple** — Apple Developer Program, $99/year, and a Mac for Xcode.
3. **Screenshots per device class** — Play wants phone + 7" + 10"; Apple wants
   6.7" and 5.5". The in-game screenshots are 16:9 and will need re-shooting at
   those aspect ratios.

---

## Before every release

```bash
node tools/bump-version.js     # stamps ?v= on assets and the SW cache name
```

Then open `tests/index.html` — **all green means shippable.** (168 at the
time of writing; the number only ever goes up, so check the failure count, not
the total.)

Skipping the version bump is how returning players end up running half the old
build and half the new one.

---

## The honest status

| | State |
| --- | --- |
| Game | Finished and tested |
| Desktop shell | Runs today (`npm start`) |
| Steam integration | Written; needs a real AppID + the native module |
| Android shell | Builds today |
| iOS shell | Configured; needs a Mac |
| Store accounts, art, forms, uploads | Yours — none of it can be done from here |
| Online leaderboard | Client + server written; **needs hosting** (see `server/README.md`) |
