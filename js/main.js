/*
 * LUMEN — bootstrap
 */
(function () {
  'use strict';
  const LUMEN = window.LUMEN;

  // The manifest advertises a "Daily Challenge" shortcut pointing at
  // ?mode=daily, and nothing was reading it — the shortcut dropped you on the
  // plain menu. Now it works, and the same hook gives every game mode a link
  // (?mode=vortex), which is what a Steam launch option or a shared URL needs.
  function openDeepLink(game) {
    let q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    const want = (q.get('mode') || '').toLowerCase();
    if (!want) return;
    if (want === 'daily') { game.startDaily(); return; }
    if (want === 'tutorial') { game.startTutorial(); return; }
    if (LUMEN.Modes && LUMEN.Modes.def(want).id === want) {
      LUMEN.Modes.setCurrent(want);
      LUMEN.UI.refreshMenu();
      if (q.get('play') !== null) game.start();
    }
  }

  // Steam Cloud, on first launch on a new machine. The rule is deliberately
  // conservative: the cloud only wins when there is nothing to lose locally.
  // Silently overwriting a save that has more progress than the cloud copy is
  // the single worst thing a sync can do, so we simply never do it — a player
  // with progress on both sides keeps this device's and can merge by hand with
  // the transfer code in Settings.
  function adoptCloudSave() {
    if (!LUMEN.Steam || !LUMEN.Steam.available || !LUMEN.Save) return;
    const remote = LUMEN.Steam.cloudLoad();
    if (!remote) return;
    const here = LUMEN.Store.runs > 0 || LUMEN.Store.best > 0 || LUMEN.Store.shards > 0;
    if (here) return;
    const info = LUMEN.Save.describe(remote);
    if (!info) return;
    LUMEN.Save.apply(remote);
  }

  // A score is only meaningful against the course that produced it.
  //
  // The mode and difficulty gap multipliers had never actually reached a spawned
  // gate: PRECISION advertised 0.55 and played at 1.0, ZEN advertised 1.5, and
  // both difficulty settings did nothing to the openings. Fixing that changed
  // every mode and both difficulties at once, so records set before it are
  // records from a different game — PRECISION in particular was Classic with
  // more reaction time, paying 1.7x for it.
  //
  // So the scores go, once, and NOTHING else does: shards, unlocks, cosmetics,
  // items, skills, achievements, language and every accessibility setting all
  // survive. The stamp means it happens exactly once per device, and a player
  // arriving fresh after this build never sees it at all.
  const BALANCE_STAMP = 'lumen_balance_2026_07';
  function retireStaleRecords() {
    try {
      if (localStorage.getItem(BALANCE_STAMP)) return;
      localStorage.setItem(BALANCE_STAMP, '1');
      const S = LUMEN.Store;
      if (!S) return;
      const hadAny = (S.best | 0) > 0 || Object.keys(S.modeBests || {}).length > 0;
      S.best = 0;
      S.modeBests = {};
      S.bestCombo = 0;
      if (LUMEN.Scores) LUMEN.Scores.clear();
      if (hadAny) {
        // eslint-disable-next-line no-console
        console.info('[LUMEN] scores reset once: the gap multipliers now reach the corridor, '
          + 'so older records are not comparable. Progress and purchases are untouched.');
      }
    } catch (e) { /* a locked storage is not worth a crash */ }
  }

  // Read config.js if the build has one. Everything here is optional: a missing
  // file, missing keys or empty strings all leave the game exactly as it ships,
  // with the board off and nothing contacted.
  function applyConfig() {
    const c = LUMEN.CONFIG;
    if (!c || !LUMEN.Leaderboard) return;
    if (c.supabaseUrl && c.supabaseAnonKey) {
      LUMEN.Leaderboard.useSupabase(c.supabaseUrl, c.supabaseAnonKey);
    } else if (c.leaderboardEndpoint) {
      LUMEN.Leaderboard.endpoint = c.leaderboardEndpoint;
    }
    // The next-update vote rides the same Supabase project as the board. No
    // poll in the config means no button, no screen and no requests.
    if (LUMEN.Poll && c.supabaseUrl && c.supabaseAnonKey) {
      LUMEN.Poll.configure(c.supabaseUrl, c.supabaseAnonKey);
      if (c.poll && c.poll.id && (c.poll.options || []).length) LUMEN.Poll.current = c.poll;
      LUMEN.UI.refreshPoll && LUMEN.UI.refreshPoll();
    }
    // Fetch both boards once, now, while the player is still reading the menu.
    // By the time they open the screen it is already there, and it costs them
    // nothing if they never do. Deliberately after the first frame so it cannot
    // hold up the boot.
    if (LUMEN.Leaderboard.enabled) {
      setTimeout(() => LUMEN.Leaderboard.prefetch(), 400);
    }
  }

  // Each world claims its recorded piece. Nothing here is required: a file that
  // is missing or fails to decode leaves that world on the generated score, so
  // the game is never silent and never blocks on a download.
  function registerSoundtrack() {
    const M = LUMEN.Audio && LUMEN.Audio.music;
    if (!M || !M.useTrack) return;
    ['deepfield', 'emberfall', 'tidal', 'moss', 'monolith', 'solaris']
      .forEach((id) => M.useTrack(id, 'assets/music/' + id + '.mp3'));
  }

  function boot() {
    const canvas = document.getElementById('game');
    const game = new LUMEN.Game(canvas);
    LUMEN.game = game;
    // pick a graphics tier before the first frame so we never boot at 4K on a phone
    LUMEN.applyQuality(LUMEN.Store.quality || 'auto', true);
    // language first, so the very first render of the menu is already translated
    if (LUMEN.i18n) LUMEN.i18n.set(LUMEN.i18n.detect());
    // Before the menu paints, not after: this clears the very numbers the menu
    // is about to draw, and running it second left the old best on screen until
    // something else happened to refresh it.
    retireStaleRecords();
    LUMEN.UI.init(game);
    applyConfig();
    registerSoundtrack();
    // Steam, when we're inside the desktop build. Before the UI settles, because
    // a cloud save may replace everything the menu is about to draw.
    adoptCloudSave();
    // ...and the save that just landed may predate the rebalance.
    //
    // Fresh machine, cloud copy made before the update: the wipe above found an
    // empty profile, stamped it, and THEN the old records arrived — permanently
    // stamped as already-retired. It self-heals because Save.apply() clears
    // every lumen* key (the stamp included) and writes back only what the
    // payload carried, so a pre-migration payload leaves no stamp and this
    // second call does the work. A save made after the update carries the stamp
    // and this returns immediately.
    retireStaleRecords();
    LUMEN.Steam && LUMEN.Steam.init();
    LUMEN.Native && LUMEN.Native.init();
    game.run();
    openDeepLink(game);

    // If a webfont is loading, redraw once it's ready so canvas metrics update.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { /* next frame re-renders with real font */ });
    }

    // Ask the browser to keep our storage. Safari evicts non-persistent origins
    // after ~7 idle days, which would silently wipe a player's best score, shards,
    // unlocks and daily streak. Requires a prior user gesture on some browsers, so
    // try now and again on the first interaction.
    const askPersist = () => {
      try {
        if (navigator.storage && navigator.storage.persist && navigator.storage.persisted) {
          navigator.storage.persisted().then((already) => {
            if (!already) navigator.storage.persist().catch(() => {});
          }).catch(() => {});
        }
      } catch (e) {}
    };
    askPersist();
    window.addEventListener('pointerdown', askPersist, { once: true });

    // Register the service worker for offline / installable PWA (http(s) only).
    //
    // NOT on localhost. The worker caches by exact URL, so during development it
    // will happily serve the build from ten minutes ago while you are looking at
    // the file you just saved — and you end up debugging code that is not
    // running. Offline support is worth nothing on a dev machine and costs real
    // time, so the trap is simply removed there. `?nosw` disables it anywhere.
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')
      && !isLocal && !location.search.includes('nosw')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    } else if ('serviceWorker' in navigator && isLocal) {
      // and clear out any worker a previous visit left behind
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
