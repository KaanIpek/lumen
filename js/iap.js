/*
 * LUMEN — in-app purchases
 * -------------------------------------------------------------
 * The store can charge in shards (earned) or in real money. This
 * file is the real-money half.
 *
 * IMPORTANT, and stated plainly: no payment processor ships here.
 * Charging money needs a merchant account, server-side keys and a
 * receipt-validation endpoint — none of which can live in a client
 * bundle. What this file provides is the whole flow around that:
 * catalogue, price formatting, purchase/restore calls, entitlement
 * granting, and a single `provider` interface to plug a real
 * processor into (Stripe, Play Billing, StoreKit, Paddle…).
 *
 * Until a provider is registered the store shows shard prices only,
 * so the game never advertises a payment it cannot take. In dev you
 * can register the mock below to exercise the whole path.
 *
 *   LUMEN.IAP.register(LUMEN.IAP.mockProvider())   // dev only
 *
 * A real provider must implement:
 *   isReady()                        -> bool
 *   purchase(sku, priceUsd)          -> Promise<{ok, receipt?}>   (charges + validates server-side)
 *   restore()                        -> Promise<string[]>          (skus this user already owns)
 *   formatPrice?(usd)                -> string                     (localised/regional price)
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});
  const Store = LUMEN.Store;

  const IAP = {
    provider: null,

    register(p) { this.provider = p || null; },
    // Asking whether the store is open is what opens it. Every cash surface in
    // the UI reads this getter before drawing, so registration cannot be missed
    // by anything that matters — and it still costs one attempt, never a retry
    // loop, because `tried` latches.
    get available() {
      if (this.ensureProvider) this.ensureProvider();
      return !!(this.provider && this.provider.isReady && this.provider.isReady());
    },
    // True while the store is running on the built-in placeholder rather than a
    // real processor. The UI must say so on every price — a player should never
    // be unsure whether they were actually charged.
    get sandbox() { return !!(this.provider && this.provider._sandbox); },

    // Regional formatting is the provider's job when it has one; otherwise show a
    // plain USD figure rather than pretending to know the player's currency.
    formatPrice(usd, id) {
      if (!usd) return '';
      if (this.provider && this.provider.formatPrice) {
        // `id` reaches StoreKit, which answers with Apple's own localised price
        // for this storefront. Without it every price in the app would be a
        // dollar figure we invented, which is wrong outside the US twice over:
        // wrong symbol, and wrong number once a tier maps to a local one.
        try { return this.provider.formatPrice(usd, id); } catch (e) { /* fall through */ }
      }
      return '$' + usd.toFixed(2);
    },

    // Buy a cosmetic with real money. Resolves to a plain result the UI can act on
    // without knowing anything about payments.
    async purchase(id) {
      const C = LUMEN.Cosmetics;
      if (!C) return { ok: false, reason: 'unavailable' };
      // A SET is a single product that grants several cosmetics, so ownership
      // and price resolve differently: it is "owned" only once every piece is,
      // and it only carries a cash price while nothing in it is owned — a fixed
      // store SKU cannot be discounted per player, and charging the full bundle
      // for a remainder would be taking money for something already paid for.
      const set = C.setDef && C.setDef(id);
      if (set) {
        const sp = C.setPrice(id);
        if (!sp || sp.complete) return { ok: false, reason: 'owned' };
        if (!sp.usd) return { ok: false, reason: 'not_for_sale' };
        if (!this.available) return { ok: false, reason: 'unavailable' };
        return this._charge(id, sp.usd, () => C.grantSet(id));
      }
      if (C.owned(id)) return { ok: false, reason: 'owned' };
      const price = C.price(id);
      if (!price || !price.usd) return { ok: false, reason: 'not_for_sale' };
      if (!this.available) return { ok: false, reason: 'unavailable' };

      return this._charge(id, price.usd, () => C.grant(id));
    },

    // The provider call, the analytics either side of it, and the entitlement —
    // shared by single cosmetics and by sets so a bundle can never drift into a
    // second, subtly different payment path.
    // Shard packs. Not cosmetics, so they do not go through the catalogue: there
    // is nothing to own and nothing to restore — a consumable is bought, spent,
    // and bought again. Restore deliberately ignores them for that reason.
    PACKS: [
      { id: 'shards_small',  shards: 1200,  usd: 1.99 },
      { id: 'shards_medium', shards: 6500,  usd: 4.99 },
      { id: 'shards_large',  shards: 15000, usd: 9.99 },
    ],
    pack(id) { return this.PACKS.find((p) => p.id === id) || null; },
    async buyShards(id) {
      const p = this.pack(id);
      if (!p) return { ok: false, reason: 'unknown_pack' };
      if (!this.available) return { ok: false, reason: 'unavailable' };
      return this._charge(p.id, p.usd, () => {
        if (LUMEN.Cosmetics && LUMEN.Cosmetics.grantShards) LUMEN.Cosmetics.grantShards(p.shards);
        else LUMEN.Store.shards = LUMEN.Store.shards + p.shards;
      });
    },

    async _charge(id, usd, grant) {
      LUMEN.Analytics && LUMEN.Analytics.track('iap_start', { sku: id, usd });
      let res;
      try {
        res = await this.provider.purchase(id, usd);
      } catch (e) {
        res = { ok: false };
      }
      if (!res || !res.ok) {
        LUMEN.Analytics && LUMEN.Analytics.track('iap_cancel', { sku: id });
        return { ok: false, reason: 'cancelled' };
      }
      // Entitlement is recorded locally. With a real provider the receipt is the
      // source of truth and restore() re-grants on a new device.
      grant();
      // A consumable is bought, spent, and bought again — remembering it would
      // put shard packs in the restore list, where a second device would
      // "re-grant" currency the player already spent, forever, for free.
      if (!this.pack(id)) this._remember(id);
      LUMEN.Analytics && LUMEN.Analytics.track('iap_complete', { sku: id, usd });
      return { ok: true };
    },

    // Re-grant anything this account already paid for.
    async restore() {
      if (!this.available || !this.provider.restore) return { ok: false, count: 0 };
      let skus = [];
      try { skus = (await this.provider.restore()) || []; } catch (e) { return { ok: false, count: 0 }; }
      let n = 0;
      const C = LUMEN.Cosmetics;
      for (const sku of skus) {
        // A set SKU is not a cosmetic id, so grant() would find nothing and a
        // player who paid on one device would restore to an empty inventory on
        // the next. Sets are re-granted piece by piece.
        const set = C && C.setDef && C.setDef(sku);
        if (set) {
          const before = set.items.filter((it) => C.owned(it)).length;
          C.grantSet(sku);
          if (set.items.filter((it) => C.owned(it)).length > before) n++;
        } else if (this.pack(sku)) {
          continue;                       // consumable: nothing to restore
        } else if (C && C.def && !C.def(sku)) {
          continue;                       // an id this build does not know
        } else if (C && !C.owned(sku) && C.grant(sku)) n++;
        this._remember(sku);
      }
      return { ok: true, count: n };
    },

    purchased() { return Store.purchases; },
    _remember(id) {
      const p = Store.purchases;
      if (p.indexOf(id) < 0) { p.push(id); Store.purchases = p; }
    },

    // ---- development mock ---------------------------------------------------
    // Simulates the full round trip (including the player cancelling) so the
    // store UI can be exercised without a merchant account.
    mockProvider(opts) {
      opts = opts || {};
      const bought = [];
      return {
        _mock: true,
        isReady: () => true,
        formatPrice: (usd) => '$' + usd.toFixed(2),
        purchase(sku) {
          return new Promise((resolve) => {
            setTimeout(() => {
              if (opts.alwaysCancel) return resolve({ ok: false });
              bought.push(sku);
              resolve({ ok: true, receipt: 'mock-' + sku });
            }, opts.delay || 120);
          });
        },
        restore() { return Promise.resolve(bought.slice()); },
      };
    },

    // ---- built-in sandbox checkout -----------------------------------------
    // Registered by default so the money side of the store is fully present and
    // playable: prices show, the checkout opens, cancelling works, and a
    // completed purchase grants and restores exactly as the real thing will.
    // The only missing piece is the processor, so NOTHING is ever charged and
    // every surface says "sandbox" out loud. Swap it out with one call:
    //
    //   LUMEN.IAP.register(myStripeOrPlayBillingProvider)
    //
    sandboxProvider() {
      return {
        _sandbox: true,
        isReady: () => true,
        formatPrice: (usd) => '$' + usd.toFixed(2),
        purchase(sku, usd) {
          const UI = LUMEN.UI;
          if (UI && UI.confirmPurchase) return UI.confirmPurchase(sku, usd);
          return Promise.resolve({ ok: false });
        },
        restore() { return Promise.resolve(LUMEN.Store ? LUMEN.Store.purchases.slice() : []); },
      };
    },
  };

  // ---- StoreKit -----------------------------------------------------------
  // App Store product ids. Reverse-DNS off the bundle id because Apple's ids are
  // global across every app on the store, not per-app, so a bare "shards_small"
  // is both likely taken and impossible to reason about in a report.
  //
  // These strings must match App Store Connect EXACTLY. A typo does not error:
  // Product.products(for:) simply returns nothing for the id it cannot find, the
  // tile disappears, and it looks like the store is down.
  const SK_PREFIX = 'com.lumen.game.';
  const SK_ID = {
    shards_small:  SK_PREFIX + 'shards.small',
    shards_medium: SK_PREFIX + 'shards.medium',
    shards_large:  SK_PREFIX + 'shards.large',
    nightfall:     SK_PREFIX + 'set.nightfall',
    spectra:       SK_PREFIX + 'set.spectra',
    rimefall:      SK_PREFIX + 'set.rimefall',
  };
  const SK_LOCAL = Object.fromEntries(Object.entries(SK_ID).map(([k, v]) => [v, k]));

  IAP.storeKitProvider = function (plugin) {
    let priced = {};      // local id -> Apple's already-localised price string
    let loaded = false;

    const load = () => plugin.products({ ids: Object.values(SK_ID) })
      .then((r) => {
        priced = {};
        (r && r.products ? r.products : []).forEach((p) => {
          const local = SK_LOCAL[p.id];
          if (local) priced[local] = p.price;
        });
        loaded = true;
        const got = Object.keys(priced).length;
        const want = Object.keys(SK_ID).length;
        // Plain "ok" only when every product came back. A partial answer means
        // some tile is showing a dash instead of a price, and that has to be
        // visible somewhere rather than reading as success.
        IAP.diag = got === want ? 'ok' : 'ok, ' + got + ' of ' + want + ' products';
      })
      .catch((e) => {
        loaded = true;
        IAP.diag = 'products failed: ' + String((e && e.message) || e).slice(0, 80);
      });
    load();

    return {
      _storekit: true,
      isReady: () => true,
      // Apple's displayPrice, never a number we format. A hardcoded "$" is wrong
      // in most of the world, and the amount is wrong too the moment a price
      // tier maps to a local one — ₺, ¥ and € tiers are not conversions.
      formatPrice(usd, id) {
        if (id && priced[id]) return priced[id];
        return loaded ? '—' : '…';
      },
      purchase(sku) {
        const appleId = SK_ID[sku];
        if (!appleId) return Promise.resolve({ ok: false, reason: 'unknown_product' });
        // `consumable` matters ONLY on Play, and it matters a lot: a purchase
        // that is not finished within three days is refunded, a consumable is
        // finished by consuming it and everything else by acknowledging it, and
        // the two are not interchangeable — consume a set and the player can be
        // charged twice, acknowledge a shard pack and they can never buy shards
        // again. StoreKit ignores the extra key.
        return plugin.purchase({ id: appleId, consumable: !!IAP.pack(sku) })
          .then((r) => (r && r.ok
            ? { ok: true, receipt: r.transactionId }
            : { ok: false, reason: (r && r.reason) || 'failed' }))
          .catch((e) => ({ ok: false, reason: String((e && e.message) || e) }));
      },
      // Consumables never come back — a spent shard pack restored on every
      // reinstall would print currency. Only the sets are non-consumable, and
      // giving them back is what the Restore button is required to do.
      restore() {
        return plugin.restore()
          .then((r) => (r && r.owned ? r.owned : []).map((id) => SK_LOCAL[id]).filter(Boolean))
          .catch(() => []);
      },
    };
  };

  LUMEN.IAP = IAP;

  // The sandbox checkout ships on the WEB and desktop builds only.
  //
  // Inside the App Store / Play wrapper it must never register: it grants the
  // item from a plain in-page confirmation with no processor behind it, which
  // is both a free unlock and exactly what App Store guideline 3.1.1 forbids —
  // digital goods sold through anything other than in-app purchase. With no
  // provider, `available` is false, the cash tiles hide themselves and the shop
  // falls back to shard prices, which is the honest state until a real StoreKit
  // provider is registered.
  const isNative = () => !!(window.LUMEN_NATIVE ||
    (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()));

  // Registered LAZILY, on first use — not while this file is being parsed.
  //
  // js/ads.js reaches its plugin through a getter and works on device; this did
  // it eagerly at module load and did not. The bridge Capacitor injects is not
  // reliably on `window` at the moment our synchronous script tags run, and a
  // miss here is silent: no provider, `available` false, and every cash tile in
  // the shop quietly absent with nothing on screen to say why. Deferring until
  // something actually asks removes the race entirely.
  let tried = false;
  // Tests only: drop the one-attempt latch so a different bridge can be tried.
  IAP._resetProvider = function (p) { tried = false; this.provider = p || null; };
  IAP.ensureProvider = function () {
    if (tried || this.provider) return;
    tried = true;
    if (!isNative()) {
      // Web and desktop keep the sandbox checkout: prices show, the flow works,
      // and nothing is ever charged.
      this.register(this.sandboxProvider());
      this.diag = 'sandbox (not native)';
      return;
    }
    // StoreKit, or nothing at all. With no provider the cash tiles hide and the
    // shop is a shard shop — a smaller failure than a price nothing can charge.
    try {
      const C = window.Capacitor;
      if (!C) { this.diag = 'no Capacitor global'; tried = false; return; }
      // `Capacitor.Plugins.X` FIRST, exactly like js/ads.js and js/native.js.
      //
      // This is why the whole cash store was invisible on device while rewarded
      // ads worked: `registerPlugin` belongs to the @capacitor/core JS runtime,
      // which a bundler puts in your bundle. LUMEN has no build step, so the
      // only Capacitor on `window` is the bridge the native shell injects — and
      // that one exposes `Plugins`, not `registerPlugin`. Asking for the missing
      // function returned nothing, no provider registered, `available` went
      // false, and every price in the game hid itself without a word.
      const plugin = (C.Plugins && C.Plugins.LumenStore) ||
        (typeof C.registerPlugin === 'function' ? C.registerPlugin('LumenStore') : null);
      if (!plugin) { this.diag = 'no LumenStore plugin'; tried = false; return; }
      if (!plugin.products) { this.diag = 'plugin has no products()'; tried = false; return; }
      this.register(this.storeKitProvider(plugin));
      this.diag = 'ok';
    } catch (e) {
      this.diag = 'threw: ' + String((e && e.message) || e).slice(0, 80);
      tried = false;
    }
  };

  // One deferred attempt so the shop is ready before anyone opens it, and a
  // guarded one at load for the web, where there is no bridge to wait for.
  if (!isNative()) IAP.ensureProvider();
  else if (typeof setTimeout === 'function') setTimeout(() => IAP.ensureProvider(), 0);
})();
