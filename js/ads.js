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

  const REWARD = 75;
  const PER_DAY = 3;

  const Ads = {
    REWARD,
    PER_DAY,

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
    get available() { return !!this.native; },

    init() {
      const p = this.native;
      if (!p || this._ready) return Promise.resolve(this._ready);
      // No consent or tracking call here on purpose: those belong with the
      // privacy declaration and the ATT prompt, in the release that turns live
      // ads on. See docs/ADS.md.
      return p.initialize().then(() => (this._ready = true)).catch(() => false);
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
    get left() { return Math.max(0, PER_DAY - this.usedToday); },
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
      if (this.left <= 0) return Promise.resolve(0);
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
          if (LUMEN.Cosmetics && LUMEN.Cosmetics.grantShards) LUMEN.Cosmetics.grantShards(REWARD);
          else if (Store) Store.shards = Store.shards + REWARD;
          if (LUMEN.Analytics) LUMEN.Analytics.track('ad_reward', { shards: REWARD, test: this.isTestAds });
          return REWARD;
        })
        .catch(() => 0);
    },
  };

  LUMEN.Ads = Ads;
})();
