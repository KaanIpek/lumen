/*
 * LUMEN — telemetry, consent, and the monetisation boundary
 * -------------------------------------------------------------
 * Three things live here because they share one gate: consent.
 *
 *  Analytics — anonymous gameplay events. NO personal data, no
 *    device fingerprint, no ad IDs. Off until the player agrees,
 *    and buffered locally so nothing is lost (or sent) meanwhile.
 *
 *  Consent   — a simple, honest opt-in. Defaults to OFF, which is
 *    what GDPR requires and what a player deserves.
 *
 *  Rewards   — the seam a rewarded-ad or IAP SDK plugs into. No
 *    SDK ships here (that needs real account keys), but the game
 *    only ever talks to this interface, so integrating one is a
 *    single file change instead of surgery on the game.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Store = LUMEN.Store;

  // ---- consent -------------------------------------------------------------
  const Consent = {
    // 'unset' | 'granted' | 'denied'
    get state() { return Store ? Store.consent : 'unset'; },
    get granted() { return this.state === 'granted'; },
    get asked() { return this.state !== 'unset'; },
    set(granted) {
      if (Store) Store.consent = granted ? 'granted' : 'denied';
      if (granted) Analytics.flush();
      else Analytics.clearBuffer();
    },
  };

  // ---- analytics -----------------------------------------------------------
  const MAX_BUFFER = 200;
  const Analytics = {
    // Set this to your collector to turn telemetry on. Left null so the game
    // ships private by default and never phones home by accident.
    endpoint: null,
    _session: null,

    sessionId() {
      // random per session, not persisted — this is not a user identifier
      if (!this._session) {
        this._session = 's' + Math.random().toString(36).slice(2, 10);
      }
      return this._session;
    },

    // Record an event. Safe to call unconditionally: it no-ops without consent.
    track(name, props) {
      if (!Consent.granted) return;
      const e = {
        t: Date.now(),
        s: this.sessionId(),
        n: name,
        p: props || {},
      };
      const buf = this._buffer();
      buf.push(e);
      while (buf.length > MAX_BUFFER) buf.shift();
      this._save(buf);
      if (this.endpoint && buf.length >= 20) this.flush();
    },

    _buffer() {
      try { const a = JSON.parse(Store._read('lumen_tele', '[]')); return Array.isArray(a) ? a : []; }
      catch (e) { return []; }
    },
    _save(buf) { Store._write('lumen_tele', JSON.stringify(buf)); },
    clearBuffer() { this._save([]); },

    // Ship what we have. Without an endpoint this just keeps the local buffer,
    // which is still useful — it's what a dev build inspects.
    flush() {
      if (!Consent.granted || !this.endpoint) return;
      const buf = this._buffer();
      if (!buf.length) return;
      this.clearBuffer();
      try {
        const body = JSON.stringify({ app: 'lumen', v: 1, events: buf });
        if (navigator.sendBeacon) navigator.sendBeacon(this.endpoint, body);
        else fetch(this.endpoint, { method: 'POST', body, keepalive: true }).catch(() => {});
      } catch (e) { /* never let telemetry break the game */ }
    },

    // What a dev build can read without any server at all.
    dump() { return this._buffer(); },
  };

  // ---- rewarded / purchase boundary ---------------------------------------
  // A provider registers itself here; the game never knows which one.
  const Rewards = {
    provider: null,   // { isRewardedReady(), showRewarded() -> Promise<bool>, ... }

    register(p) { this.provider = p; },
    get available() {
      return !!(this.provider && this.provider.isRewardedReady && this.provider.isRewardedReady());
    },
    // Resolves true if the player earned the reward (watched the whole thing).
    showRewarded(placement) {
      if (!this.available) return Promise.resolve(false);
      try {
        Analytics.track('reward_offer', { placement });
        return Promise.resolve(this.provider.showRewarded(placement)).then((ok) => {
          Analytics.track(ok ? 'reward_earned' : 'reward_abandoned', { placement });
          return !!ok;
        }).catch(() => false);
      } catch (e) { return Promise.resolve(false); }
    },
  };

  LUMEN.Consent = Consent;
  LUMEN.Analytics = Analytics;
  LUMEN.Rewards = Rewards;
})();
