/*
 * LUMEN — the next-update vote
 * -------------------------------------------------------------
 * The promise this makes to a player: "five things could go into the next
 * update; you pick which one." It is only worth making if it is kept, so the
 * whole design is arranged around being able to keep it.
 *
 * WHY THE OPTIONS ARE ALWAYS A MODE, A MAP OR A COSMETIC
 * ------------------------------------------------------
 * In this codebase each of those is a TABLE ENTRY, not a feature:
 *   a mode      -> one object in js/modes.js
 *   a world     -> one object in js/cosmetics.js MAPS
 *   a signature -> one object in js/cosmetics.js SIGNATURES
 * That is what makes a monthly cadence honest. An option like "multiplayer" or
 * "level editor" is a different game, and putting it on the ballot means either
 * breaking the promise or spending three months proving you meant it. Keep the
 * ballot to things that are a table entry and you can always ship the winner.
 *
 * WHERE IDEAS COME FROM
 * ---------------------
 * NOT from a free-text box in the game. Anything a stranger types straight into
 * a shared database is a moderation problem, an abuse vector, and — once it is
 * displayed to other players — your liability. Ideas are collected wherever the
 * community already is (a link, `LUMEN.CONFIG.ideasUrl`), you read them, and
 * you choose the five. The game holds the VOTE, which is the part that has to
 * be in the game to feel real.
 *
 * ANTI-FRAUD, HONESTLY
 * --------------------
 * One vote per install, enforced by a random id in localStorage plus a unique
 * index in the database. Somebody determined can clear their storage and vote
 * again. That is fine: this is a preference poll among people who like your
 * game, not an election. Anything stronger means accounts, and accounts cost
 * more than the poll is worth.
 *
 * Everything degrades. No config, no network, or a closed poll: the screen
 * simply is not offered, and the game is exactly as it was.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Store = LUMEN.Store;

  const Poll = {
    // Set from config.js via LUMEN.Poll.configure(). Null means "no poll", and
    // no poll means the button never appears.
    _sb: null,
    current: null,        // { id, closes, options: [{ id, kind }] }
    _results: null,       // { total, counts: { optionId: n } }
    _fetchedAt: 0,

    configure(url, anonKey) {
      if (!url || !anonKey) return;
      this._sb = { url: String(url).replace(/\/$/, ''), key: String(anonKey) };
    },
    get enabled() { return !!this._sb && !!this.current; },

    // A stable, anonymous id for this install. Not a device fingerprint and not
    // tied to anything else the player has — its only job is "has this copy of
    // the game already voted".
    voterId() {
      let id = Store ? Store.voterId : '';
      if (!id) {
        id = 'v' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        if (Store) Store.voterId = id;
      }
      return id;
    },

    // Has this ballot already been PUT IN FRONT of the player? Tracked apart
    // from whether they voted, so somebody who looks and closes it is left
    // alone — the offer is made once, not until they give in.
    seen() {
      const s = Store ? Store.pollSeen : '';
      return !!(this.current && s === this.current.id);
    },
    markSeen() { if (Store && this.current) Store.pollSeen = this.current.id; },

    // Should the game open the vote by itself right now?
    //
    // Waiting for the player to notice a menu button means most never see it.
    // But a first-time player has no opinion about a fourth game mode yet, and
    // handing them a ballot before they have played is noise — so this waits
    // until they have finished a few runs, and then asks exactly once.
    RUNS_BEFORE_ASKING: 3,
    shouldOffer() {
      return this.enabled
        && !this.closed
        && !this.seen()
        && !this.hasVoted()
        && !!Store && Store.runs >= this.RUNS_BEFORE_ASKING;
    },

    votedFor() { return Store ? Store.pollVote : ''; },
    hasVoted() {
      const v = this.votedFor();
      return !!v && this.current && v.indexOf(this.current.id + ':') === 0;
    },
    myChoice() {
      const v = this.votedFor();
      return this.hasVoted() ? v.slice(this.current.id.length + 1) : '';
    },

    get closed() {
      if (!this.current || !this.current.closes) return false;
      // Compared as plain YYYY-MM-DD in the player's own day, the same rule the
      // Daily uses — a poll should not close at a different moment for two
      // people looking at the same screen.
      const d = new Date();
      const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
        + '-' + String(d.getDate()).padStart(2, '0');
      return today > this.current.closes;
    },

    _fetch(path, opts) {
      const s = this._sb;
      if (!s) return Promise.reject(new Error('no poll backend'));
      const o = opts || {};
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = setTimeout(() => ctl && ctl.abort(), 6000);
      return fetch(s.url + '/rest/v1' + path, {
        method: o.method || 'GET',
        headers: Object.assign({
          apikey: s.key,
          Authorization: 'Bearer ' + s.key,
          'Content-Type': 'application/json',
        }, o.headers || {}),
        body: o.body ? JSON.stringify(o.body) : undefined,
        signal: ctl ? ctl.signal : undefined,
      }).then((r) => {
        clearTimeout(t);
        if (!r.ok) throw new Error('http ' + r.status);
        // PostgREST answers an insert with 201 and an empty body unless asked
        // otherwise — parsing unconditionally would read success as failure.
        return r.text().then((txt) => (txt ? JSON.parse(txt) : null));
      }).catch((e) => { clearTimeout(t); throw e; });
    },

    // Live tallies. Cached for a minute: this is a poll, not a scoreboard, and
    // hammering the database to watch a number move is nobody's idea of fun.
    results(force) {
      if (!this.enabled) return Promise.resolve(null);
      const fresh = Date.now() - this._fetchedAt < 60000;
      if (!force && fresh && this._results) return Promise.resolve(this._results);
      return this._fetch('/poll_tally?poll_id=eq.' + encodeURIComponent(this.current.id))
        .then((rows) => {
          const counts = {};
          let total = 0;
          for (const r of rows || []) {
            const n = r.votes | 0;
            counts[r.option_id] = n;
            total += n;
          }
          this._results = { total, counts };
          this._fetchedAt = Date.now();
          return this._results;
        })
        .catch(() => this._results);   // keep whatever we last knew
    },

    // Returns { ok } — and records the choice locally either way, because a
    // player who votes on a flaky train should not be asked again forever.
    vote(optionId) {
      if (!this.enabled || this.closed) return Promise.resolve({ ok: false, reason: 'closed' });
      if (this.hasVoted()) return Promise.resolve({ ok: false, reason: 'already' });
      const ok = (this.current.options || []).some((o) => o.id === optionId);
      if (!ok) return Promise.resolve({ ok: false, reason: 'unknown' });
      if (Store) Store.pollVote = this.current.id + ':' + optionId;
      this._results = null; this._fetchedAt = 0;
      LUMEN.Analytics && LUMEN.Analytics.track('poll_vote', { poll: this.current.id, option: optionId });
      return this._fetch('/poll_votes', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates' },
        body: [{ poll_id: this.current.id, option_id: optionId, voter: this.voterId() }],
      }).then(() => ({ ok: true })).catch(() => ({ ok: true, offline: true }));
    },

    // An option's own words. These live in config.js, NOT in i18n.js, because
    // the ballot changes every month and running a new poll must never require
    // shipping code. Accepts a plain string or a { en, tr, es, zh } map, and
    // falls back to English rather than showing a player a blank row.
    text(opt, field) {
      const v = opt && opt[field];
      if (v == null) return '';
      if (typeof v === 'string') return v;
      const lang = LUMEN.i18n ? LUMEN.i18n.lang : 'en';
      return v[lang] || v.en || Object.values(v)[0] || '';
    },

    // The option with the most votes, once the poll has closed.
    winner() {
      if (!this._results || !this.current) return null;
      let best = null;
      for (const o of this.current.options) {
        const n = this._results.counts[o.id] | 0;
        if (!best || n > best.votes) best = { id: o.id, votes: n };
      }
      return best;
    },
  };

  LUMEN.Poll = Poll;
})();
