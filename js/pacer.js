/*
 * LUMEN — PACER: the best run you have flown on this course, flying beside you
 * -------------------------------------------------------------
 * One seeded course for the whole week. Every run of the week is the same
 * corridor, gate for gate, and the best run you have flown on it is replayed
 * beside you as a ghost. Beat it and you become the ghost.
 *
 * WHY THIS, AND WHY NOW
 *   It was on the 2026-09 ballot, and the ballot itself was broken: every vote
 *   was refused by the database while the game told the voter "Voted" (see
 *   js/poll.js). With no result to honour, PACER was picked because it is the
 *   one option that works with nobody else around. The leaderboard has held a
 *   dozen rows in the game's life; a ghost of YOUR best run needs no server, no
 *   account and no other player, and it is there on the first day.
 *
 * WHY A WEEK
 *   A ghost only means something on a course you can come back to. A fresh
 *   random corridor every run — what every other mode flies — would replay a
 *   line that goes straight through walls. A day is too short to learn a
 *   corridor by heart, which is the whole pleasure of a time trial; a month is
 *   long enough to be a chore. The week turns over on Monday, local time, the
 *   same local-date rule the Daily uses.
 *
 * WHAT IT REUSES, AND WHAT IT REFUSES
 *   The course is planned by the Daily's machinery (Game.planAhead), because
 *   that machinery already IS "a course that is identical every time". The
 *   ghost is js/ghost.js, recorded and encoded exactly as a daily ghost is, so
 *   a pacer mark costs ~1KB of storage at most. None of the Daily's social half
 *   comes along: no board, no streak, no twist, no CHASE. It is you against you.
 *
 *   The run flies at Normal with no world, no skills and no loadout, for the
 *   reason the Daily does: last Tuesday's ghost has to have been flown in the
 *   same game as this Tuesday's run, or beating it means nothing.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  const dateStr = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');

  const Pacer = {
    // The Monday this week started on, as YYYY-MM-DD in the player's own day.
    weekKey(at) {
      const d = at ? new Date(at.getTime()) : new Date();
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // Monday = 0
      return dateStr(d);
    },

    // Salted, so this week's course is never the Monday daily's course.
    seedFor(week) {
      const D = LUMEN.Daily;
      return D ? D.seedFor('pacer:' + week) : 1;
    },

    // This week's mark, { week, score, code }, or null. A mark from an earlier
    // week was set on a different corridor and counts for nothing here.
    record(week) {
      const S = LUMEN.Store;
      const r = S ? S.pacer : null;
      const w = week || this.weekKey();
      return r && r.week === w && (r.score | 0) > 0 ? r : null;
    },
    weekBest(week) {
      const r = this.record(week);
      return r ? r.score | 0 : 0;
    },

    // The ghost to race this week, decoded, or null. Ghost.decode never throws
    // and returns null for anything that is not a ghost.
    ghost(week) {
      const r = this.record(week);
      if (!r || !r.code || !LUMEN.Ghost) return null;
      return LUMEN.Ghost.decode(r.code);
    },

    // Called once at the end of a pacer run. Keeps the run only if it beat the
    // week's mark, and returns whether it did. `code` may be '' — a run too
    // short to record still sets the mark; it simply has no ghost to show.
    remember(week, score, code) {
      const S = LUMEN.Store;
      const s = Math.floor(score) || 0;
      if (!S || !week || s <= 0 || s <= this.weekBest(week)) return false;
      S.pacer = { week, score: s, code: String(code || '') };
      return true;
    },
  };

  LUMEN.Pacer = Pacer;
})();
