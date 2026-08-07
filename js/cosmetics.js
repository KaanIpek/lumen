/*
 * LUMEN — cosmetics catalog & economy
 * -------------------------------------------------------------
 * Four categories, one rule: none of it touches how the game plays.
 *
 *   ORBS    the hero's colour
 *   TRAILS  what it leaves behind
 *   MAPS    the environment you fly through (its own background)
 *   ITEMS   consumables — handled in progression.js, not here
 *
 * Pricing has two currencies and a deliberate shape:
 *   `shards` is earned. Even the cheap tier is out of reach of a
 *     handful of runs, so unlocking anything means real play.
 *   `usd` is a shortcut. Cheap things are nearly free in cash;
 *     premium things cost only a little more. The gap between the
 *     tiers is huge in shards and small in money — that's the whole
 *     point of the second currency.
 *
 * Some items carry `req` instead of a price: those are earned by
 * achievement only and can never be bought. They're the ones worth
 * having.
 *
 * MAPS are shard-only by design: the world you play in is something
 * you unlock by playing.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Store = LUMEN.Store;

  // tier → price shape. `usd` is what the store charges in real money.
  const TIER = {
    free:    { shards: 0,    usd: 0 },
    cheap:   { shards: 550,  usd: 0.99 },
    mid:     { shards: 1400, usd: 1.49 },
    premium: { shards: 4500, usd: 2.49 },
    elite:   { shards: 9000, usd: 3.49 },
  };

  // ---- orbs ---------------------------------------------------------------
  const SKINS = [
    { id: 'ion',      tier: 'free',    hue: 188, sat: 100, light: 60 },
    { id: 'ember',    tier: 'cheap',   hue: 24,  sat: 100, light: 58 },
    { id: 'verdant',  tier: 'cheap',   hue: 150, sat: 95,  light: 58 },
    { id: 'amethyst', tier: 'cheap',   hue: 268, sat: 95,  light: 64 },
    { id: 'frost',    tier: 'mid',     hue: 205, sat: 30,  light: 82 },
    { id: 'solar',    tier: 'mid',     hue: 38,  sat: 100, light: 66 },
    { id: 'abyss',    tier: 'mid',     hue: 218, sat: 85,  light: 46 },
    { id: 'spectrum', tier: 'premium', hue: 0,   sat: 100, light: 62, rainbow: true },
    { id: 'nova',     tier: 'premium', hue: 0,   sat: 0,   light: 96 },
    { id: 'plasma',   tier: 'elite',   hue: 320, sat: 100, light: 66, rainbow: true, rainbowSpan: 60 },
    { id: 'rose',     tier: 'cheap',   hue: 342, sat: 90,  light: 66 },
    { id: 'jade',     tier: 'cheap',   hue: 168, sat: 70,  light: 56 },
    { id: 'cobalt',   tier: 'mid',     hue: 228, sat: 95,  light: 60 },
    { id: 'copper',   tier: 'mid',     hue: 18,  sat: 62,  light: 54 },
    { id: 'venom',    tier: 'mid',     hue: 88,  sat: 95,  light: 56 },
    { id: 'orchid',   tier: 'premium', hue: 292, sat: 88,  light: 70 },
    { id: 'magma',    tier: 'premium', hue: 8,   sat: 100, light: 54, rainbow: true, rainbowSpan: 34 },
    { id: 'glacier',  tier: 'elite',   hue: 190, sat: 55,  light: 88 },
    // The full wheel, fast. Spectrum drifts; this one is unmistakably alive.
    { id: 'chroma',   tier: 'elite',   hue: 0,   sat: 100, light: 64, rainbow: true, rainbowSpeed: 190 },
    // ---- earned only. no price, no shortcut. ----
    { id: 'aurora',   req: 'flow2',    hue: 165, sat: 90,  light: 70 },
    { id: 'obsidian', req: 'endure2',  hue: 250, sat: 40,  light: 34 },
    { id: 'phoenix',  req: 'phoenix',  hue: 12,  sat: 100, light: 62 },
    { id: 'zenith',   req: 'scorer2',  hue: 52,  sat: 100, light: 78 },
    { id: 'eclipse',  req: 'runs3',    hue: 275, sat: 25,  light: 22 },
    { id: 'mirage',   req: 'close2',   hue: 42,  sat: 80,  light: 72 },
  ];

  // ---- trails -------------------------------------------------------------
  const TRAILS = [
    { id: 'dust',   tier: 'free',    style: 'dust' },
    { id: 'comet',  tier: 'cheap',   style: 'comet' },
    { id: 'ribbon', tier: 'cheap',   style: 'ribbon' },
    { id: 'spark',  tier: 'mid',     style: 'spark' },
    { id: 'echo',   tier: 'mid',     style: 'echo' },
    { id: 'prism',  tier: 'premium', style: 'prism' },
    { id: 'void',   tier: 'elite',   style: 'void' },
    { id: 'thread', tier: 'cheap',   style: 'thread' },
    { id: 'embers', tier: 'mid',     style: 'embers' },
    { id: 'pulse',  tier: 'mid',     style: 'pulse' },
    { id: 'shard',  tier: 'premium', style: 'shard' },
    { id: 'halo',   req: 'chain2',   style: 'halo' },
    { id: 'wake',   req: 'flow3',    style: 'wake' },
  ];

  // ---- maps ---------------------------------------------------------------
  // Environment only. The hazard/reward/hero colour language is fixed by the
  // colour-vision palette, so no map can ever make the game harder to read.
  // Maps are worlds, not palettes. Each one also changes a single rule, so
  // choosing where to fly is a real decision rather than a wallpaper swap.
  //
  // The rule of the set: every trait is a TRADE. Nothing here is strictly better
  // than Deep Field, because maps cost shards and a paid advantage would turn
  // the shop into pay-to-win. `trait` names the key its description uses.
  //
  // The Daily always runs on Deep Field, so the shared course stays neutral.
  const MAPS = [
    { id: 'deepfield', shards: 0,    bg: 248, bg2: 254, neb: [250, 285], dust: 190, wall: 196,
      trait: 'none' },

    // Embers rise: a gentle upward pull. Flips downward bite harder, upward float.
    { id: 'emberfall', shards: 900,  bg: 18,  bg2: 8,   neb: [20, 340],  dust: 34,  wall: 30,
      trait: 'updraft', gravityBias: -0.16 },

    // A tide that breathes the whole corridor in and out. Gaps drift as a set.
    { id: 'tidal',     shards: 1500, bg: 196, bg2: 205, neb: [185, 215], dust: 175, wall: 186,
      trait: 'tide', tide: { amp: 0.055, speed: 0.55 } },

    // Overgrown: motes are rarer, but each one is worth more.
    { id: 'moss',      shards: 2200, bg: 150, bg2: 168, neb: [120, 160], dust: 140, wall: 146,
      trait: 'sparse', moteRate: 0.62, moteWorth: 1.6 },

    // Immense and slow: wider openings, but they arrive closer together.
    { id: 'monolith',  shards: 3200, bg: 240, bg2: 240, neb: [240, 250], dust: 220, wall: 228,
      mono: true, trait: 'heavy', gap: 1.12, spawn: 0.86 },

    // Two suns pull hard. The mirror of Emberfall: here everything sinks, so
    // holding height costs you — and the field pays for the trouble. Nothing is
    // drawn over the screen for this; the trait is in the handling, where you
    // feel it every flip instead of watching it happen.
    { id: 'solaris',   shards: 4800, bg: 300, bg2: 32,  neb: [310, 40],  dust: 48,  wall: 316,
      trait: 'sink', gravityBias: 0.16, moteWorth: 1.3 },

    // ---- themed worlds -------------------------------------------------------
    // A map owns HUE and nothing else: Background._bake fixes saturation and
    // lightness, so there is no bright sky available here at any price. Theme
    // arrives through the nebula, the dust, the wall colour and the music.
    // Every wall hue below sits at least 28 degrees off every colourblind
    // DANGER hue, and every dust hue at least 20 off every REWARD hue.

    // Halloween. Hunted from the whistle, and paid for the nerve.
    { id: 'hallowmere', shards: 2600, bg: 26,  bg2: 286, neb: [292, 22],  dust: 20,  wall: 82,
      trait: 'haunted', traps: true, trapEvery: [4.5, 8], moteWorth: 1.25 },

    // A throne hall the size of a canyon: all the time in the world, and no room.
    { id: 'regalia',    shards: 3600, bg: 268, bg2: 252, neb: [272, 42],  dust: 316, wall: 108,
      trait: 'stately', gap: 0.86, speed: 0.88 },

    // The void. Long flat arcs — and a late flip that cannot save you.
    { id: 'nullpoint',  shards: 4400, bg: 232, bg2: 234, neb: [230, 236], dust: 250, wall: 244,
      trait: 'weightless', gMul: 0.68, gap: 0.94, spawn: 1.06, nebA: 0.15 },

    // Magic as geometry: the corridor breathes, wider than anywhere and then
    // tighter than anywhere. The trough always comes.
    { id: 'weave',      shards: 5200, bg: 272, bg2: 188, neb: [286, 166], dust: 300, wall: 168,
      trait: 'breathing', gapWave: { amp: 0.17, speed: 0.42 } },

    // Deep winter, and Nullpoint's mirror: all the reading time, none of the air.
    { id: 'hoarfrost',  shards: 2900, bg: 200, bg2: 214, neb: [196, 220], dust: 204, wall: 212,
      trait: 'leaden', gMul: 1.32, speed: 0.90 },
  ];

  const DEFAULTS = { skin: 'ion', trail: 'dust', map: 'deepfield' };
  // ---- signatures ------------------------------------------------------------
  // Every cosmetic above this line is a COLOUR. Colour is the cheapest thing a
  // game can sell and the easiest to feel indifferent about — a second palette
  // for a thing you already own. What players actually pay for is a cosmetic
  // that changes how an ACTION looks, because that is the part they perform.
  //
  // A signature owns the three moments LUMEN is made of:
  //   flip   the one input, several hundred times a run — constant visibility
  //   flow   the reward, the slow-motion peak
  //   death  the moment the game itself keeps at full frame rate because it is
  //          the one everybody replays
  //
  // One purchase changes all three, so it reads as an identity rather than a
  // trinket. `ring` draws expanding circles (see Rings in game.js) and `burst`
  // feeds the existing particle pool; both are data, so a new signature is a
  // table entry and not new code.
  //
  //   ring:  { n, delay, r0, r1, life, width, hue, dark, in }
  //   burst: { n, spMax, lifeMax, sizeMax, grav, drag }
  const SIGNATURES = [
    // The original look. Free, and never made to feel like a punishment: it is
    // the game's own handwriting, not a locked door.
    { id: 'ripple', tier: 'free',
      flip:  { burst: { n: 6, spMax: 120, lifeMax: 0.4, sizeMax: 3 } },
      flow:  { ring: { n: 1, r0: 0.6, r1: 4.5, life: 0.7, width: 3 } },
      death: { burst: { n: 46, spMax: 420, lifeMax: 1.1, sizeMax: 7, drag: 0.86 } } },

    // Soft, slow, generous. Every tap leaves a widening circle behind it.
    { id: 'bloom', tier: 'cheap',
      flip:  { ring: { n: 1, r0: 0.7, r1: 3.4, life: 0.5, width: 2 },
               burst: { n: 5, spMax: 90, lifeMax: 0.4, sizeMax: 3 } },
      flow:  { ring: { n: 2, delay: 0.14, r0: 0.8, r1: 6.5, life: 1.0, width: 3.5 } },
      death: { ring: { n: 3, delay: 0.09, r0: 0.5, r1: 9, life: 1.0, width: 4 },
               burst: { n: 40, spMax: 340, lifeMax: 1.0, sizeMax: 6, drag: 0.88 } } },

    // Hard and angular: the orb breaks and the pieces fall.
    { id: 'fracture', tier: 'mid',
      flip:  { burst: { n: 8, spMax: 200, lifeMax: 0.5, sizeMax: 4, grav: 520, drag: 0.97 } },
      flow:  { ring: { n: 1, r0: 3.6, r1: 0.8, life: 0.5, width: 3, in: true } },
      death: { burst: { n: 54, spMax: 460, lifeMax: 1.3, sizeMax: 8, grav: 900, drag: 0.98 } } },

    // Warm and drifting — embers that rise off every flip.
    { id: 'cinder', tier: 'mid',
      flip:  { burst: { n: 7, spMax: 110, lifeMax: 0.7, sizeMax: 3, grav: -160, drag: 0.94 } },
      flow:  { ring: { n: 1, r0: 0.8, r1: 5, life: 0.8, width: 2.5, hue: 22 } },
      death: { burst: { n: 50, spMax: 300, lifeMax: 1.5, sizeMax: 6, grav: -240, drag: 0.93 } } },

    // A thin fast ring on every tap, and a corona that stays lit through flow.
    { id: 'corona', tier: 'premium',
      flip:  { ring: { n: 1, r0: 1.1, r1: 2.6, life: 0.26, width: 1.6 },
               burst: { n: 4, spMax: 130, lifeMax: 0.3, sizeMax: 2.5 } },
      flow:  { corona: true, ring: { n: 3, delay: 0.1, r0: 1, r1: 5.5, life: 0.9, width: 2 } },
      death: { ring: { n: 2, delay: 0.06, r0: 7, r1: 0.4, life: 0.5, width: 5, in: true },
               burst: { n: 52, spMax: 480, lifeMax: 1.0, sizeMax: 7, drag: 0.85 } } },

    // The negative of everything else: dark rings with a lit rim.
    { id: 'umbra', tier: 'elite',
      flip:  { ring: { n: 1, r0: 0.6, r1: 3.2, life: 0.45, width: 3, dark: true } },
      flow:  { ring: { n: 2, delay: 0.16, r0: 0.7, r1: 7, life: 1.1, width: 5, dark: true } },
      death: { ring: { n: 3, delay: 0.1, r0: 0.5, r1: 11, life: 1.2, width: 7, dark: true },
               burst: { n: 34, spMax: 300, lifeMax: 1.2, sizeMax: 5, drag: 0.9 } } },

    // Two rings running against each other, and a white-out when you go.
    { id: 'quasar', tier: 'elite',
      flip:  { ring: { n: 2, delay: 0.05, r0: 0.9, r1: 3.6, life: 0.4, width: 2, hue: 190 },
               burst: { n: 6, spMax: 170, lifeMax: 0.4, sizeMax: 3 } },
      flow:  { ring: { n: 3, delay: 0.08, r0: 1, r1: 8, life: 0.9, width: 3, hue: 190 } },
      death: { ring: { n: 4, delay: 0.05, r0: 0.6, r1: 14, life: 0.9, width: 6, hue: 0, white: true },
               burst: { n: 60, spMax: 520, lifeMax: 1.0, sizeMax: 8, drag: 0.84 } } },

    // Earned, never sold. A seventy-chain is the hardest ordinary thing in the
    // game, and the point of this one is that money cannot get it for you —
    // which is exactly what makes anybody else who sees it know what it means.
    { id: 'apex', req: 'chain3',
      flip:  { ring: { n: 2, delay: 0.04, r0: 1, r1: 3.8, life: 0.42, width: 2, hue: 52 },
               burst: { n: 7, spMax: 150, lifeMax: 0.5, sizeMax: 3 } },
      flow:  { corona: true, ring: { n: 3, delay: 0.09, r0: 1.2, r1: 7.5, life: 1.0, width: 3, hue: 52 } },
      death: { ring: { n: 4, delay: 0.07, r0: 0.5, r1: 12, life: 1.1, width: 5, hue: 52 },
               burst: { n: 56, spMax: 460, lifeMax: 1.2, sizeMax: 7, drag: 0.86 } } },
  ];

  // ---- sets ------------------------------------------------------------------
  // A set is one aesthetic across all three slots: the orb, what it leaves
  // behind, and what its flip does. Bought together they are cheaper than
  // separately, and — this is the part that matters — YOU NEVER PAY TWICE.
  //
  // The price is always `DISCOUNT` off the list price of the pieces you do NOT
  // already own. Own the orb already and the set simply costs less; own all
  // three and it is complete and unbuyable rather than a thing that would
  // silently take your shards for nothing. A bundle that re-charges for what is
  // already in your inventory is the fastest way to teach a player never to
  // trust the shop again, and one refund request costs more than the discount.
  const SET_DISCOUNT = 0.32;
  const SETS = [
    // warm, rising, unhurried
    { id: 'kindling', items: ['ember', 'embers', 'cinder'], usd: 2.99 },
    // the dark one: black orb, black wake, black rings with a lit rim
    { id: 'nightfall', items: ['abyss', 'void', 'umbra'], usd: 5.99 },
    // every colour at once, and loud about it
    { id: 'spectra', items: ['spectrum', 'prism', 'quasar'], usd: 5.99 },
    // cold and precise, crowned through flow
    { id: 'rimefall', items: ['frost', 'shard', 'corona'], usd: 4.49 },
  ];

  const all = () => SKINS.concat(TRAILS, MAPS, SIGNATURES);
  const find = (id) => all().find((i) => i.id === id) || null;

  const Cosmetics = {
    SKINS, TRAILS, MAPS, SIGNATURES, TIER,

    def(id) { return find(id) || null; },
    name(id) { return LUMEN.t ? LUMEN.t('cos_' + id) : id; },
    desc(id) { return LUMEN.t ? LUMEN.t('cosd_' + id) : ''; },
    find,

    category(id) {
      if (SKINS.some((s) => s.id === id)) return 'orbs';
      if (TRAILS.some((t) => t.id === id)) return 'trails';
      if (MAPS.some((m) => m.id === id)) return 'maps';
      if (SIGNATURES.some((g) => g.id === id)) return 'signatures';
      return null;
    },

    // What it costs, in both currencies. `null` means "not for sale".
    price(id) {
      const it = find(id);
      if (!it) return null;
      if (it.req) return null;                       // achievement-only
      if (it.shards != null) return { shards: it.shards, usd: 0 };  // maps: shards only
      const t = TIER[it.tier] || TIER.cheap;
      return { shards: t.shards, usd: t.usd };
    },
    // The achievement that unlocks an earned-only item, if any.
    requirement(id) { const it = find(id); return it && it.req ? it.req : null; },

    owned(id) {
      // Free means you have it. This used to be a hand-written list of the three
      // default ids, and adding a fourth category promptly forgot the fourth
      // entry: the free signature read as UNOWNED, so the game-over screen
      // advertised "next unlock: Ripple — 0 shards" for the thing every player
      // is already flying with. Deriving it from the price cannot be forgotten
      // by the next category.
      if (id === DEFAULTS.skin || id === DEFAULTS.trail || id === DEFAULTS.map) return true;
      const it = find(id);
      if (it && it.tier === 'free') return true;
      if (Store.unlocks.indexOf(id) >= 0) return true;
      // earned items unlock the moment their achievement lands
      const req = this.requirement(id);
      if (req && LUMEN.Progression && LUMEN.Progression.earned(req)) return true;
      return false;
    },

    grant(id) {
      if (this.owned(id)) return false;
      const u = Store.unlocks;
      u.push(id); Store.unlocks = u;
      this.invalidate();
      return true;
    },

    buy(id) {
      if (this.owned(id)) return false;
      const p = this.price(id);
      if (!p) return false;                          // earned-only: never purchasable
      if (Store.shards < p.shards) return false;
      Store.shards = Store.shards - p.shards;
      return this.grant(id);
    },

    equip(id) {
      if (!this.owned(id)) return false;
      const cat = this.category(id);
      if (cat === 'orbs') Store.skin = id;
      else if (cat === 'trails') Store.trail = id;
      else if (cat === 'maps') Store.map = id;
      else if (cat === 'signatures') Store.signature = id;
      else return false;
      this.invalidate();
      return true;
    },

    // The renderer asks for these many times per frame, so resolve once and cache
    // until something actually changes equipment.
    invalidate() { this._skin = null; this._trail = null; this._map = null; this._sig = null; },
    skinDef() {
      if (!this._skin || this._skin.id !== Store.skin) {
        this._skin = SKINS.find((s) => s.id === Store.skin) || SKINS[0];
      }
      return this._skin;
    },
    trailDef() {
      if (!this._trail || this._trail.id !== Store.trail) {
        this._trail = TRAILS.find((t) => t.id === Store.trail) || TRAILS[0];
      }
      return this._trail;
    },
    // A world shown INSTEAD of the equipped one, without equipping it. The menu's
    // attract demo uses this to fly the in-season world, and because every
    // visual — background, nebula, dust, wall colour — and every trait resolves
    // through mapDef(), setting it here is the whole of it. Nothing the player
    // owns changes, and pressing PLAY clears it.
    preview: null,
    setPreview(id) {
      const next = (id && find(id)) ? id : null;
      if (this.preview === next) return;
      this.preview = next;
      this._map = null;                     // the memo is keyed on the equipped id
    },

    mapDef() {
      const want = this.preview || Store.map;
      if (!this._map || this._map.id !== want) {
        this._map = MAPS.find((m) => m.id === want) || MAPS[0];
      }
      return this._map;
    },

    SETS, SET_DISCOUNT,

    setDef(id) { return SETS.find((s) => s.id === id) || null; },

    // What this set costs YOU, right now. Everything is derived from what is
    // still missing, so the number a player sees is always the number for the
    // things they are actually receiving.
    setPrice(id) {
      const s = this.setDef(id);
      if (!s) return null;
      const missing = s.items.filter((it) => !this.owned(it));
      const listed = missing.reduce((n, it) => {
        const p = this.price(it);
        return n + (p ? p.shards : 0);
      }, 0);
      const full = s.items.reduce((n, it) => {
        const p = this.price(it);
        return n + (p ? p.shards : 0);
      }, 0);
      const shards = Math.round(listed * (1 - SET_DISCOUNT));
      return {
        shards, listed, full,
        saving: listed - shards,
        missing: missing.length,
        complete: missing.length === 0,
        // Real money is a FIXED product — a store cannot price a SKU per player
        // — so the cash button is only offered on a set where nothing is owned
        // yet and the fixed price is honest. Otherwise shards, pro-rated.
        usd: missing.length === s.items.length ? s.usd : 0,
      };
    },

    buySet(id) {
      const s = this.setDef(id);
      const p = this.setPrice(id);
      if (!s || !p || p.complete) return false;
      if (Store.shards < p.shards) return false;
      Store.shards = Store.shards - p.shards;
      for (const it of s.items) this.grant(it);
      return true;
    },

    // Everything in the set, granted without charge — the real-money path, which
    // has already been paid through the store.
    grantSet(id) {
      const s = this.setDef(id);
      if (!s) return false;
      for (const it of s.items) this.grant(it);
      return true;
    },

    signatureDef() {
      const want = Store.signature;
      if (!this._sig || this._sig.id !== want) {
        this._sig = SIGNATURES.find((s) => s.id === want) || SIGNATURES[0];
      }
      return this._sig;
    },

    // ---- seasons ------------------------------------------------------------
    // Five of these worlds are themed for an occasion and nothing in the game
    // knew it: Hallowmere is a Halloween world that looked identical on the 31st
    // of October and the 14th of March. A theme that never arrives at its moment
    // is just a palette.
    //
    // A season FEATURES a map for a window of days. It never restricts anything:
    // no time-limited content, no time-limited prices, nothing you can miss. A
    // player who ignores it loses nothing, and Hallowmere costs the same 2600
    // shards in July as in October. Everything a season does is additive.
    //
    // Only worlds that genuinely depict a season get one. Inventing a holiday
    // for Regalia would be noise — a season every week is a season never.
    SEASONS: [
      // [map, fromMonth, fromDay, toMonth, toDay] — inclusive, local dates
      { map: 'hallowmere', from: [10, 24], to: [11, 2] },   // Halloween
      { map: 'hoarfrost', from: [12, 15], to: [1, 5] },     // deep midwinter, wraps the year
      { map: 'weave', from: [3, 17], to: [3, 24] },         // the equinox
    ],

    // Which map is in season today, or null. `when` is for tests.
    //
    // Local dates on purpose: Daily already builds its key from
    // getFullYear/getMonth/getDate rather than toISOString, because UTC would
    // flip the season several hours early or late depending on where you are.
    inSeason(when) {
      const d = when || new Date();
      const mo = d.getMonth() + 1, day = d.getDate();
      for (const s of this.SEASONS) {
        const [fm, fd] = s.from, [tm, td] = s.to;
        const after = mo > fm || (mo === fm && day >= fd);
        const before = mo < tm || (mo === tm && day <= td);
        // A window that ends in an earlier month than it starts wraps the new
        // year, so "inside" means after the start OR before the end, not both.
        // Getting this wrong would silently drop midwinter every 31 December.
        const wraps = tm < fm || (tm === fm && td < fd);
        if (wraps ? (after || before) : (after && before)) return s.map;
      }
      return null;
    },

    // The shard multiplier for finishing a run on the featured world. Additive
    // and small: a reason to visit, never a penalty for not.
    SEASON_BONUS: 1.25,
    seasonBonus(mapId) {
      return mapId && mapId === this.inSeason() ? this.SEASON_BONUS : 1;
    },

    // The cheapest thing they can't afford yet — shown on the game-over screen so
    // there's always a visible reason to tap RETRY.
    nextUnlock() {
      const buyable = all()
        // A teaser reading "next unlock — 0 shards" is not a reason to press
        // RETRY, it is a bug wearing a badge. The guard for that was here, but
        // on the item's PRICE rather than on what the player is short by — so
        // the moment they could afford the cheapest thing, the panel started
        // advertising it at zero after every single run. Filter on the gap.
        .filter((i) => !this.owned(i.id) && this.price(i.id)
          && this.price(i.id).shards > Store.shards)
        .sort((a, b) => this.price(a.id).shards - this.price(b.id).shards);
      if (!buyable.length) return null;
      const item = buyable[0];
      const p = this.price(item.id);
      return { id: item.id, price: p.shards, missing: Math.max(0, p.shards - Store.shards) };
    },

    // Shards awarded for a run. Modest, so unlocks take real play.
    // `mul` is the game mode's payout multiplier — harder modes pay more, and a
    // mode with no failure state passes 0 and earns nothing.
    // `moteWeight` is 1 / the world's moteRate, so shard income from motes does
    // not depend on how many the world spawns. Without it a map that thins the
    // motes is quietly under-paid — Mosslight loses ~38% of that term for a
    // trait that is supposed to be a trade — and any map that thickens them
    // would be strictly better, which is the rule this file opens with.
    //
    // The weight is passed IN rather than read from mapDef() here: on a Daily
    // the run has no world at all, while mapDef() keeps returning whatever the
    // player has equipped.
    award(score, motes, flowSec, mul, moteWeight) {
      const m = mul == null ? 1 : mul;
      if (m <= 0) return 0;
      const mw = moteWeight == null ? 1 : moteWeight;
      const s = Math.floor((Math.floor(score / 120) + motes * mw + Math.floor(flowSec * 3)) * m);
      Store.shards = Store.shards + s;
      return s;
    },
  };

  LUMEN.Cosmetics = Cosmetics;
})();
