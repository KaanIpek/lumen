/*
 * LUMEN — developer cheats
 * -------------------------------------------------------------
 * Tools for building and testing the game, not for playing it.
 *
 * Two rules make this safe to leave in the source tree:
 *
 *  1. IT CANNOT TURN ON IN A SHIPPED BUILD. `available` requires either an
 *     explicit `window.LUMEN_DEV = true`, or a localhost / private-LAN origin.
 *
 *     This claim was FALSE for months and worth reading twice. `file://` used
 *     to count as a developer origin, and the desktop build loads the game with
 *     win.loadFile() — so every Steam customer had cheats live, with a keydown
 *     listener waiting for `idkfa`. The lesson is that a URL scheme is not an
 *     identity: shipped products use file:// and https://localhost too. Both
 *     packaging paths now also drop this file entirely, so the gate is a second
 *     line of defence rather than the only one.
 *
 *  2. A CHEATED RUN IS NEVER RECORDED. The moment any cheat is used the run is
 *     flagged, and `finalizeRun` throws the whole thing away: no score, no best,
 *     no shards, no missions, no achievements, no leaderboard submission, no
 *     lifetime stats. Otherwise a five-second test would poison the save file
 *     and the online board with numbers nobody earned.
 *
 * Usage — from the browser console:
 *
 *   LUMEN.cheat.help()          list everything
 *   LUMEN.cheat.god()           stop dying
 *   LUMEN.cheat.shards(5000)    top up the wallet
 *   LUMEN.cheat.unlockAll()     own every cosmetic
 *
 * Or in-game, type the word `idkfa` to toggle god mode. (One nod to Doom.)
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  // Where a developer can be, and a player cannot.
  //
  // `file:` USED TO BE ON THIS LIST and it was wrong: the desktop build calls
  // win.loadFile(), so every Steam customer was on a "developer" origin with
  // cheats live and a keyboard listener waiting for `idkfa`. Guessing at who
  // someone is from their URL scheme cannot work when shipped products use the
  // same schemes — Capacitor serves mobile from https://localhost too.
  //
  // So an explicit opt-in wins over any sniffing: set window.LUMEN_DEV = true.
  // Opening index.html straight from disk no longer enables cheats; run
  // PLAY.bat instead, which serves over localhost and is what the microphone
  // needs anyway.
  const devOrigin = () => {
    if (window.LUMEN_DEV === true) return true;
    if (location.protocol === 'file:') return false;
    const h = location.hostname;
    if (!h) return false;
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    if (h.endsWith('.localhost') || h.endsWith('.local')) return true;
    // private LAN ranges, for testing on a real phone over wifi
    return /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  };

  const Cheats = {
    get available() { return devOrigin(); },
    active: false,          // has anything been used this run?
    god: false,
    freeze: false,          // stop the world scrolling, to study a gate

    // ---- plumbing ----------------------------------------------------------
    _game() { return LUMEN.game; },
    _mark(what) {
      this.active = true;
      const g = this._game();
      if (g) g.cheated = true;                             // the run is now worthless
      this._say(what);
      return true;
    },
    _say(msg) {
      // The console line is the one thing that must always happen. A cheat is
      // often used from a page where the UI isn't mounted (the test harness, a
      // bare canvas), and a missing toast element must not take the cheat — or
      // whatever called it — down with it.
      try { LUMEN.UI && LUMEN.UI.toast && LUMEN.UI.toast('⚙ ' + msg); } catch (e) { /* no UI here */ }
      // eslint-disable-next-line no-console
      console.log('%c[cheat]%c ' + msg, 'color:#4df3ff;font-weight:700', '');
    },
    _guard() {
      if (this.available) return true;
      // eslint-disable-next-line no-console
      console.warn('[cheat] developer cheats are unavailable on this origin');
      return false;
    },

    // ---- the cheats --------------------------------------------------------
    toggleGod() {
      if (!this._guard()) return false;
      this.god = !this.god;
      const g = this._game();
      if (g) g.invuln = this.god ? Infinity : 0;
      return this._mark('god mode ' + (this.god ? 'ON' : 'off'));
    },

    shards(n) {
      if (!this._guard()) return false;
      const add = Math.max(0, Math.floor(n == null ? 1000 : n));
      LUMEN.Store.shards = LUMEN.Store.shards + add;
      LUMEN.UI && LUMEN.UI.refreshMenu && LUMEN.UI.refreshMenu();
      LUMEN.UI && LUMEN.UI.renderShop && LUMEN.UI.renderShop();
      return this._mark('+' + add + ' shards');
    },

    unlockAll() {
      if (!this._guard()) return false;
      const C = LUMEN.Cosmetics;
      let n = 0;
      for (const it of C.SKINS.concat(C.TRAILS, C.MAPS)) if (C.grant(it.id)) n++;
      LUMEN.UI && LUMEN.UI.renderShop && LUMEN.UI.renderShop();
      return this._mark('unlocked ' + n + ' cosmetics');
    },

    // Give yourself the full hand of consumables mid-run, to test the buttons.
    items() {
      if (!this._guard()) return false;
      const g = this._game();
      if (!g) return false;
      for (const it of LUMEN.Progression.ITEMS) g.hand[it.id] = LUMEN.Progression.MAX_PER_TYPE;
      return this._mark('hand filled');
    },

    // Jump the difficulty ramp forward: `skip(60)` plays as if 60s had elapsed.
    skip(sec) {
      if (!this._guard()) return false;
      const g = this._game();
      if (!g) return false;
      g.elapsed += Math.max(0, sec == null ? 30 : sec);
      return this._mark('skipped to ' + Math.round(g.elapsed) + 's');
    },

    score(n) {
      if (!this._guard()) return false;
      const g = this._game();
      if (!g) return false;
      g.score = Math.max(0, Math.floor(n == null ? 10000 : n));
      return this._mark('score = ' + Math.floor(g.score));
    },

    combo(n) {
      if (!this._guard()) return false;
      const g = this._game();
      if (!g) return false;
      g.combo = Math.max(0, Math.floor(n == null ? 20 : n));
      g.comboTimer = 4;
      if (g.combo > g.bestComboRun) g.bestComboRun = g.combo;
      return this._mark('combo = ' + g.combo);
    },

    // Straight into flow, which is otherwise a minute of good play away.
    flow() {
      if (!this._guard()) return false;
      const g = this._game();
      if (!g) return false;
      g.combo = Math.max(g.combo, (g.mod ? g.mod.flowAt : 16));
      g.comboTimer = 6;
      return this._mark('flow armed');
    },

    // Stop the world so a gate can be looked at properly.
    toggleFreeze() {
      if (!this._guard()) return false;
      this.freeze = !this.freeze;
      return this._mark('freeze ' + (this.freeze ? 'ON' : 'off'));
    },

    clearGates() {
      if (!this._guard()) return false;
      const g = this._game();
      if (!g) return false;
      g.obstacles.length = 0;
      return this._mark('gates cleared');
    },

    // Every achievement at once, to look at the page in its finished state.
    achievements() {
      if (!this._guard()) return false;
      const P = LUMEN.Progression, S = LUMEN.Store;
      S.best = Math.max(S.best, 99999); S.bestCombo = Math.max(S.bestCombo, 99);
      S.flowCount = 9999; S.motes = 99999; S.nearMissTotal = 9999;
      S.bestTime = 9999; S.runs = 9999; S.reviveCount = 99;
      const fresh = P.check();
      LUMEN.UI && LUMEN.UI.renderProgress && LUMEN.UI.renderProgress();
      return this._mark('granted ' + fresh.length + ' achievements');
    },

    // Put the save file back to a fresh install, cheat flags included.
    wipe() {
      if (!this._guard()) return false;
      for (const k of Object.keys(localStorage)) if (k.indexOf('lumen') === 0) localStorage.removeItem(k);
      LUMEN.Store._invalidate && LUMEN.Store._invalidate();
      LUMEN.Cosmetics && LUMEN.Cosmetics.invalidate();
      this.god = false; this.freeze = false; this.active = false;
      LUMEN.UI && LUMEN.UI.refreshMenu && LUMEN.UI.refreshMenu();
      return this._mark('save wiped');
    },

    help() {
      const rows = [
        ['god()', 'toggle invulnerability'],
        ['shards(n = 1000)', 'add shards'],
        ['unlockAll()', 'own every skin, trail and map'],
        ['items()', 'fill your hand with consumables'],
        ['skip(sec = 30)', 'jump the difficulty ramp forward'],
        ['score(n = 10000)', 'set the running score'],
        ['combo(n = 20)', 'set the combo'],
        ['flow()', 'arm flow state'],
        ['freeze()', 'toggle world scrolling'],
        ['clearGates()', 'remove every gate on screen'],
        ['achievements()', 'grant them all'],
        ['wipe()', 'reset the save file'],
      ];
      // eslint-disable-next-line no-console
      console.log('%cLUMEN developer cheats%c\n' +
        rows.map((r) => '  LUMEN.cheat.' + r[0] + new Array(Math.max(1, 26 - r[0].length)).join(' ') + r[1]).join('\n') +
        '\n\nA run that used any of these is discarded — nothing is saved or submitted.',
        'color:#4df3ff;font-weight:700', '');
      return rows.length;
    },
  };

  // Aliases that read better at a console prompt.
  Cheats.freeze_ = Cheats.toggleFreeze;
  const api = {
    help: () => Cheats.help(),
    god: () => Cheats.toggleGod(),
    shards: (n) => Cheats.shards(n),
    unlockAll: () => Cheats.unlockAll(),
    items: () => Cheats.items(),
    skip: (s) => Cheats.skip(s),
    score: (n) => Cheats.score(n),
    combo: (n) => Cheats.combo(n),
    flow: () => Cheats.flow(),
    freeze: () => Cheats.toggleFreeze(),
    clearGates: () => Cheats.clearGates(),
    achievements: () => Cheats.achievements(),
    wipe: () => Cheats.wipe(),
    get on() { return Cheats.available; },
  };

  LUMEN.Cheats = Cheats;

  if (Cheats.available) {
    LUMEN.cheat = api;
    // A typed word, so god mode is reachable on a device with no console.
    let buf = '';
    window.addEventListener('keydown', (e) => {
      if (!e.key || e.key.length !== 1) return;
      buf = (buf + e.key.toLowerCase()).slice(-8);
      if (buf.endsWith('idkfa')) { buf = ''; Cheats.toggleGod(); }
      else if (buf.endsWith('idclip')) { buf = ''; Cheats.toggleFreeze(); }
    });
    // eslint-disable-next-line no-console
    console.log('%cLUMEN%c dev build — cheats available. Type %cLUMEN.cheat.help()%c',
      'color:#4df3ff;font-weight:700', '', 'color:#ffd15c', '');
  }
})();
