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
      // Signed in, the request is made AS that user, so row-level security can
      // attribute the row to auth.uid() rather than trusting a name field that
      // anyone can type. Signed out it falls back to the publishable key, which
      // is what every player had before accounts existed.
      const A = LUMEN.Auth;
      const asUser = A && A.token ? { Authorization: 'Bearer ' + A.token } : null;
      const headers = Object.assign({
        apikey: s.key,
        Authorization: 'Bearer ' + s.key,
        'Content-Type': 'application/json',
      }, asUser || {}, (opts && opts.headers) || {});
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
    set playerName(v) { if (Store) Store.playerName = Leaderboard.cleanName(v); },

    // A display name is the only thing in this game one player can show another,
    // which makes it the only thing that can be used to say something horrible
    // to a stranger. The reference server in server/ has always cleaned it; the
    // Supabase path, which is what actually ships, did not — it only cut the
    // string to 16 characters, so every symbol, every direction-override, every
    // zero-width character and every lookalike went straight onto a board that a
    // child playing a 4+ game reads.
    //
    // Letters, digits, space and . _ - only. Unicode-aware, so ırmak and 深蓝 are
    // names and U+202E is not. The same rule is a CHECK constraint on the table
    // (docs/LEADERBOARD.md) because anything enforced only here is enforced
    // nowhere: the publishable key lets anyone POST whatever they like.
    cleanName(v) {
      let s = String(v == null ? '' : v);
      try { s = s.normalize('NFKC'); } catch (e) { /* ancient engine; carry on */ }
      try { s = s.replace(/[^\p{L}\p{N} ._-]/gu, ''); }
      catch (e) { s = s.replace(/[^A-Za-z0-9 ._-]/g, ''); }   // no \p support
      return s.replace(/\s+/g, ' ').trim().slice(0, 16);
    },

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
        // user_id comes back so the screen can mark the player's OWN row by the
        // id that owns it rather than by matching the name — which tagged an
        // unowned row "(you)" simply because a stranger, or an older signed-out
        // self, had typed the same string. A published id is an opaque uuid and
        // proves nothing on its own; the tidier shape is a view exposing
        // `user_id = auth.uid()` as a boolean, which would not publish it at all.
        const q = '/scores?select=name,score,combo,user_id&board=eq.' + b
          + (b === 'daily' && day ? '&day=eq.' + encodeURIComponent(day) : '')
          + '&order=score.desc&limit=' + fetchN;
        return this._sbFetch(q).then((rows) => ({ rows: this._dedupe(rows, want) }));
      }
      return this._fetch('/top?board=' + b + '&day=' + encodeURIComponent(day) + '&limit=' + fetchN)
        .then((res) => ({ ...(res || {}), rows: this._dedupe(res && res.rows, want) }));
    },

    submit(score, combo, board) {
      // Clean again at the boundary rather than trusting the setter. A name can
      // reach Store from an imported save code or a hand-edited localStorage,
      // and neither goes through the setter.
      const name = this.cleanName(this.playerName) || 'anon';
      const day = LUMEN.Daily ? LUMEN.Daily.todayStr() : '';
      const b = board === 'daily' ? 'daily' : 'alltime';
      const row = {
        name,
        score: Math.floor(score),
        combo: Math.floor(combo || 0),
        board: b,
        day: b === 'daily' ? (day || null) : null,
      };
      // Say who owns the row instead of trusting the column to default to
      // auth.uid(). It does not, and every row on the live board came back with
      // user_id null — which broke three things quietly and at once. The owner
      // could not DELETE their row, so account deletion reported failure and
      // left the entry on a public board (Guideline 5.1.1(v)). rename() could
      // not find the rows to rewrite. And the (user_id, board, day) index could
      // not dedupe, because NULLs never collide — which is why the same player's
      // 5000 sits on the board twice.
      const A = LUMEN.Auth;
      if (A && A.userId) row.user_id = A.userId;
      // A run of your own that got onto the board is the one case where the
      // cached copy is definitely wrong, so drop it.
      const done = () => { this.invalidate(b); };
      if (this._sb) {
        // Upsert, not insert. The table has one row per (user, board, day), so
        // a second personal best REPLACES the first instead of leaving a trail
        // of a player's own older scores across the board.
        return this._sbFetch('/scores', {
          method: 'POST',
          headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
          body: JSON.stringify(row),
        }).then((r) => { done(); return r; });
      }
      return this._fetch('/submit', { method: 'POST', body: JSON.stringify(row) })
        .then((r) => { done(); return r; });
    },

    // Fire-and-forget: a failed submit must never interrupt the game.
    submitQuietly(score, combo, board) {
      // A submit that CANNOT land must not be sent at all.
      //
      // The table is one row per authenticated player and row-level security
      // keys every write to auth.uid(), so a signed-out POST is refused by the
      // server. It was still being SENT, carrying the name the player typed —
      // on Android, where sign-in is switched off entirely (js/auth.js
      // canSignIn), that meant a name leaving the device on every run to be
      // thrown away at the far end. "The server rejects it" is not a data
      // declaration anyone should have to defend, and the request was useless
      // on every platform anyway.
      const A = LUMEN.Auth;
      if (!A || !A.enabled || !A.signedIn) return;
      if (!this.enabled || !(score > 0)) return;
      this.submit(score, combo, board).catch(() => {});
    },

    // Change the name on the rows you already own.
    //
    // The alternative is what happened before there were accounts: submit again
    // under the new name and leave the old one standing, so one player slowly
    // becomes several. With auth.uid() on the row this is one UPDATE, and the
    // database refuses to let it touch anybody else's.
    rename(newName) {
      const A = LUMEN.Auth;
      const name = this.cleanName(newName);
      if (!name) return Promise.reject(new Error('empty name'));
      this.playerName = name;
      if (!this._sb || !A || !A.signedIn) return Promise.resolve(0);
      return this._sbFetch('/scores?user_id=eq.' + encodeURIComponent(A.userId), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ name }),
      }).then(() => { this.invalidate(); return 1; });
    },

    // Remove every row this account owns. Used by account deletion, which has to
    // leave nothing behind on a board other people read.
    //
    // This needs a DELETE policy on the table. The project shipped with SELECT,
    // INSERT and UPDATE policies only, so a DELETE returned 200 with an empty
    // body — the polite way Postgres says "no row matched anything you are
    // allowed to touch". That looks exactly like success, so this checks what
    // actually went and reports false rather than lying to the caller.
    // Ask before deleting, because "nothing came back" has two meanings and only
    // one of them is a failure. A DELETE that RLS refused and a DELETE that
    // matched no row are the same answer: 200 with an empty body. Counting rows
    // alone therefore reports FAILURE for a player who simply never posted a
    // score — and that is the exact path App Review takes, since a reviewer
    // signs in, deletes the account, and never plays a run in between. It made a
    // working deletion say "the server did not confirm" on camera.
    deleteMine() {
      const A = LUMEN.Auth;
      if (!this._sb || !A || !A.signedIn) return Promise.resolve(false);
      const mine = '/scores?user_id=eq.' + encodeURIComponent(A.userId);
      return this._sbFetch(mine + '&select=user_id')
        .then((rows) => {
          // Nothing of theirs is on the board, so there is nothing to remove and
          // the post-condition the caller cares about already holds.
          if (!Array.isArray(rows) || rows.length === 0) return true;
          return this._sbFetch(mine, {
            method: 'DELETE',
            headers: { Prefer: 'return=representation' },
          }).then((gone) => Array.isArray(gone) && gone.length > 0);
        })
        .then((ok) => { this.invalidate(); return ok; })
        .catch(() => false);
    },

    // ---- holding a best until it has a name -------------------------------
    // There are no accounts here, so a row belongs to whoever typed the name on
    // it — which makes "anon" permanent. A player who set a personal best before
    // ever opening this screen had that best filed under a name shared with
    // every other silent player, and no later edit could reclaim it.
    //
    // So a nameless best waits. `hold` keeps the best per board (the daily's is
    // stamped with its day, because a daily board closes), and `flushPending`
    // sends it the moment a name exists.
    get named() { return !!this.cleanName(this.playerName); },

    // Is there still something standing between this player and the board?
    //
    // `named` used to be asked in place of this, and the two stopped meaning the
    // same thing on 23 August, when consent became a separate flag (bb9f623,
    // "Ask before publishing anyone" -- App Store 5.1.2). `lumen_name` has
    // existed since the first commit; `lumen_board_ok` is written in exactly one
    // place, the SAVE button on the name screen. So every player who had already
    // typed a name arrived at that release with a name and no consent, which is
    // `named` true and `canSubmit` false -- and the one line that would have
    // re-asked them, `if (!LB.named) openNameScreen()`, is guarded on the half
    // they already had. Their personal bests went to `hold()` instead of the
    // board, forever, with nothing on screen to say so.
    //
    // Asking the whole question in one place is what stops that recurring: a
    // third condition added later has one obvious home, and every caller gets it
    // for free.
    get needsSetup() {
      return !this.named || !(Store && Store.boardConsent);
    },

    // The shared board needs an account; the game does not.
    //
    // A name alone was never enough to own a row. Anyone could type any name,
    // including one already on the board, so "your" place was only yours until
    // somebody else typed it — and with nothing but a string to go on, no
    // request could tell the two apart. A verified user id can, which is the
    // whole reason an account exists here. Play, shop, daily, achievements and
    // MY RUNS all still work signed out.
    get canSubmit() {
      // …and consent, which is the one of these four that is not about whether
      // the upload CAN work. A name and an account make a row possible; only
      // this says the player asked for it. It is checked here rather than at
      // each call site because there are five of them — submitQuietly, the
      // flush, the seed, the rename and the board screen — and a new one added
      // later would otherwise ship without a gate.
      return this.enabled && !!(LUMEN.Auth && LUMEN.Auth.signedIn) && this.named
        && !!(Store && Store.boardConsent);
    },

    // A personal best set BEFORE there was an account is stranded, and this is
    // not a rare edge — it is every player who played before signing in.
    //
    // The board only ever hears about a run that beats Store.best, so somebody
    // whose record predates their account can never appear on it until they
    // beat a score they set when nobody was watching. Nothing says so. The
    // board simply never mentions them, and it reads as broken, because from
    // where the player sits it is indistinguishable from broken.
    //
    // So when the board first becomes usable, offer the record they already
    // hold. It goes through `hold`, so the existing flush path sends it and
    // `hold` still keeps whichever run is better.
    //
    // The daily board is deliberately not seeded: its best resets every day, so
    // the first daily run of any day is a best and submits by itself. Seeding
    // it would also mean publishing a score with a combo taken from some other
    // run, and a number on a public board should have happened.
    //
    // AND READ THE RIGHT LOCAL NUMBER. This asked LUMEN.Scores for the best run
    // in the history, which is not the record — js/scores.js keeps the last
    // FIFTY runs and pins the all-time best separately, precisely so that a good
    // week months ago cannot lock MY RUNS forever. Both halves of that design
    // are right; reading only one of them here was not.
    //
    // A player whose record predates their last fifty runs got seeded with the
    // best of those fifty instead — a smaller number — and then every run
    // afterwards was measured against the PINNED best by the gate in game.js,
    // which nothing below the record can pass. So the board froze at whatever
    // the seed happened to offer, and no amount of playing could move it: the
    // one path that could correct it ran only at sign-in, and it was the path
    // with the bug. Reported as "my best score does not drop onto the
    // leaderboard, it does not show even if I refresh", which is exactly what it
    // looks like from outside.
    //
    // The combo travels only with the run it belongs to. Store.bestCombo is the
    // best chain across ALL runs, not the chain of the best run, so pairing it
    // with the pinned score would put a number on a public board that never
    // happened — the same objection that keeps the daily out of this function.
    seedFromLocalBests() {
      if (!Store || !this._sb || !this.canSubmit) return Promise.resolve(false);
      const hist = LUMEN.Scores ? LUMEN.Scores.list('classic')[0] : null;
      const pinned = Math.max(0, Math.floor(+Store.best || 0));
      const score = Math.max(pinned, hist ? hist.s : 0);
      const combo = (hist && hist.s === score) ? hist.c : 0;
      const best = score > 0 ? { s: score, c: combo } : null;
      if (!best) return Promise.resolve(false);
      const A = LUMEN.Auth;
      // ASK THE BOARD, do not remember having asked.
      //
      // The first version of this kept a "already offered" flag on the device,
      // and it was wrong the moment the account changed underneath it: delete
      // the account, sign in as somebody new, and the flag still said done
      // while the new account's board was empty — so the player was stranded
      // again, exactly as before, and this time by the fix.
      //
      // What the flag was really trying to ask is what the board already holds
      // FOR THIS ACCOUNT. Asking that directly makes the offer idempotent by
      // construction: it can run on every sign-in without re-sending, and it
      // can never push a lower score over a higher one — which is what a device
      // flag could not promise after RESET PROGRESS either.
      return this._sbFetch('/scores?select=score&board=eq.alltime&user_id=eq.'
        + encodeURIComponent(A.userId))
        .then((rows) => {
          const have = Array.isArray(rows) && rows[0] ? (+rows[0].score || 0) : 0;
          if (best.s <= have) return false;
          this.hold(best.s, best.c, 'alltime');
          return true;
        })
        .catch(() => false);
    },

    hold(score, combo, board) {
      if (!Store || !(score > 0)) return;
      const b = board === 'daily' ? 'daily' : 'alltime';
      const day = b === 'daily' ? (LUMEN.Daily ? LUMEN.Daily.todayStr() : '') : '';
      const all = Store.pendingBest;
      const cur = all[b];
      // Only the better run is worth keeping — and a new day's daily replaces
      // yesterday's regardless of score, because they are different boards.
      if (cur && cur.day === day && cur.score >= score) return;
      all[b] = { score: Math.floor(score), combo: Math.floor(combo || 0), day };
      Store.pendingBest = all;
    },

    // Returns the boards that actually went up, so the caller can say something
    // true rather than something hopeful.
    flushPending() {
      const all = (Store && Store.pendingBest) || {};
      const boards = Object.keys(all);
      if (!boards.length || !this.canSubmit) return Promise.resolve([]);
      const today = LUMEN.Daily ? LUMEN.Daily.todayStr() : '';
      const jobs = boards.map((b) => {
        const p = all[b];
        if (!p || !(p.score > 0)) return Promise.resolve(null);
        if (b === 'daily' && p.day !== today) return Promise.resolve(null);  // that board has closed
        return this.submit(p.score, p.combo, b).then(() => b).catch(() => null);
      });
      return Promise.all(jobs).then((done) => {
        // Drop only what was sent. A failed submit keeps its entry so the next
        // attempt still has it; a stale daily is dropped either way.
        const left = Object.assign({}, all);
        done.filter(Boolean).forEach((b) => delete left[b]);
        if (left.daily && left.daily.day !== today) delete left.daily;
        Store.pendingBest = left;
        return done.filter(Boolean);
      });
    },
  };

  LUMEN.Leaderboard = Leaderboard;
})();
