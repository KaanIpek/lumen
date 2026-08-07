/*
 * LUMEN — Sign in with Apple, over Supabase Auth
 * -------------------------------------------------------------
 * There are no passwords in this file and there never will be. Apple does the
 * identity check and hands back a signed token; Supabase verifies that token
 * and hands back a session. Nothing here ever sees a credential, which is the
 * whole reason this method was chosen over an email-and-password form.
 *
 * WHY AN ACCOUNT AT ALL
 *   Not for purchases — the App Store already ties those to the buyer's own
 *   Apple ID, which is what RESTORE PURCHASES uses, and it works on a new phone
 *   without anyone signing into anything here.
 *
 *   It is for the board. Without an identity a name is just a string anyone can
 *   type, so one player can hold five rows under five names and nobody can
 *   reclaim a name that is theirs. A verified user id makes one person one row,
 *   and it lets progress follow you to a second device.
 *
 * WHAT LEAVES THE DEVICE
 *   A Supabase user id, and the display name the player typed. Apple's private
 *   relay means we never even receive a real address unless the player chooses
 *   to share one, and this app does not ask for it: the scope is empty.
 *
 * SHAPE
 *   No SDK. Supabase Auth is a REST API and this project has no build step, so
 *   it is fetch() and a token in localStorage, the same as everything else here.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  const KEY = 'lumen_session';

  const Auth = {
    // Filled from LUMEN.CONFIG at boot; without it the whole feature is absent
    // rather than broken, exactly like the leaderboard.
    url: null,
    key: null,

    session: null,

    init() {
      const c = LUMEN.CONFIG || {};
      if (!c.supabaseUrl || !c.supabaseAnonKey) return false;
      this.url = String(c.supabaseUrl).replace(/\/$/, '');
      this.key = String(c.supabaseAnonKey);
      this.session = this._load();
      // A stored session is usually expired by the time the app is opened
      // again; refreshing on boot means the rest of the game can just read
      // `Auth.user` without every caller handling a 401.
      if (this.session) this.refresh().catch(() => this.signOut());
      return true;
    },

    get enabled() { return !!this.url && !!this.key; },
    get user() { return (this.session && this.session.user) || null; },
    get userId() { return (this.user && this.user.id) || ''; },
    get token() { return (this.session && this.session.access_token) || ''; },
    get signedIn() { return !!this.token; },

    _load() {
      try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
      catch (e) { return null; }
    },
    _save(s) {
      this.session = s || null;
      try {
        if (s) localStorage.setItem(KEY, JSON.stringify(s));
        else localStorage.removeItem(KEY);
      } catch (e) { /* private mode; the session simply does not survive a reload */ }
      if (LUMEN.UI && LUMEN.UI.onAuthChange) LUMEN.UI.onAuthChange();
    },

    _post(path, body, extraHeaders) {
      return fetch(this.url + path, {
        method: 'POST',
        headers: Object.assign({
          apikey: this.key,
          'Content-Type': 'application/json',
        }, extraHeaders || {}),
        body: JSON.stringify(body || {}),
      }).then((r) => r.json().then((j) => {
        if (!r.ok) throw new Error((j && (j.error_description || j.msg || j.error)) || ('http ' + r.status));
        return j;
      }));
    },

    // ---- the actual sign-in ------------------------------------------------
    // Apple gives an identity token; Supabase verifies its signature against
    // Apple's public keys and mints a session. The token is single-use and
    // short-lived, so there is nothing here worth stealing.
    signInWithAppleToken(idToken, nonce) {
      if (!this.enabled) return Promise.reject(new Error('auth not configured'));
      return this._post('/auth/v1/token?grant_type=id_token',
        { provider: 'apple', id_token: idToken, nonce: nonce || undefined })
        .then((s) => { this._save(s); return s; });
    },

    refresh() {
      const rt = this.session && this.session.refresh_token;
      if (!rt) return Promise.reject(new Error('no session'));
      return this._post('/auth/v1/token?grant_type=refresh_token', { refresh_token: rt })
        .then((s) => { this._save(s); return s; });
    },

    // ---- account deletion --------------------------------------------------
    // App Store Review Guideline 5.1.1(v): an app that lets you CREATE an
    // account must let you DELETE it from inside the app. Sign-out is not
    // deletion and does not satisfy it — the row keyed to your user id stays on
    // the board, and the auth user stays in the project.
    //
    // Two steps, and the order matters. The leaderboard row goes first, while
    // we still hold a token that RLS will accept as its owner; only then does
    // the account itself go. If the second step fails the player is at least
    // off the board, which is the part they can see.
    //
    // Deleting the auth user needs rights no client may hold, so it happens
    // inside a SECURITY DEFINER function in the database. The function takes the
    // identity from auth.uid() — the caller's own JWT — and never from an
    // argument, so nobody can delete anyone but themselves. Until it exists this
    // resolves { account: false } and the caller says so rather than claiming a
    // deletion that did not happen. See docs/LEADERBOARD.md.
    deleteAccount() {
      if (!this.enabled || !this.signedIn) return Promise.reject(new Error('not signed in'));
      const t = this.token;
      const auth = { apikey: this.key, Authorization: 'Bearer ' + t };

      const dropRow = LUMEN.Leaderboard && LUMEN.Leaderboard.deleteMine
        ? LUMEN.Leaderboard.deleteMine().catch(() => false)
        : Promise.resolve(false);

      return dropRow.then((rowGone) =>
        fetch(this.url + '/rest/v1/rpc/delete_own_account', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
          body: '{}',
        })
          .then((r) => r.ok)
          .catch(() => false)
          .then((accountGone) => {
            // Local state goes regardless. Whatever happened upstream, this
            // device is signed out and holds nothing of the account.
            this._save(null);
            return { row: !!rowGone, account: !!accountGone };
          }));
    },

    signOut() {
      const t = this.token;
      this._save(null);
      // Best effort: the local session is already gone either way, and a player
      // who taps SIGN OUT on a plane should still be signed out.
      if (t) {
        fetch(this.url + '/auth/v1/logout', {
          method: 'POST',
          headers: { apikey: this.key, Authorization: 'Bearer ' + t },
        }).catch(() => {});
      }
      return Promise.resolve();
    },

    // ---- getting a token out of Apple --------------------------------------
    // Two very different paths behind one call.
    //
    // In the app it MUST be the native sheet. Apple rejects a build that puts
    // its own sign-in flow in a web view, and the native sheet is the thing
    // players already trust: Face ID, one tap, no typing.
    //
    // On the web there is no native anything, so Apple's JS popup does it. That
    // script is fetched only when someone actually presses the button — an
    // account is optional here, and a player who never signs in should never pay
    // for a third-party script they did not use.
    signInWithApple() {
      if (!this.enabled) return Promise.reject(new Error('auth not configured'));
      // A nonce ties Apple's answer to THIS request, so a token captured
      // somewhere else cannot be replayed into our session. Apple hashes it, so
      // we send the raw one to Supabase and the digest to Apple.
      const raw = this._nonce();
      return this._sha256(raw).then((hashed) => this._appleToken(raw, hashed))
        .then((idToken) => this.signInWithAppleToken(idToken, raw));
    },

    _nonce() {
      const a = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(a);
      return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    },
    _sha256(s) {
      const c = window.crypto && window.crypto.subtle;
      if (!c) return Promise.resolve(s);          // ancient engine: Apple accepts the raw value
      return c.digest('SHA-256', new TextEncoder().encode(s))
        .then((buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''));
    },

    // Capacitor.Plugins.X only exists when the plugin's own JS has been imported,
    // and this project has no bundler to import it with — the package is
    // installed for its NATIVE half. So the proxy has to be asked for by name.
    //
    // Getting this wrong is not a quiet failure. `native` came back false, the
    // code fell through to the web path, and the app tried to open Apple's JS
    // popup inside its own WKWebView — the one thing Apple's sign-in explicitly
    // refuses to do. What the player saw was "Sign-in did not complete".
    get nativePlugin() {
      const C = window.Capacitor;
      if (!C || !(C.isNativePlatform && C.isNativePlatform())) return null;
      if (C.Plugins && C.Plugins.SignInWithApple) return C.Plugins.SignInWithApple;
      if (typeof C.registerPlugin === 'function') {
        try { return C.registerPlugin('SignInWithApple'); } catch (e) { return null; }
      }
      return null;
    },
    get native() {
      const C = window.Capacitor;
      return !!(C && C.isNativePlatform && C.isNativePlatform());
    },

    _appleToken(raw, hashed) {
      if (this.native) {
        const p = this.nativePlugin;
        // Inside the app there is no fallback worth having: Apple's web flow is
        // not allowed in an app's own web view, so pretending would only produce
        // a stranger failure further along.
        if (!p) return Promise.reject(new Error('the native sign-in plugin is missing from this build'));
        return p.authorize({
          // Empty on purpose. The game needs an identity, not an inbox, and a
          // permission you do not ask for is one you can never mishandle.
          scopes: '',
          nonce: hashed,
        }).then((r) => {
          const t = r && r.response && r.response.identityToken;
          if (!t) throw new Error('no identity token');
          return t;
        });
      }
      return this._appleJS().then(() => window.AppleID.auth.signIn({ nonce: hashed })
        .then((r) => {
          const t = r && r.authorization && r.authorization.id_token;
          if (!t) throw new Error('no identity token');
          return t;
        }));
    },

    _appleJS() {
      const c = LUMEN.CONFIG || {};
      if (!c.appleServiceId) return Promise.reject(new Error('web sign-in not configured'));
      if (window.AppleID) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
        s.onload = () => {
          window.AppleID.auth.init({
            clientId: c.appleServiceId,
            scope: '',
            redirectURI: c.appleRedirectUrl || window.location.origin,
            usePopup: true,
          });
          resolve();
        };
        s.onerror = () => reject(new Error('could not load Apple sign-in'));
        document.head.appendChild(s);
      });
    },

    // Headers for a Supabase REST call made AS this user, so row-level security
    // can attribute the row to auth.uid() instead of trusting a name field.
    authHeaders() {
      return this.token ? { Authorization: 'Bearer ' + this.token } : null;
    },
  };

  LUMEN.Auth = Auth;
})();
