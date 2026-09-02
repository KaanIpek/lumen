/*
 * LUMEN — UI controller
 * Wires the HTML overlays / buttons to the game instance, and drives
 * the menu meta layer (shards, missions, daily, customize shop).
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Audio = LUMEN.Audio;
  const Store = LUMEN.Store;
  const C = LUMEN.Cosmetics;
  const M = LUMEN.Missions;
  const D = LUMEN.Daily;
  const $ = (id) => document.getElementById(id);
  const T = (k, v) => (LUMEN.t ? LUMEN.t(k, v) : k);
  // Anything interpolated into innerHTML goes through here. These particular
  // strings are ours (i18n, not player input), but the leaderboard already shipped
  // one hole exactly like this and "it happens to be trusted today" is not a
  // property that survives the next edit.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Fire UI actions on pointerUP rather than click: it lands as soon as the finger
  // lifts (no legacy tap delay), but unlike pointerdown it still lets the browser
  // decide the gesture was a scroll — which matters because the shop and settings
  // panels scroll, and a buy button must not fire while you're dragging past it.
  //
  // The click listener exists for keyboard activation (Enter/Space fire click with
  // no pointer events). The real click that follows a tap is suppressed by time:
  // it arrives within a couple of milliseconds of pointerup, so a short window is
  // unambiguous. An earlier version armed a flag on pointerdown for 400ms, which
  // double-fired on any press held longer than that — on the revive button that
  // charged the player and then instantly ended the run they'd just bought back.
  const TAP_SLOP2 = 144; // (12px)^2 — beyond this it was a drag, not a tap
  function onTap(el, fn) {
    if (!el) return;
    let sx = 0, sy = 0, tracking = false, lastTap = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      tracking = true; sx = e.clientX; sy = e.clientY;
    });
    el.addEventListener('pointercancel', () => { tracking = false; });
    el.addEventListener('pointerup', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (dx * dx + dy * dy > TAP_SLOP2) return; // scrolled away — ignore
      e.preventDefault();
      lastTap = e.timeStamp || performance.now();
      fn(e);
    });
    el.addEventListener('click', (e) => {
      const now = e.timeStamp || performance.now();
      if (now - lastTap < 700) return; // this is the click paired with the tap we handled
      fn(e);
    });
  }

  const UI = {
    game: null,
    screens: {},
    shopTab: 'customize',

    init(game) {
      this.game = game;
      this._ready = true;
      this.screens = {
        menu: $('screen-menu'),
        gameover: $('screen-gameover'),
        pause: $('screen-pause'),
        shop: $('screen-shop'),
        settings: $('screen-settings'),
        scores: $('screen-scores'),
        revive: $('screen-revive'),
        tutdone: $('screen-tutdone'),
        progress: $('screen-progress'),
        checkout: $('screen-checkout'),
        modes: $('screen-modes'),
        name: $('screen-name'),
        poll: $('screen-poll'),
        daily: $('screen-daily'),
        update: $('screen-update'),
      };

      this.installBackButtons();

      onTap($('btn-play'), () => {
        this.click();
        // PLAY plays. The tutorial has its own button and its own purpose —
        // hijacking the primary action for a first-run detour meant a new player
        // who pressed PLAY got a lesson they didn't ask for, and anyone who
        // wanted the lesson later couldn't tell where it had gone.
        game.start();
      });
      document.querySelectorAll('#diff-row .diffbtn').forEach((b) => {
        onTap(b, () => { Store.difficulty = b.getAttribute('data-diff'); Audio && Audio.sfx('ui'); this.refreshMenu(); });
      });
      onTap($('btn-daily'), () => { this.click(); game.startDaily(); });
      // A different thing from the button above it, which starts the daily RUN.
      // This one collects the reward for turning up. See js/perks.js.
      onTap($('btn-reward'), () => { this.click(); this.openDaily(); });
      onTap($('btn-daily-close'), () => { this.click(); this.showScreen('menu'); });
      onTap($('btn-update-go'), () => { this.click(); LUMEN.Update && LUMEN.Update.open(this._updateFeed); });
      // Only ever reachable on the SOFT prompt: showUpdate hides this button
      // outright when the build is blocked, and the Android back button is
      // guarded separately in js/native.js.
      onTap($('btn-update-later'), () => { this.click(); this.showScreen('menu'); });
      onTap($('btn-daily-claim'), () => { this.click(); this.claimDaily(); });
      onTap($('btn-shop'), () => { this.click(); this.openShop('customize'); });
      onTap($('btn-tutorial'), () => { this.click(); game.startTutorial(); });
      onTap($('btn-tut-play'), () => { this.click(); game.start(); });
      onTap($('btn-tut-menu'), () => { this.click(); game.toMenu(); });

      // game over
      onTap($('btn-retry'), () => { this.click(); this.game.daily ? game.startDaily() : game.start(); });
      onTap($('btn-menu'), () => { this.click(); game.toMenu(); });
      onTap($('btn-share'), () => this.share());

      // pause
      onTap($('btn-resume'), () => { this.click(); game.resume(); });
      onTap($('btn-restart'), () => { this.click(); this.game.daily ? game.startDaily() : game.start(); });
      onTap($('btn-menu2'), () => { this.click(); game.toMenu(); });

      // shop
      onTap($('btn-shop-close'), () => { this.click(); this.closeShop(); });
      onTap($('tab-customize'), () => { this.click(); this.setTab('customize'); });
      onTap($('tab-maps'), () => { this.click(); this.setTab('maps'); });
      onTap($('tab-coins'), () => { this.click(); this.setTab('coins'); });
      onTap($('tab-items'), () => { this.click(); this.setTab('items'); });
      onTap($('tab-skills'), () => { this.click(); this.setTab('skills'); });
      onTap($('btn-restore'), () => {
        this.click();
        if (!LUMEN.IAP || !LUMEN.IAP.available) { this.toast(T('storeUnavailable')); return; }
        LUMEN.IAP.restore().then((r) => {
          this.toast(r.ok ? T('restored', { n: r.count }) : T('storeUnavailable'));
          this.renderShop();
        });
      });

      // leaderboard
      onTap($('btn-progress'), () => { this.click(); this.openProgress(); });
      onTap($('btn-progress-close'), () => { this.click(); this.showScreen('menu'); });
      // the next-update vote
      onTap($('btn-poll'), () => { this.click(); this.openPoll(); });
      onTap($('btn-poll-close'), () => { this.click(); this.showScreen('menu'); });
      // game modes
      onTap($('btn-modes'), () => { this.click(); this.openModes(); });
      onTap($('btn-modes-close'), () => { this.click(); this.showScreen('menu'); });

      // checkout
      onTap($('btn-checkout-pay'), () => { this.click(); this._checkoutResolve && this._checkoutResolve(true); });
      onTap($('btn-checkout-cancel'), () => { this.click(); this._checkoutResolve && this._checkoutResolve(false); });

      onTap($('btn-scores'), () => { this.click(); this.openScores(); });
      onTap($('btn-scores-close'), () => { this.click(); this.showScreen('menu'); });
      onTap($('tab-lb-me'), () => { this.click(); this.setBoard('me'); });
      onTap($('tab-lb-daily'), () => { this.click(); this.setBoard('daily'); });
      onTap($('tab-lb-all'), () => { this.click(); this.setBoard('all'); });
      onTap($('btn-lb-refresh'), () => { this.click(); this.refreshBoard(); });
      onTap($('btn-lb-signin'), () => { this.click(); this.signInApple(); });
      onTap($('btn-name-save'), () => { this.click(); this.saveName(); });
      onTap($('btn-name-edit'), () => { this.click(); this.openNameScreen(); });

      // revive
      onTap($('btn-revive'), () => {
        this.click();
        if (!game.revive()) { this.toast(T('notEnough')); game.finalizeRun(); }
        else this.varDecision();
      });
      onTap($('btn-giveup'), () => { this.click(); game.finalizeRun(); });

      // Both ways back into a run go through the same decision beat, so the ad
      // route and the shard route feel identical -- which they should, because
      // they buy the same thing.
      onTap($('btn-revive-ad'), () => { this.click(); this.reviveWithAd(); });
      // finalizeRun FIRST: leaving is not the same as throwing the run away, and
      // a score you actually reached should be recorded whichever door you use.
      onTap($('btn-revive-menu'), () => { this.click(); game.finalizeRun(); game.toMenu(); });

      // settings
      onTap($('btn-settings'), () => { this.click(); this.openSettings(); });
      onTap($('btn-settings-close'), () => { this.click(); this.showScreen('menu'); });
      onTap($('btn-apple'), () => { this.click(); this.signInApple(); });
      onTap($('btn-acct-delete'), () => { this.click(); this.deleteAccount(); });
      onTap($('btn-reset'), () => this.resetProgress());
      onTap($('btn-code-redeem'), () => this.redeemCode());
      // Enter is what a person types after a code, and a field that ignores it
      // reads as a field that did not take the code.
      const codeBox = $('code-input');
      if (codeBox) {
        codeBox.addEventListener('keydown', (e) => {
          e.stopPropagation();                       // never flip the orb
          // The button disables itself while a redeem is in flight; Enter went
          // straight past that and could fire a second one.
          if (e.key === 'Enter') { e.preventDefault(); if (!this._redeeming) this.redeemCode(); }
        });
      }
      onTap($('btn-save-export'), () => this.exportSave());
      onTap($('btn-save-import'), () => this.importSave());
      document.querySelectorAll('#screen-settings .toggle').forEach((t) => {
        onTap(t, () => this.toggleSetting(t.getAttribute('data-set')));
      });
      document.querySelectorAll('#screen-settings .qbtn[data-q]').forEach((b) => {
        onTap(b, () => this.setQuality(b.getAttribute('data-q')));
      });
      document.querySelectorAll('#screen-settings .cbbtn').forEach((b) => {
        onTap(b, () => {
          Store.colorblind = b.getAttribute('data-cb');
          Audio && Audio.sfx('ui');
          this.renderSettings();
        });
      });
      document.querySelectorAll('#screen-settings .langbtn').forEach((b) => {
        onTap(b, () => { LUMEN.i18n.set(b.getAttribute('data-lang')); Audio && Audio.sfx('ui'); this.renderSettings(); });
      });

      // top bar
      onTap($('btn-pause'), () => {
        this.click();
        if (game.state === 'play') game.pause();
        else if (game.state === 'pause') game.resume();
      });
      // iOS Safari has no Fullscreen API for non-video elements — don't show a
      // button that can never do anything.
      if (this.fullscreenSupported()) {
        onTap($('btn-fs'), () => { this.click(); this.toggleFullscreen(); });
        const onFsChange = () => {
          $('btn-fs').classList.toggle('on', this.isFullscreen());
          setTimeout(() => game.resize(), 60);   // viewport changes both ways
        };
        document.addEventListener('fullscreenchange', onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
      } else {
        $('btn-fs').classList.add('hidden');
      }

      if (LUMEN.Pad) LUMEN.Pad.init();

      const muteBtn = $('btn-mute');
      onTap(muteBtn, () => this.toggleMute());
      if (Store.muted) { Audio && (Audio.isMuted = true); muteBtn.classList.add('muted'); }

      this.showScreen('menu');
      // Left over from when PLAY hijacked the first run: this relabelled the
      // button "START — LEARN TO PLAY" and set a _firstRun flag that nothing
      // ever read, so the very first thing a new player saw promised a lesson
      // and delivered a full-speed scored run. refreshMenu() then quietly reset
      // the same button to PLAY the moment they opened SHOP and came back.
      //
      // That design was deliberately reversed — see the PLAY handler above, and
      // the `nudge` on the tutorial button in refreshMenu(), which is how a new
      // player is pointed at the lesson now. Only the relabelling survived it.
    },

    // The build actually running, read off the stamp the loader put on its own
    // script URL. A browser serving a cached copy is indistinguishable from a
    // fix that never landed, and we have chased that difference more than once.
    showBuildStamp() {
      const el = document.getElementById('build-stamp');
      if (!el) return;
      const src = (document.querySelector('script[src*="js/main.js"]') || {}).src || '';
      const m = src.match(/[?&]v=([0-9]+)/);
      const v = m ? m[1] : null;
      // 260728212155 -> 2026-07-28 21:21
      const pretty = v && v.length >= 12
        ? '20' + v.slice(0, 2) + '-' + v.slice(2, 4) + '-' + v.slice(4, 6)
          + ' ' + v.slice(6, 8) + ':' + v.slice(8, 10)
        : 'dev';
      el.textContent = 'build ' + pretty;
      el.title = v || 'unstamped';

      // The store's own diagnosis, but only when there is something wrong. An
      // empty shop looks the same whether the plugin is missing from the build,
      // StoreKit returned no products, or an exception was swallowed at
      // registration — and a phone has no console to tell them apart. When it
      // is fine this says nothing at all.
      const d = LUMEN.IAP && LUMEN.IAP.diag;
      if (d && d !== 'ok') {
        el.textContent += '  ·  store: ' + d;
      } else if (d && LUMEN.Native && LUMEN.Native.isApp) {
        el.title += '  |  ' + d;
      }
    },

    // The browser will not let audio start before a gesture, so the first button
    // press is also where the menu's music gets to begin.
    click() {
      if (!Audio) return;
      Audio.init(); Audio.unlock(); Audio.sfx('ui');
      // `attract` is the menu test, not the state: the menu's demo runs in the
      // PLAY state, so checking the state alone never fires here.
      const g = LUMEN.game;
      if (g && g.attract && !Audio.music.playing) g.menuMusic();
    },

    // Retarget the PLAY label without destroying its data-i18n span, so a later
    // language switch can still translate it.
    showScreen(name) {
      // The game calls into the UI from its lifecycle methods. If the UI hasn't
      // been wired to a document yet (tests, or a boot race), stay silent instead
      // of throwing out of the middle of a state transition.
      if (!this._ready) return;
      // Remembered so Android's back button knows what "up one level" means.
      this.currentScreen = name;
      // The signature previews are a live rAF loop; leaving the shop must stop
      // it rather than let it animate canvases nobody is looking at.
      if (name !== 'shop') this.stopSigPreviews();
      for (const k in this.screens) { if (this.screens[k]) this.screens[k].classList.add('hidden'); }
      if (name && this.screens[name]) this.screens[name].classList.remove('hidden');
      const showPause = name === null || name === 'pause';
      $('btn-pause').classList.toggle('hidden', !showPause);
      $('btn-settings').classList.toggle('hidden', name !== 'menu');
      // During an active run the top-right is inside the playfield. Leaving four
      // 44px buttons there means a high tap mutes or fullscreens instead of
      // flipping — so only PAUSE stays while playing.
      const playing = name === null;
      $('btn-mute').classList.toggle('hidden', playing);
      if (this.fullscreenSupported()) $('btn-fs').classList.toggle('hidden', playing);
      // Menu-level overlays must not let Space/W/arrows reach the game behind
      // them, or a player scrolling a list starts a scored run they cannot see.
      //
      // This used to be an ALLOWLIST of modal screen names, and it was wrong
      // twice: 'modes' was never added (Space behind the 10-card GAME MODES
      // list started a real run) and neither was 'tutdone' (finishTutorial
      // leaves state=MENU, so Space on TRAINING COMPLETE started one too). A
      // list that has to be updated every time a screen is added will keep
      // being wrong, so the rule is inverted — everything is modal EXCEPT the
      // three places a key press genuinely belongs to the game:
      //   null   a live run: Space flips
      //   menu   the menu proper: Space starts
      //   pause  Space resumes, same as Escape
      this.game.modalOpen = !(name === null || name === 'menu' || name === 'pause');
      // The attract demo only belongs behind the menu itself. Any other screen —
      // including the ones layered over the menu — puts it away, so it can never
      // be mistaken for a live run or keep simulating out of sight.
      if (this.game.attract && name !== 'menu') this.game.stopAttract();
      else if (name === 'menu' && this.game.state === 'menu') this.game.startAttract();
      if (name === 'menu') this.refreshMenu();
      // …and, once per poll, offer the vote on the way back from a run.
      if (name === 'menu') this.maybeOfferPoll();
    },

    // ---- menu ------------------------------------------------------------
    refreshMenu() {
      if (!this._ready) return;
      // The best for THE MODE YOU ARE ABOUT TO PLAY. Every mode already keeps
      // its own record — they are different games and a shared number would be
      // meaningless — but this chip always showed Classic's, so choosing
      // Blackout and seeing a Classic score made the records look broken.
      const curMode = LUMEN.Modes ? LUMEN.Modes.current() : null;
      const curId = curMode ? curMode.id : 'classic';
      $('menu-best').textContent = (curId === 'classic')
        ? Store.best
        : (LUMEN.Modes ? LUMEN.Modes.best(curId) : 0);
      $('menu-combo').textContent = Store.bestCombo;
      $('menu-runs').textContent = Store.runs;
      // "TAP — flip gravity" is for somebody who has never played. Carrying it
      // forever costs 78px of the main screen to a player with five hundred
      // runs behind them — and it was the only thing on a 390x844 phone that
      // did not fit, so the person who still needed it was the one who could
      // not read all of it. It retires once you have plainly outgrown it.
      const howto = document.querySelector('#screen-menu .howto');
      if (howto) howto.classList.toggle('hidden', Store.tutorialDone || Store.runs >= 5);
      // "TOP COMBO 0 · RUNS 0" is not a statistic, it is a row of zeroes telling
      // a first-time player nothing. It appears with their first run — which is
      // also the moment it starts being true.
      this.refreshPoll();
      this.refreshReward();
      const stats = $('menu-stats');
      if (stats) stats.classList.toggle('hidden', Store.runs === 0);
      $('menu-shards').textContent = Store.shards;
      // daily button label with streak
      if (D) {
        const st = D.status();
        // Name the day's twist on the button. A daily whose whole selling point
        // is "today is different" has to say what is different before you commit.
        const twist = D.twistName ? D.twistName() : '';
        // THE CHASE, on the button, BEFORE the run: the target is the reason to
        // press this rather than PLAY. warm() refreshes the board in the
        // background for the next run and never blocks this one; menuLine()
        // reads only what is already cached.
        let chLine = '';
        if (LUMEN.Chase) {
          try {
            LUMEN.Chase.warm();
            const p = LUMEN.Chase.menuParts();
            // The label shrinks and the NUMBER is pinned: see .daily-chase. As a
            // single string the ellipsis ate the target instead of the label.
            if (p) chLine = '<span class="cn">▲ ' + esc(p.label) + '</span>'
                          + '<span class="cv">' + esc(p.value) + '</span>';
          } catch (e) { chLine = ''; }
        }
        // esc() is not optional here. This is an innerHTML path carrying another
        // player's chosen name, which is exactly the hole the leaderboard
        // already shipped once. cleanName strips markup upstream; this is the
        // second lock on the same door.
        $('btn-daily').innerHTML = '◈ ' + T('daily') + (st.streak > 0 ? ' · ' + st.streak + '🔥' : '')
          + (twist ? '<small class="daily-twist">' + twist + '</small>' : '')
          + (chLine ? '<small class="daily-twist daily-chase">' + chLine + '</small>' : '');
      }
      const d = Store.difficulty || 'normal';
      document.querySelectorAll('#diff-row .diffbtn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-diff') === d);
      });
      // The selected mode is shown as a line of its own, right above the
      // difficulty row — the two together are "what am I about to play". The
      // button stays labelled GAME MODES so it reads as a place to go.
      if (LUMEN.Modes) {
        const m = LUMEN.Modes.current();
        const line = $('menu-mode');
        if (line) {
          line.innerHTML = '<span class="ml-dot"></span>' + LUMEN.Modes.name(m.id);
          line.style.setProperty('--mc', 'hsl(' + m.accent + ' 90% 62%)');
        }
        const play = $('btn-play');
        if (play) play.innerHTML = '<span>' + T('play') + '</span>';
        // A new player gets the lesson button lit up, rather than PLAY taken over.
        const tut = $('btn-tutorial');
        if (tut) tut.classList.toggle('nudge', !Store.tutorialDone);
        // …and it names the mode it will teach, because each mode has its own
        // final lesson about what IT changes.
        if (tut && LUMEN.Modes) {
          const lab = tut.querySelector('span');
          if (lab) lab.textContent = T('howToPlay');
        }
      }
      this.renderMissions();
    },

    renderMissions() {
      if (!M) return;
      const box = $('menu-missions');
      box.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'missions-head'; head.textContent = T('goals');
      box.appendChild(head);
      for (const m of M.list()) {
        const row = document.createElement('div');
        row.className = 'mission' + (m.done ? ' done' : '');
        const pct = Math.round((m.progress / m.goal) * 100);
        row.innerHTML =
          '<div class="m-text">' + m.text + '</div>' +
          '<div class="m-reward">◆' + m.reward + '</div>' +
          '<div class="m-bar"><i style="width:' + pct + '%"></i></div>';
        box.appendChild(row);
      }
    },

    // ---- shop ------------------------------------------------------------
    openShop(tab) { this.shopTab = tab || 'customize'; this.showScreen('shop'); this.renderShop(); this.updateTabs(); },
    closeShop() { this.showScreen('menu'); },
    // Switching top-level tab resets the sub-filter and the scroll: arriving on
    // MAPS half-way down because CUSTOMIZE was scrolled there is disorienting.
    setTab(tab) {
      this.shopTab = tab;
      this.shopFilter = 'all';
      this.renderShop();
      const panel = $('shop-grid') && $('shop-grid').closest('.panel');
      if (panel) panel.scrollTop = 0;
    },

    // A one-time explanation per tab. Each shop tab does something different
    // enough that "you'll figure it out" isn't good enough — especially Items,
    // whose whole design is a limit, and Skills, which the Daily ignores.
    renderCoach() {
      const box = $('shop-coach');
      const tab = this.shopTab;
      const seen = Store.coachSeen || {};
      if (seen[tab]) { box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      box.innerHTML =
        '<div class="coach-t">' + T('coach_' + tab + '_t') + '</div>' +
        '<div class="coach-b">' + T('coach_' + tab + '_b') + '</div>' +
        '<button class="c-btn equip coach-x" type="button">' + T('gotIt') + '</button>';
      onTap(box.querySelector('.coach-x'), () => {
        const s = Store.coachSeen || {};
        s[tab] = 1; Store.coachSeen = s;
        this.click(); box.classList.add('hidden');
      });
    },
    updateTabs() { this.renderShop(); },

    // Swatches move. A cycling skin looked identical to a flat one while it sat
    // still in the shop, which is the whole reason the rainbow skins read as
    // "just a colour" — you could only tell them apart by equipping them.
    skinSwatch(s) {
      if (s.rainbow && !s.rainbowSpan) {
        // full-wheel: spin the conic gradient at roughly the in-game rate
        const secs = (360 / (s.rainbowSpeed || 60)).toFixed(2);
        return 'background:conic-gradient(from 0deg,#f55,#fd4,#5f7,#4ff,#59f,#f5f,#f55);' +
          'box-shadow:0 0 16px rgba(255,255,255,.5);animation:swSpin ' + secs + 's linear infinite';
      }
      const c = 'hsl(' + s.hue + ' ' + s.sat + '% ' + s.light + '%)';
      const d = 'hsl(' + s.hue + ' ' + s.sat + '% 30%)';
      const base = 'background:radial-gradient(circle at 38% 34%, #fff, ' + c + ' 55%, ' + d + ');box-shadow:0 0 16px ' + c;
      // narrow-band shimmer (magma, plasma): rock the hue back and forth
      if (s.rainbow) return base + ';animation:swShimmer 2.4s ease-in-out infinite';
      return base;
    },
    // Every trail preview animates the way the real thing does — streaming
    // styles scroll, rhythmic ones beat, rings expand. A still picture of a
    // trail tells you almost nothing about it.
    trailSwatch(t) {
      const sk = C.skinDef();
      const c = 'hsl(' + sk.hue + ' ' + sk.sat + '% ' + sk.light + '%)';
      const anim = (name, secs, ease) => ';background-size:200% 100%;animation:' + name + ' ' + secs + 's ' + (ease || 'linear') + ' infinite';
      const beat = (name, secs) => ';animation:' + name + ' ' + secs + 's ease-in-out infinite';
      switch (t.style) {
        case 'prism':  return 'background:linear-gradient(90deg,#f55,#fd4,#5f7,#4ff,#59f,#f5f,#f55)' + anim('swStream', 2.2);
        case 'spark':  return 'background:repeating-linear-gradient(90deg, transparent 0 5px, ' + c + ' 5px 8px);background-size:26px 100%;animation:swStream 0.7s linear infinite';
        case 'comet':  return 'background:linear-gradient(90deg, transparent, #fff);box-shadow:0 0 12px ' + c + anim('swStream', 1.4);
        case 'ribbon': return 'background:linear-gradient(90deg, transparent, ' + c + ');box-shadow:0 0 12px ' + c + anim('swStream', 1.9);
        case 'thread': return 'background:linear-gradient(180deg, transparent 44%, ' + c + ' 44% 56%, transparent 56%);box-shadow:0 0 10px ' + c + beat('swThread', 2.6);
        case 'embers': return 'background:repeating-linear-gradient(90deg, transparent 0 7px, ' + c + ' 7px 10px);background-size:34px 100%;animation:swStream 1.1s linear infinite, swFade 1.6s ease-in-out infinite';
        case 'pulse':  return 'background:repeating-linear-gradient(90deg, ' + c + ' 0 4px, transparent 4px 12px);box-shadow:0 0 12px ' + c + ';background-size:48px 100%;animation:swStream 1.3s linear infinite, swBeat 0.6s ease-in-out infinite';
        case 'shard':  return 'background:repeating-linear-gradient(60deg, ' + c + ' 0 4px, transparent 4px 11px);background-size:44px 100%;animation:swStream 1.6s linear infinite';
        case 'wake':   return 'background:linear-gradient(180deg, ' + c + ' 0 2px, transparent 2px 90%, ' + c + ' 90% 100%);box-shadow:0 0 10px ' + c + beat('swWake', 1.8);
        case 'void':   return 'background:radial-gradient(circle at 80% 50%, #000 30%, ' + c + ' 70%, transparent);box-shadow:inset 0 0 14px #000' + beat('swBeat', 2.8);
        case 'halo':   return 'background:radial-gradient(circle at 78% 50%, transparent 34%, ' + c + ' 38% 46%, transparent 50%)' + beat('swRing', 1.9);
        case 'echo':   return 'background:radial-gradient(circle at 72% 50%, transparent 20%, ' + c + ' 24% 30%, transparent 34%, ' + c + ' 44% 50%, transparent 54%)' + beat('swRing', 2.3);
        default:       return 'background:radial-gradient(circle at 80% 50%, ' + c + ', transparent 70%)' + beat('swFade', 2.1); // dust
      }
    },

    // A real little scene rather than a colour chip: the map's own sky, nebulae,
    // dust and — crucially — a pair of its glowing gates with a gap threaded by
    // the orb. You should be able to tell what you're buying at a glance.
    //
    // (The previous version pasted a hex alpha onto an hsl() string, which is not
    // valid CSS. One bad layer invalidates the whole `background` shorthand, so
    // every map card rendered as an empty box.)
    // A REAL frame of the world, captured from the running game at 2x and
    // installed under assets/maps/. The hand-drawn SVG below is still here as
    // the fallback, but it was a 160x60 cartoon squashed into a 62px strip --
    // it could not show a sunset, a mountain, a torii or a moon, which is most
    // of what distinguishes one world from another now.
    mapArt(m) {
      return "background:#0a0a12 url('assets/maps/" + m.id + ".jpg') center/cover no-repeat;"
        + 'box-shadow: inset 0 0 0 1px rgba(255,255,255,.10)';
    },

    mapSwatch(m) {
      // `mono` maps are meant to read as colourless — grey, silent, immense — so
      // the desaturation has to reach the nebulae and gates too, not just the sky.
      const sat = m.mono ? 20 : 62;
      const nebSat = m.mono ? 12 : 78;
      const wallSat = m.mono ? 16 : 92;
      const sky1 = 'hsl(' + m.bg + ' ' + sat + '% 13%)';
      const sky2 = 'hsl(' + m.bg2 + ' ' + (sat + 6) + '% 6%)';
      const neb1 = 'hsl(' + (m.neb ? m.neb[0] : 250) + ' ' + nebSat + '% 60%)';
      const neb2 = 'hsl(' + (m.neb ? m.neb[1] : 285) + ' ' + nebSat + '% 56%)';
      const dust = 'hsl(' + m.dust + ' ' + (m.mono ? 10 : 70) + '% 84%)';
      // The gates are the WORLD's colour, because that is now what the game
      // draws -- see gateColor() in js/game.js. Under a colour-vision preset or
      // HIGH CONTRAST the game falls back to the fixed danger hue, and so does
      // this card: what you are shown has to be what you will get.
      // `m.wall` is the corridor's top and bottom edge, drawn below.
      const cb = LUMEN.cbPalette ? LUMEN.cbPalette() : { danger: 350 };
      const St = LUMEN.Store;
      const fixed = St && (St.highContrast || St.colorblind !== 'off');
      const gateHue = fixed || m.gate == null ? cb.danger : m.gate;
      const wall = 'hsl(' + gateHue + ' ' + (m.mono ? wallSat : 92) + '% 62%)';
      const edge = 'hsl(' + m.wall + ' ' + wallSat + '% 68%)';
      const orb = LUMEN.Cosmetics ? LUMEN.Cosmetics.skinDef() : null;
      const orbC = orb && !orb.rainbow ? 'hsl(' + orb.hue + ' ' + orb.sat + '% ' + orb.light + '%)' : '#7ff';
      // Bars are drawn as two stacked rects with a gap between them, plus a wide
      // low-opacity copy underneath standing in for the glow.
      const gate = (x, gapY, gapH) =>
        '<g>' +
          '<rect x="' + (x - 3) + '" y="0" width="12" height="' + gapY + '" fill="' + wall + '" opacity=".18"/>' +
          '<rect x="' + (x - 3) + '" y="' + (gapY + gapH) + '" width="12" height="' + (60 - gapY - gapH) + '" fill="' + wall + '" opacity=".18"/>' +
          '<rect x="' + x + '" y="0" width="6" height="' + gapY + '" fill="' + wall + '"/>' +
          '<rect x="' + x + '" y="' + (gapY + gapH) + '" width="6" height="' + (60 - gapY - gapH) + '" fill="' + wall + '"/>' +
        '</g>';
      const svg =
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 60' preserveAspectRatio='none'>" +
          "<defs>" +
            "<linearGradient id='s' x1='0' y1='0' x2='.4' y2='1'>" +
              "<stop offset='0' stop-color='" + sky1 + "'/><stop offset='1' stop-color='" + sky2 + "'/>" +
            "</linearGradient>" +
            "<radialGradient id='n1'><stop offset='0' stop-color='" + neb1 + "' stop-opacity='.55'/>" +
              "<stop offset='1' stop-color='" + neb1 + "' stop-opacity='0'/></radialGradient>" +
            "<radialGradient id='n2'><stop offset='0' stop-color='" + neb2 + "' stop-opacity='.42'/>" +
              "<stop offset='1' stop-color='" + neb2 + "' stop-opacity='0'/></radialGradient>" +
            "<radialGradient id='o'><stop offset='0' stop-color='#fff'/>" +
              "<stop offset='.45' stop-color='" + orbC + "'/><stop offset='1' stop-color='" + orbC + "' stop-opacity='0'/></radialGradient>" +
          "</defs>" +
          "<rect width='160' height='60' fill='url(#s)'/>" +
          "<ellipse cx='118' cy='16' rx='46' ry='30' fill='url(#n1)'/>" +
          "<ellipse cx='34' cy='48' rx='40' ry='26' fill='url(#n2)'/>" +
          "<g fill='" + dust + "' opacity='.5'>" +
            "<circle cx='22' cy='14' r='1'/><circle cx='58' cy='9' r='.8'/><circle cx='92' cy='45' r='1'/>" +
            "<circle cx='140' cy='36' r='.8'/><circle cx='12' cy='34' r='.7'/><circle cx='72' cy='54' r='.7'/>" +
          "</g>" +
          "<g stroke='" + edge + "' fill='none'>" +
            "<line x1='0' y1='2.5' x2='160' y2='2.5' stroke-width='5' opacity='.20'/>" +
            "<line x1='0' y1='57.5' x2='160' y2='57.5' stroke-width='5' opacity='.20'/>" +
            "<line x1='0' y1='2.5' x2='160' y2='2.5' stroke-width='1.5' opacity='.75'/>" +
            "<line x1='0' y1='57.5' x2='160' y2='57.5' stroke-width='1.5' opacity='.75'/>" +
          "</g>" +
          gate(60, 20, 22) + gate(112, 8, 24) +
          "<circle cx='30' cy='31' r='9' fill='url(#o)'/>" +
          "<circle cx='30' cy='31' r='3.4' fill='#fff'/>" +
        "</svg>";
      return "background:url(\"data:image/svg+xml;utf8," + encodeURIComponent(svg) + "\") center/cover no-repeat;" +
        'box-shadow: inset 0 0 0 1px rgba(255,255,255,.10)';
    },

    // Shards: earn them by watching, or buy them. Both in one place, because
    // they answer the same question — the game-over screen was the wrong home
    // for an ad, since the moment you have just failed is the moment an offer
    // reads as pressure rather than a choice.
    renderCoinsShop(grid, note) {
      note.classList.add('hidden');
      // CUSTOMIZE leaves its category row behind. It is only ever cleared by the
      // branch that draws it, so arriving here from Orbs kept "ALL / SETS /
      // ORBS…" pinned above a page with no categories at all.
      $('shop-filters').classList.add('hidden');
      grid.className = 'shop-grid items';
      const A = LUMEN.Ads;

      // What you have, drawn rather than stated. The cluster grows with the
      // balance — one lit diamond per tier — so the page answers "how am I
      // doing" before it asks for anything.
      const bal = document.createElement('div');
      bal.className = 'card owned coin-balance';
      const lit = Math.max(1, Math.min(8, Math.floor(Math.log2(Math.max(1, Store.shards) / 150) + 2)));
      let pips = '';
      for (let i = 0; i < 8; i++) pips += '<span class="pip' + (i < lit ? ' on' : '') + '">◆</span>';
      bal.innerHTML = '<div class="coin-pips">' + pips + '</div>'
        + '<div class="coin-total">' + Store.shards.toLocaleString() + '</div>'
        + '<div class="c-desc">' + T('coinsHave') + '</div>';
      grid.appendChild(bal);

      if (A && A.available) {
        const card = document.createElement('div');
        card.className = 'card owned';
        card.innerHTML = '<div class="c-name">' + T('freeShards') + '</div>'
          + '<div class="c-desc">' + T('adTiers') + '</div>';
        const b = document.createElement('button');
        b.className = 'c-btn buy';
        b.textContent = T('adWatch', { n: A.nextReward });
        // Loading an ad is not instant, and a button that only greys out does not
        // look like it is working — it looks like the tap missed. It says so
        // instead, which is what stopped players tapping a second time and
        // sitting through two ads for one reward.
        const label = T('adWatch', { n: A.nextReward });
        if (A.busy) { b.disabled = true; b.textContent = T('adLoading'); }
        onTap(b, () => {
          this.click();
          b.disabled = true;
          b.textContent = T('adLoading');
          A.watch().then((paid) => {
            b.disabled = false;
            b.textContent = label;
            this.toast(paid > 0 ? T('adPaid', { n: paid })
              : T('adNone') + (A.lastError ? ' — ' + A.lastError.slice(0, 90) : ''));
            this.renderShop();
          });
        });
        card.appendChild(b);
        grid.appendChild(card);
      }

      const iap = LUMEN.IAP;
      // No provider, no prices. The native builds deliberately register none
      // (see js/iap.js) because the sandbox checkout would be selling digital
      // goods outside in-app purchase; drawing a dead "$1.99" tile there is both
      // a broken button and something App Review reads as a failed purchase.
      // The ad buttons above still work, so the tab stays useful without it.
      if (!iap || !iap.PACKS || !iap.available) return;
      iap.PACKS.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'card pack';
        // The pile IS the price comparison. Three identical cards with different
        // numbers make you read; three different-sized heaps make you see, and
        // the biggest one visibly does not fit its row.
        const heap = [6, 14, 26][iap.PACKS.indexOf(p)] || 6;
        let pile = '';
        for (let i = 0; i < heap; i++) pile += '<span class="coin">◆</span>';
        card.innerHTML = '<div class="pack-pile' + (heap > 20 ? ' overflowing' : '') + '">' + pile + '</div>'
          + '<div class="c-name">◆ ' + p.shards.toLocaleString() + '</div>'
          + '<div class="c-desc">' + T('shardPack') + '</div>';
        const b = document.createElement('button');
        b.className = 'c-btn cash';
        // `available` only asks whether SOME provider is ready, and the sandbox
        // one always is — so every price rendered as if it would charge. The
        // rest of the shop already marks sandbox (see the cosmetic cards); the
        // packs I added did not, which made them the only prices in the game
        // that lied.
        const live = iap.available && !iap.sandbox;
        // Apple's own localised price when StoreKit is behind this; the USD
        // figure only when nothing real is.
        b.textContent = live ? iap.formatPrice(p.usd, p.id)
          : '$' + p.usd.toFixed(2) + ' ' + T('sandbox');
        onTap(b, () => {
          this.click();
          if (!live) { this.toast(T('storeUnavailable')); return; }
          b.disabled = true;
          iap.buyShards(p.id).then((r) => {
            b.disabled = false;
            this.toast(r && r.ok ? T('adPaid', { n: p.shards }) : T('storeUnavailable'));
            this.renderShop();
          });
        });
        card.appendChild(b);
        grid.appendChild(card);
      });
    },

    renderShop() {
      $('shop-shards').textContent = Store.shards;
      const grid = $('shop-grid');
      const note = $('shop-note');
      grid.innerHTML = '';
      // One owner for the layout modifier. It used to be set by the items view and
      // cleared only by setTab, so opening the shop straight onto Orbs after last
      // being on Items left the single-column items layout behind.
      const wide = this.shopTab === 'items' || this.shopTab === 'skills';
      grid.className = 'shop-grid' + (wide ? ' items' : '');
      ['customize', 'maps', 'coins', 'items', 'skills'].forEach((t) => {
        const el = $('tab-' + t);
        if (el) el.classList.toggle('active', this.shopTab === t);
      });
      const iapOn = LUMEN.IAP && LUMEN.IAP.available;
      $('btn-restore').classList.toggle('hidden', !iapOn || wide);
      this.renderCoach();

      this.stopSigPreviews();   // rebuilt below if the tab still wants them
      if (this.shopTab === 'coins') return this.renderCoinsShop(grid, note);
      if (this.shopTab === 'items') return this.renderItemsShop(grid, note);
      if (this.shopTab === 'skills') return this.renderSkillsShop(grid, note);
      note.classList.toggle('hidden', this.shopTab !== 'maps');
      if (this.shopTab === 'maps') note.textContent = T('mapsNote');

      // Customize holds two catalogues, each under its own heading, so orbs and
      // trails stay one thought — "how my run looks" — instead of two tabs.
      if (this.shopTab === 'customize') {
        // CUSTOMIZE holds four catalogues — sets, orbs, trails and signatures —
        // which measured at 50 cards and ELEVEN SCREENS of scrolling on a phone.
        // Signatures, the newest and most expensive thing in the game, sat eight
        // screens down where nobody would ever meet them. The filter row names
        // all four at the top, so every category is visible in one glance and
        // one tap gets you a list you can actually read.
        this.renderShopFilters();
        const f = this.shopFilter || 'all';
        const sec = (key) => {
          const head = document.createElement('div');
          head.className = 'shop-sec';
          head.textContent = T(key);
          grid.appendChild(head);
        };
        if (f === 'all' || f === 'sets') this.renderSets(grid, iapOn);
        if (f === 'all' || f === 'orbs') this.renderCatalog(grid, C.SKINS, Store.skin, 'orbs', iapOn);
        if (f === 'all' || f === 'trails') {
          sec('trails');
          this.renderCatalog(grid, C.TRAILS, Store.trail, 'trails', iapOn);
        }
        if (f === 'all' || f === 'signatures') {
          sec('signatures');
          this.renderCatalog(grid, C.SIGNATURES, Store.signature, 'signatures', iapOn);
        }
        this.wireShopActions(grid);
        this.startSigPreviews();
        return;
      }
      $('shop-filters').classList.add('hidden');
      this.renderCatalog(grid, C.MAPS, Store.map, 'maps', iapOn);
      this.wireShopActions(grid);
    },

    // The category filter for CUSTOMIZE. Sticky, so it is reachable from
    // anywhere in the list rather than only from the top — the whole point is
    // that you should never have to scroll back up to change your mind.
    //
    // Counts are on the chips because "ORBS 25" tells you what you are in for,
    // and because a category with new things in it should be able to say so.
    renderShopFilters() {
      const host = $('shop-filters');
      if (!host) return;
      host.classList.remove('hidden');
      host.innerHTML = '';
      const groups = [
        ['all', T('filterAll'), C.SETS.length + C.SKINS.length + C.TRAILS.length + C.SIGNATURES.length],
        ['sets', T('sets'), C.SETS.length],
        ['orbs', T('orbs'), C.SKINS.length],
        ['trails', T('trails'), C.TRAILS.length],
        ['signatures', T('signatures'), C.SIGNATURES.length],
      ];
      const cur = this.shopFilter || 'all';
      for (const [key, label, n] of groups) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'shop-filter ui-interactive' + (key === cur ? ' on' : '');
        b.setAttribute('data-filter', key);
        b.setAttribute('aria-pressed', key === cur ? 'true' : 'false');
        b.innerHTML = '<span>' + esc(label) + '</span><i>' + n + '</i>';
        host.appendChild(b);
      }
      // The row scrolls sideways, so after a rebuild the chip you are actually
      // on can sit off-screen. Bring it back — a filter you cannot see is a
      // filter you cannot tell is active.
      const active = host.querySelector('.shop-filter.on');
      if (active && host.scrollWidth > host.clientWidth) {
        const a = active.offsetLeft, w = active.offsetWidth;
        if (a < host.scrollLeft || a + w > host.scrollLeft + host.clientWidth) {
          host.scrollLeft = Math.max(0, a - (host.clientWidth - w) * 0.5);
        }
      }
      host.querySelectorAll('button[data-filter]').forEach((b) => {
        onTap(b, () => {
          const key = b.getAttribute('data-filter');
          if ((this.shopFilter || 'all') === key) return;
          this.shopFilter = key;
          Audio && Audio.sfx('ui');
          this.renderShop();
          // A new list starts at its top, not wherever the old one was scrolled
          // to — otherwise picking a short category drops you into blank space.
          const panel = host.closest('.panel');
          if (panel) panel.scrollTop = 0;
        });
      });
    },

    // ---- the next-update vote ----------------------------------------------
    // Shown only when a poll is actually configured and open. The button does
    // not exist otherwise, because an empty ballot is worse than no ballot.
    renderPoll() {
      const P = LUMEN.Poll;
      const list = $('poll-list'), foot = $('poll-foot');
      if (!list || !P || !P.enabled) return;
      list.innerHTML = '';
      const voted = P.hasVoted(), mine = P.myChoice(), closed = P.closed;
      const res = P._results;
      const total = res ? res.total : 0;

      for (const opt of P.current.options) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'poll-opt ui-interactive'
          + (mine === opt.id ? ' mine' : '') + ((voted || closed) ? ' revealed' : '');
        row.setAttribute('data-opt', opt.id);
        if (voted || closed) row.setAttribute('aria-pressed', mine === opt.id ? 'true' : 'false');
        // The kind is stated because "a new mode" and "a new world" are
        // different amounts of change, and a voter deserves to know which.
        const kind = T('pollKind_' + (opt.kind || 'other'));
        const n = res ? (res.counts[opt.id] | 0) : 0;
        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
        // A bar is only drawn when there is something to draw. Without a tally
        // every option showed a 0% bar, which reads as "nobody voted for this"
        // rather than "the numbers have not arrived" — and the one the player
        // had just picked said 0% too. Their own choice is marked instead.
        const hasTally = !!res && total > 0;
        row.innerHTML =
          '<span class="po-kind">' + esc(kind) + '</span>'
          + '<span class="po-name">' + esc(P.text(opt, 'name')) + '</span>'
          + '<span class="po-desc">' + esc(P.text(opt, 'desc')) + '</span>'
          + (hasTally
            ? '<span class="po-bar"><i style="width:' + pct + '%"></i></span>'
              + '<span class="po-pct">' + pct + '%</span>'
            : (mine === opt.id ? '<span class="po-pct">✓</span>' : ''));
        list.appendChild(row);
      }

      if (foot) {
        // "Voted. 0 players so far." is what a player saw when the tally had not
        // come back yet — a sentence that reads like the vote was thrown away.
        // With no count to report, the count is left out.
        foot.textContent = closed
          ? T('pollClosed')
          : voted
            ? (total > 0 ? T('pollThanks', { n: total }) : T('pollVoted'))
            : T('pollPick', { d: P.current.closes || '' });
      }

      if (!voted && !closed) {
        list.querySelectorAll('.poll-opt').forEach((b) => {
          onTap(b, () => {
            b.classList.add('mine');
            Audio && Audio.sfx('best');
            // Repaint TWICE, and the first one immediately.
            //
            // P.vote() records the choice locally before it touches the network,
            // so the ballot is already decided here — but this used to wait for
            // the tally fetch before redrawing, and that fetch is allowed six
            // seconds. For those six seconds the only thing that happened was
            // the option lighting up: no "thanks", no percentages, nothing to
            // say the vote had counted. On a bad connection it never arrived at
            // all and the screen simply stayed like that.
            P.vote(b.getAttribute('data-opt')).then(() => {
              this.renderPoll();                                    // decided, now
              return P.results(true).then(() => this.renderPoll()); // tallies, when they land
            });
          });
        });
      }
    },

    // Called by js/update.js when the installed build is behind the published
    // one. `mode` is 'prompt' (dismissible, offered once a day) or 'block' (a
    // build that must not keep running -- no LATER, and back will not close it).
    showUpdate(mode, feed) {
      if (!this._ready) return;
      this._updateFeed = feed;
      this._updateBlocking = mode === 'block';
      const body = $('update-body');
      if (body) body.textContent = T(this._updateBlocking ? 'updateBodyForced' : 'updateBody');
      const later = $('btn-update-later');
      if (later) later.classList.toggle('hidden', this._updateBlocking);
      this.showScreen('update');
    },

    openPoll() {
      const P = LUMEN.Poll;
      if (!P || !P.enabled) return;
      this.showScreen('poll');
      this.renderPoll();                        // paint immediately from cache
      P.results().then(() => this.renderPoll()); // then again with live tallies
    },

    // The menu only advertises a daily reward there is a server to ask about.
    // With no project configured there is no day to ask for, and a button whose
    // only possible answer is "no connection" is worse than no button.
    refreshReward() {
      const row = $('reward-row');
      if (!row) return;
      const R = LUMEN.Perks;
      row.classList.toggle('hidden', !(R && R.enabled));
    },

    // The menu only advertises a vote that exists.
    refreshPoll() {
      const row = $('poll-row');
      if (!row) return;
      const P = LUMEN.Poll;
      row.classList.toggle('hidden', !(P && P.enabled));
    },

    // Bring the vote to the player instead of waiting to be found.
    //
    // A menu button most people never press is not participation. This opens
    // the ballot by itself ONCE per poll, on the way back to the menu after a
    // run — never mid-game, never on the first launch, and never a second time
    // whether or not they voted. Closing it without voting is an answer too.
    maybeOfferPoll() {
      const P = LUMEN.Poll;
      if (!P || !P.shouldOffer()) return false;
      P.markSeen();
      // After the menu has settled, so it reads as "here is a thing" rather
      // than as a panel that fought the game-over screen for the same frame.
      setTimeout(() => {
        if (this.currentScreen !== 'menu') return;   // they moved on; let it go
        this.openPoll();
      }, 700);
      return true;
    },

    // ---- sets ---------------------------------------------------------------
    // One look across all three slots, cheaper than the pieces. The card states
    // the full price, what you pay, and what you save, because a discount you
    // have to take on trust is not a discount — and a player who can check the
    // arithmetic is a player who buys the second one too.
    renderSets(grid, iapOn) {
      const head = document.createElement('div');
      head.className = 'shop-sec';
      head.textContent = T('sets');
      grid.appendChild(head);

      for (const s of C.SETS) {
        const p = C.setPrice(s.id);
        const card = document.createElement('div');
        card.className = 'shop-card set-card' + (p.complete ? ' owned' : '');

        // the three pieces, named, so nobody buys a bag they cannot see into
        const parts = s.items.map((id) => {
          const have = C.owned(id);
          return '<span class="set-part' + (have ? ' have' : '') + '">'
            + (have ? '✓ ' : '') + esc(C.name(id)) + '</span>';
        }).join('');

        // Is the whole look already on? Every piece equipped in its own slot.
        const worn = s.items.every((id) => {
          const cat = C.category(id);
          return (cat === 'orbs' && Store.skin === id)
            || (cat === 'trails' && Store.trail === id)
            || (cat === 'maps' && Store.map === id)
            || (cat === 'signatures' && Store.signature === id);
        });

        let btns;
        if (p.complete) {
          btns = worn
            ? '<button class="c-btn equipped" disabled>' + T('setWearing') + '</button>'
            : '<button class="c-btn equip" data-act="setequip" data-id="' + s.id + '">' + T('setEquip') + '</button>';
        } else {
          const afford = Store.shards >= p.shards;
          btns = '<button class="c-btn buy' + (afford ? '' : ' locked') + '" data-act="setbuy" data-id="'
            + s.id + '">◆ ' + p.shards.toLocaleString() + '</button>';
          if (p.usd && iapOn) {
            const sb = LUMEN.IAP.sandbox ? ' sandbox' : '';
            btns += '<button class="c-btn cash' + sb + '" data-act="setcash" data-id="' + s.id + '">'
              + LUMEN.IAP.formatPrice(p.usd, s.id) + '</button>';
          }
        }

        // Never claim a saving that isn't there. Partly-owned sets say what is
        // actually happening — you are buying the remainder — rather than
        // quietly reusing the headline number.
        const line = p.complete ? T('setOwned')
          : p.missing < s.items.length
            ? T('setRemaining', { n: p.missing, save: p.saving.toLocaleString() })
            : T('setSave', { was: p.listed.toLocaleString(), save: p.saving.toLocaleString() });

        const sigId = s.items.find((id) => C.category(id) === 'signatures');
        // A set is an orb, a trail and a signature — so the preview has to be
        // able to say which orb. It used to take the colour from whatever skin
        // the PLAYER had equipped, once, for every card on the page: Kindling,
        // Nightfall and Spectra all rendered in the same cyan, because that is
        // the default orb's hue. The card said "ember" and drew blue.
        const orbId = s.items.find((id) => C.category(id) === 'orbs');
        const sk = orbId && C.SKINS.find((k) => k.id === orbId);
        const skinAttr = sk
          ? ' data-hue="' + sk.hue + '" data-sat="' + (sk.sat == null ? 100 : sk.sat)
            + '" data-light="' + (sk.light == null ? 60 : sk.light) + '" data-orb="' + esc(orbId) + '"'
          : '';
        card.innerHTML =
          (sigId ? '<canvas class="swatch sig" data-sig="' + sigId + '"' + skinAttr + '></canvas>' : '')
          + '<div class="c-name">' + esc(C.name(s.id)) + '</div>'
          + '<div class="set-parts">' + parts + '</div>'
          + '<div class="c-desc">' + esc(C.desc(s.id)) + '</div>'
          + '<div class="set-save">' + esc(line) + '</div>'
          + '<div class="c-buys">' + btns + '</div>';
        grid.appendChild(card);
      }
    },

    // ---- animated signature previews ---------------------------------------
    // ONE rAF loop drives every card on screen, not one per card, and it stops
    // dead the moment the shop closes — a shop left open must never keep a
    // timer alive behind the menu.
    //
    // Each canvas replays the same beat: a flip, a flip, then the death. That is
    // the honest sample — the two things you will actually see — rather than a
    // hero shot the real effect never matches.
    startSigPreviews() {
      this.stopSigPreviews();
      const cvs = [...document.querySelectorAll('canvas[data-sig]')];
      if (!cvs.length) return;
      const C = LUMEN.Cosmetics;
      // The equipped skin is the right colour for a signature sold on its own —
      // that IS what you would see. It is the wrong colour for a set, which
      // carries its own orb; those canvases say so on themselves.
      const equipped = (() => {
        const sk = C.skinDef();
        return sk && sk.hue != null
          ? { h: sk.hue, s: sk.sat == null ? 95 : sk.sat, l: sk.light == null ? 62 : sk.light }
          : { h: 188, s: 95, l: 62 };
      })();
      const colourOf = (cv) => {
        const h = cv.getAttribute('data-hue');
        if (h == null) return equipped;
        return { h: +h, s: +(cv.getAttribute('data-sat') || 95), l: +(cv.getAttribute('data-light') || 62) };
      };
      // Give each canvas a backing store that matches the box it is drawn in.
      // It used to be a fixed 168x76 stretched across a full-width card — six
      // times up on a phone, which is why the preview looked soft and far away.
      // The comment in the stylesheet claimed this stayed crisp. It did not.
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      for (const cv of cvs) {
        const r = cv.getBoundingClientRect();
        const w = Math.max(120, Math.round(r.width)), h = Math.max(48, Math.round(r.height));
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        cv.__css = { w, h, dpr };
      }
      // Cheap fake of the game's ring/burst maths: no pooling needed for eight
      // small canvases, and it keeps the preview code out of the hot game path.
      const state = cvs.map((cv) => ({
        cv, ctx: cv.getContext('2d'), def: C.SIGNATURES.find((s) => s.id === cv.getAttribute('data-sig')),
        t: Math.random() * 2.6, rings: [], dots: [],
        c: colourOf(cv), orb: cv.getAttribute('data-orb'),
      }));
      const BEAT = 2.6;
      const fire = (st, moment) => {
        const m = st.def && st.def[moment];
        if (!m) return;
        const unit = 7;
        if (m.ring) {
          const n = Math.max(1, m.ring.n || 1);
          for (let i = 0; i < n; i++) {
            st.rings.push({ s: m.ring, age: -(i * (m.ring.delay || 0)), unit,
              col: m.ring.hue != null && !m.ring.white
                ? `hsl(${m.ring.hue} 95% 66%)`
                : `hsl(${st.c.h} ${st.c.s}% ${st.c.l}%)` });
          }
        }
        if (m.burst) {
          const b = m.burst, n = Math.min(26, b.n || 8);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, sp = (b.spMax || 200) * 0.16 * (0.4 + Math.random() * 0.6);
            st.dots.push({ x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
              life: (b.lifeMax || 0.6) * (0.5 + Math.random() * 0.5), age: 0,
              size: (b.sizeMax || 4) * 0.5, grav: (b.grav || 0) * 0.14, drag: b.drag == null ? 0.9 : b.drag });
          }
        }
      };
      let last = 0;
      const step = (now) => {
        if (!this._sigRaf) return;
        const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
        last = now;
        for (const st of state) {
          const prev = st.t;
          st.t = (st.t + dt) % BEAT;
          if (st.t < prev) { st.rings.length = 0; st.dots.length = 0; }
          // beat: flip at 0.15, flip at 0.9, death at 1.7
          for (const [at, moment] of [[0.15, 'flip'], [0.9, 'flip'], [1.7, 'death']]) {
            if (prev < at && st.t >= at) fire(st, moment);
          }
          const { ctx, cv } = st;
          const box = cv.__css || { w: cv.width, h: cv.height, dpr: 1 };
          const w = box.w, h = box.h, cx = w * 0.5, cy = h * 0.5;
          ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.save();
          ctx.translate(cx, cy);
          // The orb the set actually contains, drawn where the effect fires
          // from. Without it the card sold three things and pictured one.
          if (st.orb) {
            const base = `hsl(${st.c.h} ${st.c.s}% ${st.c.l}%)`;
            ctx.save();
            ctx.globalAlpha = 0.9; ctx.shadowColor = base; ctx.shadowBlur = 16;
            ctx.fillStyle = base; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0; ctx.globalAlpha = 1;
            ctx.fillStyle = `hsl(${st.c.h} ${Math.max(0, st.c.s - 25)}% ${Math.min(97, st.c.l + 30)}%)`;
            ctx.beginPath(); ctx.arc(0, 0, 4.2, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }
          for (let i = st.rings.length - 1; i >= 0; i--) {
            const r = st.rings[i];
            r.age += dt;
            if (r.age < 0) continue;
            const life = r.s.life || 0.5;
            if (r.age >= life) { st.rings.splice(i, 1); continue; }
            const tt = r.age / life, e = 1 - Math.pow(1 - tt, 2.2);
            const rad = ((r.s.r0 || 1) + ((r.s.r1 || 3) - (r.s.r0 || 1)) * e) * r.unit;
            if (rad <= 0.5) continue;
            ctx.globalAlpha = (1 - tt) * (r.s.dark ? 0.85 : 0.7);
            ctx.lineWidth = Math.max(0.5, (r.s.width || 2) * (1 - tt * 0.6));
            ctx.strokeStyle = r.s.dark ? 'rgba(4,5,14,0.95)' : r.s.white ? '#fff' : r.col;
            ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.stroke();
            if (r.s.dark) {
              ctx.globalAlpha = (1 - tt) * 0.5;
              ctx.lineWidth = Math.max(0.5, (r.s.width || 2) * 0.35);
              ctx.strokeStyle = r.col;
              ctx.beginPath(); ctx.arc(0, 0, rad + (r.s.width || 2) * 0.5, 0, Math.PI * 2); ctx.stroke();
            }
          }
          for (let i = st.dots.length - 1; i >= 0; i--) {
            const d = st.dots[i];
            d.age += dt;
            if (d.age >= d.life) { st.dots.splice(i, 1); continue; }
            const k = Math.pow(d.drag, dt * 60);
            d.vy += d.grav * dt; d.vx *= k; d.vy *= k;
            d.x += d.vx * dt; d.y += d.vy * dt;
            ctx.globalAlpha = (1 - d.age / d.life) * 0.85;
            ctx.fillStyle = `hsl(${st.c.h} ${st.c.s}% ${st.c.l}%)`;
            ctx.beginPath(); ctx.arc(d.x, d.y, d.size * (1 - d.age / d.life), 0, Math.PI * 2); ctx.fill();
          }
          // the orb itself, so the scale of the effect is legible
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = `hsl(${st.c.h} ${st.c.s}% ${st.c.l}%)`;
          ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        this._sigRaf = requestAnimationFrame(step);
      };
      this._sigRaf = requestAnimationFrame(step);
    },
    stopSigPreviews() {
      if (this._sigRaf) { cancelAnimationFrame(this._sigRaf); this._sigRaf = 0; }
    },

    // One card renderer for every catalogue; `kind` only picks the swatch style.
    renderCatalog(grid, list, equippedId, kind, iapOn) {
      if (kind === 'orbs') {
        const head = document.createElement('div');
        head.className = 'shop-sec';
        head.textContent = T('orbs');
        grid.appendChild(head);
      }
      for (const it of list) {
        const owned = C.owned(it.id);
        const equipped = it.id === equippedId;
        const price = C.price(it.id);
        const req = C.requirement(it.id);
        const card = document.createElement('div');
        card.className = 'shop-card' + (equipped ? ' equipped' : '') + (req ? ' earned' : '');
        const swatchCls = 'swatch' + (kind === 'trails' ? ' trail' : kind === 'maps' ? ' map'
          : kind === 'signatures' ? ' sig' : '');
        const swatchStyle = kind === 'orbs' ? this.skinSwatch(it)
          : kind === 'trails' ? this.trailSwatch(it)
          : kind === 'signatures' ? '' : this.mapArt(it);

        // What this world DOES to the game, said out loud. The description
        // underneath is flavour; this is the rule. A player choosing a world was
        // otherwise picking a colour scheme and finding out afterwards that the
        // gravity had changed.
        let badge = '';
        if (kind === 'maps') {
          const bits = [];
          if (it.trait && it.trait !== 'none') bits.push(T('trait_' + it.trait));
          if (it.gMul && it.gMul !== 1) bits.push(T(it.gMul < 1 ? 'traitLightG' : 'traitHeavyG'));
          if (it.gap && it.gap !== 1) bits.push(T(it.gap < 1 ? 'traitTightGaps' : 'traitWideGaps'));
          if (it.spawn && it.spawn !== 1) bits.push(T(it.spawn < 1 ? 'traitBusy' : 'traitSparse'));
          if (it.speed && it.speed !== 1) bits.push(T(it.speed > 1 ? 'traitFast' : 'traitSlow'));
          if (!bits.length) bits.push(T('trait_none'));
          badge = '<div class="map-traits">'
            + bits.map((b) => '<span class="map-trait">' + esc(b) + '</span>').join('')
            + '</div>';
        }

        let btns;
        if (equipped) btns = '<button class="c-btn equipped" disabled>' + T('equipped') + '</button>';
        else if (owned) btns = '<button class="c-btn equip" data-act="equip" data-id="' + it.id + '">' + T('equip') + '</button>';
        else if (req) {
          // earned only — show the achievement that unlocks it, never a price
          btns = '<button class="c-btn locked earned-btn" disabled>★ ' + T('ach_' + req) + '</button>';
        } else {
          const afford = Store.shards >= price.shards;
          btns = '<button class="c-btn buy' + (afford ? '' : ' locked') + '" data-act="buy" data-id="' + it.id + '">◆ ' + price.shards.toLocaleString() + '</button>';
          if (price.usd && iapOn) {
            const sb = LUMEN.IAP.sandbox ? ' sandbox' : '';
            btns += '<button class="c-btn cash' + sb + '" data-act="cash" data-id="' + it.id + '">' + LUMEN.IAP.formatPrice(price.usd, it.id) + '</button>';
          }
        }
        // The flavour line is the item's voice. It never carries information you
        // need — that's the description's job — so it can be as dry as it likes.
        const flav = T('cosf_' + it.id);
        // A world that is themed for an occasion says so when the occasion is
        // here. Purely informational — the price and everything else are
        // unchanged, so this can only ever be good news.
        const featured = C.inSeason && C.inSeason() === it.id
          ? '<div class="c-season">' + T('inSeason') + '</div>' : '';
        // A signature is a MOTION, and a still picture of a motion sells
        // nothing. Its swatch is a tiny canvas that loops the effect, so the
        // thing on the card is the thing you get.
        const swatchTag = kind === 'signatures'
          ? '<canvas class="swatch sig" width="168" height="76" data-sig="' + it.id + '"></canvas>'
          : '<div class="' + swatchCls + '"></div>';
        card.innerHTML =
          swatchTag +
          featured +
          '<div class="c-name">' + C.name(it.id) + '</div>' +
          '<div class="c-desc">' + C.desc(it.id) + '</div>' +
          badge +
          (flav && flav !== 'cosf_' + it.id ? '<div class="c-flav">' + flav + '</div>' : '') +
          '<div class="c-buys">' + btns + '</div>';
        // Set the swatch style as a property, not inside the markup: the map
        // preview is an SVG data URI and its quotes would close the style="…"
        // attribute early, which is exactly why the map cards came out blank.
        if (swatchStyle) card.firstChild.setAttribute('style', swatchStyle);
        grid.appendChild(card);
      }
    },

    // Every shop button gets its listener from HERE, once, after the whole grid
    // is built. It used to live at the end of renderCatalog, which broke in two
    // directions at once:
    //
    //   - Under the SETS filter renderCatalog never runs, so no set button was
    //     ever wired. Tapping BUY on a pack did nothing at all -- no sound, no
    //     message, no purchase -- and SETS is the obvious place to go looking
    //     for a pack you just heard about.
    //   - Under ALL it runs three times and each pass re-queried the WHOLE
    //     grid, so a set button collected three listeners and one tap ran three
    //     purchases: the first bought the set and the next two failed against
    //     the now-complete set, ending a SUCCESSFUL purchase on the failure
    //     sound and "not enough shards".
    //
    // One call site, after everything is in the DOM, and both are gone.
    wireShopActions(grid) {
      grid.querySelectorAll('button[data-act]').forEach((b) => {
        if (b._wired) return;              // belt and braces: never twice
        b._wired = true;
        onTap(b, () => this.shopAction(b.getAttribute('data-act'), b.getAttribute('data-id')));
      });
    },

    // Consumables: shard-only, deliberately scarce, and the limits are stated
    // right on the screen so the scarcity reads as a rule and not a bug.
    renderItemsShop(grid, note) {
      const P = LUMEN.Progression;
      note.classList.remove('hidden');
      note.textContent = T('itemsNote', { each: P.MAX_PER_TYPE, total: P.MAX_TOTAL });
      for (const it of P.ITEMS) {
        const have = P.stock(it.id);
        const full = have >= P.MAX_PER_TYPE;
        const capped = P.stockTotal() >= P.MAX_TOTAL && !full;
        const afford = Store.shards >= it.cost;
        // Colour and letter come from the game's own table, so an item added to
        // Progression.ITEMS is drawn correctly here without touching this file.
        const def = (LUMEN.POWER_DEF && LUMEN.POWER_DEF[it.id]) || { hue: 200, glyph: '?' };
        const card = document.createElement('div');
        card.className = 'shop-card item-card';
        let btn;
        if (full) btn = '<button class="c-btn equipped" disabled>' + T('carried') + '</button>';
        else if (capped) btn = '<button class="c-btn locked" disabled>' + T('bagFull') + '</button>';
        else btn = '<button class="c-btn buy' + (afford ? '' : ' locked') + '" data-item="' + it.id + '">◆ ' + it.cost + '</button>';
        card.innerHTML =
          '<div class="item-glyph" style="--ic:hsl(' + def.hue + ' 95% 66%)">' + def.glyph + '</div>' +
          '<div class="c-name">' + T('pw_' + it.id).replace('!', '') + '</div>' +
          '<div class="c-desc">' + T('itemd_' + it.id) + '</div>' +
          '<div class="item-have">' + T('carrying') + ' <b>' + have + '/' + P.MAX_PER_TYPE + '</b></div>' +
          '<div class="c-buys">' + btn + '</div>';
        grid.appendChild(card);
      }
      grid.querySelectorAll('button[data-item]').forEach((b) => {
        onTap(b, () => {
          if (P.buyItem(b.getAttribute('data-item'))) { Audio && Audio.sfx('best'); this.toast(T('itemBought')); }
          else { Audio && Audio.sfx('flowEnd'); this.toast(T('notEnough')); }
          this.renderShop();
        });
      });
    },

    // ---- game modes --------------------------------------------------------
    openModes() { this.showScreen('modes'); this.renderModes(); },
    renderModes() {
      if (!this._ready || !LUMEN.Modes) return;
      const M = LUMEN.Modes;
      const list = $('modes-list');
      list.innerHTML = '';
      const cur = Store.mode || 'classic';
      for (const m of M.MODES) {
        const on = m.id === cur;
        const best = m.id === 'classic' ? Store.best : M.best(m.id);
        const el = document.createElement('div');
        el.className = 'mode-card' + (on ? ' on' : '');
        el.style.setProperty('--mc', 'hsl(' + m.accent + ' 90% 62%)');
        // Say plainly what a mode does to your score and your wallet. A player
        // should never find out after the fact that a run didn't count.
        const facts = [];
        if (m.scoreMul !== 1 && m.ranked) facts.push('×' + m.scoreMul.toFixed(2).replace(/0$/, '') + ' ' + T('score').toLowerCase());
        if (!m.ranked) facts.push(T('modeUnranked'));
        // The whole card is the control. Making people find a SELECT button
        // inside a thing they already tapped is a step that earns nothing — the
        // selected one just wears a tick instead.
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
        el.innerHTML =
          '<div class="mc-top">' +
            '<span class="mc-dot"></span>' +
            '<b class="mc-name">' + M.name(m.id) + '</b>' +
            (on ? '<span class="mc-on">✓</span>' : '') +
            '<span class="mc-tag">' + M.tag(m.id) + '</span>' +
          '</div>' +
          '<div class="mc-desc">' + M.desc(m.id) + '</div>' +
          '<div class="mc-foot">' +
            '<span class="mc-best">' + T('best') + ' <b>' + best.toLocaleString() + '</b></span>' +
            (facts.length ? '<span class="mc-facts">' + facts.join(' · ') + '</span>' : '') +
          '</div>';
        el.setAttribute('data-mode', m.id);
        list.appendChild(el);
      }
      const pick = (id) => {
        if (Store.mode === id) return;
        LUMEN.Modes.setCurrent(id);
        Audio && Audio.sfx('ui');
        this.toast(T('modeNow', { m: LUMEN.Modes.name(id) }));
        this.renderModes();
        this.refreshMenu();
        // renderModes() rebuilds every card, which destroys the one the player
        // was standing on — a keyboard user pressing Enter on a card was dumped
        // back to <body> and lost their place in a ten-row list. Put focus back
        // on the card they just chose.
        const again = list.querySelector('.mode-card[data-mode="' + id + '"]');
        if (again) again.focus();
      };
      list.querySelectorAll('.mode-card[data-mode]').forEach((c) => {
        c.classList.add('ui-interactive');
        onTap(c, () => pick(c.getAttribute('data-mode')));
        c.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(c.getAttribute('data-mode')); }
        });
      });
    },

    // ---- checkout ----------------------------------------------------------
    // Returns a promise the IAP provider awaits, so the payment layer stays
    // ignorant of the DOM and the UI stays ignorant of payments.
    confirmPurchase(id, usd) {
      return new Promise((resolve) => {
        const isMap = C.MAPS.some((m) => m.id === id);
        const isTrail = C.TRAILS.some((t) => t.id === id);
        const def = C.def ? C.def(id) : null;
        const sw = $('checkout-swatch');
        sw.className = 'co-swatch ' + (isTrail ? 'trail' : isMap ? 'map' : 'orb');
        if (def) {
          sw.setAttribute('style', isTrail ? this.trailSwatch(def) : isMap ? this.mapSwatch(def) : this.skinSwatch(def));
        }
        $('checkout-name').textContent = C.name(id);
        $('checkout-price').textContent = LUMEN.IAP.formatPrice(usd, id);
        const sandbox = LUMEN.IAP.sandbox;
        $('checkout-tag').textContent = sandbox ? T('sandboxTag') : '';
        $('checkout-tag').classList.toggle('hidden', !sandbox);
        $('checkout-note').textContent = sandbox ? T('sandboxNote') : T('checkoutNote');

        const done = (ok) => {
          this._checkoutResolve = null;
          this.showScreen('shop');
          this.renderShop();
          resolve({ ok: ok, receipt: ok ? 'sandbox-' + id : null });
        };
        this._checkoutResolve = done;
        this.showScreen('checkout');
      });
    },

    // ---- achievements ------------------------------------------------------
    // Skills used to share this screen; they live in the shop now, because that's
    // where a player goes looking for something to spend shards on.
    openProgress() {
      this.showScreen('progress');
      this.renderProgress();
    },
    renderProgress() {
      if (!this._ready) return;
      const P = LUMEN.Progression;
      const body = $('prog-body');
      $('prog-shards').textContent = Store.shards;
      body.innerHTML = '';
      if (!P) return;

      {
        const rows = P.list();
        const sum = P.summary();

        // headline: how far through the whole set you are
        const hero = document.createElement('div');
        hero.className = 'achv-hero';
        const pctAll = Math.round((sum.done / sum.total) * 100);
        hero.innerHTML =
          '<div class="ah-num">' + sum.done + '<span>/' + sum.total + '</span></div>' +
          '<div class="ah-bar"><i style="width:' + pctAll + '%"></i></div>' +
          '<div class="ah-sub">' + T('achvComplete', { p: pctAll }) + '</div>';
        body.appendChild(hero);

        P.CATEGORIES.forEach((cat) => {
          const inCat = rows.filter((r) => r.cat === cat);
          if (!inCat.length) return;
          const head = document.createElement('div');
          head.className = 'achv-cat';
          head.innerHTML = '<span>' + T('achvcat_' + cat) + '</span><b>' +
            inCat.filter((r) => r.done).length + '/' + inCat.length + '</b>';
          body.appendChild(head);

          inCat.forEach((a) => {
            const el = document.createElement('div');
            el.className = 'mission achv' + (a.done ? ' done' : '');
            const pct = Math.round((a.progress / a.goal) * 100);
            // an achievement that hands over an exclusive cosmetic says so loudly
            const prize = a.unlocks
              ? '<span class="a-prize">🎁 ' + C.name(a.unlocks) + '</span>' : '';
            el.innerHTML =
              '<div class="m-text">' + (a.done ? '★ ' : '') + T('ach_' + a.id) + prize + '</div>' +
              '<div class="m-reward">◆' + a.reward + '</div>' +
              '<div class="m-bar"><i style="width:' + pct + '%"></i></div>' +
              '<div class="m-sub">' + a.progress.toLocaleString() + ' / ' + a.goal.toLocaleString() + '</div>';
            body.appendChild(el);
          });
        });
      }
    },

    // ---- shop tab: skills --------------------------------------------------
    renderSkillsShop(grid, note) {
      const P = LUMEN.Progression;
      note.classList.remove('hidden');
      note.textContent = T('skillsNote');
      P.SKILLS.forEach((sk) => {
        const lv = P.level(sk.id);
        const cost = P.nextCost(sk.id);
        const maxed = cost == null;
        const afford = !maxed && Store.shards >= cost;
        const el = document.createElement('div');
        el.className = 'skill' + (maxed ? ' maxed' : '');
        const pips = Array.from({ length: sk.max }, (_, i) =>
          '<i class="' + (i < lv ? 'on' : '') + '"></i>').join('');
        el.innerHTML =
          '<div class="s-head"><b>' + T('skill_' + sk.id) + '</b><span class="s-pips">' + pips + '</span></div>' +
          '<div class="s-desc">' + T('skilld_' + sk.id) + '</div>' +
          '<div class="s-row">' +
            '<span class="s-now">' + T('now') + ' <b>' + sk.fmt(sk.values[lv]) + '</b>' +
            (maxed ? '' : ' → <b>' + sk.fmt(sk.values[lv + 1]) + '</b>') + '</span>' +
            (maxed
              ? '<button class="c-btn equipped" disabled>' + T('maxed') + '</button>'
              : '<button class="c-btn buy' + (afford ? '' : ' locked') + '" data-skill="' + sk.id + '">◆ ' + cost + '</button>') +
          '</div>';
        grid.appendChild(el);
      });
      grid.querySelectorAll('button[data-skill]').forEach((b) => {
        onTap(b, () => {
          if (P.upgrade(b.getAttribute('data-skill'))) {
            Audio && Audio.sfx('best');
            this.toast(T('upgraded'));
          } else {
            Audio && Audio.sfx('flowEnd');
            this.toast(T('notEnough'));
          }
          this.renderShop();
        });
      });
    },

    // ---- leaderboard -----------------------------------------------------
    openScores() {
      this.setBoard(this.boardTab || 'me');
      this.showScreen('scores');
      // Close the gap between what this device knows and what the board holds,
      // every single time the board is opened.
      //
      // This used to run at sign-in and at rename only, which meant one missed
      // submit — a flight, a dropped request, an account swapped underneath —
      // left the two disagreeing forever, and the only place that could notice
      // was a screen the player had already been through. Doing it on the way IN
      // costs one small request and makes the disagreement self-correcting:
      // looking at the board is what fixes the board. It cannot push a lower
      // score over a higher one, because it asks the board first.
      const LB = LUMEN.Leaderboard;
      // The players this rescues are ALREADY signed in, so fixing the sign-in
      // prompt alone would never reach them -- they have no reason to sign in
      // again. The board is the one screen they do come back to, so the question
      // gets asked here too, with their existing name already in the field: one
      // tap of SAVE and they are publishing again.
      //
      // Once per launch, and never persisted. Declining has to be free or this
      // is a trap rather than a question, and a player who says no should not
      // have to say it twice in one sitting -- but should be asked again next
      // time, because the board is still not carrying them.
      if (LB && LB.enabled && LUMEN.Auth && LUMEN.Auth.signedIn && LB.needsSetup && !this._askedSetup) {
        this._askedSetup = true;
        this.openNameScreen('scores');
        return;
      }
      if (LB && LB.canSubmit) {
        LB.seedFromLocalBests()
          .then((offered) => (offered ? LB.flushPending() : null))
          .then((sent) => {
            // Repaint only if something actually went up AND the player is still
            // looking, so this never yanks a screen they have moved on from.
            if (sent && sent.length && this.currentScreen === 'scores') {
              this.setBoard(this.boardTab || 'me');
            }
          })
          .catch(() => {});
      }
    },

    // Three boards behind one screen: your own runs (always available, offline)
    // and the two server boards. The online tabs stay visible but say plainly
    // when no server is configured, rather than pretending the feature is absent.
    setBoard(tab) {
      // WHERE YOU CANNOT SIGN IN, THERE IS NO SHARED BOARD.
      //
      // On Android the Apple plugin is a stub, so Auth is off (js/auth.js
      // canSignIn) and no score of yours can ever reach the table. Leaving the
      // online tabs up would show a wall of other players' chosen display names
      // that you can look at and never join — a dead end as a feature, and on
      // Google Play a listing that has to declare it shows user-generated
      // content and lets users interact. Neither is worth a board you cannot
      // enter. The local top ten is untouched and is the whole screen there.
      const canOnline = !!(LUMEN.Auth && LUMEN.Auth.enabled);
      if (!canOnline) tab = 'me';
      ['daily', 'all'].forEach((t) => {
        const el = $('tab-lb-' + t);
        if (el) el.classList.toggle('hidden', !canOnline);
      });
      this.boardTab = tab;
      ['me', 'daily', 'all'].forEach((t) => {
        const el = $('tab-lb-' + t);
        if (el) el.classList.toggle('active', tab === t);
      });
      const LB = LUMEN.Leaderboard;
      // Every element here is optional: this module is also loaded by the test
      // page, which has the scripts but not the markup, and a null here used to
      // take the whole board down.
      const NOOP = { classList: { add() {}, remove() {}, toggle() {} }, textContent: '', innerHTML: '' };
      const note = $('lb-note') || NOOP;
      const refresh = $('btn-lb-refresh');
      const nameRow = null;
      // only the online boards have anything to re-fetch, or a name to carry
      const onlineTab = tab !== 'me' && !!LB && LB.enabled;
      if (refresh) refresh.classList.toggle('hidden', !onlineTab);
      // The shared board needs an account. Signed out, the name field is not
      // shown at all: offering somewhere to type a name that cannot be
      // submitted is how the old screen taught people it was broken.
      const A = LUMEN.Auth;
      const authed = !!(A && A.signedIn);
      const gate = $('lb-gate');
      // ...and only where signing in is possible at all. On Android the Apple
      // plugin is a stub (see js/auth.js canSignIn), so offering the button
      // there would teach the same "this screen is broken" lesson the comment
      // above is about — just one platform further along.
      const canAuth = !!(A && A.enabled);
      if (gate) gate.classList.toggle('hidden', !(onlineTab && !authed && canAuth));
      if (tab === 'me') {
        note.classList.add('hidden');
        return this.renderScores();
      }
      if (!LB || !LB.enabled) {
        ($('score-list') || NOOP).innerHTML = '';
        ($('score-empty') || NOOP).classList.add('hidden');
        note.classList.remove('hidden');
        note.textContent = T('lbOffline');
        return;
      }
      // If we already have this board, put it up instantly and say nothing —
      // "LOADING" over a list we are holding in memory is a lie that costs a
      // frame of confidence every time somebody flicks between tabs.
      const scope = tab === 'daily' ? 'daily' : 'alltime';
      const have = LB.cached(scope);
      if (have) {
        note.classList.add('hidden');
        this.paintOnlineScores(have);
      } else {
        note.classList.remove('hidden');
        note.textContent = T('lbLoading');
      }
      this.loadOnlineScores(scope, false);
    },

    // The account row, absent entirely unless sign-in is configured. A button
    // that cannot work is worse than no button: it reads as a broken feature
    // rather than an absent one.
    // Guideline 5.1.1(v). Two confirmations, because this is the one action in
    // the game that cannot be undone and does not cost shards to find out.
    deleteAccount() {
      const A = LUMEN.Auth;
      if (!A || !A.signedIn) return;
      if (!window.confirm(T('deleteAcctConfirm'))) return;
      const btn = $('btn-acct-delete');
      if (btn) btn.disabled = true;
      A.deleteAccount().then((r) => {
        if (btn) btn.disabled = false;
        // Say what actually happened. `deleteMine` reports false when the table
        // has no DELETE policy, and the Edge Function reports false when it is
        // not deployed — in both cases the player is signed out here but their
        // row may still be on the board, and telling them it is gone would be
        // the one lie this screen must not tell.
        this.toast(r && r.row && r.account ? T('deleteAcctDone') : T('deleteAcctPartial'));
      }).catch(() => {
        if (btn) btn.disabled = false;
        this.toast(T('deleteAcctPartial'));
      });
    },

    onAuthChange() {
      const A = LUMEN.Auth;
      const sec = $('acct-sec'), row = $('acct-row'), who = $('acct-who'), btn = $('btn-apple');
      const delRow = $('acct-del-row');
      if (!sec || !row) return;
      // Always present, never demanded. The row stays in Settings whether or
      // not anyone has signed in, because a feature you can only find after you
      // already know about it may as well not exist — and an account here is a
      // recommendation, not a gate: every screen of this game works without one.
      const on = !!(A && A.enabled);
      sec.classList.toggle('hidden', !on);
      row.classList.toggle('hidden', !on);
      if (delRow) delRow.classList.add('hidden');
      if (!on) return;
      const inn = A.signedIn;
      // Only offered when there is something to delete. Apple requires the path
      // to exist for anyone who made an account; showing it to someone who never
      // did is just a frightening button.
      if (delRow) delRow.classList.toggle('hidden', !inn);
      // The leaderboard's sign-in gate is built in setBoard, so signing in from
      // THERE left the button sitting on screen — the account was real, the
      // screen just never redrew, and it reads exactly like a button that does
      // nothing. Anything that changes the session has to redraw the board too.
      if (this.currentScreen === 'scores') this.setBoard(this.boardTab || 'me');
      if (who) who.textContent = inn ? T('signedInAs') : T('acctWhy');
      // The label names the provider that will actually run. Apple's glyph on an
      // Android phone is wrong twice over — the sheet that opens is Google's,
      // and Google's branding rules do not allow their sign-in to be presented
      // as somebody else's.
      const signInKey = (A.provider === 'google') ? 'signInGoogle' : 'signInApple';
      if (btn && btn.querySelector('span')) {
        btn.querySelector('span').textContent = inn ? T('signOut') : T(signInKey);
      }
      const gateBtn = $('btn-lb-signin');
      if (gateBtn && gateBtn.querySelector('span')) {
        gateBtn.querySelector('span').textContent = T(signInKey);
      }
      // Changing your name lives HERE now, and only once there is an account to
      // attach it to. It used to sit on the leaderboard, where it read as a
      // chore rather than a setting.
      const edit = $('btn-name-edit');
      if (edit) edit.classList.toggle('hidden', !inn);
    },

    signInApple() {
      const A = LUMEN.Auth;
      if (!A || !A.enabled) return;
      if (A.signedIn) { A.signOut().then(() => this.onAuthChange()); return; }
      A.signIn().then(() => {
        this.onAuthChange();
        // Ask for a name here, once, while the player is already thinking about
        // who they are. Leaving it to a field on another screen is what made it
        // look like an extra chore nobody had asked for -- and a board full of
        // people who never found it.
        // Asked once, here, and it returns to the board afterwards.
        //
        // `needsSetup`, not `!named`: the name screen is also where consent is
        // given, and those two have been separate things since 23 August. A
        // player who typed a name before that has the first and not the second.
        const LB = LUMEN.Leaderboard;
        if (LB && LB.needsSetup) this.openNameScreen('scores');
        // Signing in is the moment a held best finally has an owner.
        if (LB) LB.seedFromLocalBests().then(() => LB.flushPending()).catch(() => {});
      }).catch((e) => {
        // A cancelled sheet is not a failure and must not be reported as one.
        const msg = String((e && e.message) || '');
        if (/cancel|1001|popup_closed/i.test(msg)) return;
        // The one failure the player can do something about, said plainly
        // instead of as an error code they would have to look up.
        if (/no-google-account/i.test(msg)) { this.toast(T('noGoogleAccount')); return; }
        // Say WHAT went wrong. The first version toasted one fixed sentence for
        // every cause, so the only report anybody could make was "it says it
        // didn't complete" — which is exactly as much as it told me too.
        // Apple's message names neither the entitlement nor the profile, so the
        // CODE is the only part that distinguishes "you tapped cancel" from
        // "this build cannot do this at all".
        const code = e && (e.code != null ? e.code : e.errorCode);
        this.toast(T('signInFailed') + (code != null ? ' [' + code + ']' : '')
          + (msg ? ' ' + msg.slice(0, 80) : ''));
      });
    },

    // One screen, one question. `_nameNext` is where SAVE goes afterwards, so
    // the first-run path lands on the board and a later edit returns to Settings
    // — the same screen doing two jobs without either feeling like a detour.
    openNameScreen(back) {
      this._nameNext = back || 'settings';
      const input = $('name-input');
      if (input) {
        input.value = (LUMEN.Leaderboard && LUMEN.Leaderboard.playerName) || '';
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); this.saveName(); }
        }, { once: true });
      }
      this.showScreen('name');
      if (input) { try { input.focus(); } catch (e) { /* no keyboard here */ } }
    },

    // Saving a name is not filing it away for later — it is the act of asking to
    // be on the board. The old field did only the first half: it stored a string
    // and waited for some future personal best, so a player who had already set
    // theirs typed a name, saw nothing change, and was right to call it broken.
    saveName() {
      const LB = LUMEN.Leaderboard;
      const input = $('name-input');
      if (!LB || !input) return;
      const name = LB.cleanName(input.value);
      input.value = name;                       // show what was actually accepted
      if (!name) { this.toast(T('lbNameEmpty')); return; }
      // CONSENT, recorded at the one moment the player asks for their name to go
      // up, and before any request is made. The disclosure naming exactly what
      // is uploaded and who can see it sits directly above this button; pressing
      // it is the affirmative act. Set it here rather than after the network
      // calls below, because rename() is itself a request.
      Store.boardConsent = true;
      // Rename FIRST, then send anything held. Renaming updates the rows this
      // player already owns; sending first would put the old name up one last
      // time and leave it there.
      LB.rename(name).catch(() => {}).then(() => LB.seedFromLocalBests()).then(() => LB.flushPending()).then((sent) => {
        this.toast((sent && sent.length) ? T('lbNameSent', { n: name }) : T('lbNameSaved', { n: name }));
        if (this.boardTab !== 'me') this.refreshBoard();
        this.showScreen(this._nameNext || 'settings');
      }).catch(() => {
        this.toast(T('lbNameSaved', { n: name }));
        this.showScreen(this._nameNext || 'settings');
      });
    },


    // The online boards are fetched once per session. This is the one control
    // that goes and looks again.
    refreshBoard() {
      const LB = LUMEN.Leaderboard;
      if (!LB || !LB.enabled || this.boardTab === 'me') return;
      const scope = this.boardTab === 'daily' ? 'daily' : 'alltime';
      LB.invalidate(scope);
      const note = $('lb-note');
      note.classList.remove('hidden');
      note.textContent = T('lbLoading');
      this.loadOnlineScores(scope, true);
    },

    // Everything degrades: a failed request says so instead of silently
    // leaving a stale list on screen.
    loadOnlineScores(scope, force) {
      const LB = LUMEN.Leaderboard;
      if (!LB || !LB.enabled) return;
      const want = this.boardTab;
      LB.top(scope, 20, force).then((res) => {
        if (this.boardTab !== want) return;           // player switched tabs mid-flight
        const note = $('lb-note');
        if (!res || !res.rows) { note.classList.remove('hidden'); note.textContent = T('lbFailed'); return; }
        note.classList.add('hidden');
        this.paintOnlineScores(res.rows);
      }).catch(() => {
        if (this.boardTab !== want) return;
        // Keep whatever is already on screen if we have it — a network blip is
        // no reason to blank a board the player is reading.
        if (LB.cached(scope)) return;
        $('lb-note').classList.remove('hidden');
        $('lb-note').textContent = T('lbFailed');
      });
    },

    paintOnlineScores(rows) {
      const list = $('score-list');
      if (!list) return;
      list.innerHTML = '';
      const empty = $('score-empty');
      if (empty) empty.classList.toggle('hidden', rows.length > 0);
      // "Why isn't my name here?" is the first question anyone asks a board, and
      // twenty rows of strangers is a slow way to answer it.
      const mine = (LUMEN.Leaderboard && LUMEN.Leaderboard.cleanName(LUMEN.Leaderboard.playerName) || '').toLowerCase();
      // Whose row is it, by the id that owns it. Matching the NAME instead told
      // a player that a row was theirs whenever the string happened to agree —
      // which is how an old unowned row, left by a signed-out self, wore "(you)"
      // on a board this player had never once been on. It would say the same of
      // any stranger who typed their name. Rows written before accounts carry no
      // owner at all, so those still fall back to the name: it is the only thing
      // they have, and it is right more often than it is wrong.
      const myId = (LUMEN.Auth && LUMEN.Auth.userId) || '';
      rows.forEach((e, i) => {
        const li = document.createElement('li');
        const isMe = e.user_id
          ? (!!myId && e.user_id === myId)
          : (!!mine && String(e.name || '').toLowerCase() === mine);
        li.className = (i === 0 ? 'top' : '') + (isMe ? ' you' : '');
        // textContent, not innerHTML — names come from other people
        const pos = document.createElement('span'); pos.className = 'pos'; pos.textContent = i + 1;
        const nm = document.createElement('span'); nm.className = 'val';
        nm.textContent = e.name + (isMe ? ' (' + T('lbYou') + ')' : '');
        const sc = document.createElement('span'); sc.className = 'cmb'; sc.textContent = Number(e.score).toLocaleString();
        const cb = document.createElement('span'); cb.className = 'dt'; cb.textContent = '×' + (e.combo || 0);
        li.append(pos, nm, sc, cb);
        list.appendChild(li);
      });
    },
    renderScores() {
      const list = $('score-list');
      if (!list) return;                 // scripts without the markup (test page)
      list.innerHTML = '';
      const rows = LUMEN.Scores ? LUMEN.Scores.list() : [];
      const empty = $('score-empty');
      if (empty) empty.classList.toggle('hidden', rows.length > 0);
      rows.forEach((e, i) => {
        const li = document.createElement('li');
        if (i === 0) li.className = 'top';
        // textContent, not innerHTML. These rows look like our own data, but a
        // transfer code can put anything in them: Save.apply writes the pasted
        // string straight into localStorage, so `d` arrives from whoever wrote
        // the code. Sixteen lines up, paintOnlineScores already builds its rows
        // this way for exactly this reason — this one was simply missed.
        const span = (cls, text) => {
          const el = document.createElement('span');
          el.className = cls;
          el.textContent = text;
          return el;
        };
        // Which game this score came from. Without it a Sprint run sitting above
        // a Classic one looks like a bug rather than a different question — and
        // that ambiguity is the whole reason these rows used to be thrown away.
        const m = e.m || 'classic';
        const modeName = m === 'daily' ? T('lbDaily')
          : (LUMEN.Modes && LUMEN.Modes.name ? LUMEN.Modes.name(m) : m);
        // Stacked into the existing last column rather than added as a fifth
        // one: five columns fit a desktop and crush a phone.
        const when = document.createElement('span');
        when.className = 'dt';
        when.append(span('mode', String(modeName || '')), span('day', String(e.d || '')));
        li.append(
          span('pos', String(i + 1)),
          span('val', Number(e.s).toLocaleString()),
          span('cmb', 'x' + (Number(e.c) || 0)),
          when
        );
        list.appendChild(li);
      });
    },

    // ---- tutorial --------------------------------------------------------
    showTutorialDone() { this.showScreen('tutdone'); },

    // Continue on an ad instead of shards. Once per run, and the shard price
    // stays: an ad must be an alternative to paying, never the only way to
    // carry on. Unlimited revives would also turn the shared board into a list
    // of who watched most, which is not what it is for.
    reviveWithAd() {
      const A = LUMEN.Ads, g = this.game;
      if (!A || !g || g.adRevived) return;
      const btn = $('btn-revive-ad');
      if (btn) btn.disabled = true;
      A.watchToRevive().then((ok) => {
        if (btn) btn.disabled = false;
        if (!ok) { this.toast(T('adNone')); return; }
        g.adRevived = true;
        // The run can have moved on while the video played: END RUN and MENU
        // were live the whole time. revive() refuses those now — and finalizing
        // them would be worse than doing nothing, because toMenu() calls reset()
        // which clears the already-recorded guard, so a finalize from the menu
        // banks the same run a second time.
        if (g.revive(true)) { this.varDecision(); return; }
        if (g.state === 'dead') g.finalizeRun();
      });
    },

    // ---- revive ----------------------------------------------------------
    showRevive(data) {
      if (!this._ready) return;
      // Hidden once it has been used, because the offer is per run.
      const adRow = $('revive-ad-row');
      if (adRow) {
        adRow.classList.toggle('hidden',
          !(LUMEN.Ads && LUMEN.Ads.available && this.game && !this.game.adRevived));
      }
      $('revive-cost').textContent = data.cost;
      // The panel now opens when the player cannot afford the shard price but
      // CAN watch an ad, so the shard button has to say so instead of failing
      // silently when tapped.
      const pay = $('btn-revive');
      if (pay) {
        const afford = LUMEN.Store.shards >= data.cost;
        pay.disabled = !afford;
        pay.classList.toggle('locked', !afford);
      }
      // The score you are being asked to save — which means the score you would
      // actually keep, multipliers and all. Showing the raw figure here made the
      // decision on a Sprint run look like half of what was really at stake.
      $('revive-score').textContent = Math.floor(this.game.score * this.game.scoreMul);
      this.dressRevive();
      this.showScreen('revive');
    },

    // A world may re-dress the revive panel. PITCH turns it into a VAR check:
    // the decision is literally pending while you decide, which is the one
    // moment in this game where waiting is the point rather than the cost.
    //
    // Nothing about the offer changes -- same shard price, same one-per-run
    // rule, same ad. Only the words and the frame, and only while that world is
    // equipped. Everything here is drawn or written by us: no broadcast
    // graphics, no league marks, no real match audio. The joke is the format.
    // The decision lands. On PITCH the panel flashes the verdict for a beat
    // before the run resumes; everywhere else this does nothing at all.
    varDecision() {
      const style = (C.mapDef && C.mapDef() || {}).reviveStyle || null;
      if (style !== 'var') return;
      this.dressRevive(true);
      const panel = document.querySelector('#screen-revive .panel');
      if (panel) {
        panel.classList.add('var-goal');
        setTimeout(() => panel.classList.remove('var-goal'), 900);
      }
      Audio && Audio.sfx('best');
      this.toast(T('varDecisionGoal'));
    },

    dressRevive(decided) {
      const panel = document.querySelector('#screen-revive .panel');
      if (!panel) return;
      const style = (C.mapDef && C.mapDef() || {}).reviveStyle || null;
      panel.classList.toggle('var-check', style === 'var');
      const title = panel.querySelector('.revive-title');
      const sub = panel.querySelector('.revive-sub');
      if (style === 'var') {
        if (title) title.textContent = decided ? T('varDecisionGoal') : T('varChecking');
        if (sub && !decided) sub.innerHTML = '<span>' + esc(T('varSub')) + '</span>';
      } else if (title) {
        // put the ordinary copy back, or a world switch leaves VAR wording behind
        title.textContent = T('continueQ');
        if (sub) sub.innerHTML = '<span>' + esc(T('reviveSub')) + '</span><br><em>' + esc(T('reviveOnce')) + '</em>';
      }
    },

    // ---- settings --------------------------------------------------------
    openSettings() { this.showScreen('settings'); this.renderSettings(); },

    // Switching language re-runs i18n.apply(), which rewrites every element
    // carrying data-i18n. That covers the markup in index.html and nothing else
    // — and the shop, the achievements, the modes list, the leaderboard and the
    // settings rows are all built in JavaScript from T() at the moment they are
    // opened. So a screen that was open when the language changed kept the old
    // one until you left and came back, which is exactly what it looks like when
    // a translation is missing. Nothing was missing; nothing had been redrawn.
    // Give every panel that can be closed a back button, top-left and sticky.
    //
    // Derived from the ✕ rather than hand-written into six headers: a screen
    // added later gets one for free, and one that loses its ✕ loses its back
    // button too, instead of keeping a control that closes nothing. The ✕ stays
    // put and keeps its handler — this presses it — so the close path itself is
    // untouched and there is nothing new to keep in sync.
    installBackButtons() {
      document.querySelectorAll('.overlay .panel').forEach((panel) => {
        const x = panel.querySelector('.icon-x');
        if (!x || panel.classList.contains('has-back')) return;
        const bar = document.createElement('div');
        bar.className = 'panel-back';
        const b = document.createElement('button');
        b.className = 'btn-back ui-interactive';
        b.type = 'button';
        b.setAttribute('aria-label', x.getAttribute('aria-label') || 'Back');
        b.setAttribute('data-i18n-aria', 'ariaClose');
        // The arrow is decorative; the word next to it is what gets translated,
        // and a screen reader should hear one label, not "left arrow BACK".
        const arw = document.createElement('span');
        arw.className = 'arw'; arw.setAttribute('aria-hidden', 'true');
        arw.textContent = '←';
        const label = document.createElement('span');
        label.setAttribute('data-i18n', 'back');
        label.textContent = T('back');
        b.append(arw, label);
        onTap(b, () => x.click());
        bar.appendChild(b);
        panel.insertBefore(bar, panel.firstChild);
        panel.classList.add('has-back');
      });
    },

    relocalize() {
      switch (this.currentScreen) {
        case 'shop':     this.renderShop(); this.updateTabs(); break;
        case 'modes':    this.renderModes(); break;
        case 'progress': this.renderProgress && this.renderProgress(); break;
        case 'scores':   this.setBoard(this.boardTab || 'me'); break;
        case 'settings': this.renderSettings(); break;
        case 'menu':     this.refreshMenu && this.refreshMenu(); break;
      }
    },
    renderSettings() {
      if (!this._ready) return;
      this.showBuildStamp();
      this.onAuthChange();
      const state = {
        music: Store.musicOn, sfx: Store.sfxOn, haptics: Store.hapticsOn,
        flash: Store.reduceFlash, contrast: Store.highContrast,
        consent: LUMEN.Consent ? LUMEN.Consent.granted : false,
        autouse: Store.autoUseItems, voice: Store.voiceControl, charge: Store.chargeFx,
      };
      document.querySelectorAll('#screen-settings .toggle').forEach((t) => {
        t.classList.toggle('on', !!state[t.getAttribute('data-set')]);
      });
      const q = Store.quality;
      document.querySelectorAll('#screen-settings .qbtn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-q') === q);
      });
      const active = $('q-active');
      if (active) active.textContent = q === 'auto' && LUMEN.Q ? '(' + LUMEN.Q.name + ')' : '';
      const lang = LUMEN.i18n ? LUMEN.i18n.lang : 'en';
      document.querySelectorAll('#screen-settings .langbtn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-lang') === lang);
      });
      const vRow = document.querySelector('#screen-settings [data-set="voice"]');
      if (vRow && LUMEN.Voice && !LUMEN.Voice.supported) {
        vRow.closest('.setting').classList.add('unavailable');
        const h = $('voice-hint'); if (h) h.textContent = T('voiceUnsupported');
      }
      const cb = Store.colorblind;
      document.querySelectorAll('#screen-settings .cbbtn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-cb') === cb);
      });
    },

    setQuality(name) {
      LUMEN.applyQuality(name);
      Audio && Audio.sfx('ui');
      this.renderSettings();
    },
    toggleSetting(key) {
      if (key === 'music') { Audio && Audio.setMusicEnabled(!Store.musicOn); }
      else if (key === 'sfx') { const on = !Store.sfxOn; Audio && Audio.setSfxEnabled(on); }
      else if (key === 'haptics') { Store.hapticsOn = !Store.hapticsOn; }
      else if (key === 'flash') { Store.reduceFlash = !Store.reduceFlash; }
      else if (key === 'contrast') { Store.highContrast = !Store.highContrast; }
      else if (key === 'consent') { LUMEN.Consent && LUMEN.Consent.set(!LUMEN.Consent.granted); }
      else if (key === 'autouse') { Store.autoUseItems = !Store.autoUseItems; }
      else if (key === 'charge') { Store.chargeFx = !Store.chargeFx; }
      else if (key === 'voice') {
        const want = !Store.voiceControl;
        if (want && LUMEN.Voice && !LUMEN.Voice.supported) { this.toast(T('voiceUnsupported')); return; }
        if (want && LUMEN.Voice) LUMEN.Voice._denied = false;   // a fresh, deliberate opt-in
        // The microphone, explained BEFORE it is asked for.
        //
        // Android's dialog says only "Allow LUMEN to record audio?", and a game
        // asking that out of nowhere gets refused — twice and it is refused
        // permanently, with no way back except the system settings app. So the
        // reason goes first, in the player's own language, and the OS is only
        // troubled once they have already agreed to it. (This whole branch used
        // to be unreachable on Android: the WebView has no Web Speech API, so
        // `supported` was false and the toggle did nothing at all.)
        const V = LUMEN.Voice;
        if (want && V && V.native && !V._micGranted) {
          if (!window.confirm(T('micWhy'))) { Audio && Audio.sfx('ui'); return; }
          V.requestMic().then((granted) => {
            if (!granted) { this.toast(T('micDenied')); this.renderSettings(); return; }
            Store.voiceControl = true;
            V.sync();
            this.renderSettings();
          });
          Audio && Audio.sfx('ui');
          return;
        }
        Store.voiceControl = want;
        LUMEN.Voice && LUMEN.Voice.sync();
        // On an origin the browser cannot store a permission against (a file://
        // page), the grant lasts only as long as this tab. Say so once — the
        // feature still works, it just cannot be remembered between launches.
        if (want && LUMEN.Voice && LUMEN.Voice.ephemeralPermission) this.toast(T('voiceFileHint'));
      }
      Audio && Audio.sfx('ui');
      this.renderSettings();
    },
    // ---- redeem a code -----------------------------------------------------
    // The code list is on the server and this client never receives it, so every
    // answer below — including "that code does not exist" — comes from there.
    // See js/perks.js and supabase/codes-and-daily.sql.
    redeemCode() {
      const R = LUMEN.Perks;
      const box = $('code-input');
      const btn = $('btn-code-redeem');
      if (!R || !box) return;
      const typed = box.value.trim();
      if (!typed || this._redeeming) return;
      this._redeeming = true;
      if (btn) btn.disabled = true;
      R.redeem(typed).then((res) => {
        this._redeeming = false;
        if (btn) btn.disabled = false;
        if (!res.ok) {
          // Every reason is a sentence the player can act on, in their own
          // language. A reason this build does not know about must still say
          // SOMETHING — building the key blind put a raw i18n key on screen
          // the first time the server learned a new word.
          const KNOWN = ['signin', 'unknown', 'expired', 'usedup', 'already', 'offline'];
          const r = KNOWN.indexOf(String(res.reason)) >= 0 ? String(res.reason) : 'unknown';
          this.toast(T('code' + r.charAt(0).toUpperCase() + r.slice(1)));
          return;
        }
        box.value = '';
        const bits = [];
        if (res.got.shards) bits.push(T('codeGotShards', { n: res.got.shards }));
        if (res.got.unlocked) bits.push(T('codeGotUnlocks', { n: res.got.unlocked }));
        this.toast(T('codeOk', { what: bits.join(' · ') }));
        this.renderSettings();
        this.refreshMenu();
        // Only when it is actually on screen: renderShop starts the signature
        // preview rAF loop, and starting it behind a closed shop animates
        // canvases nobody is looking at until something else stops it.
        if (this.currentScreen === 'shop') this.renderShop && this.renderShop();
      });
    },

    // ---- the daily reward --------------------------------------------------
    // The DAY comes from the database, not from this device — see
    // supabase/codes-and-daily.sql for why that is the whole point.
    openDaily() {
      const R = LUMEN.Perks;
      if (!R) return;
      // A generation counter, because status() is slow and COLLECT is fast: an
      // answer from before the claim would otherwise land afterwards and
      // re-enable a button for a day that is already collected.
      const gen = ++this._dailyGen;
      this.showScreen('daily');
      this._paintDaily({ loading: true });
      R.status().then((st) => {
        if (gen !== this._dailyGen || this.currentScreen !== 'daily') return;
        this._paintDaily(st);
        if (st && st.recovered) this.toast(T('dailyGot', { n: st.recovered, d: st.streak }));
      });
    },
    _dailyGen: 0,

    _paintDaily(st) {
      const line = $('daily-line');
      const btn = $('btn-daily-claim');
      const strk = $('daily-streak');
      if (!line || !btn) return;
      if (st && st.loading) { line.textContent = ''; btn.disabled = true; return; }
      if (!st || !st.ok) {
        const reason = (st && st.reason) || 'offline';
        line.textContent = T(reason === 'signin' ? 'dailySignin' : 'dailyOffline');
        btn.disabled = true;
        if (strk) strk.textContent = '';
        return;
      }
      if (strk) strk.textContent = T('dailyStreak', { n: st.streak });
      if (st.claimed) {
        line.textContent = T('dailyDone', { n: st.next });
        btn.disabled = true;
        btn.textContent = T('dailyClaim', { n: st.next });
        return;
      }
      line.textContent = '';
      btn.disabled = false;
      btn.textContent = T('dailyClaim', { n: st.shards });
    },

    claimDaily() {
      const R = LUMEN.Perks;
      const btn = $('btn-daily-claim');
      if (!R) return;
      if (btn) btn.disabled = true;
      const gen = ++this._dailyGen;
      R.claim().then((res) => {
        if (gen !== this._dailyGen) return;
        if (!res.ok) {
          // 'today' means the server already has it — a true, ordinary answer,
          // and telling the player "no connection" for it was simply wrong.
          if (res.reason === 'today') {
            this._paintDaily({ ok: true, claimed: true, streak: res.streak, next: res.next });
            this.toast(T('dailyAlready'));
            return;
          }
          this._paintDaily(res);
          this.toast(T(res.reason === 'signin' ? 'dailySignin' : 'dailyOffline'));
          return;
        }
        this.toast(T('dailyGot', { n: res.shards, d: res.streak }));
        this._paintDaily({ ok: true, claimed: true, streak: res.streak, next: res.next });
        this.refreshMenu();
        this.renderShop && this.renderShop();
      });
    },

    // ---- save transfer -----------------------------------------------------
    // There is no account here, so moving between the web build, Steam and a
    // phone means moving the save yourself. The code is shown on screen as well
    // as copied, because clipboard access fails silently in plenty of places.
    exportSave() {
      if (!LUMEN.Save) return;
      const code = LUMEN.Save.export();
      const box = $('save-code');
      box.value = code;
      box.classList.remove('hidden');
      box.focus(); box.select();
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).catch(() => {});
          copied = true;
        } else if (document.execCommand) {
          copied = document.execCommand('copy');
        }
      } catch (e) { /* the on-screen box is the fallback */ }
      this.toast(T(copied ? 'saveCopied' : 'saveShown'));
    },

    importSave() {
      if (!LUMEN.Save) return;
      const code = window.prompt(T('savePastePrompt'), '');
      if (code == null || !code.trim()) return;
      const info = LUMEN.Save.describe(code);
      if (!info) { this.toast(T('saveBadCode')); return; }
      // Say exactly what is about to replace what. Restoring the wrong save is
      // the one mistake here that actually costs someone something.
      const msg = T('saveConfirm', {
        best: info.best, shards: info.shards, runs: info.runs,
        curBest: Store.best, curShards: Store.shards, curRuns: Store.runs,
      });
      if (!window.confirm(msg)) return;
      const res = LUMEN.Save.apply(code);
      if (!res.ok) { this.toast(T('saveBadCode')); return; }
      this._lastSaveBackup = res.backup;
      this.renderSettings();
      this.refreshMenu();
      this.toast(T('saveRestored'));
    },

    resetProgress() {
      if (!window.confirm(T('resetConfirm'))) return;
      // Preserve every SETTING verbatim — see LUMEN.SETTING_KEYS, which lives
      // next to the getters that define them. Copying the raw strings rather
      // than round-tripping through typed getters means a value this build does
      // not know about still survives, and nothing is coerced on the way back.
      const keep = {};
      try {
        for (const k of (LUMEN.SETTING_KEYS || [])) {
          const v = localStorage.getItem(k);
          if (v != null) keep[k] = v;
        }
      } catch (e) {}
      try {
        for (const k of Object.keys(localStorage)) if (k.indexOf('lumen_') === 0) localStorage.removeItem(k);
        for (const k of Object.keys(keep)) localStorage.setItem(k, keep[k]);
      } catch (e) {}
      Store._invalidate(); // storage was cleared behind the memo cache
      // storage is right; now make the live audio gain agree with it
      if (Audio) Audio.setMuted(Store.muted);
      if (C) C.invalidate();
      if (M) M.ensure();
      this.toast(T('progressReset'));
      this.renderSettings();
      this.refreshMenu();
    },

    shopAction(act, id) {
      if (act === 'equip') {
        C.equip(id); Audio && Audio.sfx('ui');
      } else if (act === 'setequip') {
        // Owning a set and wearing it are two different things. A completed set
        // used to end at a disabled SET COMPLETE badge, so the only way back
        // into a look you already owned was to find its four pieces across four
        // different lists -- and the map is not even in this tab.
        const st = C.setDef(id);
        if (st) for (const it of st.items) C.equip(it);
        Audio && Audio.sfx('best');
        this.toast(T('setEquipped'));
      } else if (act === 'buy') {
        if (C.buy(id)) { C.equip(id); Audio && Audio.sfx('best'); this.toast(T('unlocked')); }
        else { Audio && Audio.sfx('flowEnd'); this.toast(T('notEnough')); return; }
      } else if (act === 'setbuy') {
        // Everything in the set, at the price of what was still missing.
        if (C.buySet(id)) {
          const s = C.setDef(id);
          // equip the whole look, or buying it would change nothing on screen
          if (s) for (const it of s.items) C.equip(it);
          Audio && Audio.sfx('best');
          this.toast(T('setUnlocked'));
        } else { Audio && Audio.sfx('flowEnd'); this.toast(T('notEnough')); return; }
      } else if (act === 'cash' || act === 'setcash') {
        // real money: the provider owns the flow, we only react to the outcome
        if (!LUMEN.IAP || !LUMEN.IAP.available) { this.toast(T('storeUnavailable')); return; }
        this.toast(T('purchasing'));
        LUMEN.IAP.purchase(id).then((res) => {
          if (res.ok) {
            if (act === 'setcash') {
              C.grantSet(id);
              const s = C.setDef(id);
              if (s) for (const it of s.items) C.equip(it);
              this.toast(T('setUnlocked'));
            } else { C.equip(id); this.toast(T('unlocked')); }
            Audio && Audio.sfx('best');
          } else if (res.reason === 'cancelled') this.toast(T('purchaseCancelled'));
          else this.toast(T('storeUnavailable'));
          this.renderShop();
        });
        return;
      }
      this.renderShop();
    },

    // ---- game over -------------------------------------------------------
    // One line about the run you actually just played. Ordered most specific
    // first — the point is that it notices something, so a generic line only
    // appears when genuinely nothing stood out. Nothing here is a taunt: the
    // game is hard enough without the results screen piling on.
    runQuip(d) {
      const s = d.seconds || 0;
      if (d.voided) return 'quip_void';
      if (!d.ranked) return 'quip_zen';
      // "you doubled it" needs something to have doubled — a first record hasn't
      if (d.isBest) return (d.prevBest > 0 && d.score > d.prevBest * 2) ? 'quip_bestBig' : 'quip_best';
      // agonisingly close to your own record
      if (d.prevBest > 0 && d.score >= d.prevBest * 0.95) return 'quip_soClose';
      if (s < 4) return 'quip_instant';
      if ((d.comboAtDeath || 0) >= 25) return 'quip_bigChainLost';
      if ((d.flowSec || 0) > 0 && s < 20) return 'quip_flowThenGone';
      if ((d.nearMiss || 0) >= 8) return 'quip_daredevil';
      if (s > 45 && (d.motes || 0) < 12) return 'quip_tooSafe';
      if ((d.motes || 0) === 0) return 'quip_noMotes';
      if (d.revived) return 'quip_revived';
      if ((d.flowSec || 0) >= 6) return 'quip_goodFlow';
      if (s > 60) return 'quip_endured';
      return 'quip_plain';
    },


    showGameOver(data) {
      if (!this._ready) return;
      $('final-score').textContent = data.score;
      $('final-best').textContent = data.best;
      $('final-combo').textContent = data.combo;
      $('final-best-label').textContent = data.daily ? T('dailyBest') : T('best');
      $('over-title').textContent = data.daily ? (data.isBest ? T('dailyRecord') : T('dailyRun')) : (data.isBest ? T('newRecord') : T('runOver'));
      $('best-badge').classList.toggle('hidden', !data.isBest);
      // show the leaderboard placing only when it isn't already the headline "NEW BEST"
      const showRank = !data.isBest && data.rank > 0;
      $('rank-badge').classList.toggle('hidden', !showRank);
      if (showRank) $('rank-badge').textContent = '#' + data.rank + ' ' + T('bestRun');
      $('ge-shards').textContent = data.shards;
      $('ge-total').textContent = '(◆' + data.totalShards + ' total)';
      const quip = $('over-quip');
      if (quip) {
        const key = this.runQuip(data);
        quip.textContent = key ? T(key) : '';
        quip.classList.toggle('hidden', !key);
      }

      const gm = $('ge-missions');
      gm.innerHTML = '';
      // THE CHASE leads, above the streak: it is the thing the run was about.
      // Built with textContent, NOT innerHTML — this row carries another
      // player's name and that is the whole reason it is constructed
      // differently from the achievement rows below it. No esc() is needed and
      // no markup can survive. Hidden entirely on a zero score: a run that
      // ended at nothing does not need a reminder of how far away the target was.
      if (data.daily && data.chase && data.score > 0) {
        const c = data.chase;
        const board = c.kind === 'board';
        // Separate strings per case rather than feeding "YOUR PACE" in as the
        // rival's name. Merging them saves two keys and produces "CAUGHT YOUR
        // PACE" in English and "KENDİ TEMPON yakalandı" in Turkish — a sentence
        // built out of a label, which reads wrong in all four languages.
        const el = document.createElement('div');
        el.className = 'ge-mission';
        el.textContent = c.passed
          ? '⚡ ' + (board ? T('chaseCaught', { n: c.name }) : T('chaseCaughtPace'))
          : '▲ ' + (board ? T('chaseShort', { d: c.gap.toLocaleString(), n: c.name })
                          : T('chaseShortPace', { d: c.gap.toLocaleString() }));
        gm.appendChild(el);
      }
      if (data.daily && data.dailyStreak > 0) {
        const st = document.createElement('div');
        st.className = 'ge-mission'; st.innerHTML = '🔥 ' + data.dailyStreak + ' ' + T('dayStreak');
        gm.appendChild(st);
      }
      (data.achievements || []).forEach((a) => {
        const el = document.createElement('div');
        el.className = 'ge-mission';
        el.innerHTML = '★ ' + T('ach_' + a.id) + ' <span class="r">+◆' + a.reward + '</span>';
        gm.appendChild(el);
        // check() has always reported which cosmetic an achievement handed over,
        // and nothing read it — so nine skins and trails were granted in silence
        // and the player had to stumble on them in the shop to learn they owned
        // something. The unlock is the bigger prize; say so on its own line.
        if (a.unlocks && LUMEN.Cosmetics) {
          const u = document.createElement('div');
          u.className = 'ge-mission ge-unlock';
          u.innerHTML = '✦ ' + T('unlocked') + ' <span class="r">'
            + LUMEN.Cosmetics.name(a.unlocks) + '</span>';
          gm.appendChild(u);
        }
      });
      (data.missionsDone || []).forEach((m) => {
        const el = document.createElement('div');
        el.className = 'ge-mission';
        el.innerHTML = '✔ ' + m.text + ' <span class="r">+◆' + m.reward + '</span>';
        gm.appendChild(el);
      });

      // a visible reason to press RETRY: the cheapest thing still locked
      const nx = C && C.nextUnlock ? C.nextUnlock() : null;
      const nel = $('ge-next');
      if (nel) {
        nel.classList.toggle('hidden', !nx);
        if (nx) {
          nel.innerHTML = '<span class="nu-label">' + T('nextUnlock') + '</span>' +
            '<b>' + C.name(nx.id) + '</b>' +
            '<span class="nu-cost">◆' + nx.missing + ' ' + T('shardsShort') + '</span>';
        }
      }

      this._lastScore = data.score;
      this._lastCombo = data.combo;
      this._lastIsBest = data.isBest;
      // Remembered so the share card can say WHICH run this was. The Daily is
      // the one thing in LUMEN that is the same for everybody on a given day —
      // which is exactly what makes it shareable — and the card was throwing
      // that away: `data.daily` was read two lines below for the rating prompt
      // and then dropped on the floor.
      //
      // The DAY AND THE TWIST are captured here, at the end of the run, not
      // when the share button is pressed. The game already keeps the run's own
      // date for the same reason (game.dailyDate, set at run start, because a
      // run begun at 23:59:30 belongs to the day it was played) — and a player
      // who dies at 23:58 and shares at 00:02 would otherwise post a card
      // stamped with tomorrow's date and tomorrow's twist, advertising a course
      // they never played.
      this._lastDaily = !!data.daily;
      this._lastDailyDate = this._lastDaily
        ? ((this.game && this.game.dailyDate) || (D ? D.todayStr() : '')) : '';
      this._lastDailyTwist = this._lastDaily && D ? (D.twistName() || '') : '';
      this._lastDailyStreak = this._lastDaily && D ? (D.status().streak || 0) : 0;
      this.showScreen('gameover');

      // Ask for a rating on a GOOD run only, and never on the frame that just
      // killed you. A personal best, a finished daily, or a run long enough to
      // have been enjoyed — those are the moments where "are you enjoying
      // this" has an honest answer. Rating.consider() decides the rest: it
      // will not ask before the eighth run, will not ask twice in sixty, and
      // shows Apple's own sheet rather than anything we drew. See js/rating.js
      // for why there are no stars of our own here.
      const wentWell = !!(data.isBest || data.daily || (data.time || 0) >= 45);
      if (LUMEN.Rating) {
        setTimeout(() => LUMEN.Rating.consider(wentWell), 900);
      }
    },

    fullscreenSupported() {
      const d = document.documentElement;
      return !!(d.requestFullscreen || d.webkitRequestFullscreen);
    },
    isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); },
    toggleFullscreen() {
      const d = document.documentElement;
      // requestFullscreen REJECTS (a promise) rather than throwing, so a bare
      // try/catch would leave an uncaught rejection in the console.
      try {
        if (this.isFullscreen()) {
          const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen();
          if (p && p.catch) p.catch(() => {});
        } else {
          const p = d.requestFullscreen ? d.requestFullscreen() : d.webkitRequestFullscreen && d.webkitRequestFullscreen();
          if (p && p.catch) p.catch(() => {});
        }
      } catch (e) { /* unsupported — the button is hidden anyway */ }
    },

    toggleMute() {
      if (!Audio) return;
      Audio.init();
      const muted = Audio.toggleMuted();
      $('btn-mute').classList.toggle('muted', muted);
      if (!muted) { Audio.unlock(); Audio.sfx('ui'); }
    },

    // The link a card carries. For a Daily it gets `?mode=daily`, which the deep
    // link in js/main.js turns into the same seeded course the sharer just
    // played — the difference between "look what I scored" and "here, try it".
    // Appended only when the configured URL has no query of its own, so pointing
    // shareUrl at a store page cannot produce a malformed link.
    shareLink(daily) {
      const base = (LUMEN.CONFIG && LUMEN.CONFIG.shareUrl) || '';
      if (!base) return '';
      if (!daily) return base;
      return base.indexOf('?') >= 0 ? base : base + '?mode=daily';
    },

    share() {
      this.click();
      const s = this._lastScore || 0;
      const c = this._lastCombo || 0;
      const daily = !!this._lastDaily;
      const url = this.shareLink(daily);
      // twistName() is already localised and already returns '' on a day whose
      // draw is classic + none, so an untwisted day draws no twist line rather
      // than an empty one.
      const data = {
        score: s, combo: c, isBest: !!this._lastIsBest,
        daily: daily,
        dailyDate: this._lastDailyDate || '',
        dailyTwist: this._lastDailyTwist || '',
        dailyStreak: this._lastDailyStreak || 0,
        url: url,
      };
      // The daily line ends in "Beat me: {u}". With no shareUrl configured that
      // is a sentence with nothing after the colon, so fall back to the ordinary
      // text rather than posting a dangling invitation.
      const text = daily && url
        ? T('shareTextDaily', { s: s, c: c, d: data.dailyDate, u: url })
        : T('shareText', { s: s, c: c });
      // A generated image travels far better than a line of text.
      if (LUMEN.Share) {
        LUMEN.Share.share(this.game, data, text).then((how) => {
          if (how === 'clipboard') this.toast(T('copied'));
          else if (how === 'none') LUMEN.Share.download(this.game, data);
        });
        return;
      }
      const done = () => this.toast(T('copied'));
      if (navigator.share) navigator.share({ title: 'LUMEN', text }).catch(() => this._copy(text, done));
      else this._copy(text, done);
    },
    _copy(text, done) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => this.toast('Share: ' + text));
      } else this.toast('Copy your score: ' + text);
    },

    _toastTimer: null,
    toast(msg) {
      const t = $('toast');
      t.textContent = msg;
      t.classList.remove('hidden');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
    },
  };

  UI._onTap = onTap; // test seam: input semantics are worth locking down
  LUMEN.UI = UI;
})();
