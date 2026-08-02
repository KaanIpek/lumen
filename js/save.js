/*
 * LUMEN — save transfer
 * -------------------------------------------------------------
 * Everything a player owns lives in this device's localStorage. That is fine
 * for one browser and useless the moment the same person also plays the Steam
 * build, or replaces a phone. There is no account system here on purpose — no
 * sign-up, no email, nothing to leak — so the honest alternative is to let the
 * save leave the device under the player's own control.
 *
 * `export()` produces one line of text. `apply()` takes it back, anywhere.
 * It is not encrypted and not signed: a determined player can hand-edit their
 * own shard count, and that is their business. What it MUST not do is corrupt a
 * good save with a bad paste, so `apply()` validates the whole payload before
 * writing a single key, and always offers a rollback of what was there before.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  const MAGIC = 'LUMEN1';
  const PREFIX = 'lumen';

  // A tiny checksum. Not security — it just means a truncated or mistyped code
  // is rejected loudly instead of half-applying and eating someone's progress.
  function sum(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  const b64encode = (s) => btoa(unescape(encodeURIComponent(s)));
  const b64decode = (s) => decodeURIComponent(escape(atob(s)));

  const Save = {
    MAGIC,

    // Everything under the lumen* namespace, exactly as stored.
    snapshot() {
      const out = {};
      for (const k of Object.keys(localStorage)) {
        if (k.indexOf(PREFIX) === 0) out[k] = localStorage.getItem(k);
      }
      return out;
    },

    export() {
      const body = b64encode(JSON.stringify(this.snapshot()));
      return MAGIC + '.' + sum(body) + '.' + body;
    },

    // Parse and validate WITHOUT touching storage. Returns {ok, data|reason}.
    parse(code) {
      const raw = String(code || '').trim().replace(/\s+/g, '');
      const parts = raw.split('.');
      if (parts.length !== 3 || parts[0] !== MAGIC) return { ok: false, reason: 'format' };
      if (sum(parts[2]) !== parts[1]) return { ok: false, reason: 'checksum' };
      let data;
      try { data = JSON.parse(b64decode(parts[2])); } catch (e) { return { ok: false, reason: 'corrupt' }; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'corrupt' };
      for (const k of Object.keys(data)) {
        // never let a payload write outside our own namespace
        if (k.indexOf(PREFIX) !== 0) return { ok: false, reason: 'foreign' };
        if (typeof data[k] !== 'string') return { ok: false, reason: 'corrupt' };
      }
      return { ok: true, data, keys: Object.keys(data).length };
    },

    // Replace this device's save. The previous one is returned so the caller can
    // put it back — pasting the wrong code should never be unrecoverable.
    apply(code) {
      const parsed = this.parse(code);
      if (!parsed.ok) return parsed;
      const backup = this.snapshot();
      try {
        for (const k of Object.keys(backup)) localStorage.removeItem(k);
        for (const k of Object.keys(parsed.data)) localStorage.setItem(k, parsed.data[k]);
      } catch (e) {
        this.restore(backup);
        return { ok: false, reason: 'write' };
      }
      this._refresh();
      return { ok: true, keys: parsed.keys, backup };
    },

    restore(backup) {
      for (const k of Object.keys(localStorage)) {
        if (k.indexOf(PREFIX) === 0) localStorage.removeItem(k);
      }
      for (const k of Object.keys(backup || {})) localStorage.setItem(k, backup[k]);
      this._refresh();
    },

    _refresh() {
      LUMEN.Store && LUMEN.Store._invalidate && LUMEN.Store._invalidate();
      LUMEN.Cosmetics && LUMEN.Cosmetics.invalidate && LUMEN.Cosmetics.invalidate();
      LUMEN.UI && LUMEN.UI.refreshMenu && LUMEN.UI.refreshMenu();
    },

    // A short human summary, so a player can sanity-check a code before applying
    // it — "this one has 12 runs and 300 shards, that's my old phone".
    describe(code) {
      const parsed = this.parse(code);
      if (!parsed.ok) return null;
      const num = (k) => parseInt(parsed.data['lumen_' + k] || '0', 10) || 0;
      let unlocks = 0;
      try { unlocks = (JSON.parse(parsed.data.lumen_unlocks || '[]') || []).length; } catch (e) {}
      return { best: num('best'), shards: num('shards'), runs: num('runs'), unlocks };
    },
  };

  LUMEN.Save = Save;
})();
