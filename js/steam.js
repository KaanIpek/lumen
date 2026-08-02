/*
 * LUMEN — Steam integration seam
 * -------------------------------------------------------------
 * Same shape as `js/iap.js`: the game talks to an interface, and something
 * else decides whether that interface is real.
 *
 * On the web this file does nothing at all — `available` is false, every call
 * is a no-op, and no code path changes. Inside the desktop build the Electron
 * preload injects `window.LUMEN_STEAM`, and from that moment achievements and
 * scores also go to Steam. The game never learns which world it is in.
 *
 * Why a bridge rather than calling Steamworks directly: the Steamworks SDK is a
 * native module. It cannot be imported into a renderer, cannot exist in a
 * browser build, and must not be reachable from page JavaScript. Everything
 * crosses one narrow, explicitly-listed channel (see desktop/preload.js).
 *
 * Achievement ids are the game's own ids, uppercased — `flow2` becomes
 * `ACH_FLOW2` — so the Steamworks partner page is filled in from
 * `LUMEN.Progression.ACHIEVEMENTS` and nothing has to be kept in sync by hand.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  const Steam = {
    get bridge() { return window.LUMEN_STEAM || null; },
    get available() { return !!(this.bridge && this.bridge.ready); },
    get name() { return this.available ? (this.bridge.playerName || '') : ''; },

    apiId(achievementId) { return 'ACH_' + String(achievementId).toUpperCase(); },

    // Fired for every achievement the run just earned. Steam ignores repeats, so
    // this is safe to call with anything.
    unlock(ids) {
      if (!this.available || !ids || !ids.length) return 0;
      let n = 0;
      for (const id of ids) {
        try { if (this.bridge.unlock(this.apiId(id))) n++; } catch (e) { /* never break a run */ }
      }
      return n;
    },

    // Push everything the player already has — used once at boot so a save
    // restored from another device (or the web build) reconciles with Steam.
    syncAll() {
      if (!this.available || !LUMEN.Progression) return 0;
      return this.unlock(LUMEN.Store.achievements || []);
    },

    // Only Classic and the Daily are comparable, so only they go to a board —
    // exactly the rule the in-game leaderboard already follows.
    submitScore(score, board) {
      if (!this.available) return false;
      try { this.bridge.submitScore(Math.floor(score), board || 'alltime'); return true; }
      catch (e) { return false; }
    },

    // Steam Cloud gets the same transfer string the player can copy by hand, so
    // there is exactly one save format and one thing that can go wrong.
    cloudSave() {
      if (!this.available || !LUMEN.Save) return false;
      try { return !!this.bridge.cloudWrite(LUMEN.Save.export()); } catch (e) { return false; }
    },
    cloudLoad() {
      if (!this.available || !LUMEN.Save) return null;
      try { return this.bridge.cloudRead() || null; } catch (e) { return null; }
    },

    // Called once at boot from the desktop build.
    init() {
      if (!this.available) return false;
      this.syncAll();
      // Persist to the cloud when the player leaves, not on every change — a
      // write per shard would hammer the API for no benefit.
      window.addEventListener('pagehide', () => this.cloudSave());
      return true;
    },
  };

  LUMEN.Steam = Steam;
})();
