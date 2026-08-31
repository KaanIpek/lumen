/*
 * LUMEN — redeem codes and the daily reward
 * -------------------------------------------------------------
 * Two small features that share one idea: the answer comes from the SERVER,
 * because neither of them can be trusted to the device.
 *
 *   A CODE cannot live in this file. The repository is public and this script
 *   ships inside every build, so anything written here is readable by anyone
 *   who wants it — and shards are also sold, so a legible code that mints them
 *   is a hole in the shop rather than a promotion. The client sends the string
 *   the player typed and is told what, if anything, it was worth.
 *
 *   A DAY cannot come from `new Date()`. That is the phone's clock, and a
 *   phone's clock is whatever its owner sets it to. `claim_daily()` reads the
 *   date on the database and refuses a second collection on the same one.
 *
 * Both need an account, which is a real cost: the game plays offline and signed
 * out, and these two screens will not. They say so rather than failing, and
 * signing in is offered from the same place — see js/ui.js.
 *
 * supabase/codes-and-daily.sql holds the tables, the policies and the two
 * functions. Nothing here works until that has been run once.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  // NOT `Rewards` — js/analytics.js already owns that name for the rewarded-ad
  // provider seam, and assigning over it here left LUMEN.Rewards.available
  // undefined, which is every ad button in the game silently switched off.
  const Perks = {
    // The board module already carries the project url and key, and there is no
    // reason for a second copy of either to exist.
    get _sb() { return (LUMEN.Leaderboard && LUMEN.Leaderboard._sb) || null; },
    get enabled() { return !!this._sb; },
    get signedIn() { return !!(LUMEN.Auth && LUMEN.Auth.signedIn); },

    // Every call here is a Postgres function, never a table. The tables are
    // reachable for reading your own rows and for nothing else; the writes
    // happen inside SECURITY DEFINER functions that take the identity from
    // auth.uid() and never from an argument, so there is no parameter to lie
    // about.
    _rpc(name, body, retried) {
      const s = this._sb;
      if (!s) return Promise.reject(new Error('no project'));
      const A = LUMEN.Auth;
      if (!A || !A.token) return Promise.reject(new Error('signin'));
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = setTimeout(() => ctl && ctl.abort(), 8000);
      return fetch(s.url + '/rest/v1/rpc/' + name, {
        method: 'POST',
        signal: ctl && ctl.signal,
        headers: {
          apikey: s.key,
          Authorization: 'Bearer ' + A.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body || {}),
      })
        .then((r) => {
          // An access token lasts an hour and nothing here refreshed it, so
          // both screens died permanently part-way through a long session and
          // only a restart brought them back — reported as "no connection",
          // which is not what happened. One refresh, one retry, then give up
          // honestly.
          if (r.status === 401 && !retried && LUMEN.Auth && LUMEN.Auth.refresh) {
            return LUMEN.Auth.refresh().then(
              () => this._rpc(name, body, true),
              () => { throw new Error('signin'); }
            );
          }
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .finally(() => clearTimeout(t));
    },

    // ---- codes -------------------------------------------------------------

    // Resolves { ok, reason } — never rejects for a reason the player caused, so
    // the caller has one shape to render. `reason` is an i18n key suffix:
    // signin / unknown / expired / usedup / already / offline.
    // Which codes this device has actually APPLIED, as opposed to which the
    // server has recorded. They come apart when a reply is lost, and that gap
    // is what used to destroy the reward.
    _applied() {
      try { return JSON.parse(localStorage.getItem('lumen_codes') || '[]') || []; }
      catch (e) { return []; }
    },
    _markApplied(code) {
      const seen = this._applied();
      if (seen.indexOf(code) >= 0) return;
      seen.push(code);
      try { localStorage.setItem('lumen_codes', JSON.stringify(seen)); } catch (e) { /* full */ }
    },

    // Whether this build may redeem at all. iOS may not: a code mints shards and
    // unlocks cosmetics, both of which are sold as in-app purchases, and App
    // Review called that out under guideline 3.1.1 on 1.0.3. Android and the web
    // are untouched — a promo code is ordinary marketing there.
    get canRedeem() { return !(LUMEN.Native && LUMEN.Native.isIOS); },

    redeem(code) {
      // Checked FIRST, before the input is even looked at, so no path through
      // this function can reach the server on iOS. The UI is removed too; this
      // is the second lock, because a removed button and a live code path is
      // exactly how a feature comes back by accident.
      if (!this.canRedeem) return Promise.resolve({ ok: false, reason: 'unavailable' });
      const typed = String(code || '').trim();
      if (!typed) return Promise.resolve({ ok: false, reason: 'unknown' });
      if (!this.enabled) return Promise.resolve({ ok: false, reason: 'offline' });
      if (!this.signedIn) return Promise.resolve({ ok: false, reason: 'signin' });
      return this._rpc('redeem_promo', { p_code: typed })
        .then((res) => {
          if (!res) return { ok: false, reason: 'unknown' };
          if (!res.ok) {
            // "You already used that" ALSO arrives when the previous attempt
            // committed on the server and the reply never got back — the code
            // was burnt and nothing was paid. The server hands the grant back
            // with the refusal for exactly this case; apply it once, keyed on
            // what this device has recorded receiving.
            if (res.reason === 'already' && res.grant && res.code
                && this._applied().indexOf(res.code) < 0) {
              const got = this.apply(res.grant);
              this._markApplied(res.code);
              return { ok: true, code: res.code, got, recovered: true };
            }
            return { ok: false, reason: res.reason || 'unknown' };
          }
          const got = this.apply(res.grant);
          if (res.code) this._markApplied(res.code);
          return { ok: true, code: res.code, got };
        })
        .catch((e) => ({ ok: false, reason: e && e.message === 'signin' ? 'signin' : 'offline' }));
    },

    // Turn a grant into things the player owns. Deliberately additive: a grant
    // never takes anything away, so redeeming a smaller code after a bigger one
    // cannot undo the bigger one.
    apply(grant) {
      const g = grant || {};
      const out = { shards: 0, unlocked: 0 };
      const C = LUMEN.Cosmetics;
      if (C && (g.unlockAll || (g.unlocks && g.unlocks.length))) {
        // EVERY catalogue. There are five, and an earlier attempt at this
        // counted three — signatures were simply missing, and nothing said so
        // because a shorter list still looks like a full one.
        const all = g.unlockAll
          ? [].concat(C.SKINS || [], C.TRAILS || [], C.MAPS || [], C.SIGNATURES || []).map((i) => i.id)
          : g.unlocks;
        for (const id of all) { if (C.grant(id)) out.unlocked++; }
        if (g.unlockAll && C.SETS && LUMEN.Store) {
          // The sets are recorded separately, or the shop keeps offering a
          // bundle whose every piece is already owned.
          let owned = [];
          try { owned = JSON.parse(localStorage.getItem('lumen_iap') || '[]') || []; } catch (e) { owned = []; }
          for (const s of C.SETS) if (owned.indexOf(s.id) < 0) owned.push(s.id);
          try { localStorage.setItem('lumen_iap', JSON.stringify(owned)); } catch (e) { /* full or blocked */ }
        }
      }
      const n = Math.max(0, Math.floor(+g.shards || 0));
      if (n > 0 && LUMEN.Store) {
        if (C && C.grantShards) C.grantShards(n);
        else LUMEN.Store.shards = LUMEN.Store.shards + n;
        out.shards = n;
      }
      if (C && C.invalidate) C.invalidate();
      return out;
    },

    // ---- the daily reward --------------------------------------------------

    // { ok, claimed, streak, shards|next } or { ok:false, reason }.
    status() {
      if (!this.enabled) return Promise.resolve({ ok: false, reason: 'offline' });
      if (!this.signedIn) return Promise.resolve({ ok: false, reason: 'signin' });
      return this._rpc('daily_status')
        .then((r) => {
          if (!r) return { ok: false, reason: 'offline' };
          // The claim commits before it answers, so a lost reply leaves the day
          // taken and the wallet untouched. The server now reports what today
          // was worth; if this device never recorded receiving it, settle up.
          if (r.ok && r.claimed && r.shards > 0 && this._paidDay() !== r.day) {
            this.apply({ shards: r.shards });
            this._markPaid(r.day);
            // A COPY, never a mutation of the reply. Writing the flag onto the
            // server's object means a caller that holds or re-reads it sees a
            // recovery that already happened, and reports it a second time.
            return Object.assign({}, r, { recovered: r.shards });
          }
          return r;
        })
        .catch((e) => ({ ok: false, reason: e && e.message === 'signin' ? 'signin' : 'offline' }));
    },

    claim() {
      if (!this.enabled) return Promise.resolve({ ok: false, reason: 'offline' });
      if (!this.signedIn) return Promise.resolve({ ok: false, reason: 'signin' });
      return this._rpc('claim_daily')
        .then((res) => {
          if (!res) return { ok: false, reason: 'offline' };
          if (!res.ok) {
            // Refused because today is already taken — which is also what a
            // lost reply looks like from here. Same settlement as status().
            if (res.reason === 'today' && res.shards > 0 && this._paidDay() !== this._today(res)) {
              this.apply({ shards: res.shards });
              this._markPaid(this._today(res));
              return { ok: true, streak: res.streak, shards: res.shards, next: res.next, recovered: true };
            }
            return { ok: false, reason: res.reason || 'offline', streak: res.streak, next: res.next };
          }
          this.apply({ shards: res.shards });
          this._markPaid(res.day);
          return res;
        })
        .catch((e) => ({ ok: false, reason: e && e.message === 'signin' ? 'signin' : 'offline' }));
    },

    // The last day this DEVICE actually received a payment for. Compared against
    // the day the server says is claimed; a difference means a reply was lost.
    _paidDay() {
      try { return localStorage.getItem('lumen_daily_paid') || ''; } catch (e) { return ''; }
    },
    _markPaid(day) {
      try { localStorage.setItem('lumen_daily_paid', String(day || '')); } catch (e) { /* full */ }
    },
    // claim_daily's refusal has no `day`; it is by definition today's.
    _today(res) { return (res && res.day) || new Date().toISOString().slice(0, 10); },

    // The ladder again, for the screen only. The SERVER decides what is paid —
    // this is here so the seven days can be drawn before the answer arrives, and
    // is checked against the server's own values by the test suite.
    LADDER: [60, 85, 120, 170, 240, 320, 500],
    rewardFor(streak) {
      const n = Math.max(1, Math.floor(streak || 1));
      return this.LADDER[Math.min(n, this.LADDER.length) - 1];
    },
  };

  LUMEN.Perks = Perks;
})();
