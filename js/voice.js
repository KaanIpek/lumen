/*
 * LUMEN — voice control
 * -------------------------------------------------------------
 * Say the item — "shield", "magnet", "slow" — to fire one you are
 * holding, in any of the four supported languages. Just the noun: there
 * is no verb to remember, and the matcher is substring-based so a
 * stray "the" or "now" around it changes nothing.
 *
 * Built on the Web Speech API, which is only in some browsers and
 * always needs the microphone. So: strictly opt-in, off by default,
 * and it never blocks or changes anything if it isn't available.
 * Recognition only runs while a run is actually in progress.
 *
 * Nothing is recorded or transmitted by the game — the browser does
 * the recognition and hands back text, which we match against a
 * short keyword list and then discard.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  // The NAME of each item, in every language. Nothing else.
  //
  // There used to be loose synonyms here — 'guard', 'pull', 'time', 'tiempo' —
  // from when the advertised phrasing was "use shield". They bought nothing
  // once the instruction became "say the item", and they cost real things:
  // "what time is it", "pull yourself together" and "guard the gap" each fired
  // a command and SPENT A CONSUMABLE the player had paid shards for. A voice
  // feature that occasionally robs you is worse than one that occasionally
  // mishears you.
  //
  // Spelling variants stay (a Turkish keyboard-less transcript gives 'yavas',
  // Chinese recognition may return the short form), because those are the same
  // word, not a different one.
  const PHRASES = {
    // All six of ITEM_TYPES, not the first three. Scout, anchor and spark were
    // buyable and holdable but had no word, so the only way to fire them was the
    // on-screen button — and spark is the most expensive item in the shop.
    en: { shield: ['shield'],     magnet: ['magnet'],               slow: ['slow'],
          scout:  ['scout'],      anchor: ['anchor'],               spark: ['spark', 'chain'] },
    tr: { shield: ['kalkan'],     magnet: ['mıknatıs', 'miknatis'], slow: ['yavaş', 'yavas'],
          scout:  ['izci'],       anchor: ['çapa', 'capa'],         spark: ['kıvılcım', 'kivilcim', 'zincir'] },
    es: { shield: ['escudo'],     magnet: ['imán', 'iman'],         slow: ['lento'],
          scout:  ['explorador'], anchor: ['ancla'],                spark: ['chispa', 'cadena'] },
    zh: { shield: ['护盾', '盾'],  magnet: ['磁铁', '磁'],            slow: ['减速', '慢'],
          scout:  ['侦察', '侦'],  anchor: ['锚'],                    spark: ['火花', '连击'] },
  };

  // A command is a word, not a sentence. Recognition hands us whole utterances,
  // so without this "I need to slow down my breathing" still spends your slow.
  // Anything longer than a short phrase was the player talking, not commanding.
  const MAX_WORDS = 4;
  const MAX_CJK_CHARS = 6;

  const Voice = {
    PHRASES,   // exposed so the suite can prove every ITEM_TYPE has a word

    // ---- which recogniser is behind this ----------------------------------
    // Two of them, answering the same questions.
    //
    // The Web Speech API is the browser one. Android's WebView DOES NOT HAVE IT
    // — not disabled, not permission-gated, simply absent — so on the phone
    // `supported` was false, sync() returned on its first line, the microphone
    // was never requested, and switching the setting on did nothing at all with
    // nothing to say why. lumen-voice is the native recogniser that fills that
    // hole, and it is preferred wherever it exists because it is the only one
    // that works there.
    get webSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    get native() {
      const C = window.Capacitor;
      // `Capacitor.Plugins.X`, never registerPlugin — this project has no
      // bundler, so the only Capacitor on `window` is the bridge the shell
      // injects, and that one has no registerPlugin. (See js/iap.js, where
      // getting this wrong hid the entire cash store for four builds.)
      return (C && C.Plugins && C.Plugins.LumenVoice) || null;
    },
    // Set by probe() once the native side has answered. Undefined means "not
    // asked yet", which is deliberately different from false.
    _nativeOk: undefined,
    _micGranted: false,
    get supported() {
      if (this.native) return this._nativeOk !== false;
      return this.webSupported;
    },
    listening: false,
    _rec: null,
    _wantOn: false,
    _denied: false,
    // Chrome cannot remember a permission for a file:// page — the origin is
    // opaque, so every fresh request prompts again no matter what the player
    // clicked last time. Worth saying out loud rather than looking broken.
    get ephemeralPermission() { return location.protocol === 'file:'; },

    langTag() {
      const l = LUMEN.i18n ? LUMEN.i18n.lang : 'en';
      return { en: 'en-US', tr: 'tr-TR', es: 'es-ES', zh: 'zh-CN' }[l] || 'en-US';
    },

    // Match a transcript against every language's keywords — a player may well
    // speak English commands with the UI in another language.
    match(text) {
      const t = (text || '').toLowerCase().trim();
      if (!t) return null;
      // Length gate first, so a sentence never reaches the keywords at all.
      // Chinese is written without spaces, so it is counted in characters.
      const words = t.split(/\s+/).filter(Boolean);
      const cjk = (t.match(/[㐀-鿿]/g) || []).length;
      if (cjk > 0 ? t.replace(/\s+/g, '').length > MAX_CJK_CHARS : words.length > MAX_WORDS) return null;
      for (const lang in PHRASES) {
        const set = PHRASES[lang];
        for (const type in set) {
          for (const word of set[type]) {
            if (t.indexOf(word) >= 0) return type;
          }
        }
      }
      return null;
    },

    // One transcript, whichever recogniser produced it.
    //
    // Both backends hand back the same thing — a string somebody said — so the
    // matching, the debounce, the "your hand is empty" reply and the analytics
    // all live here once. Splitting them was how the native path would have
    // ended up with subtly different rules from the web one.
    _heard(text) {
      // Listening continues across pauses and menus so the permission prompt
      // only ever appears once — which is exactly why a command has to be
      // ignored unless a run is actually live.
      const g = LUMEN.game;
      if (!g || g.state !== 'play') return;
      const type = this.match(text);
      if (!type) return;
      // debounce: one command per word burst. Partial results repeat the same
      // words several times a second, so without this a single "shield" spends
      // every shield the player owns.
      const now = Date.now();
      if (this._lastType === type && now - (this._lastAt || 0) < 900) return;
      this._lastType = type; this._lastAt = now;
      const name = LUMEN.t ? LUMEN.t('pw_' + type) : type;
      if (g.useItem(type)) {
        LUMEN.UI && LUMEN.UI.toast && LUMEN.UI.toast('🎤 ' + name);
        LUMEN.Analytics && LUMEN.Analytics.track('voice_use', { type });
      } else {
        // Heard you, but your hand is empty. Saying so beats doing nothing —
        // silence is indistinguishable from "voice control is broken".
        LUMEN.UI && LUMEN.UI.toast && LUMEN.UI.toast('🎤 ' + (LUMEN.t ? LUMEN.t('voiceNoItem', { item: name }) : 'none held'));
      }
    },

    // ---- the native recogniser --------------------------------------------

    // Ask the phone once, at startup, whether it can recognise speech at all and
    // whether we already hold the microphone. A device with no recognition
    // service is a different thing from a player who has not been asked, and the
    // settings screen shows a different row for each.
    probe() {
      const p = this.native;
      if (!p || this._probed) return Promise.resolve();
      this._probed = true;
      this._wire();
      return p.available()
        .then((r) => {
          this._nativeOk = !!(r && r.available);
          this._micGranted = !!(r && r.granted);
        })
        .catch(() => { this._nativeOk = false; });
    },

    _wire() {
      const p = this.native;
      if (!p || this._wired || !p.addListener) return;
      this._wired = true;
      p.addListener('transcript', (ev) => { if (ev && ev.text) this._heard(ev.text); });
      p.addListener('denied', () => {
        this._denied = true;
        this._wantOn = false;
        this.listening = false;
        if (LUMEN.Store) LUMEN.Store.voiceControl = false;
        LUMEN.UI && LUMEN.UI.toast && LUMEN.UI.toast(LUMEN.t ? LUMEN.t('micDenied') : 'Microphone blocked');
        LUMEN.UI && LUMEN.UI.renderSettings && LUMEN.UI.renderSettings();
      });
    },

    // Raise the OS permission dialog. The game shows its own explanation first
    // and only gets here once the player has said yes to that, because a system
    // prompt with no stated reason is the one people refuse — and on Android a
    // refusal twice is permanent.
    requestMic() {
      const p = this.native;
      if (!p) return Promise.resolve(true);          // the web path prompts on its own
      return p.requestMic()
        .then((r) => { this._micGranted = !!(r && r.granted); return this._micGranted; })
        .catch(() => false);
    },

    _startNative() {
      const p = this.native;
      if (!p || this.listening || this._denied || !this._micGranted) return false;
      this.listening = true;
      p.start({ lang: this.langTag() }).catch(() => { this.listening = false; });
      return true;
    },
    _stopNative() {
      const p = this.native;
      this.listening = false;
      if (p) p.stop().catch(() => {});
    },

    // One recognition object for the whole page, built once and reused. Building
    // a new one is what triggers a fresh permission prompt, so a player who
    // paused and resumed used to be asked again on every single resume.
    _build() {
      if (this._rec) { this._rec.lang = this.langTag(); return this._rec; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      let rec;
      try { rec = new SR(); } catch (e) { return null; }
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = this.langTag();
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const alt = e.results[i][0];
          if (alt) this._heard(alt.transcript);
        }
      };
      rec.onerror = (ev) => {
        // 'not-allowed' means the player declined the mic — turn the feature back
        // off rather than silently retrying forever.
        if (ev && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed')) {
          // Declined. Remember it, switch the feature off, and never ask again
          // on our own — the player re-enables it if they change their mind.
          this._denied = true;
          this._wantOn = false;
          if (LUMEN.Store) LUMEN.Store.voiceControl = false;
          LUMEN.UI && LUMEN.UI.toast && LUMEN.UI.toast(LUMEN.t ? LUMEN.t('micDenied') : 'Microphone blocked');
          LUMEN.UI && LUMEN.UI.renderSettings && LUMEN.UI.renderSettings();
        }
      };
      rec.onend = () => {
        this.listening = false;
        // The API ends its session every few seconds and has to be restarted.
        // Each restart is a fresh capture request, so a run of them that all fail
        // is exactly what a permission wall looks like — cap it rather than
        // hammering the browser (and the player) forever.
        if (!this._wantOn || this._denied) return;
        this._restarts = (this._restarts || 0) + 1;
        if (this._restarts > 40) { this._wantOn = false; this.release(); return; }
        setTimeout(() => { if (this._wantOn) this.start(); }, 250);
      };
      this._rec = rec;
      return rec;
    },

    // Hold one real microphone stream open for as long as voice control is on.
    //
    // This is what finally stops the repeat prompts. SpeechRecognition ends its
    // session every few seconds on its own and has to be restarted, and each
    // restart is a fresh capture request — which on an origin the browser cannot
    // remember (a file:// page, most obviously) means a fresh permission bubble,
    // over and over. While a live MediaStream is already open the page counts as
    // actively capturing, so the restarts go through silently.
    //
    // We never read a single sample from this stream; it exists purely to keep
    // the grant alive, and it is released the moment the feature is switched off
    // or the tab goes away.
    async hold() {
      if (this._stream) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        this._denied = true;
        this._wantOn = false;
        if (LUMEN.Store) LUMEN.Store.voiceControl = false;
        LUMEN.UI && LUMEN.UI.toast && LUMEN.UI.toast(LUMEN.t ? LUMEN.t('micDenied') : 'Microphone blocked');
        LUMEN.UI && LUMEN.UI.renderSettings && LUMEN.UI.renderSettings();
      }
    },
    release() {
      if (!this._stream) return;
      try { this._stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      this._stream = null;
    },

    // Take the microphone FIRST, then start recognising.
    //
    // This used to fire `hold()` and `rec.start()` together, which meant the very
    // first activation raised two separate permission requests — the getUserMedia
    // one and the speech one — because neither had finished when the other began.
    // Waiting for the stream means there is exactly one prompt, ever, and every
    // later restart happens under a capture session that is already live.
    start() {
      if (!this.supported || this.listening || this._denied) return false;
      if (this.native) return this._startNative();
      if (this._starting) return false;                 // one request in flight at a time
      this._starting = true;
      const go = () => {
        this._starting = false;
        if (this._denied || !this._wantOn) return false;
        const rec = this._build();
        if (!rec) return false;
        try { rec.start(); } catch (e) { return this.listening; }
        this.listening = true;
        return true;
      };
      if (this._stream) return go();
      this.hold().then(go, go);
      return true;
    },

    // Stop listening but KEEP the microphone grant alive. Used when the tab goes
    // to the background: alt-tabbing away and back must not cost another
    // permission bubble, which is exactly what releasing the stream would do.
    idle() {
      this._wantOn = false;
      if (this.native) { this._stopNative(); return; }
      if (this._rec) { try { this._rec.stop(); } catch (e) {} }
      this.listening = false;
    },

    // The full teardown — only when the player actually turns the feature off.
    stop() {
      this.idle();
      this.release();
    },

    // Called when the setting changes, when a run starts, and on tab visibility.
    //
    // Deliberately NOT tied to `state === 'play'`. Tearing recognition down at
    // every pause and building it back up on resume is what made the browser ask
    // for the microphone over and over. Now it comes up once, when the feature is
    // switched on, and stays up for the page — `onresult` is what checks whether a
    // run is actually live. The only things that stop it are turning the setting
    // off, hiding the tab, or a refusal.
    sync() {
      if (!this.supported) return;
      const on = !!(LUMEN.Store && LUMEN.Store.voiceControl) && !this._denied;
      const visible = document.visibilityState !== 'hidden';
      if (on && visible) { this._wantOn = true; if (!this.listening) this.start(); }
      else if (!on) this.stop();                       // switched off: hand the mic back
      else if (this.listening || this._wantOn) this.idle();  // just hidden: stay granted
    },
  };

  // Stop listening while the tab is in the background and pick it back up on
  // return — without rebuilding the recogniser or dropping the grant, so coming
  // back never costs a second prompt.
  document.addEventListener('visibilitychange', () => Voice.sync());
  // Do hand the microphone back when the page actually goes away.
  window.addEventListener('pagehide', () => Voice.release());

  LUMEN.Voice = Voice;

  // Ask the native side what it can do, once, after the bridge has had a tick to
  // appear — the shell injects Capacitor onto `window` slightly after our
  // synchronous script tags run, and reading it during parse is the race that
  // hid the cash store for four builds. Then re-sync, because a player who had
  // the setting on last time should be listening again without touching it.
  if (typeof setTimeout === 'function') {
    setTimeout(() => {
      if (!Voice.native) return;
      Voice.probe().then(() => {
        Voice.sync();
        LUMEN.UI && LUMEN.UI.renderSettings && LUMEN.UI.renderSettings();
      });
    }, 0);
  }
})();
