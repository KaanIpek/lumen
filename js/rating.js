/*
 * LUMEN — asking for a rating, and asking what to build next.
 *
 * TWO THINGS, DELIBERATELY SEPARATE
 *
 * The rating is Apple's own sheet, shown by the system whenever it feels like
 * it. We do not draw stars, we do not ask "did you enjoy it?" first, and we do
 * not route the happy players to the store and the rest to a complaints box.
 * That pattern is called review gating; it is against the App Store guidelines
 * and it is also just dishonest — a rating filtered for good news is not a
 * rating. So: after enough runs to have an opinion, ask the system once, and
 * accept whatever comes of it.
 *
 * The poll is ours, lives entirely in the game, and never mentions the store.
 * It exists because the shop and the roadmap should not be the only places a
 * player has a say. It is skippable, it is never modal over a run, and one
 * answer closes it for the cycle.
 *
 * WHY THE TIMING IS WHAT IT IS
 *
 * Not on the first death — a player who has not seen the game yet has nothing
 * to rate, and the prompt reads as a shakedown. Not while a run is live. Not
 * after a bad run either: RUNS_BEFORE_ASK is checked at the moment a run ENDS
 * WELL, so the question lands on a good note rather than on the frame that
 * just killed you.
 */
(function () {
  const LUMEN = window.LUMEN = window.LUMEN || {};
  const Store = LUMEN.Store;

  const RUNS_BEFORE_ASK = 8;      // enough to have an opinion, few enough to still care
  const RUNS_BETWEEN    = 60;     // if the system swallowed it, do not nag

  const Rating = {
    get plugin() {
      try {
        const C = window.Capacitor;
        return C && C.registerPlugin ? C.registerPlugin('LumenStore') : null;
      } catch (e) { return null; }
    },
    get available() {
      const p = this.plugin;
      return !!(p && p.requestReview && LUMEN.Native && LUMEN.Native.isApp);
    },

    // What the system was last asked at, in runs. Zero means never.
    get askedAt() { return parseInt(Store._read('lumen_rate_at', '0'), 10) || 0; },
    set askedAt(v) { Store._write('lumen_rate_at', String(v)); },

    // A run just ended. Worth asking?
    //
    // `good` is the caller's judgement — a personal best, a finished daily, a
    // long run. We only ask after one of those, because the question is "are
    // you enjoying this", and the honest moment to ask is when the answer is
    // probably yes and the player is not annoyed.
    consider(good) {
      if (!this.available || !good) return false;
      const runs = Store.runs;
      if (runs < RUNS_BEFORE_ASK) return false;
      if (this.askedAt && runs - this.askedAt < RUNS_BETWEEN) return false;
      this.askedAt = runs;
      // Fire and forget. The system decides whether anything appears at all —
      // three times a year at most, never twice on one version, and never when
      // the player has turned ratings off. There is no success to report and
      // pretending otherwise would just be a lie in a log.
      try { this.plugin.requestReview(); } catch (e) { /* nothing to do */ }
      return true;
    },
  };

  LUMEN.Rating = Rating;
})();
