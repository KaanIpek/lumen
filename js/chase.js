/*
 * LUMEN — THE CHASE
 * -------------------------------------------------------------
 * A daily run with a number to catch, and a moment when you catch it.
 *
 * WHAT THIS IS FOR
 *   A score by itself is a number you compare to nothing. The daily already
 *   gives every player on a date the same course, so the only thing missing was
 *   somebody to be ahead of you on it. This picks that somebody — one target,
 *   named, chosen once and held for the whole calendar day — and the run then
 *   has a finish line instead of an open field.
 *
 * WHY THE TARGET IS USUALLY YOUR OWN PACE
 *   Because the board is empty. Read on 1 September 2026: 0 rows on today's
 *   daily board, 1 on yesterday's, 5 rows on the all-time board in the game's
 *   entire life. Getting onto it costs an account, a display name AND an
 *   explicit consent tick (Leaderboard.canSubmit), and each of those is opt-in.
 *   A feature that only works when a stranger is one rung above you would, today,
 *   do nothing at all for every player who has it.
 *
 *   So the target is whichever of these exists, in this order:
 *     1. the nearest reachable HUMAN above you on today's board
 *     2. your own pace — what you typically score, stretched
 *   Path 1 costs nothing extra and switches itself on the day real people appear
 *   on the board. Path 2 is what everybody actually gets right now, and it is a
 *   complete feature on its own: the target, the catch and the near-miss all
 *   behave identically. Nothing here has to be rebuilt when the board fills.
 *
 * ONE TARGET PER DAY, AND IT NEVER GETS HARDER
 *   The record is locked to the calendar day. Replaying does not re-roll it,
 *   beating it does not immediately issue a bigger one, and a rival who improves
 *   in the afternoon is still caught at the score they had this morning. The one
 *   permitted change is an UPGRADE from a pace target to a named human, which is
 *   how a run started offline heals once the board is reachable.
 *
 * WHAT IT NEVER DOES
 *   It never shows a rank, never says how far down the board you are, and never
 *   offers a target more than MAX_GAP times what you can currently do. A player
 *   having a bad week is shown their own pace, not a number that humiliates them.
 *
 * DETERMINISM
 *   Not one line of this consumes a seeded draw. The daily's course is planned
 *   before begin() is ever called, and begin() is synchronous — a run starts at
 *   exactly the same speed with the network down.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  // Safe at module scope only because this file loads after game.js, which is
  // the rule missions.js already follows. Everything else — Leaderboard, Daily,
  // Modes, i18n — is read lazily inside functions, because those load after.
  const Store = LUMEN.Store;

  // A rival more than this many times your anchor is not a rival, they are a
  // wall. Held deliberately low: being shown an unreachable number is worse
  // than being shown your own pace.
  const MAX_GAP = 2.2;
  // How far above the anchor a pace target sits. Small on purpose — the point
  // is a finish line you can see from where you are standing.
  const PACE_STRETCH = 1.12;
  // Below this the numbers are too small to mean anything and the feature stays
  // silent rather than shipping "▲ YOUR PACE 12".
  const MIN_TARGET = 50;
  // How fast the pace follows the player. Weighted to the past so one lucky run
  // does not set a target they then cannot reach for a week.
  const PACE_KEEP = 0.7;

  const num = (v) => Math.floor(Number(v) || 0);

  const Chase = {
    MAX_GAP, PACE_STRETCH, MIN_TARGET,

    // Today's twist carries a score multiplier, and the pace is stored raw.
    // Without this a 4,000 set on a Blackout day (1.9x) would be read back as
    // 4,000 on a Classic day and hand the player a trivial target every time
    // the twist rolled easy.
    todayMul() {
      try {
        const M = LUMEN.Modes, D = LUMEN.Daily;
        if (!M || !D || !M.def) return 1;
        const md = M.def(D.twist().mode);
        return (md && md.scoreMul) || 1;
      } catch (e) { return 1; }
    },

    // What the player can currently do, in TODAY's units.
    //
    // Daily.status().bestToday and never Store.dailyBest: the latter still holds
    // yesterday's number until recordRun rolls the day over, which would anchor
    // the first run of the day to a score that no longer counts.
    anchor() {
      const D = LUMEN.Daily;
      const best = D && D.status ? (D.status().bestToday || 0) : 0;
      const pace = Math.round((Store.chasePace || 0) * this.todayMul());
      return Math.max(best, pace);
    },

    // Is this row the player's own? Verbatim the rule the board screen uses:
    // the owning id first, the cleaned lowercased name only as the legacy
    // fallback for rows written before user_id was populated. Backwards, this
    // is the shipped bug that tagged a stranger's row "(you)".
    isMine(r) {
      const LB = LUMEN.Leaderboard;
      if (!r || !LB) return false;
      const myId = (LUMEN.Auth && LUMEN.Auth.userId) || '';
      const mine = String(LB.cleanName(LB.playerName) || '').toLowerCase();
      return r.user_id ? (!!myId && r.user_id === myId)
                       : (!!mine && String(r.name || '').toLowerCase() === mine);
    },

    // The nearest human strictly above the anchor and within reach.
    //
    // THE ANCHOR IS A SCORE, NEVER A RANK. `rows` is walked only to EXCLUDE the
    // player, never to locate them, and that one property disposes of every
    // case that would otherwise need handling: the player being outside the
    // 20-row window, being signed out with no user_id, having their row folded
    // away by _dedupe because a stranger shares their display name, or their
    // row holding an earlier run than the one just played. "I am not in the
    // array" is not an error path, because the array is never searched for me.
    pickRival(rows, anchor) {
      if (!rows || !rows.length) return null;
      if (!(anchor > 0)) return null;
      const LB = LUMEN.Leaderboard;
      if (!LB) return null;
      const band = [];
      for (const r of rows) {
        const sc = num(r && r.score);
        if (sc <= anchor) continue;                 // strictly above, never equal
        if (this.isMine(r)) continue;
        const nm = LB.cleanName(String((r && r.name) || ''));
        if (!nm) continue;                          // cleanName empties hostile names
        band.push({ name: nm, score: sc });
      }
      if (!band.length) return null;
      // The query is order=score.desc with NO secondary sort, so tied rows
      // reorder between fetches. The name tiebreak makes the pick stable.
      band.sort((a, b) => a.score - b.score || (a.name < b.name ? -1 : 1));
      const nearest = band[0];
      return nearest.score > anchor * MAX_GAP ? null : nearest;
    },

    // The record for today. Idempotent, and the only thing that writes it.
    ensureToday(rows) {
      const D = LUMEN.Daily;
      if (!D) return null;
      const today = D.todayStr();
      const st = Store.chase || {};
      const stored = {
        d: String(st.d || ''), k: String(st.k || ''), n: String(st.n || ''),
        s: num(st.s), w: st.w ? 1 : 0, p: num(st.p),
      };

      // Already settled on a named human today: nothing can improve on that.
      if (stored.d === today && stored.k === 'board') return stored;

      const anchor = this.anchor();
      const rival = this.pickRival(rows, anchor);

      let rec;
      if (rival) {
        rec = { d: today, k: 'board', n: rival.name, s: rival.score };
      } else if (stored.d === today && stored.k === 'pace' && stored.s > 0) {
        // A pace target already stands for today. Hold it — recomputing it as
        // the player's best climbs would move the finish line every run, which
        // is the one thing a target must not do.
        rec = { d: today, k: 'pace', n: '', s: stored.s };
      } else if (anchor >= MIN_TARGET) {
        rec = { d: today, k: 'pace', n: '', s: Math.round(anchor * PACE_STRETCH) };
      } else {
        // Nothing to measure against yet. The HUD, the menu button and the
        // game-over screen are byte-identical to a build without this feature,
        // which is the right thing to show somebody on their first ever run.
        rec = { d: today, k: 'none', n: '', s: 0 };
      }

      // Carry today's result forward across an upgrade, so a win banked against
      // a pace target is not un-won by a rival arriving later in the day.
      if (stored.d === today) { rec.w = stored.w; rec.p = stored.p; }
      else { rec.w = 0; rec.p = 0; }
      Store.chase = rec;
      return rec;
    },

    // Recompute today's record from whatever the board cache already holds.
    // Synchronous, silent, and safe to call as often as the menu redraws.
    //
    // THIS DELIBERATELY ISSUES NO NETWORK REQUEST. It used to call
    // top('daily', 20), which looks free because top() caches — but refreshMenu
    // runs on every return to the menu, every language change and every
    // purchase, so the chase became a request source of its own. Worse, top()
    // hands the SAME promise to every caller while one is in flight: a fetch the
    // chase started and lost then rejected in the leaderboard screen's await
    // too, for a request that screen never made. The test suite caught exactly
    // that, as a board test failing with "Failed to fetch".
    //
    // The board is already fetched once per session by Leaderboard.prefetch(),
    // which is the one sanctioned place for it. The chase reads what that put in
    // the cache and adds nothing.
    warm() {
      const LB = LUMEN.Leaderboard;
      try { this.ensureToday(LB && LB.enabled ? LB.cached('daily') : null); } catch (e) {}
    },

    // SYNCHRONOUS. Returns the frozen record this run is judged against.
    // A run must start at the same speed offline as online, because ?mode=daily
    // starts one before the menu has ever rendered.
    begin() {
      const LB = LUMEN.Leaderboard;
      return this.ensureToday(LB && LB.enabled ? LB.cached('daily') : null);
    },

    // Called at the end of a ranked daily run.
    //
    // `dayStr` is the day the run STARTED, never a fresh todayStr(), so a run
    // begun at 23:59 settles into the day it was played.
    settle(run, dayStr) {
      const c = run && run.chase;
      if (!c || !(c.s > 0)) return null;
      const score = num(run.score), mul = run.mul || 1;
      const st = Store.chase || {};
      const passed = score >= c.s;
      let alreadyWon = false;

      if (String(st.d || '') === String(dayStr || '')) {
        alreadyWon = !!st.w;
        const rec = {
          d: String(st.d), k: String(st.k || ''), n: String(st.n || ''), s: num(st.s),
          w: (passed || st.w) ? 1 : 0,
          p: Math.max(num(st.p), Math.min(999, Math.round(score / c.s * 100))),
        };
        Store.chase = rec;
      }

      // Stored RAW, divided by the multiplier the run actually used, so days
      // with different twists describe the same player.
      const raw = Math.round(score / mul);
      if (raw > 0) {
        Store.chasePace = Store.chasePace
          ? Math.round(Store.chasePace * PACE_KEEP + raw * (1 - PACE_KEEP))
          : raw;
      }

      return {
        kind: c.k, name: c.n, target: c.s, passed,
        firstToday: passed && !alreadyWon,
        gap: Math.max(0, c.s - score),
      };
    },

    // The line under the DAILY button on the menu. '' means draw nothing.
    menuLine() {
      const LB = LUMEN.Leaderboard;
      let rec = null;
      try { rec = this.ensureToday(LB && LB.enabled ? LB.cached('daily') : null); } catch (e) { return ''; }
      if (!rec || !(rec.s > 0)) return '';
      const label = rec.k === 'board' ? rec.n : (LUMEN.t ? LUMEN.t('chasePace') : 'YOUR PACE');
      return '▲ ' + label + ' · ' + rec.s.toLocaleString();
    },
  };

  LUMEN.Chase = Chase;
})();
