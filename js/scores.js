/*
 * LUMEN — local run history
 * -------------------------------------------------------------
 * The player's own runs, on-device. No backend, no account, no
 * network — it just gives every run something to beat besides
 * the single all-time best.
 *
 * Two different numbers, on purpose:
 *   SHOW   how many appear on the MY RUNS board (the best ones)
 *   KEEP   how many are stored at all (the most RECENT ones)
 *
 * Storing only the top ten meant one good week early on locked the board
 * forever and you could never see how you are playing NOW. Keeping the last
 * fifty shows current form — and the all-time best is pinned, so improving your
 * recent scores can never quietly erase the run you are proudest of.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Store = LUMEN.Store;
  const SHOW = 10;
  const KEEP = 50;

  // COERCE, do not merely filter. These rows look like our own data but a
  // transfer code writes straight into localStorage, so every field arrives
  // from whoever authored the code. Forcing each one to its type here means
  // nothing downstream — renderers included — has to remember to be careful.
  const clean = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((e) => e && typeof e === 'object' && isFinite(+e.s))
    .map((e) => ({
      s: Math.max(0, Math.floor(+e.s) || 0),
      c: Math.max(0, Math.floor(+e.c) || 0),
      d: String(e.d == null ? '' : e.d).slice(0, 10),
      t: Math.max(0, Math.floor(+e.t) || 0),
      m: String(e.m == null ? '' : e.m).slice(0, 16),
    }));

  // Rows saved before this file knew about modes have no `m`. They were only
  // ever written by Classic, so that is what they are — guessing anything else
  // would relabel a player's own history.
  const modeOf = (e) => e.m || 'classic';

  const Scores = {
    MAX: SHOW,      // kept: other modules read this
    SHOW,
    KEEP,

    // best first — this is a board, not a log.
    //
    // `mode` filters to one game. MY RUNS passes nothing, because a player's own
    // history is every run they played; ranking passes 'classic', because a
    // Sprint score and a Classic score answer different questions and a rank
    // across both means nothing.
    list(mode) {
      const all = clean(Store.scores);
      const rows = mode ? all.filter((e) => modeOf(e) === mode) : all;
      return rows.sort((a, b) => b.s - a.s).slice(0, SHOW);
    },

    // everything still stored, newest first
    history() {
      return clean(Store.scores).slice().sort((a, b) => (b.t || 0) - (a.t || 0));
    },

    // Where a score WOULD place (1-based) on the shown board, or 0 if it misses.
    rankOf(score, mode) {
      const l = this.list(mode);
      let rank = 1;
      for (const e of l) { if (e.s > score) rank++; }
      return rank <= SHOW ? rank : 0;
    },

    record(score, combo, mode) {
      if (!(score > 0)) return 0;
      const rank = this.rankOf(score, mode);
      const d = new Date();
      const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      // "Newest" has to be an ordering we can trust. The wall clock is not one:
      // two runs finishing in the same millisecond tie, and a system clock moved
      // backwards would make new runs look old and get them thrown away first.
      // So the stamp only ever moves forward, whatever the clock says.
      const prev = clean(Store.scores);
      let newest = 0;
      for (const e of prev) if ((e.t || 0) > newest) newest = e.t || 0;
      const entry = { s: Math.floor(score), c: combo || 0, d: stamp,
                      t: Math.max(Date.now(), newest + 1), m: String(mode || 'classic') };

      const all = prev.concat([entry]);
      // the one run to protect, whatever else happens
      let best = all[0];
      for (const e of all) if (e.s > best.s) best = e;

      // Keep the newest KEEP. Entries saved before this file recorded a
      // timestamp sort as oldest, which is the right guess for them.
      const kept = all.slice().sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, KEEP);
      // if the all-time best aged out of that window, put it back in place of
      // the oldest run we were about to keep
      if (kept.indexOf(best) === -1) kept[kept.length - 1] = best;

      Store.scores = kept;
      return rank;
    },

    clear() { Store.scores = []; },
  };

  LUMEN.Scores = Scores;
})();
