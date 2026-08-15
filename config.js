/*
 * LUMEN — local configuration
 * -------------------------------------------------------------
 * index.html loads this if it exists and boots perfectly well without it, so it
 * is safe to leave half-filled.
 *
 * This file IS committed, unlike the template it came from. That is a decision,
 * not an oversight: see the last paragraph of this comment. The key below ships
 * inside every build and is readable by any player, so keeping it out of a
 * public repository would protect nothing and would only mean the deployed site
 * boots with no leaderboard. Guard the DATABASE with row-level security — that
 * is the thing that actually works. Never commit a service_role key.
 *
 * WHERE THE TWO VALUES COME FROM
 *   Supabase dashboard -> your project -> Project Settings -> API
 *     Project URL     -> supabaseUrl
 *     anon  public    -> supabaseAnonKey     <- the one labelled "anon", "public"
 *
 * DO NOT PASTE HERE
 *   service_role key       - it ignores every security policy you wrote
 *   Personal Access Token  - it can create and delete your projects
 *
 * Both of those give away control of your account. The anon key does not: it is
 * meant to be published, and Row Level Security is what actually guards the
 * table. See docs/LEADERBOARD.md.
 *
 * And be clear-eyed about what this file is. It is NOT a hiding place — it ships
 * inside the web build, the Steam build and the mobile build, and any player can
 * read it in under a minute. It exists to keep configuration in ONE place you
 * can edit without touching code. Secrecy was never on the list, which is why
 * committing it costs nothing and why a service_role key here would be fatal.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  LUMEN.CONFIG = {

    // ---------------------------------------------------------------
    //  PASTE BETWEEN THE QUOTES
    // ---------------------------------------------------------------

    supabaseUrl: 'https://tkmrtcqbqvksiuhzlgqe.supabase.co',
    //            ^ e.g.  https://abcdefghijklmnop.supabase.co
    //              (no trailing slash needed — it is stripped either way)

    supabaseAnonKey: 'sb_publishable_c7XEE_vAyLG4oXujzT4ZRA_uNSRPDBW',
    //                ^ the long "anon public" key, starts with  eyJ

    // ---------------------------------------------------------------

    // ---- Sign in with Apple ----
    // The Services ID registered in the Apple Developer portal, NOT the bundle
    // id. It is public by design: it identifies the app to Apple's sign-in page
    // and proves nothing on its own. The key that DOES prove something is the
    // .p8, which lives only on your machine and in Supabase's provider settings
    // as a signed secret — never here, and never in this repository.
    //
    // Empty means the web build simply has no sign-in button. The app still
    // does: on iOS the native sheet uses the bundle id and needs nothing here.
    appleServiceId: 'com.lumen.game.web',

    // Only if you self-host server/leaderboard-server.js instead.
    // Leave empty when using Supabase — Supabase wins if both are set.
    leaderboardEndpoint: '',

    // ---- the next-update vote (optional) ----
    // Delete this whole block, or leave  empty, and the vote simply does
    // not exist: no menu button, no screen, no requests.
    //
    // Running next month's poll is EDITING THIS OBJECT and re-uploading. No code
    // change, no release. That is deliberate — a monthly promise you can only
    // keep by shipping code is a promise you will eventually break.
    //
    // Keep every option to something that is a TABLE ENTRY in this codebase —
    // a mode (js/modes.js), a world or a signature (js/cosmetics.js). Those you
    // can always build in a month. Multiplayer is a different game.
    // ---- AdMob ------------------------------------------------------------
    // Real units. Putting them here is what turns the ad surfaces back on:
    // js/ads.js hides every one of them while `isTestAds` is true, so the game
    // never showed a player one of Google's "Test Ad" placeholders.
    //
    // These are not secrets — they ship inside the binary and any player can
    // read them in a minute. They are here so the switch lives in one file.
    admob: {
      ios: {
        app:      'ca-app-pub-8253427588583765~9285134085',
        rewarded: 'ca-app-pub-8253427588583765/4948489169',
      },
      // Android. mobile/lumen-ads now ships an android/ implementation, so the
      // only thing standing between this and live ads is a real app id here.
      // Leave the ids EMPTY and js/ads.js falls back to Google's test units and
      // hides every ad surface (isTestAds), which is the honest state until the
      // AdMob console has an Android app for com.lumen.game.
      android: {
        app:      'ca-app-pub-8253427588583765~7519300859',
        rewarded: 'ca-app-pub-8253427588583765/3140383782',
      },
    },

    poll: {
      id: '2026-09',                // any string; changing it opens a fresh vote for everybody
      closes: '2026-09-20',          // YYYY-MM-DD, in the player's own day
      options: [
        // name/desc take a plain string, or a { en, tr, es, zh } map.
        // kind is one of: mode | map | cosmetic
        {
          id: 'mirrorworld', kind: 'map',
          name: { en: 'Mirrorworld', tr: 'Ayna Dünya' },
          desc: {
            en: 'A world that reflects the corridor back at you.',
            tr: 'Koridoru sana geri yansıtan bir dünya.',
          },
        },
        { id: 'pacer', kind: 'mode',
          name: { en: 'Pacer', tr: 'Tempo' },
          desc: { en: 'A ghost of your best run flies beside you.',
                  tr: 'En iyi koşunun hayaleti yanında uçar.' } },
        { id: 'aurora_set', kind: 'cosmetic',
          name: { en: 'Aurora set', tr: 'Aurora seti' },
          desc: { en: 'Orb, trail and signature in one northern-light look.',
                  tr: 'Kutup ışığı temalı orb, iz ve imza.' } },
      ],
    },

    // Where players send IDEAS. Deliberately NOT a text box in the game: a
    // stranger's free text going straight into a shared database is a
    // moderation problem and, once shown to other players, your liability.
    // Collect wherever your community already is; you pick the five.
    ideasUrl: '',             // e.g. a Discord invite or a form
  };
})();
