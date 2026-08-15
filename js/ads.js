/*
 * LUMEN — rewarded ads
 * -------------------------------------------------------------
 * One kind of ad and one only: rewarded. The player asks for it, watches it,
 * and is paid. Nothing interrupts a run, nothing appears between menus, and
 * nothing has to be dismissed. An ad you did not ask for is a tax on playing;
 * an ad you chose is a trade.
 *
 * WHAT IT PAYS, AND WHY THAT NUMBER
 *   75 shards, three times a day.
 *
 *   The shop's real items cost 4,500 and 9,000. At 50 a player does the sum,
 *   sees ninety ads, and never watches one. Above 100 the ads become better
 *   than playing, which is the point where the game turns into a waiting room.
 *   75 is roughly what a good run pays — so an ad repeats a good run rather
 *   than replacing it, and the daily cap means it stays a top-up. Three a day
 *   is 225: a 4,500 item is about twenty days on ads alone, far less if you
 *   actually play. An accelerator, not a shortcut.
 *
 * TEST IDS ON PURPOSE
 *   These are Google's published sample units. They render the real ad UI and
 *   the real callbacks while serving nothing and earning nothing, which is
 *   exactly what is wanted before there is anything to earn from.
 *
 *   Swapping in real units is NOT just a config change. A live AdMob unit means
 *   the App Privacy declaration gains Device ID and "Used for Tracking: Yes",
 *   and iOS then requires the App Tracking Transparency prompt. Ship the real
 *   ids and the old declaration together and the store listing is a false
 *   statement. See docs/ADS.md.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Store = LUMEN.Store;

  // Google's own sample units. Public, documented, and safe to commit.
  const TEST = {
    ios:     { app: 'ca-app-pub-3940256099942544~1458002511',
               rewarded: 'ca-app-pub-3940256099942544/1712485313' },
    android: { app: 'ca-app-pub-3940256099942544~3347511713',
               rewarded: 'ca-app-pub-3940256099942544/5224354917' },
  };

  // A schedule, not a cap. Watch as many as you like; the third one is worth
  // less than the first and the seventh less again.
  //
  // A hard limit has to say "no" to somebody who wanted to keep going, and the
  // only thing that teaches is that the button lies. Diminishing returns say the
  // same thing without refusing: the first ads are worth roughly a good run,
  // and by the time grinding them would beat playing they are worth a third of
  // that. Nobody is stopped, and nobody is rewarded for stopping playing.
  const TIERS = [
    { upTo: 3, shards: 75 },
    { upTo: 6, shards: 50 },
    { upTo: Infinity, shards: 25 },
  ];

  const Ads = {
    TIERS,

    _plugin: null,
    _ready: false,

    // Same lesson as Sign in with Apple: Capacitor.Plugins.X only exists when
    // the plugin's own JS has been imported, and this project has no bundler.
    // Ask for the proxy by name instead of assuming it is there.
    get native() {
      const C = window.Capacitor;
      if (!C || !(C.isNativePlatform && C.isNativePlatform())) return null;
      if (this._plugin) return this._plugin;
      // LumenAds, ours — see mobile/ios-plugin/. The community plugin is gone:
      // it did not compile, and because that is a compile failure it stopped any
      // build being produced at all.
      if (C.Plugins && C.Plugins.LumenAds) return (this._plugin = C.Plugins.LumenAds);
      if (typeof C.registerPlugin === 'function') {
        try { return (this._plugin = C.registerPlugin('LumenAds')); } catch (e) { return null; }
      }
      return null;
    },

    get platform() {
      const C = window.Capacitor;
      const p = C && C.getPlatform ? C.getPlatform() : 'web';
      return p === 'ios' ? 'ios' : 'android';
    },

    // Real ids when they exist, Google's test units otherwise. The config is
    // where the switch happens, so turning ads on for real is one edit and one
    // deliberate privacy update rather than a code change.
    get units() {
      const c = (LUMEN.CONFIG && LUMEN.CONFIG.admob) || {};
      const live = c[this.platform];
      return (live && live.rewarded) ? live : TEST[this.platform];
    },
    get isTestAds() {
      const c = (LUMEN.CONFIG && LUMEN.CONFIG.admob) || {};
      return !(c[this.platform] && c[this.platform].rewarded);
    },

    // Available only where an ad can actually play. On the web there is no
    // rewarded ad and pretending otherwise would put a button on the menu that
    // fails every time it is pressed.
    //
    // The platform check is not redundant. Capacitor's registerPlugin hands back
    // a proxy on every native platform whether or not an implementation exists,
    // so `native` is truthy on Android too — and mobile/lumen-ads ships an ios/
    // directory and nothing else. Without this the Android build showed a
    // "watch for shards" button whose every press came back "not implemented".
    // Delete the check the day the Android side lands.
    // …and not while the units are Google's TEST units. Those render with a
    // "Test Ad" label burned into the creative, so every ad surface in the game
    // would show App Review a placeholder — read as unfinished functionality
    // under guideline 2.1 — while earning nothing, because test units do not
    // pay. Putting real ids in CONFIG.admob flips isTestAds and every surface
    // returns on its own; nothing else has to change. That is the whole point
    // of the seam described at the top of this file.
    get available() {
      // Both platforms now: mobile/lumen-ads ships an android/ directory with
      // the same four-method contract, so there is nothing left to gate on.
      return !!this.native && !this.isTestAds;
    },

    // Whether the player let Google read the advertising identifier. Null until
    // asked. Non-personalised ads are the answer to "no", not an error.
    trackingStatus: null,

    init() {
      const p = this.native;
      if (!p || this._ready) return Promise.resolve(this._ready);
      // Ask about tracking BEFORE starting the SDK, never after. The answer
      // decides what Google may read, and a session that has already started
      // does not go back and reconsider. Whatever the player says — including
      // saying nothing, on a build where the prompt cannot appear — the SDK
      // starts either way and simply serves less valuable ads.
      const ask = p.requestTracking
        ? p.requestTracking().then((r) => { this.trackingStatus = (r && r.status) || null; })
            .catch(() => { this.trackingStatus = 'error'; })
        : Promise.resolve();
      return ask
        .then(() => p.initialize())
        .then(() => (this._ready = true))
        .catch(() => false);
    },

    // ---- the daily allowance ----------------------------------------------
    // Stored as "YYYY-MM-DD:n" so a new day resets it without a timer, and a
    // clock moved backwards cannot mint extra views: a stamp that is not
    // today's is simply a fresh day with zero used.
    _today() {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
        + '-' + String(d.getDate()).padStart(2, '0');
    },
    get usedToday() {
      const raw = String((Store && Store.adsToday) || '');
      const [day, n] = raw.split(':');
      return day === this._today() ? (parseInt(n, 10) || 0) : 0;
    },
    // What the NEXT one pays. Shown on the button, so the trade is stated before
    // it is made rather than discovered afterwards.
    rewardFor(n) {
      for (const t of TIERS) if (n < t.upTo) return t.shards;
      return TIERS[TIERS.length - 1].shards;
    },
    get nextReward() { return this.rewardFor(this.usedToday); },
    // Kept because the UI asks: there is no limit any more, so there is always
    // one more available.
    get left() { return Infinity; },
    _spend() {
      if (Store) Store.adsToday = this._today() + ':' + (this.usedToday + 1);
    },

    // ---- watching one -----------------------------------------------------
    // Resolves with the shards paid, or 0 if nothing was earned. It NEVER
    // rejects for an ordinary outcome — closing an ad early is a choice, not an
    // error, and treating it as one teaches players the feature is broken.
    watch() {
      const p = this.native;
      if (!p) return Promise.resolve(0);
      const pay = this.nextReward;
      const opts = { adId: this.units.rewarded };
      return this.init()
        .then(() => p.prepare(opts))
        .then(() => p.show())
        .then((r) => {
          // The plugin resolves with the reward when one was earned. No reward
          // means the ad was dismissed early, which pays nothing and costs
          // nothing — the allowance is only spent on a completed view.
          if (!r || !r.earned) return 0;
          this._spend();
          if (LUMEN.Cosmetics && LUMEN.Cosmetics.grantShards) LUMEN.Cosmetics.grantShards(pay);
          else if (Store) Store.shards = Store.shards + pay;
          if (LUMEN.Analytics) LUMEN.Analytics.track('ad_reward', { shards: pay, test: this.isTestAds });
          return pay;
        })
        .catch((e) => {
          // Keep WHY. A bare 0 became "no ad right now", which is the same
          // sentence whether the SDK never started, the unit is wrong, or there
          // genuinely was no fill — and the person testing it could only ever
          // report the sentence back to me.
          this.lastError = String((e && e.message) || e || 'unknown');
          return 0;
        });
    },
  };

  // ---- watching one to carry on -----------------------------------------
  // Deliberately separate from watch(): this pays no shards, spends no part of
  // the schedule above, and answers a different question. It is also the moment
  // a player most wants an ad to exist, which is exactly why it must not be the
  // only way to continue — the shard price stays.
  Ads.watchToRevive = function () {
    const p = this.native;
    if (!p) return Promise.resolve(false);
    return this.init()
      .then(() => p.prepare({ adId: this.units.rewarded }))
      .then(() => p.show())
      .then((r) => !!(r && r.earned))
      .catch(() => false);
  };

  LUMEN.Ads = Ads;
})();
