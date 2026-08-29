/*
 * LUMEN — Core Game
 * -------------------------------------------------------------
 * A one-thumb neon arcade game. Tap / click / space to flip
 * gravity. Thread the gaps, chain motes into combos, and tip
 * into "flow state" for slow-mo bullet-time.
 *
 * Vanilla JS + Canvas 2D. No dependencies. No asset files.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Audio = LUMEN.Audio;

  // ---- math utils ----------------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const TAU = Math.PI * 2;
  const T = (k, v) => (LUMEN.t ? LUMEN.t(k, v) : k);
  const haptic = (pattern) => { try { if (LUMEN.Store && !LUMEN.Store.hapticsOn) return; if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {} };
  // small deterministic PRNG for the daily seeded run
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- graphics quality ----------------------------------------------------
  // Fill rate, not JavaScript, is what kills a canvas game at fullscreen: a 4K
  // canvas is ~14.7M pixels and every full-screen pass costs all of them. These
  // presets scale the expensive things (resolution, glow, particle count) and the
  // game auto-drops a tier if real frames come in late.
  const QUALITY = {
    high:     { name: 'High',     maxDpr: 2,    particles: 1,    dust: 1,    nebula: true,  glow: true,  trailLen: 30, blurUI: true },
    balanced: { name: 'Balanced', maxDpr: 1.5,  particles: 0.7,  dust: 0.7,  nebula: true,  glow: true,  trailLen: 24, blurUI: true },
    low:      { name: 'Low',      maxDpr: 1,    particles: 0.4,  dust: 0.4,  nebula: false, glow: false, trailLen: 15, blurUI: false },
  };
  LUMEN.QUALITY = QUALITY;
  LUMEN.Q = QUALITY.balanced; // replaced once Store is available (see applyQuality)

  // ---- persistent storage --------------------------------------------------
  // Reads are memoised: the render path touches these getters dozens of times per
  // frame, and synchronous localStorage.getItem is genuinely expensive on mobile.
  // This tab is the only writer, so the cache cannot go stale under normal use.
  const Store = {
    _cache: Object.create(null),
    _read(k, d) {
      const c = this._cache[k];
      if (c !== undefined) return c;
      let v;
      try { v = localStorage.getItem(k); } catch (e) { v = null; }
      if (v == null) v = d;
      this._cache[k] = v;
      return v;
    },
    _write(k, v) {
      this._cache[k] = v;
      try { localStorage.setItem(k, v); } catch (e) {}
    },
    // call after clearing localStorage behind the cache's back (e.g. reset progress)
    _invalidate() { this._cache = Object.create(null); },
    get best() { return parseInt(this._read('lumen_best', '0'), 10) || 0; },
    set best(v) { this._write('lumen_best', String(v)); },
    get bestCombo() { return parseInt(this._read('lumen_bestcombo', '0'), 10) || 0; },
    set bestCombo(v) { this._write('lumen_bestcombo', String(v)); },
    get runs() { return parseInt(this._read('lumen_runs', '0'), 10) || 0; },
    set runs(v) { this._write('lumen_runs', String(v)); },
    get motes() { return parseInt(this._read('lumen_motes', '0'), 10) || 0; },
    set motes(v) { this._write('lumen_motes', String(v)); },
    get muted() { return this._read('lumen_muted', '0') === '1'; },
    set muted(v) { this._write('lumen_muted', v ? '1' : '0'); },
    // settings
    _bool(k, defTrue) { return this._read(k, defTrue ? '1' : '0') === '1'; },
    // A plain-object store value, and it really must be a plain OBJECT.
    //
    // `JSON.parse(x) || {}` is not enough: an array is truthy, so a save whose
    // `lumen_items` is the string "[]" sailed through, and then `items['shield']
    // = 1` set a named property on an ARRAY — which JSON.stringify drops
    // silently. The shards were spent, the item never arrived, and it repeated
    // on every click. Save codes are pasted from other people, so this is
    // reachable input, not a hypothetical.
    _obj(k) {
      try {
        const o = JSON.parse(this._read(k, '{}'));
        return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
      } catch (e) { return {}; }
    },
    get musicOn() { return this._bool('lumen_music', true); },
    set musicOn(v) { this._write('lumen_music', v ? '1' : '0'); },
    get sfxOn() { return this._bool('lumen_sfx', true); },
    set sfxOn(v) { this._write('lumen_sfx', v ? '1' : '0'); },
    get hapticsOn() { return this._bool('lumen_haptics', true); },
    set hapticsOn(v) { this._write('lumen_haptics', v ? '1' : '0'); },
    get reduceFlash() { return this._bool('lumen_reduceflash', false); },
    set reduceFlash(v) { this._write('lumen_reduceflash', v ? '1' : '0'); },
    // 'auto' lets the game pick and self-adjust; otherwise a fixed preset name
    get quality() { return this._read('lumen_quality', 'auto'); },
    set quality(v) { this._write('lumen_quality', v); },
    // what 'auto' actually settled on last time, so a slow device starts there
    // instead of re-discovering it (and re-stuttering) every single session
    get autoTier() { return this._read('lumen_autotier', ''); },
    set autoTier(v) { this._write('lumen_autotier', v); },
    get tutorialDone() { return this._bool('lumen_tut', false); },
    set tutorialDone(v) { this._write('lumen_tut', v ? '1' : '0'); },
    get lang() { return this._read('lumen_lang', ''); },
    set lang(v) { this._write('lumen_lang', v); },
    get consent() { return this._read('lumen_consent', 'unset'); },
    set consent(v) { this._write('lumen_consent', v); },
    // The next-update vote. `voterId` is a random string with no meaning
    // outside "this install has already voted"; `pollVote` remembers which
    // option, as "<pollId>:<optionId>", so a new poll asks again and the old
    // one never does.
    get voterId() { return this._read('lumen_voter', ''); },
    set voterId(v) { this._write('lumen_voter', String(v || '')); },
    get pollSeen() { return this._read('lumen_pollseen', ''); },
    set pollSeen(v) { this._write('lumen_pollseen', String(v || '')); },
    get pollVote() { return this._read('lumen_pollvote', ''); },
    set pollVote(v) { this._write('lumen_pollvote', String(v || '')); },
    // "YYYY-MM-DD:n" — a stamp that is not today's IS a fresh day, so a clock
    // moved backwards cannot mint extra ad views.
    get adsToday() { return this._read('lumen_ads', ''); },
    set adsToday(v) { this._write('lumen_ads', String(v || '')); },
    // Did the player agree to their name and scores being published?
    //
    // Guideline 5.1.2: consent has to come BEFORE the upload, not be implied by
    // having signed in. Nothing reaches the board without this — canSubmit gates
    // every path on it, including the pending-best flush and the seeding of a
    // record set before the account existed.
    get boardConsent() { return this._read('lumen_board_ok', '') === '1'; },
    set boardConsent(v) { this._write('lumen_board_ok', v ? '1' : ''); },
    get playerName() { return this._read('lumen_name', ''); },
    set playerName(v) { this._write('lumen_name', v); },
    // Bests that have no name to go up under yet, keyed by board.
    get pendingBest() {
      try { return JSON.parse(this._read('lumen_pending', '') || '{}') || {}; }
      catch (e) { return {}; }
    },
    set pendingBest(v) {
      const keys = v && typeof v === 'object' ? Object.keys(v) : [];
      this._write('lumen_pending', keys.length ? JSON.stringify(v) : '');
    },
    get difficulty() { return this._read('lumen_diff', 'normal'); },
    set difficulty(v) { this._write('lumen_diff', v); },
    get colorblind() { return this._read('lumen_cb', 'off'); },
    set colorblind(v) { this._write('lumen_cb', v); },
    get highContrast() { return this._bool('lumen_hc', false); },
    set highContrast(v) { this._write('lumen_hc', v ? '1' : '0'); },
    // cosmetics / economy
    get shards() { return parseInt(this._read('lumen_shards', '0'), 10) || 0; },
    set shards(v) { this._write('lumen_shards', String(Math.max(0, Math.floor(v)))); },
    get skin() { return this._read('lumen_skin', 'ion'); },
    set skin(v) { this._write('lumen_skin', v); },
    get trail() { return this._read('lumen_trail', 'dust'); },
    set trail(v) { this._write('lumen_trail', v); },
    get map() { return this._read('lumen_map', 'deepfield'); },
    set map(v) { this._write('lumen_map', v); },
    // which signature owns the flip, the flow and the death
    get signature() { return this._read('lumen_sig', 'ripple'); },
    set signature(v) { this._write('lumen_sig', v); },
    get purchases() { try { const a = JSON.parse(this._read('lumen_iap', '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
    set purchases(a) { this._write('lumen_iap', JSON.stringify(a)); },
    // consumable stock bought in the shop: { shield: n, magnet: n, slow: n }
    get items() { return this._obj('lumen_items'); },
    set items(o) { this._write('lumen_items', JSON.stringify(o)); },
    // which shop tabs have had their one-time explainer dismissed
    get coachSeen() { return this._obj('lumen_coach'); },
    set coachSeen(o) { this._write('lumen_coach', JSON.stringify(o)); },
    // which game mode is selected, and a best score per mode (they aren't comparable)
    get mode() { return this._read('lumen_mode', 'classic'); },
    set mode(v) { this._write('lumen_mode', String(v || 'classic')); },
    get modeBests() { return this._obj('lumen_mode_bests'); },
    set modeBests(o) { this._write('lumen_mode_bests', JSON.stringify(o)); },
    // the orbiting shards at high chain — on by default, one toggle to undo
    get chargeFx() { return this._bool('lumen_charge', true); },
    set chargeFx(v) { this._write('lumen_charge', v ? '1' : '0'); },
    get autoUseItems() { return this._bool('lumen_autouse', false); },
    set autoUseItems(v) { this._write('lumen_autouse', v ? '1' : '0'); },
    get voiceControl() { return this._bool('lumen_voice', false); },
    set voiceControl(v) { this._write('lumen_voice', v ? '1' : '0'); },
    // Array.isArray like its siblings: a crafted transfer code could put an
    // object here, and every game-over then threw out of showGameOver.
    get unlocks() { try { const a = JSON.parse(this._read('lumen_unlocks', '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
    set unlocks(a) { this._write('lumen_unlocks', JSON.stringify(a)); },
    // daily
    get dailyBest() { return parseInt(this._read('lumen_daily_best', '0'), 10) || 0; },
    set dailyBest(v) { this._write('lumen_daily_best', String(v)); },
    get dailyDate() { return this._read('lumen_daily_date', ''); },
    set dailyDate(v) { this._write('lumen_daily_date', v); },
    get dailyStreak() { return parseInt(this._read('lumen_daily_streak', '0'), 10) || 0; },
    set dailyStreak(v) { this._write('lumen_daily_streak', String(v)); },
    get dailyLastPlayed() { return this._read('lumen_daily_last', ''); },
    set dailyLastPlayed(v) { this._write('lumen_daily_last', v); },
    // missions (JSON blob)
    get missions() { try { return JSON.parse(this._read('lumen_missions', 'null')); } catch (e) { return null; } },
    set missions(o) { this._write('lumen_missions', JSON.stringify(o)); },
    // lifetime stats that achievements read
    get flowCount() { return parseInt(this._read('lumen_flowcount', '0'), 10) || 0; },
    set flowCount(v) { this._write('lumen_flowcount', String(v)); },
    get nearMissTotal() { return parseInt(this._read('lumen_nearmiss', '0'), 10) || 0; },
    set nearMissTotal(v) { this._write('lumen_nearmiss', String(v)); },
    get bestTime() { return parseFloat(this._read('lumen_besttime', '0')) || 0; },
    set bestTime(v) { this._write('lumen_besttime', String(Math.round(v))); },
    get reviveCount() { return parseInt(this._read('lumen_revives', '0'), 10) || 0; },
    set reviveCount(v) { this._write('lumen_revives', String(v)); },
    // progression
    get achievements() { try { const a = JSON.parse(this._read('lumen_achv', '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
    set achievements(a) { this._write('lumen_achv', JSON.stringify(a)); },
    get skills() { return this._obj('lumen_skills'); },
    set skills(o) { this._write('lumen_skills', JSON.stringify(o)); },
    // local leaderboard (JSON array of {s, c, d})
    get scores() { try { const a = JSON.parse(this._read('lumen_scores', '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
    set scores(a) { this._write('lumen_scores', JSON.stringify(a)); },
  };
  LUMEN.Store = Store;

  // Keys that are a SETTING, an ACCESSIBILITY choice, or an identity — never a
  // thing the player earned. RESET PROGRESS wipes everything else and leaves
  // every one of these exactly as it was.
  //
  // It used to keep five of them by hand (music, sfx, haptics, reduce-flash,
  // mute), so resetting progress also silently reset the COLOUR-VISION palette
  // and HIGH CONTRAST — a colourblind player pressing a button about their
  // score lost the settings that make the game readable at all — along with
  // their language, graphics tier, leaderboard name, voice-control toggle and
  // their recorded telemetry decision.
  //
  // The list lives here, beside the getters that define these keys, so adding a
  // setting and remembering to preserve it are the same edit.
  LUMEN.SETTING_KEYS = [
    // sound
    'lumen_music', 'lumen_sfx', 'lumen_muted', 'lumen_haptics',
    // accessibility — losing any of these can make the game unplayable
    'lumen_cb', 'lumen_hc', 'lumen_reduceflash', 'lumen_charge',
    // performance
    'lumen_quality', 'lumen_autotier',
    // who you are and what you agreed to
    'lumen_lang', 'lumen_name', 'lumen_consent', 'lumen_tele',
    // input preferences
    'lumen_voice', 'lumen_autouse',
    // one-time migration markers: not progress, and re-running them is noise
    'lumen_balance_2026_07',
  ];

  // ---- glow sprite cache ---------------------------------------------------
  // Per-particle shadowBlur is by far the most expensive thing a canvas game can
  // do. We pre-render one soft radial glow per colour and blit it instead, which
  // keeps hundreds of particles cheap even on a low-end phone.
  const SPRITE_PX = 48;
  const glowCache = new Map();
  // Additive glows are tiny, so exact lightness is invisible — collapse each colour
  // to a quantised hue at a canonical lightness. Keeps the cache to a few dozen
  // entries even with the rainbow skin cycling hue every frame.
  // matches both `hsl(H S% L%)` and `hsla(H S% L% / A)`
  const HSL_RE = /^hsla?\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*([\d.]+)\s*)?\)$/;
  function glowKey(color) {
    const m = HSL_RE.exec(color);
    if (!m) return color;
    const h = Math.round(parseFloat(m[1]) / 8) * 8;
    const s = Math.round(parseFloat(m[2]) / 20) * 20;
    // Keep lightness (quantised) in the key. Forcing every glow to 62% made pale
    // skins like Frost (light 82%) blit a duller, darker halo than their own orb.
    const l = Math.round(parseFloat(m[3]) / 10) * 10;
    return 'hsl(' + (h % 360) + ' ' + s + '% ' + clamp(l, 40, 90) + '%)';
  }
  // Re-alpha a colour safely: naive string surgery produced `... / 0.9 / 0.35)`
  // when the input already carried an alpha.
  function withAlpha(color, a) {
    const m = HSL_RE.exec(color);
    if (!m) return color;
    const base = parseFloat(m[4] == null ? 1 : m[4]);
    return 'hsla(' + m[1] + ' ' + m[2] + '% ' + m[3] + '% / ' + (base * a).toFixed(3) + ')';
  }
  function glowSprite(rawColor) {
    const color = glowKey(rawColor);
    let s = glowCache.get(color);
    if (s) return s;
    if (glowCache.size > 128) glowCache.clear(); // hard bound; quantisation makes this rare
    const c = document.createElement('canvas');
    c.width = c.height = SPRITE_PX;
    const x = c.getContext('2d');
    const h = SPRITE_PX / 2;
    const g = x.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.22, color);
    g.addColorStop(0.5, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(h, h, h, 0, TAU); x.fill();
    glowCache.set(color, c);
    return c;
  }

  // A vertical bar with a soft horizontal falloff — replaces per-obstacle
  // shadowBlur, which forces an offscreen blur pass for every bar every frame.
  const barCache = new Map();
  function barSprite(color) {
    const key = glowKey(color);
    let s = barCache.get(key);
    if (s) return s;
    if (barCache.size > 32) barCache.clear();
    const PAD = 16, CORE = 16, w = CORE + PAD * 2, h = 8;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    // A hazard has to read as a hazard at a glance: dark body, hot bright rims.
    // A flat glowing slab looked like just another glowing thing next to the
    // gold pickups, which is exactly how players walk into it.
    const soft = withAlpha(color, 0.30);
    const rim = withAlpha(color, 1);
    const body = withAlpha(color, 0.62);
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, withAlpha(color, 0));
    g.addColorStop(PAD / w * 0.55, soft);
    g.addColorStop(PAD / w, rim);                    // hot left edge
    g.addColorStop(PAD / w + 0.06, body);            // darker core
    g.addColorStop(1 - PAD / w - 0.06, body);
    g.addColorStop(1 - PAD / w, rim);                // hot right edge
    g.addColorStop(1 - PAD / w * 0.55, soft);
    g.addColorStop(1, withAlpha(color, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    c._pad = PAD / CORE; // glow padding expressed in bar-widths
    barCache.set(key, c);
    return c;
  }

  // The halo half of a bar, meant to be blitted with 'lighter' so a gate actually
  // throws light the way the orb, motes and walls do. The core is kept nearly
  // black on purpose: adding light only at the rims keeps the hazard reading as a
  // solid object with hot edges, instead of a glowing slab that looks collectable.
  const barGlowCache = new Map();
  function barGlowSprite(color) {
    const key = glowKey(color);
    let s = barGlowCache.get(key);
    if (s) return s;
    if (barGlowCache.size > 32) barGlowCache.clear();
    const PAD = 26, CORE = 16, w = CORE + PAD * 2, h = 8;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, withAlpha(color, 0));
    g.addColorStop(PAD / w * 0.6, withAlpha(color, 0.16));
    g.addColorStop(PAD / w, withAlpha(color, 0.62));            // hot left rim
    g.addColorStop(PAD / w + 0.05, withAlpha(color, 0.08));     // core adds almost nothing
    g.addColorStop(1 - PAD / w - 0.05, withAlpha(color, 0.08));
    g.addColorStop(1 - PAD / w, withAlpha(color, 0.62));        // hot right rim
    g.addColorStop(1 - PAD / w * 0.6, withAlpha(color, 0.16));
    g.addColorStop(1, withAlpha(color, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    c._pad = PAD / CORE;
    barGlowCache.set(key, c);
    return c;
  }

  // Full-screen vignettes, baked once per size instead of rasterising a radial
  // gradient every frame.
  function vignetteSprite(w, h, inner, outer, color) {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(w * 0.35));
    c.height = Math.max(2, Math.round(h * 0.35));
    const x = c.getContext('2d');
    const cx = c.width / 2, cy = c.height / 2;
    const g = x.createRadialGradient(cx, cy, Math.min(cx, cy) * inner, cx, cy, Math.max(cx, cy) * outer);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, color);
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // ---- particle system -----------------------------------------------------
  class Particles {
    constructor() { this.pool = []; this.count = 0; } // pool is reused; `count` = live particles
    _obtain() {
      if (this.count < this.pool.length) return this.pool[this.count++];
      const q = {};
      this.pool.push(q); this.count++;
      return q;
    }
    spawn(o) {
      const q = this._obtain();
      q.x = o.x; q.y = o.y;
      q.vx = o.vx || 0; q.vy = o.vy || 0;
      q.life = o.life || 0.6; q.age = 0;
      q.size = o.size || 3;
      q.color = o.color || '#8ff';
      q.grav = o.grav || 0;
      q.drag = o.drag == null ? 0.92 : o.drag;
      q.glow = !!o.glow;
      q.shrink = o.shrink == null ? 1 : o.shrink;
      // resolve the glow sprite ONCE here — doing it per frame costs a regex
      // parse + string build per particle, which is slower than what it replaces
      q.sprite = q.glow ? glowSprite(q.color) : null;
    }
    burst(x, y, n, opt) {
      opt = opt || {};
      n = Math.max(1, Math.round(n * (LUMEN.Q ? LUMEN.Q.particles : 1)));
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU);
        const sp = rand(opt.spMin || 40, opt.spMax || 220);
        this.spawn({
          x, y,
          vx: Math.cos(a) * sp + (opt.vx || 0),
          vy: Math.sin(a) * sp + (opt.vy || 0),
          life: rand(opt.lifeMin || 0.35, opt.lifeMax || 0.8),
          size: rand(opt.sizeMin || 2, opt.sizeMax || 5),
          color: opt.color || '#8ff',
          grav: opt.grav || 0,
          drag: opt.drag == null ? 0.9 : opt.drag,
          glow: opt.glow !== false,
        });
      }
    }
    update(dt) {
      const p = this.pool;
      // swap-remove dead particles: no splice, no garbage
      for (let i = this.count - 1; i >= 0; i--) {
        const q = p[i];
        q.age += dt;
        if (q.age >= q.life) {
          const last = this.count - 1;
          if (i !== last) { p[i] = p[last]; p[last] = q; }
          this.count--;
          continue;
        }
        const d = Math.pow(q.drag, dt * 60);
        q.vy += q.grav * dt;
        q.vx *= d; q.vy *= d;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
      }
    }
    draw(ctx) {
      const p = this.pool;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.count; i++) {
        const q = p[i];
        const k = 1 - q.age / q.life;
        const s = q.size * (q.shrink ? (0.3 + 0.7 * k) : 1);
        ctx.globalAlpha = clamp(k, 0, 1);
        if (q.sprite) {
          // blit the pre-resolved glow sprite — no shadowBlur, no per-frame lookup
          const r = s * 2.6;
          ctx.drawImage(q.sprite, q.x - r, q.y - r, r * 2, r * 2);
        } else {
          ctx.fillStyle = q.color;
          ctx.beginPath(); ctx.arc(q.x, q.y, s, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }
    clear() { this.count = 0; }
  }

  // ---- rings ---------------------------------------------------------------
  // One expanding (or contracting) stroked circle. Signatures are built out of
  // these because a ring reads as AUTHORED in a way a spray of dots does not —
  // it is the difference between "some particles happened" and "something was
  // designed". Pooled exactly like the particles, so a run that flips ten
  // thousand times still allocates nothing.
  //
  // Deliberately cheap: a stroked arc with a fading alpha, no shadowBlur, no
  // gradient. Measured at ~0.02ms for a full pool, which is what lets the flip
  // — an action performed several hundred times a run — carry one.
  class Rings {
    constructor() {
      this.pool = [];
      this.count = 0;
      this.MAX = 24;
      for (let i = 0; i < this.MAX; i++) {
        this.pool.push({ x: 0, y: 0, r0: 0, r1: 0, w: 0, life: 0, age: 0, wait: 0, col: '#8ff', dark: false, white: false });
      }
    }
    spawn(x, y, spec, col, unit, wait) {
      // Oldest-out rather than dropping the new one: the ring you just earned by
      // tapping must always be the one you see.
      const q = this.count < this.MAX ? this.pool[this.count++] : this.pool[(this._rr = ((this._rr || 0) + 1) % this.MAX)];
      q.x = x; q.y = y;
      q.r0 = (spec.r0 || 1) * unit;
      q.r1 = (spec.r1 || 3) * unit;
      q.w = spec.width || 2;
      q.life = spec.life || 0.5;
      q.age = 0;
      q.wait = wait || 0;
      q.col = col;
      q.dark = !!spec.dark;
      q.white = !!spec.white;
    }
    update(dt) {
      const p = this.pool;
      for (let i = this.count - 1; i >= 0; i--) {
        const q = p[i];
        if (q.wait > 0) { q.wait -= dt; continue; }
        q.age += dt;
        if (q.age >= q.life) {
          const last = this.count - 1;
          if (i !== last) { p[i] = p[last]; p[last] = q; }
          this.count--;
        }
      }
    }
    draw(ctx) {
      if (!this.count) return;
      ctx.save();
      for (let i = 0; i < this.count; i++) {
        const q = this.pool[i];
        if (q.wait > 0) continue;
        const t = q.age / q.life;
        // ease out: fast at birth, settling as it fades — a linear ring looks mechanical
        const e = 1 - Math.pow(1 - t, 2.2);
        const r = q.r0 + (q.r1 - q.r0) * e;
        if (r <= 0.5) continue;
        ctx.globalAlpha = (1 - t) * (q.dark ? 0.85 : 0.7);
        ctx.lineWidth = Math.max(0.5, q.w * (1 - t * 0.6));
        ctx.strokeStyle = q.dark ? 'rgba(4,5,14,0.95)' : q.white ? '#ffffff' : q.col;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, TAU);
        ctx.stroke();
        // a dark ring needs a lit rim or it is invisible against a dark sky
        if (q.dark) {
          ctx.globalAlpha = (1 - t) * 0.5;
          ctx.lineWidth = Math.max(0.5, q.w * 0.35);
          ctx.strokeStyle = q.col;
          ctx.beginPath();
          ctx.arc(q.x, q.y, r + q.w * 0.5, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    clear() { this.count = 0; }
  }

  // ---- floating score text -------------------------------------------------
  class FloatingTexts {
    constructor() { this.list = []; }
    add(x, y, text, color, size) {
      this.list.push({ x, y, text, color: color || '#fff', size: size || 20, age: 0, life: 0.9, vy: -46 });
    }
    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const t = this.list[i];
        t.age += dt; t.y += t.vy * dt; t.vy *= 0.92;
        if (t.age >= t.life) this.list.splice(i, 1);
      }
    }
    draw(ctx) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const t of this.list) {
        const k = 1 - t.age / t.life;
        ctx.globalAlpha = clamp(k * 1.4, 0, 1);
        const sz = t.size * (1 + (1 - k) * 0.3);
        ctx.font = `800 ${sz}px "Rajdhani", system-ui, sans-serif`;
        ctx.shadowColor = t.color; ctx.shadowBlur = 12;
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.restore();
    }
    clear() { this.list.length = 0; }
  }

  // ---- background (parallax dust + baked nebula) ---------------------------
  // The gradient + nebula clouds used to be rasterised every frame: four huge
  // additive radial gradients over a full-screen fill. At a 4K fullscreen canvas
  // that is tens of millions of blended pixels per frame and it destroys the
  // frame rate. They're now baked into a half-resolution offscreen layer and
  // blitted, which is a single cheap texture copy.
  // ---- baked scenery -------------------------------------------------------
  // A map may name a `scene`: a picture painted ONCE into the background bake,
  // behind everything, at the bake's half resolution. It costs nothing per
  // frame, which is the whole trick — the rooftop cat and the blossom trees are
  // as cheap as the gradient they sit on.
  const SCENES = {
    // Moonlit rooftops: a full moon, a skyline of roofs with lit windows, and
    // one more cat sitting on a chimney, tail curled, watching you play.
    rooftops(x, w, h) {
      // the moon, high right, with two soft craters
      const mx = w * 0.78, my = h * 0.16, mr = h * 0.085;
      const glow = x.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 3);
      glow.addColorStop(0, 'hsla(48 80% 88% / 0.30)');
      glow.addColorStop(1, 'hsla(48 80% 88% / 0)');
      x.fillStyle = glow;
      x.beginPath(); x.arc(mx, my, mr * 3, 0, TAU); x.fill();
      x.fillStyle = 'hsl(48 65% 88%)';
      x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
      x.fillStyle = 'hsla(45 40% 70% / 0.5)';
      x.beginPath(); x.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22, 0, TAU); x.fill();
      x.beginPath(); x.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.14, 0, TAU); x.fill();

      // the skyline: a strip of roof silhouettes along the bottom
      const base = h * 0.93;
      x.fillStyle = 'hsla(240 45% 6% / 0.92)';
      x.beginPath();
      x.moveTo(0, h);
      x.lineTo(0, base);
      // gabled roofs of varying widths, deterministic so the bake is stable
      let rx = 0;
      const peaks = [0.16, 0.11, 0.2, 0.14, 0.18, 0.13, 0.2];
      for (let i = 0; rx < w; i++) {
        const rw = w * peaks[i % peaks.length];
        const peak = base - h * (0.045 + 0.03 * ((i * 7) % 3));
        x.lineTo(rx + rw * 0.5, peak);
        x.lineTo(rx + rw, base);
        rx += rw;
      }
      x.lineTo(w, h);
      x.closePath(); x.fill();

      // warm windows tucked under the eaves
      x.fillStyle = 'hsla(38 95% 62% / 0.85)';
      const wins = [0.07, 0.19, 0.33, 0.46, 0.61, 0.74, 0.9];
      for (let i = 0; i < wins.length; i++) {
        const wx = w * wins[i], wy = base - h * (0.012 + 0.01 * (i % 3));
        x.fillRect(wx, wy, Math.max(2, w * 0.008), Math.max(2, w * 0.011));
      }

      // a chimney, and the OTHER cat sitting on it — ears, body, curled tail
      const cx = w * 0.30, cy = base - h * 0.055, cs = h * 0.035;
      x.fillStyle = 'hsla(240 45% 6% / 0.95)';
      x.fillRect(cx - cs * 0.6, cy, cs * 1.2, h * 0.06);
      x.beginPath();                                    // body
      x.ellipse(cx, cy - cs * 0.45, cs * 0.55, cs * 0.62, 0, 0, TAU); x.fill();
      x.beginPath();                                    // head
      x.arc(cx, cy - cs * 1.15, cs * 0.38, 0, TAU); x.fill();
      x.beginPath();                                    // ears
      x.moveTo(cx - cs * 0.34, cy - cs * 1.3); x.lineTo(cx - cs * 0.3, cy - cs * 1.72); x.lineTo(cx - cs * 0.06, cy - cs * 1.44);
      x.moveTo(cx + cs * 0.34, cy - cs * 1.3); x.lineTo(cx + cs * 0.3, cy - cs * 1.72); x.lineTo(cx + cs * 0.06, cy - cs * 1.44);
      x.fill();
      x.strokeStyle = 'hsla(240 45% 6% / 0.95)';        // curled tail
      x.lineWidth = cs * 0.16; x.lineCap = 'round';
      x.beginPath();
      x.moveTo(cx + cs * 0.5, cy - cs * 0.1);
      x.quadraticCurveTo(cx + cs * 1.25, cy - cs * 0.3, cx + cs * 1.1, cy - cs * 1.0);
      x.stroke();
    },

    // Sakura at sunset. The sky itself comes from the map's `sky` rows; this
    // paints what stands in front of it: the low sun, Fuji on the horizon, a
    // torii silhouette, and a blossom tree built from a real branching pass
    // with five-petal flowers — the first version's circle-blob clusters were
    // judged, accurately, as bubbles.
    sakura(x, w, h) {
      const horizon = h * 0.42;

      // the sun, low and heavy, with a long halo
      const sx2 = w * 0.62, sy = horizon - h * 0.045, sr = h * 0.075;
      const halo = x.createRadialGradient(sx2, sy, sr * 0.4, sx2, sy, sr * 4.5);
      halo.addColorStop(0, 'hsla(28 100% 72% / 0.5)');
      halo.addColorStop(0.5, 'hsla(20 95% 60% / 0.18)');
      halo.addColorStop(1, 'hsla(20 95% 60% / 0)');
      x.fillStyle = halo;
      x.fillRect(0, 0, w, h);
      x.fillStyle = 'hsl(30 100% 78%)';
      x.beginPath(); x.arc(sx2, sy, sr, 0, TAU); x.fill();

      // far haze, then Fuji with a snow cap, then a nearer ridge
      x.fillStyle = 'hsla(310 35% 22% / 0.55)';
      x.beginPath();
      x.moveTo(0, horizon);
      x.quadraticCurveTo(w * 0.2, horizon - h * 0.02, w * 0.45, horizon);
      x.lineTo(w, horizon); x.lineTo(w, horizon + h * 0.02); x.lineTo(0, horizon + h * 0.02);
      x.closePath(); x.fill();
      const fx = w * 0.24, fw = w * 0.42, ftop = horizon - h * 0.115;
      x.fillStyle = 'hsla(285 40% 16% / 0.92)';
      x.beginPath();
      x.moveTo(fx - fw * 0.5, horizon);
      x.quadraticCurveTo(fx - fw * 0.18, ftop + h * 0.02, fx - fw * 0.06, ftop);
      x.lineTo(fx + fw * 0.06, ftop);
      x.quadraticCurveTo(fx + fw * 0.18, ftop + h * 0.02, fx + fw * 0.5, horizon);
      x.closePath(); x.fill();
      x.fillStyle = 'hsla(340 30% 88% / 0.9)';                 // the snow cap
      x.beginPath();
      x.moveTo(fx - fw * 0.085, ftop + h * 0.012);
      x.lineTo(fx - fw * 0.06, ftop); x.lineTo(fx + fw * 0.06, ftop);
      x.lineTo(fx + fw * 0.085, ftop + h * 0.012);
      x.lineTo(fx + fw * 0.045, ftop + h * 0.028);
      x.lineTo(fx + fw * 0.01, ftop + h * 0.016);
      x.lineTo(fx - fw * 0.03, ftop + h * 0.03);
      x.closePath(); x.fill();

      // a torii on the water line, small and dark against the sun
      const tx = w * 0.60, tb = horizon, th = h * 0.075, tw2 = w * 0.085;
      x.fillStyle = 'hsla(8 55% 14% / 0.95)';
      x.fillRect(tx - tw2 * 0.42, tb - th * 0.82, tw2 * 0.09, th * 0.82);   // pillars
      x.fillRect(tx + tw2 * 0.33, tb - th * 0.82, tw2 * 0.09, th * 0.82);
      x.fillRect(tx - tw2 * 0.34, tb - th * 0.52, tw2 * 0.68, th * 0.09);   // nuki
      x.beginPath();                                                         // kasagi
      x.moveTo(tx - tw2 * 0.62, tb - th * 0.88);
      x.quadraticCurveTo(tx, tb - th * 1.02, tx + tw2 * 0.62, tb - th * 0.88);
      x.lineTo(tx + tw2 * 0.60, tb - th * 0.78);
      x.quadraticCurveTo(tx, tb - th * 0.9, tx - tw2 * 0.60, tb - th * 0.78);
      x.closePath(); x.fill();
      // its reflection, broken
      x.fillStyle = 'hsla(8 45% 14% / 0.30)';
      x.fillRect(tx - tw2 * 0.42, tb + th * 0.06, tw2 * 0.09, th * 0.4);
      x.fillRect(tx + tw2 * 0.33, tb + th * 0.06, tw2 * 0.09, th * 0.4);
      // a sun road on the water
      const road = x.createLinearGradient(0, tb, 0, tb + h * 0.1);
      road.addColorStop(0, 'hsla(28 95% 68% / 0.30)');
      road.addColorStop(1, 'hsla(28 95% 68% / 0)');
      x.fillStyle = road;
      x.fillRect(sx2 - sr * 1.4, tb, sr * 2.8, h * 0.1);

      // the blossom tree: a real branching pass. Trunk from the lower left,
      // splitting twice; every terminal carries a flower cluster drawn as
      // five-petal blossoms, not circles.
      const flower = (bx, by, fr, tone) => {
        x.fillStyle = tone;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU - 0.6;
          x.beginPath();
          x.ellipse(bx + Math.cos(a) * fr * 0.55, by + Math.sin(a) * fr * 0.55,
            fr * 0.42, fr * 0.3, a, 0, TAU);
          x.fill();
        }
        x.fillStyle = 'hsla(45 90% 80% / 0.9)';
        x.beginPath(); x.arc(bx, by, fr * 0.16, 0, TAU); x.fill();
      };
      const canopy = (cx, cy, cr) => {
        // a soft rose mass first so the flowers sit IN something
        const mass = x.createRadialGradient(cx, cy, 0, cx, cy, cr);
        mass.addColorStop(0, 'hsla(334 70% 72% / 0.5)');
        mass.addColorStop(1, 'hsla(334 70% 62% / 0)');
        x.fillStyle = mass;
        x.beginPath(); x.arc(cx, cy, cr, 0, TAU); x.fill();
        const tones = ['hsla(342 88% 84% / 0.95)', 'hsla(332 80% 74% / 0.9)', 'hsla(350 92% 90% / 0.95)'];
        const ring = [[0, 0], [-0.55, -0.25], [0.5, -0.35], [-0.25, 0.45], [0.45, 0.35], [-0.6, 0.28], [0.1, -0.6]];
        for (let i = 0; i < ring.length; i++) {
          flower(cx + ring[i][0] * cr, cy + ring[i][1] * cr, cr * 0.26, tones[i % 3]);
        }
      };
      const branch = (bx, by, ang, len, depth) => {
        const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
        x.strokeStyle = 'hsla(350 25% 12% / 0.95)';
        x.lineWidth = Math.max(1, (depth + 1) * h * 0.004);
        x.lineCap = 'round';
        x.beginPath(); x.moveTo(bx, by);
        x.quadraticCurveTo(bx + Math.cos(ang - 0.25) * len * 0.5, by + Math.sin(ang - 0.25) * len * 0.5, ex, ey);
        x.stroke();
        if (depth === 0) { canopy(ex, ey, h * 0.045); return; }
        branch(ex, ey, ang - 0.5, len * 0.72, depth - 1);
        branch(ex, ey, ang + 0.28, len * 0.66, depth - 1);
      };
      branch(-w * 0.02, h * 0.66, -0.9, h * 0.20, 2);   // main tree, lower left
      branch(w * 1.02, h * 0.24, Math.PI + 0.55, h * 0.14, 1);  // a reaching arm, upper right
    },
    // The hour before sunrise over a valley of tuff. Six layers, baked once, so
    // it costs nothing per frame -- the same deal rooftops and sakura get.
    //
    // The lint this obeys (a test enforces it): no fill here is within 20 degrees
    // of a REWARD hue or 28 of a DANGER hue unless it is dark (L <= 40) or
    // near-neutral (S <= 25), and nothing is drawn with 'lighter'. Every object
    // that can kill or reward you ADDS light; a backdrop never does. This world
    // has small bright WARM points in it -- the burners -- which is the exact
    // shape of a gold mote, so it is held to the rule: hue 26 is 24 degrees off
    // gold, at a third of a mote's alpha, four times its width, and coreless.
    ashrise(x, w, h) {
      // 1. VALLEY MIST — one band, and it is what turns a row of silhouettes
      //    into a valley.
      const mist = x.createLinearGradient(0, h * 0.30, 0, h * 0.50);
      mist.addColorStop(0, 'hsla(228 40% 62% / 0.14)');
      mist.addColorStop(1, 'hsla(228 40% 62% / 0)');
      x.fillStyle = mist; x.fillRect(0, h * 0.30, w, h * 0.20);

      // 2. MORNING STAR — a dot and a four-point flare. Neutral, so it carries
      //    no colour signal at all.
      const sx2 = w * 0.16, sy2 = h * 0.08, sf = h * 0.018;
      x.fillStyle = 'hsl(0 0% 96%)';
      x.beginPath(); x.arc(sx2, sy2, Math.max(1, h * 0.004), 0, TAU); x.fill();
      x.strokeStyle = 'hsla(0 0% 96% / 0.5)'; x.lineWidth = 1;
      x.beginPath();
      x.moveTo(sx2 - sf, sy2); x.lineTo(sx2 + sf, sy2);
      x.moveTo(sx2, sy2 - sf); x.lineTo(sx2, sy2 + sf);
      x.stroke();

      // 3. BALLOONS — fourteen, three depths, all above the ridge line. Far ones
      //    are flat and cold so depth reads; the five nearest get a gradient,
      //    two gores and a lit burner.
      // Radii are ~60% of the drafted ones. At a phone's height the near
      // balloons were 175px across and stopped reading as distance -- they were
      // in the corridor rather than behind it.
      const B = [
        [0.07, 0.06, 0.009, 0], [0.19, 0.04, 0.008, 0], [0.32, 0.08, 0.010, 0],
        [0.46, 0.04, 0.008, 0], [0.60, 0.08, 0.009, 0], [0.75, 0.05, 0.008, 0],
        [0.90, 0.07, 0.010, 0],
        [0.13, 0.13, 0.014, 1], [0.53, 0.12, 0.015, 1],
        [0.16, 0.19, 0.020, 2], [0.34, 0.17, 0.021, 2], [0.50, 0.20, 0.019, 2],
        [0.70, 0.16, 0.022, 2], [0.87, 0.19, 0.020, 2],
      ];
      for (let i = 0; i < B.length; i++) {
        const bx = w * B[i][0], by = h * B[i][1], r = h * B[i][2], dep = B[i][3];
        if (dep === 2) {
          const g2 = x.createLinearGradient(bx, by - r * 1.1, bx, by + r * 1.2);
          g2.addColorStop(0, 'hsla(24 72% 52% / 0.92)');
          g2.addColorStop(1, 'hsla(342 50% 34% / 0.92)');
          x.fillStyle = g2;
        } else {
          x.fillStyle = dep === 1 ? 'hsla(250 26% 30% / 0.62)' : 'hsla(250 22% 26% / 0.45)';
        }
        x.beginPath();                                        // dome + taper to the mouth
        x.ellipse(bx, by, r, r * 1.12, 0, Math.PI, TAU);
        x.moveTo(bx - r, by);
        x.quadraticCurveTo(bx - r * 0.55, by + r * 0.9, bx - r * 0.22, by + r * 1.24);
        x.lineTo(bx + r * 0.22, by + r * 1.24);
        x.quadraticCurveTo(bx + r * 0.55, by + r * 0.9, bx + r, by);
        x.closePath(); x.fill();
        if (dep === 2) {
          x.strokeStyle = 'hsla(34 60% 70% / 0.35)';          // two gores
          x.lineWidth = Math.max(1, r * 0.09);
          for (const m of [-0.45, 0.45]) {
            x.beginPath();
            x.moveTo(bx + r * m, by - r * 0.95);
            x.quadraticCurveTo(bx + r * m * 1.6, by, bx + r * m * 0.5, by + r * 1.2);
            x.stroke();
          }
          // THE BURNER. The one warm light up here, and what makes these read as
          // balloons rather than as circles. Deliberately wide, soft and
          // CORELESS: a gold mote is a small bright point inside a tight halo,
          // so this is built to be its opposite at every scale. Hue 26 is 24
          // degrees off gold and 34 off danger — it clears the same rule the
          // dust hue does, at half a mote's peak alpha and four times its width.
          const bgr = x.createRadialGradient(bx, by + r * 0.55, 0, bx, by + r * 0.55, r * 0.95);
          bgr.addColorStop(0, 'hsla(26 90% 60% / 0.30)');
          bgr.addColorStop(1, 'hsla(26 90% 60% / 0)');
          x.fillStyle = bgr;
          x.beginPath(); x.arc(bx, by + r * 0.55, r * 0.95, 0, TAU); x.fill();
        }
        x.fillStyle = 'hsla(250 30% 12% / 0.9)';              // basket on two lines
        x.fillRect(bx - r * 0.16, by + r * 1.5, r * 0.32, r * 0.24);
        x.strokeStyle = 'hsla(250 30% 12% / 0.8)'; x.lineWidth = 1;
        x.beginPath();
        x.moveTo(bx - r * 0.16, by + r * 1.24); x.lineTo(bx - r * 0.12, by + r * 1.5);
        x.moveTo(bx + r * 0.16, by + r * 1.24); x.lineTo(bx + r * 0.12, by + r * 1.5);
        x.stroke();
      }

      // 4. THE RIDGE — one filled path, three humps, and everything below it is
      //    flat and dark. That flatness is the readability argument: the whole
      //    lower two thirds of the frame, which is most of the corridor, has
      //    nothing in it.
      x.fillStyle = 'hsla(248 38% 9% / 0.95)';
      x.beginPath();
      x.moveTo(0, h * 0.36);
      x.quadraticCurveTo(w * 0.18, h * 0.30, w * 0.36, h * 0.35);
      x.quadraticCurveTo(w * 0.55, h * 0.40, w * 0.74, h * 0.33);
      x.quadraticCurveTo(w * 0.88, h * 0.29, w, h * 0.34);
      x.lineTo(w, h); x.lineTo(0, h); x.closePath(); x.fill();

      // 5. FAIRY CHIMNEYS — the silhouette that exists in no other world and in
      //    very few other games: a WAISTED cone (not a triangle) wearing a
      //    basalt cap WIDER than the neck it sits on. Nine, three depth tiers.
      //    Their caps break the ridge line into the amber band; their bodies go
      //    down into the dark.
      const CX = [0.05, 0.13, 0.22, 0.36, 0.44, 0.58, 0.71, 0.84, 0.94];
      const TIER = [2, 1, 2, 0, 1, 0, 2, 1, 0];       // 0 = nearest
      for (let i = 0; i < CX.length; i++) {
        const t = TIER[i];
        // Drafted at base 0.44-0.64h and ch up to 0.30h, which hung them halfway
        // down the screen in a lighter colour than the ridge -- pale wedges
        // standing in the corridor rather than a skyline behind it. Their feet
        // now sit just under the ridge line and only the caps rise into the
        // amber band; everything below 0.42h is flat dark.
        const base = h * (0.36 + 0.025 * (2 - t));
        const ch = h * (0.13 - 0.028 * t);
        const bw = h * (0.020 - 0.005 * t);
        const bx = w * CX[i];
        x.fillStyle = t === 0 ? 'hsla(248 35% 8% / 0.96)'
          : t === 1 ? 'hsla(249 32% 12% / 0.85)' : 'hsla(250 30% 15% / 0.70)';
        x.beginPath();
        x.moveTo(bx - bw, base);
        x.quadraticCurveTo(bx - bw * 0.35, base - ch * 0.55, bx - bw * 0.16, base - ch);
        x.lineTo(bx + bw * 0.16, base - ch);
        x.quadraticCurveTo(bx + bw * 0.35, base - ch * 0.55, bx + bw, base);
        x.closePath(); x.fill();
        x.beginPath();                                        // the hat
        x.ellipse(bx, base - ch * 1.02, bw * 0.52, bw * 0.20, 0.12, 0, TAU);
        x.fill();
      }
    },

  };

  class Background {
    constructor() { this.dots = []; this.blobs = []; this.t = 0; this.layer = null; this._layerKey = ''; }

    resize(W, H) {
      this.W = W; this.H = H;
      this.dots.length = 0;
      const n = Math.round((W * H) / 14000 * (LUMEN.Q ? LUMEN.Q.dust : 1));
      for (let i = 0; i < n; i++) {
        const depth = rand(0.15, 1);
        this.dots.push({ x: rand(0, W), y: rand(0, H), depth, r: lerp(0.6, 2.4, depth), tw: rand(0, TAU) });
      }
      this.blobs.length = 0;
      for (let i = 0; i < 4; i++) {
        this.blobs.push({ i, x: rand(0, W), y: rand(0, H), r: rand(H * 0.25, H * 0.55), hue: rand(230, 300) });
      }
      this.layer = null; // force a rebake at the new size
    }

    update(dt, scroll) {
      this.t += dt;
      const M = LUMEN.Cosmetics ? LUMEN.Cosmetics.mapDef() : null;
      if (M && M.dustMode === 'lift') {
        // Sparks RISE. The only dust in the game that goes against the fall, and
        // it is the world's second motion: the balloons behind it are baked and
        // still, so this is what makes the air move -- and it teaches ALOFT for
        // free, because up is where the air is going.
        const calm = calmVisuals() ? 0.5 : 1;
        for (const d of this.dots) {
          d.x -= scroll * d.depth * dt * 0.35;
          d.y -= (10 + 22 * d.depth) * dt * calm;
          d.tw += dt * (1.1 + d.depth) * calm;
          if (d.y < -6 || d.x < -6) { d.y = this.H + 6; d.x = rand(0, this.W + 40); }
        }
        return;
      }
      if (M && M.dustMode === 'petal') {
        // Petals FALL. They still ride the scroll a little so the world keeps
        // moving past, but the read is downward drift with a sideways sway —
        // sakura, not starfield.
        for (const d of this.dots) {
          d.x -= scroll * d.depth * dt * 0.45;
          d.y += (14 + 26 * d.depth) * dt;
          d.tw += dt * (1 + d.depth);
          if (d.y > this.H + 6 || d.x < -6) { d.y = -6; d.x = rand(0, this.W + 40); }
        }
        return;
      }
      for (const d of this.dots) {
        d.x -= scroll * d.depth * dt;
        if (d.x < -4) { d.x = this.W + 4; d.y = rand(0, this.H); }
        d.tw += dt * (1 + d.depth);
      }
    }

    // Bake gradient + nebula into a low-res layer. Only re-run on resize or when
    // the flow colour shifts a visible step (8 buckets across the whole range).
    _bake(flow) {
      const scale = 0.5;
      const w = Math.max(2, Math.round(this.W * scale));
      const h = Math.max(2, Math.round(this.H * scale));
      if (!this.layer) { this.layer = document.createElement('canvas'); }
      if (this.layer.width !== w || this.layer.height !== h) { this.layer.width = w; this.layer.height = h; }
      const x = this.layer.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, w, h);

      // the equipped map decides the environment; flow still shifts it toward violet
      const M = LUMEN.Cosmetics ? LUMEN.Cosmetics.mapDef() : null;
      if (M && M.sky) {
        // A map may paint its own sky: [stop, hue, sat, light] rows. This is
        // the one door out of the engine's near-black gradient — a sunset needs
        // real colour. The rows are authored against the SAME readability rule
        // as everything else: the lower half, where the game is actually
        // played, must stay dark enough that gates, motes and the orb keep
        // their contrast; the drama lives in the upper third.
        const g = x.createLinearGradient(0, 0, 0, h);
        for (const [stop, hh, ss, ll] of M.sky) {
          g.addColorStop(stop, `hsl(${lerp(hh, 292, flow * 0.5)} ${ss}% ${Math.max(3, ll - flow * 6)}%)`);
        }
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);
      } else {
        const baseA = M ? M.bg : 248, baseB = M ? M.bg2 : 254;
        const sat = M && M.mono ? 22 : 62;
        const bgHue = lerp(baseA, 292, flow), bgHue2 = lerp(baseB, 292, flow);
        const g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, `hsl(${bgHue} ${sat}% ${8 + flow * 5}%)`);
        g.addColorStop(0.45, `hsl(${bgHue2 + 6} ${sat + 6}% ${4 + flow * 2}%)`);
        g.addColorStop(1, `hsl(${bgHue - 10} ${sat - 2}% ${9 + flow * 5}%)`);
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);
      }

      if (!LUMEN.Q || LUMEN.Q.nebula) {
        x.globalCompositeOperation = 'lighter';
        for (const b of this.blobs) {
          const bx = b.x * scale, by = b.y * scale, br = b.r * scale;
          const rg = x.createRadialGradient(bx, by, 0, bx, by, br);
          const nebHues = M && M.neb ? M.neb : [250, 285];
          const nebBase = nebHues[b.i % nebHues.length];
          const bh = lerp(nebBase + (b.hue % 18), 305, flow * 0.7);
          const nebA = (M && M.nebA != null) ? M.nebA : 1;
          rg.addColorStop(0, `hsla(${bh} 75% 58% / ${(0.07 + flow * 0.07) * nebA})`);
          rg.addColorStop(1, 'hsla(0 0% 0% / 0)');
          x.fillStyle = rg;
          x.beginPath(); x.arc(bx, by, br, 0, TAU); x.fill();
        }
        x.globalCompositeOperation = 'source-over';
      }

      // the map's scenery, painted over gradient and nebula, still behind play
      if (M && M.scene && SCENES[M.scene]) SCENES[M.scene](x, w, h);
    }

    draw(ctx, hue, flow) {
      const { W, H } = this;
      const mapId = LUMEN.Cosmetics ? LUMEN.Cosmetics.mapDef().id : 'deepfield';
      const key = mapId + ':' + Math.round(flow * 8) + ':' + W + 'x' + H;
      if (!this.layer || this._layerKey !== key) { this._bake(flow); this._layerKey = key; }
      ctx.drawImage(this.layer, 0, 0, W, H);

      // parallax star-dust stays live — it's cheap and carries all the motion
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const MD = LUMEN.Cosmetics ? LUMEN.Cosmetics.mapDef() : null;
      if (MD && MD.dustMode === 'lift') {
        // A short warm lozenge and the tail it left, not a dot: two fillRects,
        // no path and no save/restore, which is CHEAPER than the arc+fill the
        // default does. One fillStyle for the whole field; depth rides alpha.
        ctx.fillStyle = `hsl(${lerp(MD.dust, 300, flow)} 90% ${72 + flow * 12}%)`;
        const sway = calmVisuals() ? 0 : 1;
        for (const d of this.dots) {
          const lx = d.x + Math.sin(d.tw * 1.1) * 5 * d.depth * sway;
          const bw = Math.max(1, d.r * 0.7), bh = d.r * 2.2;
          ctx.globalAlpha = d.depth * 0.8;
          ctx.fillRect(lx, d.y, bw, bh);
          ctx.globalAlpha = d.depth * 0.28;
          ctx.fillRect(lx, d.y + bh, bw, bh * 1.6);
        }
        ctx.restore();
        return;
      }
      if (MD && MD.dustMode === 'petal') {
        // each mote of dust is a petal: a pointed oval, tumbling as it sways
        for (const d of this.dots) {
          const sway = Math.sin(d.tw * 1.3) * 6 * d.depth;
          const sz = d.r * 2.1;
          ctx.globalAlpha = d.depth * 0.75;
          ctx.fillStyle = `hsl(${(MD.dust + (d.depth > 0.6 ? 10 : -6))} 85% ${76 + d.depth * 10}%)`;
          ctx.save();
          ctx.translate(d.x + sway, d.y);
          ctx.rotate(d.tw * 0.9);
          ctx.beginPath();
          ctx.moveTo(0, -sz);
          ctx.quadraticCurveTo(sz * 0.7, 0, 0, sz);
          ctx.quadraticCurveTo(-sz * 0.7, 0, 0, -sz);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      } else {
        ctx.fillStyle = `hsl(${lerp(MD ? MD.dust : 190, 300, flow)} 70% ${80 + flow * 15}%)`;
        for (const d of this.dots) {
          const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(d.tw));
          ctx.globalAlpha = d.depth * tw * 0.85;
          ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // ---- difficulty ----------------------------------------------------------
  // Multipliers on the three knobs that actually decide how hard a run is:
  // how wide the openings are, how much reaction time you get, and how often
  // gates arrive. `scoreMul` keeps the board honest — a harder run is worth more.
  const DIFFICULTY = {
    // VERY EASY is comfort, not a discount.
    //
    // It exists so somebody who wants to see the eleven worlds and the ten modes
    // can, without the reflex test in the way — so the openings are wide, the
    // corridor gives you time, and obstacles arrive further apart.
    //
    // But a run you can hold almost indefinitely must not also be the fastest
    // way to earn, or every price in the shop ends up set by the setting nobody
    // is meant to grind on. scoreMul alone cannot do that job: an easier run
    // simply lasts longer, so a smaller multiplier on a much bigger number can
    // come out AHEAD. shardMul is the second brake, applied to the payout only,
    // and this is the one difficulty that carries it — the others leave it
    // undefined, which reads as 1 and leaves their balance exactly as it was.
    //
    // `topSpeed` is a CEILING on how fast the orb may travel, as a fraction of
    // the 1770 px/s a free fall across the corridor would reach. It is the
    // answer to "the ball goes up and down too fast", and it is deliberately
    // not a gravity change.
    //
    // Gravity is what gets you to the next opening in time. Measured on a
    // 390x844 phone 150s into a Classic run, the worst gate already leaves only
    // 21% slack at NORMAL and 6% at HARD, so there is very little of it to
    // spend. Taking the peak down 44% by weakening gravity would stretch every
    // crossing by 79% and start serving openings the orb cannot physically
    // reach. The same 44% off the ceiling costs 17%, and costs it only on a
    // FULL crossing -- a 350px move, which is the 95th percentile of what the
    // corridor actually asks for, gets 3% slower. The first half of every fall,
    // where the short corrections live, is untouched: gravity is unchanged, so
    // a tap answers exactly as fast as it did.
    //
    // HARD leaves it undefined, which reads as 1 and means no ceiling at all.
    //
    // SECOND PASS. The first ceiling (0.56 / 0.65) was still too fast to the
    // people playing: "the ball goes up and down too quickly, very easy and easy
    // need to be easier still". Cutting the ceiling alone would have made the
    // two gentlest settings geometrically TIGHTER than NORMAL, which is the
    // wrong shape of fix -- a slower orb has less time to cross to the next
    // opening, so the room has to come from somewhere.
    //
    // So the speed cut is paid for with spacing. Measured against the real gate
    // generator over a 300 s run (worst reach margin over every gate, where 1.0
    // is "only just reachable" and bigger is more forgiving):
    //
    //             peak speed      full crossing     worst reach margin
    //   HARD        2.56 playH/s      0.78 s              1.44
    //   NORMAL      1.95              0.81                1.71
    //   EASY  was   1.67              0.85                1.99
    //         now   1.08              1.09                1.81
    //   V.EASY was  1.44              0.91                2.29
    //         now   0.97              1.17                1.93
    //
    // Both tiers get about a THIRD slower vertically, and both stay more
    // forgiving than NORMAL, which is the ordering that has to hold. Gravity is
    // still untouched everywhere: a tap answers on the next frame exactly as it
    // always did, the orb just stops winding up.
    //
    // Left alone deliberately: scoreMul/shardMul. Easier settings do produce
    // longer runs, and the balance note above is the reason to keep watching
    // that -- but quietly cutting a player's payout while telling them the game
    // got easier is its own kind of lie, so if the economy needs a brake it
    // should be a decision, not a side effect of this change.
    veryeasy: { gap: 1.45, react: 1.55, spawn: 1.60, scoreMul: 0.55, shardMul: 0.35, topSpeed: 0.38 },
    easy:   { gap: 1.28, react: 1.25, spawn: 1.40, scoreMul: 0.75, topSpeed: 0.42 },
    normal: { gap: 1.00, react: 1.00, spawn: 1.00, scoreMul: 1.00, topSpeed: 0.76 },
    hard:   { gap: 0.84, react: 0.84, spawn: 0.88, scoreMul: 1.40 },
  };
  LUMEN.DIFFICULTY = DIFFICULTY;

  // ---- colour-vision palettes ----------------------------------------------
  // The game's whole read is "hero vs reward vs danger". Each preset re-hues the
  // reward/danger pair onto an axis the given deficiency can still separate, and
  // shape stays the backup channel (motes are diamonds, power-ups hexagons,
  // hazards long bars) so colour is never the only signal.
  // ---- themed orb decorations ---------------------------------------------
  // One small draw function per theme, keyed by the skin's `deco` field. Each
  // gets (ctx, r, hue, game) with the origin at the orb's centre, +y toward the
  // orb's own "down", squash already applied. Filled in per theme pack.
  const DECOS = {
    // Every function draws with the origin at the orb's centre, distances in
    // units of r, squash and the gravity mirror already applied: -y is the way
    // up FEELS. Silhouettes, not pictures — at 28px anything past a handful of
    // primitives is noise.

    // Cat ears. Outer triangles only: the review cut the inner-ear pair, which
    // at 14px read as holes punched in the silhouette rather than depth.
    whisker(ctx, r, hue, game) {
      const sk = LUMEN.Cosmetics ? LUMEN.Cosmetics.skinDef() : { sat: 85, light: 62 };
      const dark = `hsl(${hue} ${sk.sat}% ${Math.max(20, (sk.light || 62) - 12)}%)`;
      const t = game ? game.elapsed : 0;
      // EARS, with pink inner ears. The first pass cut the inner pair as noise;
      // the owner's answer was that this should be A CAT, not a hint of one —
      // so the face earns its primitives and the inner ear is part of the read.
      for (const m of [-1, 1]) {
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(m * 0.80 * r, -0.38 * r);
        ctx.lineTo(m * 0.14 * r, -0.82 * r);
        ctx.lineTo(m * 0.68 * r, -1.34 * r);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'hsl(345 75% 74% / 0.9)';
        ctx.beginPath();
        ctx.moveTo(m * 0.62 * r, -0.62 * r);
        ctx.lineTo(m * 0.34 * r, -0.80 * r);
        ctx.lineTo(m * 0.58 * r, -1.10 * r);
        ctx.closePath(); ctx.fill();
      }
      // EYES that actually blink: almond shapes with tall cat pupils, closing
      // to a happy line for a beat every few seconds. The blink phases are
      // offset from the whisker wobble so the face never moves all at once.
      const cycle = t % 3.4;
      const blink = cycle > 3.22 ? Math.max(0.08, 1 - (cycle - 3.22) / 0.06) : 1;
      for (const m of [-1, 1]) {
        ctx.fillStyle = 'hsl(25 55% 16%)';
        ctx.beginPath();
        ctx.ellipse(m * 0.36 * r, -0.12 * r, 0.155 * r, 0.24 * r * blink, 0, 0, TAU);
        ctx.fill();
        if (blink > 0.5) {
          // the shine that makes an eye an eye
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.beginPath();
          ctx.arc(m * 0.31 * r, -0.20 * r, 0.05 * r, 0, TAU); ctx.fill();
        }
      }
      // NOSE + MOUTH: a small pink triangle and the classic "w".
      ctx.fillStyle = 'hsl(345 80% 66%)';
      ctx.beginPath();
      ctx.moveTo(-0.09 * r, 0.16 * r); ctx.lineTo(0.09 * r, 0.16 * r); ctx.lineTo(0, 0.30 * r);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'hsl(25 55% 22%)';
      ctx.lineWidth = Math.max(1, 0.05 * r);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0.30 * r);
      ctx.quadraticCurveTo(-0.12 * r, 0.46 * r, -0.24 * r, 0.38 * r);
      ctx.moveTo(0, 0.30 * r);
      ctx.quadraticCurveTo(0.12 * r, 0.46 * r, 0.24 * r, 0.38 * r);
      ctx.stroke();
      // TAIL: swishing behind the orb, the one part of a cat that never sits
      // still. Drawn first of the face parts it is under everything else.
      // CHEEK BLUSH: two soft pink ovals — the single cheapest unit of cute
      // this face has.
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(1.5, 0.22 * r);
      ctx.lineCap = 'round';
      const swish = Math.sin(t * 1.7) * 0.35;
      ctx.beginPath();
      ctx.moveTo(-0.7 * r, 0.6 * r);
      ctx.quadraticCurveTo(-1.5 * r, 0.9 * r + swish * r, -1.7 * r, 0.1 * r + swish * 1.6 * r);
      ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(-1.7 * r, 0.1 * r + swish * 1.6 * r, 0.13 * r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'hsla(348 85% 72% / 0.55)';
      for (const m of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(m * 0.52 * r, 0.14 * r, 0.14 * r, 0.09 * r, 0, 0, TAU);
        ctx.fill();
      }
      // WHISKERS, three a side, with a slow wobble so the face is alive even
      // between blinks.
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(1, 0.045 * r);
      const wob = Math.sin(t * 2.1) * 0.05 * r;
      for (const m of [-1, 1]) {
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(m * 0.42 * r, (0.16 + i * 0.10) * r);
          ctx.quadraticCurveTo(m * 0.95 * r, (0.10 + i * 0.16) * r,
            m * 1.38 * r, (0.02 + i * 0.22) * r + wob * i);
          ctx.stroke();
        }
      }
    },

    // A hachimaki: band, knot, two streaming tails, one dark pin on the brow.
    sakura(ctx, r, hue, game) {
      const t = game ? game.elapsed : 0;
      ctx.strokeStyle = '#fff';
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 0.26 * r;
      // 1.12r, not 1.0r: at game size a band hugging the rim fused with the
      // white core into one blob. The gap is what keeps it a headband.
      ctx.beginPath(); ctx.arc(0, 0, 1.12 * r, -2.85, -0.30); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-0.95 * r, -0.42 * r, 0.17 * r, 0, TAU); ctx.fill();
      // tails flutter in antiphase; 0.18r of travel — the spec's 0.08r was one
      // pixel and read as a still image.
      const fl = Math.sin(t * 6) * 0.18 * r;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(-1.05 * r, -0.40 * r); ctx.lineTo(-2.0 * r, -0.28 * r + fl); ctx.lineTo(-1.15 * r, -0.62 * r);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-1.05 * r, -0.52 * r); ctx.lineTo(-1.8 * r, -0.95 * r - fl); ctx.lineTo(-1.2 * r, -0.72 * r);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'hsl(248 45% 20%)';
      ctx.beginPath(); ctx.arc(0, -1.12 * r, 0.22 * r, 0, TAU); ctx.fill();
    },

    // A ringed wanderer: tilted ring in two arcs so it passes behind the orb,
    // and one small moon. Ring lightness 80 keeps contrast across the core.
    cosmos(ctx, r, hue) {
      ctx.strokeStyle = `hsl(${hue} 70% 80%)`;
      ctx.lineWidth = 0.17 * r;
      ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.ellipse(0, 0, 1.50 * r, 0.48 * r, -0.32, Math.PI * 0.06, Math.PI * 0.94); ctx.stroke();
      ctx.lineWidth = 0.12 * r;
      ctx.globalAlpha = 0.38;
      ctx.beginPath(); ctx.ellipse(0, 0, 1.50 * r, 0.48 * r, -0.32, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = `hsl(${(hue + 40) % 360} 30% 88%)`;
      // 0.20r, sized to survive the 9px minimum orb radius
      ctx.beginPath(); ctx.arc(1.15 * r, -0.95 * r, 0.20 * r, 0, TAU); ctx.fill();
    },

    // The banded synthwave sun. Two slits, not three: on the Low profile's 9px
    // orb three 1px bands smeared into grey; two thick ones stay bands.
    sundown(ctx, r) {
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, 1.02 * r, 0, TAU); ctx.clip();
      ctx.fillStyle = 'rgba(8,4,20,0.9)';
      ctx.fillRect(-1.15 * r, 0.30 * r, 2.3 * r, Math.max(0.16 * r, 1.5));
      ctx.fillRect(-1.15 * r, 0.62 * r, 2.3 * r, Math.max(0.22 * r, 2));
      ctx.restore();
    },

    // A sheet ghost: scalloped hem hanging into the fall, two dark eyes.
    wraith(ctx, r, hue) {
      ctx.fillStyle = `hsl(${hue} 45% 90% / 0.85)`;
      ctx.beginPath();
      ctx.moveTo(-0.95 * r, 0.35 * r);
      ctx.lineTo(0.95 * r, 0.35 * r);
      // tips at 1.60r — the spec's 1.30r cleared the halo by two pixels
      ctx.quadraticCurveTo(0.78 * r, 0.85 * r, 0.55 * r, 1.60 * r);
      ctx.quadraticCurveTo(0.28 * r, 1.35 * r, 0, 1.38 * r);
      ctx.quadraticCurveTo(-0.28 * r, 1.35 * r, -0.55 * r, 1.60 * r);
      ctx.quadraticCurveTo(-0.78 * r, 0.85 * r, -0.95 * r, 0.35 * r);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'hsl(250 40% 12% / 0.9)';
      for (const m of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(m * 0.33 * r, -0.16 * r, 0.13 * r, 0.24 * r, 0, 0, TAU); ctx.fill();
      }
    },

    // Dragon: lacquer horns and two bright whiskers. You ARE the loong — the
    // trail is your body, not a creature chasing you.
    moonpearl(ctx, r, hue, game) {
      const t = game ? game.elapsed : 0;
      ctx.fillStyle = `hsl(${hue} 90% 30%)`;
      ctx.globalAlpha = 0.95;
      for (const m of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(m * 0.66 * r, -0.72 * r);
        ctx.lineTo(m * 0.26 * r, -0.90 * r);
        ctx.lineTo(m * 0.58 * r, -1.42 * r);
        ctx.closePath(); ctx.fill();
      }
      // whiskers: 0.17r wide and light 85 — the first draft's gold hairlines
      // vanished into the orb's own gold halo.
      ctx.strokeStyle = `hsl(${(hue + 18) % 360} 95% 85%)`;
      ctx.lineWidth = Math.max(1, 0.17 * r);
      ctx.lineCap = 'round';
      const wob = Math.sin(t * 5) * 0.1 * r;
      for (const m of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(m * 0.7 * r, 0.25 * r);
        ctx.quadraticCurveTo(m * 1.5 * r, 0.35 * r + wob, m * 1.9 * r, 0.05 * r + wob);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };
  // Exposed for one reason: the test that proves every skin declaring a `deco`
  // has a draw function here. The guard in drawPlayer skips an unknown deco
  // SILENTLY, which is right at runtime and exactly the failure a catalogue
  // edit would otherwise ship unnoticed. (And it must sit AFTER the table:
  // attached next to LUMEN.DIFFICULTY it ran before `const DECOS` existed and
  // took the whole module down — every test failed at once, which is at least
  // the loud version of the mistake.)
  LUMEN.DECOS = DECOS;


  const CB_PALETTES = {
    off:    { reward: 50,  danger: 350 },   // red = stop; nudged apart from the gold reward
    deuter: { reward: 52,  danger: 288 }, // red-green: lean on the blue↔yellow axis
    prot:   { reward: 56,  danger: 276 },
    trit:   { reward: 128, danger: 352 }, // blue-yellow: lean on the red↔green axis
  };
  function cbPalette() {
    return CB_PALETTES[LUMEN.Store ? LUMEN.Store.colorblind : 'off'] || CB_PALETTES.off;
  }
  // The shop draws its own little scene of a map, and it was drawing the gates
  // in the map's `wall` hue -- a colour the game never puts on a gate. Gates are
  // ALWAYS the danger hue, in every world, because that is the one promise the
  // colour-vision presets make. So the shop was advertising a green world and
  // handing over a red one. Exported so the swatch can ask the same question the
  // renderer asks instead of guessing.
  LUMEN.cbPalette = cbPalette;

  // The CSS honoured prefers-reduced-motion but the canvas ignored it, so shake
  // and full-screen flashes still fired for people who asked for neither.
  let prefersReducedMotion = false;
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = mq.matches;
    const onMq = () => { prefersReducedMotion = mq.matches; };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    else if (mq.addListener) mq.addListener(onMq);
  } catch (e) {}
  function calmVisuals() {
    if (prefersReducedMotion) return true;
    if (LUMEN.Store && LUMEN.Store.reduceFlash) return true;
    // A mode can ask for it too. Zen has declared `calm: true` — "no shake, no
    // damage flash, gentle audio" — since it was written, and nothing ever read
    // the flag, so the calm mode shook and flashed exactly like Sprint.
    try {
      // The mode being PLAYED, not the one highlighted in the menu. A daily
      // resolves its own mode from the day's twist and never writes Store.mode,
      // so asking Modes.current() meant a player whose last pick was Zen carried
      // Zen's calm into the daily: Blackout dimmed to 0.43 instead of 0.965 and
      // Vortex tilted a quarter as far. Two people on the same seeded course,
      // one of them playing a visibly easier version of it, both posting to the
      // same board.
      const g = LUMEN.game;
      const m = (g && g.state !== State.MENU && g.mode)
        ? g.mode
        : (LUMEN.Modes && LUMEN.Modes.current());
      if (m && m.calm) return true;
    } catch (e) { /* Modes may not be loaded yet */ }
    return false;
  }
  LUMEN.calmVisuals = calmVisuals;

  // ---- power-ups -----------------------------------------------------------
  // Rare pickups that ride inside a gap. Each one rewards the same greedy line
  // the combo system already encourages, so they add depth without new inputs.
  // What can spawn in the world. Deliberately still the original three: the daily
  // challenge's seeded stream is built from this list, so adding to it would
  // change everybody's course.
  const POWER_TYPES = ['magnet', 'shield', 'slow'];
  const POWER_DEF = {
    magnet: { dur: 7,  hue: 150, glyph: 'M', label: 'MAGNET' },
    shield: { dur: 0,  hue: 195, glyph: 'S', label: 'SHIELD' },  // lasts until it's spent
    slow:   { dur: 5,  hue: 265, glyph: 'T', label: 'SLOW' },
    scout:  { dur: 8,  hue: 55,  glyph: 'V', label: 'SCOUT' },   // see the line through
    anchor: { dur: 6,  hue: 210, glyph: 'A', label: 'ANCHOR' },  // half gravity
    spark:  { dur: 0,  hue: 330, glyph: 'C', label: 'SPARK' },   // instant: chain back
  };
  // Everything you can hold, including the three the shop sells but the world
  // never drops.
  const ITEM_TYPES = ['magnet', 'shield', 'slow', 'scout', 'anchor', 'spark'];
  // The shop draws the same icons this file does. It used to keep its own copy of
  // the colours and letters, which covered only the original three items — so
  // every item added after that rendered as "undefined" with a blank disc.
  // One table, one owner.
  LUMEN.POWER_DEF = POWER_DEF;
  LUMEN.ITEM_TYPES = ITEM_TYPES;

  // ---- traps -----------------------------------------------------------------
  // Free-standing hazards that live BETWEEN gates, so they test something the
  // gates cannot: holding a line, not just hitting a hole.
  //
  // Every one obeys the same three rules the gates do, because a trap that
  // breaks them is not difficulty, it is a bug the player experiences as unfair:
  //   1. It is always red, and always drawn before it can kill you.
  //   2. It is never placed where dodging it is impossible.
  //   3. It never sits on top of something you are meant to collect.
  const TRAP = {
    // A beam that crosses the corridor vertically. You go over it or under it.
    sweeper: { arm: 0.9, h: 0.018 },
    // A stationary node in open space. Pure spacing test.
    mine:    { arm: 0.6, r: 0.030 },
    // A stretch of wall that is lethal to touch — forces you off one side.
    spikes:  { arm: 0.7, len: 0.42 },
  };

  // Each world sings in its own key — semitones up from the base progression.
  // Chosen to match the palette: Emberfall runs warm and bright, Tidal and
  // Monolith sit low and cold, Solaris is the tense one.
  const MAP_KEY = {
    deepfield: 0, emberfall: 5, tidal: -3, moss: 2, monolith: -5, solaris: 8,
  };

  // ---- tutorial ------------------------------------------------------------
  // A guided, un-losable warm-up. Each stage introduces exactly one idea and
  // won't advance until the player has actually done it — crashing here only
  // costs a nudge and a hint, never the run.
  // The rules never change between modes, so the first four lessons are the same
  // everywhere. What changes is the LAST one: each mode gets its own briefing on
  // what it does differently, taught in that mode's own conditions rather than
  // described in a menu. Classic's final lesson is the send-off it always was.
  const TUT_STAGES = [
    { id: 'flip',   k: 'tut1', goal: 4, unitKey: 'flips' },
    { id: 'thread', k: 'tut2', goal: 4, unitKey: 'gates' },
    { id: 'motes',  k: 'tut3', goal: 5, unitKey: 'motes' },
    { id: 'combo',  k: 'tut4', goal: 8, unitKey: 'combo' },
    { id: 'mode',   k: 'tutm', goal: 6, unitKey: 'gates' },   // key is swapped per mode
    { id: 'done',   k: 'tut5', goal: 1, unitKey: '' },
  ];

  // ---- main game -----------------------------------------------------------
  const State = { MENU: 'menu', PLAY: 'play', PAUSE: 'pause', DEAD: 'dead' };

  // Reads a CSS environment inset into a number, every time it is asked.
  //
  // The first version cached the answer, and that is precisely why the score
  // stayed under the notch after it was "fixed": the first call happens inside
  // resize(), which can run before the document has laid out, so it measured 0 —
  // and then kept serving that 0 for the life of the page. A cache whose first
  // entry is wrong is worse than no cache, because it hides the fix.
  //
  // resize() is not a hot path (a rotation, a URL bar collapsing), so one
  // getComputedStyle per call costs nothing worth protecting.
  let _insetEl = null;
  function readInset(side) {
    try {
      if (!document.body) return 0;
      if (!_insetEl || !_insetEl.isConnected) {
        _insetEl = document.createElement('div');
        _insetEl.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;'
          + 'pointer-events:none;padding-top:env(safe-area-inset-top);'
          + 'padding-bottom:env(safe-area-inset-bottom)';
        document.body.appendChild(_insetEl);
      }
      const cs = getComputedStyle(_insetEl);
      return parseFloat(side === 'top' ? cs.paddingTop : cs.paddingBottom) || 0;
    } catch (e) { return 0; }
  }

  // The top inset to actually draw below — measured, but floored to what a tall
  // phone needs whether or not the measurement agrees.
  //
  // Removing the cache above was necessary and still not sufficient: a WKWebView
  // does not always have viewport-fit resolved when the game first sizes itself,
  // and until it does env(safe-area-inset-top) reports 0 underneath a Dynamic
  // Island that is very much there. Three builds in a row "fixed" this and the
  // score kept coming back clipped, because every fix trusted that zero.
  //
  // A reading can be wrong in only one direction here, so stop trusting it in
  // that direction: on a portrait phone-shaped viewport take the worst case as a
  // floor (~59pt on the tallest islands, 47 on older notches; H*0.072 clears
  // both with slack). Landscape and desktop keep the measurement, where it is
  // both correct and the only thing that knows about an inset at all.
  function safeTopFor(W, H) {
    const measured = readInset('top');
    // 0.069, so a device that reports its REAL inset wins. The floor exists for
    // the WKWebView that answers 0 before viewport-fit resolves; setting it
    // above the true value (59pt on a Dynamic Island) meant the floor, not the
    // phone, decided where the score sat.
    return H > W * 1.7 ? Math.max(measured, H * 0.069) : measured;
  }

  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      // resize() owns this; the default only guards the window before the
      // first resize, where a hit rect built from it would come out NaN.
      this.stageX = 0;
      this.particles = new Particles();
      this.rings = new Rings();
      this.texts = new FloatingTexts();
      this.bg = new Background();
      this.state = State.MENU;
      this.last = 0;
      this.shake = 0;
      this.flash = 0;         // white flash amount
      this.damageFlash = 0;   // red flash
      this.timeScale = 1;
      this.timeScaleTarget = 1;
      this.hueBase = 190;
      this.CROSS_TIME = 0.78; // seconds to fall wall-to-wall (higher = floatier / more forgiving)
      this.flow = 0;          // 0..1 smoothed flow amount
      this.modalOpen = false; // true while a menu-level modal (shop) is open
      this._bind();
      this.resize();
      this.reset();
    }

    // ---- setup -----------------------------------------------------------
    // `forceW`/`forceH` are for tests and for headless tools: they pin the
    // playfield to a given size instead of whatever window this happens to run
    // in. They used to be accepted and IGNORED — the tests passed 900x600 and
    // silently measured the real browser window, so every "at every viewport"
    // assertion in the suite was really one viewport, the tester's.
    resize(forceW, forceH) {
      // A hidden tab or a not-yet-laid-out iframe reports 0x0. Never leave the game
      // with undefined dimensions (that would poison every later calculation with
      // NaN) — fall back through the document, then to a sane default, and let a
      // later resize correct it once the real viewport exists.
      const d = document.documentElement;
      let w = forceW || window.innerWidth || (d && d.clientWidth) || this.W || 360;
      const h = forceH || window.innerHeight || (d && d.clientHeight) || this.H || 640;
      // Cap the backing-store resolution. A 4K fullscreen canvas at dpr 2 is 14.7M
      // pixels; every full-screen pass pays for all of them. For a glow-heavy neon
      // look the visual difference above ~1.5x is negligible, the cost is not.
      const q = LUMEN.Q || QUALITY.balanced;
      let maxDpr = q.maxDpr;
      if (w * h > 2600000) maxDpr = Math.min(maxDpr, 1.25);       // >~4K logical area
      else if (w * h > 1500000) maxDpr = Math.min(maxDpr, 1.5);   // >~1440p
      const dpr = (this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, maxDpr)));
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const prevW = this.W, prevTop = this.playTop, prevH = this.playH;
      // ---- the stage ---------------------------------------------------------
      // A wide screen gets a phone-shaped COLUMN, not a corridor stretched to
      // fill it. The backdrop still covers the glass; the game does not.
      //
      // Letting the playfield take the whole width looks like device support and
      // is not: the orb's radius comes from min(H, W*1.5) capped at 19px, which
      // on both iPads hits the cap, so the orb shrinks from 5.1% of the width to
      // 3.7%, and to 2.5% in landscape. Scaling the orb up instead is worse —
      // the openings are a fraction of a play HEIGHT that a landscape tablet
      // does not have, so the gap falls from 11.4 orb-diameters to 4.4 and the
      // game silently becomes a different, much harder one.
      //
      // Fixing the aspect fixes both at once: every device draws the same game
      // at the same proportions, and the only thing that changes is how much sky
      // is visible beside it. 0.62 is a shade wider than an iPhone's 0.46 so a
      // phone is never letterboxed — on a phone stageX is 0 and nothing moves.
      this.viewW = w;
      const sw = Math.min(w, h * 0.62);
      this.stageX = Math.round((w - sw) / 2);
      this.W = sw; this.H = h;
      w = sw;
      // The overlays in index.html respect env(safe-area-inset-*). The CANVAS
      // never did — and the score is drawn on the canvas, at H * 0.018, which on
      // a 844px screen is 15px from the top: underneath the notch. Half the
      // number was simply not there, and no amount of CSS was going to reach it.
      //
      // env() is not available to canvas maths, so measure it: a probe element
      // whose padding IS the inset, read back through getComputedStyle.
      this.safeTop = safeTopFor(w, h);
      this.safeBottom = readInset('bottom');
      // 0.072, not 0.085. With the notch inset finally being respected the band
      // was measured twice: once by me and once by the person playing, who said
      // there was too much empty room above the corridor. This is as far up as
      // it goes — the score's own glyphs end at safeTop + H*0.012 + the 51px
      // font, which lands within a pixel or two of here.
      this.playTop = this.safeTop + h * 0.058;
      this.playBottom = h * 0.945 - this.safeBottom * 0.5;
      this.playH = this.playBottom - this.playTop;
      this.bg.resize(this.viewW, h);   // the sky fills the glass, not the column
      this._vigKey = null; // vignette sprites are size-specific
      if (this.player) {
        this.player.x = w * 0.30;
        this.player.baseR = this.orbR;
        this.player.r = this.player.baseR;
        // keep the orb at the same relative height (e.g. iOS URL bar collapsing mid-run)
        if (prevH > 0) {
          const f = clamp((this.player.y - prevTop) / prevH, 0, 1);
          this.player.y = clamp(this.playTop + f * this.playH, this.playTop + this.player.r, this.playBottom - this.player.r);
          this.player.trail.length = 0;
        }
      }
      // Re-lay in-flight obstacles: they hold fractions, so they stay fair after a
      // resize instead of stranding a gap outside the new playfield.
      if (this.obstacles && prevW > 0) {
        const sx = w / prevW;
        for (const ob of this.obstacles) { ob.x *= sx; this.layoutObstacle(ob); }
        for (const m of this.motes) {
          if (m.ob) { m.x = m.ob.x + m.ob.w * 0.5; m.y = m.gap ? m.gap.y : m.ob.baseGapY; }
          else { m.x *= sx; if (prevH > 0) m.y = this.playTop + clamp((m.y - prevTop) / prevH, 0, 1) * this.playH; }
          // the same radius spawnFreeMote and the gate motes use — this used to
          // say 0.8 and quietly shrank every mote on screen after a resize
          m.r = this.player ? (this.player.baseR || this.player.r) * 0.85 : m.r;
        }
        // Traps were left out of this entirely, so they kept their old absolute
        // x and their old pixel geometry while every gate around them moved.
        // Narrowing the window slid a gate from x=1000 to x=700 and left a mine
        // sitting at x=700 — a trap dropped on top of an opening that spawnTrap
        // had deliberately placed clear of one. Hallowmere runs traps from the
        // first seconds of a run, so this is reachable by resizing the window
        // (or by iOS collapsing its URL bar, which this path exists to handle).
        for (const t of this.traps || []) {
          t.x *= sx;
          if (prevH > 0) t.y = this.playTop + clamp((t.y - prevTop) / prevH, 0, 1) * this.playH;
          if (t.kind === 'sweeper') {
            t.h = this.playH * TRAP.sweeper.h;
            t.w = w * 0.5;
            if (prevH > 0) t.vy *= this.playH / prevH;
          } else if (t.kind === 'mine') {
            t.r = this.playH * TRAP.mine.r;
          } else {
            t.w = w * TRAP.spikes.len;
            t.h = this.playH * 0.035;
          }
        }
      }
    }

    reset() {
      this.rng = Math.random;     // swapped for a seeded PRNG in daily mode
      this.daily = false;
      this.attract = false;       // callers that want the demo re-arm it after
      // The seasonal preview belongs to the menu demo and nothing else. Clearing
      // it here covers every path at once — a real run, the daily, leaving the
      // demo — because they all reset first; startAttract re-arms it afterwards.
      if (LUMEN.Cosmetics) LUMEN.Cosmetics.setPreview(null);
      // A fresh run starts clean — but if god mode is still switched on it is
      // already tainted, because it will be a cheated run from the first frame.
      this.cheated = !!(LUMEN.Cheats && LUMEN.Cheats.available && LUMEN.Cheats.god);
      this.tutorial = false;
      this.tut = null;
      this.tutBanner = 0;         // pop animation when a stage is cleared
      this.elapsed = 0;
      this.distance = 0;
      this.score = 0;
      this.displayScore = 0;
      this.combo = 0;
      this.comboTimer = 0;
      this.comboTimerMax = 3.6;
      this.bestComboRun = 0;
      this.motesRun = 0;
      this.obstacles = [];
      this.motes = [];
      this.powers = [];                 // pickups on the field
      // Items you hold and fire by hand. Filled from shop stock at run start and
      // topped up by pickups when auto-use is off.
      this.hand = {};
      for (const t of ITEM_TYPES) this.hand[t] = 0;
      // How many of the held items were FOUND rather than bought. Without this
      // the hand is just a count, and useItem cannot tell a corridor pickup from
      // shop stock — so a free shield picked up mid-run debited a shield the
      // player had paid for. Worst in the daily, which deliberately brings no
      // loadout at all: every item used there was free, and every one of them
      // was billed to the shop inventory.
      this.handFree = {};
      for (const t of ITEM_TYPES) this.handFree[t] = 0;
      this.lastChain = 0;         // what SPARK restores: the chain you just lost
      this.bumps = 0;             // Zen has no score, so it counts crashes instead
      this.bountyTimer = this.rrand(12, 20);   // first bounty is never instant
      this._itemRects = null;
      this.fx = { magnet: 0, slow: 0, scout: 0, anchor: 0 }; // remaining seconds per timed effect
      this.shield = false;              // absorbs exactly one hit
      this.hasFlipped = false;    // drives the first-run "tap to flip" hint
      this.spawnTimer = 1.1;      // lead-in before first obstacle
      this.moteTimer = 0.5;
      this.lastC = 0.5;          // last gap centre, as a fraction of the playfield
      this.spawnIndex = 0;       // index into `plan` for daily runs
      this.plan = null;
      this.flowActive = false;
      this.flowSecRun = 0;
      this.flowFuel = this.FLOW_MAX;   // seconds of bullet-time in the tank
      this.world = (LUMEN.Cosmetics && !this.daily) ? LUMEN.Cosmetics.mapDef() : null;
      this.traps = [];
      this.trapTimer = (this.world && this.world.traps) ? this.rrand(1.5, 3.5) : this.rrand(14, 22);
      // A Daily can turn traps on for the day. Only startDaily ever wrote this,
      // and nothing ever cleared it — so after one traps-Daily every ordinary
      // run for the rest of the session quietly had traps too, arriving at 14
      // seconds instead of 35. State a run owns has to die with the run.
      this.mutator = 'none';
      this.nearMissRun = 0;
      // The daily is one shared course — it always runs at Normal, or a player on
      // Easy would be posting scores against a different game.
      this.diff = DIFFICULTY[this.daily ? 'normal' : (Store.difficulty || 'normal')] || DIFFICULTY.normal;
      this.resolveMode();
      this.applyMods();
      this.revived = false;      // one paid revive per run
      this.adRevived = false;    // …and one on an ad, separately
      this.invuln = 0;           // seconds of post-revive grace
      this._finalized = false;   // guards against double-recording a run
      this.flow = 0;
      this.timeScale = 1; this.timeScaleTarget = 1;
      this.particles.clear();
      this.rings.clear();
      this.texts.clear();
      this.player = {
        x: this.W * 0.30,
        y: this.playTop + this.playH * 0.5,
        vy: 0,
        dir: 1,                    // gravity direction: +1 down / -1 up
        r: clamp(this.H * 0.017, 10, 19),
        baseR: this.orbR,
        sx: 1, sy: 1,              // squash scale
        trail: [],
        alive: true,
      };
    }

    // ---- difficulty knobs ------------------------------------------------
    // Which mode this run is in. The Daily and the tutorial are always CLASSIC:
    // the daily is one shared course, and you cannot teach the rules through a
    // mode that bends them.
    //
    // This has to be callable AFTER `reset()`, because startDaily/startTutorial
    // set their flags once reset has already run — resolving only inside reset()
    // meant a player who had picked Sprint played the daily in Sprint.
    // True only while the tutorial is on its final, mode-specific lesson.
    get tutTeachingMode() {
      if (!this.tutorial || !this.tut) return false;
      const raw = TUT_STAGES[this.tut.stage];
      return !!raw && raw.id === 'mode' && !!this.tutMode && this.tutMode !== 'classic';
    }

    resolveMode() {
      if (!LUMEN.Modes) { this.mode = null; return; }
      // The tutorial teaches the BASICS under Classic — you cannot learn to read
      // a corridor through a mode that bends it. But its last lesson is the
      // player's own mode, and that lesson has to actually BE that mode: a
      // briefing that says "the light comes in pulses" over a fully lit Classic
      // corridor teaches nothing, it just makes a claim.
      //
      // The DAILY gets the day's own mode — everybody plays the same unusual
      // thing, which is the point of a shared challenge.
      this.mode = this.tutorial ? LUMEN.Modes.def(this.tutTeachingMode ? this.tutMode : 'classic')
        : this.daily ? LUMEN.Modes.def((LUMEN.Daily ? LUMEN.Daily.twist().mode : 'classic'))
        : LUMEN.Modes.current();
      // Sprint refuses to give you a gentle opening: it starts where a Classic
      // run would already be twenty seconds in.
      this.elapsed = this.mode.headStart || 0;
      // The world's own rules, resolved here for the same reason the mode is:
      // `daily` is not set yet when reset() runs. The Daily always flies Deep
      // Field, so a shared course can never depend on what somebody owns.
      this.world = (LUMEN.Cosmetics && !this.daily) ? LUMEN.Cosmetics.mapDef() : null;
      // BRITTLE's two meters are per-RUN state, and this is the one function
      // that runs after every path has decided which mode this is — reset,
      // startDaily, startTutorial, tutAdvance and startAttract all reach it.
      // `elapsed` is re-written three lines up for exactly the same reason;
      // putting them in reset() would be wrong, because reset() runs before the
      // daily and tutorial flags exist.
      //
      // Never write run state onto `this.mode`: Modes.def() hands back the
      // shared table literal, and it would leak into the next run.
      const flt = this.mode && this.mode.fault;
      this.nerve = flt ? flt.start : 0;
      this.heat = 0;
      // ALOFT's wind is per-RUN state, and this is the one function every entry
      // path reaches after the mode is known. Opens at 1 -- the calm line -- and
      // eases to whatever your altitude asks for over 0.30s.
      this.wind = 1;
      this.held = false;   // HOLD: never inherit a thumb from the last run
    }

    // How long a single flow can last. Long enough to feel like a reward,
    // short enough that it is a moment rather than a mode.
    get FLOW_MAX() { return 4.5; }

    // Traps join the run once the basics have stopped being the problem — or
    // immediately, if the day is a trap day.
    get trapsOn() {
      if (this.tutorial || this.attract) return false;
      if (this.world && this.world.traps) return true;   // a haunted world, from the whistle
      if (this.mutator === 'traps') return true;
      return this.elapsed > 35;
    }

    // The DIFFICULTY clock, which is NOT the run clock.
    //
    // `elapsed` is also the time-survived stat — finalizeRun subtracts
    // headStart from it — so a mode that wants to push the corridor forward
    // must push HERE and never there. Three getters computed this same product
    // independently and a fourth copy sat in the spawn call; this codebase
    // already has three drifted copies of the gravity constant, which is the
    // argument against a fifth of anything.
    //
    // `heat` is 0 (undefined) in every mode but BRITTLE, so this is
    // byte-identical for the other ten.
    get rampT() {
      return this.elapsed * (this.mode ? this.mode.ramp : 1) + (this.heat || 0);
    }

    // The orb's top speed, and the seconds a full crossing actually takes.
    //
    // Players did not report the game being hard, they reported the ORB being
    // too fast up and down. Those are different complaints and they have
    // different fixes. Free fall across the corridor peaks at 2*playH/CROSS_TIME
    // -- about 1770 px/s on a phone -- and that peak is the whip they are
    // describing. Lowering gravity would take it down, but gravity is also what
    // gets you to the next opening in time: dropping the peak 44% that way
    // stretches every crossing by 79%, and the corridor starts serving gaps the
    // orb cannot reach. A CEILING on the speed drops the same 44% for 17%,
    // because it only touches the tail of a long fall and leaves the first half
    // -- where the short corrections live -- exactly as responsive as before.
    //
    // Closed form, with k = topSpeed: the crossing takes CROSS_TIME*(1+k^2)/2k.
    get vMax() {
      const k = (this.diff && this.diff.topSpeed) || 1;
      return k >= 1 ? Infinity : (2 * this.playH) / this.CROSS_TIME * k;
    }
    get crossSeconds() {
      const k = (this.diff && this.diff.topSpeed) || 1;
      return this.CROSS_TIME * (1 + k * k) / (2 * k);
    }

    // ALOFT: how hard the world is being pushed past you right now. 1 in every
    // other mode, so this is byte-identical for the other eleven.
    //
    // ##########################################################
    // # THIS IS THE ONLY THING WIND MULTIPLIES, BESIDES PAYOUT. #
    // #                                                        #
    // # Wind must NEVER reach spawnInterval. It is the obvious #
    // # next "improvement" -- faster should mean more gates --  #
    // # and it is exactly where this mode becomes an            #
    // # unavoidable death: spawnInterval floors at 0.80s, and   #
    // # 0.80 / 1.40 = 0.57s between two gates whose centres can #
    // # be maxJump (0.62 playH) apart, which takes 0.61s to     #
    // # cross at NORMAL. No input avoids that.                  #
    // #                                                        #
    // # Wind must also never reach gapFrac, gapMul, makeSpec,   #
    // # maxJump or moveAmp. The corridor's SPATIAL geometry     #
    // # never reads it, which is why every threadability test   #
    // # still constrains this mode exactly as it constrains     #
    // # Classic.                                                #
    // ##########################################################
    get windMul() {
      const wd = this.mode && this.mode.wind;
      if (!wd || this.attract) return 1;   // the menu demo is a background, not a run
      return this.wind || 1;
    }

    get scrollSpeed() {
      // dev freeze: hold the world still so a gate can be inspected
      if (LUMEN.Cheats && LUMEN.Cheats.freeze && LUMEN.Cheats.available) return 0;
      const wnd = this.windMul;
      // the tutorial runs gently and never ramps — it's for learning, not pressure.
      // ALOFT's last lesson has to BE the mode, so the wind reaches it too.
      if (this.tutorial) return (this.W * 0.62) / 3.2 * wnd;
      // reaction time from ~2.7s down to ~1.5s -> constant across widths
      const d = this.diff || DIFFICULTY.normal;
      const m = this.mode;
      // `ramp` scales how quickly the run tightens: Zen never tightens, Sprint
      // tightens nearly three times as fast as Classic.
      const t = this.rampT;
      // A world may set its own pace too. Dividing by both puts them on the same
      // footing: >1 is faster, <1 is more reading time.
      const reaction = clamp(2.7 - t * 0.0075, 1.25, 2.7) * d.react
        / ((m ? m.speed : 1) * ((this.world && this.world.speed) || 1));
      return (this.W * 0.62) / reaction * wnd;
    }
    get spawnInterval() {
      if (this.tutorial) return 2.0;
      const m = this.mode;
      const t = this.rampT;
      return clamp(1.55 - t * 0.005, 0.80, 1.55) * (this.diff || DIFFICULTY.normal).spawn * (m ? m.spawn : 1) * ((this.world && this.world.spawn) || 1);
    }
    get gapFrac() {
      if (this.tutorial) return 0.42;   // generous openings while learning
      const d = this.diff || DIFFICULTY.normal;
      const m = this.mode;
      const t = this.rampT;
      // The outer clamp is the safety rail: no mode multiplier may squeeze an
      // opening below what the orb can physically thread, or widen it past the
      // playfield. Precision sits right on the floor; Zen sits on the ceiling.
      return clamp(clamp(0.35 - t * 0.0009, 0.19, 0.35) * this.gapMul, 0.17, 0.52);
    }

    // Everything that scales the opening, in one place — and the ONLY thing a
    // live run reads. `gapFrac` above is the tutorial's; this is the corridor's.
    get gapMul() {
      if (this.tutorial) return 1;
      const d = this.diff || DIFFICULTY.normal;
      const m = this.mode;
      let g = d.gap * (m ? m.gap : 1) * ((this.world && this.world.gap) || 1);
      // A world may breathe its openings rather than fix them. The safety clamp
      // inside makeSpec is what keeps the trough legal, so the wave never has to
      // know how tight the corridor already is.
      const wv = this.world && this.world.gapWave;
      if (wv) g *= 1 + wv.amp * Math.sin(this.elapsed * wv.speed);
      return g;
    }
    // Gravity, from the world and from ANCHOR together. Clamped as a PRODUCT:
    // ANCHOR on a light-gravity world would otherwise reach 0.34 — an orb that
    // barely falls at all and cannot be steered into a low gap.
    get gravMul() {
      const w = (this.world && this.world.gMul) || 1;
      return clamp((this.fx.anchor > 0 ? 0.5 : 1) * w, 0.45, 1.6);
    }
    // The orb's resting size, and the largest it can become. GLUTTON swells it
    // with the chain, so anything deciding WHERE a collectable may sit has to
    // reserve room for maxR — otherwise a fed player is shown a mote pressed
    // against a wall that they can no longer fit into.
    get baseR() { return (this.player && this.player.baseR) || (this.player && this.player.r) || 12; }
    get maxR() {
      const sw = this.mode && this.mode.swell;
      return this.baseR * (1 + (sw ? sw.max : 0));
    }
    // The smallest gapH that still leaves the FATTEST this orb can get room to
    // pass — expressed as a fraction of playH so makeSpec can use it directly.
    //
    // The binding constraint is the DOUBLE archetype, whose openings are only
    // 0.62 of gapH, and hitObstacle asks for a strict fit against r*0.82. The
    // 1.35 is threading room: a gate the orb exactly fills is not a gate, it is
    // a death you happen to survive.
    get minGapFrac() {
      if (!this.playH) return 0;
      return (2 * 0.82 * 1.35 * this.maxR) / (0.62 * this.playH);
    }
    // Everything HORIZONTAL scales with W: scrollSpeed is W * 0.62 / reaction, so
    // the distance between gates does too. Everything PHYSICAL scaled with H. On a
    // wide screen those two agree and nobody notices. On a phone held upright they
    // do not — H is large and W is small, so the orb and the bars grow at the same
    // moment the corridor between gates shrinks.
    //
    // Measured, 390x844 against 1280x720: the TIMING is identical, a gate every
    // 1.55s on both. But the orb covered 20.6% of the space between gates instead
    // of 5.4%, and each bar ate 17% of it instead of 4%. That is the "too zoomed
    // in" a player feels and cannot name, and why the same game reads as cramped
    // in the hand and airy on a desk.
    //
    // Capping the reference at a multiple of W stops physical size from following
    // the long axis once a screen has stopped being wide.
    //
    // The GAP is deliberately not scaled with this. Shrinking it too would hold
    // the orb-to-gap ratio but shrink the margin the player actually aims at, and
    // since crossing the playfield always takes CROSS_TIME, a smaller margin is a
    // narrower time window — it would make a phone HARDER. A phone should not be.
    get scaleRef() { return Math.min(this.H, this.W * 1.5); }
    // The orb's size lived in TWO places — resize() and the player literal in
    // start() — computing the same expression. They drifted the moment one was
    // edited: the cap below was added to resize, start() overwrote it a frame
    // later, and the measurement said nothing had changed. One getter, two
    // readers.
    // The upper clamps existed for phones, where nothing ever approached them.
    // A 13-inch tablet does: at 19px the orb came out 4.5% of the stage instead
    // of the 5.1% every other device gets, and the pillars 3.5% instead of 4.2%
    // — a cap meant to stop a phone looking silly was quietly shrinking the game
    // on the one screen with room for it. Raised until no real device sits on
    // them; the lower clamps, which do real work on a small phone, are untouched.
    get orbR() { return clamp(this.scaleRef * 0.017, 9, 24); }
    get obstacleW() { return clamp(this.scaleRef * 0.028, 14, 38); }

    // ---- input -----------------------------------------------------------
    _bind() {
      this._onKey = (e) => {
        if (e.repeat) return;
        // Keys belong to whatever has focus. This listener is on `window`, so
        // without this it swallowed Space from every button in the game: a
        // player tabbing to SHOP and pressing Space started a scored run
        // instead of opening the shop, and Space on the accessibility toggles
        // did nothing at all because preventDefault ate the activation.
        const t = e.target;
        if (t && t !== document.body && t.closest
          && t.closest('button, a, input, textarea, select, [tabindex], .ui-interactive')) return;
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'KeyW') {
          e.preventDefault(); this.action();
        } else if (e.code === 'Escape' || e.code === 'KeyP') {
          // Escape also exits fullscreen; don't let one keypress do both, or
          // leaving fullscreen silently marks the tutorial complete.
          if (e.code === 'Escape' && LUMEN.UI && LUMEN.UI.isFullscreen && LUMEN.UI.isFullscreen()) return;
          if (this.tutorial && this.state === State.PLAY) { this.finishTutorial(); return; }
          if (this.state === State.PLAY) this.pause();
          else if (this.state === State.PAUSE) this.resume();
        } else if (e.code === 'KeyM') {
          LUMEN.UI && LUMEN.UI.toggleMute();
        } else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
          const idx = parseInt(e.code.slice(5), 10) - 1;
          const held = ITEM_TYPES.filter((t) => (this.hand[t] || 0) > 0);
          if (held[idx]) { e.preventDefault(); this.useItem(held[idx]); }
        } else if (e.code === 'KeyF') {
          LUMEN.UI && LUMEN.UI.toggleFullscreen();
        }
      };
      window.addEventListener('keydown', this._onKey);

      const press = (e) => {
        e.preventDefault();
        // item buttons are drawn on the canvas, so they're hit-tested here
        if (this.state === State.PLAY && this._itemRects && this._itemRects.length) {
          const rect = this.canvas.getBoundingClientRect();
          const x = e.clientX - rect.left, y = e.clientY - rect.top;
          for (const b of this._itemRects) {
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { this.useItem(b.type); return; }
          }
        }
        // the tutorial's skip pill is drawn on the canvas, so hit-test it here
        if (this.tutorial && this._tutSkipRect) {
          const r = this._tutSkipRect;
          const rect = this.canvas.getBoundingClientRect();
          const x = e.clientX - rect.left, y = e.clientY - rect.top;
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            this.finishTutorial();
            return;
          }
        }
        this.held = true;
        if (this.state === State.PLAY && !this.attract && this.mode && this.mode.hold) {
          if (this.player.dir !== -1) this.flip();
          return;                       // a hold-mode press is not a flip toggle
        }
        this.action();
      };
      // HOLD mode gives the single input a DURATION. Rather than teach flip() a
      // second personality, both edges are routed through it: press asks for
      // "up" and release asks for "down", and each one only flips if the orb is
      // not already going that way. So the squash, the sound, the near-miss
      // accounting and the tutorial all see exactly the flips they always saw.
      const wantDir = (d) => {
        if (this.state !== State.PLAY || this.attract) return;
        if (!(this.mode && this.mode.hold)) return;
        if (this.player.dir !== d) this.flip();
      };
      const release = () => { this.held = false; wantDir(1); };
      this.canvas.addEventListener('pointerdown', press);
      // A pointer that leaves the canvas or is stolen by the OS must count as a
      // release, or the orb sticks to the ceiling until the next tap.
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
        this.canvas.addEventListener(ev, release);
      }
      window.addEventListener('blur', release);
      // Debounced: every resize event rebuilds the baked background + vignettes and
      // regenerates the dust field, so dragging a window edge would otherwise churn
      // hundreds of offscreen canvases.
      let rzT = null;
      window.addEventListener('resize', () => {
        if (rzT) clearTimeout(rzT);
        rzT = setTimeout(() => { rzT = null; this.resize(); }, 120);
      });
      window.addEventListener('blur', () => { if (this.state === State.PLAY) this.pause(); });
      // blur is unreliable on mobile app-switch; visibilitychange is not. Without
      // this the player returns to a live run already on top of an obstacle.
      //
      // Pausing the RUN is only half of it, and the half that was missing cost a
      // tester report: "music still playing on background when I was left the
      // app". The menu has music too, so leaving from anywhere other than a run
      // left LUMEN playing behind the home screen. The audio goes to sleep
      // whatever screen we are on; only the run needs the state check.
      // One place that knows whether the player is looking at us.
      //
      // js/ads.js needs it: a rewarded flight settles on its own schedule, and
      // if it settles while the app is in the background, asking for the sound
      // back there would start the menu music in a pocketed phone -- with
      // nothing to stop it, because `away()` does not fire again until the
      // player foregrounds and leaves a second time. `document.hidden` alone is
      // not enough on Android, which is the whole reason the App plugin is
      // wired up below.
      LUMEN.appActive = !document.hidden;
      const away = () => {
        LUMEN.appActive = false;
        if (this.state === State.PLAY) this.pause();
        Audio && Audio.sleep();
      };
      const back = () => {
        LUMEN.appActive = true;
        Audio && Audio.wake();
        // Re-arm the ad. A held rewarded ad goes stale after about an hour and
        // both natives short-circuit on merely HOLDING one, so an app that sat
        // in the background overnight would answer the next tap instantly with
        // an ad that then refuses to present -- "no ad right now", and the
        // second tap works. That is the "press it a few times" symptom again,
        // caused by the cache that was meant to end it.
        if (LUMEN.Ads && LUMEN.Ads.preload) { try { LUMEN.Ads.preload(); } catch (e) { /* no ads here */ } }
      };
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) away(); else back();
      });
      // Android's WebView does not reliably fire visibilitychange when the task
      // is switched away — which is the case the tester was in. Capacitor's App
      // plugin reports it directly, so ask it too where it exists; both paths
      // are idempotent, so being told twice costs nothing.
      const C = window.Capacitor;
      const AppPlugin = C && C.Plugins && C.Plugins.App;
      if (AppPlugin && AppPlugin.addListener) {
        try {
          AppPlugin.addListener('appStateChange', (st) => {
            if (st && st.isActive) back(); else away();
          });
        } catch (e) { /* older bridge; visibilitychange still covers the tab */ }
      }
    }

    action() {
      if (this.modalOpen) return; // a shop/modal overlay is open — ignore flip/start
      if (Audio) { Audio.init(); Audio.unlock(); }
      // Tapping the menu background has always started a run; the attract demo
      // runs in the PLAY state, so it has to keep that promise itself rather
      // than quietly turning the tap into a flip of a run nobody is scoring.
      if (this.attract) { this.attract = false; this.start(); return; }
      if (this.state === State.MENU) { this.start(); return; }
      if (this.state === State.DEAD) { return; } // retry via button/overlay
      if (this.state === State.PAUSE) { this.resume(); return; }
      if (this.state === State.PLAY) this.flip();
    }

    flip() {
      const p = this.player;
      p.dir *= -1;
      this.hasFlipped = true;
      if (this.tutorial && this.tutStage && this.tutStage.id === 'flip') this.tutAdvance(1);

      // THE most important line in the game: cancel the old momentum.
      // Gravity alone would have to bleed off the existing speed first, so a flip
      // taken mid-fall left the orb travelling the WRONG way for up to ~370ms and
      // ~140px. That reads as "I tapped and nothing happened" and makes the game
      // feel broken. Zeroing the velocity and adding a small kick in the new
      // direction makes every tap answer on the very next frame.
      // The kick must scale with gravity too, or a light-gravity world gives a
      // full-strength flip against a weak fall — which cancels the trait.
      const G = (2 * this.playH) / (this.CROSS_TIME * this.CROSS_TIME) * this.gravMul;
      p.vy = p.dir * G * 0.055;

      // squash pop
      p.sx = 1.4; p.sy = 0.6;
      // A skin may own the flip's SOUND as well as its look: the cat mews.
      // Falls back to the ordinary flip for every skin that declares nothing.
      Audio && this._sfx((this.skin().flipSfx) || 'flip', { dir: p.dir });
      // The flip is the ONE thing a player does, several hundred times a run.
      // Whatever it looks like is what the game looks like, which is why the
      // signature owns it rather than a hardcoded spray of six dots.
      this.signatureFx('flip', p.x, p.y);
    }

    // ---- lifecycle -------------------------------------------------------
    start() {
      this.reset();
      if (this.mod && this.mod.startShield) this.shield = true;   // Aegis III
      // Consumables are shop power, so they stay out of the daily like skills do.
      if (!this.daily && LUMEN.Progression) {
        const taken = LUMEN.Progression.takeIntoRun();
        for (const k in taken) this.hand[k] = (this.hand[k] || 0) + taken[k];
      }
      this.state = State.PLAY;
      Audio && (Audio.init(), Audio.unlock(), this._sfx('start'), Audio.music.start(), Audio.music.setIntensity(0), Audio.music.setLevel(0.5));
      LUMEN.Voice && LUMEN.Voice.sync();
      LUMEN.UI && LUMEN.UI.showScreen(null);
    }
    // The menu's demo plays itself, and every flip and pickup it makes was
    // firing a sound effect — a constant chatter under a screen the player is
    // only reading. It is a background, so it is silent.
    _sfx(name, opts) { if (this.attract) return; Audio && Audio.sfx(name, opts); }

    // ---- tutorial --------------------------------------------------------
    startTutorial() {
      this.reset();
      this.tutorial = true;
      // The basics are taught under Classic rules — you cannot learn to read a
      // corridor through a mode that bends it. But we remember which mode the
      // player has selected so the FINAL lesson can be that mode's own.
      this.tutMode = LUMEN.Modes ? LUMEN.Modes.current().id : 'classic';
      this.resolveMode();
      this.tut = { stage: 0, progress: 0, sinceStage: 0 };
      this.hasFlipped = true;      // the tutorial does its own coaching
      this.spawnTimer = 2.2;       // let stage 1 breathe before anything appears
      this.state = State.PLAY;
      Audio && (Audio.init(), Audio.unlock(), this._sfx('start'), Audio.music.start(), Audio.music.setIntensity(0), Audio.music.setLevel(0.5));
      LUMEN.UI && LUMEN.UI.showScreen(null);
    }

    get tutStage() {
      if (!this.tut) return null;
      const st = TUT_STAGES[this.tut.stage];
      if (!st) return null;
      // Every stage carries the exact string keys it draws with. Building them
      // by concatenation at the draw site went wrong the moment the two naming
      // schemes met: the basics are `tut1t`, the mode briefings are
      // `tutm_blackout_t`, and one `k + 't'` cannot produce both — so the mode
      // lessons drew their raw key names on screen.
      const withKeys = (s, k) => ({ id: s.id, k, tk: k + 't', hk: k + 'h', goal: s.goal, unitKey: s.unitKey });
      // The mode lesson borrows this stage and swaps in its own text. Classic
      // has nothing extra to teach, so it skips straight past.
      if (st.id === 'mode') {
        const id = this.tutMode || 'classic';
        if (id === 'classic') {
          const nx = TUT_STAGES[this.tut.stage + 1];
          return nx ? withKeys(nx, nx.k) : null;
        }
        return withKeys(st, 'tutm_' + id + '_');
      }
      return withKeys(st, st.k);
    }

    tutAdvance(n) {
      if (!this.tut) return;
      const st = this.tutStage;
      this.tut.progress += (n || 1);
      if (this.tut.progress >= st.goal) {
        if (this.tut.stage >= TUT_STAGES.length - 1) { this.finishTutorial(); return; }
        this.tut.stage++;
        this.tut.progress = 0;
        this.tut.sinceStage = 0;
        this.tutBanner = 1;
        // The rules can change with the stage now — the mode lesson switches into
        // its mode, and stepping off it switches back. Re-resolving on every
        // advance keeps both directions honest.
        this.resolveMode();
        this.flash = Math.max(this.flash, 0.25);
        Audio && this._sfx('flow');
        haptic([10, 6, 18]);
        // clear the road so the next lesson starts clean
        this.obstacles.length = 0;
        this.motes.length = 0;
        this.spawnTimer = 1.4;
      }
    }

    finishTutorial() {
      Store.tutorialDone = true;
      LUMEN.Analytics && LUMEN.Analytics.track('tutorial_done', { stage: this.tut ? this.tut.stage : -1 });
      this.tutorial = false;
      this.tut = null;
      this.state = State.MENU;     // NOT dead: DEAD would draw the score HUD behind
                                   // the completion panel and imply a scored run
      this._finalized = true;      // a lesson is not a scored run
      this.score = 0; this.displayScore = 0;
      this.obstacles.length = 0; this.motes.length = 0; this.powers.length = 0;
      Audio && (this._sfx('best'), Audio.music.stop());
      LUMEN.UI && LUMEN.UI.showTutorialDone();
    }

    // In the tutorial a crash is a lesson, not an ending.
    tutSoftFail() {
      const p = this.player;
      this.shake = Math.max(this.shake, 14);
      this.damageFlash = 0.8;
      Audio && this._sfx('crash');
      haptic(30);
      this.particles.burst(p.x, p.y, 18, { color: this.gateColor(1), spMax: 240, lifeMax: 0.6, sizeMax: 5, glow: true });
      // nudge the player back to the nearest opening and clear what's on top
      let target = this.playTop + this.playH * 0.5;
      let best = 1e9;
      for (const ob of this.obstacles) {
        for (const g of ob.gaps) {
          const d = Math.abs(ob.x - p.x);
          if (d < best) { best = d; target = g.y; }
        }
      }
      this.obstacles = this.obstacles.filter((ob) => ob.x > p.x + this.W * 0.45);
      this.motes = this.motes.filter((m) => !m.ob || this.obstacles.indexOf(m.ob) >= 0);
      p.y = clamp(target, this.playTop + p.r * 2, this.playBottom - p.r * 2);
      p.vy = 0;
      p.trail.length = 0;
      this.invuln = 1.4;
      this.combo = 0; this.comboTimer = 0;
      this.texts.add(p.x, p.y - 46, T('tryAgain'), 'hsl(0 85% 68%)', 22);
      if (this.tut && this.tutStage.id === 'combo') this.tut.progress = 0;
    }

    // Skills resolved once per run. In daily mode every level reads as 0, so the
    // shared course stays a pure contest. MUST be re-run whenever `daily` changes
    // — reset() runs before startDaily() sets the flag, so computing this only
    // there silently handed daily runs every upgrade the player owned.
    applyMods() {
      this.mod = LUMEN.Progression
        ? LUMEN.Progression.modifiers(!!this.daily)
        : { magnetFrac: 0, flowAt: 16, comboTimeMul: 1, closeWindow: 2.0, closeBonus: 8, startShield: false, reviveCost: 60, skillsActive: false };
    }

    // Deterministic run for everyone on the same calendar day.
    startDaily() {
      this.reset();
      this.daily = true;
      // The daily is one shared course — it always runs at Normal, or a player on
      // Easy would be posting scores against a different game.
      this.diff = DIFFICULTY[this.daily ? 'normal' : (Store.difficulty || 'normal')] || DIFFICULTY.normal;
      this.resolveMode(); // …and the mode, for the same reason
      this.applyMods();   // re-resolve now that we know this is a daily run
      const seed = LUMEN.Daily ? LUMEN.Daily.todaySeed() : 1;
      this.rng = mulberry32(seed);
      // reset() ran BEFORE this and drew these from Math.random, so two players
      // on the same date got different mote positions from about fifteen seconds
      // in — and on a traps day, different mine timing — while posting to one
      // shared board. Re-draw them now that the seeded generator exists.
      this.bountyTimer = this.rrand(12, 20);
      this.trapTimer = (this.world && this.world.traps) ? this.rrand(1.5, 3.5) : this.rrand(14, 22);
      // Pre-plan the whole course from the seed. Generating it up front (against a
      // simulated clock rather than the live one) means frame rate, screen size and
      // how much time a player spends in slow-mo flow can't shift the layout.
      this.plan = [];
      this.dailyDate = LUMEN.Daily ? LUMEN.Daily.todayStr() : '';
      // The day's mutator reshapes the planned course. It is applied to the PLAN,
      // not to the live run, so it stays identical for everyone regardless of
      // frame rate or screen — the same rule the seed itself follows.
      this.mutator = LUMEN.Daily ? LUMEN.Daily.twist().mutator : 'none';
      const planRng = mulberry32(seed ^ 0x9e3779b9);
      let e = 1.1, c = 0.5;
      const mut = this.mutator;
      // The day's MODE has to reach the planned gates too, not just its score
      // multiplier. Without this a PRECISION day planned Classic-width openings
      // and still paid 1.7x for them, and a BLACKOUT day lost the widening that
      // is there to offset the darkness while still paying 1.9x — the same
      // class of mismatch the records were retired over, still live on the
      // daily. Deterministic: a daily forces normal difficulty and no world
      // (see resolveMode), so this is exactly the mode's own constant and every
      // player still gets an identical course.
      // The generator's whole state, kept so the course can be EXTENDED rather
      // than run out. 600 gates is only 8.7 minutes on a Classic day (12.6 on a
      // Precision one), and past the end spawnObstacle clamped to the last spec
      // — the identical gate, at the identical height, forever. A player who
      // got that far could hold one position and farm the shared daily board
      // indefinitely. Extending from the same seeded generator keeps every
      // player's course identical however long they last.
      this._plan = {
        rng: planRng, e, c, mut,
        gap: { gapMul: this.mode ? (this.mode.gap || 1) : 1 },
      };
      this.planAhead(600);
      this.state = State.PLAY;
      Audio && (Audio.init(), Audio.unlock(), this._sfx('start'), Audio.music.start(), Audio.music.setIntensity(0), Audio.music.setLevel(0.5));
      LUMEN.UI && LUMEN.UI.showScreen(null);
    }
    // Append `n` more gates to the daily course, continuing the seeded sequence
    // exactly where it left off. Called once for the opening 600 and again
    // whenever a run outlives them, so the layout is the same for everyone at
    // minute one and at minute thirty.
    planAhead(n) {
      const P = this._plan;
      if (!P) return;
      for (let i = 0; i < n; i++) {
        const spec = Game.makeSpec(P.rng, P.e, P.c, P.gap);
        P.c = spec.c;
        // ---- the day's mutator ----
        // Each one bends a single dial, so the day has a character you can name
        // rather than a soup of changes nobody can read.
        if (P.mut === 'swarm') {                     // a mote on almost every gate
          spec.mote = true;
        } else if (P.mut === 'sparse') {             // almost none — pure threading
          spec.mote = P.rng() < 0.25;
        } else if (P.mut === 'narrow') {             // tighter openings throughout
          spec.gapH *= 0.84;
        } else if (P.mut === 'rush') {               // gates arrive closer together
          spec.tight = true;
        } else if (P.mut === 'bounty') {             // every mote pays double
          spec.bounty = !!spec.mote;
        }
        this.plan.push(spec);
        const step = clamp(1.55 - P.e * 0.012, 0.92, 1.55);
        P.e += P.mut === 'rush' ? step * 0.78 : step;
      }
    }

    pause() {
      this.stopWind();
      // The attract demo also lives in the PLAY state, and every pause entry
      // point (Esc, the pause button, window blur, tab hide, gamepad Start) keys
      // off that. Guarding here instead of at five call sites is what stops a
      // PAUSED panel appearing on top of the main menu.
      if (this.attract) return;
      if (this.state !== State.PLAY) return;
      this.state = State.PAUSE;
      LUMEN.Voice && LUMEN.Voice.sync();
      // actually stop the sequencer — just dropping intensity leaves it scheduling
      // notes forever while the tab is hidden
      Audio && (Audio.music.setIntensity(0), Audio.music.stop());
      LUMEN.UI && LUMEN.UI.showScreen('pause');
    }
    resume() {
      if (this.state !== State.PAUSE) return;
      this.state = State.PLAY;
      setTimeout(() => LUMEN.Voice && LUMEN.Voice.sync(), 0);
      Audio && (Audio.unlock(), Audio.music.start());
      // pause() pushed the music down to intensity 0, and scoreMusic() only
      // re-pushes when the LEVEL CHANGES. Pause mid-chain and the level is the
      // same on the way back, so nothing was ever pushed and the sequencer sat
      // at 0: pad, lead, arp and snare all faded out and stayed out for the
      // rest of the chain. Forgetting the memo makes the next frame re-assert it.
      this._musLvl = -1;
      LUMEN.UI && LUMEN.UI.showScreen(null);
    }
    toMenu() {
      this.stopWind();
      this.state = State.MENU;
      this.reset();
      LUMEN.UI && LUMEN.UI.showScreen('menu');
      this.startAttract();
      this.menuMusic();
    }

    // A game about music that reacts to how you play should not be silent on its
    // own title screen. The menus get the same piece at its calmest — no layers,
    // resting tempo — so starting a run swells what was already there instead of
    // cutting in from nothing. It can only begin after a gesture has unlocked
    // audio, so the first tap on a button starts it (see UI.click).
    menuMusic() {
      if (!Audio || !Audio.music || !Audio.ctx) return;   // no gesture yet
      const map = (LUMEN.Cosmetics && LUMEN.Cosmetics.mapDef()) || null;
      Audio.music.setSong((map && map.id) || 'deepfield');
      Audio.music.setKey(0);
      Audio.music.setPace(0);
      Audio.music.setIntensity(0);
      Audio.music.start();
      Audio.music.setLevel(0.3);        // a bed under the menu, not the main event
      // force the next run to re-apply its own pace and layers
      this._musSong = null; this._musPace = -1; this._musLvl = -1;
    }

    // ---- attract mode ------------------------------------------------------
    // The menu sits on top of a live game playing itself, so the first thing a
    // new player sees is what the game actually IS. It is deliberately inert:
    // no score kept, no shards, no missions, no audio, and death just quietly
    // restarts it. `attract` is checked anywhere a run would leave a mark.
    startAttract() {
      if (this.attract || this.state !== State.MENU) return;
      this.reset();
      this.attract = true;
      this.hasFlipped = true;          // never coach in the background
      this.revived = true;             // never offer a revive
      // In season, the menu flies the featured world. This is the whole feature
      // in one line: you open the game on the 31st of October and it is orange
      // and haunted. It changes NOTHING the player owns or has equipped — the
      // preview is cleared the moment a real run starts, so they play on
      // whatever they actually chose.
      if (LUMEN.Cosmetics) {
        LUMEN.Cosmetics.setPreview(LUMEN.Cosmetics.inSeason());
        this.resolveMode();               // re-read the world through the preview
        // viewW, not W. W is the play COLUMN, and baking the sky at that width
        // left a hard vertical seam down a tablet: tinted sky beside bare navy,
        // which reads as a rendering fault rather than a letterbox.
        this.bg.resize(this.viewW, this.H);   // and rebake the sky in its colours
      }
      this.state = State.PLAY;
    }
    stopAttract() {
      if (!this.attract) return;
      this.attract = false;
      this.state = State.MENU;
      this.reset();
    }

    // A modest autopilot: aim for the gap of the nearest gate ahead, flip when
    // the ballistic arc says we'd otherwise miss it. It plays well but not
    // perfectly, which reads as a person rather than a machine.
    attractThink(dt) {
      const p = this.player;
      let target = null, bestDx = Infinity;
      for (const ob of this.obstacles) {
        const dx = ob.x + ob.w - p.x;
        if (dx < -4 || dx > bestDx) continue;
        bestDx = dx; target = ob;
      }
      let want;
      if (target) {
        // pick whichever gap of this gate is cheapest to reach
        let gap = target.gaps[0];
        for (const g of target.gaps) if (Math.abs(g.y - p.y) < Math.abs(gap.y - p.y)) gap = g;
        want = gap.y;
        // BRITTLE: the demo has to PLAY the mode, not duck it. The autopilot
        // aims at gap centres, so without this the wallpaper behind the main
        // menu would show the mode being played wrong, forever — which no other
        // mode does. The gate's own mote is collected by the shatter itself, so
        // the detour below is skipped rather than fighting the aim back to
        // centre.
        const fb = this.faultBand(target);
        if (fb) want = (fb.y0 + fb.y1) * 0.5;
        else {
          // a mote just off the path is worth a small detour — that's the game's soul
          for (const m of this.motes) {
            if (m.taken || m.x < p.x) continue;
            if (m.x - p.x < this.W * 0.42 && Math.abs(m.y - want) < this.playH * 0.16) { want = m.y; break; }
          }
        }
      } else {
        want = this.playTop + this.playH * 0.5;
      }
      // where the current arc takes us over the next slice of time
      const G = (2 * this.playH) / (this.CROSS_TIME * this.CROSS_TIME);
      const t = 0.18;
      const predicted = p.y + p.vy * t + 0.5 * p.dir * G * t * t;
      const err = predicted - want;
      // This flips often — it is how you hold a line under constant gravity, and
      // it is why the demo used to chatter. Measured before changing it: adding
      // a cooldown does cut the rate, but it HALVES how long the autopilot
      // survives, and a menu demo that keeps crashing is worse than a busy one.
      // Widening the deadzone alone barely moves the rate at all. The noise was
      // the real complaint and that is silenced at the source (see _sfx), so the
      // flying is left as it was.
      const dead = this.playH * 0.035;
      if ((err > dead && p.dir > 0) || (err < -dead && p.dir < 0)) this.flip();
    }

    // Everything that scales what a run is worth, in one place. Difficulty and
    // mode stack: Sprint on Hard is 1.8 x 1.4.
    get scoreMul() {
      const m = this.mode;
      return (this.diff ? this.diff.scoreMul : 1) * (m ? m.scoreMul : 1);
    }

    // The best for the game you are actually playing. Classic keeps the headline
    // record; every other mode keeps its own, because they are different games
    // and one shared number would mean nothing in either of them.
    get bestHere() {
      // Store.dailyBest keeps YESTERDAY's number until the day is rolled over,
      // which only happens when a run is recorded — so the HUD showed a record
      // from a course nobody is playing, and it collapsed the moment the run
      // ended. Daily.status() is the one that checks the date.
      if (this.daily) return (LUMEN.Daily ? LUMEN.Daily.status().bestToday : 0) || 0;
      const id = this.mode ? this.mode.id : 'classic';
      if (id === 'classic') return Store.best;
      return LUMEN.Modes ? LUMEN.Modes.best(id) : 0;
    }

    get reviveCost() { return this.mod ? this.mod.reviveCost : 60; }
    canRevive() {
      return !this.revived && !this.daily && Math.floor(this.score) > 0 && Store.shards >= this.reviveCost;
    }

    // Whether the CONTINUE? panel opens at all — deliberately NOT canRevive().
    // canRevive() asks whether you can AFFORD the shard price, and the
    // "Watch an ad instead" button lives inside this panel. Gating the panel on
    // affordability therefore hid the free option from precisely the players it
    // was built for: someone who just spent down in the shop, died at 1,200 and
    // was never offered anything at all. On iOS this panel is the only place a
    // rewarded revive can be reached.
    canOfferRevive() {
      if (this.revived || this.daily || Math.floor(this.score) <= 0) return false;
      if (Store.shards >= this.reviveCost) return true;
      return !!(LUMEN.Ads && LUMEN.Ads.available && !this.adRevived);
    }

    // Spend shards to continue the same run: clear the road ahead, drop the combo
    // (the chain is genuinely lost), keep the score, and grant brief invulnerability.
    // `free` is the ad path: the run continues without paying shards, and
    // canRevive() — which asks whether you can AFFORD it — must not stand in the
    // way of a player who just watched an ad precisely because they could not.
    revive(free) {
      // Is this run still WAITING on the decision?
      //
      // A rewarded revive lands seconds after the tap, and the CONTINUE? panel
      // stays live for all of them — END RUN, MENU and the Android back button
      // were never disabled. `free` skipped every check, so an ad that finished
      // after the player had already pressed END RUN put them back into a run
      // whose books were closed. Dying again then found `revived` true, so no
      // second offer, and `finalizeRun()` returned at its own guard because the
      // run was already recorded: no CONTINUE? panel, no game-over panel, no
      // menu. A dead orb on an empty playfield, a pause button that does
      // nothing, and on iOS no way out but force-quitting the app.
      //
      // Pressing MENU during the flight was the same shape: `toMenu()` starts
      // the attract demo, then the revive hid every screen behind it.
      if (this.state !== State.DEAD || this._finalized) return false;
      if (!free && !this.canRevive()) return false;
      if (!free) Store.shards = Store.shards - this.reviveCost;
      Store.reviveCount = Store.reviveCount + 1;
      this.revived = true;
      // You paid for a fresh start, so you get one. Without this a revive at
      // nerve 0.7 would end the run again at the very next gate.
      if (this.mode && this.mode.fault) { this.nerve = this.mode.fault.nerve; this.heat = 0; }
      const p = this.player;
      p.alive = true;
      p.vy = 0;
      p.y = clamp(p.y, this.playTop + p.r * 2, this.playBottom - p.r * 2);
      p.trail.length = 0;
      // clear anything that could kill instantly on resume
      this.obstacles = this.obstacles.filter((ob) => ob.x > p.x + this.W * 0.55);
      // Anything ATTACHED to a gate we just deleted has to go with it.
      //
      // A power-up reads its position from its gate every frame
      // (`w.x = w.ob.x + …`). Once that gate is out of `obstacles` nothing
      // moves it any more, so its x stops changing while the whole world keeps
      // scrolling past — which on screen looks exactly like a power-up gliding
      // along with the map, permanently, never reachable and never removed
      // (the cull only fires at `w.x < -30`, and x is frozen).
      //
      // Motes were already filtered here. Power-ups were not, and a revive is
      // the only place a gate is deleted out from under its passengers.
      const alive = (o) => !o.ob || this.obstacles.indexOf(o.ob) >= 0;
      this.motes = this.motes.filter(alive);
      this.powers = this.powers.filter(alive);
      this.spawnTimer = Math.max(this.spawnTimer, 1.0);
      // The chain dying with you is a lost chain, and it is THE chain SPARK
      // advertises giving back. Only breakCombo() wrote lastChain, and death
      // does not go through it — so after crashing at 40 and reviving, SPARK
      // handed back whatever had merely lapsed earlier in the run. A 340-shard
      // item paying out a stale 6.
      if (this.combo > this.lastChain) this.lastChain = this.combo;
      this.combo = 0; this.comboTimer = 0; this.flowActive = false;
      this.invuln = 2.0;
      this.state = State.PLAY;
      this.flash = 0.4;
      this.particles.burst(p.x, p.y, 34, { color: this.orbColor(1), spMax: 300, lifeMax: 0.9, sizeMax: 6, glow: true });
      this.texts.add(p.x, p.y - 44, T('revived'), 'hsl(150 90% 65%)', 26);
      Audio && (Audio.unlock(), this._sfx('flow'), Audio.music.start(), Audio.music.setIntensity(0), Audio.music.setLevel(0.5));
      LUMEN.UI && LUMEN.UI.showScreen(null);
      return true;
    }

    die() {
      this.stopWind();
      const p = this.player;
      // Zen cannot kill you. You bump, the world dims for a beat, you carry on.
      // Nothing is scored or recorded there, so there is nothing to protect.
      if (this.mode && !this.mode.lethal) {
        // Zen pays nothing, so the only feedback it can honestly give is a count.
        // Knowing you clipped eleven gates is the whole difference between
        // "flying about" and "practising".
        this.bumps = (this.bumps || 0) + 1;
        this.invuln = Math.max(this.invuln, 0.9);
        this.damageFlash = 0.35;
        this.texts.add(p.x, p.y - 30, String(this.bumps), 'hsl(0 75% 66%)', 18);
        this.combo = 0; this.comboTimer = 0;
        this.particles.burst(p.x, p.y, 14, {
          color: this.orbColor(0.8), spMax: 180, lifeMax: 0.6, sizeMax: 4, glow: true,
        });
        return;
      }
      // Dev god mode: shrug the hit off entirely, and note that this run is spent.
      if (LUMEN.Cheats && LUMEN.Cheats.god && LUMEN.Cheats.available) {
        this.cheated = true;
        this.invuln = Math.max(this.invuln, 0.6);
        this.damageFlash = 0.5;
        return;
      }
      // The demo behind the menu crashes like anything else — it just picks
      // itself up instead of ending a run that was never real.
      if (this.attract) {
        this.particles.burst(p.x, p.y, 30, {
          color: this.orbColor(1), spMax: 360, lifeMax: 0.9, sizeMax: 6, glow: true, drag: 0.86,
        });
        const keep = this.particles;
        this.reset();
        this.particles = keep;          // let the burst finish over the fresh run
        this.attract = true; this.hasFlipped = true; this.revived = true;
        this.state = State.PLAY;
        return;
      }
      p.alive = false;
      this.state = State.DEAD;
      LUMEN.Voice && LUMEN.Voice.sync();
      // Keeps the crash rendering at full frame rate — for a beat, which is what
      // this used to fail at. It stamped `elapsed`, and `elapsed` only advances
      // inside updatePlay, which does not run once the state is DEAD. So the
      // clock froze at the instant of death, `elapsed - _deathAt` stayed exactly
      // 0, and the "beat" never ended: the CONTINUE? panel, the whole
      // rewarded-video wait and the game-over screen all rendered at full rate
      // and full DPR. On iOS the ad is a view controller over a WebView that
      // never backgrounds, so a thirty-second video played on top of a canvas
      // still painting every frame behind it. Wall time cannot freeze.
      // Milliseconds, from the same origin the rAF timestamp uses, so `frame`
      // can subtract the two directly.
      this._deathAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this.shake = 26;
      this.flash = 0.7;
      this.damageFlash = 1;
      this.timeScaleTarget = 1;
      haptic([40, 30, 60]);
      Audio && (this._sfx('crash'), Audio.music.setIntensity(0), Audio.music.stop());
      // The death is the most-replayed second in the game — the frame loop even
      // refuses to throttle for 1.6s afterwards so it plays at full rate. It is
      // the single best thing a cosmetic can own.
      this.signatureFx('death', p.x, p.y);
      this.particles.burst(p.x, p.y, 20, { color: '#fff', spMax: 260, lifeMax: 0.6, sizeMax: 4 });

      // Offer a revive BEFORE closing the books — the run isn't over until the
      // player says it is, so no stats/missions/shards are recorded yet.
      setTimeout(() => {
        if (this.state !== State.DEAD) return; // already resolved elsewhere
        if (this.canOfferRevive() && LUMEN.UI) LUMEN.UI.showRevive({ cost: this.reviveCost, shards: Store.shards });
        else this.finalizeRun();
      }, 620);
    }

    // Close out the run: persist stats, pay shards, advance missions, show results.
    // Guarded because several paths can reach it (revive declined, revive failed,
    // the death timer) and double-recording would pay shards twice.
    finalizeRun() {
      if (this._finalized) return;
      this._finalized = true;
      // A run that used a developer cheat is thrown away whole: no score, no best,
      // no shards, no missions, no achievements, no lifetime stats and nothing
      // submitted to the board. Testing must never be able to write numbers into
      // the save file or the leaderboard that nobody actually played for.
      if (this.cheated) {
        try {
          LUMEN.UI && LUMEN.UI.toast && LUMEN.UI.toast(T('cheatRunVoid'));
          LUMEN.UI && LUMEN.UI.showGameOver && LUMEN.UI.showGameOver({
            score: Math.floor(this.score), best: Store.best, combo: this.bestComboRun,
            isBest: false, shards: 0, total: Store.shards, missions: [], achievements: [],
            rank: 0, daily: this.daily, voided: true,
          });
        } catch (e) { /* headless: discarding the run is what matters, not the panel */ }
        return;
      }
      const mode = this.mode || (LUMEN.Modes ? LUMEN.Modes.def('classic') : null);
      const modeId = mode ? mode.id : 'classic';
      // A mode you cannot fail in is not ranked: no lifetime stats, no shards, no
      // boards. Otherwise Zen — where nothing can kill you — would quietly become
      // the fastest way to farm everything in the game.
      const ranked = !mode || mode.ranked;

      // harder settings are worth more, easier ones less; so are harder modes
      const s = Math.floor(this.score * this.scoreMul);
      const runStats = {
        score: s, combo: this.bestComboRun, motes: this.motesRun,
        flowSec: this.flowSecRun, nearMiss: this.nearMissRun,
        reachedFlow: this.flowSecRun > 0, daily: this.daily,
      };

      // Lifetime stats count every ranked run, daily or not — a run you played is
      // a run you played.
      if (ranked) {
        Store.runs = Store.runs + 1;
        Store.motes = Store.motes + this.motesRun;
        if (this.bestComboRun > Store.bestCombo) Store.bestCombo = this.bestComboRun;
        Store.nearMissTotal = Store.nearMissTotal + this.nearMissRun;
        if (this.flowSecRun > 0) Store.flowCount = Store.flowCount + 1;
        // Time SURVIVED, not time on the clock. Sprint starts at elapsed = 20
        // (mode.headStart) so its difficulty curve opens already steep — but
        // that is a handicap, not twenty seconds of play. Counted raw, it paid
        // out "Survive 60 seconds" for 40 seconds of Sprint, and the 2-minute
        // tier at 100 — a tier whose only reward is the Obsidian orb, which the
        // shop states can never be bought.
        const survived = this.elapsed - ((this.mode && this.mode.headStart) || 0);
        if (survived > Store.bestTime) Store.bestTime = survived;
      }

      let isBest;
      // The local top-10 and the headline BEST belong to Classic. Every other mode
      // keeps its own record instead, because a Sprint score and a Precision score
      // are answers to different questions and mixing them means nothing.
      const isClassic = modeId === 'classic';
      const rankBefore = !this.daily && isClassic && LUMEN.Scores ? LUMEN.Scores.rankOf(s, 'classic') : 0;
      // Read the OLD record before anything below overwrites it. This used to be
      // read afterwards, so on a new best prevBest === score and the game-over
      // line "you doubled your record" (score > prevBest * 2) could never fire
      // for anyone. It also had no daily branch, so a daily run compared itself
      // against the all-time Classic record instead of the day's.
      const prevBest = this.daily
        ? ((LUMEN.Daily ? LUMEN.Daily.status().bestToday : 0) || 0)
        : isClassic ? Store.best
        : (LUMEN.Modes ? LUMEN.Modes.best(modeId) : 0);
      if (this.daily) {
        isBest = LUMEN.Daily ? LUMEN.Daily.recordRun(s, this.dailyDate) : false;
      } else if (isClassic) {
        isBest = s > Store.best;
        if (isBest) Store.best = s;
      } else {
        isBest = ranked && LUMEN.Modes ? LUMEN.Modes.recordBest(modeId, s) : false;
      }

      // MY RUNS is the player's own history, so it gets EVERY ranked run.
      //
      // This used to sit inside the Classic branch above, which meant six of the
      // seven modes and the whole daily wrote nothing at all: you could play for
      // an hour, open the board, and find it empty. The mode travels with the row
      // so the list can say which game each score came from — which was the real
      // reason to keep them apart, and it does not require throwing them away.
      if (ranked && LUMEN.Scores) {
        LUMEN.Scores.record(s, this.bestComboRun, this.daily ? 'daily' : modeId);
      }

      if (LUMEN.Analytics) {
        LUMEN.Analytics.track('run_end', {
          score: s, combo: this.bestComboRun, motes: this.motesRun,
          flow: Math.round(this.flowSecRun), daily: !!this.daily, revived: !!this.revived,
          mode: modeId,
        });
      }
      // Only Classic and the Daily go to the shared board — one board has to mean
      // one game, and a Sprint score would tower over a Classic one for free.
      if (this.daily || isClassic) {
        // ONLY a personal best goes up. Sending every run turned a shared board
        // into one player's diary — twenty mediocre runs from whoever played
        // most, burying better scores from everyone else. A leaderboard is a
        // list of bests, so only send a run that is one.
        // …and only under a name the player chose. A score sent before anyone
        // has opened the leaderboard screen goes up as "anon", and nothing can
        // rename it afterwards: there are no accounts, so the row belongs to
        // whoever typed it. The top of the live board was three "anon" entries
        // for exactly this reason. A nameless best is HELD instead, and goes up
        // the moment there is a name to put on it.
        if (LUMEN.Leaderboard && isBest) {
          const board = this.daily ? 'daily' : 'alltime';
          if (LUMEN.Leaderboard.canSubmit) LUMEN.Leaderboard.submitQuietly(s, this.bestComboRun, board);
          else LUMEN.Leaderboard.hold(s, this.bestComboRun, board);
        }
        // …and the same rule for Steam's boards, when running inside that build
        if (LUMEN.Steam) LUMEN.Steam.submitScore(s, this.daily ? 'daily' : 'alltime');
      }

      // economy + missions
      //
      // The season bonus rides the mode's own multiplier rather than becoming a
      // second payout path, so Zen still earns exactly nothing (shardMul 0
      // times anything is 0) and the daily — which flies no world at all — is
      // untouched.
      const seasonMul = (LUMEN.Cosmetics && this.world) ? LUMEN.Cosmetics.seasonBonus(this.world.id) : 1;
      // …and the difficulty's own brake, so VERY EASY cannot out-earn the
      // setting it is easier than. Undefined on every other difficulty.
      const diffShard = (this.diff && this.diff.shardMul != null) ? this.diff.shardMul : 1;
      const shardMul = (mode ? mode.shardMul : 1) * seasonMul * diffShard;
      const shardsEarned = (ranked && shardMul > 0 && LUMEN.Cosmetics)
        ? LUMEN.Cosmetics.award(s, this.motesRun, this.flowSecRun, shardMul,
            1 / ((this.world && this.world.moteRate) || 1)) : 0;
      const missionsDone = ranked && LUMEN.Missions ? LUMEN.Missions.recordRun(runStats) : [];
      const achievements = ranked && LUMEN.Progression ? LUMEN.Progression.check() : [];
      // mirror anything newly earned onto Steam (a no-op everywhere else)
      if (achievements.length && LUMEN.Steam) LUMEN.Steam.unlock(achievements.map((a) => a.id));

      // rank must be read BEFORE record() inserts this run, or it always ranks itself
      const rank = this.daily || !isClassic || !LUMEN.Scores ? 0 : rankBefore;
      if (isBest && s > 0) Audio && this._sfx('best');
      LUMEN.UI && LUMEN.UI.showGameOver({
        score: s, combo: this.bestComboRun, isBest, daily: this.daily,
        best: this.daily ? ((LUMEN.Daily ? LUMEN.Daily.status().bestToday : 0) || 0) : (isClassic ? Store.best : (LUMEN.Modes ? LUMEN.Modes.best(modeId) : 0)),
        shards: shardsEarned, totalShards: Store.shards,
        missionsDone, achievements, dailyStreak: LUMEN.Daily ? LUMEN.Daily.status().streak : 0,
        rank, mode: modeId, ranked,
        // what the run actually looked like, so the game-over line can respond to
        // it rather than saying the same thing every time
        seconds: this.elapsed, motes: this.motesRun, nearMiss: this.nearMissRun,
        flowSec: this.flowSecRun, comboAtDeath: this.lastChain, revived: !!this.revived,
        prevBest,
      });
    }

    // ---- spawning --------------------------------------------------------
    // seeded-RNG-aware random helpers (route through this.rng for daily mode)
    rrand(a, b) { return a + this.rng() * (b - a); }
    rchance(p) { return this.rng() < p; }

    // Build one obstacle's blueprint in PLAYFIELD FRACTIONS (0..1 of playH), using
    // only `rng` and a clock `e`. Fraction space buys us three things at once:
    //   - identical layouts on any screen size (and after a mid-run resize)
    //   - a daily run that can be pre-planned deterministically
    //   - a single place to keep the "always reachable" padding honest
    // `opts.gapMul` scales the opening — the mode's, the difficulty's and the
    // world's gap traits, multiplied together by `get gapMul()`.
    //
    // It has to be applied HERE, not to the returned spec, because `pad` below
    // is derived from gapH: scale the height afterwards and the padding is still
    // sized for the old opening, so a widened gate walks off the playfield and
    // the only way through is a sliver against the wall. That is precisely the
    // unavoidable death the padding exists to prevent.
    //
    // Until now nothing passed this at all — `gapFrac` was read only by the
    // tutorial — so PRECISION's 0.55, ZEN's 1.5, MONOLITH's 1.12 and both
    // difficulty gap settings were inert. Precision was Classic with more
    // reaction time, paying 1.7x score for it.
    // `opts.minGap` is the smallest opening the ORB can actually thread here,
    // as a fraction of playH. The 0.17 floor below is a constant, and a constant
    // cannot know that GLUTTON doubles the orb while `baseR` stops shrinking at
    // its 10px minimum — so on a short viewport (a landscape phone, a squat
    // desktop window) the corridor kept closing while the fed orb did not, and a
    // DOUBLE gate could open 32.7px for an orb needing 32.8px. That is a solid
    // wall: no input avoids it, and the 2.2s combo timer outlasts the ~1.4s of
    // warning, so the size cannot be shed in time either.
    static makeSpec(rng, e, lastC, opts) {
      const o = opts || {};
      const rr = (a, b) => a + rng() * (b - a);
      // never above the ceiling, or the clamp below would invert
      const floor = Math.min(Math.max(0.17, o.minGap || 0), 0.52);
      // The corridor's tightening runs on the MODE's clock, not the wall clock.
      // `ramp` is documented as "how quickly the run tightens" and the speed and
      // gap getters already honour it, but this function never saw it — so Zen,
      // which declares ramp: 0 and advertises a run that never tightens, still
      // squeezed its gaps 41% (0.35 -> 0.205) over the first minute.
      //
      // Only the tightening terms use it. Archetype variety and power spawns
      // below stay on real elapsed on purpose: at ramp 0 a ramped clock is
      // frozen at zero, `e > 8` would never come true, and Zen would quietly
      // lose every power-up. Calm is meant to be gentle, not empty.
      const dt = o.rampT != null ? o.rampT : e;
      const gapH = clamp(clamp(0.35 - dt * 0.0022, 0.205, 0.35) * (o.gapMul || 1), floor, 0.52);
      const maxJump = lerp(0.28, 0.62, clamp(dt / 40, 0, 1));

      // pick the archetype first — its motion affects how much padding we need
      let kind = 'normal';
      if (e >= 13) {
        const r = rng();
        const pPulse = clamp((e - 13) * 0.02, 0, 0.30);
        const pMove = clamp((e - 22) * 0.014, 0, 0.34);
        const pDouble = clamp((e - 34) * 0.011, 0, 0.22);
        if (r < pDouble) kind = 'double';
        else if (r < pDouble + pMove) kind = 'moving';
        else if (r < pDouble + pMove + pPulse) kind = 'pulsing';
      }

      // ASHRISE / `buoyant`: nothing in this corridor sits still. A plain gate
      // here is not still -- it floats. The archetype MIX is untouched: double
      // and pulsing keep Classic's schedule and Classic's exact share, so every
      // threadability and difficulty guarantee in this file still holds. What
      // changes is that the STILL gate stops being still, which is a texture and
      // not a difficulty. Before `from` seconds the world is Classic, so the
      // player is given a still reference first.
      const ri = (o.rise && e >= o.rise.from) ? o.rise : null;
      if (ri && kind === 'normal') kind = 'moving';

      const spec = {
        kind, gapH, moveAmp: 0, pulseAmp: 0,
        movePhase: rr(0, TAU), moveSpeed: rr(1.1, 1.9),
        sep: 0, doubleGapH: 0,
      };
      // padding must cover half the opening, a margin, AND the full travel of any
      // motion — otherwise a moving gap slides off the playfield and the only way
      // through is a sliver against the wall (an unavoidable-looking death).
      let pad = gapH * 0.5 + 0.02;
      if (kind === 'moving') {
        if (ri) {
          // A wider, far slower swing than a Classic moving gate: period
          // 8.4-15.7s against Classic's 3.3-5.7s. Every opening enters the frame
          // at its RESTING height and then rises, monotonically, for the whole
          // ~1.1s it is on screen -- it never reverses while you are looking at
          // it, because the first reversal is a quarter period (2.1-3.9s) after
          // it appeared.
          //
          // `e` is this.elapsed at the moment of the spawn, and folding it into
          // the phase is the whole trick: the gate is animated against ABSOLUTE
          // elapsed, so a constant phase would land the sine somewhere arbitrary
          // by the time the gate actually appeared. This way sin lands on 0 at
          // first sight and goes negative, and -y is up, so the opening rises --
          // like the balloons behind it. The reward rides along for free: a mote
          // attached to a gap follows gap.y.
          spec.moveAmp = rr(ri.amp[0], ri.amp[1]);
          spec.moveSpeed = rr(ri.speed[0], ri.speed[1]);
          spec.movePhase = Math.PI - e * spec.moveSpeed + rr(-0.25, 0.25);
        } else {
          spec.moveAmp = rr(0.06, 0.13);
        }
        // The line that makes a deeper amplitude free and safe: the full travel
        // is reserved before the centre is clamped into it, exactly as it is for
        // Classic's moving gates.
        pad += spec.moveAmp;
      }
      if (kind === 'pulsing') spec.pulseAmp = 0.36;
      if (kind === 'double') {
        spec.doubleGapH = gapH * 0.62;
        spec.sep = 0.27;
        pad = spec.doubleGapH * 0.5 + 0.02 + spec.sep * 0.5;
      }
      spec.c = clamp(lastC + rr(-maxJump, maxJump), pad, 1 - pad);
      spec.mote = rng() < 0.85;
      spec.moteGap = rng() < 0.5 ? 0 : 1;
      spec.motePulse = rr(0, TAU);
      // Power-ups ride in a gap in place of a mote. Attaching them to the spec
      // (rather than a wall-clock timer) keeps the daily course deterministic.
      const pr = rng();
      spec.power = (e > 8 && pr < 0.075) ? POWER_TYPES[Math.floor(rng() * POWER_TYPES.length)] : null;
      return spec;
    }

    // Turn a spec into pixel-space gaps. Called on spawn and again on resize, so
    // in-flight obstacles keep their shape when the viewport changes.
    layoutObstacle(ob) {
      const s = ob.spec, top = this.playTop, H = this.playH;
      const cy = top + s.c * H;
      ob.baseGapY = cy;
      ob.baseGapH = s.gapH * H;
      ob.moveAmp = s.moveAmp * H;
      ob.pulseAmp = s.pulseAmp;
      // These two drive the per-frame animation and MUST be copied across. Without
      // them the animation multiplied by `undefined`, so every moving and pulsing
      // gate ended up with NaN geometry: invisible to the renderer, and lethal
      // everywhere to the collision test because "inside a gap" can never be true
      // for NaN. That is a gate with no way through that you cannot even see.
      ob.movePhase = s.movePhase;
      ob.moveSpeed = s.moveSpeed;
      if (s.kind === 'double') {
        const gh = s.doubleGapH * H, half = s.sep * H * 0.5;
        if (ob.gaps.length !== 2) ob.gaps = [{ y: 0, h: 0 }, { y: 0, h: 0 }];
        ob.gaps[0].y = cy - half; ob.gaps[0].h = gh;
        ob.gaps[1].y = cy + half; ob.gaps[1].h = gh;
      } else {
        if (ob.gaps.length !== 1) ob.gaps = [{ y: 0, h: 0 }];
        ob.gaps[0].y = cy; ob.gaps[0].h = ob.baseGapH;
      }
      // The resting position of each opening, before anything animates it. The
      // tide (below, per frame) is an offset FROM this rather than something
      // accumulated into it — otherwise a gate that is not re-laid every frame
      // would drift away a little more on every tick.
      for (const g of ob.gaps) g.baseY = g.y;
      ob.w = this.obstacleW;
      // Tidal, applied immediately so a gate is never drawn for one frame at its
      // untided position — and so a resize lands on the same phase as the frame
      // loop instead of jumping.
      this.applyTide(ob);
    }

    // Tidal breathes the whole corridor in and out — every opening drifts
    // together, so the field reads as one moving thing rather than as noise.
    //
    // This used to live in layoutObstacle, which runs at SPAWN and on resize —
    // never per frame. So each gate sampled the tide once and froze it: the
    // 1500-shard map whose whole promise is "a tide breathes the corridor"
    // never actually moved, and a mid-run resize re-laid every in-flight gate
    // at the current phase, teleporting openings by up to 0.11 * playH — enough
    // to put a wall where the orb already was.
    applyTide(ob) {
      const tide = this.world && this.world.tide;
      if (!tide) return;
      const off = Math.sin(this.elapsed * tide.speed) * this.playH * tide.amp;
      for (const g of ob.gaps) {
        const base = g.baseY != null ? g.baseY : g.y;
        g.y = clamp(base + off, this.playTop + g.h * 0.5 + 4, this.playBottom - g.h * 0.5 - 4);
      }
    }

    // ---- BRITTLE: the fault ------------------------------------------------
    // The band's height in pixels. A gate that MOVES is a moving target, so it
    // gets a bigger one.
    faultH(ob) {
      const f = this.mode.fault;
      const base = Math.max(f.band * this.playH, this.baseR * f.minR);
      return base * (ob.kind !== 'normal' ? f.wide : 1);
    }

    // Where the fault is, right now. DERIVED ON EVERY READ, never stored — which
    // is what makes it slide with a moving gate, breathe with a pulsing one,
    // ride the world's tide and survive a resize, all with no extra code. Storing
    // pixels here is the bug that traps shipped with.
    faultBand(ob) {
      if (!this.mode || !this.mode.fault) return null;
      if (ob.broken || ob.faultSide == null || !ob.gaps.length) return null;
      const g = ob.gaps[ob.faultGap] || ob.gaps[0];
      const h = this.faultH(ob);
      // side -1: flush ABOVE the opening's top lip, reaching toward playTop.
      // side +1: flush BELOW its bottom lip, reaching toward playBottom.
      // It can only ever run off the corridor edge — never into the opening,
      // and never across a double gate's middle pillar.
      const edge = ob.faultSide < 0 ? g.y - g.h * 0.5 : g.y + g.h * 0.5 + h;
      return { y0: Math.max(this.playTop, edge - h),
               y1: Math.min(this.playBottom, edge) };
    }

    // Choose the side ONCE, at spawn, in FRACTION space — never from pixels, so
    // a seeded course lands identically on every screen — and through
    // `this.rchance` so the daily's stream stays in step.
    placeFault(ob) {
      const s = ob.spec, f = this.mode.fault;
      const need = this.faultH(ob) / this.playH;
      // Reserve the band an opening can swing through, exactly as spawnObstacle
      // does for its rewards: a fault that is legal at rest but illegal at the
      // top of the gate's travel is a fault that lies.
      const swing = (s.moveAmp || 0) + ((this.world && this.world.tide) ? this.world.tide.amp : 0);
      let top, bot, gapIdx0 = 0, gapIdx1 = 0;
      if (s.kind === 'double') {
        const half = s.sep * 0.5, gh = s.doubleGapH;
        top = s.c - half - gh * 0.5;          // above the UPPER opening
        bot = 1 - (s.c + half + gh * 0.5);    // below the LOWER opening
        gapIdx0 = 0; gapIdx1 = 1;             // outer lips only
      } else {
        top = s.c - s.gapH * 0.5;
        bot = 1 - (s.c + s.gapH * 0.5);
      }
      const roomTop = top >= need + swing, roomBot = bot >= need + swing;
      let up;
      if (roomTop && roomBot) up = this.rchance(0.5);
      else if (roomTop) up = true;
      else if (roomBot) up = false;
      // Unreachable in practice — spec.c is clamped so the larger side is always
      // far bigger than the band — but a belt, not an argument.
      else up = top >= bot;
      ob.faultSide = up ? -1 : 1;
      ob.faultGap = up ? gapIdx0 : gapIdx1;
      ob.faultPhase = this.rrand(0, TAU);
    }

    spawnObstacle() {
      // daily runs consume a pre-planned queue so every player gets the same course
      // Outlived the planned course? Extend it from the same seeded generator
      // rather than repeating the final gate forever.
      if (this.daily && this.plan && this.spawnIndex >= this.plan.length - 1) this.planAhead(300);
      const spec = this.daily && this.plan
        ? this.plan[Math.min(this.spawnIndex++, this.plan.length - 1)]
        // minGap is deliberately NOT passed on the daily path above: it depends
        // on playH and on baseR's 10px floor, so it is screen-dependent, and a
        // shared course must not be. No mode the daily can draw has `swell`, so
        // there is nothing for it to protect against there anyway.
        : Game.makeSpec(this.rng, this.elapsed, this.lastC,
          { gapMul: this.gapMul, minGap: this.minGapFrac,
            rampT: this.rampT, rise: this.world && this.world.rise });
      this.lastC = spec.c;
      this._lastSpecTight = !!spec.tight;

      const ob = { x: this.W + this.obstacleW, w: this.obstacleW, kind: spec.kind, spec, passed: false, gaps: [] };
      this.layoutObstacle(ob);
      if (this.mode && this.mode.fault) this.placeFault(ob);
      this.obstacles.push(ob);

      const g = ob.gaps.length > 1 ? ob.gaps[spec.moteGap] : ob.gaps[0];
      // The third and last way a collectable could end up inside a trap: the
      // TRAP was already there and the gate arrived afterwards. Traps and gates
      // scroll at the same speed, so an overlap decided here is permanent.
      // Reserve the band the opening can swing through, not just where it sits
      // this frame. A gate that would bury its reward simply carries none —
      // never a gate that lures you onto a mine.
      const mx = ob.x + ob.w * 0.5;
      const drift = (this.world && this.world.tide) ? this.playH * this.world.tide.amp : 0;
      const swing = (ob.moveAmp || 0) + drift;
      if (spec.power) {
        const r = this.baseR * 1.15;
        if (!this.trapCovers(mx, g.y, r, swing)) {
          this.powers.push({ x: mx, y: g.y, r, type: spec.power, pulse: spec.motePulse, ob, gap: g });
        }
      } else if (spec.mote) {
        // reward mote in a gap (biased toward the natural path)
        const r = this.baseR * (spec.bounty ? 1.05 : 0.85);
        if (!this.trapCovers(mx, g.y, r, swing)) {
          this.motes.push({ x: mx, y: g.y, r, taken: false, pulse: spec.motePulse, ob, gap: g, bounty: !!spec.bounty });
        }
      }
    }

    // Stage-driven spawning: each lesson only puts on screen what it's teaching.
    tutSpawn(gdt) {
      const st = this.tutStage;
      if (!st) return;
      this.tut.sinceStage += gdt;
      if (st.id === 'flip') return;                    // empty corridor: just feel the flip
      if (st.id === 'done') {                          // victory lap, then finish
        if (this.tut.sinceStage > 2.4) this.tutAdvance(1);
        return;
      }
      this.spawnTimer -= gdt;
      if (this.spawnTimer > 0) return;
      this.spawnTimer = this.spawnInterval;

      // hand-built spec so gaps stay wide, centred-ish and always plain
      const spec = Game.makeSpec(this.rng, 0, this.lastC);
      spec.kind = 'normal';
      spec.gapH = this.gapFrac;
      spec.moveAmp = 0; spec.pulseAmp = 0;
      const pad = spec.gapH * 0.5 + 0.04;
      spec.c = clamp(spec.c, pad, 1 - pad);
      spec.mote = st.id !== 'thread';                  // no motes while learning to thread
      this.lastC = spec.c;

      const ob = { x: this.W + this.obstacleW, w: this.obstacleW, kind: 'normal', spec, passed: false, gaps: [] };
      this.layoutObstacle(ob);
      // Without this the tutorial's own mode lesson would show BRITTLE with no
      // faults at all — a lesson made entirely of forced ducks, teaching the
      // opposite of the mode.
      if (this.mode && this.mode.fault) this.placeFault(ob);
      this.obstacles.push(ob);
      if (spec.mote) {
        const g = ob.gaps[0];
        this.motes.push({ x: ob.x + ob.w * 0.5, y: g.y, r: this.baseR * 0.85, taken: false, pulse: spec.motePulse, ob, gap: g });
      }
    }

    // The slice of a gate that stays open no matter how it animates. A pulsing
    // gate closes to (1 - pulseAmp) of its height and a moving one slides its
    // centre by ±moveAmp, so "open right now" is not the same as "open later".
    gapAlwaysOpen(ob, gap) {
      // The tide slides every opening together, and a free mote does NOT ride
      // along with it — so on Tidal the band that is open "no matter what" is
      // narrower by the full travel of the tide in each direction. Without this
      // the tide could drift a bar onto a mote that was placed in clear air,
      // which is exactly the bait-into-a-wall this function exists to prevent.
      const tide = this.world && this.world.tide;
      const drift = tide ? this.playH * tide.amp : 0;
      const band = (centre, half) => {
        const h = Math.max(0, half - drift);
        return [centre - h, centre + h];
      };
      if (ob.kind === 'pulsing') {
        return band(gap.baseY != null ? gap.baseY : gap.y, ob.baseGapH * (1 - ob.pulseAmp) * 0.5);
      }
      if (ob.kind === 'moving') {
        return band(ob.baseGapY, Math.max(0, gap.h * 0.5 - ob.moveAmp));
      }
      return band(gap.baseY != null ? gap.baseY : gap.y, gap.h * 0.5);
    }

    spawnFreeMote() {
      const y = this.rrand(this.playTop + this.playH * 0.12, this.playBottom - this.playH * 0.12);
      // Never park a free mote inside a bar: it looks collectable but is instant
      // death. Obstacles and motes share a scroll speed, so the offset is fixed
      // forever — but the GATE still animates, so test against the slice that
      // stays open for all time, not the opening as it happens to look right now.
      // the widest the orb can ever be here — a mote placed against a wall must
      // still be reachable by a player at full chain
      const r = this.maxR * 0.8, margin = r * 0.6;
      // Sit strictly LEFT of the line every gate enters on (W + obstacleW). The
      // loop below can only see gates that already exist; a gate born a few
      // frames from now would appear right on top of us and — since motes and
      // gates scroll at the identical speed — stay there for good. Clearing the
      // spawn line at birth is what makes that impossible forever after, because
      // from here we only ever travel further left. On a short window obstacleW
      // bottoms out at 16px, which is why this is a clamp and not a constant.
      // The lead buys a couple of frames of travel on top: a gate born a frame
      // from now closes that much of the distance before it ever exists, and at
      // speed that is several pixels — more than a 1px hair of clearance.
      const lead = this.scrollSpeed / 24;
      const x = Math.min(this.W + 20, this.W + this.obstacleW - r - lead);
      // Widen our own footprint by the margin before asking "does this bar
      // matter?". A gate born a frame or two ago has already crept left of the
      // spawn line and can end up a fraction of a pixel from where we're about
      // to sit — near enough that a bare edge test calls it "clear" and drops a
      // mote flush against a wall. Nothing should ever be that close by accident.
      for (const ob of this.obstacles) {
        if (x + r + margin < ob.x || x - r - margin > ob.x + ob.w) continue;
        let inGap = false;
        for (const g of ob.gaps) {
          const band = this.gapAlwaysOpen(ob, g);
          if (y - r - margin > band[0] && y + r + margin < band[1]) { inGap = true; break; }
        }
        if (!inGap) return; // would be embedded in the bar — skip this one
      }
      // ...and the same question for the traps, which scroll alongside us
      if (this.trapCovers(x, y, r)) return;
      // `r` above is the CLEARANCE footprint used to place this mote — the
      // widest the orb can ever get here. It is not how big the mote is. Pushing
      // it as the radius made GLUTTON's free motes 1.9x the size of the ones
      // sitting in gates (and gave them a matching pickup radius), so the same
      // collectable appeared at two different sizes on screen at once.
      this.motes.push({ x, y, r: this.baseR * 0.85, taken: false, pulse: this.rrand(0, TAU), ob: null, gap: null });
    }

    // ---- update ----------------------------------------------------------
    update(dt) {
      // ease global time scale (flow slow-mo)
      this.timeScale += (this.timeScaleTarget - this.timeScale) * clamp(dt * 8, 0, 1);
      // decay screen fx on real time
      this.shake *= Math.pow(0.001, dt);
      this.flash *= Math.pow(0.02, dt);
      this.damageFlash *= Math.pow(0.02, dt);
      if (this.tutBanner > 0) this.tutBanner = Math.max(0, this.tutBanner - dt * 2.2);

      if (this.state === State.PLAY) this.updatePlay(dt * this.timeScale, dt);

      // background + particles keep moving a touch even when idle
      const scroll = this.state === State.PLAY ? this.scrollSpeed : 40;
      this.hueBase = 190 + Math.sin(this.elapsed * 0.15) * 12;
      this.bg.update(dt, scroll);
      this.particles.update(dt);
      this.rings.update(dt);
      this.texts.update(dt);

      // smooth display score
      // Track the score you are actually EARNING, multipliers included. Showing
      // the raw figure and quietly multiplying it at the end meant a Sprint run
      // finished at nearly twice the number you had been watching all the way
      // down the corridor — the reward was real, but it arrived as a surprise
      // instead of as something you could feel building.
      this.displayScore += (this.score * this.scoreMul - this.displayScore) * clamp(dt * 12, 0, 1);

      // Mirror the score into an ARIA live region a few times a second. Everything
      // the player is told lives on the canvas, which a screen reader cannot read.
      this._srAcc = (this._srAcc || 0) + dt;
      // ...and not while the menu's demo is flying itself. A screen-reader user
      // sitting on the menu was interrupted every two seconds by the score of a
      // run they were not playing.
      if (this._srAcc > 2 && this.state === State.PLAY && !this.attract) {
        this._srAcc = 0;
        const el = document.getElementById('sr-status');
        // the same number a sighted player is looking at, multipliers included
        // A pip row and a 2px bar are invisible to these players, and nerve and
        // heat are state the mode REQUIRES you to track — so they are read out
        // too, on the same cadence.
        const flt = this.mode && this.mode.fault;
        const extra = flt
          ? ', ' + T('nerve') + ' ' + this.nerve.toFixed(1)
            + ', ' + T('heat') + ' ' + Math.round(clamp(this.heat / flt.full, 0, 1) * 100) + '%'
          : '';
        if (el) el.textContent = T('score') + ' ' + Math.floor(this.score * this.scoreMul) + ', ' + T('combo') + ' ' + this.combo + extra;
      }
    }

    updatePlay(gdt, realDt) {
      if (this.attract) this.attractThink(gdt);
      this.scoreMusic();
      this.elapsed += gdt;
      if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - realDt);
      // ALOFT: altitude is a throttle. This is the entire mechanic -- no button,
      // no hold, no second meaning for the tap. The orb's own height, which the
      // one input was already deciding, is read as a number.
      //
      // It samples the ORB and nothing else, so nothing off-screen can change the
      // world's speed, and the 0.30s ease means it never snaps. `gdt` is
      // deliberate: slow-mo slows the wind too, so flow still feels like flow.
      // This must run BEFORE scrollSpeed is read or the frame uses last frame's
      // wind.
      const _wd = this.mode && this.mode.wind;
      if (_wd && !this.attract && this.playH > 0) {
        const alt = clamp((this.playBottom - this.player.y) / this.playH, 0, 1);
        const want = _wd.lo + (_wd.hi - _wd.lo) * alt;
        this.wind += (want - this.wind) * Math.min(1, gdt / _wd.ease);
        // and let it be heard. The bed is started lazily on the first frame of a
        // wind run and torn down by stopWind() on every exit path.
        if (Audio) {
          if (!this._windAudio) { Audio.windStart && Audio.windStart(); this._windAudio = true; }
          Audio.windSet && Audio.windSet((this.wind - 1) / (_wd.hi - 1));
        }
      }
      const scroll = this.scrollSpeed;
      this.distance += scroll * gdt;
      this.score += gdt * 8; // survival points

      // ---- player physics ----
      const p = this.player;
      // ANCHOR halves gravity: flatter arcs, longer to cross, easier to hold a
      // line through a run of tight gaps.
      const gMul = this.gravMul;
      // Emberfall pushes up all run: a downward flip costs more, an upward one less.
      // HOLD: down is the rest state and the thumb is the only thing lifting you.
      // Re-asserted every frame so a release that arrived while the tab was
      // hidden, or a pointer the OS took away, cannot leave the orb stuck up.
      if (this.mode && this.mode.hold && !this.attract) {
        p.dir = this.held ? -1 : 1;
      }
      let bias = (this.world && this.world.gravityBias) || 0;
      // ALOFT: the wind is not a number on a gauge, it is a hand under the orb.
      // Above the calm line it pushes UP, below it lets you sink -- so climbing
      // is self-reinforcing and dropping is a real commitment, and the player
      // FEELS the throttle instead of reading about it. It rides the same `bias`
      // channel Emberfall's updraft already uses, so it is bounded by the same
      // maths and cannot fight a flip: at full gale it is 0.22 g against the 1 g
      // a tap commands.
      const _wl = this.mode && this.mode.wind;
      // 0.55/0.22 was a rounding error you could not feel: at wind 1.22 it was
      // 0.12g against the 1g a tap commands, and the orb fell 628px in half a
      // second regardless. It has to read as a hand under you.
      // NEGATIVE is up: `bias` is added to `p.dir`, and dir +1 is falling. The
      // first version added a positive bias for a rising wind, so climbing made
      // the orb fall FASTER -- the exact opposite of the mechanic. Caught by
      // 'The wind is felt, not just measured', which measured the fall instead
      // of trusting the sign.
      if (_wl && !this.attract) bias -= clamp((this.wind - 1) * 1.15, -0.30, 0.30);
      const G = (2 * this.playH) / (this.CROSS_TIME * this.CROSS_TIME) * gMul; // wall-to-wall in CROSS_TIME
      p.vy += (p.dir + bias) * G * gdt;
      // The ceiling. It goes AFTER the acceleration and BEFORE the move, so the
      // orb still answers a tap on the next frame and simply stops winding up
      // past the limit. `vMax` is Infinity on HARD, where this is a no-op.
      const vc = this.vMax;
      if (p.vy > vc) p.vy = vc; else if (p.vy < -vc) p.vy = -vc;
      p.y += p.vy * gdt;
      // RUBBER: the walls throw you back instead of catching you. `p.dir` is
      // deliberately untouched — flipping direction on a bounce would change the
      // control contract, not the physics. The settle threshold stops the orb
      // micro-jittering forever in a corner.
      const bnc = this.mode && this.mode.bounce;
      const hitTop = p.y < this.playTop + p.r;
      const hitBottom = p.y > this.playBottom - p.r;
      if (bnc && (hitTop || hitBottom)) {
        p.y = hitTop ? this.playTop + p.r : this.playBottom - p.r;
        p.vy = -p.vy * bnc.e;
        if (Math.abs(p.vy) < bnc.settle * 2.78 * this.playH) p.vy = 0;
        else if (Math.abs(p.vy) > this.playH * 0.4) {
          p.sx = 1.4; p.sy = 0.6;
          this._sfx('boing', { v: Math.abs(p.vy) / this.playH });
        }
      } else {
        if (hitTop) { p.y = this.playTop + p.r; if (p.dir < 0) p.vy = 0; }
        if (hitBottom) { p.y = this.playBottom - p.r; if (p.dir > 0) p.vy = 0; }
      }
      // GLUTTON: your chain is also your hitbox.
      const sw = this.mode && this.mode.swell;
      p.r = (p.baseR || p.r) * (1 + (sw ? Math.min(sw.max, this.combo * sw.per) : 0));
      // squash easing back to round
      p.sx += (1 - p.sx) * clamp(realDt * 12, 0, 1);
      p.sy += (1 - p.sy) * clamp(realDt * 12, 0, 1);
      // trail
      p.trail.unshift({ x: p.x, y: p.y });
      while (p.trail.length > (LUMEN.Q ? LUMEN.Q.trailLen : 18)) p.trail.pop();
      // ambient orb sparkle
      if (Math.random() < 0.5 * (LUMEN.Q ? LUMEN.Q.particles : 1)) {
        this.particles.spawn({
          x: p.x - p.r * 0.5, y: p.y + rand(-p.r, p.r), vx: -scroll * 0.4 - rand(0, 60), vy: rand(-20, 20),
          life: rand(0.25, 0.55), size: rand(1, 2.6), color: this.orbColor(0.8), glow: true, drag: 0.9,
        });
      }

      // ---- spawns ----
      // tutSpawn can finish the tutorial (which leaves PLAY); bail out rather than
      // running the rest of the frame in a half-transitioned state
      if (this.tutorial) { this.tutSpawn(gdt); if (this.state !== State.PLAY) return; }
      else {
        this.spawnTimer -= gdt;
        if (this.spawnTimer <= 0) {
          this.spawnObstacle();
          // a "rush" daily plans its gates closer together than the clock alone
          this.spawnTimer = this.spawnInterval * (this._lastSpecTight ? 0.78 : 1);
        }
        this.moteTimer -= gdt;
        // must go through this.rng, or a daily run's seeded stream desyncs per player
        if (this.moteTimer <= 0) { if (this.rchance(0.5 * ((this.world && this.world.moteRate) || 1))) this.spawnFreeMote(); this.moteTimer = this.rrand(0.6, 1.3); }
        // A bounty every ~18-30s, never in the first few seconds. Rare enough to
        // be an event, common enough that you learn to want one.
        this.bountyTimer -= gdt;
        // A refused bounty means "no safe column right now", not "no bounty this
        // minute" — retry in a moment rather than spending the whole interval on
        // a spawn that never happened. A daily run reports success without
        // spawning, so it consumes exactly the same rrand it always did and the
        // shared course stays identical.
        if (this.bountyTimer <= 0) { this.bountyTimer = this.spawnBounty() ? this.rrand(18, 30) : 0.2; }
        if (this.trapsOn) {
          this.trapTimer -= gdt;
          if (this.trapTimer <= 0) {
            this.spawnTrap();
            const ev = (this.world && this.world.trapEvery) || [6, 11];
            this.trapTimer = this.rrand(ev[0], ev[1]);
          }
        }
      }

      if (this.updateTraps(scroll, gdt)) return;

      // ---- obstacles ----
      const hasTide = !!(this.world && this.world.tide);
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const ob = this.obstacles[i];
        ob.x -= scroll * gdt;
        // animate gaps by archetype — writing the RESTING position, which the
        // tide then offsets from (see applyTide)
        if (ob.kind === 'moving') {
          ob.gaps[0].y = ob.gaps[0].baseY =
            ob.baseGapY + Math.sin(this.elapsed * ob.moveSpeed + ob.movePhase) * ob.moveAmp;
        } else if (ob.kind === 'pulsing') {
          ob.gaps[0].h = ob.baseGapH * (1 - ob.pulseAmp * (0.5 + 0.5 * Math.sin(this.elapsed * ob.moveSpeed + ob.movePhase)));
        }
        if (hasTide) this.applyTide(ob);
        // passed scoring (+ tight "CLOSE!" near-miss reward)
        if (!ob.passed && ob.x + ob.w < p.x - p.r) {
          ob.passed = true;
          this.score += this.windPay(6);
          // Both gate-counting lessons score here. The mode lesson counts gates
          // too, and listing only 'thread' left it stuck on 0/6 forever with no
          // way to finish the tutorial.
          if (this.tutorial && this.tutStage
            && (this.tutStage.id === 'thread' || this.tutStage.id === 'mode')) this.tutAdvance(1);
          const g = ob.gaps.reduce((a, b) => (Math.abs(b.y - p.y) < Math.abs(a.y - p.y) ? b : a));
          const edgeDist = Math.min(Math.abs(p.y - (g.y - g.h * 0.5)), Math.abs(p.y - (g.y + g.h * 0.5)));
          if (edgeDist < p.r * (this.mod ? this.mod.closeWindow : 2.0)) {
            // threaded it tight — bonus, keep the combo breathing, extra juice
            this.score += this.windPay(this.mod ? this.mod.closeBonus : 8);
            this.nearMissRun++;
            this.texts.add(p.x + 28, p.y - p.r - 14, T('close') + ' +' + (this.mod ? this.mod.closeBonus : 8), 'hsl(190 100% 70%)', 15);
            this.particles.burst(ob.x + ob.w, p.y, 8, { color: 'hsl(190 100% 72%)', spMax: 140, lifeMax: 0.5, sizeMax: 3.5 });
            this.shake = Math.max(this.shake, 3);
            if (this.combo > 0) this.comboTimer = Math.max(this.comboTimer, 1.6);
            Audio && this._sfx('nearmiss');
          } else {
            this.texts.add(p.x + 26, p.y - p.r - 14, '+6', 'hsl(150 90% 65%)', 15);
            this.particles.burst(ob.x + ob.w, p.y, 5, { color: 'hsl(150 90% 65%)', spMax: 90, lifeMax: 0.4, sizeMax: 3 });
          }
          // BRITTLE: you got through the gap, which here is the thing you were
          // supposed to avoid. Nothing above is taken back.
          if (this.mode && this.mode.fault && !ob.broken && this.duck(ob)) return;
        }
        if (ob.x + ob.w < -20) this.obstacles.splice(i, 1);
        // BRITTLE: the fault is tested BEFORE the shield, so a shield is never
        // spent on a hit the player meant to land. shatter() does not touch
        // this.obstacles, so the downward walk needs no adjustment. A broken
        // gate is inert: it cannot kill, cannot be re-shattered, cannot be
        // ducked.
        else if (this.mode && this.mode.fault && !ob.broken && this.faultHit(p, ob)) this.shatter(ob);
        // collision
        else if (!ob.broken && this.hitObstacle(p, ob)) {
          // the tutorial coaches instead of ending the run
          if (this.tutorial) { this.tutSoftFail(); return; }
          if (this.shield) { this.breakShield(ob); return; }
          this.die(); return;
        }
      }

      // ---- power-ups ----
      // every timed effect burns down on game time, so slow-mo stretches them all
      for (const k in this.fx) if (this.fx[k] > 0) this.fx[k] = Math.max(0, this.fx[k] - gdt);
      for (let i = this.powers.length - 1; i >= 0; i--) {
        const w = this.powers[i];
        if (w.ob) { w.x = w.ob.x + w.ob.w * 0.5; w.y = w.gap ? w.gap.y : w.ob.baseGapY; }
        else w.x -= scroll * gdt;
        w.pulse += gdt * 4;
        if (w.x < -30) { this.powers.splice(i, 1); continue; }
        const dx = w.x - p.x, dy = w.y - p.y;
        if (dx * dx + dy * dy < (w.r + p.r) * (w.r + p.r) * 1.3) {
          this.collectPower(w);
          this.powers.splice(i, 1);
        }
      }

      // ---- motes ----
      const passiveMag = (this.mod ? this.mod.magnetFrac : 0) * this.playH;
      const magnetR = Math.max(this.fx.magnet > 0 ? this.playH * 0.42 : 0, passiveMag);
      for (let i = this.motes.length - 1; i >= 0; i--) {
        const m = this.motes[i];
        if (m.ob) { m.x = m.ob.x + m.ob.w * 0.5; m.y = m.gap ? m.gap.y : m.ob.baseGapY; }
        else m.x -= scroll * gdt;
        // a bounty weaves across the corridor instead of drifting straight
        if (m.bounty && !m.pulled) {
          m.y = m.baseY + Math.sin(this.elapsed * m.spd + m.phase) * m.amp;
          m.y = clamp(m.y, this.playTop + m.r * 2, this.playBottom - m.r * 2);
        }
        // magnet: motes ahead of the player curve toward the orb
        if (magnetR > 0 && !m.taken) {
          const mdx = p.x - m.x, mdy = p.y - m.y;
          const d = Math.sqrt(mdx * mdx + mdy * mdy);
          if (d < magnetR && d > 1) {
            const pull = (1 - d / magnetR) * 620 * gdt;
            m.x += (mdx / d) * pull; m.y += (mdy / d) * pull;
            m.ob = null; m.gap = null;   // detached — it's chasing the player now
            // Under tow it can cross a bar, which is fine: it's travelling TO the
            // player, so nobody is being baited into a wall to reach it. Flagged
            // so the "never inside a bar" guarantee is judged on where the game
            // PUTS motes, not on where the player's own magnet drags them.
            m.pulled = true;
          }
        }
        m.pulse += gdt * 6;
        if (m.x < -20) { this.motes.splice(i, 1); continue; }
        const dx = m.x - p.x, dy = m.y - p.y;
        if (!m.taken && dx * dx + dy * dy < (m.r + p.r) * (m.r + p.r) * 1.25) {
          this.collectMote(m);
          this.motes.splice(i, 1);
        }
      }

      // ---- combo / flow ----
      if (this.comboTimer > 0) {
        this.comboTimer -= gdt;
        if (this.comboTimer <= 0) this.breakCombo();
      }
      const flowAt = this.mod ? this.mod.flowAt : 16;
      // FLOW IS A BURST, NOT A STATE YOU LIVE IN.
      //
      // Holding a big chain used to mean permanent slow-motion, which inverted
      // the whole difficulty curve: the better you were, the slower the game got,
      // forever. Flow now has a fuel gauge — it burns while active, refills only
      // while you're out of it, and once spent you keep your chain but lose the
      // bullet-time until you've earned it again.
      // Hysteresis: entering flow costs a substantially full tank, but staying in
      // it only needs a drop. Without the gap between those two thresholds it
      // re-entered the instant it refilled a sliver and strobed on and off —
      // which is both ugly and, over a long chain, exactly the unlimited
      // slow-motion this was meant to remove.
      const wants = this.combo >= flowAt
        && (this.flowActive ? this.flowFuel > 0 : this.flowFuel >= this.FLOW_MAX * 0.85);
      if (wants) {
        // the ENTRY into flow, not every frame of it — this is the moment worth
        // marking, and firing it continuously would bury the screen in rings
        if (!this.flowActive) this.signatureFx('flow', this.player.x, this.player.y);
        this.flowActive = true;
        this.flowFuel = Math.max(0, this.flowFuel - gdt);
        this.flowSecRun += gdt;
      } else {
        if (this.flowActive) Audio && this._sfx('flowEnd');
        this.flowActive = false;
        // refills at about a third of the rate it drains, so back-to-back flows
        // are possible but never free
        this.flowFuel = Math.min(this.FLOW_MAX, this.flowFuel + gdt * 0.34);
      }
      const targetFlow = this.flowActive ? 1 : this.combo >= flowAt - 6 ? 0.5 : 0;
      this.flow += (targetFlow - this.flow) * clamp(realDt * 3, 0, 1);
      // flow and the slow power-up both dilate time; take the stronger one
      // BRITTLE's LAST STAND: when you can no longer afford to duck, the world
      // eases down. You get precision, not time. It cannot be farmed — the only
      // exit other than death is a shatter, and a shatter is exactly what lifts
      // nerve back over the cost, so the state ends within three gates.
      const _flt = this.mode && this.mode.fault;
      this.timeScaleTarget = Math.min(
        this.flowActive ? 0.62 : 1,
        this.fx.slow > 0 ? 0.7 : 1,
        (_flt && !this.tutorial && !this.attract && this.nerve < _flt.cost) ? _flt.hold : 1);
      // The music's intensity belongs to scoreMusic() and nowhere else. A second
      // copy of the rule used to live here, running every frame with no attract
      // guard and its own thresholds — so it overrode the deliberately calm menu
      // bed, and it read the raw combo rather than the flow state, pinning the
      // level at 3 whenever flow ended with the chain still high.
    }

    // Play one moment of the equipped signature — 'flip', 'flow' or 'death'.
    //
    // Every signature is data (see Cosmetics.SIGNATURES), so adding one is a
    // table entry rather than another branch here, and a signature that omits a
    // moment simply contributes nothing to it.
    signatureFx(moment, x, y) {
      if (this.attract && moment !== 'flip') return;    // the demo is scenery
      const sig = LUMEN.Cosmetics ? LUMEN.Cosmetics.signatureDef() : null;
      const m = sig && sig[moment];
      if (!m) return;
      const p = this.player;
      // Rings are sized in ORB RADII, not pixels, so every signature reads the
      // same on a phone and on a 4K monitor and inside GLUTTON's swollen orb.
      const unit = (p && p.r) || 12;
      if (m.ring) {
        // A hue of its own where the signature declares one, otherwise the
        // player's chosen orb colour — so a skin and a signature never fight.
        const col = m.ring.hue != null && !m.ring.white
          ? `hsl(${m.ring.hue} 95% 66%)` : this.orbColor(0.95);
        const n = Math.max(1, m.ring.n || 1);
        for (let i = 0; i < n; i++) {
          this.rings.spawn(x, y, m.ring, col, unit, i * (m.ring.delay || 0));
        }
      }
      if (m.burst) {
        const b = m.burst;
        this.particles.burst(x, y, b.n || 8, {
          color: this.orbColor(0.8), spMax: b.spMax || 200, lifeMax: b.lifeMax || 0.6,
          sizeMax: b.sizeMax || 4, grav: b.grav || 0, drag: b.drag == null ? 0.9 : b.drag,
          glow: true, vx: moment === 'flip' ? -this.scrollSpeed * 0.15 : 0,
        });
      }
    }
    // Does the equipped signature light a corona through flow? Read by the orb
    // renderer; kept here so the renderer never has to know about cosmetics.
    get flowCorona() {
      const sig = LUMEN.Cosmetics ? LUMEN.Cosmetics.signatureDef() : null;
      return !!(sig && sig.flow && sig.flow.corona);
    }

    hitObstacle(p, ob) {
      if (this.invuln > 0) return false; // post-revive grace
      const rr = p.r * 0.82; // forgiving
      // outside the bar's x-span -> no collision
      if (p.x + rr < ob.x || p.x - rr > ob.x + ob.w) return false;
      // fully inside any opening -> safe; otherwise we're touching a bar
      for (const g of ob.gaps) {
        if (p.y - rr > g.y - g.h * 0.5 && p.y + rr < g.y + g.h * 0.5) return false;
      }
      return true;
    }

    // ---- BRITTLE: the three outcomes ---------------------------------------
    // Pure geometry, and it DELIBERATELY does not read `this.invuln`.
    // hitObstacle's first line is `if (this.invuln > 0) return false`. If the
    // fault test went through it, every gate crossed during the post-revive or
    // post-shield grace would become a forced DUCK draining nerve — a player who
    // spent 60 shards to revive at nerve 1 would be dead again two seconds
    // later. Grace protects you from DEATH; it does not switch the mode off.
    faultHit(p, ob) {
      const b = this.faultBand(ob);
      if (!b) return false;
      const rr = p.r * 0.82;                        // the same forgiveness hitObstacle grants
      if (p.x + rr < ob.x || p.x - rr > ob.x + ob.w) return false;
      // OVERLAP, not containment: grazing the seam counts. The mode is generous
      // about hitting and brutal about aiming, and that is the whole feel.
      return p.y + rr > b.y0 && p.y - rr < b.y1;
    }

    // A hit. Note what this does NOT do: splice the gate.
    //
    // Leaving the broken gate in the list fixes three things at once. No mote or
    // power-up is orphaned mid-flight — deleting a gate out from under one is
    // verbatim the bug revive() documents. The tutorial still finishes, because
    // its gate counter lives inside the `!ob.passed` block that a spliced gate
    // would never reach. And nothing has to juggle indices inside a loop that
    // walks downward.
    shatter(ob) {
      const p = this.player, f = this.mode.fault;
      ob.broken = true;
      ob._brokeAt = this.elapsed;
      this.chainUp();
      this.score += Math.round(f.pay * this.comboMult());
      if (!this.tutorial && !this.attract) {
        this.nerve = Math.min(f.nerve, this.nerve + f.gain);
        this.heat = Math.min(f.cap, this.heat + f.stoke * (1 + Math.min(1, this.combo * 0.03)));
      }
      // Collect the passengers. Playing this mode CORRECTLY aims a band's height
      // off the gap centre, which is exactly where a gate's reward sits — so
      // without this a good BRITTLE player would systematically starve the item
      // channel by being good at the mode.
      for (let j = this.motes.length - 1; j >= 0; j--) {
        const m = this.motes[j];
        if (m.ob === ob && !m.taken) { this.collectMote(m); this.motes.splice(j, 1); }
      }
      for (let j = this.powers.length - 1; j >= 0; j--) {
        if (this.powers[j].ob === ob) { this.collectPower(this.powers[j]); this.powers.splice(j, 1); }
      }
      this.particles.burst(ob.x + ob.w * 0.5, p.y, calmVisuals() ? 9 : 18,
        { color: this.moteColor(), spMax: 300, lifeMax: 0.6, sizeMax: 4.5, glow: true });
      this.flash = Math.max(this.flash, calmVisuals() ? 0.12 : 0.30);
      this.shake = Math.max(this.shake, 8);
      haptic(12);
      Audio && this._sfx('shatter');
    }

    // A clean pass through the opening — which in this mode is the failure to
    // commit. Returns true if it ended the run.
    //
    // Everything the gate already paid stays paid: the +6, the CLOSE! bonus and
    // nearMissRun all still fire. Suppressing them would pay literally nothing
    // for the PRECISION skill, whose entire payload is the close window, and
    // would make the near-miss mission unachievable in a ranked mode. It is also
    // thematically right — CLOSE! is measured to the lip, and the lip is exactly
    // where the fault is.
    duck(ob) {
      const p = this.player, f = this.mode.fault;
      this.breakCombo();
      this.texts.add(p.x, p.y - 34, T('ducked'), this.dangerColor(1), 17);
      Audio && this._sfx('deflate');
      if (this.tutorial || this.attract) return false;   // the meters are suspended there
      this.heat = Math.max(0, this.heat - f.cool);
      if (this.nerve < f.cost) {
        this.nerve = 0;
        this.texts.add(p.x, p.y - 58, T('nerveOut'), this.dangerColor(1), 24);
        this.die();
        return true;                                     // the ordinary die(); no new end path
      }
      this.nerve -= f.cost;
      return false;
    }

    // The shield eats one hit: clear the gate that got you, keep the run alive.
    breakShield(ob) {
      const p = this.player;
      this.shield = false;
      this.invuln = 1.1;
      // The shield deletes the gate and nudges you into its opening, so that
      // gate neither shatters nor ducks. Leave enough nerve to survive the next
      // honest mistake.
      if (this.mode && this.mode.fault) this.nerve = Math.max(this.nerve, this.mode.fault.cost);
      this.shake = Math.max(this.shake, 18);
      this.flash = Math.max(this.flash, 0.45);
      this.damageFlash = 0.5;
      haptic([25, 15, 25]);
      Audio && this._sfx('crash');
      this.particles.burst(p.x, p.y, 30, { color: 'hsl(195 95% 68%)', spMax: 320, lifeMax: 0.8, sizeMax: 6, glow: true });
      this.texts.add(p.x, p.y - 42, T('shieldBreak'), 'hsl(195 95% 70%)', 22);
      // A trap has no opening to be nudged into — it is a hazard in open space,
      // not a wall with a hole. The grace period above is enough on its own, and
      // reaching for `gaps` on one used to throw straight out of the update loop.
      if (!ob || !ob.gaps || !ob.gaps.length) return;
      // nudge into the nearest opening of the gate we hit so we don't re-collide
      let best = ob.gaps[0];
      for (const g of ob.gaps) if (Math.abs(g.y - p.y) < Math.abs(best.y - p.y)) best = g;
      p.y = clamp(best.y, this.playTop + p.r, this.playBottom - p.r);
      p.vy = 0;
      this.obstacles = this.obstacles.filter((o) => o !== ob);
      this.motes = this.motes.filter((m) => !m.ob || this.obstacles.indexOf(m.ob) >= 0);
      this.powers = this.powers.filter((w) => !w.ob || this.obstacles.indexOf(w.ob) >= 0);
    }

    collectPower(w) {
      const def = POWER_DEF[w.type];
      const col = `hsl(${def.hue} 95% 65%)`;
      // A pickup goes into your hand so YOU decide the moment — unless auto-use is
      // on, or your hand is already full of that type (then it would be wasted).
      const maxHold = LUMEN.Progression ? LUMEN.Progression.MAX_PER_TYPE : 1;
      const auto = Store.autoUseItems || (this.hand[w.type] || 0) >= maxHold;
      this.score += 25;
      this.particles.burst(w.x, w.y, 26, { color: col, spMax: 260, lifeMax: 0.8, sizeMax: 5, glow: true });
      if (auto) {
        this.activateItem(w.type, true);
      } else {
        // picked up, not spent — say so, so the player knows they're holding it
        this.hand[w.type] = (this.hand[w.type] || 0) + 1;
        this.handFree[w.type] = (this.handFree[w.type] || 0) + 1;   // found, not bought
        this.texts.add(w.x, w.y - 26, '+' + T('pw_' + w.type), col, 20);
        this.flash = Math.max(this.flash, 0.15);
        haptic(8);
        Audio && this._sfx('collect', { combo: 8 });
      }
    }

    // Fire a held item. Returns false if you aren't holding one.
    useItem(type) {
      if (this.state !== State.PLAY) return false;
      if (!this.hand[type]) return false;
      // Charge only for something that HAPPENED.
      //
      // The stock was decremented and paid for before activateItem ran, and
      // activateItem can decline: spark with no chain to restore says "NO CHAIN
      // TO RESTORE" and returns, shield fired while already shielded overwrites
      // a true with a true. Both took the item anyway — and spark is the most
      // expensive one in the shop at 340 shards, limit one.
      const fired = this.activateItem(type, false);
      if (!fired) return false;
      this.hand[type]--;
      // Free ones go first, so a run that ends with something still in hand
      // leaves the PAID one in the shop rather than the found one.
      if (this.handFree[type] > 0) { this.handFree[type]--; return true; }
      // Pay for it HERE, at the moment it fires. It used to be deducted when the
      // run started and never written back, so buying an item, pressing PLAY and
      // then going back to the menu destroyed it without ever using it.
      if (LUMEN.Progression && LUMEN.Progression.spend) LUMEN.Progression.spend(type);
      return true;
    }

    // Returns TRUE when the item actually did something. useItem charges on that
    // answer, so an item that declines costs nothing.
    activateItem(type, fromPickup) {
      const def = POWER_DEF[type];
      if (!def) return false;
      const col = `hsl(${def.hue} 95% 65%)`;
      const p = this.player;
      if (type === 'shield') {
        // Already shielded: there is nothing to gain and the player cannot see
        // that, so it read as a successful use that did nothing. Aegis III makes
        // this routine, not rare.
        if (this.shield) {
          this.texts.add(p.x, p.y - 44, T('alreadyShielded'), col, 18);
          return false;
        }
        this.shield = true;
      } else if (type === 'spark') {
        // Instant, not timed: hand back the chain that just broke. Worth nothing
        // if you never had one, which is the point — it rewards a lost run, not a
        // bad one.
        // Never worse than what you are already holding. Fired mid-run with a
        // live 45-chain and a stale 6 on record, this used to overwrite the 45
        // with the 6 and charge you for the privilege.
        const back = Math.max(this.lastChain, 0);
        if (back <= this.combo) {
          this.texts.add(p.x, p.y - 44, T('sparkNothing'), col, 18);
          return false;
        }
        this.combo = back;
        if (this.combo > this.bestComboRun) this.bestComboRun = this.combo;
        this.comboTimerMax = clamp(3.6 - this.combo * 0.05, 2.2, 3.6) * (this.mod ? this.mod.comboTimeMul : 1);
        this.comboTimer = this.comboTimerMax;
        this.lastChain = 0;                       // one chain, one rescue
      } else {
        this.fx[type] = def.dur;
      }
      this.texts.add(p.x, p.y - 44, T('pw_' + type), col, 22);
      this.particles.burst(p.x, p.y, 22, { color: col, spMax: 240, lifeMax: 0.7, sizeMax: 5, glow: true });
      this.flash = Math.max(this.flash, 0.2);
      haptic([8, 5, 14]);
      Audio && this._sfx('flow');
      LUMEN.Analytics && LUMEN.Analytics.track('item_use', { type, fromPickup: !!fromPickup });
      return true;
    }

    // Move, arm and cull the traps, then check whether one of them got you.
    // Returns true if the run ended here.
    updateTraps(scroll, gdt) {
      const p = this.player;
      for (let i = this.traps.length - 1; i >= 0; i--) {
        const t = this.traps[i];
        t.x -= scroll * gdt;
        if (t.arm > 0) t.arm = Math.max(0, t.arm - gdt);
        if (t.kind === 'sweeper') {
          t.y += t.vy * gdt;
          const top = this.playTop + t.h, bot = this.playBottom - t.h;
          if (t.y < top) { t.y = top; t.vy = Math.abs(t.vy); }
          if (t.y > bot) { t.y = bot; t.vy = -Math.abs(t.vy); }
        }
        if (t.x + (t.w || t.r * 2 || 0) < -40) { this.traps.splice(i, 1); continue; }
        if (t.arm > 0 || this.invuln > 0) continue;
        if (this.hitTrap(p, t)) {
          if (this.tutorial) { this.tutSoftFail(); return true; }
          if (this.shield) { this.breakShield(t); return true; }
          this.die();
          return true;
        }
      }
      return false;
    }

    // Would a circle at (x, y, r) sit inside a trap that never moves?
    //
    // Traps scroll at exactly the speed motes do, so a MINE or a SPIKE strip and
    // a collectable keep their offset for good: park a mote inside one and it is
    // a permanent lure onto instant death — the same "never bait the player into
    // a wall" rule that gates already follow, which traps were simply left out
    // of. Measured on Hallowmere (traps live from the first seconds): 4,818
    // motes and 393 power-ups were sitting inside a live trap.
    //
    // SWEEPERS are deliberately excluded. One crosses the whole corridor on its
    // own, so no placement could ever be safe from it — and because it is a
    // visibly moving beam, collecting around it is timing, not a trick.
    // `yBand` is how far this thing can TRAVEL vertically from (x, y) — a gate's
    // moveAmp, the tide's drift, a bounty's weave. It widens the reservation up
    // and down without also widening it sideways, which inflating `r` would.
    trapCovers(x, y, r, yBand) {
      const pad = r * 0.6;
      const band = yBand || 0;
      for (const t of this.traps || []) {
        if (t.kind === 'sweeper') continue;
        if (t.kind === 'mine') {
          if (Math.abs(x - t.x) > r + t.r + pad) continue;
          if (Math.abs(y - t.y) < r + t.r + band + pad) return true;
          continue;
        }
        // spikes: a lethal stretch of one wall
        if (x + r + pad < t.x || x - r - pad > t.x + t.w) continue;
        const wall = t.side < 0 ? this.playTop : this.playBottom;
        if (Math.abs(y - wall) < r + t.h + band + pad) return true;
      }
      return false;
    }

    hitTrap(p, t) {
      if (t.kind === 'mine') {
        const dx = p.x - t.x, dy = p.y - t.y;
        const rr = p.r + t.r;
        return dx * dx + dy * dy < rr * rr;
      }
      if (t.kind === 'sweeper') {
        if (p.x + p.r < t.x || p.x - p.r > t.x + t.w) return false;
        return Math.abs(p.y - t.y) < p.r + t.h;
      }
      // spikes: a lethal stretch of one wall
      if (p.x + p.r < t.x || p.x - p.r > t.x + t.w) return false;
      const wall = t.side < 0 ? this.playTop : this.playBottom;
      return Math.abs(p.y - wall) < p.r + t.h;
    }

    drawTraps(ctx) {
      if (!this.traps.length) return;
      // Same family as the bars: a world with rose gates and red spikes reads as
      // two games. Falls back to the fixed danger hue under the colour-vision
      // presets exactly as the bars do.
      const hot = this.gateColor(1);
      ctx.save();
      for (const t of this.traps) {
        // While arming, a trap is drawn hollow and pulsing: you always see it
        // coming before it can take the run.
        const armed = t.arm <= 0;
        const blink = armed ? 1 : 0.35 + 0.4 * Math.abs(Math.sin(this.elapsed * 12));
        ctx.globalAlpha = armed ? 0.95 : blink;
        ctx.fillStyle = hot;
        ctx.strokeStyle = hot;
        ctx.lineWidth = 2;
        if (t.kind === 'mine') {
          ctx.globalCompositeOperation = 'lighter';
          const g2 = glowSprite(hot);
          const hr = t.r * 2.6;
          ctx.globalAlpha *= 0.7;
          ctx.drawImage(g2, t.x - hr, t.y - hr, hr * 2, hr * 2);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = armed ? 0.95 : blink;
          // spiked disc, so it never reads as a collectable
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * TAU + this.elapsed * 1.4;
            const rad = t.r * (i % 2 ? 0.55 : 1);
            const x = t.x + Math.cos(a) * rad, y = t.y + Math.sin(a) * rad;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          armed ? ctx.fill() : ctx.stroke();
        } else if (t.kind === 'sweeper') {
          if (armed) { this.roundRect(ctx, t.x, t.y - t.h, t.w, t.h * 2, t.h); ctx.fill(); }
          else { this.roundRect(ctx, t.x, t.y - t.h, t.w, t.h * 2, t.h); ctx.stroke(); }
        } else {
          const wall = t.side < 0 ? this.playTop : this.playBottom;
          const dir = t.side < 0 ? 1 : -1;
          const n = Math.max(3, Math.round(t.w / (t.h * 1.6)));
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const x0 = t.x + (i / n) * t.w, x1 = t.x + ((i + 1) / n) * t.w;
            ctx.moveTo(x0, wall);
            ctx.lineTo((x0 + x1) * 0.5, wall + dir * t.h);
            ctx.lineTo(x1, wall);
          }
          ctx.closePath();
          armed ? ctx.fill() : ctx.stroke();
        }
      }
      ctx.restore();
    }

    // ---- traps -------------------------------------------------------------
    // Spawned into the gaps BETWEEN gates, never on top of one. `arm` is a grace
    // period during which the trap is drawn but harmless, so it is always seen
    // before it can be hit.
    spawnTrap() {
      if (!this.trapsOn) return;
      const kinds = ['sweeper', 'mine', 'spikes'];
      const kind = kinds[Math.floor(this.rng() * kinds.length)];
      const d = TRAP[kind];
      // A trap stacked on a gate can turn a fair opening into a wall, so it has
      // to stand clear of one. This used to GIVE UP whenever the spawn point was
      // crowded — and since a gate arrives about every second while the guard
      // reserves ±0.28 of the screen either side, it nearly always was: measured
      // on Hallowmere, 120 of 152 attempts were abandoned and the map delivered
      // 2 traps a minute against the ~9.6 its `trapEvery` advertises. The
      // 2600-shard world whose whole trait is being hunted was barely trapped.
      //
      // Look further down the corridor instead of giving up. Spawning at a
      // greater x only means arriving a moment later, which nobody can perceive
      // — and the clearance rule is kept exactly as strict.
      //
      // The clearance is measured against the trap's ACTUAL span, which the old
      // fixed ±0.28-of-screen window did not cover: a sweeper's beam is 0.50 of
      // the screen wide and a spike strip 0.42, so both routinely reached past
      // the reserved zone and lay across a gate anyway — a beam that can sit in
      // the opening at the moment you arrive.
      const span = kind === 'mine' ? this.playH * TRAP.mine.r * 2
        : kind === 'sweeper' ? this.W * 0.5
        : this.W * TRAP.spikes.len;
      const margin = this.W * 0.12;                   // room to read them separately
      let x = -1;
      for (let k = 0; k < 8; k++) {
        const cand = this.W + this.obstacleW * 3 + k * this.W * 0.14;
        const lo = cand - margin, hi = cand + span + margin;
        let clear = true;
        for (const ob of this.obstacles) {
          if (ob.x + ob.w > lo && ob.x < hi) { clear = false; break; }
        }
        if (clear) { x = cand; break; }
      }
      if (x < 0) return;                              // genuinely nowhere to put it
      const t = { kind, x, arm: d.arm, dead: false };
      if (kind === 'sweeper') {
        t.y = this.rrand(this.playTop + this.playH * 0.25, this.playBottom - this.playH * 0.25);
        t.h = this.playH * d.h;
        t.vy = (this.rng() < 0.5 ? -1 : 1) * this.playH * 0.22;
        t.w = this.W * 0.5;
      } else if (kind === 'mine') {
        t.y = this.rrand(this.playTop + this.playH * 0.2, this.playBottom - this.playH * 0.2);
        t.r = this.playH * d.r;
      } else {
        t.side = this.rng() < 0.5 ? -1 : 1;          // -1 top wall, +1 bottom
        t.w = this.W * d.len;
        t.h = this.playH * 0.035;
      }
      // The mirror of the check in spawnFreeMote: a trap must not land ON a
      // collectable that is already sitting there. Motes are spawned before
      // traps as often as after, so guarding only one direction leaves half the
      // cases. Sweepers move through everything by design and are exempt.
      if (t.kind !== 'sweeper') {
        this.traps.push(t);
        // A collectable riding a gate is not where it will STAY: a moving gate
        // swings its opening by ±moveAmp and the tide slides every gap together,
        // so testing the instant a trap is born let a mote drift into a mine
        // afterwards (43 times in a 28-run sweep). Reserve the whole band it can
        // travel through instead of the point it happens to occupy.
        const drift = (this.world && this.world.tide) ? this.playH * this.world.tide.amp : 0;
        // a gate's swing, the tide's drift, or a bounty's own weave
        const slack = (m) => (m.ob ? (m.ob.moveAmp || 0) : 0) + (m.amp || 0) + drift;
        const clash = [...this.motes, ...this.powers].some(
          (m) => !m.taken && this.trapCovers(m.x, m.y, m.r, slack(m)));
        this.traps.pop();
        if (clash) return;                          // skip this one; another is along shortly
      }
      this.traps.push(t);
    }

    // A BOUNTY mote: pays double, and refuses to sit still for you. It rides a
    // sine wave across the corridor, so it is never simply "on the way" — you
    // have to decide to go and get it, which is the same greed the whole combo
    // system runs on, just louder.
    // Returns false when there was nowhere safe to put it, so the caller can try
    // again shortly instead of writing the whole 18-30s wait off.
    spawnBounty() {
      if (this.daily) return true;                 // the shared course stays identical
      const r = this.player.r * 1.0;
      const mid = this.playTop + this.playH * 0.5;
      // Sit strictly LEFT of the line every gate is born on (W + obstacleW), for
      // the same reason spawnFreeMote does: motes and gates scroll at one speed,
      // so a horizontal offset set at birth is set for good, and from here we
      // only ever travel further left.
      //
      // This used to spawn at W + obstacleW * 2 — to the RIGHT of that line. So
      // the bounty drifted ACROSS it, and any gate born during the ~0.4s crossing
      // was born INSIDE the bounty. After that the two were welded together at a
      // fixed offset, and the bounty spent its whole visible life weaving over
      // that gate's face, dipping in and out of solid bar. Measured on a parked
      // immortal probe: 24 bounties produced 1032 frames of a collectable sitting
      // inside a wall, all of it on screen. It is the double-value pickup, which
      // makes it the most tempting thing in the game to chase into a hazard.
      //
      // A bounty cannot get out of this the way a free mote does, by sitting in
      // a gap: it weaves across a third of the corridor and visits every band.
      // The only workable guarantee is that it never shares a column with a gate.
      const lead = this.scrollSpeed / 24;
      const x = Math.min(this.W + 20, this.W + this.obstacleW - r - lead);
      const margin = r * 0.6;
      for (const ob of this.obstacles) {
        if (x + r + margin >= ob.x && x - r - margin <= ob.x + ob.w) return false;
      }
      const amp = this.playH * this.rrand(0.22, 0.34);
      // A bounty does not sit still — it weaves across most of the corridor, so
      // it can arrive at a trap that was nowhere near it when it spawned. It was
      // the one collectable checked against nothing at all, and it was weaving
      // into mines. Reserve the whole sweep, not the point it starts from.
      if (this.trapCovers(x, mid, r, amp)) return false;
      this.motes.push({
        x, y: mid, r,
        taken: false, pulse: this.rrand(0, TAU), ob: null, gap: null,
        bounty: true,
        baseY: mid,
        amp,
        spd: this.rrand(1.1, 1.8),
        phase: this.rrand(0, TAU),
      });
      return true;
    }

    // One step of the chain, and the flow-entry moment that hangs off it.
    //
    // Extracted because BRITTLE feeds the same chain by SHATTERING a bar rather
    // than by collecting a mote, and a second copy of "combo += 1, retime the
    // window, remember the best, and fire FLOW! on exactly the right count"
    // would drift — as three copies of the gravity constant in this file
    // already have.
    chainUp() {
      this.combo += 1;
      // the window shrinks as the combo climbs — track the max so the HUD bar reads true
      this.comboTimerMax = clamp(3.6 - this.combo * 0.05, 2.2, 3.6) * (this.mod ? this.mod.comboTimeMul : 1);
      this.comboTimer = this.comboTimerMax;
      if (this.combo > this.bestComboRun) this.bestComboRun = this.combo;
      // flow entry moment
      if (this.combo === (this.mod ? this.mod.flowAt : 16)) {
        this.shake = Math.max(this.shake, 12);
        this.flash = 0.5;
        this.texts.add(this.player.x, this.player.y - 46, 'FLOW!', 'hsl(300 100% 72%)', 30);
        haptic([12, 8, 24]);
        Audio && this._sfx('flow');
        this.particles.burst(this.player.x, this.player.y, 30, { color: 'hsl(300 100% 72%)', spMax: 300, lifeMax: 1, sizeMax: 6, glow: true });
      }
    }

    collectMote(m) {
      this.chainUp();
      this.motesRun += 1;
      // a bounty counts twice: once for the chain, once again for the payout
      if (m.bounty) this.motesRun += 1;
      const mult = this.comboMult();
      const pts = Math.round(10 * mult * (m.bounty ? 2 : 1) * ((this.world && this.world.moteWorth) || 1));
      this.score += this.windPay(pts);

      const col = m.bounty ? 'hsl(45 100% 66%)' : this.moteColor();
      this.texts.add(m.x, m.y - 18, '+' + pts, col, (16 + Math.min(10, mult)) * (m.bounty ? 1.35 : 1));
      if (m.bounty) { this.flash = Math.max(this.flash, 0.3); haptic([10, 6, 16]); }
      this.particles.burst(m.x, m.y, 10 + Math.min(14, this.combo), {
        color: col, spMax: 180, lifeMax: 0.7, sizeMax: 4.5, glow: true,
      });
      this.flash = Math.max(this.flash, 0.12);
      Audio && this._sfx('collect', { combo: this.combo });
      haptic(6);
      if (this.tutorial) {
        const id = this.tutStage.id;
        if (id === 'motes') this.tutAdvance(1);
        else if (id === 'combo' && this.combo >= this.tutStage.goal) this.tutAdvance(this.tutStage.goal);
      }

      // milestone flashes
      if (this.combo % 10 === 0 && this.combo > 0) {
        this.texts.add(this.player.x, this.player.y - 40, 'x' + mult, col, 24);
      }
    }
    // Drive the soundtrack from the run itself. Called every frame but only
    // pushed to the audio engine when something actually moved — the scheduler
    // reads these values, it does not need to be told the same number 60×/s.
    scoreMusic() {
      if (!Audio || !Audio.music || this.attract) return;
      const m = Audio.music;

      // THE PIECE FIRST. Choosing a world resets the resting tempo, so it has to
      // happen before the pace is applied — the other way round, the first frame
      // of a run threw away the pace it had just calculated.
      // A MODE may claim the soundtrack. Normally the world owns it — that is
      // what makes each map feel like a place — but a mode built on an emotion
      // has to sound like that emotion wherever you play it. Losing the dread
      // because you happen to be on the pretty green map would be losing the
      // mode. Any mode without `song` leaves the world's choice alone.
      const md = this.mode;
      const map = this.world || (LUMEN.Cosmetics ? LUMEN.Cosmetics.def('deepfield') : null);
      const id = (md && md.song) || (map && map.id) || 'deepfield';
      if (id !== this._musSong) { this._musSong = id; m.setSong(id); m.setKey(0); this._musPace = -1; }

      // TEMPO — how fast the corridor is genuinely moving, normalised against
      // the opening speed so every mode maps onto the same 0..1 feel.
      const base = (this.W * 0.62) / 2.7;
      const pace = clamp(this.scrollSpeed / base - 1, 0, 1.6);
      if (Math.abs(pace - (this._musPace || 0)) > 0.02) { this._musPace = pace; m.setPace(pace); }

      // LAYERS — your chain. Each threshold brings an instrument in, so the
      // track thickens as the multiplier climbs and thins the moment it breaks.
      const flowAt = this.mod ? this.mod.flowAt : 16;
      const lvl = this.flowActive ? 3
        : this.combo >= flowAt * 0.6 ? 2
        : this.combo >= 4 ? 1 : 0;
      if (lvl !== this._musLvl) { this._musLvl = lvl; m.setIntensity(lvl); }

    }

    breakCombo() {
      if (this.combo >= 5) {
        this.texts.add(this.player.x, this.player.y - 30, T('comboLost'), 'hsl(0 80% 62%)', 16);
      }
      if (this.flowActive) Audio && this._sfx('flowEnd');
      // In GLUTTON losing the chain also shrinks you back to a size that fits, so
      // it is the one place a broken chain is good news. Give it its own sound.
      if (this.mode && this.mode.swell && this.combo >= 5) Audio && this._sfx('deflate');
      this.lastChain = this.combo;    // SPARK can hand exactly this back
      this.combo = 0;
      this.flowActive = false;
    }
    // ALOFT: what an award is worth right now. 1 everywhere else. Applied to the
    // things you EARN by acting -- motes and gates -- and deliberately NOT to
    // the per-second survival trickle, which would pay for sitting still at
    // altitude.
    windPay(n) { return this.mode && this.mode.wind ? Math.round(n * this.wind) : n; }

    comboMult() { return clamp(1 + Math.floor(this.combo / 4), 1, 12); }

    // ---- colors ----------------------------------------------------------
    // Hero colour comes from the equipped skin (brighter in flow); reward stays
    // gold; danger owns magenta — so the read holds whatever skin is on.
    skin() { return LUMEN.Cosmetics ? LUMEN.Cosmetics.skinDef() : { hue: 188, sat: 100, light: 60 }; }
    // A cycling skin sweeps around its own hue, not around zero: `rainbowSpan`
    // is how far it strays (undefined = the whole wheel) and `hue` is the centre
    // it strays from. Without this, "molten" skins meant to shimmer inside a
    // narrow band of reds ran the full spectrum like everything else.
    orbHue() {
      const s = this.skin();
      if (!s.rainbow) return s.hue;
      const t = this.elapsed * (s.rainbowSpeed || 60);
      if (!s.rainbowSpan) return t % 360;
      return (s.hue + Math.sin(t * (Math.PI / 180)) * s.rainbowSpan * 0.5 + 360) % 360;
    }
    orbColor(l) {
      const s = this.skin();
      const light = clamp((s.light != null ? s.light : 60) + (l || 0) * 8 + this.flow * 22, 0, 97);
      return `hsl(${this.orbHue()} ${s.sat != null ? s.sat : 100}% ${light}%)`;
    }
    moteColor() {
      const h = cbPalette().reward;
      const l = 66 + this.flow * 8 + (Store.highContrast ? 12 : 0);
      return `hsl(${h} 100% ${clamp(l, 0, 92)}%)`;
    }
    dangerColor(a) {
      const h = cbPalette().danger;
      const l = 60 + (Store.highContrast ? 10 : 0);
      return `hsla(${h} 95% ${l}% / ${a == null ? 1 : a})`;
    }
    // The colour of the BARS, which is the world's, not a constant.
    //
    // Choosing a world used to change the sky and nothing else -- the thing you
    // spend the whole run looking at was the same red in all seventeen. It is
    // the map's `gate` hue now, so a world you bought actually looks like one.
    //
    // Two rules keep that from costing anything:
    //   - Colour-vision presets and HIGH CONTRAST fall straight back to the
    //     fixed danger hue. Those settings exist so "this will kill you" is one
    //     colour everywhere, and a decoration must never outrank that.
    //   - `gate` is authored per map rather than reused from `wall` (the
    //     corridor edge), because three of the wall hues sit within 30 degrees
    //     of the gold mote -- rooftops is 10 degrees away. A test holds every
    //     gate hue at arm's length from the reward.
    gateColor(a) {
      if (Store.highContrast || Store.colorblind !== 'off') return this.dangerColor(a);
      const g = this.world && this.world.gate;
      if (g == null) return this.dangerColor(a);
      return `hsla(${g} 92% 62% / ${a == null ? 1 : a})`;
    }

    // ---- render ----------------------------------------------------------
    render() {
      const ctx = this.ctx;
      const { W, H } = this;
      const hue = lerp(this.hueBase, 305, this.flow);

      // The backdrop is painted across the whole canvas and OUTSIDE the stage
      // transform, so on a tablet the sky reaches both edges while the corridor
      // stays a phone-shaped column in the middle. On a phone stageX is 0 and
      // this is exactly what it always was.
      this.bg.draw(ctx, hue, this.flow);

      ctx.save();
      if (this.stageX) ctx.translate(this.stageX, 0);
      // screen shake (skipped when "reduce flashing" is on)
      if (this.shake > 0.3 && !calmVisuals()) {
        const s = this.shake;
        ctx.translate(rand(-s, s), rand(-s, s));
      }

      // ---- mode camera -------------------------------------------------------
      // VORTEX and MIRROR are camera transforms, not physics. Collision is
      // computed in world space either way, so the run is exactly as fair as
      // Classic — what changes is your ability to READ it, which is the skill
      // both modes are actually testing. Reduce-motion players get the tilt
      // damped right down rather than losing the mode.
      const md = this.mode;
      if (md && (md.rotate || md.mirror) && this.state !== State.MENU) {
        ctx.translate(W * 0.5, H * 0.5);
        if (md.mirror) ctx.scale(-1, 1);
        if (md.rotate) {
          const amp = md.rotate.amp * (calmVisuals() ? 0.25 : 1);
          this._tilt = Math.sin(this.elapsed * md.rotate.speed) * amp;
          ctx.rotate(this._tilt);
          // rotating a rectangle leaves corners bare — scale up to cover them
          ctx.scale(1.28, 1.28);
        }
        ctx.translate(-W * 0.5, -H * 0.5);
      }

      this.drawWalls(ctx, hue);
      this.drawWind(ctx);
      this.drawObstacles(ctx);
      this.drawTraps(ctx);
      this.drawScout(ctx);
      this.drawMotes(ctx);
      this.drawPowers(ctx);
      if (this.state !== State.MENU) this.drawPlayer(ctx);
      this.rings.draw(ctx);
      this.particles.draw(ctx);
      this.texts.draw(ctx);

      ctx.restore();

      // Everything below is drawn in STAGE coordinates too — the score, the item
      // buttons, the vignette, the tutorial. Without this translate they were
      // laid out against the corridor's width and then painted from the screen's
      // left edge, so on any viewport wider than h*0.62 — every iPad, every
      // landscape — the HUD sat out in the letterbox beside the playfield and
      // BLACKOUT darkened empty sky while charging x1.9.
      //
      // The item buttons' hit rects are stored in SCREEN space (the tap handler
      // reads clientX against the canvas), so drawItemButtons adds stageX when
      // it records them. Move one without the other and the buttons stop
      // working where they appear.
      ctx.save();
      if (this.stageX) ctx.translate(this.stageX, 0);

      // flow vignette + flashes (not shaken)
      this.drawOverlays(ctx);
      // the tutorial has its own guidance; the score HUD would just be noise
      // The chain lesson tells the player to watch the combo bar, so the HUD has to
      // be on screen for it — everywhere else in the tutorial it's just noise.
      const tutNeedsHUD = this.tutorial && this.tutStage && this.tutStage.id === 'combo';
      // Attract mode is scenery behind the menu — no score, no buttons, no coaching.
      if (!this.attract && (!this.tutorial || tutNeedsHUD) && (this.state === State.PLAY || this.state === State.PAUSE || this.state === State.DEAD)) {
        this.drawHUD(ctx);
        if (!this.tutorial) { this.drawActiveFx(ctx); this.drawItemButtons(ctx); }
      }
      // only coach genuinely new players — veterans don't need the hint every run
      if (!this.attract && this.state === State.PLAY && !this.hasFlipped && Store.runs < 3) this.drawOnboarding(ctx);
      if (this.tutorial && this.state === State.PLAY) this.drawTutorial(ctx);

      ctx.restore();
    }

    drawTutorial(ctx) {
      const st = this.tutStage;
      if (!st) return;
      const { W, H } = this;
      const cx = W / 2;
      const pop = this.tutBanner > 0 ? 1 + this.tutBanner * 0.12 : 1;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // step pips
      const n = TUT_STAGES.length, pipR = clamp(H * 0.006, 3.5, 6), gap = pipR * 4;
      const y0 = H * 0.155;
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * gap;
        ctx.beginPath(); ctx.arc(x, y0, pipR, 0, TAU);
        ctx.fillStyle = i < this.tut.stage ? 'hsl(150 90% 62%)' : i === this.tut.stage ? '#4df3ff' : 'rgba(255,255,255,0.22)';
        ctx.fill();
      }

      // title + hint
      ctx.save();
      ctx.translate(cx, H * 0.215);
      ctx.scale(pop, pop);
      ctx.font = `800 ${clamp(H * 0.042, 22, 40)}px "Orbitron", "Rajdhani", system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#4df3ff'; ctx.shadowBlur = 18;
      ctx.fillText(T(st.tk), 0, 0);
      ctx.restore();

      ctx.shadowBlur = 0;
      ctx.font = `600 ${clamp(H * 0.024, 13, 20)}px "Rajdhani", system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(234,246,255,0.72)';
      ctx.fillText(T(st.hk), cx, H * 0.268);

      // progress for the countable stages. The chain lesson reads the live combo —
      // its own counter only moves once the goal is met, which looked broken.
      if (st.unitKey) {
        const raw = st.id === 'combo' ? this.combo : this.tut.progress;
        const done = Math.min(raw, st.goal);
        ctx.font = `700 ${clamp(H * 0.022, 12, 18)}px "Rajdhani", system-ui, sans-serif`;
        ctx.fillStyle = '#4df3ff';
        ctx.fillText(done + ' / ' + st.goal + '  ' + T(st.unitKey), cx, H * 0.312);
      }

      // Skip affordance. On touch there is no Escape key, so draw a real tappable
      // pill instead of telling a phone player to press a key they don't have.
      const sy = H * 0.905;
      ctx.font = `700 ${clamp(H * 0.019, 11, 16)}px "Rajdhani", system-ui, sans-serif`;
      const label = T('skipTutorial');
      const tw = ctx.measureText(label).width;
      const pw = tw + 34, ph = clamp(H * 0.045, 30, 42);
      // Draw in STAGE space (the caller is already inside the stage translate);
      // store the tap rect in SCREEN space, because the tap handler reads clientX
      // against the canvas. Adding stageX to the drawn x as well put the pill a
      // whole column to the right of the words it is supposed to enclose — the
      // label was correct, the border was out in the letterbox, and the only
      // thing that skipped the tutorial was bare text with no button around it.
      // Invisible on a phone, where stageX is 0. Same shape as drawItemButtons.
      const skipX = cx - pw / 2;
      this._tutSkipRect = { x: skipX + this.stageX, y: sy - ph / 2, w: pw, h: ph };
      ctx.globalAlpha = 0.85;
      this.roundRect(ctx, skipX, this._tutSkipRect.y, pw, ph, ph / 2);
      ctx.fillStyle = 'rgba(10,14,32,0.6)'; ctx.fill();
      ctx.strokeStyle = 'rgba(120,200,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(234,246,255,0.7)';
      ctx.fillText(label, cx, sy);
      ctx.restore();
    }

    drawOnboarding(ctx) {
      const p = this.player;
      const a = 0.5 + 0.5 * Math.sin(this.elapsed * 6);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.55 + 0.45 * a;
      ctx.fillStyle = '#eaf6ff';
      ctx.shadowColor = '#4df3ff'; ctx.shadowBlur = 14;
      ctx.font = `700 ${clamp(this.H * 0.028, 15, 24)}px "Rajdhani", system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      const ty = clamp(p.y - p.r - 42, this.playTop + 26, this.playBottom - 20);
      ctx.fillText(T('tapToFlip'), p.x, ty);
      // up + down chevrons hugging the orb to show it swaps direction
      const chev = (cy, dir) => {
        const s = p.r * 0.7, off = p.r + 14 + 6 * a;
        ctx.beginPath();
        ctx.moveTo(p.x - s, cy + dir * (off + s * 0.9));
        ctx.lineTo(p.x, cy + dir * off);
        ctx.lineTo(p.x + s, cy + dir * (off + s * 0.9));
        ctx.lineWidth = 3; ctx.strokeStyle = '#4df3ff'; ctx.stroke();
      };
      chev(p.y, -1); chev(p.y, 1);
      ctx.restore();
    }

    drawWalls(ctx, hue) {
      const { W } = this;
      // Two stacked strokes fake the glow. shadowBlur on a full-width line means a
      // screen-wide offscreen blur pass twice per frame — far too expensive here.
      const MW = LUMEN.Cosmetics ? LUMEN.Cosmetics.mapDef() : null;
      const h = lerp(MW ? MW.wall : 196, 300, this.flow), a = 0.22 + this.flow * 0.28;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `hsla(${h} 92% 62% / ${a * 0.35})`;
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(0, this.playTop); ctx.lineTo(W, this.playTop); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, this.playBottom); ctx.lineTo(W, this.playBottom); ctx.stroke();
      ctx.strokeStyle = `hsla(${h} 92% 72% / ${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, this.playTop); ctx.lineTo(W, this.playTop); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, this.playBottom); ctx.lineTo(W, this.playBottom); ctx.stroke();
      // On a tablet the corridor is a column with sky either side. Closing the
      // rectangle makes that a frame instead of a crop — without these two
      // strokes the play area just stops, and a boundary with no edge reads as a
      // drawing fault. On a phone stageX is 0 and they sit off-screen, unseen.
      if (this.stageX) {
        ctx.strokeStyle = `hsla(${h} 92% 72% / ${a * 0.55})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0.5, this.playTop); ctx.lineTo(0.5, this.playBottom); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(W - 0.5, this.playTop); ctx.lineTo(W - 0.5, this.playBottom); ctx.stroke();
      }
      ctx.restore();
    }

    // ALOFT's wind, drawn. A number on a badge is not weather -- the player asked
    // to SEE it, and the mode is unteachable without it: you cannot discover
    // that height is a throttle if height looks like nothing.
    //
    // Streaks that lean the way the wind is pushing, denser and longer and more
    // opaque the harder it blows, and almost invisible below the calm line. They
    // are seeded off `distance` so they stream past with the world rather than
    // twinkling in place, and they are plain lines under 'lighter' -- no path
    // per particle, no allocation per frame.
    // Every path out of a run goes through here. A wind bed that outlives its run
    // is a hiss under the menu, which is the kind of bug nobody reports and
    // everybody hears.
    stopWind() {
      if (!this._windAudio) return;
      this._windAudio = false;
      Audio && Audio.windStop && Audio.windStop();
    }

    drawWind(ctx) {
      const wd = this.mode && this.mode.wind;
      if (!wd || this.attract) return;
      // 0 at the calm line, 1 at full gale. Below calm there is nothing to draw.
      const t = clamp((this.wind - 1) / (wd.hi - 1), 0, 1);
      if (t <= 0.02) return;
      if (calmVisuals() && t < 0.5) return;      // reduce-motion: only a real gale
      const n = Math.round(10 + 26 * t);
      const g = this.world && this.world.gate;
      const hue = g == null ? 196 : g;
      const d = this.distance * 0.6;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        // deterministic scatter: no rand() per frame, so the field is stable
        const fx = ((i * 73.13) % 100) / 100;
        const fy = ((i * 31.77) % 100) / 100;
        const sp = 0.55 + fx * 0.9;
        const x0 = this.W - ((d * sp + fx * this.W * 2.2) % (this.W * 1.25));
        const y0 = this.playTop + fy * this.playH;
        const len = (26 + 74 * t) * sp;
        // leans UP, because that is the way the wind is carrying you
        const rise = -len * 0.22 * t;
        ctx.strokeStyle = `hsla(${hue} 85% 82% / ${(0.14 + 0.42 * t) * (0.5 + fx * 0.5)})`;
        ctx.lineWidth = 1.4 + t * 2.2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + len, y0 + rise);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawObstacles(ctx) {
      ctx.save();
      const r = Math.min(8, this.obstacleW * 0.4);
      // colours are identical for every obstacle this frame — build the strings once
      // The lip was drawn at full alpha while the bar's own body is 0.62, so the
      // caps read as a separate brighter object stuck on the end rather than as
      // part of the bar. Close enough now to belong to it, still bright enough
      // to edge the opening -- which is the job the lip actually has.
      const colBody = this.gateColor(0.9), colLip = this.gateColor(0.8);
      // white lips give the opening a luminance edge that survives any colour deficiency
      const crispLips = Store.highContrast || Store.colorblind !== 'off';
      // Gates glow on EVERY quality tier. The orb, the motes and the walls all
      // light the scene regardless of tier, so a flat-shaded bar was the one
      // object on screen that looked like it belonged to a different game — and
      // it's the object you most need to read. Both passes here are stretched
      // blits of a tiny cached sprite, which is no dearer than the plain fill
      // they replace; the low tier just gets a tighter, dimmer halo.
      const richGlow = !LUMEN.Q || LUMEN.Q.glow;
      const sprite = barSprite(colBody);
      const pad = this.obstacleW * sprite._pad;

      // Work out every solid segment once, then draw the whole field twice: an
      // additive halo pass, then the bodies. Two passes over the same geometry is
      // what makes the gates sit in the same light as everything else on screen.
      // DREAD: how far into its reveal each gate is. Computed once per gate, then
      // applied to every pass below — the halo, the body and both lip passes —
      // or the parts drift out of step and a "hidden" wall keeps a bright edge.
      const rv = this.mode && this.mode.reveal;
      // BRITTLE: a shattered bar dissolves over a quarter second. Folding it in
      // HERE means the halo, the bodies and both lip passes all fade together —
      // the same reason DREAD's reveal is computed once, above.
      const brk = (ob) => (ob.broken ? Math.max(0, 1 - (this.elapsed - ob._brokeAt) * 4) : 1);
      if (rv) {
        const speed = Math.max(1, this.scrollSpeed);
        // DREAD's whole fairness rule is that the warning lasts longer than the
        // crossing does — 1.25s of sight against 0.78s to cross the playfield at
        // NORMAL. The speed ceiling stretches a full crossing (DIFFICULTY
        // .topSpeed), so the warning stretches with it. Leave this fixed and
        // VERY EASY shows a gate for barely longer than it takes to reach it:
        // the one mode built on not seeing what is coming becomes the one mode
        // that is unfair, at the setting chosen by the players least able to
        // absorb it.
        const at = rv.at * (this.crossSeconds / this.CROSS_TIME);
        for (const ob of this.obstacles) {
          const secondsAway = (ob.x - this.player.x) / speed;
          let a = clamp((at - secondsAway) / rv.fade, 0, 1);
          // the menu demo is a background, not a challenge — never a fog bank
          if (this.attract) a = Math.max(a, 0.55);
          ob._a = a * brk(ob);
        }
      } else {
        for (const ob of this.obstacles) ob._a = brk(ob);
      }

      const segs = [];
      for (const ob of this.obstacles) {
        if (ob._a <= 0) continue;
        let cursor = this.playTop;
        for (const g of ob.gaps) {
          const top = g.y - g.h * 0.5, bot = g.y + g.h * 0.5;
          if (top - cursor > 1) segs.push({ ob, y0: cursor, y1: top });
          cursor = bot;
        }
        if (this.playBottom - cursor > 1) segs.push({ ob, y0: cursor, y1: this.playBottom });
      }

      {
        const halo = barGlowSprite(colBody);
        // Toned down from 1.0/0.6. The bars were wearing a halo wide enough to
        // wash into each other and into the sky, which read as fog rather than
        // as light coming off an object -- and it buried the painted scenes the
        // worlds were given. The bar still throws light; it no longer floods.
        const hpad = this.obstacleW * halo._pad * (richGlow ? 0.40 : 0.26);
        ctx.globalCompositeOperation = 'lighter';
        const base = richGlow ? 0.46 : 0.34;
        for (const s of segs) {
          // A stub of a bar — the sliver above a gap that sits near the corridor
          // edge — used to stretch the halo into a wide horizontal smear: the
          // sprite is a vertical column of glow, and squashing it to a few
          // pixels tall turns its side falloff into a red streak reaching half
          // a screen sideways. Let the side glow never exceed the segment's own
          // height and a stub glows like a stub instead of a laser.
          const hp = Math.min(hpad, s.y1 - s.y0);
          ctx.globalAlpha = base * s.ob._a;
          ctx.drawImage(halo, s.ob.x - hp, s.y0, s.ob.w + hp * 2, s.y1 - s.y0);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      for (const s of segs) {
        ctx.globalAlpha = s.ob._a;
        ctx.drawImage(sprite, s.ob.x - pad, s.y0, s.ob.w + pad * 2, s.y1 - s.y0);
      }
      ctx.globalAlpha = 1;

      // bright inner lips framing every opening
      ctx.fillStyle = crispLips ? '#ffffff' : colLip;
      const cap = crispLips ? null : ((this.world && this.world.gateCap) || null);
      for (const ob of this.obstacles) {
        ctx.globalAlpha = ob._a;
        for (const g of ob.gaps) {
          const top = g.y - g.h * 0.5, bot = g.y + g.h * 0.5;
          if (cap === 'torii') {
            // The bars keep their danger colour — that is a promise — but their
            // ENDS become torii lintels: a kasagi that overhangs the pillar
            // with upswept tips, and a slimmer nuki beam beneath it. Shape is
            // free where hue is not. Skipped in colourblind/high-contrast
            // modes, whose white lips are doing accessibility work.
            const ov = Math.max(4, ob.w * 0.22);
            if (top > this.playTop + 2) {
              this.roundRect(ctx, ob.x - ov, top - 7, ob.w + ov * 2, 6, 3); ctx.fill();
              ctx.fillRect(ob.x - ov, top - 10, 3, 6);
              ctx.fillRect(ob.x + ob.w + ov - 3, top - 10, 3, 6);
              this.roundRect(ctx, ob.x - ov * 0.4, top + 2, ob.w + ov * 0.8, 3, 1.5); ctx.fill();
            }
            if (bot < this.playBottom - 2) {
              this.roundRect(ctx, ob.x - ov, bot + 1, ob.w + ov * 2, 6, 3); ctx.fill();
              ctx.fillRect(ob.x - ov, bot + 4, 3, 6);
              ctx.fillRect(ob.x + ob.w + ov - 3, bot + 4, 3, 6);
              this.roundRect(ctx, ob.x - ov * 0.4, bot - 5, ob.w + ov * 0.8, 3, 1.5); ctx.fill();
            }
          } else if (cap === 'capstone') {
            // The bars keep their hue -- that is a promise -- but their ENDS
            // become fairy chimneys: a narrow neck and a domed slab WIDER than
            // it, with an underside bulge so it reads as a boulder and not a
            // beam. Shape is free where hue is not, and every opening in the
            // corridor is framed by two of them, so the theme reaches the thing
            // the player is actually looking at. Skipped under colourblind and
            // high contrast, whose white lips are doing accessibility work --
            // the same contract torii has.
            const ov = Math.max(4, ob.w * 0.30);
            if (top > this.playTop + 2) {
              ctx.fillRect(ob.x + ob.w * 0.30, top - 11, ob.w * 0.40, 5);
              this.roundRect(ctx, ob.x - ov, top - 7, ob.w + ov * 2, 6, 3); ctx.fill();
              ctx.beginPath();
              ctx.ellipse(ob.x + ob.w * 0.5, top - 1, (ob.w + ov * 2) * 0.46, 2.5, 0, 0, Math.PI);
              ctx.fill();
            }
            if (bot < this.playBottom - 2) {
              ctx.fillRect(ob.x + ob.w * 0.30, bot + 6, ob.w * 0.40, 5);
              this.roundRect(ctx, ob.x - ov, bot + 1, ob.w + ov * 2, 6, 3); ctx.fill();
              ctx.beginPath();
              ctx.ellipse(ob.x + ob.w * 0.5, bot + 1, (ob.w + ov * 2) * 0.46, 2.5, 0, Math.PI, TAU);
              ctx.fill();
            }
          } else {
            if (top > this.playTop + 2) { this.roundRect(ctx, ob.x, top - 5, ob.w, 5, 2); ctx.fill(); }
            if (bot < this.playBottom - 2) { this.roundRect(ctx, ob.x, bot, ob.w, 5, 2); ctx.fill(); }
          }
        }
      }
      ctx.globalAlpha = 1;
      // and a hot additive kiss along those lips so the opening glows too
      if (richGlow) {
        ctx.globalCompositeOperation = 'lighter';
        // 0.5 -> 0.32 for the same reason as the halo above: the opening should
        // be edged in light, not smeared with it.
        ctx.fillStyle = withAlpha(colLip, 0.16);
        for (const ob of this.obstacles) {
          ctx.globalAlpha = ob._a;
          for (const g of ob.gaps) {
            const top = g.y - g.h * 0.5, bot = g.y + g.h * 0.5;
            if (top > this.playTop + 2) { this.roundRect(ctx, ob.x - 2, top - 7, ob.w + 4, 8, 3); ctx.fill(); }
            if (bot < this.playBottom - 2) { this.roundRect(ctx, ob.x - 2, bot - 1, ob.w + 4, 8, 3); ctx.fill(); }
          }
        }
        ctx.globalAlpha = 1;
      }

      // ---- BRITTLE: the fault ----
      // Drawn last, on top of the bar it belongs to.
      //
      // The primary channel is SHAPE AND POSITION, never colour and never
      // motion: a notched chevron biting into the opening, pointing at the gap.
      // Nothing else in the game owns that outline — motes are diamonds,
      // power-ups hexagons, hazards long bars — so it survives greyscale. It is
      // filled from moteColor() while the bar keeps dangerColor(), so it rides
      // the reward-vs-danger axis all four colour-vision presets already re-hue;
      // no new hue is introduced anywhere.
      if (this.mode && this.mode.fault) {
        const calm = calmVisuals();
        ctx.save();
        for (const ob of this.obstacles) {
          const b = this.faultBand(ob);
          if (!b || ob._a <= 0) continue;
          const h = b.y1 - b.y0;
          if (h < 2) continue;
          // A slow breathe when motion is allowed; a static outline when it is
          // not. Nothing is lost either way, because the pulse was never the
          // channel carrying the information.
          const br = calm ? 1 : 0.86 + 0.14 * Math.sin(this.elapsed * 7.5 + (ob.faultPhase || 0));
          ctx.globalAlpha = ob._a * (this.attract ? 0.6 : 1) * (calm ? 0.9 : br);
          // The notch points INTO the opening, so the shape itself says which
          // way to aim: side -1 sits above the gap and bites downward.
          const inward = ob.faultSide < 0 ? 1 : -1;
          const x0 = ob.x - 1, x1 = ob.x + ob.w + 1;
          const yFlat = ob.faultSide < 0 ? b.y0 : b.y1;
          const yTip = ob.faultSide < 0 ? b.y1 : b.y0;
          ctx.beginPath();
          ctx.moveTo(x0, yFlat);
          ctx.lineTo(x1, yFlat);
          ctx.lineTo(x1, yTip - inward * h * 0.34);
          ctx.lineTo((x0 + x1) * 0.5, yTip);
          ctx.lineTo(x0, yTip - inward * h * 0.34);
          ctx.closePath();
          ctx.fillStyle = this.moteColor();
          ctx.fill();
          // High contrast and every colour-vision preset get a white luminance
          // edge, which no deficiency can lose. `crispLips` is the same flag the
          // lip pass above already computes.
          if (crispLips) {
            ctx.strokeStyle = 'rgba(255,255,255,.92)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      ctx.restore();
    }

    // SCOUT: draw the line through the openings ahead. It doesn't fly for you —
    // you still have to get on the line — it just answers "where am I aiming?"
    // which is the question BLACKOUT and dense gate runs take away from you.
    drawScout(ctx) {
      if (!(this.fx.scout > 0)) return;
      const gates = this.obstacles
        .filter((ob) => ob.x + ob.w > this.player.x)
        .sort((a, b) => a.x - b.x)
        .slice(0, 4);
      if (!gates.length) return;
      const fade = clamp(this.fx.scout / 1.2, 0, 1);   // fades out in its last beat
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const col = `hsl(${POWER_DEF.scout.hue} 95% 66%)`;
      ctx.strokeStyle = col;
      ctx.setLineDash([6, 7]);
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 * fade;
      ctx.beginPath();
      ctx.moveTo(this.player.x, this.player.y);
      for (const ob of gates) {
        // aim for whichever opening of this gate is cheapest from the last point
        let g = ob.gaps[0];
        for (const c of ob.gaps) if (Math.abs(c.y - this.player.y) < Math.abs(g.y - this.player.y)) g = c;
        ctx.lineTo(ob.x + ob.w * 0.5, g.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // a ring on each opening, so the target reads even where the line is faint
      ctx.globalAlpha = 0.65 * fade;
      for (const ob of gates) {
        let g = ob.gaps[0];
        for (const c of ob.gaps) if (Math.abs(c.y - this.player.y) < Math.abs(g.y - this.player.y)) g = c;
        ctx.beginPath();
        ctx.arc(ob.x + ob.w * 0.5, g.y, this.player.r * 1.5, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawMotes(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const moteSkin = (this.world && this.world.moteSkin) || null;
      const col = this.moteColor();
      const halo = glowSprite(col);
      // The bounty is bigger, hotter and ringed — it has to be obviously worth a
      // detour BEFORE you commit to one, not a surprise after you land on it.
      const bCol = `hsl(45 100% ${70 + this.flow * 8}%)`;
      const bHalo = glowSprite(bCol);
      for (const m of this.motes) {
        const pulse = 0.75 + 0.25 * Math.sin(m.pulse);
        const mc = m.bounty ? bCol : col;
        // soft halo as a blit (was shadowBlur), then the crisp diamond + core
        ctx.globalAlpha = m.bounty ? 0.95 : 0.75;
        const hr = m.r * (m.bounty ? 3.4 : 2.4) * pulse;
        ctx.drawImage(m.bounty ? bHalo : halo, m.x - hr, m.y - hr, hr * 2, hr * 2);
        if (m.bounty) {
          ctx.globalAlpha = 0.45 + 0.3 * pulse;
          ctx.strokeStyle = bCol; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.r * 2.2 * pulse, m.pulse, m.pulse + Math.PI * 1.4);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = mc;
        if (moteSkin === 'fish') {
          // The cat map's pickups are little gold fish. The COLOUR is untouched
          // — reward gold is a promise to colourblind players — and a compact
          // fish is still nothing like a hexagon power-up or a long hazard bar,
          // which is what the shape channel exists to keep apart.
          ctx.save();
          ctx.translate(m.x, m.y);
          ctx.rotate(Math.sin(m.pulse * 0.8) * 0.25);
          const fs = m.r * 1.35 * pulse;
          ctx.beginPath(); ctx.ellipse(0, 0, fs, fs * 0.58, 0, 0, TAU); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(fs * 0.85, 0); ctx.lineTo(fs * 1.55, -fs * 0.55); ctx.lineTo(fs * 1.55, fs * 0.55);
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(-fs * 0.42, -fs * 0.1, m.r * 0.28, 0, TAU); ctx.fill();
          ctx.restore();
        } else {
          ctx.save();
          ctx.translate(m.x, m.y); ctx.rotate(Math.PI / 4 + m.pulse * 0.3);
          const s = m.r * 1.5 * pulse;
          ctx.fillRect(-s / 2, -s / 2, s, s);
          ctx.restore();
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 0.4, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }

    // Hexagons, so a power-up never reads as a mote (diamond) or a bar (rect).
    drawPowers(ctx) {
      if (!this.powers.length) return;
      ctx.save();
      for (const w of this.powers) {
        const def = POWER_DEF[w.type];
        const pulse = 0.85 + 0.15 * Math.sin(w.pulse);
        const col = `hsl(${def.hue} 95% 66%)`;
        const R = w.r * pulse;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const hr = R * 2.3;
        ctx.globalAlpha = 0.75;
        ctx.drawImage(glowSprite(col), w.x - hr, w.y - hr, hr * 2, hr * 2);
        ctx.restore();
        // hexagon body
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = w.pulse * 0.35 + i * (TAU / 6);
          const x = w.x + Math.cos(a) * R, y = w.y + Math.sin(a) * R;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = `hsla(${def.hue} 95% 60% / 0.35)`;
        ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.stroke();
        // glyph
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `800 ${Math.round(R * 1.05)}px "Orbitron", system-ui, sans-serif`;
        ctx.fillText(def.glyph, w.x, w.y + R * 0.04);
      }
      ctx.restore();
    }

    // Held items, drawn as real buttons along the bottom. Tapping one fires it —
    // the hit-test lives in the canvas press handler, which checks these rects
    // before treating the tap as a flip.
    drawItemButtons(ctx) {
      const types = ITEM_TYPES.filter((t) => (this.hand[t] || 0) > 0);
      this._itemRects = [];
      if (!types.length) return;
      const { W, H } = this;
      let r = clamp(H * 0.042, 26, 44);
      let gap = r * 0.7;
      // Six is reachable: three bought (the cap) plus three found in the
      // corridor with auto-use off. At the natural size that row is 555px wide
      // and an iPhone stage is 393, so the outermost buttons fell off BOTH ends
      // — neither drawn nor hit-tested. The one on the right is SPARK, the most
      // expensive item in the shop at 340 shards, and with Digit1-3 only mapping
      // the first three held types there was no other way to fire it for the
      // rest of that run.
      //
      // So the row shrinks to fit instead of overflowing. Six buttons on the
      // narrowest phone come out around 30px across, still a comfortable target.
      const room = W - clamp(W * 0.06, 12, 40);
      const natural = types.length * (r * 2) + (types.length - 1) * gap;
      if (natural > room) {
        const k = room / natural;
        r *= k; gap *= k;
      }
      const totalW = types.length * (r * 2) + (types.length - 1) * gap;
      let x = W / 2 - totalW / 2 + r;
      const y = H - r - clamp(H * 0.03, 12, 30);

      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const t of types) {
        const def = POWER_DEF[t];
        const col = `hsl(${def.hue} 95% 66%)`;
        // + stageX: these are read by the tap handler in SCREEN space, while the
        // button itself is drawn inside the stage translate.
        this._itemRects.push({ type: t, x: x - r + this.stageX, y: y - r, w: r * 2, h: r * 2 });

        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = 'rgba(8,12,28,0.82)'; ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.45;
        const hr = r * 1.25;
        ctx.drawImage(glowSprite(col), x - hr, y - hr, hr * 2, hr * 2);
        ctx.restore();

        ctx.fillStyle = col;
        ctx.font = `800 ${Math.round(r * 0.9)}px "Orbitron", system-ui, sans-serif`;
        ctx.fillText(def.glyph, x, y + 1);

        const n = this.hand[t];
        if (n > 1) {
          ctx.fillStyle = '#fff';
          ctx.font = `700 ${Math.round(r * 0.42)}px "Rajdhani", system-ui, sans-serif`;
          ctx.fillText('×' + n, x + r * 0.62, y + r * 0.62);
        }
        x += r * 2 + gap;
      }
      ctx.restore();
    }

    // Small timers so the player can see what's running and how long is left.
    // A small live dot whenever voice control is actually listening. Without it
    // there is no way to tell "the game didn't hear me" from "the feature isn't on".
    drawMicIndicator(ctx) {
      const V = LUMEN.Voice;
      if (!V || !V.listening) return;
      const { W, H } = this;
      const r = clamp(H * 0.008, 4, 7);
      const x = W - clamp(W * 0.05, 16, 46), y = (this.safeTop || 0) + H * 0.03;
      const pulse = 0.55 + 0.45 * Math.sin(this.elapsed * 4);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `hsla(150 90% 62% / ${0.35 * pulse})`;
      ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `hsl(150 90% ${58 + 12 * pulse}%)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // Say plainly, on the canvas, that this run doesn't count. A cheated frame
    // must never be mistakable for a real one — in a screenshot least of all.
    drawCheatBadge(ctx) {
      if (!this.cheated) return;
      const { W, H } = this;
      const s = clamp(H * 0.016, 10, 14);
      ctx.save();
      ctx.font = `800 ${s}px "Orbitron", "Rajdhani", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = T('cheatBadge');
      const w = ctx.measureText(label).width + 22, h = s + 14;
      const x = W * 0.5;
      // Sit above the item buttons when any are on screen — they share the bottom
      // centre, and a warning that's illegible under three glyphs warns nobody.
      let floor = H;
      if (this._itemRects && this._itemRects.length) {
        for (const b of this._itemRects) floor = Math.min(floor, b.y);
      }
      const y = Math.max(h, floor - h * 0.75);
      ctx.fillStyle = 'rgba(255,209,92,0.14)';
      this.roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,209,92,0.55)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'hsl(45 95% 70%)';
      ctx.fillText(label, x, y);
      ctx.restore();
    }

    drawActiveFx(ctx) {
      this.drawModeBadge(ctx);
      this.drawMicIndicator(ctx);
      this.drawCheatBadge(ctx);
      const items = [];
      if (this.shield) items.push({ def: POWER_DEF.shield, frac: 1 });
      for (const k of ['magnet', 'slow', 'scout', 'anchor']) {
        if (this.fx[k] > 0) items.push({ def: POWER_DEF[k], frac: this.fx[k] / POWER_DEF[k].dur });
      }
      if (!items.length) return;
      const { H } = this;
      const r = clamp(H * 0.022, 14, 22);
      let x = clamp(this.W * 0.04, 14, 44) + r;
      const y = H * 0.05 + r;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const it of items) {
        const col = `hsl(${it.def.hue} 95% 66%)`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = 'rgba(6,10,26,0.75)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 3; ctx.stroke();
        // remaining-time arc
        ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(it.frac, 0, 1));
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = col;
        ctx.font = `800 ${Math.round(r * 0.95)}px "Orbitron", system-ui, sans-serif`;
        ctx.fillText(it.def.glyph, x, y + 1);
        x += r * 2.5;
      }
      ctx.restore();
    }

    drawTrail(ctx) {
      const p = this.player;
      const style = LUMEN.Cosmetics ? LUMEN.Cosmetics.trailDef().style : 'dust';
      const hue = this.orbHue();
      const n = p.trail.length;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (style === 'echo') {
        // expanding rings left behind the orb
        ctx.lineWidth = 2;
        for (let i = 0; i < n; i += 3) {
          const t = p.trail[i];
          const k = 1 - i / n;
          ctx.globalAlpha = k * 0.45;
          ctx.strokeStyle = `hsl(${hue} 100% ${62 + k * 20}%)`;
          ctx.beginPath(); ctx.arc(t.x, t.y, p.r * (0.8 + (1 - k) * 2.2), 0, TAU); ctx.stroke();
        }
      } else if (style === 'ribbon') {
        // connected tapering light ribbon
        const rc = `hsl(${hue} 100% 65%)`;
        ctx.strokeStyle = rc; ctx.lineCap = 'round';
        for (let i = 0; i < n - 1; i++) {
          const k = 1 - i / n;
          ctx.globalAlpha = k * 0.5;
          ctx.lineWidth = p.r * 1.5 * k;
          ctx.beginPath(); ctx.moveTo(p.trail[i].x, p.trail[i].y); ctx.lineTo(p.trail[i + 1].x, p.trail[i + 1].y); ctx.stroke();
        }
      } else if (style === 'thread') {
        // a single hairline drawn through every point — the tidiest trail there is
        ctx.strokeStyle = `hsl(${hue} 100% 72%)`;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, p.trail[i].x, p.trail[i].y);
        ctx.stroke();
        ctx.lineWidth = 5; ctx.globalAlpha = 0.16; ctx.stroke();   // soft outer bloom
      } else if (style === 'wake') {
        // twin arcs peeling off behind you, like a boat's wake
        ctx.lineWidth = 2; ctx.lineCap = 'round';
        for (let i = 0; i < n - 1; i++) {
          const k = 1 - i / n;
          const spread = p.r * (0.4 + (1 - k) * 2.4);
          ctx.globalAlpha = k * 0.42;
          ctx.strokeStyle = `hsl(${hue} 100% ${64 + k * 18}%)`;
          for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(p.trail[i].x, p.trail[i].y + s * spread);
            ctx.lineTo(p.trail[i + 1].x, p.trail[i + 1].y + s * spread * 1.12);
            ctx.stroke();
          }
        }
      } else if (style === 'shard') {
        // angular chips instead of soft dots
        for (let i = n - 1; i >= 0; i--) {
          const t = p.trail[i], k = 1 - i / n;
          const s = p.r * 0.9 * k;
          ctx.globalAlpha = k * 0.6;
          ctx.fillStyle = `hsl(${hue} 100% ${66 + k * 16}%)`;
          ctx.save();
          ctx.translate(t.x, t.y); ctx.rotate(i * 0.7 + this.elapsed * 2);
          ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.7, 0);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      } else if (style === 'void') {
        // Darkness carved OUT of the sky, not light added to it — and that is
        // exactly why this branch has to leave `lighter`. In additive blending
        // black is a no-op, so a void trail drew nothing and fell through to the
        // default: an elite 9,000-shard trail, and one third of the £5.99
        // Nightfall set, rendering byte-identical to free `dust`.
        //
        // A dark shape on a dark sky is invisible without a rim, so each blot
        // gets one in the orb's own hue — the same trick the rings use.
        ctx.globalCompositeOperation = 'source-over';
        for (let i = n - 1; i >= 0; i--) {
          const t = p.trail[i];
          const k = 1 - i / n;
          const r = p.r * (0.5 + k * 0.8);
          ctx.globalAlpha = k * 0.82;
          ctx.fillStyle = 'rgba(3,4,12,0.94)';
          ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, TAU); ctx.fill();
          ctx.globalAlpha = k * 0.5;
          ctx.lineWidth = Math.max(0.6, p.r * 0.15 * k);
          ctx.strokeStyle = `hsl(${hue} 92% 70%)`;
          ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, TAU); ctx.stroke();
        }
      } else if (style === 'pawprints') {
        // Footprints, not a stream: every 3rd sample is one paw print on an
        // alternating side of the path. Heading uses a VIRTUAL horizontal step —
        // trail samples all share the player's fixed x, so a real atan2 between
        // them is ±90° everywhere and undefined at a flip apex.
        const sk = this.skin();
        for (let i = 3; i < n; i += 3) {
          const t = p.trail[i], prev = p.trail[i - 3];
          const k = 1 - i / n;
          const side = (Math.floor(i / 3) % 2 ? 1 : -1);
          const ang = Math.atan2(t.y - prev.y, p.r * 1.6);
          const sc = 0.6 + 0.4 * k;
          ctx.save();
          ctx.translate(t.x, t.y + side * 0.55 * p.r);
          ctx.rotate(ang);
          ctx.globalAlpha = k * 0.55;
          ctx.fillStyle = `hsl(${hue} ${sk.sat != null ? sk.sat : 85}% ${66 + k * 14}%)`;
          ctx.beginPath(); ctx.arc(0, 0, 0.26 * p.r * sc, 0, TAU); ctx.fill();
          // toes at 0.14r — 0.11r did not resolve as toes at game size
          for (const [tx, ty] of [[-0.22, -0.30], [0, -0.36], [0.22, -0.30]]) {
            ctx.beginPath(); ctx.arc(tx * p.r * sc, ty * p.r * sc, 0.14 * p.r * sc, 0, TAU); ctx.fill();
          }
          ctx.restore();
        }
      } else if (style === 'petalfall') {
        // Petals settle off the flight line and flutter wider as they age.
        for (let i = 0; i < n; i += 2) {
          const t = p.trail[i], k = 1 - i / n, age = 1 - k;
          const px = t.x;
          const py = t.y + p.r * 0.5 * age + Math.sin(this.elapsed * 2.8 + i * 1.3) * p.r * 0.35 * age;
          const sz = p.r * (0.30 + 0.38 * k);
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(i * 0.9 + this.elapsed * 1.8);
          ctx.globalAlpha = k * 0.65;
          // palest toward the TAIL: 74 + age*10, not +k*10 — the spec's own
          // formula contradicted its prose and was caught in review.
          ctx.fillStyle = `hsl(${(hue + 8 + i * 2) % 360} 90% ${74 + age * 10}%)`;
          ctx.beginPath();
          ctx.moveTo(0, -sz);
          ctx.quadraticCurveTo(0.65 * sz, 0, 0, sz);
          ctx.quadraticCurveTo(-0.65 * sz, 0, 0, -sz);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      } else if (style === 'stardust') {
        // A wake of four-point stars; every third is bigger and turned 45°, so
        // the line mixes plus-stars and x-stars the way a starfield does.
        ctx.lineCap = 'round';
        for (let i = 0; i < n; i++) {
          const t = p.trail[i], k = 1 - i / n;
          const big = i % 3 === 0;
          const a = p.r * 0.34 * (0.5 + 0.5 * k) * (big ? 1.6 : 1);
          ctx.save();
          ctx.translate(t.x, t.y);
          ctx.rotate((big ? Math.PI / 4 : 0) + i * 0.15);
          ctx.globalAlpha = k * (big ? 0.65 : 0.4);
          ctx.strokeStyle = `hsl(${(hue + (i % 2 ? 30 : 0)) % 360} 85% ${72 + k * 16}%)`;
          ctx.lineWidth = Math.max(1, 0.12 * p.r * k);
          ctx.beginPath(); ctx.moveTo(-a, 0); ctx.lineTo(a, 0);
          ctx.moveTo(0, -a); ctx.lineTo(0, a); ctx.stroke();
          ctx.restore();
        }
      } else if (style === 'afterimage') {
        // VHS channel separation degrading down the tape: a cool and a warm
        // ghost of the orb drifting apart, with horizontal tape wobble.
        for (let i = 0; i < n; i += 2) {
          const t = p.trail[i], k = 1 - i / n, age = 1 - k;
          const wob = Math.sin(i * 2.7 + this.elapsed * 13) * p.r * 0.12 * age;
          const split = p.r * (0.15 + 0.65 * age);
          const sz = p.r * 0.8 * k * 1.9;
          ctx.globalAlpha = k * 0.4;
          const warm = glowSprite(`hsl(${hue} 100% 62%)`);
          const cool = glowSprite(`hsl(${(hue + 195) % 360} 100% 62%)`);
          ctx.drawImage(warm, t.x + wob - split - sz, t.y - sz, sz * 2, sz * 2);
          ctx.drawImage(cool, t.x + wob + split - sz, t.y - sz, sz * 2, sz * 2);
        }
      } else if (style === 'wisp') {
        // Smoke crescents that rise off the flight path and sway as they go.
        ctx.lineCap = 'round';
        for (let i = 0; i < n; i += 2) {
          const t = p.trail[i], k = 1 - i / n, age = 1 - k;
          const wx = t.x + Math.sin(this.elapsed * 2.4 + i * 0.9) * p.r * 0.5 * age;
          const wy = t.y - p.r * 1.7 * age;
          ctx.globalAlpha = k * 0.5;
          ctx.strokeStyle = `hsl(${hue} 45% ${80 + k * 12}%)`;
          ctx.lineWidth = Math.max(1, 0.14 * p.r);
          const rr = p.r * (0.35 + 0.45 * age);
          const start = i * 0.8 + this.elapsed * 1.2;
          ctx.beginPath(); ctx.arc(wx, wy, rr, start, start + Math.PI * 1.2); ctx.stroke();
        }
      } else if (style === 'loong') {
        // The dragon body. Trail samples are a vertical column (the player's x
        // never moves), so the undulation is in X — the body swims side to side
        // behind the pearl. A Y-sine here would be longitudinal and invisible,
        // which review caught before it shipped.
        ctx.lineCap = 'round';
        let fins = 0;
        for (let i = 0; i < n - 1; i++) {
          const k = 1 - i / n, age = 1 - k;
          const amp = p.r * (0.35 + 0.65 * age);
          const ox = (j) => p.trail[j].x + amp * Math.sin(j * 0.55 - this.elapsed * 9);
          // hue drifts down the body but never past -32: at the rainbow's low
          // end a -40 shift landed within 4° of the danger reds.
          const bh = (hue + 16 - Math.min(32, 40 * age) + 360) % 360;
          ctx.globalAlpha = k * 0.55;
          ctx.strokeStyle = `hsl(${bh} 95% ${58 + k * 12}%)`;
          ctx.lineWidth = Math.max(1, p.r * 1.0 * (0.35 + 0.65 * k));
          ctx.beginPath();
          ctx.moveTo(ox(i), p.trail[i].y);
          ctx.lineTo(ox(i + 1), p.trail[i + 1].y);
          ctx.stroke();
          // dorsal fins: sparse, capped, off the body in ±x
          if (i % 7 === 2 && fins < 4) {
            fins++;
            const fx = ox(i), fy = p.trail[i].y;
            const m = (fins % 2 ? 1 : -1);
            ctx.globalAlpha = k * 0.5;
            ctx.fillStyle = `hsl(${(bh + 14) % 360} 95% 70%)`;
            ctx.beginPath();
            ctx.moveTo(fx + m * 0.3 * p.r, fy - 0.25 * p.r);
            ctx.lineTo(fx + m * 0.95 * p.r, fy);
            ctx.lineTo(fx + m * 0.3 * p.r, fy + 0.25 * p.r);
            ctx.closePath(); ctx.fill();
          }
        }
      } else if (style === 'halo') {
        // Hollow rings rather than filled dots. `halo` is the payoff for a
        // 40-chain, so it should read as something given rather than bought —
        // and it too was drawing the free default until now.
        ctx.lineWidth = 1.6;
        for (let i = 0; i < n; i += 2) {
          const t = p.trail[i];
          const k = 1 - i / n;
          ctx.globalAlpha = k * 0.6;
          ctx.strokeStyle = `hsl(${hue} 100% ${70 + k * 20}%)`;
          ctx.beginPath(); ctx.arc(t.x, t.y, p.r * (1.15 - k * 0.3), 0, TAU); ctx.stroke();
          ctx.globalAlpha = k * 0.26;
          ctx.beginPath(); ctx.arc(t.x, t.y, p.r * (1.65 - k * 0.5), 0, TAU); ctx.stroke();
        }
      } else {
        // the colour is constant per style (except prism), so resolve it once
        const baseCol = style === 'comet' ? this.orbColor(0.6)
          : style === 'spark' ? this.orbColor(0.7)
          : style === 'embers' ? `hsl(${(hue + 22) % 360} 100% 60%)` : this.orbColor(0.6);
        // sprite blits instead of arc + shadowBlur: the trail is 9-18 points and
        // a blurred fill per point was one of the biggest per-frame costs
        const baseSprite = glowSprite(baseCol);
        for (let i = n - 1; i >= 0; i--) {
          const t = p.trail[i];
          const k = 1 - i / n;
          let size = p.r * 0.8 * k, alpha = k * 0.5, spr = baseSprite;
          if (style === 'comet') { size = p.r * 1.05 * k; alpha = k * 0.62; }
          else if (style === 'prism') { spr = glowSprite(`hsl(${(hue + i * 18) % 360} 100% 65%)`); alpha = k * 0.6; }
          else if (style === 'spark') { size = p.r * (0.35 + 0.5 * k) * (i % 2 ? 1 : 0.6); alpha = k * 0.7; }
          // embers drift and cool as they fall behind; pulse breathes along its length
          else if (style === 'embers') {
            size = p.r * (0.25 + 0.55 * k) * (0.7 + 0.5 * Math.sin(i * 1.7));
            alpha = k * k * 0.8;
            spr = glowSprite(`hsl(${(hue + 18 + i * 3) % 360} 100% ${58 - i}%)`);
          } else if (style === 'pulse') {
            const beat = 0.55 + 0.45 * Math.sin(this.elapsed * 9 - i * 0.55);
            size = p.r * 0.75 * k * (0.6 + beat * 0.9);
            alpha = k * 0.55 * (0.45 + beat * 0.55);
          }
          ctx.globalAlpha = alpha;
          const rr = size * 1.9;
          ctx.drawImage(spr, t.x - rr, t.y - rr, rr * 2, rr * 2);
        }
      }
      ctx.restore();
    }

    drawPlayer(ctx) {
      const p = this.player;
      if (!p.alive) return;
      this.drawTrail(ctx);

      // post-revive shield: a visible pulse so the grace period is legible
      if (this.invuln > 0) {
        const k = 0.5 + 0.5 * Math.sin(this.elapsed * 18);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (0.25 + 0.35 * k) * clamp(this.invuln, 0, 1);
        ctx.strokeStyle = this.orbColor(1);
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (2.0 + 0.25 * k), 0, TAU); ctx.stroke();
        ctx.restore();
      }

      const hue = this.orbHue();
      // chromatic split (cheap): two skin-derived offset ghosts (a cool/warm pair)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const off = 1.5 + this.flow * 3 + (this.scrollSpeed / this.W) * 4;
      ctx.globalAlpha = 0.5;
      // Follow the SKIN's saturation and lightness, not a hardcoded 100%/60%.
      // Obsidian is deliberately desaturated and dark (sat 40, light 34); with
      // fixed values its two ghosts came out fully saturated and twice as bright
      // as the orb they belong to, so the quietest skin in the game had the
      // loudest fringe.
      const sk = this.skin();
      const gs = sk.sat != null ? sk.sat : 100;
      const gl = clamp((sk.light != null ? sk.light : 60) + this.flow * 22, 0, 97);
      ctx.fillStyle = `hsl(${(hue + 160) % 360} ${gs}% ${gl}%)`;
      ctx.beginPath(); ctx.arc(p.x + off, p.y, p.r, 0, TAU); ctx.fill();
      ctx.fillStyle = `hsl(${hue} ${gs}% ${gl}%)`;
      ctx.beginPath(); ctx.arc(p.x - off, p.y, p.r, 0, TAU); ctx.fill();
      ctx.restore();

      // Core orb: a blitted halo (was shadowBlur) plus a squashed body. The body
      // gradient is one small allocation per frame, which is fine at this size.
      const col = this.orbColor(1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hr = p.r * (2.6 + this.flow * 0.9);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(glowSprite(col), p.x - hr, p.y - hr, hr * 2, hr * 2);
      ctx.restore();

      // A corona is the one part of a signature that PERSISTS: while flow is
      // lit, the orb wears a turning ring. Two stroked arcs, no blur, and only
      // while flow is above a whisper — so the cost lives entirely in the
      // seconds the player is being rewarded.
      if (this.flow > 0.05 && this.flowCorona) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(this.elapsed * 1.6);
        ctx.strokeStyle = col;
        for (let i = 0; i < 2; i++) {
          const rr = p.r * (2.0 + i * 0.55);
          ctx.globalAlpha = this.flow * (i ? 0.28 : 0.5);
          ctx.lineWidth = i ? 1.2 : 2;
          ctx.beginPath();
          // broken arcs read as a mechanism; a full circle reads as a bubble
          ctx.arc(0, 0, rr, i * 0.7, i * 0.7 + Math.PI * 1.25);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(p.sx, p.sy);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.r * 1.4);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, col);
      g.addColorStop(1, `hsla(${hue} 100% 50% / 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, p.r * 1.15, 0, TAU); ctx.fill();
      ctx.restore();

      // crisp round core so the hero always reads sharply
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.5, 0, TAU); ctx.fill();
      ctx.restore();

      // Themed decoration, drawn last so it sits on the lit orb rather than
      // under the halo. A deco is a SILHOUETTE — a handful of primitives scaled
      // by p.r — because at 28px anything more detailed is noise (the icon
      // lesson: a decoration is not a small picture). It rides the squash
      // transform so a flip deforms the whole character, ears included, and it
      // never touches the hitbox: collision reads p.r and only p.r.
      const deco = sk.deco && DECOS[sk.deco];
      if (deco) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(p.sx, p.sy);
        // The mirror follows gravity so "up" in deco space is always the way up
        // FEELS. dir +1 is falling DOWN (game.js:1109), and in that state deco
        // -y must stay screen-up — identity. The first draft flipped on dir > 0,
        // which pointed every ear into the fall; nothing caught it because this
        // table had never held a deco. Reviewed before one did.
        if (p.dir < 0) ctx.scale(1, -1);
        deco(ctx, p.r, hue, this);
        ctx.restore();
      }

      this.drawCharge(ctx, hue);
    }

    // High chain: shards orbit the orb, faster and wider as the multiplier
    // climbs. A rotating disc is invisible — you cannot see a circle spin — so
    // the "spinning up" reads through satellites around it instead.
    //
    // Deliberately behind a setting. It is the most opinionated piece of feel in
    // the game, and turning it off costs nothing.
    drawCharge(ctx, hue) {
      if (!Store.chargeFx) return;
      const p = this.player;
      const flowAt = this.mod ? this.mod.flowAt : 16;
      const from = Math.max(6, flowAt * 0.5);
      if (this.combo < from) return;
      // 0..1 across "starting to spin" → "flow"
      const t = clamp((this.combo - from) / Math.max(1, flowAt - from), 0, 1);
      const n = this.flowActive ? 4 : t > 0.6 ? 3 : 2;
      const spin = this.elapsed * (2.2 + t * 7 + (this.flowActive ? 3 : 0));
      const orbit = p.r * (1.8 + t * 0.7);
      const size = p.r * (0.16 + t * 0.16);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const a = spin + (i * TAU) / n;
        const x = p.x + Math.cos(a) * orbit;
        const y = p.y + Math.sin(a) * orbit * 0.92;
        ctx.globalAlpha = 0.35 + t * 0.45;
        ctx.fillStyle = `hsl(${(hue + i * 22) % 360} 100% ${70 + t * 20}%)`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
      }
      // a faint ring once it's really going, so the charge reads at a glance
      if (t > 0.55 || this.flowActive) {
        ctx.globalAlpha = 0.10 + t * 0.16;
        ctx.strokeStyle = `hsl(${hue} 100% 75%)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, orbit, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }

    // Vignettes are baked once per size and blitted. Rasterising two full-screen
    // radial gradients every frame was costing more than the entire game world.
    ensureVignettes() {
      const key = this.W + 'x' + this.H;
      if (this._vigKey === key) return;
      this._vigKey = key;
      this._vigStatic = vignetteSprite(this.W, this.H, 0.44, 1.0, 'rgba(0,0,0,0.45)');
      this._vigFlow = vignetteSprite(this.W, this.H, 0.22, 0.83, 'hsla(300 100% 45% / 1)');
    }

    drawOverlays(ctx) {
      const { W, H } = this;
      this.ensureVignettes();
      // flow vignette — one blit, alpha carries the intensity
      if (this.flow > 0.01) {
        ctx.globalAlpha = this.flow * 0.28;
        ctx.drawImage(this._vigFlow, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      const rf = calmVisuals();
      // white flash
      if (this.flash > 0.01 && !rf) {
        ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.5})`;
        ctx.fillRect(0, 0, W, H);
      }
      // damage flash (kept but softened when reducing flashing)
      if (this.damageFlash > 0.01) {
        ctx.fillStyle = `rgba(255,40,80,${this.damageFlash * (rf ? 0.2 : 0.4)})`;
        ctx.fillRect(0, 0, W, H);
      }
      // subtle static vignette always
      ctx.drawImage(this._vigStatic, 0, 0, W, H);
      this.drawBlackout(ctx);
    }

    // BLACKOUT: the world is only fully lit for part of each beat. In between you
    // keep a small pool of light around the orb and fly the rest from memory.
    // `floor` never reaches zero — a mode you literally cannot see isn't a
    // challenge, it's a coin toss — and reduce-flashing keeps far more light on.
    drawBlackout(ctx) {
      const md = this.mode;
      if (!md || !md.blackout || this.state === State.MENU) return;
      const b = md.blackout;
      const phase = (this.elapsed % b.period) / b.period;
      // ONE dark phase per cycle: fade down, HOLD, fade back up. The hold is the
      // point — a darkness that arrives and leaves again inside a moment reads as
      // a glitch, and you cannot plan around it. Holding it means you commit to a
      // line and fly it, which is the whole mode.
      //
      // (The previous curve ran a full cosine across the dark window, so it fell
      // to black, came back to FULL light halfway through, then darkened again —
      // two clipped humps a cycle, each snapping on with no fade.)
      const u = phase < b.lit ? 0 : (phase - b.lit) / (1 - b.lit);
      const edge = b.edge || 0.28;         // fraction of the dark window spent fading
      const ramp = u <= 0 ? 0
        : u < edge ? u / edge
          : u > 1 - edge ? (1 - u) / edge
            : 1;
      let dark = (0.5 - 0.5 * Math.cos(Math.PI * clamp(ramp, 0, 1))) * (1 - b.floor);
      if (calmVisuals()) dark *= 0.45;
      if (this.attract) dark *= 0.3;       // a background, not a mode
      if (dark < 0.01) return;

      const { W, H } = this;
      const p = this.player;
      const r = Math.max(W, H) * 0.42;
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.12, p.x, p.y, r);
      g.addColorStop(0, 'rgba(3,4,12,0)');
      g.addColorStop(0.45, `rgba(3,4,12,${dark * 0.72})`);
      g.addColorStop(1, `rgba(3,4,12,${dark})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }


    // A quiet label naming the mode you're in, so a screenshot always says which
    // game it was. Classic doesn't need one — it's the default everything means.
    drawModeBadge(ctx) {
      const md = this.mode;
      if (!md || md.id === 'classic' || this.daily || this.tutorial) return;
      const { W, H } = this;
      const s = clamp(H * 0.014, 9, 13);
      ctx.save();
      ctx.font = `800 ${s}px "Orbitron", "Rajdhani", system-ui, sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      // A mode that keeps no score says what it IS keeping instead.
      const label = (LUMEN.Modes ? LUMEN.Modes.name(md.id) : md.id)
        + (!md.lethal && this.bumps ? '  ·  ' + T('bumps', { n: this.bumps }) : '');
      // bottom-left: the only corner nothing else claims (power icons top-left,
      // score top-centre, mic top-right, item buttons bottom-centre)
      const x = clamp(W * 0.04, 12, 40), y = H - clamp(H * 0.04, 16, 34);
      ctx.fillStyle = `hsla(${md.accent} 90% 62% / .16)`;
      // BRITTLE's two meters ride in the badge rather than under the score: the
      // score's bottom edge already IS the top of the playfield, which is why it
      // had to be shrunk once. There is room here and nowhere else.
      const flt = md.fault;
      const w = ctx.measureText(label).width + 18 + (flt ? 34 : 0), h = s + 12;
      this.roundRect(ctx, x, y - h / 2, w, h, h / 2); ctx.fill();
      ctx.strokeStyle = `hsla(${md.accent} 90% 66% / .5)`; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = `hsl(${md.accent} 90% 72%)`;
      ctx.fillText(label, x + 9, y);
      if (flt) {
        // NERVE, as pips: filled for each whole nerve you hold, a half-lit one
        // for the fraction, hollow for what you have spent. Red once you can no
        // longer afford to duck — which is also when the world slows.
        const low = this.nerve < flt.cost;
        const pipC = low ? this.dangerColor(1) : this.moteColor();
        const r = s * 0.28, gapx = s * 0.8;
        let px = x + ctx.measureText(label).width + 18;
        for (let i = 0; i < flt.nerve; i++) {
          const have = clamp(this.nerve - i, 0, 1);
          ctx.beginPath(); ctx.arc(px, y, r, 0, TAU);
          ctx.strokeStyle = pipC; ctx.lineWidth = 1.2; ctx.stroke();
          if (have > 0) {
            // A WEDGE, not a smaller disc. Scaling the radius by the fraction
            // makes two thirds of a nerve look like a whole one — and this is
            // the number the player has to decide on.
            ctx.beginPath();
            ctx.moveTo(px, y);
            ctx.arc(px, y, r, -Math.PI / 2, -Math.PI / 2 + have * TAU);
            ctx.closePath();
            ctx.fillStyle = pipC; ctx.fill();
          }
          px += gapx;
        }
        // HEAT, as a bar along the pill's inner bottom edge. No motion, no
        // flash: legible in a screenshot and at any contrast setting. An economy
        // the player cannot read is not a decision.
        const hw = (w - 8) * clamp(this.heat / flt.full, 0, 1);
        if (hw > 0.5) {
          ctx.fillStyle = this.dangerColor(0.8);
          ctx.fillRect(x + 4, y + h / 2 - 3, hw, 2);
        }
      }
      ctx.restore();
    }

    drawHUD(ctx) {
      const { W, H } = this;
      const score = Math.floor(this.displayScore);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // score
      // Smaller than it was, because the band above the corridor could not come
      // down any further while the glyphs were this tall — the score's bottom
      // edge WAS the top of the playfield. 44px on a 393-wide phone is still the
      // largest thing on screen by a wide margin.
      const big = clamp(H * 0.052, 28, 50);
      // One origin for the whole top row. The score used to offset by safeTop
      // while the multiplier and the best line did not, so even a correct inset
      // only unclipped one of the three.
      const top = (this.safeTop || 0) + H * 0.006;
      ctx.font = `800 ${big}px "Rajdhani", system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = this.orbColor(1); ctx.shadowBlur = 16;
      ctx.fillText(String(score), W / 2, top);

      // The multiplier, said out loud. It is the reason the number climbs faster
      // here than in Classic, and a player should not have to work that out.
      const mul = this.scoreMul;
      if (Math.abs(mul - 1) > 0.005 && !this.daily) {
        const ms = clamp(H * 0.019, 11, 17);
        ctx.font = `800 ${ms}px "Rajdhani", system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,209,92,0.85)';
        ctx.shadowColor = 'rgba(255,209,92,0.5)'; ctx.shadowBlur = 8;
        ctx.fillText('×' + mul.toFixed(2).replace(/\.?0+$/, ''),
          W / 2 + ctx.measureText(String(score)).width * 0.5 + big * 0.55, top + big * 0.32);
        ctx.textAlign = 'center';
      }

      // best (small) — for THIS mode, not for Classic
      ctx.font = `600 ${clamp(H * 0.02, 12, 18)}px "Rajdhani", system-ui, sans-serif`;
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText((this.daily ? T('dailyBest') : T('best')) + ' ' + this.bestHere, W / 2, top + big + 2);

      // combo (right side)
      if (this.combo > 1) {
        const mult = this.comboMult();
        ctx.textAlign = 'right';
        const cx = W - clamp(W * 0.04, 14, 40);
        const cy = (this.safeTop || 0) + H * 0.02;
        const csz = clamp(H * 0.045, 24, 44) * (1 + Math.min(0.5, this.combo * 0.02));
        const col = this.flowActive ? 'hsl(300 100% 72%)' : this.moteColor();
        ctx.font = `800 ${csz}px "Rajdhani", system-ui, sans-serif`;
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = 14;
        ctx.fillText('x' + mult, cx, cy);
        ctx.font = `700 ${clamp(H * 0.02, 12, 18)}px "Rajdhani", system-ui, sans-serif`;
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(this.combo + ' ' + T('combo'), cx, cy + csz);
        // combo timer bar
        const barW = clamp(W * 0.14, 90, 200);
        const frac = clamp(this.comboTimer / (this.comboTimerMax || 3.6), 0, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        this.roundRect(ctx, cx - barW, cy + csz + 26, barW, 5, 2.5); ctx.fill();
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = 8;
        this.roundRect(ctx, cx - barW, cy + csz + 26, barW * frac, 5, 2.5); ctx.fill();
      }
      ctx.restore();
    }

    // ---- helpers ---------------------------------------------------------
    roundRect(ctx, x, y, w, h, r) {
      if (h < 0) { y += h; h = -h; }
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // ---- adaptive quality --------------------------------------------------
    // Watch real frame times and drop a tier if the device can't keep up. This is
    // the only honest way to tune for hardware we can't know in advance.
    _watchPerf(dt) {
      if (Store.quality !== 'auto') return;
      if (this.state !== State.PLAY) { this._slow = 0; return; }
      this._perfN = (this._perfN || 0) + 1;
      if (this._perfN < 40) return;              // ignore the first frames (JIT, first paint)
      // Learn the display's natural frame interval instead of assuming 60Hz. A 30Hz
      // panel or a battery-saver device delivers 33ms frames while perfectly idle;
      // comparing against a fixed threshold would demote it to Low within seconds.
      if (dt > 0 && dt < 0.2) this._basePeriod = Math.min(this._basePeriod || dt, dt);
      const base = this._basePeriod || 1 / 60;
      if (dt > base * 1.6 + 0.004) this._slow = (this._slow || 0) + 1;  // missing frames for real
      else this._slow = Math.max(0, (this._slow || 0) - 1);
      if (this._slow > 25) {
        this._slow = 0;
        const order = ['high', 'balanced', 'low'];
        const i = order.indexOf(LUMEN.Q === QUALITY.high ? 'high' : LUMEN.Q === QUALITY.balanced ? 'balanced' : 'low');
        if (i < order.length - 1) {
          LUMEN.applyQuality(order[i + 1], true);
          Store.autoTier = order[i + 1];   // remember it; don't relearn every session
          LUMEN.UI && LUMEN.UI.toast && LUMEN.UI.toast(T('gfxLowered'));
        }
      }
    }

    // ---- loop ------------------------------------------------------------
    frame(now) {
      if (!this.last) this.last = now;
      let dt = (now - this.last) / 1000;
      this.last = now;
      dt = clamp(dt, 0, 1 / 30); // avoid spiral of death / tunneling
      if (LUMEN.Pad) LUMEN.Pad.poll(this);
      this._watchPerf((now - (this._prevNow || now)) / 1000);
      this._prevNow = now;

      // Outside of active play the canvas is just idle ambience behind a menu.
      // Running it at full rate burns GPU for nothing and makes taps feel laggy
      // (the compositor is busy re-blurring the panel backdrop). Throttle to ~24fps.
      // The death explosion is the most-replayed moment in the game — keep it at
      // full rate for a beat after dying, then fall back to the idle throttle.
      const justDied = this.state === State.DEAD && (now - (this._deathAt || -1e9)) < 1600;
      // The attract demo is still "the menu": it must not cost what a real run
      // costs, or the panel taps go laggy again behind a blurred backdrop. Half
      // rate reads as perfectly smooth for scenery and halves the fill cost.
      const playing = (this.state === State.PLAY && !this.attract) || justDied;
      const cap = this.attract ? 1 / 30 : 1 / 24;
      this._idleAcc = (this._idleAcc || 0) + dt;
      // Re-arm FIRST, and unconditionally.
      //
      // A single typo in one sound effect (a `boing` that read an undeclared
      // variable) used to end the game permanently: the throw unwound out of
      // frame() before requestAnimationFrame was reached, the loop was never
      // scheduled again, and the canvas froze for the life of the page while
      // the menus happily drew on top of a dead game. No one bug is worth that
      // blast radius. Now the next frame is already booked before any of our
      // code runs, so the worst a broken frame can do is drop a frame.
      requestAnimationFrame(this._frameCb);
      try {
        if (playing || this._idleAcc >= cap) {
          if (!playing) this._idleAcc = 0;
          this.update(dt);
          this.render();
        } else {
          this.update(dt); // keep simulation/easing continuous, just skip the draw
        }
      } catch (e) {
        // Report it loudly once — a silently-swallowed exception every frame is
        // its own kind of bug — then carry on.
        if (!this._frameErr) {
          this._frameErr = true;
          // eslint-disable-next-line no-console
          console.error('[LUMEN] frame error (the loop keeps running):', e);
        }
      }
    }
    run() {
      // bind once instead of allocating a closure every single frame
      this._frameCb = (t) => this.frame(t);
      requestAnimationFrame(this._frameCb);
    }
  }

  LUMEN.Game = Game;

  // Switch preset, re-lay the canvas, and rebuild the baked layers.
  // `auto` starts at a tier guessed from the device, then self-corrects downward.
  LUMEN.applyQuality = function (name, keepAutoSetting) {
    let preset;
    if (name === 'auto') {
      const remembered = Store.autoTier;
      if (remembered && QUALITY[remembered]) preset = QUALITY[remembered];
      else {
        const px = (window.innerWidth || 360) * (window.innerHeight || 640) * Math.min(window.devicePixelRatio || 1, 2);
        const cores = navigator.hardwareConcurrency || 4;
        preset = (px > 3500000 || cores <= 4) ? QUALITY.balanced : QUALITY.high;
      }
    } else {
      preset = QUALITY[name] || QUALITY.balanced;
    }
    LUMEN.Q = preset;
    if (!keepAutoSetting) Store.quality = name;
    document.body && document.body.classList.toggle('no-blur', !preset.blurUI);
    const g = LUMEN.game;
    if (g) { g.bg.layer = null; g._vigKey = null; g.resize(); }
  };
})();
