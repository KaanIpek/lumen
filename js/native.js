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

    init() {
      if (!this.isApp && !this.isDesktop) return false;

      // A browser-chrome fullscreen toggle is meaningless in an app that is
      // already fullscreen, and on iOS the API doesn't exist at all.
      if (this.isApp) {
        const fs = document.getElementById('btn-fs');
        if (fs) fs.classList.add('hidden');
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
