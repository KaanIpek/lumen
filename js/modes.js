/*
 * LUMEN — game modes
 * -------------------------------------------------------------
 * One rule, seven ways to be tested by it.
 *
 * A mode is a set of multipliers on knobs the game already has —
 * gap size, speed, spawn rate, how fast difficulty ramps, which
 * gate archetypes appear — plus a visual treatment. Nothing here
 * invents a second game; each mode leans on a different part of
 * the skill the core loop already asks for:
 *
 *   CLASSIC    the baseline. Everything is measured against it.
 *   VORTEX     the world turns. Your hands are fine; your eyes aren't.
 *   MIRROR     it all runs the other way. Twenty years of reading
 *              left-to-right stops helping you.
 *   SPRINT     no gentle open. Full speed from frame one.
 *   BLACKOUT   the lights pulse. You fly on memory between beats.
 *   PRECISION  slow, and the gaps are barely wider than you are.
 *   ZEN        nothing can kill you. Nothing is recorded either.
 *
 * Economy rules, deliberately conservative:
 *  - Every mode keeps its OWN best score. A Sprint record and a
 *    Classic record are not comparable, so they never share a number.
 *  - `shardMul` pays out in proportion to the risk. Zen is 0: a mode
 *    you cannot die in would otherwise be an infinite shard faucet.
 *  - `ranked` decides whether a mode touches lifetime stats and the
 *    online board at all. Only modes with real failure are ranked.
 *  - The Daily Challenge draws its OWN mode from the date seed (see
 *    Daily.MODES), so everyone faces the same unusual thing on the same day —
 *    it deliberately ignores whatever you last played.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  const MODES = [
    {
      id: 'classic',
      // multipliers over the baseline; 1 means "leave it alone"
      gap: 1, speed: 1, spawn: 1, ramp: 1,
      scoreMul: 1, shardMul: 1, ranked: true, lethal: true,
      accent: 196,                   // hue used for the mode's badge + trim
    },
    {
      id: 'vortex',
      gap: 1.06, speed: 0.97, spawn: 1.04, ramp: 0.9,
      scoreMul: 1.35, shardMul: 1.25, ranked: true, lethal: true,
      accent: 285,
      // the playfield leans back and forth; physics is untouched, reading it is not
      rotate: { amp: 0.30, speed: 0.42 },
    },
    {
      id: 'mirror',
      gap: 1, speed: 1, spawn: 1, ramp: 1,
      scoreMul: 1.3, shardMul: 1.2, ranked: true, lethal: true,
      accent: 150,
      mirror: true,
    },
    {
      id: 'sprint',
      // No lead-in and a savage ramp: runs are short and loud. The openings are
      // deliberately a touch WIDER than Classic — speed is the test here, and
      // stacking razor gaps on top of it just made it unplayable rather than
      // hard. Thin gaps are Precision's job.
      gap: 1.08, speed: 1.42, spawn: 0.86, ramp: 2.2, headStart: 20,
      scoreMul: 1.8, shardMul: 1.5, ranked: true, lethal: true,
      accent: 20,
    },
    {
      id: 'blackout',
      gap: 1.14, speed: 0.9, spawn: 1.12, ramp: 0.8,
      scoreMul: 1.9, shardMul: 1.6, ranked: true, lethal: true,
      accent: 265,
      // A strict 3.6s beat you can count on: 1.4s lit, then the dark rolls in
      // over 0.6s, HOLDS for ~1s, and rolls back out. `floor` is how much light
      // never leaves, and `edge` is how much of the dark window is the fade.
      blackout: { period: 3.6, lit: 0.39, floor: 0.035, edge: 0.27 },
    },
    {
      id: 'precision',
      gap: 0.55, speed: 0.72, spawn: 1.35, ramp: 0.4,
      scoreMul: 1.7, shardMul: 1.45, ranked: true, lethal: true,
      accent: 45,
    },
    {
      id: 'zen',
      gap: 1.5, speed: 0.8, spawn: 1.5, ramp: 0,
      scoreMul: 0, shardMul: 0, ranked: false, lethal: false,
      accent: 175,
      calm: true,                    // no shake, no damage flash, gentle audio
    },

    // ---- modes with a character ---------------------------------------------
    // Each of these three bends a DIFFERENT system — one the renderer, one the
    // hitbox, one the physics — so stacking their names never means stacking the
    // same idea twice.

    {
      // Horror. The corridor is there, you simply are not shown it until late.
      //
      // The reveal is a TIME budget, not a pixel one: 1.25s of warning at every
      // screen size and every point on the ramp. Crossing the playfield takes
      // 0.78s at NORMAL, so a gate is always visible for longer than it takes to
      // cross — the fairness rule holds by construction rather than tuning. The
      // easier difficulties cap the orb's speed, which stretches a full crossing,
      // and game.js scales this budget by the same factor so the rule survives
      // them; it is not a bare 1.25 at the point of use.
      id: 'dread',
      // The mode owns the soundtrack on every map — see SONGS.abandon. Losing the
      // dread because you happen to be on the pretty green world would be losing
      // the mode.
      song: 'abandon',
      gap: 1.12, speed: 0.82, spawn: 1.18, ramp: 0.72,
      scoreMul: 1.75, shardMul: 1.5, ranked: true, lethal: true,
      accent: 355,
      reveal: { at: 1.25, fade: 0.35 },
    },
    {
      // Comedy, told entirely in the hitbox. The orb swells with the chain, so
      // at twenty the next mote is a bet you feel in your thumb — and breaking
      // the chain becomes a RELIEF, which inverts the emotional loop of the
      // whole game. Collision already reads p.r, so the trail, the squash and
      // the collection radius all follow for free.
      id: 'glutton',
      gap: 1.15, speed: 0.95, spawn: 1.05, ramp: 0.85,
      scoreMul: 1.5, shardMul: 1.35, ranked: true, lethal: true,
      accent: 40,
      swell: { per: 0.04, max: 1.0 },
    },
    {
      // Physical comedy, and it deletes the one degenerate line the game has:
      // park against a wall, wait, flip once. Here the walls throw you back.
      // A tap still cancels everything — flip() zeroes velocity and adds its own
      // kick — so the player never loses authority, they lose their resting place.
      id: 'rubber',
      gap: 1.10, speed: 0.92, spawn: 1.08, ramp: 0.90,
      scoreMul: 1.45, shardMul: 1.30, ranked: true, lethal: true,
      accent: 95,
      bounce: { e: 0.70, settle: 0.08 },
    },
    {
      // The one mode where the BAR is the target and the gap is the coward's
      // line.
      //
      // Every gate carries a FAULT: a band of solid bar flush against one lip of
      // one opening. Smash it and you score, you chain, and you win back nerve.
      // Thread the gap instead and you DUCK — the chain dies because you did NOT
      // touch a bar — and you spend a nerve to cool the corridor down.
      //
      // The whole mode is one economy. A shatter HEATS the difficulty clock; a
      // duck COOLS it; and nerve is fractional, so three hits buy exactly one
      // brake. That asymmetry is the entire design: without it "always commit"
      // is the only policy and there is no decision to make. With it, a duck at
      // high heat converts a likely death into a certain, survivable cost — and
      // choosing when to cash out is the game.
      //
      // `heat` goes to the difficulty clock (`rampT`) and NEVER to `elapsed`,
      // which is also the time-survived stat. It cannot generate an unthreadable
      // corridor: gapFrac, scrollSpeed and spawnInterval all clamp, and every
      // one of those floors is already reached by t = 900s, which the
      // threadability test already covers.
      id: 'brittle',
      gap: 1.18, speed: 0.88, spawn: 1.12, ramp: 0.55,
      scoreMul: 1.9, shardMul: 1.55, ranked: true, lethal: true,
      accent: 318,
      fault: {
        band: 0.05,     // band height as a fraction of playH…
        minR: 2.6,      // …but never shorter than baseR * this
        wide: 1.45,     // widened on any gate that is not a plain one
        pay: 18,        // raw score per shatter, before comboMult()
        nerve: 3,       // meter cap
        start: 2,       // …and what a run opens with
        gain: 1 / 3,    // nerve per shatter: three hits buy one brake
        cost: 1,        // nerve per duck
        stoke: 2.4,     // seconds of heat per shatter (x1..x2 with the chain)
        cool: 9,        // seconds of heat a duck bleeds off
        hold: 0.82,     // last stand: timeScale while you cannot afford a duck
        full: 160,      // heat that reads as "full" on the badge bar
        cap: 240,       // hard ceiling; the ramp saturates long before this
      },
    },

    {
      // The twelfth mode, and the only one whose difficulty the PLAYER sets --
      // continuously, in both directions, with the input they already have.
      //
      // Height was the one signal the single tap already carried and nothing
      // ever read. ALOFT reads it: the higher you fly, the faster the wind
      // carries the world past you, and the more everything pays. Descend and it
      // all slows down again. flip() is untouched -- there is no second control,
      // no hold, no swipe, and a tap does exactly what it does in Classic.
      //
      // Mid-corridor is Classic to three decimals (0.92 x 1.09 = 1.0028), which
      // is deliberate: a player who cannot manage altitude precisely gets the
      // baseline game rather than a penalty.
      //
      // THE ONE EDIT THAT WOULD MAKE THIS UNFAIR is `wind` touching
      // spawnInterval -- gates would arrive sooner without arriving further
      // apart, which is a reading-time cut disguised as a speed-up. Wind
      // multiplies scrollSpeed and the payout, and nothing else. See `windMul`
      // in js/game.js.
      id: 'aloft',
      gap: 1.04, speed: 0.92, spawn: 1.00, ramp: 0.95,
      scoreMul: 1.35, shardMul: 1.25, ranked: true, lethal: true,
      accent: 228,                   // 32 off classic's 196, 37 off blackout's 265
      wind: { lo: 0.78, hi: 1.40, ease: 0.30 },
    },

    {
      // The thirteenth, and the only one that changes what the input IS.
      //
      // Everywhere else a tap flips gravity and the orb does the rest. Here you
      // keep a finger down and STEER: slide up and down and the orb chases the
      // finger, so you thread the gaps by hand instead of by timing. Let go and
      // gravity takes it back, which is what keeps releasing a decision.
      //
      // The orb obeys the same speed ceiling as every other mode, so the
      // corridor asks exactly what it always asked and a flick cannot cross the
      // screen in a frame. Direct control is easier to be PRECISE with, so the
      // world is what makes it hard: speed 1.55 is the fastest in the game by a
      // distance (sprint is 1.30). Gaps are opened 1.22 to pay for it, because
      // at that speed a Classic opening stops being a test and becomes a coin
      // toss.
      //
      // `hold: true` is read in exactly two places -- the pointer wiring in
      // Game._wireInput and the steering block in updatePlay. flip() is never
      // called in this mode, and no other mode reads the flag.
      id: 'hold',
      // Measured, not guessed: at spawn 1.06 / ramp 0.60 the reach margin was
      // 3.63 against sprint's 1.23, so there was a lot of room to make it mean
      // it. Tightened to 0.94 / 0.78 -- still far from sprint's margin, and the
      // sight time stays close to two seconds, but the corridor now keeps
      // arriving instead of waiting for you.
      // The corridor stops being a corridor. `jump` widens how far the next
      // opening may sit from the last one, so the gaps stagger instead of
      // queueing up in a line -- which is the whole point of steering: a mode
      // where you can put the orb anywhere should ask you to put it everywhere.
      // Every other mode leaves `jump` undefined and is untouched.
      gap: 1.10, speed: 1.55, spawn: 0.94, ramp: 0.78, jump: 1.55, jumpMin: 0.40,
      // …and it pays LESS, not more. Direct control is easier than timing a
      // flip, and a mode that is easier must not also be the best place to earn
      // or every price in the shop is set by it. This is the same brake VERY
      // EASY carries, for the same reason.
      scoreMul: 0.85, shardMul: 0.75, ranked: true, lethal: true,
      accent: 152,
      hold: true,
    },
  ];

  const byId = {};
  for (const m of MODES) byId[m.id] = m;

  const Modes = {
    MODES,
    DEFAULT: 'classic',

    def(id) { return byId[id] || byId.classic; },
    current() { return this.def(LUMEN.Store ? LUMEN.Store.mode : 'classic'); },
    setCurrent(id) {
      if (!byId[id] || !LUMEN.Store) return false;
      LUMEN.Store.mode = id;
      return true;
    },

    name(id) { return LUMEN.t ? LUMEN.t('mode_' + id) : id; },
    desc(id) { return LUMEN.t ? LUMEN.t('moded_' + id) : ''; },
    tag(id) { return LUMEN.t ? LUMEN.t('modet_' + id) : ''; },

    // Every mode carries its own record — a Sprint score means nothing next to
    // a Precision score, so they are never mixed into one number.
    best(id) {
      const all = LUMEN.Store ? LUMEN.Store.modeBests : {};
      return Math.max(0, all[id] | 0);
    },
    recordBest(id, score) {
      if (!LUMEN.Store) return false;
      const all = LUMEN.Store.modeBests;
      if (score <= (all[id] | 0)) return false;
      all[id] = Math.floor(score);
      LUMEN.Store.modeBests = all;
      return true;
    },
  };

  LUMEN.Modes = Modes;
})();
