/*
 * LUMEN — installed-app behaviour
 * -------------------------------------------------------------
 * Small differences between "a page in a browser" and "an app on a phone".
 * All of it is inert in a normal tab.
 *
 * The Capacitor plugins are reached through `window.Capacitor.Plugins`, which
 * the native bridge injects at runtime, rather than by importing them. This
 * game has no bundler and is not getting one for three event listeners.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  const cap = () => (window.Capacitor && window.Capacitor.Plugins) || null;

  const Native = {
    get isApp() { return !!(window.LUMEN_NATIVE || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())); },
    get isDesktop() { return !!window.LUMEN_STEAM; },

    // iOS specifically, because one feature is not allowed to exist there.
    //
    // App Review rejected 1.0.3 under guideline 3.1.1: "the app uses code
    // redemption to unlock or enable digital features". A promo code can mint
    // shards and unlock cosmetics, and both of those are sold as in-app
    // purchases — so on Apple's platform that is an alternative payment
    // mechanism, whatever it is called. It stays on Android and on the web,
    // where promo codes are ordinary marketing; it is removed from iOS.
    get isIOS() {
      try {
        const C = window.Capacitor;
        if (C && typeof C.getPlatform === 'function') return C.getPlatform() === 'ios';
      } catch (e) { /* fall through */ }
      return !!(window.LUMEN_NATIVE && window.LUMEN_NATIVE.platform === 'ios');
    },

    init() {
      if (!this.isApp && !this.isDesktop) return false;

      // A browser-chrome fullscreen toggle is meaningless in an app that is
      // already fullscreen, and on iOS the API doesn't exist at all.
      if (this.isApp) {
        const fs = document.getElementById('btn-fs');
        if (fs) fs.classList.add('hidden');
      }

      // Guideline 3.1.1. Removed rather than merely hidden: the input is taken
      // out of the document entirely, so it cannot be reached by a reviewer
      // poking at the DOM, by a stale screenshot, or by focus order. Perks.redeem
      // refuses on iOS as well — a hidden control whose code path still works is
      // the shape of bug that gets an app rejected twice.
      if (this.isIOS) {
        const sec = document.getElementById('code-section');
        if (sec && sec.parentNode) sec.parentNode.removeChild(sec);
      }

      this.wireBackButton();
      return true;
    },

    // ANDROID BACK. Without this, back closes the whole app from anywhere —
    // including from inside the shop, which reads as a crash. Back should mean
    // "up one level", and only leave the game from the menu itself.
    wireBackButton() {
      const P = cap();
      if (!P || !P.App || !P.App.addListener) return;
      P.App.addListener('backButton', () => {
        const g = LUMEN.game, UI = LUMEN.UI;
        if (!g || !UI) return;
        const open = UI.currentScreen;
        // A BLOCKING update screen is the one modal back does not close. It is
        // shown for a build that must not keep running, and a dialog you can
        // dismiss with the system button is not a block -- it is a suggestion
        // with extra steps.
        if (open === 'update' && UI._updateBlocking) return;
        // a modal over the menu → close it
        if (open && open !== 'menu') {
          if (open === 'checkout') { UI._checkoutResolve && UI._checkoutResolve(false); return; }
          UI.showScreen('menu');
          return;
        }
        // mid-run → pause; paused → back to the menu
        if (g.state === 'play' && !g.attract) { g.pause(); return; }
        if (g.state === 'pause' || g.state === 'dead') { g.toMenu(); return; }
        // already at the menu: this is the one place back means "leave"
        if (P.App.exitApp) P.App.exitApp();
      });
    },
  };

  LUMEN.Native = Native;
})();
