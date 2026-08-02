/*
 * LUMEN — online leaderboard client
 * -------------------------------------------------------------
 * The daily challenge plans an identical course for everyone, so
 * a shared board is the payoff. This is the client half; the
 * server half is `server/leaderboard-server.js` (a small, real
 * Node implementation you can run or port).
 *
 * Design notes:
 *  - `endpoint` is null by default: the game is fully playable
 *    offline and never contacts a server unless one is configured.
 *  - A player name is the ONLY thing submitted besides a score.
 *    No accounts, no email, no device id.
 *  - Everything degrades: if the network fails, the local top-10
 *    board is still there and the UI just says "offline".
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Store = LUMEN.Store;

  const Leaderboard = {
    // e.g. 'https://your-host.example/api'  (see server/README)
    endpoint: null,
    timeoutMs: 6000,

    // ---- Supabase ---------------------------------------------------------
    // A board with no server to run: Postgres exposes a REST API directly, so
    // this needs no SDK and no build step.
    //
    //   LUMEN.Leaderboard.useSupabase('https://xxxx.supabase.co', 'eyJ...anon key...')
    //
    // The anon key is MEANT to be public — it ships inside every client and is
    // not a secret. What protects the table is Row Level Security, not the key.
    // The service_role key is the opposite: it bypasses every policy, so it must
    // never appear in this file, in the repo, or in a browser.
    //
    // See docs/LEADERBOARD.md for the SQL, the policies, and the honest limits.
    _sb: null,
    useSupabase(url, anonKey) {
      if (!url || !anonKey) return false;
      this._sb = { url: String(url).replace(/\/$/, ''), key: String(anonKey) };
      return true;
    },
    _sbFetch(path, opts) {
      const s = this._sb;
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = setTimeout(() => ctl && ctl.abort(), this.timeoutMs);
      const headers = Object.assign({
        apikey: s.key,
        Authorization: 'Bearer ' + s.key,
        'Content-Type': 'application/json',
      }, (opts && opts.headers) || {});
      return fetch(s.url + '/rest/v1' + path, Object.assign({ signal: ctl && ctl.signal }, opts, { headers }))
        .then((r) => {
          if (!r.ok) throw new Error('http ' + r.status);
          // A write asks for `return=minimal`, and PostgREST answers 201 with an
          // empty body — not 204. Parsing that as JSON throws, so a submit that
          // had ALREADY SUCCEEDED came back as a failure. Decide by whether
          // there is a body, not by the status code.
          const h = r.headers && typeof r.headers.get === 'function' ? r.headers : null;
          const len = h ? h.get('content-length') : null;
          const type = (h ? h.get('content-type') : '') || '';
          if (r.status === 204 || len === '0' || (h && !type.includes('json'))) return null;
          return r.json().catch(() => null);
        })
        .finally(() => clearTimeout(t));
    },

    get enabled() { return !!this.endpoint || !!this._sb; },
    get playerName() { return (Store && Store.playerName) || ''; },
    set playerName(v) { if (Store) Store.playerName = String(v || '').slice(0, 16); },

    _fetch(path, opts) {
      if (!this.endpoint) return Promise.reject(new Error('no endpoint'));
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = setTimeout(() => ctl && ctl.abort(), this.timeoutMs);
      return fetch(this.endpoint.replace(/\/$/, '') + path,
        Object.assign({ signal: ctl && ctl.signal, headers: { 'Content-Type': 'application/json' } }, opts))
        .then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .finally(() => clearTimeout(t));
    },

    // ---- caching ----------------------------------------------------------
    // A board is not live data. Re-fetching it every time somebody flicks
    // between tabs made the screen feel slow for information that had not
    // changed — so it is fetched once, kept for the session, and refreshed only
    // when there is a reason: the player asked, or the player just beat their
    // own score and would rightly expect to see it.
    _cache: {},
    _cacheKey(board) {
      const day = LUMEN.Daily ? LUMEN.Daily.todayStr() : '';
      return board === 'daily' ? 'daily:' + day : 'alltime';
    },
    cached(board) {
      const c = this._cache[this._cacheKey(board === 'daily' ? 'daily' : 'alltime')];
      return c ? c.rows : null;
    },
    invalidate(board) {
      if (!board) { this._cache = {}; return; }
      delete this._cache[this._cacheKey(board === 'daily' ? 'daily' : 'alltime')];
    },
    // Warm both boards in the background at start-up, so the first time the
    // screen is opened it is already there. Failures are silent — this is an
    // optimisation, and the screen still fetches for itself if it has nothing.
    prefetch() {
      if (!this.enabled) return;
      this.top('alltime', 20).catch(() => {});
      this.top('daily', 20).catch(() => {});
    },

    // board: 'daily' | 'alltime'.  force: skip the cache
    top(board, limit, force) {
      const b = board === 'daily' ? 'daily' : 'alltime';
      const key = this._cacheKey(b);
      if (!force && this._cache[key]) return Promise.resolve({ rows: this._cache[key].rows, cached: true });
      // an in-flight request is shared rather than duplicated
      if (!force && this._inflight && this._inflight[key]) return this._inflight[key];
      const p = this._topFresh(b, limit)
        .then((res) => {
          if (res && res.rows) this._cache[key] = { rows: res.rows, at: Date.now() };
          return res;
        })
        .finally(() => { if (this._inflight) delete this._inflight[key]; });
      this._inflight = this._inflight || {};
      this._inflight[key] = p;
      return p;
    },

    // One row per NAME, not one row per personal best.
    //
    // Every submit INSERTs, so a player who improves eight times leaves eight
    // rows behind — and since the board is just "order by score desc", one
    // improving player could hold most of the top twenty and bury everybody
    // else. The rows arrive already sorted, so the first time a name appears is
    // that name's best and every later one is a stale record of theirs.
    //
    // Doing this on read means no database migration is required for the board
    // to be correct today. The durable fix is a unique index on
    // (name, board, day) plus an upsert on write — see docs/LEADERBOARD.md.
    _dedupe(rows, limit) {
      const seen = Object.create(null);
      const out = [];
      for (const r of rows || []) {
        const k = String((r && r.name) || '').toLowerCase();
        if (seen[k]) continue;
        seen[k] = true;
        out.push(r);
        if (out.length >= (limit || 20)) break;
      }
      return out;
    },

    _topFresh(board, limit) {
      const b = board === 'daily' ? 'daily' : 'alltime';
      const day = LUMEN.Daily ? LUMEN.Daily.todayStr() : '';
      const want = limit || 20;
      // Over-fetch so that collapsing duplicates still leaves a full board.
      const fetchN = Math.min(200, want * 5);
      if (this._sb) {
        // highest first; the daily board is filtered to today
        const q = '/scores?select=name,score,combo&board=eq.' + b
          + (b === 'daily' && day ? '&day=eq.' + encodeURIComponent(day) : '')
          + '&order=score.desc&limit=' + fetchN;
        return this._sbFetch(q).then((rows) => ({ rows: this._dedupe(rows, want) }));
      }
      return this._fetch('/top?board=' + b + '&day=' + encodeURIComponent(day) + '&limit=' + fetchN)
        .then((res) => ({ ...(res || {}), rows: this._dedupe(res && res.rows, want) }));
    },

    submit(score, combo, board) {
      const name = this.playerName || 'anon';
      const day = LUMEN.Daily ? LUMEN.Daily.todayStr() : '';
      const b = board === 'daily' ? 'daily' : 'alltime';
      const row = {
        name: String(name).slice(0, 16),
        score: Math.floor(score),
        combo: Math.floor(combo || 0),
        board: b,
        day: b === 'daily' ? (day || null) : null,
      };
      // A run of your own that got onto the board is the one case where the
      // cached copy is definitely wrong, so drop it.
      const done = () => { this.invalidate(b); };
      if (this._sb) {
        return this._sbFetch('/scores', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(row),
        }).then((r) => { done(); return r; });
      }
      return this._fetch('/submit', { method: 'POST', body: JSON.stringify(row) })
        .then((r) => { done(); return r; });
    },

    // Fire-and-forget: a failed submit must never interrupt the game.
    submitQuietly(score, combo, board) {
      if (!this.enabled || !(score > 0)) return;
      this.submit(score, combo, board).catch(() => {});
    },
  };

  LUMEN.Leaderboard = Leaderboard;
})();
