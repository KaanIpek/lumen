/*
 * LUMEN — local configuration
 * -------------------------------------------------------------
 * COPY THIS FILE TO  config.js  AND PUT YOUR OWN VALUES IN.
 *
 * config.js is git-ignored and index.html loads it optionally: if it is not
 * there, nothing breaks and the game runs exactly as it does now. This is the
 * .env of a site with no build step — a browser cannot read a .env file, but it
 * can read a script that sets a few values.
 *
 * WHAT BELONGS HERE
 *   Values that are public but deployment-specific: which project this build
 *   talks to, which board it writes to.
 *
 * WHAT DOES NOT
 *   Anything that must stay secret. This file is served to every player and can
 *   be read with two clicks. In particular:
 *
 *     - Supabase `anon` key      -> fine. It is designed to be published, and
 *                                   Row Level Security is what protects the
 *                                   table. See docs/LEADERBOARD.md.
 *     - Supabase `service_role`  -> NEVER. It ignores every policy you wrote.
 *     - Personal Access Token    -> NEVER. It can create and delete projects.
 *
 * If a key would be dangerous in a stranger's hands, it does not go in a file
 * the browser downloads — no matter how well hidden the file looks.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  LUMEN.CONFIG = {
    // ---- online leaderboard (optional) ----
    // Supabase dashboard -> Project Settings -> API
    supabaseUrl: '',          // e.g. 'https://abcdefghijkl.supabase.co'
    supabaseAnonKey: '',      // the "anon public" key, NOT service_role

    // Or a self-hosted board (server/leaderboard-server.js). If both are set,
    // Supabase wins.
    leaderboardEndpoint: '',  // e.g. 'https://your-host.example/api'

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
    poll: {
      id: '2026-09',                 // change this and everybody may vote again
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
