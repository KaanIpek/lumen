/*
 * LUMEN — achievements & skills
 * -------------------------------------------------------------
 * Two separate ideas, deliberately:
 *
 *  ACHIEVEMENTS are a record of what you've done. Permanent,
 *    one-time, pay shards. They never change how the game plays.
 *
 *  SKILLS are what you choose to become. Bought with shards,
 *    three levels each, and every one of them tunes a mechanic
 *    that already exists — nothing here is a new system bolted on.
 *
 * The rule that keeps this honest: **skills are disabled in the
 * Daily Challenge.** The daily is the one mode where everyone plays
 * the identical course, so it has to stay a pure test of hands. Your
 * upgrades apply to normal runs, where the score is your own.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Store = LUMEN.Store;

  // ---- achievements --------------------------------------------------------
  // `stat` names resolve in stats() below.
  // `cat` groups them on the page; `unlocks` names a cosmetic that can ONLY be
  // earned here — those are the ones worth chasing.
  const ACHIEVEMENTS = [
    // score
    { id: 'firstLight', cat: 'score',   stat: 'bestScore',   goal: 100,   reward: 20 },
    { id: 'scorer1',    cat: 'score',   stat: 'bestScore',   goal: 1000,  reward: 45 },
    { id: 'scorer2',    cat: 'score',   stat: 'bestScore',   goal: 3000,  reward: 110, unlocks: 'zenith' },
    { id: 'scorer3',    cat: 'score',   stat: 'bestScore',   goal: 8000,  reward: 260 },
    // chains
    { id: 'chain1',     cat: 'chain',   stat: 'bestCombo',   goal: 20,    reward: 35 },
    { id: 'chain2',     cat: 'chain',   stat: 'bestCombo',   goal: 40,    reward: 90,  unlocks: 'halo' },
    { id: 'chain3',     cat: 'chain',   stat: 'bestCombo',   goal: 70,    reward: 220, unlocks: 'apex' },
    { id: 'flow1',      cat: 'chain',   stat: 'flowCount',   goal: 1,     reward: 25 },
    { id: 'flow2',      cat: 'chain',   stat: 'flowCount',   goal: 25,    reward: 80,  unlocks: 'aurora' },
    { id: 'flow3',      cat: 'chain',   stat: 'flowCount',   goal: 100,   reward: 240, unlocks: 'wake' },
    // endurance
    { id: 'endure1',    cat: 'endure',  stat: 'bestTime',    goal: 60,    reward: 60 },
    { id: 'endure2',    cat: 'endure',  stat: 'bestTime',    goal: 120,   reward: 130, unlocks: 'obsidian' },
    { id: 'endure3',    cat: 'endure',  stat: 'bestTime',    goal: 240,   reward: 300 },
    { id: 'phoenix',    cat: 'endure',  stat: 'revives',     goal: 5,     reward: 45,  unlocks: 'phoenix' },
    // collection
    { id: 'motes1',     cat: 'collect', stat: 'motes',       goal: 500,   reward: 40 },
    { id: 'motes2',     cat: 'collect', stat: 'motes',       goal: 2500,  reward: 110 },
    { id: 'motes3',     cat: 'collect', stat: 'motes',       goal: 10000, reward: 280 },
    { id: 'close1',     cat: 'collect', stat: 'nearMiss',    goal: 50,    reward: 50 },
    { id: 'close2',     cat: 'collect', stat: 'nearMiss',    goal: 250,   reward: 150, unlocks: 'mirage' },
    // dedication
    { id: 'runs1',      cat: 'devote',  stat: 'runs',        goal: 25,    reward: 30 },
    { id: 'runs2',      cat: 'devote',  stat: 'runs',        goal: 100,   reward: 90 },
    { id: 'runs3',      cat: 'devote',  stat: 'runs',        goal: 500,   reward: 320, unlocks: 'eclipse' },
    { id: 'streak1',    cat: 'devote',  stat: 'dailyStreak', goal: 7,     reward: 120 },
    { id: 'streak2',    cat: 'devote',  stat: 'dailyStreak', goal: 30,    reward: 400 },
    { id: 'curator',    cat: 'devote',  stat: 'unlockCount', goal: 5,     reward: 55 },
    { id: 'curator2',   cat: 'devote',  stat: 'unlockCount', goal: 12,    reward: 180 },
  ];
  const CATEGORIES = ['score', 'chain', 'endure', 'collect', 'devote'];

  // ---- skills --------------------------------------------------------------
  // Index 0 is "not bought"; levels 1..3 cost costs[0..2].
  const SKILLS = [
    {
      id: 'magnet', max: 3, costs: [150, 350, 700],
      // passive mote pull radius, as a fraction of the playfield height
      values: [0, 0.10, 0.16, 0.22],
      fmt: (v) => (v === 0 ? '—' : '+' + Math.round(v * 100) + '%'),
    },
    {
      id: 'flowsync', max: 3, costs: [200, 450, 900],
      // combo needed to trigger flow
      values: [16, 15, 14, 13],
      fmt: (v) => v + ' combo',
    },
    {
      id: 'chain', max: 3, costs: [180, 400, 800],
      // multiplier on how long the combo timer lasts
      values: [1, 1.15, 1.3, 1.45],
      fmt: (v) => '×' + v.toFixed(2),
    },
    {
      id: 'precision', max: 3, costs: [160, 380, 760],
      // how generous the CLOSE! window is (multiples of the orb radius)
      values: [2.0, 2.4, 2.8, 3.2],
      fmt: (v) => '×' + v.toFixed(1),
    },
    {
      id: 'aegis', max: 3, costs: [250, 550, 1100],
      // 1-2: cheaper revives. 3: begin every run already shielded.
      values: [0, 1, 2, 3],
      fmt: (v) => (v === 0 ? '—' : v < 3 ? '−' + (v * 10) + ' ◆' : 'start shielded'),
    },
  ];
  const skillDef = (id) => SKILLS.find((s) => s.id === id);

  const Progression = {
    ACHIEVEMENTS, SKILLS, CATEGORIES,

    // ---- stats the achievements read ---------------------------------------
    stats() {
      return {
        bestScore: Store.best,
        bestCombo: Store.bestCombo,
        flowCount: Store.flowCount,
        motes: Store.motes,
        nearMiss: Store.nearMissTotal,
        bestTime: Store.bestTime,
        runs: Store.runs,
        dailyStreak: LUMEN.Daily ? LUMEN.Daily.status().streak : 0,
        revives: Store.reviveCount,
        unlockCount: Store.unlocks.length,
      };
    },

    earned(id) { return Store.achievements.indexOf(id) >= 0; },
    summary() {
      const rows = this.list();
      return { done: rows.filter((r) => r.done).length, total: rows.length };
    },

    list() {
      const s = this.stats();
      return ACHIEVEMENTS.map((a) => ({
        id: a.id,
        cat: a.cat,
        goal: a.goal,
        reward: a.reward,
        unlocks: a.unlocks || null,
        // An achievement you have EARNED is finished, whatever the live stat
        // says now. These two were derived independently, so after the one-time
        // score reset a player saw rows marked earned — with the reward already
        // in hand — sitting at "0 / 40" behind an empty bar. Earned is the
        // stronger fact; nothing you have been given should ever read as unmet.
        progress: this.earned(a.id) ? a.goal : Math.min(s[a.stat] || 0, a.goal),
        done: this.earned(a.id),
      }));
    },

    // Award anything newly satisfied. Returns the list of freshly earned ones so
    // the UI can celebrate them.
    check() {
      const s = this.stats();
      const have = Store.achievements;
      const fresh = [];
      for (const a of ACHIEVEMENTS) {
        if (have.indexOf(a.id) >= 0) continue;
        if ((s[a.stat] || 0) >= a.goal) {
          have.push(a.id);
          Store.shards = Store.shards + a.reward;
          // an achievement that carries a cosmetic hands it over immediately
          if (a.unlocks && LUMEN.Cosmetics) LUMEN.Cosmetics.grant(a.unlocks);
          fresh.push({ id: a.id, reward: a.reward, unlocks: a.unlocks || null });
        }
      }
      if (fresh.length) Store.achievements = have;
      return fresh;
    },

    // ---- skills ------------------------------------------------------------
    level(id) {
      const s = Store.skills || {};
      const d = skillDef(id);
      if (!d) return 0;
      return Math.max(0, Math.min(d.max, s[id] | 0));
    },
    value(id) {
      const d = skillDef(id);
      return d ? d.values[this.level(id)] : 0;
    },
    nextCost(id) {
      const d = skillDef(id);
      if (!d) return null;
      const lv = this.level(id);
      return lv >= d.max ? null : d.costs[lv];
    },
    upgrade(id) {
      const cost = this.nextCost(id);
      if (cost == null || Store.shards < cost) return false;
      Store.shards = Store.shards - cost;
      const s = Store.skills || {};
      s[id] = this.level(id) + 1;
      Store.skills = s;
      return true;
    },

    // ---- consumables -------------------------------------------------------
    // Bought with shards, carried into a run, fired by hand. Deliberately scarce:
    // one of each type and three in total, so an item is a decision you make once
    // in a run, not a crutch that flattens the difficulty curve.
    // Each item answers a DIFFERENT failure, so choosing between them is a real
    // decision rather than a power ranking:
    //   shield  you already crashed          — undo one mistake
    //   magnet  the mote was out of reach    — collect what you couldn't
    //   slow    the gap came too fast        — buy reaction time
    //   scout   you couldn't read what's next— see the gaps before they arrive
    //   anchor  the flip overshot            — halve gravity, fly flatter
    //   spark   the chain broke              — restore the combo you just lost
    ITEMS: [
      { id: 'shield', cost: 320 },
      { id: 'magnet', cost: 240 },
      { id: 'slow',   cost: 260 },
      { id: 'scout',  cost: 200 },
      { id: 'anchor', cost: 280 },
      { id: 'spark',  cost: 340 },
    ],
    MAX_PER_TYPE: 1,
    MAX_TOTAL: 3,

    itemDef(id) { return this.ITEMS.find((i) => i.id === id) || null; },
    stock(id) { const s = Store.items || {}; return Math.max(0, s[id] | 0); },
    stockTotal() { return this.ITEMS.reduce((n, i) => n + this.stock(i.id), 0); },

    canBuyItem(id) {
      const d = this.itemDef(id);
      if (!d) return false;
      if (this.stock(id) >= this.MAX_PER_TYPE) return false;      // one of each
      if (this.stockTotal() >= this.MAX_TOTAL) return false;      // three in total
      return Store.shards >= d.cost;
    },
    buyItem(id) {
      if (!this.canBuyItem(id)) return false;
      const d = this.itemDef(id);
      Store.shards = Store.shards - d.cost;
      const s = Store.items || {};
      s[id] = this.stock(id) + 1;
      Store.items = s;
      return true;
    },
    // Move stock into a run. Returns the hand the run starts with.
    // Lend the run what it may carry — WITHOUT spending it. The stock used to be
    // decremented here and written back nowhere, so buying a 340-shard Spark,
    // pressing PLAY and then leaving for the menu destroyed it without ever
    // firing it. An item is paid for when it is USED (see returnUnused).
    takeIntoRun() {
      const hand = {};
      for (const it of this.ITEMS) {
        const have = Math.min(this.stock(it.id), this.MAX_PER_TYPE);
        if (have > 0) hand[it.id] = have;
      }
      return hand;
    },

    // An item is paid for at the moment it FIRES. Anything still in hand when
    // the run ends was never used, so it is still in the shop's stock and
    // nothing needs returning.
    spend(id) {
      const s = Store.items || {};
      const have = this.stock(id);
      if (have <= 0) return false;
      s[id] = have - 1;
      Store.items = s;
      return true;
    },

    // Everything the game needs for one run, resolved once at start.
    // `daily` zeroes every skill so the shared course stays a fair contest.
    modifiers(daily) {
      const lv = (id) => (daily ? 0 : this.level(id));
      const val = (id) => {
        const d = skillDef(id);
        return d.values[lv(id)];
      };
      const aegis = lv('aegis');
      return {
        magnetFrac: val('magnet'),
        flowAt: val('flowsync'),
        comboTimeMul: val('chain'),
        closeWindow: val('precision'),
        closeBonus: 8 + lv('precision') * 2,
        startShield: aegis >= 3,
        // Math.min(aegis, 2), not `aegis < 3`. The old test excluded level 3
        // from the discount entirely, so buying it for 1,100 raised the revive
        // price from 40 back to 60 and silently voided the 800 spent on levels
        // 1 and 2. Level 3 adds a starting shield; it should not take away what
        // the levels below it bought.
        reviveCost: 60 - Math.min(aegis, 2) * 10,
        skillsActive: !daily,
      };
    },
  };

  LUMEN.Progression = Progression;
})();
