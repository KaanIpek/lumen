/*
 * LUMEN — "there is a newer version"
 * -------------------------------------------------------------
 * An installed app is a frozen copy. Somebody who installed in August and never
 * opened the store again is still playing the August build, and every fix since
 * then — the speed ceiling, the leaderboard write, the account deletion — is
 * something they will never see. They have no way to know. So the game says it.
 *
 * WHERE THE ANSWER COMES FROM
 *   `release.json`, served from the game's own web deploy. No server, no key,
 *   no vendor: the same push that publishes the web build publishes the file
 *   the phones read. `tools/build-web.js` copies it into dist/ for exactly this.
 *
 * TWO STRENGTHS, AND WHY IT IS NOT ALWAYS THE HARD ONE
 *   build  <  minBuild  ->  BLOCKED. No close button, no way past it.
 *   build  <  build     ->  a prompt you can dismiss, offered once a day.
 *
 *   A hard block is a loaded gun pointed at the whole install base: one typo in
 *   a JSON file, or a store listing that takes six hours to go live, and every
 *   player is locked out of a game that was working fine. So `minBuild` stays at
 *   0 and is moved only for a build that is genuinely unsafe to keep playing.
 *   Wanting people on the new content is what the soft prompt is for.
 *
 * FAILS OPEN, ALWAYS
 *   No network, bad JSON, missing fields, plugin absent — every one of those
 *   paths ends in "say nothing and let them play". A version check must never
 *   be the reason someone cannot open the game on a train.
 *
 * WEB IS EXEMPT
 *   A browser already has the newest build; the service worker handles that.
 *   Telling a web player to "update" would point at a store page they cannot
 *   use.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  // Where the deployed copy of release.json lives. Overridable from config.js
  // so a fork does not have to edit source.
  const FEED = (LUMEN.CONFIG && LUMEN.CONFIG.releaseFeed)
    || 'https://kaanipek.github.io/lumen/release.json';

  const DAY = 86400000;
  const KEY_SEEN = 'lumen_upd_seen';    // ms timestamp of the last soft prompt

  const Update = {
    // Exposed for the tests, which drive this with fabricated versions rather
    // than by shipping a build and waiting a month.
    _compare(localBuild, feed) {
      // Anything we cannot read is not a reason to nag.
      if (!feed || typeof feed !== 'object') return { action: 'none', why: 'no feed' };
      const latest = parseInt(feed.build, 10);
      const min = parseInt(feed.minBuild, 10) || 0;
      const local = parseInt(localBuild, 10);
      if (!isFinite(latest) || latest <= 0) return { action: 'none', why: 'feed has no build' };
      // A build number we could not read is the app's fault, not the player's.
      // Guessing "0" here would hard-block everyone the moment minBuild moved.
      if (!isFinite(local) || local <= 0) return { action: 'none', why: 'no local build' };
      if (local < min) return { action: 'block', latest: latest, local: local };
      if (local < latest) return { action: 'prompt', latest: latest, local: local };
      return { action: 'none', why: 'current' };
    },

    // The soft prompt is offered once a day. The block ignores this entirely —
    // "remind me tomorrow" is not on the table for a build that must not run.
    _dueForPrompt(now) {
      try {
        const last = parseInt(localStorage.getItem(KEY_SEEN) || '0', 10) || 0;
        return (now - last) > DAY;
      } catch (e) { return true; }
    },
    _markPrompted(now) {
      try { localStorage.setItem(KEY_SEEN, String(now)); } catch (e) {}
    },

    storeUrl(feed) {
      const P = (window.Capacitor && window.Capacitor.Plugins) || null;
      const plat = (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || '';
      if (plat === 'android' && feed && feed.android) return feed.android;
      if (plat === 'ios' && feed && feed.ios) return feed.ios;
      return (feed && (feed.android || feed.ios)) || null;
    },

    open(feed) {
      const url = this.storeUrl(feed);
      if (!url) return false;
      const P = (window.Capacitor && window.Capacitor.Plugins) || null;
      try {
        // Browser plugin opens in the store app on both platforms; window.open
        // is the fallback when the plugin is not installed.
        if (P && P.Browser && P.Browser.open) P.Browser.open({ url: url });
        else window.open(url, '_blank');
        return true;
      } catch (e) { return false; }
    },

    async localBuild() {
      const P = (window.Capacitor && window.Capacitor.Plugins) || null;
      if (!P || !P.App || !P.App.getInfo) return null;
      try {
        const info = await P.App.getInfo();
        // Android gives a number, iOS a string; both are the store build.
        return info && info.build != null ? parseInt(info.build, 10) : null;
      } catch (e) { return null; }
    },

    async fetchFeed() {
      try {
        // cache: no-store, or a phone that checked once serves the same answer
        // for as long as the HTTP cache decides to keep it -- which is exactly
        // the situation this file exists to detect.
        const r = await fetch(FEED + '?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return null;
        return await r.json();
      } catch (e) { return null; }
    },

    // Called once at launch. Everything here is best-effort.
    async check() {
      const N = LUMEN.Native;
      if (!N || !N.isApp) return { action: 'none', why: 'not an installed app' };
      const local = await this.localBuild();
      if (local == null) return { action: 'none', why: 'no build number' };
      const feed = await this.fetchFeed();
      const verdict = this._compare(local, feed);
      if (verdict.action === 'none') return verdict;
      if (verdict.action === 'prompt' && !this._dueForPrompt(Date.now())) {
        return { action: 'none', why: 'asked today already' };
      }
      if (verdict.action === 'prompt') this._markPrompted(Date.now());
      if (LUMEN.UI && LUMEN.UI.showUpdate) LUMEN.UI.showUpdate(verdict.action, feed);
      return verdict;
    },
  };

  LUMEN.Update = Update;
})();
