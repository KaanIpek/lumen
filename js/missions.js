/*
 * LUMEN — Missions + Daily Challenge
 * -------------------------------------------------------------
 * Missions: 3 rotating goals that pay shards; completed ones are
 * replaced. Daily: a date-seeded run (same layout for everyone
 * that day) with its own best score and a play streak.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Store = LUMEN.Store;

  // ---- Daily ---------------------------------------------------------------
  const Daily = {
    _str(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    todayStr() { return this._str(new Date()); },
    yesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 1); return this._str(d); },
    // The seed for ANY day, not just this one.
    //
    // It was only ever askable about today, which is fine while the only thing
    // that plays a daily is a player sitting in front of it on the day. It stops
    // being fine the moment a course has to be named to somebody else: todayStr
    // is built from LOCAL date parts, so two friends either side of midnight —
    // or either side of the world — are on different courses at the same moment,
    // and a link that says "play today's" hands them different games. A date
    // in, a seed out, and a shared course can be identified rather than assumed.
    seedFor(dateStr) {
      const s = String(dateStr || '');
      if (!s) return 1;
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0) || 1;
    },
    todaySeed() { return this.seedFor(this.todayStr()); },
    // ---- the day's twist ---------------------------------------------------
    // A daily that is always Classic-with-a-different-seed is really the same
    // run every day. Each day now also picks a MODE and a MUTATOR from the date
    // seed, so everyone gets the same unusual thing to deal with — which is the
    // part worth talking about.
    //
    // Modes that hide the corridor or turn it are fine here; Zen is not, because
    // a daily has to be scoreable, and Sprint is not, because its head start
    // would make the seeded course start mid-way through itself.
    MODES: ['classic', 'classic', 'vortex', 'mirror', 'blackout', 'precision'],
    MUTATORS: ['none', 'swarm', 'narrow', 'rush', 'bounty', 'sparse', 'traps'],

    // Same reasoning as seedFor: a course you can name to a friend is a course
    // whose twist you can ask about by date. twist() stays as the today-shaped
    // wrapper, so every existing caller is untouched.
    twistFor(dateStr) {
      const seed = this.seedFor(dateStr);
      // two independent draws from the one seed
      const a = (seed >>> 3) % this.MODES.length;
      const b = ((seed >>> 11) ^ (seed >>> 19)) % this.MUTATORS.length;
      return { mode: this.MODES[a], mutator: this.MUTATORS[b] };
    },
    twist() { return this.twistFor(this.todayStr()); },
    twistName() {
      const t = this.twist();
      const parts = [];
      if (LUMEN.Modes && t.mode !== 'classic') parts.push(LUMEN.Modes.name(t.mode));
      if (t.mutator !== 'none' && LUMEN.t) parts.push(LUMEN.t('mut_' + t.mutator));
      return parts.join(' · ');
    },

    status() {
      const today = this.todayStr();
      const last = Store.dailyLastPlayed;
      // a streak only stands if the last daily was today or yesterday — otherwise
      // the menu would keep advertising a streak the player already lost
      const alive = last === today || last === this.yesterdayStr();
      return {
        bestToday: Store.dailyDate === today ? Store.dailyBest : 0,
        playedToday: last === today,
        streak: alive ? Store.dailyStreak : 0,
      };
    },
    // `dateStr` is the day the run STARTED on — a run begun at 23:59:30 belongs to
    // the layout (and the streak) of the day it was played, not the day it ended.
    recordRun(score, dateStr) {
      const today = dateStr || this.todayStr();
      if (Store.dailyDate !== today) { Store.dailyDate = today; Store.dailyBest = 0; }
      if (Store.dailyLastPlayed !== today) {
        Store.dailyStreak = (Store.dailyLastPlayed === this.yesterdayStr()) ? Store.dailyStreak + 1 : 1;
        Store.dailyLastPlayed = today;
      }
      let isBest = false;
      if (score > Store.dailyBest) { Store.dailyBest = score; isBest = true; }
      return isBest;
    },
  };

  // ---- Missions ------------------------------------------------------------
  const TEMPLATES = [
    { id: 's600',  field: 'score',       goal: 600,  reward: 30, mode: 'run' },
    { id: 's1500', field: 'score',       goal: 1500, reward: 65, mode: 'run' },
    { id: 'c20',   field: 'combo',       goal: 20,   reward: 40, mode: 'run' },
    { id: 'c35',   field: 'combo',       goal: 35,   reward: 80, mode: 'run' },
    { id: 'f3',    field: 'reachedFlow', goal: 3,    reward: 55, mode: 'sum' },
    { id: 'm80',   field: 'motes',       goal: 80,   reward: 40, mode: 'sum' },
    { id: 'n15',   field: 'nearMiss',    goal: 15,   reward: 45, mode: 'sum' },
    { id: 'r5',    field: 'one',         goal: 5,    reward: 25, mode: 'sum' },
  ];
  const tpl = (id) => TEMPLATES.find((t) => t.id === id);
  // mission copy lives in the localisation table, keyed by mission id
  const MT = (id) => (LUMEN.t ? LUMEN.t('mis_' + id) : id);

  const Missions = {
    _pick(n, exclude) {
      exclude = exclude || [];
      const pool = TEMPLATES.filter((t) => exclude.indexOf(t.id) < 0);
      const out = [];
      while (out.length < n && pool.length) {
        const i = Math.floor(Math.random() * pool.length);
        out.push(pool.splice(i, 1)[0].id);
      }
      return out;
    },
    ensure() {
      let m = Store.missions;
      // Drop any slot whose template no longer exists. Saved mission ids outlive
      // the code that defined them (localStorage + a cache-first service worker),
      // so a renamed template would otherwise throw straight out of UI.init and
      // leave the player staring at a black screen.
      if (m && m.active) {
        const valid = m.active.filter((s) => s && tpl(s.id));
        if (valid.length !== m.active.length) { m.active = valid; Store.missions = m; }
      }
      if (!m || !m.active || !m.active.length) {
        m = { active: this._pick(3, []).map((id) => ({ id, progress: 0 })) };
        Store.missions = m;
      } else if (m.active.length < 3) {
        const add = this._pick(3 - m.active.length, m.active.map((s) => s.id));
        m.active = m.active.concat(add.map((id) => ({ id, progress: 0 })));
        Store.missions = m;
      }
      return m;
    },
    list() {
      return this.ensure().active.map((slot) => {
        const t = tpl(slot.id);
        return { text: MT(slot.id), progress: Math.min(slot.progress, t.goal), goal: t.goal, reward: t.reward, done: slot.progress >= t.goal };
      });
    },
    recordRun(rs) {
      const m = this.ensure();
      const completed = [];
      for (const slot of m.active) {
        const t = tpl(slot.id); if (!t) continue;
        if (t.mode === 'run') slot.progress = Math.max(slot.progress, rs[t.field] || 0);
        else {
          const add = t.field === 'one' ? 1 : t.field === 'reachedFlow' ? (rs.reachedFlow ? 1 : 0) : (rs[t.field] || 0);
          slot.progress += add;
        }
      }
      const next = [];
      for (const slot of m.active) {
        const t = tpl(slot.id);
        if (!t) continue; // unknown id (stale save) — drop the slot, ensure() refills
        if (slot.progress >= t.goal) {
          Store.shards = Store.shards + t.reward;
          completed.push({ text: MT(slot.id), reward: t.reward });
          // exclude ids already held AND ids already handed out this pass, or two
          // missions completing in one run could be replaced by the same mission
          const held = next.map((s) => s.id).concat(m.active.map((s) => s.id));
          const nid = this._pick(1, held)[0];
          if (nid) next.push({ id: nid, progress: 0 }); // replacement
        } else next.push(slot);
      }
      m.active = next;
      Store.missions = m;
      return completed;
    },
  };

  LUMEN.Daily = Daily;
  LUMEN.Missions = Missions;
})();
