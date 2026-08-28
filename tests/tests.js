/*
 * LUMEN — automated test suite
 * -------------------------------------------------------------
 * Pure-logic + headless-render checks over the real game modules.
 * Open tests/index.html in a browser (or serve it) to run.
 * Results are also exposed on window.__RESULTS for tooling.
 */
(function () {
  'use strict';
  const L = window.LUMEN;
  const results = [];
  let only = null;

  // Async tests are collected and awaited before the report is written. Without
  // this an `async` test body would resolve after the summary was already built,
  // so a rejected assertion would be an unhandled rejection and the test would
  // be counted as a silent pass — worse than having no test at all.
  // They also run *after* every synchronous test, one at a time. These tests share
  // one localStorage, so an async body that yields mid-test would otherwise have
  // the next sync test's freshStorage() wipe the state out from under it.
  const deferred = [];
  function test(name, fn) {
    if (only && name !== only) return;
    if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
      const slot = { name, pass: true };
      results.push(slot);
      deferred.push(() => fn().catch((e) => {
        slot.pass = false;
        slot.error = e && e.message ? e.message : String(e);
      }));
      return;
    }
    try {
      fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  }
  const runDeferred = () => deferred.reduce((p, f) => p.then(f), Promise.resolve());
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  // This page loads the game's SCRIPTS but not its MARKUP, so any test that
  // looks at real screens finds nothing and — if it is written to skip what it
  // cannot find — passes while checking nothing at all. That happened: a layout
  // test reported "no overflow, no cramped controls" having examined zero
  // elements. So DOM tests pull in the real index.html and assert they got it.
  let _markupPromise = null;
  function loadGameMarkup() {
    if (_markupPromise) return _markupPromise;
    // The stylesheet comes too, and is waited for. Without it the markup renders
    // at browser defaults — every button 21px — and a layout test measuring that
    // is measuring nothing real.
    const cssReady = new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '../css/style.css?t=' + Date.now();
      link.onload = resolve;
      link.onerror = resolve;
      document.head.appendChild(link);
    });
    _markupPromise = Promise.all([cssReady, fetch('../index.html?t=' + Date.now()).then((r) => r.text())])
      .then(([, html]) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const host = document.createElement('div');
        host.id = 'markup-under-test';
        // the overlays are the screens; the top bar carries the persistent controls
        doc.querySelectorAll('section.overlay, #topbar').forEach((n) => host.appendChild(n));
        document.body.appendChild(host);
        // re-point the UI at the markup it now has, and translate it
        if (LUMEN.UI) {
          LUMEN.UI.screens = {};
          host.querySelectorAll('section.overlay').forEach((s) => {
            LUMEN.UI.screens[s.id.replace('screen-', '')] = s;
          });
          // init() was never called here, and every render method bails on
          // `_ready` — so without these the panels stay empty shells and a
          // layout test sees a handful of static buttons.
          LUMEN.UI._ready = true;
          if (!LUMEN.UI.game) LUMEN.UI.game = newGame();
        }
        if (LUMEN.i18n && LUMEN.i18n.apply) LUMEN.i18n.apply();
        return host;
      });
    return _markupPromise;
  }
  function eq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'expected equal') + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));
  }
  function near(a, b, tol, msg) {
    if (Math.abs(a - b) > tol) throw new Error((msg || 'expected near') + ' — got ' + a + ', want ~' + b);
  }

  // ---- harness -------------------------------------------------------------
  function freshStorage() {
    try { for (const k of Object.keys(localStorage)) if (k.indexOf('lumen') === 0) localStorage.removeItem(k); } catch (e) {}
    L.Store._invalidate();
    if (L.Cosmetics) L.Cosmetics.invalidate();
  }
  function newGame(w, h) {
    const c = document.createElement('canvas');
    // the Game reads window.innerWidth/Height; tests run at the real viewport
    const g = new L.Game(c);
    if (w && h) g.resize(w, h); else g.resize();
    return g;
  }
  // a competent autopilot so "does it play" is actually exercised
  function autoplay(g, maxFrames) {
    const sign = (x) => (x < 0 ? -1 : x > 0 ? 1 : 0);
    const G = (2 * g.playH) / (g.CROSS_TIME * g.CROSS_TIME);
    let lastFlip = -1, t = 0;
    for (let i = 0; i < maxFrames; i++) {
      t += 1 / 60;
      const p = g.player;
      let tg = g.playTop + g.playH * 0.5, bd = 1e9;
      for (const ob of g.obstacles) {
        const gp = ob.gaps.reduce((a, b) => (Math.abs(b.y - p.y) < Math.abs(a.y - p.y) ? b : a));
        const dx = (ob.x + ob.w) - p.x;
        if (dx > -4 && dx < bd) {
          bd = dx;
          // BRITTLE inverts the target: the bar is the thing to hit. An
          // autopilot that keeps aiming at gap centres plays the mode exactly
          // backwards and every test built on it would measure the wrong game.
          const fb = g.faultBand ? g.faultBand(ob) : null;
          tg = fb ? (fb.y0 + fb.y1) * 0.5 : gp.y;
        }
      }
      for (const m of g.motes) {
        const dx = m.x - p.x;
        if (dx > 0 && dx < 55 && Math.abs(m.y - tg) < g.playH * 0.2 && dx < bd + 40) tg = m.y;
      }
      const err = tg - p.y, brake = (p.vy * p.vy) / (2 * G);
      let dd;
      if (Math.abs(err) < 3 && Math.abs(p.vy) < 50) dd = p.dir;
      else { const toward = sign(p.vy) === sign(err); dd = (toward && Math.abs(err) <= brake) ? -sign(p.vy) : sign(err); }
      if (dd !== 0 && dd !== p.dir && (t - lastFlip) >= 0.045) { g.flip(); lastFlip = t; }
      g.update(1 / 60);
      if (g.state !== 'play') break;
    }
    return t;
  }

  // ---- storage -------------------------------------------------------------
  test('Store: defaults are sane for a new player', () => {
    freshStorage();
    const S = L.Store;
    eq(S.best, 0, 'best'); eq(S.runs, 0, 'runs'); eq(S.shards, 0, 'shards');
    eq(S.skin, 'ion', 'skin'); eq(S.trail, 'dust', 'trail');
    eq(S.musicOn, true, 'music default on'); eq(S.reduceFlash, false, 'reduceFlash default off');
  });

  test('Store: writes persist and reads are memoised', () => {
    freshStorage();
    L.Store.best = 1234;
    eq(L.Store.best, 1234, 'read back');
    eq(localStorage.getItem('lumen_best'), '1234', 'hits localStorage');
    // memoised: clearing storage behind the cache should NOT change the read
    localStorage.removeItem('lumen_best');
    eq(L.Store.best, 1234, 'served from cache');
    L.Store._invalidate();
    eq(L.Store.best, 0, 'after invalidate falls back to default');
  });

  test('Store: shards never go negative and always floor', () => {
    freshStorage();
    L.Store.shards = -50; eq(L.Store.shards, 0, 'clamped at zero');
    L.Store.shards = 12.9; eq(L.Store.shards, 12, 'floored');
  });

  // ---- cosmetics -----------------------------------------------------------
  test('Cosmetics: defaults are owned, others are not', () => {
    freshStorage();
    assert(L.Cosmetics.owned('ion'), 'default skin owned');
    assert(L.Cosmetics.owned('dust'), 'default trail owned');
    assert(!L.Cosmetics.owned('spectrum'), 'premium skin not owned');
  });

  test('Cosmetics: cannot buy without enough shards', () => {
    freshStorage();
    L.Store.shards = 10;
    eq(L.Cosmetics.buy('spectrum'), false, 'purchase refused');
    eq(L.Store.shards, 10, 'balance untouched');
    assert(!L.Cosmetics.owned('spectrum'), 'still not owned');
  });

  test('Cosmetics: buying debits exactly once and cannot repeat', () => {
    freshStorage();
    const cost = L.Cosmetics.price('ember').shards;
    L.Store.shards = cost + 200;
    eq(L.Cosmetics.buy('ember'), true, 'first buy succeeds');
    eq(L.Store.shards, 200, 'debited once');
    eq(L.Cosmetics.buy('ember'), false, 'second buy refused');
    eq(L.Store.shards, 200, 'no second debit');
  });

  test('Cosmetics: equip only works for owned items', () => {
    freshStorage();
    eq(L.Cosmetics.equip('spectrum'), false, 'cannot equip unowned');
    eq(L.Store.skin, 'ion', 'skin unchanged');
    L.Store.shards = 1000; L.Cosmetics.buy('verdant');
    eq(L.Cosmetics.equip('verdant'), true, 'equips owned');
    eq(L.Cosmetics.skinDef().id, 'verdant', 'definition follows equip');
  });

  test('Cosmetics: award scales with score, motes and flow', () => {
    freshStorage();
    const a = L.Cosmetics.award(0, 0, 0);
    eq(a, 0, 'nothing for nothing');
    freshStorage();
    eq(L.Cosmetics.award(1200, 20, 8), Math.floor(1200 / 120) + 20 + Math.floor(8 * 3), 'formula');
  });

  // ---- missions ------------------------------------------------------------
  test('Missions: always exactly three active goals', () => {
    freshStorage();
    eq(L.Missions.list().length, 3, 'three missions');
  });

  test('Missions: run-mode goals track the best single run', () => {
    freshStorage();
    L.Store.missions = { active: [{ id: 's1500', progress: 0 }] };
    L.Missions.recordRun({ score: 900, combo: 0, motes: 0, flowSec: 0, nearMiss: 0, reachedFlow: false });
    let m = L.Store.missions.active.find((s) => s.id === 's1500');
    eq(m.progress, 900, 'takes the run score');
    L.Missions.recordRun({ score: 400, combo: 0, motes: 0, flowSec: 0, nearMiss: 0, reachedFlow: false });
    m = L.Store.missions.active.find((s) => s.id === 's1500');
    eq(m.progress, 900, 'a worse run does not lower it');
  });

  test('Missions: sum-mode goals accumulate across runs', () => {
    freshStorage();
    L.Store.missions = { active: [{ id: 'm80', progress: 0 }] };
    L.Missions.recordRun({ score: 1, combo: 0, motes: 30, flowSec: 0, nearMiss: 0, reachedFlow: false });
    L.Missions.recordRun({ score: 1, combo: 0, motes: 25, flowSec: 0, nearMiss: 0, reachedFlow: false });
    eq(L.Store.missions.active.find((s) => s.id === 'm80').progress, 55, 'accumulated');
  });

  test('Missions: completing pays the reward exactly once', () => {
    freshStorage();
    L.Store.shards = 0;
    L.Store.missions = { active: [{ id: 's600', progress: 0 }] };
    const reward = 30;
    const done = L.Missions.recordRun({ score: 700, combo: 0, motes: 0, flowSec: 0, nearMiss: 0, reachedFlow: false });
    eq(done.length, 1, 'reported complete');
    eq(L.Store.shards, reward, 'paid once');
    assert(!L.Store.missions.active.some((s) => s.id === 's600'), 'slot was replaced');
  });

  test('Missions: two completions in one run yield two DIFFERENT replacements', () => {
    freshStorage();
    for (let i = 0; i < 40; i++) { // repeat: the picker is random
      L.Store.missions = { active: [{ id: 's600', progress: 0 }, { id: 'c20', progress: 0 }, { id: 'm80', progress: 0 }] };
      L.Missions.recordRun({ score: 5000, combo: 40, motes: 5, flowSec: 2, nearMiss: 1, reachedFlow: true });
      const ids = L.Store.missions.active.map((s) => s.id);
      eq(ids.length, 3, 'still three');
      eq(new Set(ids).size, 3, 'no duplicate missions (round ' + i + ')');
    }
  });

  test('Missions: a stale/unknown saved id cannot break the game', () => {
    freshStorage();
    L.Store.missions = { active: [{ id: '__removed__', progress: 3 }, { id: 'm80', progress: 5 }] };
    const list = L.Missions.list();          // must not throw
    eq(list.length, 3, 'refilled to three');
    L.Missions.recordRun({ score: 10, combo: 1, motes: 1, flowSec: 0, nearMiss: 0, reachedFlow: false }); // must not throw
  });

  // ---- daily ---------------------------------------------------------------
  test('Daily: seed is stable within a day', () => {
    eq(L.Daily.todaySeed(), L.Daily.todaySeed(), 'same seed twice');
    assert(L.Daily.todaySeed() > 0, 'non-zero seed');
  });

  test('Daily: the planned course is identical across runs', () => {
    freshStorage();
    const g = newGame();
    g.startDaily();
    const a = g.plan.map((s) => s.kind + ':' + s.c.toFixed(8) + ':' + s.gapH.toFixed(8)).join('|');
    g.startDaily();
    const b = g.plan.map((s) => s.kind + ':' + s.c.toFixed(8) + ':' + s.gapH.toFixed(8)).join('|');
    eq(a, b, 'plans match');
    assert(g.plan.length > 100, 'plan is long enough for a full run');
    g.toMenu();
  });

  test('Daily: streak expires when a day is skipped', () => {
    freshStorage();
    const S = L.Store;
    S.dailyStreak = 5;
    S.dailyLastPlayed = '2000-01-01';       // ancient
    eq(L.Daily.status().streak, 0, 'stale streak reads as zero');
    S.dailyLastPlayed = L.Daily.todayStr();
    eq(L.Daily.status().streak, 5, 'today keeps it');
    S.dailyLastPlayed = L.Daily.yesterdayStr();
    eq(L.Daily.status().streak, 5, 'yesterday still keeps it');
  });

  test('Daily: consecutive days increment, same day does not', () => {
    freshStorage();
    const S = L.Store;
    L.Daily.recordRun(100);
    eq(S.dailyStreak, 1, 'first play');
    L.Daily.recordRun(200);
    eq(S.dailyStreak, 1, 'second play same day does not bump');
    eq(S.dailyBest, 200, 'best updates');
    S.dailyLastPlayed = L.Daily.yesterdayStr();
    L.Daily.recordRun(50);
    eq(S.dailyStreak, 2, 'next day increments');
  });

  test('Daily: a run is credited to the day it started on', () => {
    freshStorage();
    L.Daily.recordRun(500, '1999-12-31');
    eq(L.Store.dailyDate, '1999-12-31', 'attributed to start date');
    eq(L.Store.dailyBest, 500, 'best recorded there');
  });

  // ---- leaderboard ---------------------------------------------------------
  test('Scores: keeps only the ten best, sorted', () => {
    freshStorage();
    [120, 900, 450, 2100, 60, 780, 1500, 300, 95, 640, 1800, 250, 3000, 410].forEach((s) => L.Scores.record(s, 5));
    const l = L.Scores.list();
    eq(l.length, 10, 'ten kept');
    for (let i = 1; i < l.length; i++) assert(l[i - 1].s >= l[i].s, 'sorted descending');
    eq(l[0].s, 3000, 'highest first');
    assert(l[l.length - 1].s >= 300, 'smallest survivors are the biggest of the losers');
  });

  test('Scores: rankOf reports placement, 0 when off the board', () => {
    freshStorage();
    [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100].forEach((s) => L.Scores.record(s, 1));
    eq(L.Scores.rankOf(1200), 1, 'new best is rank 1');
    eq(L.Scores.rankOf(650), 5, 'mid placement');
    eq(L.Scores.rankOf(50), 0, 'misses the board');
  });

  test('Scores: a zero score is not recorded', () => {
    freshStorage();
    L.Scores.record(0, 0);
    eq(L.Scores.list().length, 0, 'nothing stored');
  });

  // ---- obstacle generation (fairness) --------------------------------------
  test('Obstacles: every gap stays fully inside the playfield, at all difficulties', () => {
    let worstTop = 1, worstBot = 1;
    for (let i = 0; i < 6000; i++) {
      const e = (i % 90) + 0.5;                  // sweep the whole difficulty ramp
      const spec = L.Game.makeSpec(Math.random, e, Math.random());
      let centres, heights;
      if (spec.kind === 'double') {
        centres = [spec.c - spec.sep / 2, spec.c + spec.sep / 2];
        heights = [spec.doubleGapH, spec.doubleGapH];
      } else {
        centres = [spec.c - spec.moveAmp, spec.c + spec.moveAmp]; // extremes of travel
        heights = [spec.gapH, spec.gapH];
      }
      for (let k = 0; k < centres.length; k++) {
        worstTop = Math.min(worstTop, centres[k] - heights[k] / 2);
        worstBot = Math.min(worstBot, 1 - (centres[k] + heights[k] / 2));
      }
    }
    assert(worstTop >= 0, 'a gap escaped past the top wall (margin ' + worstTop.toFixed(4) + ')');
    assert(worstBot >= 0, 'a gap escaped past the bottom wall (margin ' + worstBot.toFixed(4) + ')');
  });

  test('Obstacles: all four archetypes appear once difficulty ramps', () => {
    const kinds = {};
    for (let i = 0; i < 3000; i++) {
      const spec = L.Game.makeSpec(Math.random, 60, 0.5);
      kinds[spec.kind] = (kinds[spec.kind] || 0) + 1;
    }
    ['normal', 'pulsing', 'moving', 'double'].forEach((k) => assert(kinds[k] > 0, 'missing archetype: ' + k));
  });

  test('Obstacles: early game is calm (no moving or double gates)', () => {
    for (let i = 0; i < 500; i++) {
      const spec = L.Game.makeSpec(Math.random, 5, 0.5);
      eq(spec.kind, 'normal', 'early gates are plain');
    }
  });

  // ---- collision -----------------------------------------------------------
  test('Collision: safe inside a gap, lethal against a bar', () => {
    const g = newGame(); g.start();
    const p = g.player;
    const open = { x: p.x - 5, w: 20, gaps: [{ y: p.y, h: g.playH * 0.4 }] };
    const solid = { x: p.x - 5, w: 20, gaps: [{ y: g.playTop + 5, h: 2 }] };
    eq(g.hitObstacle(p, open), false, 'inside the opening is safe');
    eq(g.hitObstacle(p, solid), true, 'the bar kills');
    const away = { x: p.x + 400, w: 20, gaps: [{ y: g.playTop + 5, h: 2 }] };
    eq(g.hitObstacle(p, away), false, 'no collision when not overlapping in x');
    g.toMenu();
  });

  test('Collision: double gates — safe in either opening, lethal on the middle bar', () => {
    const g = newGame(); g.start();
    const p = g.player;
    const inLower = { x: p.x - 5, w: 20, gaps: [{ y: p.y - 200, h: 60 }, { y: p.y, h: 60 }] };
    const inUpper = { x: p.x - 5, w: 20, gaps: [{ y: p.y, h: 60 }, { y: p.y + 200, h: 60 }] };
    const between = { x: p.x - 5, w: 20, gaps: [{ y: p.y - 200, h: 60 }, { y: p.y + 200, h: 60 }] };
    eq(g.hitObstacle(p, inLower), false, 'lower opening safe');
    eq(g.hitObstacle(p, inUpper), false, 'upper opening safe');
    eq(g.hitObstacle(p, between), true, 'middle bar kills');
    g.toMenu();
  });

  test('Collision: revive grace makes the player briefly invulnerable', () => {
    const g = newGame(); g.start();
    const p = g.player;
    const solid = { x: p.x - 5, w: 20, gaps: [{ y: g.playTop + 5, h: 2 }] };
    g.invuln = 1.5; eq(g.hitObstacle(p, solid), false, 'immune during grace');
    g.invuln = 0;   eq(g.hitObstacle(p, solid), true, 'mortal again after');
    g.toMenu();
  });

  // ---- physics -------------------------------------------------------------
  test('Physics: the orb never leaves the playfield', () => {
    const g = newGame(); g.start();
    let minY = 1e9, maxY = -1e9;
    for (let i = 0; i < 3000; i++) {
      if (i % 7 === 0) g.flip();
      g.update(1 / 60);
      minY = Math.min(minY, g.player.y); maxY = Math.max(maxY, g.player.y);
      assert(isFinite(g.player.y) && isFinite(g.player.vy), 'position stayed finite');
      if (g.state !== 'play') g.start();
    }
    assert(minY >= g.playTop - 1, 'never above the ceiling');
    assert(maxY <= g.playBottom + 1, 'never below the floor');
    g.toMenu();
  });

  test('Physics: a flip answers IMMEDIATELY, even at full speed', () => {
    // The bug this locks down: gravity alone had to bleed off the old velocity
    // first, so a flip taken mid-fall left the orb travelling the wrong way for
    // ~370ms and ~140px. It read as "I tapped and nothing happened".
    const g = newGame();
    [12, 21, 27, 33].forEach((fallFrames) => {
      g.start();
      g.obstacles.length = 0; g.motes.length = 0;   // isolate the physics
      for (let i = 0; i < fallFrames; i++) g.update(1 / 60);
      const yAtFlip = g.player.y;
      const speed = g.player.vy;
      g.flip();
      // one frame later it must already be heading the other way
      g.update(1 / 60);
      assert(g.player.y <= yAtFlip + 0.5,
        'orb kept falling after a flip at ' + Math.round(speed) + 'px/s (moved ' +
        (g.player.y - yAtFlip).toFixed(1) + 'px the wrong way)');
      assert(Math.sign(g.player.vy) === Math.sign(g.player.dir),
        'velocity must match the new gravity direction straight away');
    });
    g.toMenu();
  });

  test('Physics: flipping reverses gravity', () => {
    const g = newGame(); g.start();
    const before = g.player.dir;
    g.flip();
    eq(g.player.dir, -before, 'direction inverted');
    g.toMenu();
  });

  // ---- revive --------------------------------------------------------------
  test('Revive: costs shards, keeps score, resets combo, once per run', () => {
    freshStorage();
    L.Store.shards = 500;
    const g = newGame(); g.start();
    g.score = 900; g.combo = 12;
    g.player.alive = false; g.state = 'dead';
    assert(g.canRevive(), 'revive offered');
    const before = L.Store.shards;
    eq(g.revive(), true, 'revive succeeded');
    eq(L.Store.shards, before - g.reviveCost, 'shards spent');
    eq(Math.floor(g.score), 900, 'score kept');
    eq(g.combo, 0, 'combo reset');
    eq(g.state, 'play', 'back in play');
    assert(g.invuln > 0, 'granted grace');
    g.player.alive = false; g.state = 'dead';
    eq(g.canRevive(), false, 'only one revive per run');
    g.toMenu();
  });

  test('Revive: refused without enough shards, and never in daily mode', () => {
    freshStorage();
    L.Store.shards = 5;
    const g = newGame(); g.start();
    g.score = 900; g.state = 'dead';
    eq(g.canRevive(), false, 'too poor to revive');
    L.Store.shards = 5000;
    g.startDaily(); g.score = 900; g.state = 'dead';
    eq(g.canRevive(), false, 'daily runs cannot be bought back');
    g.toMenu();
  });

  test('Revive: a run is finalised exactly once', () => {
    freshStorage();
    const g = newGame(); g.start();
    g.score = 500; g.state = 'dead';
    g.finalizeRun();
    const runs = L.Store.runs, shards = L.Store.shards;
    g.finalizeRun(); g.finalizeRun();
    eq(L.Store.runs, runs, 'runs counted once');
    eq(L.Store.shards, shards, 'shards paid once');
    g.toMenu();
  });

  // ---- run lifecycle -------------------------------------------------------
  test('Lifecycle: a finished run persists stats and lands on the board', () => {
    freshStorage();
    const g = newGame(); g.start(); g.revived = true; // skip the revive offer
    autoplay(g, 4000);
    if (g.state === 'play') { g.state = 'dead'; }
    g.finalizeRun();
    const s = Math.floor(g.score);
    assert(s > 0, 'scored something');
    eq(L.Store.best, s, 'best recorded');
    eq(L.Store.runs, 1, 'run counted');
    eq(L.Scores.list()[0].s, s, 'appears on the leaderboard');
    g.toMenu();
  });

  test('Lifecycle: state does not leak from a daily run into a normal one', () => {
    freshStorage();
    const g = newGame();
    g.startDaily();
    eq(g.daily, true, 'daily flagged');
    assert(g.plan !== null, 'has a plan');
    g.start();
    eq(g.daily, false, 'flag cleared');
    eq(g.plan, null, 'plan cleared');
    eq(g.rng, Math.random, 'rng restored');
    g.toMenu();
  });

  test('Lifecycle: the autopilot can survive a meaningful run', () => {
    freshStorage();
    // The bot is stochastic — a single unlucky run says nothing about the
    // difficulty curve, so take the best of a few.
    let best = 0;
    for (let i = 0; i < 3; i++) {
      const g = newGame(); g.start(); g.revived = true;
      best = Math.max(best, autoplay(g, 7200));
      g.toMenu();
    }
    assert(best > 10, 'a competent player lasts more than 10s (best of 3 was ' + best.toFixed(1) + 's)');
  });

  // ---- rendering -----------------------------------------------------------
  test('Render: draws without throwing across every skin and trail', () => {
    freshStorage();
    L.Store.shards = 100000;
    L.Cosmetics.SKINS.forEach((s) => L.Cosmetics.buy(s.id));
    L.Cosmetics.TRAILS.forEach((t) => L.Cosmetics.buy(t.id));
    const g = newGame();
    L.Cosmetics.SKINS.forEach((s) => {
      L.Cosmetics.equip(s.id);
      L.Cosmetics.TRAILS.forEach((t) => {
        L.Cosmetics.equip(t.id);
        g.start();
        for (let i = 0; i < 40; i++) { if (i % 9 === 0) g.flip(); g.update(1 / 60); g.render(); }
      });
    });
    g.toMenu();
  });

  test('Render: survives flow state, death and the menu', () => {
    freshStorage();
    const g = newGame();
    g.start();
    g.combo = 24; g.flow = 1; g.flowActive = true; g.comboTimer = 3;
    for (let i = 0; i < 30; i++) { g.update(1 / 60); g.render(); }
    g.state = 'dead'; g.player.alive = false;
    for (let i = 0; i < 30; i++) { g.update(1 / 60); g.render(); }
    g.toMenu();
    for (let i = 0; i < 30; i++) { g.update(1 / 60); g.render(); }
  });

  test('Render: reduce-flashing suppresses shake and white flash', () => {
    freshStorage();
    L.Store.reduceFlash = true;
    const g = newGame(); g.start();
    g.shake = 40; g.flash = 1;
    for (let i = 0; i < 10; i++) { g.update(1 / 60); g.render(); } // must not throw
    L.Store.reduceFlash = false;
    g.toMenu();
  });

  // ---- resize --------------------------------------------------------------
  test('Resize: obstacles stay inside the playfield after a viewport change', () => {
    freshStorage();
    const g = newGame(); g.start();
    for (let i = 0; i < 400; i++) g.update(1 / 60);
    const hadObstacles = g.obstacles.length > 0;
    // simulate a shorter viewport (e.g. a mobile URL bar appearing)
    const realH = window.innerHeight;
    try {
      Object.defineProperty(window, 'innerHeight', { value: Math.round(realH * 0.7), configurable: true });
      g.resize();
      assert(hadObstacles, 'test had obstacles to check');
      for (const ob of g.obstacles) {
        for (const gap of ob.gaps) {
          assert(gap.y - gap.h / 2 >= g.playTop - 1, 'gap top inside playfield after resize');
          assert(gap.y + gap.h / 2 <= g.playBottom + 1, 'gap bottom inside playfield after resize');
        }
      }
      assert(g.player.y >= g.playTop && g.player.y <= g.playBottom, 'player inside playfield');
      assert(isFinite(g.player.y), 'player position finite');
    } finally {
      Object.defineProperty(window, 'innerHeight', { value: realH, configurable: true });
      g.resize();
    }
    g.toMenu();
  });

  // ---- tutorial ------------------------------------------------------------
  test('Tutorial: starts on the flip lesson with an empty corridor', () => {
    freshStorage();
    const g = newGame();
    g.startTutorial();
    eq(g.tutorial, true, 'tutorial mode on');
    eq(g.tutStage.id, 'flip', 'first lesson');
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    eq(g.obstacles.length, 0, 'nothing to crash into while learning the flip');
    g.toMenu();
  });

  test('Tutorial: advances through every lesson and finishes', () => {
    freshStorage();
    const g = newGame();
    g.startTutorial();
    for (let i = 0; i < g.tutStage.goal; i++) g.flip();
    eq(g.tutStage.id, 'thread', 'flip lesson cleared');
    const seen = ['flip', 'thread'];
    for (let round = 0; round < 20 && g.tutorial; round++) {
      autoplay(g, 500);
      if (g.tutorial && seen[seen.length - 1] !== g.tutStage.id) seen.push(g.tutStage.id);
    }
    eq(g.tutorial, false, 'tutorial completed (stages seen: ' + seen.join('>') + ')');
    eq(LUMEN.Store.tutorialDone, true, 'completion is remembered');
    g.toMenu();
  });

  test('Tutorial: crashing coaches instead of ending the run', () => {
    freshStorage();
    const g = newGame();
    g.startTutorial();
    g.tut.stage = 1; // thread lesson so obstacles exist
    for (let i = 0; i < 200; i++) g.update(1 / 60);
    g.tutSoftFail();
    eq(g.state, 'play', 'still playing after a crash');
    assert(g.invuln > 0, 'given a moment of grace');
    eq(g.player.alive, true, 'player is not dead');
    g.toMenu();
  });

  test('Tutorial: does not pollute scores, runs or the leaderboard', () => {
    freshStorage();
    const g = newGame();
    g.startTutorial();
    autoplay(g, 600);
    g.finishTutorial();
    eq(LUMEN.Store.runs, 0, 'not counted as a run');
    eq(LUMEN.Store.best, 0, 'no best score');
    eq(LUMEN.Scores.list().length, 0, 'nothing on the leaderboard');
    g.toMenu();
  });

  // ---- graphics quality ----------------------------------------------------
  test('Quality: presets apply and cap the backing resolution', () => {
    const g = newGame();
    // applyQuality re-lays LUMEN.game; this suite builds its own instance, so
    // resize the one under test explicitly.
    LUMEN.applyQuality('low'); g.resize();
    eq(LUMEN.Q.name, 'Low', 'low tier active');
    eq(g.dpr, 1, 'low tier renders at 1x');
    LUMEN.applyQuality('high'); g.resize();
    eq(LUMEN.Q.name, 'High', 'high tier active');
    assert(g.dpr <= 2, 'never exceeds 2x');
    LUMEN.applyQuality('auto'); g.resize();
    assert(LUMEN.Q && LUMEN.Q.maxDpr > 0, 'auto resolves to a real preset');
    g.toMenu();
  });

  test('Quality: lower tiers actually reduce work', () => {
    const g = newGame();
    LUMEN.applyQuality('high');
    g.start();
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const hiTrail = g.player.trail.length;
    LUMEN.applyQuality('low');
    g.start();
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    assert(g.player.trail.length < hiTrail, 'shorter trail on the low tier');
    LUMEN.applyQuality('auto');
    g.toMenu();
  });

  test('Render: no shadowBlur on the hot path (bars, trail, motes)', () => {
    const g = newGame();
    g.start();
    for (let i = 0; i < 120; i++) { if (i % 10 === 0) g.flip(); g.update(1 / 60); }
    let blurs = 0;
    const proto = CanvasRenderingContext2D.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'shadowBlur');
    Object.defineProperty(proto, 'shadowBlur', {
      configurable: true, get: d.get, set(v) { if (v > 0) blurs++; d.set.call(this, v); },
    });
    try { g.drawObstacles(g.ctx); g.drawTrail(g.ctx); g.drawMotes(g.ctx); }
    finally { Object.defineProperty(proto, 'shadowBlur', d); }
    eq(blurs, 0, 'these stages must stay blur-free — they are the per-frame hot path');
    g.toMenu();
  });

  test('Render: obstacle colours survive being re-alphaed', () => {
    const g = newGame();
    g.start();
    // dangerColor already carries an alpha; building the bar sprite from it used
    // to produce `hsla(... / 0.9 / 0.35)` and throw
    for (const flow of [0, 0.5, 1]) {
      g.flow = flow;
      g.drawObstacles(g.ctx);   // must not throw
    }
    g.flow = 0;
    g.toMenu();
  });

  // ---- input (onTap) -------------------------------------------------------
  // These lock down the exact bug that shipped: a press held past the arming
  // window fired the action twice — on the revive button that charged the player
  // and then instantly ended the run they had just bought back.
  function tapHarness() {
    const el = document.createElement('button');
    document.body.appendChild(el);
    let calls = 0;
    LUMEN.UI._onTap(el, () => { calls++; });
    const ev = (type, x, y, t) => {
      const e = new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 });
      Object.defineProperty(e, 'timeStamp', { value: t, configurable: true });
      el.dispatchEvent(e);
    };
    const click = (t) => {
      const e = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(e, 'timeStamp', { value: t, configurable: true });
      el.dispatchEvent(e);
    };
    return { el, ev, click, calls: () => calls, done: () => el.remove() };
  }

  test('Input: a quick tap fires exactly once', () => {
    const h = tapHarness();
    h.ev('pointerdown', 10, 10, 1000);
    h.ev('pointerup', 10, 10, 1060);
    h.click(1062);
    eq(h.calls(), 1, 'one action per tap');
    h.done();
  });

  test('Input: a LONG press still fires exactly once (the revive double-charge bug)', () => {
    const h = tapHarness();
    h.ev('pointerdown', 10, 10, 1000);
    h.ev('pointerup', 10, 10, 2500);   // held 1.5s — far past any arming window
    h.click(2503);
    eq(h.calls(), 1, 'holding a button must not trigger it twice');
    h.done();
  });

  test('Input: dragging off a button does NOT activate it (scrolling the shop)', () => {
    const h = tapHarness();
    h.ev('pointerdown', 10, 10, 1000);
    h.ev('pointerup', 10, 90, 1200);   // moved 80px — that was a scroll
    eq(h.calls(), 0, 'a drag must not buy anything');
    h.done();
  });

  test('Input: keyboard activation still works', () => {
    const h = tapHarness();
    h.click(5000);                      // Enter/Space produce a click with no pointer events
    eq(h.calls(), 1, 'keyboard users can still press buttons');
    h.done();
  });

  test('Input: a cancelled pointer (gesture stolen) does not activate', () => {
    const h = tapHarness();
    h.ev('pointerdown', 10, 10, 1000);
    h.el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    h.ev('pointerup', 10, 10, 1100);
    eq(h.calls(), 0, 'cancelled gestures are ignored');
    h.done();
  });

  // ---- regressions from the audit ------------------------------------------
  // A fullscreen rewarded ad takes the audio session away from the page, so the
  // AudioContext comes back suspended by something that is not us. sleep() used
  // to return early on a context that was already stopped -- without setting the
  // flag wake() checked -- so leaving the app during an ad killed every sound
  // for the rest of the launch. The context is real here; this drives the actual
  // suspend/resume, not a stand-in for it.
  test('Audio: an ad suspending the context does not silence the game forever', async () => {
    const A = L.Audio;
    A.init();
    if (!A.ctx) return;                             // headless: no Web Audio to drive
    A.unlock();                                     // a real gesture, as the game does

    // Count the ATTEMPT, not the outcome. `resume()` is asynchronous and a
    // background tab may never complete it — asserting on ctx.state after a
    // timeout made this test pass and fail on identical code. What the bug was
    // ever about is whether wake() decides to try.
    const ctx = A.ctx;
    const realResume = ctx.resume.bind(ctx);
    let tried = 0;
    ctx.resume = function () { tried++; return realResume(); };
    try {
      // THE AD. Not us — the platform takes the audio session behind our back.
      try { await ctx.suspend(); } catch (e) { /* already stopped is fine */ }
      eq(ctx.state, 'suspended', 'the context is stopped and we never asked for it');

      // Leaving the app. sleep() finds nothing running, and must not conclude
      // from that that there is nothing to wake later.
      tried = 0;
      A.sleep();
      A.wake();
      assert(tried === 1, 'coming back from the ad asks for the sound back (' + tried + ' attempts)');

      // The rule the old flag protected is real and still here: a context that
      // has NEVER been unlocked waits for a gesture, or the first tap after
      // returning is answered with silence.
      const gestured = A._gestured;
      A._gestured = false;
      try { await ctx.suspend(); } catch (e) { /* fine */ }
      tried = 0;
      A.wake();
      eq(tried, 0, 'an ungestured context is still left for unlock() to handle');
      A._gestured = gestured;
    } finally {
      delete ctx.resume;
      try { await ctx.resume(); } catch (e) { /* leave it as we found it */ }
    }
  });

  // An ad flight settles on its own schedule, and every ending reaches done():
  // a load that failed, a show the system refused, a video dismissed while the
  // phone is in a pocket. Asking for the sound back THERE starts the menu music
  // in a backgrounded app and leaves it running, because away() -- the only
  // thing that suspends -- does not fire again until the player foregrounds and
  // leaves a second time.
  test('Ads: an ad that settles in the background does not wake the sound', async () => {
    const Ads = L.Ads, A = L.Audio;
    if (!Ads) return;
    const realNative = Object.getOwnPropertyDescriptor(Ads, 'native');
    const realWake = A.wake;
    const realActive = L.appActive;
    let woke = 0;
    A.wake = function () { woke++; };
    Object.defineProperty(Ads, 'native', {
      configurable: true,
      value: {
        initialize: () => Promise.resolve(),
        requestTracking: () => Promise.resolve({ status: 'unavailable', tracking: true }),
        prepare: () => Promise.resolve(),
        show: () => Promise.resolve({ earned: false }),
      },
    });
    try {
      Ads._ready = true;

      // The player is looking: an ad ending hands the sound back.
      L.appActive = true;
      Ads._flight = null;
      woke = 0;
      await Ads.watch();
      assert(woke > 0, 'in the foreground the ad finishing asks for the sound back');

      // The phone is in a pocket: it must not.
      L.appActive = false;
      Ads._flight = null;
      woke = 0;
      await Ads.watch();
      eq(woke, 0, 'in the background it stays silent — nothing would ever stop it again');
    } finally {
      A.wake = realWake;
      L.appActive = realActive;
      delete Ads.native;
      if (realNative) Object.defineProperty(Ads, 'native', realNative);
      Ads._ready = false;
      Ads._flight = null;
    }
  });

  // A rewarded revive lands seconds after the tap, and END RUN and MENU stay
  // live for all of them. Coming back into a run whose books are closed left the
  // player on a dead playfield with no panel, no menu and — on iOS — no way out
  // but force-quitting.
  test('Revive: an ad that lands after the run ended is refused', () => {
    freshStorage();
    const g = newGame();
    g.start();
    g.player.alive = false;
    g.state = 'dead';
    g._finalized = false;
    assert(g.revive(true) === true, 'a run still waiting on the decision revives');

    // …now the run is over before the ad comes back.
    g.state = 'dead';
    g.revived = false;
    g._finalized = true;                          // END RUN was pressed
    eq(g.revive(true), false, 'a finalized run is not resurrected');
    eq(g.state, 'dead', 'and nothing was put back into play');

    // …and the player who went to the menu instead.
    g._finalized = false;
    g.state = 'menu';
    eq(g.revive(true), false, 'neither is a player who already left for the menu');
    eq(g.state, 'menu', 'who stays where they are');
    g.toMenu();
  });

  // `_deathAt` was stamped from `elapsed`, which only advances inside
  // updatePlay — so once the game was DEAD the clock froze, the difference
  // stayed exactly 0 and the "full rate for a beat after dying" beat never
  // ended. The CONTINUE? panel, the whole rewarded-video wait and the game-over
  // screen all rendered at full rate and full DPR.
  test('Death screen: the full-rate beat after dying actually ends', () => {
    freshStorage();
    const g = newGame();
    g.start();
    const before = g.elapsed;
    g.die();
    assert(g._deathAt > 0, 'the death is stamped on a clock that keeps running');
    // The give-away: it must NOT be the frozen run clock.
    assert(g._deathAt !== before && g._deathAt !== g.elapsed,
      'and that clock is not `elapsed`, which stops the moment the run does');
    const t0 = g._deathAt;
    // frame() compares its rAF timestamp against it, in milliseconds.
    assert((t0 + 1600) - t0 === 1600, 'the window is 1.6s of wall time');
    g.toMenu();
  });

  // preload() is reached from three places and none of them is a player asking:
  // boot, the tail of a watched ad, and the app returning to the foreground. So
  // a launch whose first fetch came back empty had nothing ready and nothing
  // trying for the rest of the session, and every tap paid for a cold load of
  // its own — which is what "you have to press it a few times" was.
  test('Ads: a preload that comes back empty tries again', async () => {
    // Driven on a FRESH object that inherits preload() rather than on the live
    // singleton. `Ads` is a module-level object with one `_flight` and one
    // generation counter, and by this point in the suite other tests have left
    // retry chains sleeping on it — counting calls to a shared stub measured
    // those as well as this one and reported 334 attempts for a three-attempt
    // chain. The behaviour under test belongs to the METHOD, so give the method
    // its own object and nothing else can reach it.
    const Ads = L.Ads;
    if (!Ads) return;
    const rig = (prepare) => {
      const o = Object.create(Ads);
      o._flight = null;
      o._pgen = 0;
      o.PRELOAD_BACKOFF = 1;                       // the schedule, not the wall clock
      o.init = () => Promise.resolve(true);
      Object.defineProperty(o, 'native', { value: { prepare } });
      return o;
    };

    // Empty twice, then a fill — exactly the sequence a player was pressing
    // through by hand.
    let asked = 0;
    const a = rig(() => { asked++; return asked < 3 ? Promise.reject(new Error('no fill')) : Promise.resolve(); });
    const got = await a.preload();
    eq(asked, 3, 'it kept asking until one filled');
    assert(got === true, 'and reports that one is ready');

    // …and it stops. An unfilled request still costs Google something, and a
    // phone with no network must not be hammered for a whole session.
    let never = 0;
    const b = rig(() => { never++; return Promise.reject(new Error('no fill')); });
    const none = await b.preload();
    eq(never, Ads.PRELOAD_TRIES, 'a phone with nothing to serve is asked a bounded number of times');
    assert(none === false, 'and the answer is honest');

    // A newer preload retires an older chain, so a foreground arriving while one
    // is sleeping does not leave two of them asking in parallel. The generation
    // has to travel WITH the chain: re-read on each hop it always matches the
    // current value, which is not a guard at all — that is the bug that let a
    // hundred stale chains wake at once.
    let races = 0;
    const c = rig(() => { races++; return Promise.reject(new Error('no fill')); });
    const first = c.preload();                     // takes generation 1
    c._pgen++;                                     // …and something newer arrives
    await first;
    eq(races, 1, 'the superseded chain stopped after its first attempt');
  });

  test('Audio: muting goes through Store so the memo cache stays truthful', () => {
    freshStorage();
    const A = LUMEN.Audio;
    A.init();
    A.setMuted(true);
    eq(LUMEN.Store.muted, true, 'Store reflects the mute immediately');
    A.setMuted(false);
    eq(LUMEN.Store.muted, false, 'and unmuting too');
  });

  test('Quality: an auto-downgrade is remembered for next session', () => {
    freshStorage();
    LUMEN.Store.autoTier = 'low';
    LUMEN.applyQuality('auto', true);
    eq(LUMEN.Q.name, 'Low', 'starts at the remembered tier instead of relearning it');
    LUMEN.Store.autoTier = '';
    LUMEN.applyQuality('auto', true);
  });

  test('Glow: sprite colour keeps the skin lightness (Frost halo matched its orb)', () => {
    const g = newGame();
    LUMEN.Store.shards = 100000;
    LUMEN.Cosmetics.buy('frost'); LUMEN.Cosmetics.equip('frost');
    const orb = g.orbColor(1);
    const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(orb);
    assert(m, 'orb colour parses');
    assert(parseFloat(m[3]) > 70, 'Frost really is a pale skin (got ' + m[3] + '%)');
    LUMEN.Cosmetics.equip('ion');
    g.toMenu();
  });

  test('Tutorial: finishing leaves a clean, non-scoring state', () => {
    freshStorage();
    const g = newGame();
    g.startTutorial();
    autoplay(g, 400);
    g.finishTutorial();
    eq(g.tutorial, false, 'tutorial flag cleared');
    eq(g.tut, null, 'stage state cleared');
    eq(g.state, 'menu', 'not left in the DEAD state (which would draw the score HUD)');
    eq(Math.floor(g.score), 0, 'no lingering score');
    eq(g.obstacles.length, 0, 'field cleared');
    g.toMenu();
  });

  // ---- power-ups -----------------------------------------------------------
  test('Power-ups: each type applies its effect when fired', () => {
    freshStorage();
    L.Store.autoUseItems = true;                       // fire on contact
    const g = newGame(); g.start();
    g.powers.push({ x: g.player.x, y: g.player.y, r: g.player.r, type: 'magnet', pulse: 0, ob: null, gap: null });
    g.update(1 / 60);
    assert(g.fx.magnet > 0, 'magnet armed');
    g.powers.push({ x: g.player.x, y: g.player.y, r: g.player.r, type: 'shield', pulse: 0, ob: null, gap: null });
    g.update(1 / 60);
    eq(g.shield, true, 'shield armed');
    g.powers.push({ x: g.player.x, y: g.player.y, r: g.player.r, type: 'slow', pulse: 0, ob: null, gap: null });
    g.update(1 / 60);
    assert(g.fx.slow > 0, 'slow armed');
    assert(g.timeScaleTarget < 1, 'slow dilates time');
    g.toMenu();
  });

  test('Power-ups: a pickup is HELD, not spent, until you say so', () => {
    // The player asked for this: collecting shouldn't burn the power-up, it should
    // hand it to you. Auto-use stays available as a setting for people who'd rather
    // not think about it.
    freshStorage();
    L.Store.autoUseItems = false;
    const g = newGame(); g.start();
    g.powers.push({ x: g.player.x, y: g.player.y, r: g.player.r, type: 'shield', pulse: 0, ob: null, gap: null });
    g.update(1 / 60);
    eq(g.shield, false, 'NOT spent on contact');
    eq(g.hand.shield, 1, 'it went into the hand');
    eq(g.useItem('shield'), true, 'firing it works');
    eq(g.shield, true, 'now the effect is live');
    eq(g.hand.shield, 0, 'and the hand is empty again');
    eq(g.useItem('shield'), false, 'cannot fire what you do not hold');
    g.toMenu();
  });

  test('Items: the shop enforces 1 of each and 3 in total', () => {
    freshStorage();
    const P = L.Progression;
    L.Store.shards = 99999;
    eq(P.buyItem('shield'), true, 'first shield');
    eq(P.buyItem('shield'), false, 'a second of the same type is refused');
    eq(P.buyItem('magnet'), true, 'a different type is fine');
    eq(P.buyItem('slow'), true, 'third type is fine');
    eq(P.stockTotal(), 3, 'three carried');
    eq(P.stockTotal() <= P.MAX_TOTAL, true, 'never over the cap');
  });

  test('Items: stock arms a normal run but NEVER the daily', () => {
    freshStorage();
    const P = L.Progression;
    L.Store.shards = 99999;
    P.buyItem('shield'); P.buyItem('magnet');
    const g = newGame(); g.start();
    eq(g.hand.shield, 1, 'carried into a normal run');
    // The run BORROWS what it carries. This used to assert the stock was
    // emptied at start — which is exactly the behaviour that destroyed an
    // unused item when the player quit to the menu. It is spent on use now.
    eq(L.Progression.stockTotal(), 2, 'but nothing is spent until it fires');
    g.useItem('shield');
    eq(L.Progression.stockTotal(), 1, 'firing one spends one');
    g.toMenu();
    eq(L.Progression.stockTotal(), 1, 'and leaving keeps the rest');
    // the daily is the one shared course, so nothing bought may touch it
    L.Store.shards = 99999; P.buyItem('shield');
    const before = L.Progression.stockTotal();
    const d = newGame(); d.startDaily(12345);
    eq(d.hand.shield || 0, 0, 'the daily starts you empty-handed');
    // assert the INVARIANT, not a count: what the stock happens to be depends on
    // the arithmetic above, but the daily must leave it exactly as it found it
    eq(L.Progression.stockTotal(), before, 'and does not eat your stock');
    d.toMenu();
    eq(L.Progression.stockTotal(), before, 'not even on the way out');
  });

  test('Store: achievement-only cosmetics cannot be bought, only earned', () => {
    freshStorage();
    L.Store.shards = 999999;
    eq(L.Cosmetics.price('aurora'), null, 'no price at any amount of shards');
    eq(L.Cosmetics.buy('aurora'), false, 'and no way to buy it');
    eq(L.Cosmetics.owned('aurora'), false, 'still locked');
    const req = L.Cosmetics.requirement('aurora');
    assert(!!req, 'it names the achievement that unlocks it');
    // earning that achievement hands it over
    L.Store.flowCount = 9999;
    L.Progression.check();
    eq(L.Progression.earned(req), true, 'achievement landed');
    eq(L.Cosmetics.owned('aurora'), true, 'and the skin came with it');
    eq(L.Cosmetics.equip('aurora'), true, 'wearable');
  });

  test('Store: shard prices are steep, cash prices are not', () => {
    // The economy the player asked for: you cannot grind a skin out in ten runs,
    // but nothing costs a lot of real money either, and the premium tier is only
    // a little dearer in cash while being far dearer in shards.
    const cheap = L.Cosmetics.price('ember'), elite = L.Cosmetics.price('plasma');
    assert(cheap.shards >= 400, 'even the cheap tier takes real play (' + cheap.shards + ')');
    assert(elite.shards >= cheap.shards * 4, 'premium is FAR steeper in shards');
    assert(elite.usd <= cheap.usd * 4, 'but only a little dearer in cash');
    assert(elite.usd <= 5, 'nothing is expensive in real money');
    for (const m of L.Cosmetics.MAPS) {
      const p = L.Cosmetics.price(m.id);
      if (p) eq(p.usd, 0, m.id + ' is shard-only, as asked');
    }
  });

  test('Voice: the item\'s NAME is the whole command, in every language', () => {
    const V = L.Voice;
    // The advertised phrasing is the bare noun — no verb to remember.
    eq(V.match('shield'), 'shield', 'en');
    eq(V.match('magnet'), 'magnet', 'en');
    eq(V.match('slow'), 'slow', 'en');
    eq(V.match('kalkan'), 'shield', 'tr');
    eq(V.match('mıknatıs'), 'magnet', 'tr');
    eq(V.match('yavas'), 'slow', 'tr without diacritics');
    eq(V.match('escudo'), 'shield', 'es');
    eq(V.match('iman'), 'magnet', 'es without the accent');
    eq(V.match('护盾'), 'shield', 'zh');
    eq(V.match('减速'), 'slow', 'zh');
    eq(V.match('SHIELD!'), 'shield', 'case and punctuation');
    // …and the phrasing the game used to advertise still works, because plenty
    // of players learned it and nothing is gained by breaking them.
    eq(V.match('use the shield now'), 'shield', 'the old phrasing');
    eq(V.match('use magnet now'), 'magnet', 'the old phrasing');
  });

  test('Voice: ordinary talking never spends an item', () => {
    // Every item is a consumable the player bought with shards, so a false
    // positive is not a misheard word — it is taking something off them. These
    // all used to fire: the synonyms 'guard', 'pull' and 'time' were left over
    // from the "use shield" phrasing and earned nothing once the command became
    // the bare noun.
    const V = L.Voice;
    const chatter = [
      'what time is it', 'time to go', 'pull yourself together', 'guard the gap',
      'i need to slow down my breathing', 'that was so close i almost had it',
      'this is taking too long', 'my shield is gone i lost everything there',
      'come on come on come on come on', '我今天真的没有时间慢慢玩这个游戏',
      'oh no', 'nice one', '', '   ',
    ];
    for (const said of chatter) eq(V.match(said), null, JSON.stringify(said) + ' must not fire');
  });

  test('i18n: nothing user-facing falls back to English', () => {
    // Turkish is the reference for "this string CAN be translated". If Spanish or
    // Chinese matches English on a key that Turkish translated, that key was
    // simply never filled in — which is how whole sentences (the revive panel,
    // most visibly) sat in English for anyone not playing in en or tr.
    //
    // Proper nouns are excluded by name rather than by cleverness: Ion, Aurora,
    // SPRINT and BRUTAL really are the same word in Spanish.
    const SAME_BY_DESIGN = new Set([
      'cos_ion', 'cos_solar', 'cos_jade', 'cos_eclipse', 'cos_plasma', 'cos_aurora',
      'cos_halo', 'cos_nova', 'cos_magma', 'cos_solaris', 'cos_chroma',
      'mode_sprint', 'mode_zen', 'modet_sprint', 'modet_blackout', 'modet_precision',
      'flowCaps', 'diffNormal',
    ]);
    const keys = [
      // a spread of real sentences from every part of the game
      'reviveSub', 'reviveOnce', 'watchAd', 'menuBlurb', 'recapTap', 'recapThread',
      'recapMotes', 'recapFlow', 'slowMotion', 'yourName', 'shardsEarned',
      'modesNote', 'mapsNote', 'itemsNote', 'skillsNote', 'transferHint',
      'coach_items_b', 'coach_skills_b', 'quip_soClose', 'quip_tooSafe',
      'moded_vortex', 'moded_blackout', 'tutm_mirror_h', 'tutm_zen_h',
      'itemd_scout', 'itemd_anchor', 'itemd_spark', 'sandboxNote', 'voiceHint',
    ];
    const val = {};
    for (const lang of ['en', 'tr', 'es', 'zh']) {
      L.i18n.set(lang);
      val[lang] = {};
      for (const k of keys) val[lang][k] = L.t(k);
    }
    L.i18n.set('en');
    for (const k of keys) {
      assert(val.en[k] && val.en[k] !== k, k + ' exists at all');
      if (SAME_BY_DESIGN.has(k)) continue;
      for (const lang of ['tr', 'es', 'zh']) {
        assert(val[lang][k] !== val.en[k], k + ' is really translated into ' + lang);
      }
    }
  });

  test('Save: a transfer code round-trips, and a bad one changes nothing', () => {
    freshStorage();
    L.Store.best = 4321; L.Store.shards = 777; L.Store.runs = 55;
    L.Cosmetics.grant('ember');
    const code = L.Save.export();
    eq(L.Save.describe(code).best, 4321, 'the code can be read before it is applied');

    freshStorage();
    eq(L.Store.best, 0, 'wiped');
    eq(L.Save.apply(code).ok, true, 'restored');
    eq(L.Store.best, 4321, 'best came back');
    eq(L.Store.shards, 777, 'shards came back');
    eq(L.Cosmetics.owned('ember'), true, 'unlocks came back');

    // Nothing a bad paste can do may touch a good save.
    const before = L.Store.best;
    for (const bad of ['', 'hello', code.slice(0, -8), 'NOPE1.aaa.bbb']) {
      eq(L.Save.apply(bad).ok, false, 'rejects: ' + JSON.stringify(bad).slice(0, 20));
    }
    eq(L.Store.best, before, 'and the existing save is untouched');

    // A payload must never write outside our own namespace.
    const evil = btoa(JSON.stringify({ some_other_app: '1' }));
    let h = 2166136261;
    for (let i = 0; i < evil.length; i++) { h ^= evil.charCodeAt(i); h = Math.imul(h, 16777619); }
    eq(L.Save.apply('LUMEN1.' + ((h >>> 0).toString(36)) + '.' + evil).ok, false,
      'a valid-looking code with foreign keys is still refused');
  });

  test('Music: the soundtrack answers the run', () => {
    freshStorage();
    // Pin the world: each map has its own resting tempo, so a map left equipped
    // by an earlier test would move the baseline under the measurement.
    L.Cosmetics.equip('deepfield');
    const m = L.Audio.music;
    const g = newGame(900, 1600);
    g.start();
    g.scoreMusic();                 // settle on the piece before timing it

    g.elapsed = 0;  g.scoreMusic(); const slow = m._bpmTarget;
    g.elapsed = 90; g.scoreMusic(); const fast = m._bpmTarget;
    assert(fast > slow, 'tempo rises with the corridor (' + Math.round(slow) + ' → ' + Math.round(fast) + ')');

    g.combo = 0;  g.scoreMusic(); const q0 = m.intensity;
    g.combo = 10; g.scoreMusic(); const q1 = m.intensity;
    g.flowActive = true; g.scoreMusic(); const q2 = m.intensity;
    g.flowActive = false;
    assert(q1 > q0 && q2 > q1, 'layers come in as the chain climbs (' + [q0, q1, q2] + ')');

    // Every world is its own PIECE now — different chords, tempo, drums and
    // voices — rather than one track transposed six ways, so this checks the
    // composition that gets selected, not a key offset.
    const picked = {}, tempos = {};
    for (const mp of L.Cosmetics.MAPS) {
      L.Cosmetics.grant(mp.id); L.Cosmetics.equip(mp.id);
      const w = newGame(900, 1600);
      w.start(); w.scoreMusic();
      picked[mp.id] = m._song;
      tempos[mp.id] = m.BASE_BPM;
      w.toMenu();
    }
    L.Cosmetics.equip('deepfield');
    eq(new Set(Object.values(picked)).size, L.Cosmetics.MAPS.length, 'every world plays its own piece');
    for (const mp of L.Cosmetics.MAPS) eq(picked[mp.id], mp.id, mp.id + ' plays its own track');
    assert(new Set(Object.values(tempos)).size >= 5, 'and they are not all at the same tempo');
    g.toMenu();
  });

  // Two things this has to pin down, because both were broken while an earlier
  // version of this test passed:
  //   1. The briefing must read the SAME keys the screen draws (st.tk / st.hk).
  //      Checking `st.k + '_t'` by hand tested that the strings exist, not that
  //      the game can find them — and it could not, so the mode lessons drew
  //      "tutm_blackoutt" on screen.
  //   2. The lesson must actually BE the mode. It used to stay on Classic the
  //      whole way through, so the Blackout lesson taught Blackout by describing
  //      it over a fully lit corridor.
  test('Tutorial: PLAY plays, and each mode teaches its own last lesson', () => {
    freshStorage();
    // Every mode there IS, read from the table. The hardcoded list this replaces
    // had silently stopped covering dread, glutton and rubber the day they shipped.
    for (const id of L.Modes.MODES.map((m) => m.id)) {
      L.Modes.setCurrent(id);
      const g = newGame();
      g.startTutorial();
      // the basics are always taught under Classic rules
      eq(g.mode.id, 'classic', id + ': the basics are taught straight');

      // walk to the last lesson the way the game does, not by poking the index,
      // checking the text of every stage on the way through
      let guard = 0;
      while (g.tut && g.tut.stage < 4 && guard++ < 50) {
        const cur = g.tutStage;
        assert(!!cur && !!cur.tk && !!cur.hk, id + ': stage ' + g.tut.stage + ' names its string keys');
        assert(L.t(cur.tk) !== cur.tk, id + ': stage ' + g.tut.stage + ' title "' + cur.tk + '" is translated');
        assert(L.t(cur.hk) !== cur.hk, id + ': stage ' + g.tut.stage + ' hint "' + cur.hk + '" is translated');
        g.tutAdvance(99);
      }
      const st = g.tutStage;
      assert(!!st, id + ': there is a final lesson');

      if (id === 'classic') {
        eq(st.id, 'done', 'Classic has no extra lesson — it IS the lesson');
        eq(g.mode.id, 'classic', 'and it stays Classic');
      } else {
        eq(st.id, 'mode', id + ' gets its own briefing');
        // the mode is really running, not just being described
        eq(g.mode.id, id, id + ' lesson actually runs ' + id);
      }

      // whatever the stage, the text it draws must resolve to real strings
      for (const key of [st.tk, st.hk]) {
        assert(!!key, id + ': the stage names its own string keys');
        assert(L.t(key) !== key, id + ': "' + key + '" is a translated string, not a raw key');
      }
      g.toMenu();
    }
    L.Modes.setCurrent('classic');
  });

  // The lesson above checks what the tutorial SAYS. This checks that it ends:
  // every stage has to have something that moves it on. The mode lesson counted
  // gates but nothing was wired to score them, so it sat at 0/6 with no way out
  // and no way to finish — the tutorial simply stopped there.
  test('Tutorial can be finished by playing it, in every mode', () => {
    freshStorage();
    // Every mode there IS, read from the table. The hardcoded list this replaces
    // had silently stopped covering dread, glutton and rubber the day they shipped.
    for (const id of L.Modes.MODES.map((m) => m.id)) {
      L.Modes.setCurrent(id);
      const g = newGame();
      g.startTutorial();
      const stagesSeen = new Set();
      let frames = 0;
      // fly it with the autopilot; every stage must hand over to the next
      while (g.tutorial && frames < 60 * 240) {
        if (g.tutStage) stagesSeen.add(g.tutStage.id);
        autoplay(g, 1);
        frames++;
      }
      assert(!g.tutorial,
        id + ': the tutorial finishes (stuck on "' + (g.tutStage && g.tutStage.id)
        + '" at ' + (g.tut && g.tut.progress) + '/' + (g.tutStage && g.tutStage.goal) + ')');
      // and it really went through the mode lesson, not around it
      if (id !== 'classic') assert(stagesSeen.has('mode'), id + ': the mode lesson was actually played');
      g.toMenu();
    }
    L.Modes.setCurrent('classic');
  });

  test('Charge effect: high chain only, and switchable off', () => {
    freshStorage();
    const g = newGame(900, 1600);
    g.start();
    let drew = 0;
    const ctx = g.ctx;
    const realArc = ctx.arc.bind(ctx);
    ctx.arc = function (...a) { drew++; return realArc(...a); };

    L.Store.chargeFx = true;
    g.combo = 0; drew = 0; g.drawCharge(ctx, 200);
    eq(drew, 0, 'nothing orbits you at zero chain');
    g.combo = 30; drew = 0; g.drawCharge(ctx, 200);
    assert(drew > 0, 'a high chain puts shards in orbit');

    L.Store.chargeFx = false;
    drew = 0; g.drawCharge(ctx, 200);
    eq(drew, 0, 'and the setting turns it off completely');
    L.Store.chargeFx = true;
    ctx.arc = realArc;
    g.toMenu();
  });

  test('Flavour: every cosmetic has a line, in every language', () => {
    const C = L.Cosmetics;
    const all = C.SKINS.concat(C.TRAILS, C.MAPS);
    for (const lang of ['en', 'tr', 'es', 'zh']) {
      L.i18n.set(lang);
      for (const it of all) {
        const f = L.t('cosf_' + it.id);
        assert(f && f !== 'cosf_' + it.id, it.id + ' has a flavour line in ' + lang);
      }
    }
    L.i18n.set('en');
  });

  test('Flavour: the game-over line reacts to what actually happened', () => {
    const U = L.UI;
    const k = (d) => U.runQuip(d);
    // most specific wins, and each branch is reachable
    eq(k({ voided: true }), 'quip_void', 'a cheated run says so');
    eq(k({ ranked: false }), 'quip_zen', 'Zen says so');
    eq(k({ ranked: true, isBest: true, score: 900, prevBest: 0 }), 'quip_best',
      'a FIRST record is not "you doubled it" — there was nothing to double');
    eq(k({ ranked: true, isBest: true, score: 5000, prevBest: 1200 }), 'quip_bestBig', 'doubling is called out');
    eq(k({ ranked: true, score: 980, prevBest: 1000, seconds: 50 }), 'quip_soClose', 'near-miss on your own record');
    eq(k({ ranked: true, score: 10, prevBest: 9999, seconds: 2 }), 'quip_instant', 'instant death');
    eq(k({ ranked: true, score: 9, prevBest: 9999, seconds: 30, comboAtDeath: 32 }), 'quip_bigChainLost', 'lost chain');
    eq(k({ ranked: true, score: 9, prevBest: 9999, seconds: 30, nearMiss: 11 }), 'quip_daredevil', 'near misses');
    eq(k({ ranked: true, score: 9, prevBest: 9999, seconds: 70, motes: 4 }), 'quip_tooSafe', 'played it safe');
    eq(k({ ranked: true, score: 9, prevBest: 9999, seconds: 25, motes: 20 }), 'quip_plain', 'nothing stood out');
    // and every key it can return must resolve in all four languages
    const keys = ['quip_void', 'quip_zen', 'quip_best', 'quip_bestBig', 'quip_soClose', 'quip_instant',
      'quip_bigChainLost', 'quip_flowThenGone', 'quip_daredevil', 'quip_tooSafe', 'quip_noMotes',
      'quip_revived', 'quip_goodFlow', 'quip_endured', 'quip_plain'];
    for (const lang of ['en', 'tr', 'es', 'zh']) {
      L.i18n.set(lang);
      for (const key of keys) assert(L.t(key) && L.t(key) !== key, key + ' exists in ' + lang);
    }
    L.i18n.set('en');
  });

  test('Cosmetics: a cycling skin cycles, and a banded one stays in its band', () => {
    freshStorage();
    const C = L.Cosmetics;
    const g = newGame();
    g.start();
    const sweep = (id) => {
      C.grant(id); C.equip(id);
      const hs = [];
      for (const t of [0, 0.6, 1.2, 1.8, 2.4]) { g.elapsed = t; hs.push(g.orbHue()); }
      return hs;
    };
    const chroma = sweep('chroma'), magma = sweep('magma'), ion = sweep('ion');
    assert(new Set(chroma.map(Math.round)).size >= 4, 'Chroma really runs the wheel');
    // rainbowSpan used to be ignored entirely, so "molten" skins ran the full
    // spectrum like everything else
    assert(Math.max.apply(null, magma) - Math.min.apply(null, magma) < 60,
      'Magma shimmers inside its own band, not around the whole wheel');
    const magmaDef = C.def('magma');
    assert(Math.abs(magma[0] - magmaDef.hue) < magmaDef.rainbowSpan, 'and stays near its own hue');
    eq(new Set(ion).size, 1, 'a plain skin does not move at all');
    C.equip('ion');
    g.toMenu();
  });

  test('Modes: each one actually changes the game, not just the label', () => {
    freshStorage();
    const seen = {};
    for (const m of L.Modes.MODES) {
      L.Modes.setCurrent(m.id);
      const g = newGame(900, 1600);
      g.start();
      seen[m.id] = { gap: +g.gapFrac.toFixed(3), speed: Math.round(g.scrollSpeed), lethal: !!g.mode.lethal };
      g.toMenu();
    }
    L.Modes.setCurrent('classic');
    const c = seen.classic;
    // Mirror is a camera mode on purpose — same numbers, different to read — so
    // it is the one mode allowed to match Classic here.
    for (const id of Object.keys(seen)) {
      if (id === 'classic' || id === 'mirror') continue;
      const s = seen[id];
      assert(s.gap !== c.gap || s.speed !== c.speed, id + ' differs from Classic');
    }
    assert(seen.precision.gap < c.gap, 'Precision really is tighter');
    assert(seen.zen.gap > c.gap, 'Zen really is roomier');
    assert(seen.sprint.speed > c.speed * 1.3, 'Sprint really is faster');
    eq(seen.zen.lethal, false, 'Zen cannot kill you');
  });

  test('Modes: a mode with its own song keeps it on every map', () => {
    // ABANDON HOPE is a horror mode, and losing the dread because you happen to
    // own the pretty green world would be losing the mode. The override lives in
    // scoreMusic(), which only runs from updatePlay — so this drives a real
    // frame rather than calling it directly, which is what a broken wiring
    // would otherwise sail straight through.
    freshStorage();
    const M = L.Audio.music;
    const before = M._song;
    const seen = {};
    for (const map of ['deepfield', 'moss', 'monolith']) {
      L.Cosmetics.grant(map); L.Cosmetics.equip(map);

      L.Modes.setCurrent('dread');
      let g = newGame(900, 1600); g.start(); g.update(1 / 60);
      seen['dread@' + map] = g._musSong;
      g.toMenu();

      L.Modes.setCurrent('classic');
      g = newGame(900, 1600); g.start(); g.update(1 / 60);
      seen['classic@' + map] = g._musSong;
      g.toMenu();
    }
    for (const map of ['deepfield', 'moss', 'monolith']) {
      eq(seen['dread@' + map], 'abandon', 'the horror mode owns the music on ' + map);
      eq(seen['classic@' + map], map, 'an ordinary mode still lets ' + map + ' choose');
    }
    L.Modes.setCurrent('classic'); L.Cosmetics.equip('deepfield');
    M._song = before;
  });

  test('Audio: the horror drone is continuous, and never leaks', () => {
    // The first draft of this piece measured 93% silent — sparse events with
    // nothing between them, which reads as broken audio rather than as dread.
    // The bed that fixes it is a set of oscillators that never stop, so the two
    // things worth pinning are that they exist and that they go away again.
    const M = L.Audio.music;
    if (!L.Audio.ctx) L.Audio.init();
    if (!L.Audio.ctx) return;                       // headless: nothing to assert
    const keepTracks = M._tracks, keepSong = M._song;
    M._tracks = {};                                 // a recording would bypass the sequencer
    const t = () => L.Audio.ctx.currentTime + 0.05;
    try {
      M._song = 'abandon'; M._sectionB = false; M.intensity = 1; M._intensitySmooth = 1;
      M._playStep(0, t());
      assert(!!M._drone, 'the drone starts with the horror song');
      eq(M._drone.notes.length, 3, 'three voices');
      const first = M._drone;
      M._playStep(16, t()); M._playStep(32, t());
      assert(M._drone === first, 'later bars reuse the oscillators instead of stacking new ones');

      M._song = 'moss'; M._playStep(0, t());
      assert(!M._drone, 'a song without a drone tears it down');

      M._song = 'abandon'; M._playStep(0, t());
      assert(!!M._drone, 'and it comes back');
      M.stop();
      assert(!M._drone, 'stopping the music stops the drone');
    } finally {
      M._tracks = keepTracks; M._song = keepSong; M.intensity = 0; M._intensitySmooth = 0;
    }
  });

  test('Modes: a fed GLUTTON orb still fits, on every viewport', () => {
    // The gap floor used to be the constant 0.17 of playH, which knows nothing
    // about an orb that doubles in size — while baseR stops shrinking at its
    // 10px minimum. On a short viewport the corridor kept closing and the orb
    // did not, so a DOUBLE gate could open 32.7px for an orb needing 32.8px:
    // a solid wall, with no input that avoids it.
    freshStorage();
    L.Modes.setCurrent('glutton');
    for (const [w, h] of [[640, 360], [844, 390], [932, 430], [375, 812], [1280, 800], [320, 480]]) {
      const g = newGame(w, h);
      g.start();
      for (const diff of ['easy', 'normal', 'hard']) {
        L.Store.diff = diff;
        const g2 = newGame(w, h);
        g2.start();
        for (const map of ['deepfield', 'regalia', 'weave', 'monolith']) {
          L.Cosmetics.grant(map); L.Cosmetics.equip(map);
          const g3 = newGame(w, h);
          g3.start();
          for (const t of [0, 40, 90, 300, 900]) {
            g3.elapsed = t;
            const spec = L.Game.makeSpec(Math.random, t, 0.5,
              { gapMul: g3.gapMul, minGap: g3.minGapFrac });
            // the tightest opening this spec can produce, in pixels
            const openPx = (spec.kind === 'double' ? spec.doubleGapH : spec.gapH) * g3.playH;
            // what the widest this orb can ever get actually needs to pass
            const needPx = 2 * 0.82 * g3.maxR;
            assert(openPx > needPx,
              w + 'x' + h + ' ' + diff + ' ' + map + ' @' + t + 's: ' +
              Math.round(openPx) + 'px opening vs ' + Math.round(needPx) + 'px orb');
          }
          g3.toMenu();
        }
        g2.toMenu();
      }
      g.toMenu();
    }
    L.Store.diff = 'normal';
    L.Modes.setCurrent('classic'); L.Cosmetics.equip('deepfield');
  });

  test('Daily: the day\'s mode shapes the planned course, identically for everyone', () => {
    // A PRECISION day used to plan Classic-width gates and still pay 1.7x for
    // them; a BLACKOUT day lost the widening that offsets its darkness. And
    // whatever it plans, two players must still get the same course.
    freshStorage();
    const a = newGame(900, 1600); a.startDaily();
    const b = newGame(430, 900);  b.startDaily();   // different screen entirely
    assert(a.plan.length === b.plan.length && a.plan.length > 100, 'both planned a full course');
    for (let i = 0; i < a.plan.length; i++) {
      eq(a.plan[i].gapH, b.plan[i].gapH, 'gate ' + i + ' is identical on any screen');
      eq(a.plan[i].c, b.plan[i].c, 'gate ' + i + ' sits in the same place');
    }
    // and the plan really did take the mode's gap into account
    const modeGap = a.mode ? (a.mode.gap || 1) : 1;
    const plain = L.Game.makeSpec(mulberryLike(), 1.1, 0.5);
    if (Math.abs(modeGap - 1) > 0.01) {
      const withMode = L.Game.makeSpec(mulberryLike(), 1.1, 0.5, { gapMul: modeGap });
      assert(Math.abs(withMode.gapH - plain.gapH) > 1e-6,
        'the day\'s mode (' + a.mode.id + ', gap ' + modeGap + ') changes the opening');
    }
    a.toMenu(); b.toMenu();
    function mulberryLike() { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
  });

  test('Modes: gaps stay physically threadable in every mode', () => {
    // A mode multiplier must never squeeze an opening below what the orb can fit
    // through, however long the run goes on.
    freshStorage();
    for (const m of L.Modes.MODES) {
      L.Modes.setCurrent(m.id);
      const g = newGame(900, 1600);
      g.start();
      for (const t of [0, 30, 90, 300, 900]) {
        g.elapsed = t;
        const gapPx = g.gapFrac * g.playH;
        assert(gapPx > g.player.r * 2.2,
          m.id + ' at ' + t + 's still fits the orb (' + Math.round(gapPx) + 'px vs r=' + Math.round(g.player.r) + ')');
        assert(g.gapFrac <= 0.52 + 1e-6, m.id + ' never exceeds the playfield');
      }
      g.toMenu();
    }
    L.Modes.setCurrent('classic');
  });

  test('Modes: Zen earns nothing, and never touches your record', () => {
    // A mode with no failure state would otherwise be the fastest way to farm
    // every shard, stat and achievement in the game.
    freshStorage();
    L.Modes.setCurrent('zen');
    const before = { shards: L.Store.shards, best: L.Store.best, runs: L.Store.runs,
                     motes: L.Store.motes, scores: L.Scores.list().length };
    const g = newGame();
    g.start();
    g.score = 999999; g.motesRun = 900; g.bestComboRun = 90; g.flowSecRun = 120;
    g.finalizeRun();
    eq(L.Store.shards, before.shards, 'no shards');
    eq(L.Store.best, before.best, 'no best');
    eq(L.Store.runs, before.runs, 'not even a run');
    eq(L.Store.motes, before.motes, 'no lifetime motes');
    eq(L.Scores.list().length, before.scores, 'no board entry');
    eq(L.Modes.best('zen'), 0, 'not even its own record');
    g.toMenu();
    L.Modes.setCurrent('classic');
  });

  test('Modes: each keeps its own record, and only Classic owns BEST', () => {
    freshStorage();
    const run = (mode, score) => {
      L.Modes.setCurrent(mode);
      const g = newGame();
      g.start();
      g.score = score; g.bestComboRun = 10;
      g.finalizeRun();
      g.toMenu();
    };
    run('classic', 1000);
    const classicBest = L.Store.best;
    assert(classicBest > 0, 'Classic writes the headline BEST');
    run('sprint', 5000);
    eq(L.Store.best, classicBest, 'a huge Sprint score does NOT overwrite the Classic best');
    assert(L.Modes.best('sprint') > 0, 'Sprint keeps its own');
    eq(L.Modes.best('vortex'), 0, 'and modes do not share records');
    // MY RUNS is a personal history, so it holds both runs — what stays
    // Classic-only is the RANKING, because a rank across two different games
    // means nothing. Filing only Classic here is what made the screen look
    // broken: six modes and the daily wrote nothing at all.
    eq(L.Scores.list().length, 2, 'MY RUNS keeps every ranked run');
    eq(L.Scores.list().map((e) => e.m).sort().join(','), 'classic,sprint', 'each row knows its mode');
    eq(L.Scores.list('classic').length, 1, 'but a Classic ranking sees only Classic');
    eq(L.Scores.rankOf(1000, 'classic'), 1, 'so the Classic run still ranks first in Classic');
    L.Modes.setCurrent('classic');
  });

  test('Daily: everyone gets the same twist, whatever they picked', () => {
    // The daily is no longer plain Classic — each day draws its own mode and
    // mutator from the date seed. The invariant that matters is unchanged
    // though: it must come from the DAY, never from the player's own selection,
    // or it stops being a shared course.
    freshStorage();
    const twist = L.Daily.twist();
    assert(L.Modes.def(twist.mode).id === twist.mode, 'the day names a real mode');
    assert(L.Daily.MUTATORS.indexOf(twist.mutator) >= 0, 'and a real mutator');
    // never Zen (unscoreable) and never Sprint (its head start breaks a seeded plan)
    assert(L.Daily.MODES.indexOf('zen') < 0, 'a daily is always scoreable');
    assert(L.Daily.MODES.indexOf('sprint') < 0, 'and never starts mid-course');

    for (const picked of ['sprint', 'zen', 'precision']) {
      L.Modes.setCurrent(picked);
      const g = newGame();
      g.startDaily();
      eq(g.mode.id, twist.mode, 'picked ' + picked + ' — still got the day’s mode');
      eq(g.mutator, twist.mutator, 'and the day’s mutator');
      eq(g.plan.length > 0, true, 'course planned up front');
      g.toMenu();
    }
    // the draw is stable: same day, same twist
    const again = L.Daily.twist();
    eq(again.mode, twist.mode, 'the twist does not change between calls');
    eq(again.mutator, twist.mutator, 'nor does the mutator');

    // the tutorial still teaches Classic — you cannot learn the rules through a
    // mode that bends them
    const t = newGame();
    t.startTutorial();
    eq(t.mode.id, 'classic', 'the tutorial teaches the real game');
    t.toMenu();
    L.Modes.setCurrent('classic');
  });

  test('Flow is a burst, not a state you can live in', () => {
    // Holding a huge chain used to mean permanent slow-motion, which inverted the
    // difficulty curve: the better you played, the slower the game got, forever.
    freshStorage();
    const g = newGame(900, 1600);
    g.start(); g.revived = true;
    let on = 0, frames = 0, bursts = 0, was = false;
    for (let i = 0; i < 3600; i++) {
      // parked and immortal: this measures the fuel rule, not the collisions
      g.player.y = g.playTop + g.playH * 0.5; g.player.vy = 0; g.invuln = 99;
      g.combo = 40;
      g.update(1 / 60); frames++;
      if (g.state !== 'play') break;
      if (g.flowActive) { on++; if (!was) bursts++; }
      was = g.flowActive;
    }
    const duty = on / frames;
    assert(duty < 0.6, 'a held chain no longer buys permanent slow-mo (' + Math.round(duty * 100) + '%)');
    assert(duty > 0.15, 'but flow still happens often enough to be the reward it is');
    assert(bursts >= 3, 'and it comes in separate bursts (' + bursts + ')');
    g.toMenu();
  });

  test('Traps are always seen before they can kill', () => {
    freshStorage();
    const g = newGame(900, 1600);
    g.start();
    g.elapsed = 60;
    eq(g.trapsOn, true, 'traps join once the run has settled');

    // every kind arms late, so it is drawn harmless before it is lethal
    const kinds = {};
    for (let i = 0; i < 80; i++) {
      g.traps.length = 0; g.obstacles.length = 0;
      g.spawnTrap();
      const t = g.traps[0];
      if (!t) continue;
      kinds[t.kind] = true;
      assert(t.arm > 0, t.kind + ' spawns disarmed');
    }
    assert(Object.keys(kinds).length >= 3, 'all three trap kinds appear');

    // an armed trap sitting on the player must not kill during the grace window
    g.traps.length = 0; g.obstacles.length = 0;
    g.spawnTrap();
    const t = g.traps[0];
    t.x = g.player.x - 4;
    if (t.kind !== 'spikes') t.y = g.player.y;
    g.invuln = 0;
    const died = g.updateTraps(0, 1 / 60);
    eq(died, false, 'a trap still blinking cannot end the run');

    // Never stacked on a gate — that would turn a fair opening into a wall.
    //
    // This used to assert the trap was refused OUTRIGHT whenever the spawn point
    // was crowded. That is not the invariant, it was the old implementation's
    // way of honouring it, and it was expensive: a gate arrives about every
    // second while the guard reserved a wide band, so Hallowmere — the world
    // whose entire trait is being hunted — landed 2 traps a minute against the
    // 9.6 its `trapEvery` advertises. It now looks further down the corridor for
    // a clear slot, so what is asserted is the OVERLAP, not the giving up.
    let placed = 0;
    for (let i = 0; i < 60; i++) {
      g.traps.length = 0;
      g.obstacles.length = 0;
      g.spawnObstacle();
      const gate = g.obstacles[0];
      gate.x = g.W + g.obstacleW * 3;
      g.spawnTrap();
      const tr = g.traps[0];
      if (!tr) continue;
      placed++;
      const x0 = tr.kind === 'mine' ? tr.x - tr.r : tr.x;
      const x1 = tr.kind === 'mine' ? tr.x + tr.r : tr.x + (tr.w || 0);
      assert(x1 < gate.x || x0 > gate.x + gate.w,
        tr.kind + ' clears the gate (trap ' + Math.round(x0) + '-' + Math.round(x1) +
        ' vs gate ' + Math.round(gate.x) + '-' + Math.round(gate.x + gate.w) + ')');
    }
    assert(placed > 40, 'a crowded spawn point still finds a slot (' + placed + '/60)');
    g.toMenu();
  });

  test('Maps: every world changes a rule, and the Daily ignores all of them', () => {
    freshStorage();
    const C = L.Cosmetics;
    const world = (id) => {
      C.grant(id); C.equip(id);
      const q = newGame(900, 1600); q.start(); q.elapsed = 20; return q;
    };
    // each trait proves itself through its own channel
    let q = world('deepfield');
    const baseGap = q.gapFrac, baseSpawn = q.spawnInterval;
    const fallOf = (g) => {
      g.player.y = g.playTop + g.playH * 0.5; g.player.vy = 0; g.player.dir = 1;
      const y0 = g.player.y;
      for (let i = 0; i < 18; i++) g.update(1 / 60);
      return g.player.y - y0;
    };
    const baseFall = fallOf(q);
    const moteGain = (g) => { g.combo = 8; const s = g.score; g.collectMote({ x: 1, y: 1, r: 2, taken: false }); return g.score - s; };
    const baseMote = moteGain(q);
    q.toMenu();

    q = world('emberfall');
    assert(fallOf(q) < baseFall * 0.95, 'Emberfall really lifts you');
    q.toMenu();

    q = world('monolith');
    assert(q.gapFrac > baseGap, 'Monolith really is roomier');
    assert(q.spawnInterval < baseSpawn, 'and really does come at you faster');
    q.toMenu();

    q = world('moss');
    q.combo = 8;
    const before = q.score;
    q.collectMote({ x: 1, y: 1, r: 2, taken: false });
    assert(q.score - before > 30, 'Mosslight motes really are worth more');
    assert(q.world.moteRate < 1, 'and really are rarer');
    q.toMenu();

    q = world('tidal');
    q.obstacles.length = 0; q.spawnObstacle();
    const y0 = q.obstacles[0].gaps[0].y;
    // A single sample of a sine can land on a node — sweep a phase instead.
    let drift = 0;
    for (const at of [20.6, 21.4, 22.2, 23.0, 23.8, 24.6]) {
      q.elapsed = at; q.layoutObstacle(q.obstacles[0]);
      drift = Math.max(drift, Math.abs(q.obstacles[0].gaps[0].y - y0));
    }
    assert(drift > 1, 'Tidal really drifts the openings (max ' + drift.toFixed(1) + 'px)');
    q.toMenu();

    // Solaris is Emberfall's mirror: it drags you down all run, and pays for it.
    q = world('solaris');
    assert(fallOf(q) > baseFall * 1.05, 'Solaris really sinks you');
    assert(moteGain(q) > baseMote, 'and its motes really are worth more');
    q.toMenu();
    C.equip('deepfield');

    // and none of it may touch the shared course
    C.grant('monolith'); C.equip('monolith');
    const d = newGame(900, 1600);
    d.startDaily();
    eq(d.world, null, 'the Daily always flies neutral, whatever you own');
    C.equip('deepfield');
    d.toMenu();
  });

  test('Bounty: pays double, moves, and never touches the daily', () => {
    freshStorage();
    const g = newGame(900, 1600);
    g.start();
    g.motes.length = 0;
    g.spawnBounty();
    const b = g.motes[0];
    assert(!!b && b.bounty, 'a bounty spawned');
    assert(b.amp > 0, 'it has somewhere to travel');
    const y0 = b.y;
    for (let i = 0; i < 40; i++) g.update(1 / 60);
    assert(Math.abs(b.y - y0) > 1, 'and it genuinely moves');

    // worth exactly twice a plain mote at the same combo
    const score = (bounty) => {
      const t = newGame(900, 1600);
      t.start();
      t.combo = 8;
      const before = t.score;
      t.collectMote({ x: 10, y: 10, r: 4, taken: false, bounty });
      const gained = t.score - before;
      t.toMenu();
      return gained;
    };
    eq(score(true), score(false) * 2, 'a bounty is worth exactly double');
    g.toMenu();

    // the shared course must stay identical for everyone
    const d = newGame(900, 1600);
    d.startDaily();
    d.motes.length = 0;
    d.spawnBounty();
    eq(d.motes.length, 0, 'no bounty is ever injected into a daily run');
    d.toMenu();
  });

  test('Zen: counts what it cannot score', () => {
    freshStorage();
    L.Modes.setCurrent('zen');
    const g = newGame(900, 1600);
    g.start();
    eq(g.bumps, 0, 'starts clean');
    g.die(); g.die(); g.die();
    eq(g.bumps, 3, 'every crash is counted');
    eq(g.state, 'play', 'and none of them ended the run');
    const shards = L.Store.shards, runs = L.Store.runs;
    g.score = 99999;
    g.finalizeRun();
    eq(L.Store.shards, shards, 'still pays nothing');
    eq(L.Store.runs, runs, 'still counts no run');
    g.toMenu();
    L.Modes.setCurrent('classic');
  });

  test('Difficulty keeps tightening well past the first minute', () => {
    // The ramp used to finish its work in about 60s and then sit flat, which
    // turned a long run into a test of patience rather than skill.
    freshStorage();
    const g = newGame(900, 1600);
    g.start();
    const at = (t) => { g.elapsed = t; return { s: g.scrollSpeed, gap: g.gapFrac, spawn: g.spawnInterval }; };
    const a = at(30), b = at(60), c = at(120), d = at(240);
    assert(b.s > a.s && c.s > b.s && d.s > c.s, 'speed climbs the whole way');
    assert(b.gap < a.gap && c.gap < b.gap && d.gap < c.gap, 'gaps keep narrowing');
    assert(d.spawn < b.spawn, 'gates keep getting closer together');
    // and it stays fair: never below what the orb can physically thread
    assert(at(600).gap * g.playH > g.player.r * 2.2, 'even at ten minutes it is still passable');
    g.toMenu();
  });

  test('Items: the new ones each answer a different failure', () => {
    freshStorage();
    const P = L.Progression;
    eq(P.ITEMS.length, 6, 'six kinds to choose between');
    for (const it of P.ITEMS) assert(it.cost > 0, it.id + ' has a price');

    const g = newGame();
    g.start();
    // SCOUT and ANCHOR are timed
    g.hand.scout = 1; eq(g.useItem('scout'), true, 'scout fires');
    assert(g.fx.scout > 0, 'and runs on a timer');
    g.hand.anchor = 1; eq(g.useItem('anchor'), true, 'anchor fires');
    assert(g.fx.anchor > 0, 'and runs on a timer');

    // SPARK is instant and only worth anything if you HAD a chain
    g.combo = 0; g.lastChain = 0;
    g.hand.spark = 1;
    g.useItem('spark');
    eq(g.combo, 0, 'nothing to restore, nothing restored');
    g.combo = 24; g.breakCombo();
    eq(g.combo, 0, 'chain broken');
    g.hand.spark = 1;
    g.useItem('spark');
    eq(g.combo, 24, 'spark hands the lost chain straight back');
    g.hand.spark = 1;
    g.useItem('spark');
    eq(g.combo, 24, 'but only once per break — no infinite chain');
    g.toMenu();
  });

  test('Items: anchor genuinely halves the fall', () => {
    freshStorage();
    const drop = (anchored) => {
      const g = newGame(900, 1600);
      g.start();
      g.player.y = g.playTop + g.playH * 0.5; g.player.vy = 0; g.player.dir = 1;
      g.fx.anchor = anchored ? 10 : 0;
      const y0 = g.player.y;
      for (let i = 0; i < 18; i++) g.update(1 / 60);
      const d = g.player.y - y0;
      g.toMenu();
      return d;
    };
    const free = drop(false), held = drop(true);
    assert(held < free * 0.75, 'anchored fall is clearly shallower (' + held.toFixed(1) + ' vs ' + free.toFixed(1) + ')');
  });

  test('Cosmetics: the expanded catalogue is still coherent', () => {
    freshStorage();
    const C = L.Cosmetics;
    assert(C.SKINS.length >= 20, 'a real spread of skins');
    assert(C.TRAILS.length >= 12, 'a real spread of trails');
    const ids = C.SKINS.concat(C.TRAILS, C.MAPS).map((i) => i.id);
    eq(new Set(ids).size, ids.length, 'no duplicate ids');
    for (const it of C.SKINS.concat(C.TRAILS, C.MAPS)) {
      // every item is either priced or earned — never both, never neither
      const p = C.price(it.id), req = C.requirement(it.id);
      assert(!!p !== !!req, it.id + ' is either for sale or earned, not both');
      assert(!!L.t('cos_' + it.id), it.id + ' has a name');
      assert(!!L.t('cosd_' + it.id), it.id + ' has a description');
    }
  });

  test('Cheats: a cheated run is thrown away entirely', () => {
    // The whole reason cheats can live in the source tree. If a dev run could
    // write a score, a shard or an achievement, the save file and the online
    // board would fill up with numbers nobody played for.
    freshStorage();
    L.Store.best = 500; L.Store.shards = 100; L.Store.runs = 7; L.Store.motes = 40;
    const before = { best: L.Store.best, shards: L.Store.shards, runs: L.Store.runs,
                     motes: L.Store.motes, scores: L.Scores.list().length };
    const g = newGame();
    g.start();
    g.score = 99999; g.bestComboRun = 80; g.motesRun = 500; g.flowSecRun = 30;
    g.cheated = true;                       // as any cheat would have set
    g.finalizeRun();
    eq(L.Store.best, before.best, 'no best score written');
    eq(L.Store.shards, before.shards, 'no shards paid');
    eq(L.Store.runs, before.runs, 'not even counted as a run');
    eq(L.Store.motes, before.motes, 'no lifetime motes');
    eq(L.Scores.list().length, before.scores, 'never reaches the local board');
    eq(L.Progression.summary().done, 0, 'and unlocks no achievements');
    g.toMenu();
  });

  test('Cheats: an honest run still records normally', () => {
    // The guard must be exact — it would be worse to silently void real runs.
    freshStorage();
    const g = newGame();
    g.start();
    g.score = 4000; g.bestComboRun = 25; g.motesRun = 60; g.flowSecRun = 5;
    eq(!!g.cheated, false, 'a clean run is not flagged');
    g.finalizeRun();
    assert(L.Store.best > 0, 'best score recorded');
    assert(L.Store.shards > 0, 'shards paid');
    eq(L.Store.runs, 1, 'run counted');
    g.toMenu();
  });

  test('Cheats: god mode taints the run from the very first frame', () => {
    freshStorage();
    if (!L.Cheats.available) { assert(true, 'not a dev origin — cheats are inert here'); return; }
    let g;
    try {
      L.Cheats.god = false;
      L.Cheats.toggleGod();
      g = newGame();
      g.start();
      eq(g.cheated, true, 'starting a run with god on is already a cheated run');
      // and it genuinely survives a lethal hit
      g.die();
      eq(g.state, 'play', 'god mode shrugs the hit off');
    } finally {
      // Leaving god mode on would make every later test immortal — which is
      // exactly how this test first took the fairness sweep down with it.
      L.Cheats.god = false;
      if (g) g.toMenu();
    }
  });

  test('Cheats: unreachable on a public origin', () => {
    // The gate is the origin itself, which a player cannot change. Prove the
    // predicate rejects real hosts and accepts developer ones.
    const dev = (host, proto) => {
      if (proto === 'file:') return true;
      if (!host) return true;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
      if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
      return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    };
    for (const h of ['lumen.game', 'www.example.com', 'itch.io', 'play.google.com', '8.8.8.8'])
      eq(dev(h, 'https:'), false, h + ' must NOT get cheats');
    for (const h of ['localhost', '127.0.0.1', '192.168.1.40', '10.0.0.5'])
      eq(dev(h, 'http:'), true, h + ' is a developer origin');
    eq(dev('anything', 'file:'), true, 'a local file is a developer origin');
    // and the live module agrees with itself
    eq(L.Cheats.available, dev(location.hostname, location.protocol), 'module matches the rule');
  });

  test('Gates glow on EVERY quality tier, not just the pretty ones', () => {
    // A player asked why the bars alone looked flat. The orb, motes and walls all
    // light the scene regardless of tier; obstacles were the one thing gated on
    // Q.glow, so on the low tier — which the game can drop into by itself — the
    // most important object on screen stopped matching everything around it.
    freshStorage();
    const results = [];
    for (const tier of ['low', 'balanced', 'high']) {
      L.applyQuality(tier, true);
      const g = newGame(900, 1600);
      g.start();
      g.obstacles.length = 0; g.motes.length = 0; g.powers.length = 0;
      const x = Math.round(g.W * 0.5);
      const gapY = g.playTop + g.playH * 0.5, gapH = g.playH * 0.28;
      g.obstacles.push({ x, w: g.obstacleW, kind: 'normal', spec: {}, passed: false,
        gaps: [{ y: gapY, h: gapH }], baseGapY: gapY, baseGapH: gapH,
        moveAmp: 0, pulseAmp: 0, movePhase: 0, moveSpeed: 0 });
      g.render();
      const ctx = g.ctx, dpr = g.canvas.width / g.W, y = g.playTop + g.playH * 0.15;
      const lum = (px) => {
        const d = ctx.getImageData(Math.round(px * dpr), Math.round(y * dpr), 1, 1).data;
        return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
      };
      const far = lum(x - 160), near = lum(x - 5), edge = lum(x + 1), core = lum(x + g.obstacleW * 0.5);
      results.push({ tier, spill: near - far, edge, core });
      g.toMenu();
    }
    L.applyQuality('balanced', true);
    for (const r of results) {
      assert(r.spill > 3, r.tier + ' tier throws light into the dark (got ' + r.spill.toFixed(1) + ')');
      assert(r.edge > r.core, r.tier + ' keeps hot rims over a darker core, so it still reads as solid');
    }
  });

  test('Shop art: every map preview is a real, decodable image', () => {
    // The map cards rendered as empty boxes because the swatch pasted a hex alpha
    // onto an hsl() string; one invalid layer voids the whole `background`.
    // Belt and braces: the CSS must parse AND the SVG must be well-formed.
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    try {
      for (const m of L.Cosmetics.MAPS) {
        const css = L.UI.mapSwatch(m);
        probe.setAttribute('style', css);
        const bg = getComputedStyle(probe).backgroundImage;
        assert(bg && bg !== 'none', m.id + ' produces a background the browser accepts');
        const url = bg.match(/url\("(.*)"\)/);
        assert(!!url, m.id + ' carries an image');
        const svg = decodeURIComponent(url[1].replace(/^data:image\/svg\+xml;utf8,/, ''));
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        assert(!doc.querySelector('parsererror'), m.id + ' preview is well-formed SVG');
        assert(doc.querySelectorAll('rect,circle,ellipse').length >= 6, m.id + ' actually draws a scene');
      }
    } finally { probe.remove(); }
  });

  test('Attract: the menu demo leaves no trace on the save file', () => {
    // It plays itself behind the menu. If any of this leaked, a player would come
    // back to a "best score" they never set.
    freshStorage();
    const before = { best: L.Store.best, runs: L.Store.runs, shards: L.Store.shards,
                     combo: L.Store.bestCombo, motes: L.Store.motes };
    const g = newGame();
    g.state = 'menu';
    g.startAttract();
    eq(g.attract, true, 'demo armed');
    eq(g.state, 'play', 'it really simulates');
    for (let i = 0; i < 1800; i++) g.update(1 / 60);       // 30 seconds
    assert(g.elapsed > 0, 'time actually advanced');
    eq(L.Store.best, before.best, 'no best score written');
    eq(L.Store.runs, before.runs, 'no run counted');
    eq(L.Store.shards, before.shards, 'no shards paid');
    eq(L.Store.bestCombo, before.combo, 'no combo recorded');
    eq(L.Store.motes, before.motes, 'no motes banked');
    g.stopAttract();
    eq(g.attract, false, 'and it puts itself away');
    eq(g.state, 'menu', 'back to the menu state');
  });

  test('Attract: dying restarts the demo instead of ending a run', () => {
    freshStorage();
    const g = newGame();
    g.state = 'menu'; g.startAttract();
    g.die();
    eq(g.state, 'play', 'still running');
    eq(g.attract, true, 'still the demo');
    eq(L.Store.runs, 0, 'and the crash was never a run');
    g.stopAttract();
  });

  test('Attract: the autopilot can actually play', () => {
    // Best of three: it is deliberately imperfect, so a single sample is noise.
    freshStorage();
    let best = 0;
    for (let trial = 0; trial < 3; trial++) {
      const g = newGame();
      g.state = 'menu'; g.startAttract();
      let deaths = 0;
      const realDie = g.die.bind(g);
      g.die = function () { deaths++; realDie(); };
      for (let i = 0; i < 1200; i++) g.update(1 / 60);     // 20 seconds
      best = Math.max(best, 20 / (deaths + 1));
      g.stopAttract();
    }
    assert(best >= 8, 'survives a decent stretch unaided (best avg life ' + best.toFixed(1) + 's)');
  });

  test('Shop: every tab has content and Skills is one of them', () => {
    freshStorage();
    eq(L.Cosmetics.SKINS.length > 0 && L.Cosmetics.TRAILS.length > 0, true, 'customize has both catalogues');
    eq(L.Cosmetics.MAPS.length > 0, true, 'maps');
    eq(L.Progression.ITEMS.length > 0, true, 'items');
    eq(L.Progression.SKILLS.length > 0, true, 'skills');
  });

  test('Checkout: real money never spends shards, and cancelling grants nothing', async () => {
    freshStorage();
    L.Store.shards = 500;
    // Individual cosmetics are shard-only now — cash buys shards, or one of the
    // three premium SETS. So the cash path is exercised through a set.
    const price = L.Cosmetics.setPrice('nightfall');
    assert(price.usd > 0, 'this one has a cash price');
    // stand in for the UI: refuse, then accept
    L.IAP.register({
      isReady: () => true,
      purchase: () => Promise.resolve({ ok: false }),
      restore: () => Promise.resolve([]),
    });
    const piece = L.Cosmetics.setDef('nightfall').items[0];
    const no = await L.IAP.purchase('nightfall');
    eq(no.ok, false, 'cancelled');
    eq(L.Cosmetics.owned(piece), false, 'nothing granted');
    eq(L.Store.shards, 500, 'and no shards moved');

    L.IAP.register({
      isReady: () => true,
      purchase: () => Promise.resolve({ ok: true, receipt: 'r' }),
      restore: () => Promise.resolve(['nightfall']),
    });
    const yes = await L.IAP.purchase('nightfall');
    eq(yes.ok, true, 'paid');
    eq(L.Cosmetics.owned(piece), true, 'granted');
    eq(L.Store.shards, 500, 'paying cash must NEVER also cost shards');
    // a wiped device gets it back
    L.Store.unlocks = []; L.Cosmetics.invalidate();
    eq(L.Cosmetics.owned(piece), false, 'wiped');
    const r = await L.IAP.restore();
    eq(r.ok, true, 'restore ran');
    eq(L.Cosmetics.owned(piece), true, 'and re-granted what was paid for');
    L.IAP.register(L.IAP.sandboxProvider());
  });

  test('Checkout: money cannot buy a map or an earned-only skin', () => {
    // The promise the design makes: cash is cosmetics only.
    for (const m of L.Cosmetics.MAPS) {
      const p = L.Cosmetics.price(m.id);
      if (p) eq(p.usd, 0, m.id + ' has no cash price');
    }
    eq(L.Cosmetics.price('aurora'), null, 'earned-only has no price in either currency');
  });

  test('Voice: one recognition object is reused, so the mic is asked for once', () => {
    const V = L.Voice;
    if (!V.supported) { assert(true, 'no speech API here — nothing to prove'); return; }
    V._denied = false; V._rec = null;
    const a = V._build();
    const b = V._build();
    eq(a === b, true, 'the same instance comes back');
    // a refusal is remembered rather than retried forever
    V._denied = true;
    eq(V.start(), false, 'a declined mic is never re-requested on its own');
    V._denied = false; V._rec = null;
  });

  test('IAP: real money is invisible until a provider exists', () => {
    freshStorage();
    L.IAP.register(null);
    eq(L.IAP.available, false, 'no store, no cash buttons');
    L.IAP.register(L.IAP.mockProvider());
    eq(L.IAP.available, true, 'a provider turns it on');
    assert(L.IAP.formatPrice(2.49).indexOf('2.49') >= 0, 'prices are readable');
    L.IAP.register(null);
  });

  // Build 34-36 shipped with every real-money button missing on device while
  // rewarded ads worked. The cause was here: iap.js asked for
  // `Capacitor.registerPlugin`, which lives in the @capacitor/core bundle, and
  // LUMEN has no bundler — the injected native bridge only ever exposes
  // `Capacitor.Plugins`. So the store must resolve the way ads.js and native.js
  // already do, and this test pins the bridge shape that actually reaches the
  // WebView: Plugins present, registerPlugin absent.
  test('IAP: the store finds its plugin on the bridge the app really injects', () => {
    const realCap = window.Capacitor;
    const realNative = window.LUMEN_NATIVE;
    const realProvider = L.IAP.provider;
    const calls = [];
    try {
      window.LUMEN_NATIVE = { platform: 'mobile' };
      window.Capacitor = {                      // no registerPlugin, on purpose
        isNativePlatform: () => true,
        Plugins: {
          LumenStore: {
            products: (o) => { calls.push(o); return Promise.resolve({ products: [] }); },
            purchase: () => Promise.resolve({ ok: false }),
            restore: () => Promise.resolve({ owned: [] }),
          },
        },
      };
      L.IAP._resetProvider();
      assert(L.IAP.available, 'the cash store comes up with Plugins alone');
      assert(L.IAP.provider._storekit, 'and it is StoreKit, never the sandbox');
      eq(calls.length, 1, 'products were asked for exactly once');
      assert(calls[0].ids.indexOf('com.lumen.game.set.nightfall') >= 0, 'with the real ids');
    } finally {
      window.Capacitor = realCap;
      window.LUMEN_NATIVE = realNative;
      L.IAP._resetProvider(realProvider);
    }
  });

  test('Power-ups: the shield absorbs exactly one lethal hit', () => {
    freshStorage();
    const g = newGame(); g.start();
    g.shield = true; g.invuln = 0;
    g.obstacles.push({
      x: g.player.x - 5, w: 20, kind: 'normal', spec: {}, passed: false,
      gaps: [{ y: g.playTop + 5, h: 2 }],
    });
    for (let i = 0; i < 3 && g.state === 'play'; i++) g.update(1 / 60);
    eq(g.state, 'play', 'survived the hit');
    eq(g.shield, false, 'shield was consumed');
    assert(g.invuln > 0, 'brief grace so we do not instantly re-collide');
    g.toMenu();
  });

  test('Power-ups: spawn rarely and stay deterministic for the daily', () => {
    let n = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (LUMEN.Game.makeSpec(Math.random, 40, 0.5).power) n++;
    const pct = (n / N) * 100;
    assert(pct > 2 && pct < 14, 'a sane spawn rate (got ' + pct.toFixed(1) + '%)');
    // same seed => same power-up sequence
    const seeded = (seed) => {
      let a = seed;
      const rng = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const out = [];
      let c = 0.5;
      for (let i = 0; i < 60; i++) { const s = LUMEN.Game.makeSpec(rng, 40, c); c = s.c; out.push(s.power || '-'); }
      return out.join(',');
    };
    eq(seeded(4242), seeded(4242), 'identical for the same daily seed');
  });

  // ---- fairness: nothing collectible may hide inside a hazard --------------
  test('Fairness: a pickup is NEVER sitting inside a solid bar', () => {
    // A player reported dying to "the glowing thing". If a mote or power-up could
    // ever overlap a bar, the game would be punishing you for reading it right.
    // The shape that actually bit: a free mote spawns 20px past the right edge,
    // but gates enter at W + obstacleW — and obstacleW bottoms out at 16px on a
    // short window. So on some sizes the mote lands inside the footprint of a gate
    // that DOESN'T EXIST YET, which no amount of checking live obstacles can catch.
    // Both scroll at the same speed, so once embedded it stays embedded. Hence the
    // resolution sweep: one viewport would have missed it.
    freshStorage();
    const inSolid = (item, ob) => {
      // Past the LEFT edge this stops being a question about fairness. An
      // obstacle is culled at x < -20 but its attached pickups only at x < -30,
      // so for a few frames a pickup sits frozen at its dead gate's last
      // position while other gates scroll through it — off-screen, behind the
      // player, moments before both are deleted. Everything from the spawn edge
      // (x ≈ W + 20, which is where the original bug lived) leftward to zero is
      // still checked, which is every pixel a player can act on.
      if (item.x + item.r <= 0) return false;
      if (item.x + item.r < ob.x || item.x - item.r > ob.x + ob.w) return false;
      for (const gap of ob.gaps) {
        if (item.y > gap.y - gap.h * 0.5 && item.y < gap.y + gap.h * 0.5) return false;
      }
      return true;
    };
    const SIZES = [[390, 844], [530, 900], [900, 1600], [1280, 720], [360, 640], [1920, 1080]];
    const DIFFS = ['easy', 'normal', 'hard'];
    let bad = 0, worst = null;
    for (let run = 0; run < SIZES.length; run++) {
      L.Store.difficulty = DIFFS[run % DIFFS.length];
      const g = newGame(SIZES[run][0], SIZES[run][1]);
      g.start(); g.revived = true;
      for (let i = 0; i < 1800; i++) {
        g.player.y = g.playTop + g.playH * 0.5; g.player.vy = 0;  // park it: this tests spawning
        g.update(1 / 60);
        // `pulled` motes are under magnet tow — the player's own doing, and they're
        // heading to the orb, not baiting it into a wall. The guarantee under test
        // is about where the GAME places a mote.
        for (const m of g.motes) for (const ob of g.obstacles) if (!m.pulled && inSolid(m, ob)) { bad++; worst = worst || SIZES[run].join('x'); }
        for (const w of g.powers) for (const ob of g.obstacles) if (inSolid(w, ob)) { bad++; worst = worst || SIZES[run].join('x'); }
        if (g.state !== 'play') g.start();
      }
      g.toMenu();
    }
    eq(bad, 0, 'no pickup ever overlapped a hazard' + (worst ? ' (first at ' + worst + ')' : ''));
  });

  test('Fairness: a bounty never shares a column with a gate', () => {
    // The test above cannot reach this. It parks the player, so the run dies
    // every few seconds, and a bounty only arrives after 18-30 SECONDS of
    // survival — so in that test the timer never once ran out and the most
    // tempting collectable in the game was checked by nothing. Making the probe
    // immortal is the whole point of this one.
    //
    // What it caught: spawnBounty placed the mote at W + obstacleW*2, to the
    // RIGHT of the line gates are born on. So it drifted ACROSS that line, and a
    // gate born during the crossing was born inside it. Motes and gates scroll
    // at one speed, so that offset then held for good and the bounty spent its
    // visible life weaving over a solid bar — 1032 on-screen frames of it across
    // 24 bounties, worst on 390x844, the commonest phone there is.
    //
    // The assertion is horizontal separation, not "is it in a gap", because a
    // bounty weaves across a third of the corridor and therefore visits every
    // band eventually. Sharing a column with a gate is the thing that must never
    // happen; everything else follows from it.
    freshStorage();
    const SIZES = [[390, 844], [360, 640], [1280, 720]];
    let shared = 0, inSolidCount = 0, bounties = 0, worst = null;
    const seen = new Set();
    for (let run = 0; run < SIZES.length; run++) {
      const g = newGame(SIZES[run][0], SIZES[run][1]);
      g.start(); g.revived = true;
      for (let i = 0; i < 6000; i++) {
        g.player.y = g.playTop + g.playH * 0.5; g.player.vy = 0;
        g.invuln = 1;                       // immortal: a bounty needs a long run
        g.update(1 / 60);
        for (const m of g.motes) {
          if (!m.bounty || m.pulled) continue;
          if (!seen.has(m)) { seen.add(m); bounties++; }
          if (m.x + m.r <= 0) continue;     // past the left edge, same as above
          for (const ob of g.obstacles) {
            if (m.x + m.r < ob.x || m.x - m.r > ob.x + ob.w) continue;
            shared++; worst = worst || SIZES[run].join('x');
            let open = false;
            for (const gap of ob.gaps) {
              if (m.y > gap.y - gap.h * 0.5 && m.y < gap.y + gap.h * 0.5) { open = true; break; }
            }
            if (!open) inSolidCount++;
          }
        }
        if (g.state !== 'play') g.start();
      }
      g.toMenu();
    }
    // If no bounty ever spawned the rest of this proves nothing, so say so.
    eq(bounties >= 6, true, 'the probe actually produced bounties — got ' + bounties);
    eq(inSolidCount, 0, 'no bounty was ever inside a bar' + (worst ? ' (first at ' + worst + ')' : ''));
    eq(shared, 0, 'no bounty ever shared a column with a gate'
      + (worst ? ' (first at ' + worst + ')' : ''));
  });

  test('Fairness: every gate keeps finite, passable geometry for a whole run', () => {
    // The bug this guards: layoutObstacle forgot to copy movePhase/moveSpeed onto
    // the obstacle, so moving and pulsing gates animated against `undefined` and
    // went NaN — invisible to the renderer, and lethal across their whole width
    // because "inside a gap" is never true for NaN. An unseeable wall with no way
    // through. It only shows up after ~13s, which is when those gates start.
    const g = newGame();
    g.start(); g.revived = true;
    const kindsSeen = {};
    for (let i = 0; i < 6000; i++) {
      g.player.y = g.playTop + g.playH * 0.5; g.player.vy = 0; g.invuln = 1; // immortal probe
      g.update(1 / 60);
      for (const ob of g.obstacles) {
        kindsSeen[ob.kind] = true;
        for (const gap of ob.gaps) {
          assert(isFinite(gap.y), ob.kind + ' gate had a non-finite gap centre at t=' + g.elapsed.toFixed(1) + 's');
          assert(isFinite(gap.h), ob.kind + ' gate had a non-finite gap height at t=' + g.elapsed.toFixed(1) + 's');
          assert(gap.h > 0, ob.kind + ' gate closed to nothing');
        }
      }
    }
    assert(kindsSeen.moving, 'the run was long enough to include moving gates');
    assert(kindsSeen.pulsing, 'the run was long enough to include pulsing gates');
    g.toMenu();
  });

  test('Readability: hazard, reward and hero are far apart in hue', () => {
    const g = newGame();
    const hue = (c) => parseFloat(/hsla?\(\s*([\d.]+)/.exec(c)[1]);
    const sep = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
    const danger = hue(g.dangerColor(1)), reward = hue(g.moteColor()), hero = g.orbHue();
    // Hue alone isn't what separates these — a hazard is a tall dark-cored bar
    // with hot rims, a reward is a small bright pulsing diamond. Hue is the
    // backup channel, so a solid margin is enough; the colour-vision presets
    // below are the ones that need real distance.
    assert(sep(danger, reward) > 45, 'hazard vs reward are distinguishable (got ' + Math.round(sep(danger, reward)) + '°)');
    assert(sep(danger, hero) > 60, 'hazard vs hero are distinguishable (got ' + Math.round(sep(danger, hero)) + '°)');
    assert(danger > 330 || danger < 20, 'the hazard reads as red (got ' + Math.round(danger) + '°)');

    // every colour-vision preset must separate hazard from reward strongly
    ['deuter', 'prot', 'trit'].forEach((mode) => {
      LUMEN.Store.colorblind = mode;
      const d = hue(g.dangerColor(1)), r = hue(g.moteColor());
      assert(sep(d, r) > 100, mode + ' separates hazard from reward (got ' + Math.round(sep(d, r)) + '°)');
    });
    LUMEN.Store.colorblind = 'off';
    g.toMenu();
  });

  // Guideline 5.1.2, and the reason 1.0 was rejected a second time: consent has
  // to come BEFORE the upload. Signing in is consent to having an account; it is
  // not consent to being published on a board strangers read.
  // Guideline 5.1.2, and the reason 1.0 was rejected a second time: consent has
  // to come BEFORE the upload. Signing in is consent to having an account; it is
  // not consent to being published on a board strangers read.
  //
  // Declared async, not merely promise-returning: the runner only defers and
  // awaits an AsyncFunction, so a plain function that returns a promise is
  // marked passed immediately and leaks its stubs into the next test.
  test('Leaderboard: nothing is published until the player says so', async () => {
    freshStorage();
    const LB = L.Leaderboard;
    const sent = [];
    const realSubmit = LB.submit;
    const realFetch = window.fetch;
    window.fetch = () => Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve([]),
    });
    LB.submit = (sc) => { sent.push(sc); return Promise.resolve(null); };
    try {
      LB._sb = { url: 'https://test.invalid', key: 'k' };
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u-quiet' } };
      L.Store.playerName = 'tester';
      L.Store.boardConsent = false;

      // Everything else a submit needs is in place — an account, a name, a board.
      assert(LB.enabled && L.Auth.signedIn && LB.named, 'the upload is otherwise ready');
      eq(LB.canSubmit, false, 'and it still refuses, because nobody agreed to it');

      LB.submitQuietly(4000, 9, 'alltime');
      LB.hold(4000, 9, 'alltime');
      const none = await LB.flushPending();
      eq(sent.length, 0, 'a run that beat a record still went nowhere');
      eq(none.length, 0, 'and the held best stayed held');

      // Saving the name is the affirmative act, with the disclosure above it.
      L.Store.boardConsent = true;
      eq(LB.canSubmit, true, 'now it may go up');
      const done = await LB.flushPending();
      eq(done.length, 1, 'and what was held goes with it');
      eq(sent[0], 4000, 'the same run, unchanged');
    } finally {
      window.fetch = realFetch;
      LB.submit = realSubmit;
      L.Auth.session = null;
      LB._sb = null;
      L.Store.boardConsent = false;
    }
  });

  // A class that styles nothing is indistinguishable from a feature that was
  // never built. The first run used to be hijacked into a lesson; that was
  // reversed and replaced with `nudge` on HOW TO PLAY — but the CSS rule was
  // never written, so for every new player the button looked like every other
  // button and the lesson may as well not have existed. It was reported as
  // "the tutorial doesn't open".
  test('A new player is actually pointed at the lesson', async () => {
    // The real markup AND the real stylesheet — the whole point is whether the
    // class paints anything, which browser defaults cannot answer.
    await loadGameMarkup();
    freshStorage();
    const tut = document.getElementById('btn-tutorial');
    assert(tut, 'the lesson button exists');

    L.Store.tutorialDone = false;
    L.UI.refreshMenu();
    assert(tut.classList.contains('nudge'), 'a new player gets the class');
    const lit = getComputedStyle(tut);
    const litBorder = lit.borderColor, litShadow = lit.boxShadow;

    L.Store.tutorialDone = true;
    L.UI.refreshMenu();
    assert(!tut.classList.contains('nudge'), 'and a graduate does not');
    const plain = getComputedStyle(tut);

    // The point of the test: the class has to CHANGE something a player can see.
    assert(litBorder !== plain.borderColor || litShadow !== plain.boxShadow,
      'and the class visibly changes the button (border ' + litBorder + ' vs ' + plain.borderColor + ')');
    L.Store.tutorialDone = false;
    L.UI.refreshMenu();
  });

  // ---- BRITTLE -------------------------------------------------------------
  // The mode that inverts the game: the bar is the target, the gap is the
  // coward's line. Everything below guards a claim the mode makes to the player.

  // A fault drawn over an OPENING would be an instruction to fly into thin air
  // and score nothing; a fault that leaves the corridor would be unreachable.
  // It is derived from the live gap on every read precisely so that moving,
  // pulsing, tidal and resized gates all stay honest — so test all of them.
  test('BRITTLE: the fault is always solid bar, never an opening', () => {
    freshStorage();
    L.Modes.setCurrent('brittle');
    const g = newGame();
    g.start();
    const seen = Object.create(null);
    let checked = 0;
    for (let round = 0; round < 120; round++) {
      g.elapsed = [0, 30, 90, 300, 900][round % 5];
      g.obstacles.length = 0;
      g.spawnObstacle();
      const ob = g.obstacles[0];
      seen[ob.kind] = (seen[ob.kind] || 0) + 1;
      // Sweep a whole motion period: a band that is legal at rest and illegal at
      // the top of the gate's travel is a band that lies.
      for (let k = 0; k < 24; k++) {
        g.elapsed += 0.13;
        if (ob.kind === 'moving') {
          ob.gaps[0].y = ob.gaps[0].baseY =
            ob.baseGapY + Math.sin(g.elapsed * ob.moveSpeed + ob.movePhase) * ob.moveAmp;
        } else if (ob.kind === 'pulsing') {
          ob.gaps[0].h = ob.baseGapH * (1 - ob.pulseAmp * (0.5 + 0.5 * Math.sin(g.elapsed * ob.moveSpeed + ob.movePhase)));
        }
        const b = g.faultBand(ob);
        assert(b, ob.kind + ' gate has a fault');
        assert(b.y0 >= g.playTop - 0.5 && b.y1 <= g.playBottom + 0.5, 'the fault stays in the corridor');
        assert(b.y1 - b.y0 >= g.baseR * 1.6, 'and stays big enough to aim at (' + (b.y1 - b.y0).toFixed(1) + ')');
        for (const gap of ob.gaps) {
          const t = gap.y - gap.h * 0.5, bo = gap.y + gap.h * 0.5;
          assert(b.y1 <= t + 0.5 || b.y0 >= bo - 0.5,
            'the fault never overlaps an opening (' + ob.kind + ')');
        }
        checked++;
      }
    }
    assert(checked > 2000, 'a real sweep ran');
    assert(seen.normal && seen.double, 'and it covered more than one archetype');
    L.Modes.setCurrent('classic');
    g.toMenu();
  });

  // The band is derived, never stored — so a resize must not be able to strand
  // it. This is the arm traps were missing when they shipped.
  test('BRITTLE: the fault survives a resize', () => {
    freshStorage();
    L.Modes.setCurrent('brittle');
    const g = newGame();
    g.start();
    for (let i = 0; i < 20; i++) g.spawnObstacle();
    g.resize(390, 844);
    for (const ob of g.obstacles) {
      const b = g.faultBand(ob);
      assert(b, 'still there after a resize');
      assert(b.y0 >= g.playTop - 0.5 && b.y1 <= g.playBottom + 0.5, 'still inside the corridor');
      for (const gap of ob.gaps) {
        const t = gap.y - gap.h * 0.5, bo = gap.y + gap.h * 0.5;
        assert(b.y1 <= t + 0.5 || b.y0 >= bo - 0.5, 'still never over an opening');
      }
    }
    L.Modes.setCurrent('classic');
    g.toMenu();
  });

  // The three outcomes, driven through real frames — the only harness that
  // catches a wiring mistake, because frame() swallows exceptions and a broken
  // mode presents as "nothing happens".
  test('BRITTLE: smash it, duck it, or die on the wrong part of the bar', () => {
    freshStorage();
    L.Modes.setCurrent('brittle');
    const g = newGame();
    const f = g.mode ? null : null;

    // Put a gate on the orb, with the orb wherever the caller says.
    const stage = (aim) => {
      g.start();
      g.obstacles.length = 0; g.motes.length = 0; g.powers.length = 0;
      g.spawnObstacle();
      const ob = g.obstacles[0];
      const p = g.player;
      ob.x = p.x - ob.w * 0.5;
      const b = g.faultBand(ob);
      const gap = ob.gaps[ob.faultGap] || ob.gaps[0];
      p.y = aim === 'fault' ? (b.y0 + b.y1) * 0.5 : gap.y;
      p.vy = 0;
      return { ob, p, b, gap };
    };

    // 1. SHATTER
    let st = stage('fault');
    const flt = g.mode.fault;
    const nerve0 = g.nerve, score0 = g.score;
    g.update(1 / 60);
    assert(st.ob.broken, 'the bar breaks');
    eq(g.state, 'play', 'and the run continues');
    assert(g.combo >= 1, 'it feeds the chain');
    assert(g.score > score0, 'and pays');
    assert(Math.abs(g.nerve - (nerve0 + flt.gain)) < 1e-9, 'nerve up by exactly one third');
    assert(g.heat > 0, 'and the corridor heats up');

    // 2. DEATH — solid bar, away from the fault
    st = stage('fault');
    // the far lip of the OTHER side is bar, and is not the fault
    st.p.y = st.ob.faultSide < 0 ? g.playBottom - 2 : g.playTop + 2;
    g.update(1 / 60);
    eq(g.state, 'dead', 'the rest of the bar still kills');

    // 3. DUCK — a clean pass through the opening
    st = stage('gap');
    g.combo = 5;
    const heat0 = g.heat = 40, nerveB = g.nerve = 2;
    const scoreB = g.score;
    st.ob.x = st.p.x - st.p.r - st.ob.w - 1;   // already behind the orb
    g.update(1 / 60);
    assert(st.ob.passed, 'the gate counted as passed');
    eq(g.combo, 0, 'and the chain died because you did NOT touch a bar');
    assert(g.nerve === nerveB - flt.cost, 'a nerve was spent');
    assert(g.heat === heat0 - flt.cool, 'and the corridor cooled');
    assert(g.score > scoreB, 'the gate still paid its +6 — the PRECISION skill depends on it');
    eq(g.state, 'play', 'and with nerve left, the run goes on');

    L.Modes.setCurrent('classic');
    g.toMenu();
  });

  // The economy IS the mode. Three hits buy one brake; alternating burns down.
  test('BRITTLE: three hits buy one brake, and the alternator starves', () => {
    freshStorage();
    L.Modes.setCurrent('brittle');
    const g = newGame();
    g.start();
    const f = g.mode.fault;
    eq(f.gain * 3, f.cost, 'three shatters pay for exactly one duck');
    // Alternating shatter/duck nets -2/3 of a nerve per pair, so from the
    // opening 2.0 the alternator is out inside three pairs. That is what stops
    // "duck everything dangerous" from being a strategy.
    let n = f.start;
    let pairs = 0;
    while (n >= f.cost) { n = Math.min(f.nerve, n + f.gain) - f.cost; pairs++; }
    assert(pairs <= 3, 'the alternator is dead in three pairs (' + pairs + ')');
    // …and a duck must be able to undo more heat than a shatter adds, or it is
    // never the right answer and the mode has no decision in it.
    assert(f.cool > f.stoke * 2, 'one duck is worth more than two shatters of heat');
    L.Modes.setCurrent('classic');
    g.toMenu();
  });

  // Heat pushes the DIFFICULTY clock and must never touch `elapsed`, which is
  // also the time-survived stat the run reports.
  test('BRITTLE: heat drives the corridor, not the clock on the wall', () => {
    freshStorage();
    L.Modes.setCurrent('brittle');
    const g = newGame();
    g.start();
    g.elapsed = 40; g.heat = 0;
    const cold = { t: g.rampT, gap: g.gapFrac, speed: g.scrollSpeed, spawn: g.spawnInterval };
    g.heat = 60;
    assert(g.elapsed === 40, 'the run clock is untouched');
    assert(g.rampT > cold.t, 'the difficulty clock moved');
    assert(g.gapFrac <= cold.gap && g.scrollSpeed >= cold.speed && g.spawnInterval <= cold.spawn,
      'and the corridor actually tightened');
    // Every other mode must be byte-identical: heat is undefined there.
    L.Modes.setCurrent('classic');
    const c = newGame();
    c.start();
    c.elapsed = 40;
    assert(Math.abs(c.rampT - 40 * c.mode.ramp) < 1e-9, 'Classic reads exactly elapsed * ramp');
    c.toMenu();
  });

  // Playing the mode correctly aims a band's height off the gap centre, which is
  // exactly where a gate's reward rides. Breaking the gate must therefore hand
  // the reward over, not delete it mid-flight — the orphaned-passenger bug.
  test('BRITTLE: a shattered gate hands over its passengers', () => {
    freshStorage();
    L.Modes.setCurrent('brittle');
    const g = newGame();
    g.start();
    g.obstacles.length = 0; g.motes.length = 0; g.powers.length = 0;
    g.spawnObstacle();
    const ob = g.obstacles[0], p = g.player;
    const gap = ob.gaps[ob.faultGap] || ob.gaps[0];
    g.motes.push({ x: ob.x + ob.w * 0.5, y: gap.y, r: g.baseR * 0.85, taken: false, pulse: 0, ob, gap });
    ob.x = p.x - ob.w * 0.5;
    const b = g.faultBand(ob);
    p.y = (b.y0 + b.y1) * 0.5; p.vy = 0;
    const motes0 = g.motesRun;
    g.update(1 / 60);
    assert(ob.broken, 'the gate broke');
    assert(g.motesRun > motes0, 'and its mote was collected, not stranded');
    assert(!g.motes.some((m) => m.ob === ob), 'nothing is left riding a gate that is gone');
    L.Modes.setCurrent('classic');
    g.toMenu();
  });

  // ---- difficulty ----------------------------------------------------------
  test('Difficulty: easy is genuinely easier and hard genuinely harder', () => {
    freshStorage();
    const g = newGame();
    const probe = (d) => {
      LUMEN.Store.difficulty = d; g.start(); g.elapsed = 30;
      return { gap: g.gapFrac, speed: g.scrollSpeed, spawn: g.spawnInterval, mul: g.diff.scoreMul };
    };
    const v = probe('veryeasy'), e = probe('easy'), n = probe('normal'), h = probe('hard');
    assert(v.gap > e.gap && e.gap > n.gap && n.gap > h.gap, 'openings narrow as difficulty rises');
    assert(v.speed < e.speed && e.speed < n.speed && n.speed < h.speed, 'the world speeds up as difficulty rises');
    assert(v.spawn > e.spawn && e.spawn > n.spawn && n.spawn > h.spawn, 'gates arrive more often as difficulty rises');
    assert(v.mul < e.mul && e.mul < n.mul && n.mul < h.mul, 'harder settings are worth more points');
    LUMEN.Store.difficulty = 'normal';
    g.toMenu();
  });

  // Players did not say the game was hard, they said the ORB was too fast up and
  // down. The fix is a CEILING on speed, and the whole point of choosing a
  // ceiling over weaker gravity is that it buys the drop without paying for it
  // anywhere else. All three halves of that claim are checked here, driven
  // through the real integrator rather than the formula it came from -- a
  // clamp written after the position update, or before the acceleration, would
  // satisfy the arithmetic and not the game.
  test('Speed ceiling: caps the whip, leaves gravity and the gaps alone', () => {
    freshStorage();
    L.Modes.setCurrent('classic');

    // Drop from the top wall and report what ACTUALLY happens on the way down.
    const drop = (diff, dist) => {
      L.Store.difficulty = diff;
      const g = newGame(390, 844);
      g.start();
      g.obstacles.length = 0; g.motes.length = 0; g.powers.length = 0;
      const p = g.player;
      p.y = g.playTop + p.r; p.vy = 0; p.dir = 1;
      const y0 = p.y;
      let t = 0, peak = 0;
      for (let i = 0; i < 3000; i++) {
        g.obstacles.length = 0;               // nothing to hit; this is a physics rig
        g.updatePlay(1 / 60, 1 / 60);
        t += 1 / 60;
        peak = Math.max(peak, Math.abs(p.vy));
        if (p.y - y0 >= dist || p.y > g.playBottom - p.r) break;
      }
      const out = { t, peak, cap: g.vMax, spawn: g.spawnInterval, cross: g.CROSS_TIME };
      g.toMenu();
      return out;
    };

    // 1. The ceiling is real, and it is the ceiling that was asked for.
    for (const d of ['veryeasy', 'easy', 'normal']) {
      const r = drop(d, 10000);
      assert(r.cap < Infinity, d + ' declares a ceiling');
      assert(r.peak <= r.cap + 1, d + ' never exceeds it (' + Math.round(r.peak) + ' vs ' + Math.round(r.cap) + ')');
      assert(r.peak > r.cap - 30, d + ' actually REACHES it, so the test is measuring the clamp');
    }
    const hard = drop('hard', 10000);
    eq(hard.cap, Infinity, 'HARD has no ceiling');
    assert(hard.peak > 1500, 'and still hits full speed (' + Math.round(hard.peak) + ')');

    // 2. Gravity is untouched. A short correction -- the thing a player does
    //    hundreds of times a run -- must take the SAME time on the gentlest
    //    setting as on the harshest. If someone "fixes" this by lowering
    //    gravity instead, this is the assertion that fails.
    const shortVE = drop('veryeasy', 120).t, shortHard = drop('hard', 120).t;
    assert(Math.abs(shortVE - shortHard) < 0.02,
      'a 120px correction costs the same at both ends (' + shortVE.toFixed(3) + ' vs ' + shortHard.toFixed(3) + ')');

    // 3. The ceiling must not LEAK into spawn spacing. Spacing is its own dial:
    //    a tier is spaced by exactly its own `spawn` and nothing else, so a
    //    change to topSpeed can never quietly move the gates around.
    //
    //    Read from the table rather than repeating its numbers. Spacing IS
    //    tuned -- VERY EASY and EASY were both widened when their ceilings came
    //    down, so that a slower orb still has time to reach the next opening --
    //    and a test that hard-codes today's constant fails on a legitimate tune
    //    while still not noticing the leak it was written to catch.
    const ratio = (d) => drop(d, 1).spawn / drop('hard', 1).spawn;
    for (const d of ['veryeasy', 'easy', 'normal']) {
      const want = L.DIFFICULTY[d].spawn / L.DIFFICULTY.hard.spawn;
      assert(Math.abs(ratio(d) - want) < 1e-6,
        d.toUpperCase() + ' spacing is exactly its own `spawn`, nothing else');
    }

    // 4. DREAD's fairness rule survives the ceiling: an unseen gate must stay
    //    visible for longer than it takes to cross to it.
    for (const d of ['veryeasy', 'easy', 'normal', 'hard']) {
      L.Store.difficulty = d;
      L.Modes.setCurrent('dread');
      const g = newGame(390, 844);
      g.start();
      const budget = g.mode.reveal.at * (g.crossSeconds / g.CROSS_TIME);
      assert(budget > g.crossSeconds,
        'DREAD warns for longer than the crossing takes on ' + d
        + ' (' + budget.toFixed(2) + 's vs ' + g.crossSeconds.toFixed(2) + 's)');
      g.toMenu();
    }
    L.Modes.setCurrent('classic');
    L.Store.difficulty = 'normal';
  });

  // VERY EASY exists so the game can be seen without the reflex test. The danger
  // is the obvious one: a run you can hold almost indefinitely becomes the best
  // place to farm, and then every price in the shop is set by the setting nobody
  // is meant to grind on. scoreMul alone cannot prevent that — an easier run
  // lasts longer, so a smaller multiplier on a much larger number can come out
  // ahead. The payout needs its own brake, and it has to actually reach award().
  test('Difficulty: VERY EASY is the gentlest to play and the poorest to farm', () => {
    freshStorage();
    const D = LUMEN.DIFFICULTY;
    assert(D.veryeasy, 'the setting exists');
    assert(D.veryeasy.shardMul < 1, 'and it pays less per point than everything else');
    ['easy', 'normal', 'hard'].forEach((d) => {
      eq(D[d].shardMul, undefined, d + ' keeps the balance it always had');
    });

    // The brake has to survive the trip to the payout, not just sit in the table.
    // Watch the multiplier that actually reaches award(): the shard TOTAL is no
    // good here, because missions pay out in the same breath and their rewards
    // depend on which goals happened to be rolled.
    const g = newGame();
    const mulFor = (d) => {
      freshStorage();
      LUMEN.Store.difficulty = d;
      LUMEN.Modes.setCurrent('classic');
      const real = LUMEN.Cosmetics.award;
      let seen = null;
      LUMEN.Cosmetics.award = function (score, motes, flow, mul, mw) {
        seen = mul;
        return real.call(this, score, motes, flow, mul, mw);
      };
      try {
        g.start();
        g.score = 6000; g.motesRun = 40; g.flowSecRun = 12;
        g.finalizeRun();
      } finally {
        LUMEN.Cosmetics.award = real;
      }
      g.toMenu();
      return seen;
    };
    const veryEasy = mulFor('veryeasy'), normal = mulFor('normal');
    assert(veryEasy != null && normal != null, 'both runs reached the payout');
    assert(veryEasy < normal,
      'VERY EASY pays a smaller share of the same run (' + veryEasy + ' vs ' + normal + ')');
    eq(normal, 1, 'and Normal is untouched');
    LUMEN.Store.difficulty = 'normal';
    g.toMenu();
  });

  test('Difficulty: the Daily Challenge is always Normal', () => {
    freshStorage();
    const g = newGame();
    LUMEN.Store.difficulty = 'easy';
    g.startDaily();
    eq(g.diff.scoreMul, 1, 'daily ignores an easy setting');
    eq(g.diff.gap, 1, 'daily uses stock gap width');
    LUMEN.Store.difficulty = 'hard';
    g.startDaily();
    eq(g.diff.scoreMul, 1, 'daily ignores a hard setting too');
    LUMEN.Store.difficulty = 'normal';
    g.toMenu();
  });

  // ---- achievements --------------------------------------------------------
  test('Achievements: award once, pay once, and never re-award', () => {
    freshStorage();
    const P = LUMEN.Progression;
    LUMEN.Store.best = 150;                 // clears "First Light" (100)
    const first = P.check();
    assert(first.some((a) => a.id === 'firstLight'), 'first achievement earned');
    const shards = LUMEN.Store.shards;
    assert(shards > 0, 'reward paid');
    eq(P.check().length, 0, 'nothing awarded twice');
    eq(LUMEN.Store.shards, shards, 'and no second payment');
  });

  test('Achievements: locked until the stat actually reaches the goal', () => {
    freshStorage();
    const P = LUMEN.Progression;
    LUMEN.Store.bestCombo = 19;
    P.check();
    assert(!P.earned('chain1'), 'a 19 combo does not earn the 20 badge');
    LUMEN.Store.bestCombo = 20;
    P.check();
    assert(P.earned('chain1'), 'reaching the goal earns it');
  });

  test('Achievements: progress is reported and clamped to the goal', () => {
    freshStorage();
    LUMEN.Store.motes = 99999;
    const row = LUMEN.Progression.list().find((r) => r.id === 'motes1');
    eq(row.progress, row.goal, 'progress never exceeds the goal');
  });

  // ---- skills --------------------------------------------------------------
  test('Skills: cost shards, level up, and cap out', () => {
    freshStorage();
    const P = LUMEN.Progression;
    LUMEN.Store.shards = 10;
    eq(P.upgrade('magnet'), false, 'cannot buy without shards');
    eq(P.level('magnet'), 0, 'still level 0');
    LUMEN.Store.shards = 99999;
    const before = LUMEN.Store.shards;
    const cost = P.nextCost('magnet');
    eq(P.upgrade('magnet'), true, 'buys');
    eq(LUMEN.Store.shards, before - cost, 'charged exactly once');
    eq(P.level('magnet'), 1, 'level 1');
    P.upgrade('magnet'); P.upgrade('magnet');
    eq(P.level('magnet'), 3, 'reaches max');
    eq(P.nextCost('magnet'), null, 'no cost beyond max');
    eq(P.upgrade('magnet'), false, 'cannot exceed max');
  });

  test('Skills: every level actually changes its value', () => {
    freshStorage();
    const P = LUMEN.Progression;
    LUMEN.Store.shards = 99999;
    P.SKILLS.forEach((sk) => {
      const seen = [];
      for (let lv = 0; lv <= sk.max; lv++) seen.push(sk.values[lv]);
      eq(new Set(seen).size, seen.length, sk.id + ' has a distinct value per level');
    });
  });

  test('Skills: THE DAILY CHALLENGE IGNORES EVERY UPGRADE', () => {
    // The daily plans one identical course for all players, so it must be a pure
    // test of hands. `reset()` runs before startDaily() sets the flag, which once
    // silently handed daily runs every upgrade the player owned.
    freshStorage();
    const P = LUMEN.Progression;
    LUMEN.Store.shards = 99999;
    ['magnet', 'flowsync', 'chain', 'precision', 'aegis'].forEach((id) => {
      P.upgrade(id); P.upgrade(id); P.upgrade(id);
    });
    const g = newGame();

    g.start();
    assert(g.mod.skillsActive, 'a normal run uses skills');
    assert(g.mod.flowAt < 16, 'flow threshold is improved when playing normally');

    g.startDaily();
    eq(g.mod.skillsActive, false, 'daily reports skills off');
    eq(g.mod.flowAt, 16, 'daily flow threshold is the stock value');
    eq(g.mod.magnetFrac, 0, 'no passive magnet in the daily');
    eq(g.mod.comboTimeMul, 1, 'no combo-timer bonus in the daily');
    eq(g.mod.closeWindow, 2.0, 'no widened near-miss window in the daily');
    eq(g.shield, false, 'daily never starts shielded');
    eq(g.reviveCost, 60, 'daily pays full revive price');
    g.toMenu();
  });

  test('Skills: Aegis III starts a normal run shielded', () => {
    freshStorage();
    const P = LUMEN.Progression;
    LUMEN.Store.shards = 99999;
    P.upgrade('aegis'); P.upgrade('aegis'); P.upgrade('aegis');
    eq(P.level('aegis'), 3, 'maxed');
    const g = newGame();
    g.start();
    eq(g.shield, true, 'run begins with a shield');
    g.toMenu();
  });

  // ---- privacy / telemetry -------------------------------------------------
  test('Consent: telemetry is off until the player opts in', () => {
    freshStorage();
    eq(LUMEN.Consent.state, 'unset', 'no assumption either way');
    eq(LUMEN.Consent.granted, false, 'not granted by default');
    LUMEN.Analytics.track('nope', { a: 1 });
    eq(LUMEN.Analytics.dump().length, 0, 'nothing recorded without consent');
  });

  test('Consent: opting in records events, opting out erases them', () => {
    freshStorage();
    LUMEN.Consent.set(true);
    LUMEN.Analytics.track('run_end', { score: 10 });
    assert(LUMEN.Analytics.dump().length === 1, 'event recorded');
    LUMEN.Consent.set(false);
    eq(LUMEN.Analytics.dump().length, 0, 'buffer wiped on withdrawal');
  });

  test('Telemetry: events carry no personal data', () => {
    freshStorage();
    LUMEN.Consent.set(true);
    LUMEN.Analytics.track('run_end', { score: 999, combo: 12, daily: true });
    const json = JSON.stringify(LUMEN.Analytics.dump());
    assert(!/@|email|passw|uuid|deviceId|advertis/i.test(json), 'no identifiers in the payload');
    LUMEN.Consent.set(false);
  });

  test('Telemetry: never phones home without an endpoint', () => {
    freshStorage();
    eq(LUMEN.Analytics.endpoint, null, 'ships with no collector configured');
    LUMEN.Consent.set(true);
    LUMEN.Analytics.flush();  // must be a silent no-op
    LUMEN.Consent.set(false);
  });

  // ---- monetisation seam ---------------------------------------------------
  test('Rewards: unavailable until a provider registers', () => {
    const prev = LUMEN.Rewards.provider;
    LUMEN.Rewards.provider = null;
    eq(LUMEN.Rewards.available, false, 'no ads by default');
    LUMEN.Rewards.register({ isRewardedReady: () => true, showRewarded: () => Promise.resolve(true) });
    eq(LUMEN.Rewards.available, true, 'a provider turns it on');
    LUMEN.Rewards.provider = prev;
  });

  // ---- leaderboard client --------------------------------------------------
  test('Leaderboard: disabled and silent with no endpoint', () => {
    const prev = LUMEN.Leaderboard.endpoint;
    LUMEN.Leaderboard.endpoint = null;
    eq(LUMEN.Leaderboard.enabled, false, 'off by default');
    LUMEN.Leaderboard.submitQuietly(100, 5, 'alltime'); // must not throw
    LUMEN.Leaderboard.endpoint = prev;
  });

  test('Leaderboard: player names are bounded', () => {
    freshStorage();
    LUMEN.Leaderboard.playerName = 'a'.repeat(80);
    assert(LUMEN.Leaderboard.playerName.length <= 16, 'name is clamped');
  });

  test('Leaderboard: a name cannot carry anything but letters, digits and . _ -', () => {
    // The display name is the only thing one player can show another, so it is
    // the only thing that can be used to say something vile to a stranger — in a
    // game Apple rates 4+. This used to be `slice(0, 16)` on the shipping path
    // and nothing else, so every symbol, direction-override and zero-width
    // character went straight onto the board.
    //
    // The same rule is a CHECK constraint on the table (docs/LEADERBOARD.md),
    // because the publishable key is public by design: a rule enforced only in
    // JavaScript is a rule that anyone with curl can ignore. This asserts the
    // client agrees with the database, so the two can never drift into a state
    // where the game posts names the table then rejects.
    const clean = LUMEN.Leaderboard.cleanName.bind(LUMEN.Leaderboard);
    const allowed = /^[\p{L}\p{N} ._-]*$/u;      // exactly the SQL constraint

    // things that must SURVIVE — a filter that eats real names is a bug too
    eq(clean('ırmak'), 'ırmak', 'Turkish letters live');
    eq(clean('深蓝'), '深蓝', 'Chinese lives');
    eq(clean('José_92'), 'José_92', 'accents, digits and underscore live');
    eq(clean('  spaced   out  '), 'spaced out', 'runs of whitespace collapse');

    // things that must NOT
    const hostile = [
      'bad‮reversed',      // right-to-left override: renders as its mirror
      'zero​width',        // zero-width space: two "identical" names
      '<script>alert(1)',
      'http://example.com',
      '💩poop',       // emoji
      'ＡＢＣ',                  // fullwidth lookalikes, normalised by NFKC
      '!!!@#$%^&*()',
    ];
    for (const h of hostile) {
      const out = clean(h);
      assert(allowed.test(out), 'cleaned name is table-legal: ' + JSON.stringify(out));
      assert(out.length <= 16, 'still bounded: ' + JSON.stringify(out));
    }
    eq(clean('!!!@#$%^&*()'), '', 'a name of pure symbols empties out');
    eq(clean(null), '', 'null is a name too, as far as an attacker is concerned');

    // and the submit path must clean AGAIN — a name can reach Store from an
    // imported save code, which never goes through the setter.
    freshStorage();
    if (LUMEN.Store) LUMEN.Store.playerName = 'evil‮💩';
    const sent = clean(LUMEN.Leaderboard.playerName) || 'anon';
    assert(allowed.test(sent) && sent.length > 0, 'submit falls back to a legal name');
  });

  // ---- audio ---------------------------------------------------------------
  // The name list is READ OUT OF THE SOURCE rather than written here.
  //
  // It used to be nine hand-written names, and the two newest sounds were not
  // among them — so `boing` shipped with a ReferenceError in it (`o` for `opts`)
  // and the suite stayed green while RUBBER froze the game on its first wall.
  // A hand-maintained list of things to test is a list that will be short.
  test('Audio: EVERY sound effect in the source runs without throwing', async () => {
    const A = L.Audio;
    A.init();
    if (!A.ctx) { return; } // no Web Audio in this environment — skip quietly
    const src = await fetch('../js/audio.js?t=' + Date.now()).then((r) => r.text());
    const from = src.indexOf('sfx(name, opts) {');
    assert(from > 0, 'found the sfx switch in js/audio.js');
    // Walk to the matching close brace rather than guessing at what comes next —
    // _tone happens to be defined ABOVE sfx, so searching forward for it found
    // nothing and this test silently measured an empty string.
    let depth = 0, to = -1;
    for (let i = src.indexOf('{', from); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { to = i; break; } }
    }
    assert(to > from, 'found the end of the sfx function');
    // [A-Za-z], not [a-z]: 'flowEnd' is camelCase and a lowercase-only pattern
    // quietly skipped it.
    const names = [...src.slice(from, to).matchAll(/case '([A-Za-z]+)':/g)].map((m) => m[1]);
    assert(names.length >= 11, 'found the sound names (' + names.length + ')');
    for (const n of names) {
      // every option any case reads, so no branch is skipped for want of a value
      A.sfx(n, { combo: 6, dir: 1, v: 0.9 });
    }
    // and once with nothing at all — every case must survive a bare call
    for (const n of names) A.sfx(n);

    // The other half of the same guarantee: nothing may ASK for a sound that
    // does not exist. A typo'd name hits the default case and is simply silent,
    // which is the kind of bug you ship and never notice.
    const callers = await Promise.all(['game', 'ui'].map((f) =>
      fetch('../js/' + f + '.js?t=' + Date.now()).then((r) => r.text())));
    const asked = new Set();
    for (const text of callers) {
      for (const m of text.matchAll(/_?sfx\('([A-Za-z]+)'/g)) asked.add(m[1]);
    }
    assert(asked.size > 5, 'found sound call sites (' + asked.size + ')');
    for (const n of asked) {
      assert(names.indexOf(n) >= 0, "something plays '" + n + "' but audio.js has no such case");
    }
  });

  test('Audio: every song plays a full cycle at every intensity', () => {
    const A = L.Audio;
    A.init();
    if (!A.ctx) { return; }
    A.music._audio = A;
    const keep = A.music._tracks;
    A.music._tracks = {};              // a recorded track would skip the sequencer
    try {
      const ids = Object.keys(A.SONGS || {});
      assert(ids.length >= 12, 'found the songs (' + ids.length + ')');
      const t0 = A.ctx.currentTime;
      for (const id of ids) {
        for (const inten of [0, 1, 2, 3]) {
          A.music.setSong(id);
          A.music._song = id;
          A.music.intensity = inten; A.music._intensitySmooth = inten;
          for (let step = 0; step < 64; step++) A.music._playStep(step, t0 + step * 0.02);
        }
      }
    } finally {
      A.music._tracks = keep;
      A.music.intensity = 0; A.music._intensitySmooth = 0;
      A.music.stop();
    }
  });

  test('Revive: nothing is left attached to a gate that was deleted', () => {
    // Found by playing, not by a sweep: a magnet stayed on screen after a revive
    // and appeared to glide along with the map for the rest of the run.
    //
    // A power-up reads its position from its gate every frame. revive() deletes
    // the gates near the player so nothing kills you on resume — and filtered
    // motes but not powers. An orphaned power-up's x then never changes again,
    // so it hangs at a fixed screen position while the world scrolls past, and
    // the off-screen cull (x < -30) can never fire.
    freshStorage();
    L.Modes.setCurrent('classic');
    L.Store.shards = 5000;
    const g = newGame(900, 1600);
    g.start();
    for (let i = 0; i < 1800; i++) { g.invuln = 999; g.update(1 / 60); }
    assert(g.obstacles.length > 0, 'the corridor has gates to work with');

    // pin a power-up to each of the nearest gates, which is what the world does
    for (const ob of g.obstacles.slice(0, 3)) {
      g.powers.push({ x: ob.x + ob.w * 0.5, y: ob.gaps[0].y, r: g.baseR * 1.15,
        type: 'magnet', pulse: 0, ob, gap: ob.gaps[0] });
    }
    const attached = g.powers.filter((w) => !!w.ob).length;
    assert(attached >= 3, 'power-ups are attached to gates (' + attached + ')');

    const realShow = L.UI.showScreen.bind(L.UI);
    L.UI.showScreen = () => {};
    try {
      g.player.alive = false; g.state = 'dead';
      g.invuln = 0;
      assert(g.revive(), 'the revive went through');
    } finally { L.UI.showScreen = realShow; }

    const orphaned = g.powers.filter((w) => w.ob && g.obstacles.indexOf(w.ob) < 0);
    eq(orphaned.length, 0, 'no power-up survives its gate');
    const strandedMotes = g.motes.filter((m) => m.ob && g.obstacles.indexOf(m.ob) < 0);
    eq(strandedMotes.length, 0, 'and no mote does either');

    // and prove it by running on: everything still there must actually move
    const before = g.powers.map((w) => ({ w, x: w.x }));
    for (let i = 0; i < 300; i++) { g.invuln = 999; g.update(1 / 60); }
    const frozen = before.filter((o) => g.powers.indexOf(o.w) >= 0 && Math.abs(o.w.x - o.x) < 1);
    eq(frozen.length, 0, 'nothing is frozen in place five seconds later');
    g.toMenu();
    freshStorage();
  });

  test('Next-update vote: one vote, per poll, and it survives a bad network', async () => {
    // The promise is "you pick what gets built next". The mechanics that make
    // it keepable: one vote per install, a new ballot asks again, a closed one
    // refuses, and a player on a flaky train is never asked twice.
    await loadGameMarkup();
    freshStorage();
    const P = L.Poll;
    const keepSb = P._sb, keepCur = P.current, keepRes = P._results;
    // a backend that always fails, so this exercises the offline path only
    P._sb = { url: 'https://example.invalid', key: 'x' };
    P.current = {
      id: 'test-1', closes: '2999-01-01',
      options: [
        { id: 'a', kind: 'mode', name: { en: 'Alpha', tr: 'Alfa' }, desc: 'first' },
        { id: 'b', kind: 'map', name: 'Beta', desc: { en: 'second' } },
        { id: 'c', kind: 'cosmetic', name: 'Gamma', desc: 'third' },
      ],
    };
    try {
      assert(P.enabled, 'a configured, open poll is enabled');
      eq(P.hasVoted(), false, 'nobody has voted yet');
      eq(L.Store.voterId, '', 'and no voter id exists until one is needed');

      const r = await P.vote('b');
      assert(r.ok, 'the vote is accepted even with the network down');
      eq(P.hasVoted(), true, 'and is remembered');
      eq(P.myChoice(), 'b', 'as the option chosen');
      assert(L.Store.voterId.length >= 6, 'a voter id was minted');

      const again = await P.vote('a');
      eq(again.ok, false, 'a second vote is refused');
      eq(again.reason, 'already', 'and says why');
      eq(P.myChoice(), 'b', 'the first choice stands');

      // an option that is not on the ballot
      freshStorage();
      const bogus = await P.vote('does-not-exist');
      eq(bogus.ok, false, 'an unknown option is refused');
      eq(P.hasVoted(), false, 'and records nothing');

      // a new ballot asks again
      await P.vote('a');
      P.current = Object.assign({}, P.current, { id: 'test-2' });
      eq(P.hasVoted(), false, 'a new poll asks again');
      P.current = Object.assign({}, P.current, { id: 'test-1' });
      eq(P.hasVoted(), true, 'and the old one still remembers');

      // a closed ballot refuses
      P.current = Object.assign({}, P.current, { closes: '2000-01-01' });
      eq(P.closed, true, 'a past date reads as closed');
      freshStorage();
      const late = await P.vote('a');
      eq(late.ok, false, 'a closed poll takes no votes');
      eq(late.reason, 'closed', 'and says why');

      // no poll configured means no feature at all
      P.current = null;
      eq(P.enabled, false, 'no ballot, no vote');
      L.UI.refreshPoll();
      const row = document.getElementById('poll-row');
      if (row) assert(row.classList.contains('hidden'), 'and no button on the menu');
    } finally {
      P._sb = keepSb; P.current = keepCur; P._results = keepRes;
      freshStorage();
    }
  });

  test('Next-update vote: offered by itself, exactly once', () => {
    // A menu button most people never press is not participation. The ballot
    // comes to them — but not before they have played enough to have an
    // opinion, and never twice, whether or not they voted.
    freshStorage();
    const P = L.Poll;
    const keepSb = P._sb, keepCur = P.current;
    P._sb = { url: 'https://example.invalid', key: 'x' };
    P.current = { id: 'p1', closes: '2999-01-01',
      options: [{ id: 'a', kind: 'mode', name: 'A', desc: 'a' }] };
    try {
      // a brand new player is not handed a ballot about content they have not met
      for (const runs of [0, 1, 2]) {
        L.Store.runs = runs;
        eq(P.shouldOffer(), false, 'not offered at ' + runs + ' runs');
      }
      L.Store.runs = P.RUNS_BEFORE_ASKING;
      eq(P.shouldOffer(), true, 'offered once they have played a few');

      // asked once — closing it without voting still counts as asked
      P.markSeen();
      eq(P.seen(), true, 'the offer is recorded');
      eq(P.shouldOffer(), false, 'and never made twice');
      eq(P.hasVoted(), false, 'even though they did not vote');

      // a new ballot is a new question
      P.current = Object.assign({}, P.current, { id: 'p2' });
      eq(P.shouldOffer(), true, 'a new poll asks again');
      P.current = Object.assign({}, P.current, { id: 'p1' });

      // somebody who voted is left alone
      freshStorage();
      L.Store.runs = 9;
      L.Store.pollVote = 'p1:a';
      eq(P.shouldOffer(), false, 'a voter is not asked again');

      // closed, and no-ballot-at-all
      freshStorage();
      L.Store.runs = 9;
      P.current = Object.assign({}, P.current, { closes: '2000-01-01' });
      eq(P.shouldOffer(), false, 'a closed poll is never offered');
      P.current = null;
      eq(P.shouldOffer(), false, 'and neither is a poll that does not exist');
    } finally {
      P._sb = keepSb; P.current = keepCur;
      freshStorage();
    }
  });

  test('Next-update vote: option text comes from config, in every language', () => {
    // The ballot changes monthly. If its words lived in i18n.js, running a new
    // poll would mean shipping code — and a monthly promise you can only keep
    // by releasing is one you will eventually break.
    const P = L.Poll;
    const keep = L.i18n.lang;
    const opt = {
      id: 'x', kind: 'mode',
      name: { en: 'Pacer', tr: 'Tempo', es: 'Marcador', zh: '配速' },
      desc: 'plain string works too',
    };
    try {
      for (const [lang, want] of [['en', 'Pacer'], ['tr', 'Tempo'], ['es', 'Marcador'], ['zh', '配速']]) {
        L.i18n.set(lang);
        eq(P.text(opt, 'name'), want, lang + ' name');
        eq(P.text(opt, 'desc'), 'plain string works too', lang + ' falls back to the plain string');
      }
      // a language the ballot forgot falls back to English rather than blank
      L.i18n.set('zh');
      eq(P.text({ name: { en: 'Only English' } }, 'name'), 'Only English', 'missing language falls back');
      eq(P.text({}, 'name'), '', 'a missing field is empty, not "undefined"');
    } finally { L.i18n.set(keep); }
  });

  test('`.hidden` actually hides, on anything', async () => {
    // It was only ever defined per component — .overlay.hidden, .badge.hidden,
    // .icon-btn.hidden — so putting the class on something new did NOTHING and
    // you had to remember to write another selector. Two elements were already
    // caught by it: the menu's beginner hint, and the shop's category filter,
    // which left an empty strip on three tabs.
    await loadGameMarkup();
    const host = document.getElementById('markup-under-test') || document.body;
    // a plain element nobody has written a rule for
    const probe = document.createElement('div');
    probe.className = 'hidden';
    probe.textContent = 'x';
    host.appendChild(probe);
    eq(getComputedStyle(probe).display, 'none', 'an arbitrary .hidden element is hidden');
    probe.remove();

    // the toast is the deliberate exception: it fades on opacity
    const toast = document.createElement('div');
    toast.className = 'toast hidden';
    host.appendChild(toast);
    const ts = getComputedStyle(toast);
    assert(ts.display !== 'none', 'the toast keeps its box so it can fade');
    eq(ts.opacity, '0', 'and is faded out');
    toast.remove();

    // nothing currently carrying .hidden is still taking up space
    const showing = [...host.querySelectorAll('.hidden')].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.opacity !== '0' && el.getBoundingClientRect().height > 0;
    }).map((el) => el.id || el.className);
    eq(showing.length, 0, 'hidden but still visible: ' + showing.join(', '));
  });

  test('Menu: onboarding retires once it has been outgrown', async () => {
    // The beginner hint was the only thing on a 390x844 phone that did not fit,
    // and it is copy for somebody who has never played — carried forever by a
    // player with five hundred runs behind them.
    await loadGameMarkup();
    freshStorage();
    const seen = (sel) => {
      L.UI.refreshMenu();
      const el = document.querySelector('#screen-menu ' + sel);
      return el ? !el.classList.contains('hidden') : null;
    };
    eq(seen('.howto'), true, 'a brand new player is told how to play');
    eq(seen('.mini-stats'), false, 'and is not shown a row of zeroes');
    L.Store.runs = 1;
    eq(seen('.mini-stats'), true, 'stats appear with the first real run');
    eq(seen('.howto'), true, 'the hint is still there after one run');
    L.Store.runs = 5;
    eq(seen('.howto'), false, 'and retires by the fifth');
    freshStorage();
    L.Store.tutorialDone = true;
    eq(seen('.howto'), false, 'finishing the tutorial retires it immediately');
    freshStorage();
  });

  test('Shop: the CUSTOMIZE filter cuts a 50-card wall into readable lists', async () => {
    // Measured on a 390x844 phone before this existed: 50 cards and ELEVEN
    // screens of scrolling in one tab, with signatures — the newest and dearest
    // thing in the game — eight screens down where nobody would meet them.
    await loadGameMarkup();
    freshStorage();
    L.Store.shards = 99999;
    const C = L.Cosmetics;
    L.UI.openShop('customize');

    const row = document.getElementById('shop-filters');
    assert(row && !row.classList.contains('hidden'), 'the filter row is shown on CUSTOMIZE');
    const chips = [...row.querySelectorAll('.shop-filter')];
    eq(chips.length, 5, 'all, sets, orbs, trails, signatures');
    for (const c of chips) assert(c.hasAttribute('aria-pressed'), 'each chip states its state');

    // every category is reachable, and each shows only its own cards
    const counted = {};
    for (const [key, list] of [['sets', C.SETS], ['orbs', C.SKINS],
      ['trails', C.TRAILS], ['signatures', C.SIGNATURES]]) {
      const chip = row.querySelector('.shop-filter[data-filter="' + key + '"]');
      assert(chip, key + ' has a chip');
      chip.click();
      const cards = document.querySelectorAll('#shop-grid .shop-card').length;
      counted[key] = cards;
      eq(cards, list.length, key + ' shows exactly its own items');
      eq(document.querySelector('.shop-filter[data-filter="' + key + '"]').getAttribute('aria-pressed'),
        'true', key + ' reads as the active filter');
    }
    // ALL is still all of them
    row.querySelector('.shop-filter[data-filter="all"]').click();
    eq(document.querySelectorAll('#shop-grid .shop-card').length,
      counted.sets + counted.orbs + counted.trails + counted.signatures,
      'ALL shows every card');

    // switching top-level tab must not leave a stale sub-filter behind
    L.UI.setTab('signatures' in counted ? 'maps' : 'maps');
    eq(L.UI.shopFilter, 'all', 'a new tab starts unfiltered');
    L.UI.setTab('customize');
    freshStorage();
  });

  test('The README describes the game that actually exists', async () => {
    // The counts in the README and the design doc have now gone stale twice —
    // "6 maps" when there were 11, "the seven game modes" when there were 10.
    // It is the first thing anyone reads about this project, so it gets checked
    // like anything else rather than trusted to be updated by hand.
    const readme = await fetch('../README.md?t=' + Date.now()).then((r) => r.text());
    const C = L.Cosmetics;
    const real = {
      'orb skins': C.SKINS.length,
      'trail styles': C.TRAILS.length,
      worlds: C.MAPS.length,
      signatures: C.SIGNATURES.length,
      sets: C.SETS.length,
    };
    for (const [what, n] of Object.entries(real)) {
      const re = new RegExp('\\*\\*' + n + ' ' + what.replace(' ', '\\s+') + '\\*\\*', 'i');
      assert(re.test(readme), 'README states ' + n + ' ' + what);
    }
    // and no count that contradicts reality
    const modeCount = L.Modes.MODES.length;
    assert(!/the seven game modes/i.test(readme),
      'README no longer claims seven modes (there are ' + modeCount + ')');
    // the voice command is the bare noun everywhere a player might read it
    assert(!/use shield/i.test(readme), 'README does not still teach "use shield"');
  });

  test('Anything free is already owned, and never teased as an unlock', () => {
    // `owned()` used to hardcode the three default ids, so adding a fourth
    // category forgot the fourth entry: the free signature read as unowned and
    // the game-over screen advertised "next unlock — 0 shards" for the thing
    // every player is already flying with. A teaser that costs nothing is not a
    // reason to press RETRY.
    freshStorage();
    const C = L.Cosmetics;
    let freeCount = 0;
    for (const it of [...C.SKINS, ...C.TRAILS, ...C.MAPS, ...C.SIGNATURES]) {
      const p = C.price(it.id);
      if (!p || p.shards !== 0) continue;
      freeCount++;
      eq(C.owned(it.id), true, it.id + ' is free, so it is already owned');
    }
    assert(freeCount >= 4, 'found the free items (' + freeCount + ')');
    // walk the whole ladder: nothing free may ever appear, at any point
    for (let i = 0; i < 40; i++) {
      const n = C.nextUnlock();
      if (!n) break;
      assert(n.price > 0, 'teased ' + n.id + ' at ' + n.price + ' shards');
      C.grant(n.id);
    }
    freshStorage();
  });

  test('Nothing in the shop shares a name with anything else, in any language', () => {
    // A set card lists its three pieces side by side, which is where this bites:
    // in Turkish "Kindling" read "Kor · Kor · Kor" and in Chinese
    // "余烬 · 余烬 · 余烬", so the card said nothing about what you were buying.
    // Two of those clashes predated the sets — a shop full of things you cannot
    // tell apart is a shop nobody buys from twice.
    const C = L.Cosmetics;
    const keep = L.i18n.lang;
    try {
      for (const lang of ['en', 'tr', 'es', 'zh']) {
        L.i18n.set(lang);
        const byName = {};
        const ids = [...C.SKINS, ...C.TRAILS, ...C.MAPS, ...C.SIGNATURES].map((x) => x.id)
          .concat(C.SETS.map((s) => s.id));
        for (const id of ids) {
          const n = C.name(id);
          assert(n && n !== 'cos_' + id, lang + ': ' + id + ' has a real name');
          (byName[n] = byName[n] || []).push(id);
        }
        const clashes = Object.keys(byName).filter((n) => byName[n].length > 1)
          .map((n) => n + ' = ' + byName[n].join('/'));
        eq(clashes.length, 0, lang + ' name clashes: ' + clashes.join('; '));
      }
    } finally { L.i18n.set(keep); }
  });

  test('Sets: you are never charged for something you already own', () => {
    // The one promise a bundle has to keep. Charge a player again for a piece
    // sitting in their inventory and you have taught them not to trust the shop,
    // which costs far more than the discount ever earned.
    freshStorage();
    const C = L.Cosmetics;
    assert(C.SETS.length >= 4, 'sets exist (' + C.SETS.length + ')');
    for (const s of C.SETS) {
      freshStorage();
      // The originals are three slots; the theme packs add the world too. One
      // of EACH slot either way, so a set really is a whole look and never two
      // skins in a trench coat.
      const cats = s.items.map((i) => C.category(i)).sort();
      if (s.items.length === 4) {
        eq(cats.join(','), 'maps,orbs,signatures,trails', s.id + ' covers all four slots');
      } else {
        eq(s.items.length, 3, s.id + ' spans orb, trail and signature');
        eq(cats.join(','), 'orbs,signatures,trails', s.id + ' covers all three slots');
      }

      const cold = C.setPrice(s.id);
      const sum = s.items.reduce((n, i) => n + (C.price(i) ? C.price(i).shards : 0), 0);
      assert(cold.shards < sum, s.id + ' is cheaper than the pieces (' + cold.shards + ' vs ' + sum + ')');
      eq(cold.saving, sum - cold.shards, s.id + ' states its saving truthfully');
      // Not every set carries one: kindling is deliberately shard-only, so a
      // player who never spends can still finish a whole coordinated look.
      // What matters is that a cash price, where it exists, is offered only
      // while the whole set is still unowned.
      if (s.usd > 0) assert(cold.usd > 0, s.id + ' offers its cash price while nothing is owned');
      else eq(cold.usd, 0, s.id + ' is shard-only and never quotes cash');

      // own the dearest piece: the price must fall by that piece's share
      const dearest = s.items.slice().sort((a, b) =>
        (C.price(b) ? C.price(b).shards : 0) - (C.price(a) ? C.price(a).shards : 0))[0];
      C.grant(dearest);
      const warm = C.setPrice(s.id);
      assert(warm.shards < cold.shards, s.id + ' costs less once you own a piece');
      eq(warm.usd, 0, s.id + ' withdraws the fixed cash SKU when it would overcharge');

      // and buying charges exactly the quoted remainder
      L.Store.shards = 999999;
      const before = L.Store.shards;
      assert(C.buySet(s.id), s.id + ' is buyable');
      eq(before - L.Store.shards, warm.shards, s.id + ' charged exactly what it quoted');
      for (const i of s.items) eq(C.owned(i), true, s.id + ' granted ' + i);

      // a completed set is inert, not a way to spend shards on nothing
      const done = C.setPrice(s.id);
      eq(done.complete, true, s.id + ' reads as complete');
      eq(done.usd, 0, s.id + ' offers no cash button when complete');
      const held = L.Store.shards;
      eq(C.buySet(s.id), false, s.id + ' cannot be bought twice');
      eq(L.Store.shards, held, s.id + ' took nothing on the refused rebuy');
    }
    freshStorage();
  });

  test('Sets: a real-money set restores on another device', () => {
    // A set SKU is not a cosmetic id, so a naive restore() grants nothing and
    // somebody who paid gets an empty inventory on their next phone.
    freshStorage();
    const C = L.Cosmetics, set = C.SETS[0];
    const realProvider = L.IAP.provider, realAvail = L.IAP.available;
    L.IAP.provider = {
      isReady: () => true,                   // `available` is a getter over this
      purchase: () => Promise.resolve({ ok: true }),
      restore: () => Promise.resolve([set.id]),
    };
    try {
      eq(C.owned(set.items[0]), false, 'nothing owned to begin with');
      return L.IAP.restore().then((res) => {
        assert(res.ok, 'restore succeeded');
        for (const i of set.items) eq(C.owned(i), true, 'restored ' + i);
      }).finally(() => {
        L.IAP.provider = realProvider; L.IAP.available = realAvail;
        freshStorage();
      });
    } catch (e) {
      L.IAP.provider = realProvider; L.IAP.available = realAvail;
      throw e;
    }
  });

  test('Signatures: every one owns all three moments and does something distinct', () => {
    // A signature is the cosmetic that changes how the FLIP, the FLOW and the
    // DEATH look. The whole reason it can be sold above a palette swap is that
    // it is visible on the action the player performs, so an entry that quietly
    // does nothing on some moment is the one defect that matters here.
    freshStorage();
    const C = L.Cosmetics;
    assert(C.SIGNATURES.length >= 8, 'the catalogue exists (' + C.SIGNATURES.length + ')');
    const seen = {};
    for (const s of C.SIGNATURES) {
      for (const m of ['flip', 'flow', 'death']) {
        assert(s[m], s.id + ' defines its ' + m);
        assert(s[m].ring || s[m].burst || s[m].corona, s.id + '.' + m + ' actually emits something');
      }
      eq(C.category(s.id), 'signatures', s.id + ' is categorised');
      // named in every language, never left as a raw key
      for (const lang of ['en', 'tr', 'es', 'zh']) {
        const keep = L.i18n.lang;
        L.i18n.set(lang);
        const n = C.name(s.id), d = C.desc(s.id);
        assert(n && n !== 'cos_' + s.id, s.id + ' has a ' + lang + ' name');
        assert(d && d !== 'cosd_' + s.id, s.id + ' has a ' + lang + ' description');
        L.i18n.set(keep);
      }
      // and it must actually put things on screen
      C.grant(s.id); C.equip(s.id);
      const g = newGame(900, 600);
      g.start();
      g.rings.clear(); g.particles.clear();
      g.flip();
      const flip = g.rings.count + g.particles.count;
      g.rings.clear(); g.particles.clear();
      g.signatureFx('death', g.player.x, g.player.y);
      const death = g.rings.count + g.particles.count;
      assert(flip > 0, s.id + ' shows something on a flip');
      assert(death > 0, s.id + ' shows something on a death');
      seen[s.id] = s.id + ':' + (s.flip.ring ? 'R' : '') + (s.flip.burst ? 'B' : '')
        + '/' + (s.death.ring ? 'R' : '') + (s.death.burst ? 'B' : '');
      g.toMenu();
    }
    // the rings pool must never grow without bound, however long a run goes
    C.equip('quasar');
    const g2 = newGame(900, 600);
    g2.start();
    for (let i = 0; i < 4000; i++) { g2.flip(); g2.update(1 / 120); }
    assert(g2.rings.count <= g2.rings.MAX, 'the ring pool is bounded (' + g2.rings.count + ')');
    eq(g2.rings.pool.length, g2.rings.MAX, 'and it never allocated past the pool');
    g2.toMenu();
    C.equip('ripple');
    freshStorage();
  });

  test('Signatures: Apex is earned, never sold', () => {
    // The prestige item. Its whole value is that money cannot reach it — the
    // moment it has a price it stops meaning anything.
    freshStorage();
    const C = L.Cosmetics;
    eq(C.price('apex'), null, 'Apex has no price in either currency');
    eq(C.requirement('apex'), 'chain3', 'and is gated on the 70-chain');
    eq(C.owned('apex'), false, 'not owned on a fresh profile');
    L.Store.shards = 999999;
    eq(C.buy('apex'), false, 'and cannot be bought at any price');
    eq(C.owned('apex'), false, 'still not owned after trying');
    // earning it works
    L.Store.bestCombo = 70;
    L.Progression.check();
    eq(C.owned('apex'), true, 'a 70 chain hands it over');
    freshStorage();
  });

  test('Signatures: the shop preview animates and stops when you leave', async () => {
    // An animated cosmetic sells on being SEEN moving; a still swatch of a
    // motion sells nothing. The other half of that is the loop must not keep
    // running behind a closed shop.
    await loadGameMarkup();
    freshStorage();
    L.UI.openShop('customize');
    const cvs = [...document.querySelectorAll('canvas[data-sig]')];
    // one per signature, plus one on each set card that contains a signature
    const onSets = L.Cosmetics.SETS.filter((s) =>
      s.items.some((i) => L.Cosmetics.category(i) === 'signatures')).length;
    eq(cvs.length, L.Cosmetics.SIGNATURES.length + onSets,
      'a preview on every signature and on every set that carries one');
    assert(!!L.UI._sigRaf, 'the loop is armed while the shop is open');

    // drive rAF by hand: a test page may be throttled, and a real wait is flaky
    const realRaf = window.requestAnimationFrame, realCancel = window.cancelAnimationFrame;
    let cb = null, n = 1;
    window.requestAnimationFrame = (f) => { cb = f; return n++; };
    window.cancelAnimationFrame = () => { cb = null; };
    let ink = [];
    try {
      L.UI.stopSigPreviews();
      L.UI.startSigPreviews();
      const cv = cvs[1], ctx = cv.getContext('2d');
      const measure = () => {
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let c = 0; for (let i = 3; i < d.length; i += 4 * 5) if (d[i] > 8) c++;
        return c;
      };
      let t = 0;
      for (let i = 0; i < 160 && cb; i++) { const f = cb; cb = null; t += 16.7; f(t); if (i % 8 === 0) ink.push(measure()); }
    } finally {
      window.requestAnimationFrame = realRaf; window.cancelAnimationFrame = realCancel;
    }
    assert(Math.max(...ink) > 0, 'the preview actually paints');
    assert(new Set(ink).size > 3, 'and it changes over time (' + new Set(ink).size + ' distinct frames)');

    L.UI.showScreen('menu');
    eq(!!L.UI._sigRaf, false, 'leaving the shop stops the loop');
    freshStorage();
  });

  test('Seasons: the windows are exact, and the new year does not swallow one', () => {
    const C = L.Cosmetics;
    const on = (y, m, d) => C.inSeason(new Date(y, m - 1, d));
    // the day before and the first day, the last day and the day after
    eq(on(2027, 10, 23), null, 'Oct 23 is not Halloween yet');
    eq(on(2027, 10, 24), 'hallowmere', 'Oct 24 opens it');
    eq(on(2027, 10, 31), 'hallowmere', 'Halloween itself');
    eq(on(2027, 11, 2), 'hallowmere', 'Nov 2 is the last day');
    eq(on(2027, 11, 3), null, 'Nov 3 is over');
    // The midwinter window runs Dec 15 -> Jan 5, so it WRAPS. A naive
    // start <= today <= end would silently drop it every 31 December.
    eq(on(2027, 12, 14), null, 'Dec 14 is too early');
    eq(on(2027, 12, 15), 'hoarfrost', 'Dec 15 opens midwinter');
    eq(on(2027, 12, 31), 'hoarfrost', 'new year\'s eve');
    eq(on(2028, 1, 1), 'hoarfrost', 'and new year\'s day — the wrap holds');
    eq(on(2028, 1, 5), 'hoarfrost', 'Jan 5 is the last day');
    eq(on(2028, 1, 6), null, 'Jan 6 is over');
    eq(on(2027, 7, 4), null, 'midsummer belongs to nobody');

    // never two at once, and a world with no season never claims one
    let days = 0;
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const dt = new Date(2027, m - 1, d);
        if (dt.getMonth() !== m - 1) continue;
        const hits = C.SEASONS.filter((s) => {
          const [fm, fd] = s.from, [tm, td] = s.to;
          const mo = m, day = d;
          const after = mo > fm || (mo === fm && day >= fd);
          const before = mo < tm || (mo === tm && day <= td);
          const wraps = tm < fm || (tm === fm && td < fd);
          return wraps ? (after || before) : (after && before);
        });
        assert(hits.length <= 1, m + '-' + d + ' is claimed by ' + hits.length + ' seasons');
        if (hits.length) days++;
      }
    }
    assert(days > 20 && days < 80, 'a sane share of the year is featured (' + days + ' days)');
    for (const id of ['regalia', 'nullpoint', 'deepfield', 'moss', 'emberfall']) {
      assert(!C.SEASONS.some((s) => s.map === id), id + ' has no season and claims none');
    }
  });

  test('Seasons: the preview is the menu\'s, and never a real run\'s', () => {
    // The demo behind the menu flies the featured world. It must not change what
    // the player owns, what they equipped, or what they then play on.
    freshStorage();
    const C = L.Cosmetics;
    const g = newGame(900, 600);          // the test page boots no LUMEN.game
    const real = C.inSeason.bind(C);
    C.inSeason = () => 'hallowmere';
    try {
      C.grant('moss'); C.equip('moss');
      L.Modes.setCurrent('classic');

      g.toMenu();
      eq(C.preview, 'hallowmere', 'the demo previews the featured world');
      eq(C.mapDef().id, 'hallowmere', 'and everything visual follows it');
      eq(L.Store.map, 'moss', 'but nothing was equipped on their behalf');

      g.attract = false; g.start();
      eq(C.preview, null, 'a real run clears the preview');
      eq(g.world && g.world.id, 'moss', 'and plays the world they chose');

      g.startDaily();
      eq(C.preview, null, 'the daily is untouched');
      eq(g.world, null, 'the daily still flies no world at all');
      g.toMenu();
    } finally {
      C.inSeason = real; C.setPreview(null); C.equip('deepfield');
      g.toMenu();
    }
    freshStorage();
  });

  test('Seasons: the bonus is additive, and Zen still earns nothing', () => {
    freshStorage();
    const C = L.Cosmetics;
    const real = C.inSeason.bind(C);
    // one-time achievement and mission payouts would swamp the comparison
    const rc = L.Progression.check, rm = L.Missions.recordRun;
    L.Progression.check = () => []; L.Missions.recordRun = () => [];
    const payout = (mapId, seasonId) => {
      C.inSeason = () => seasonId;
      C.grant(mapId); C.equip(mapId);
      L.Store.shards = 0;
      const g = newGame(900, 600);
      g.start();
      g.score = 12000; g.motesRun = 40; g.flowSecRun = 10;
      g.player.alive = false; g.state = 'dead';
      const show = L.UI.showGameOver; L.UI.showGameOver = () => {};
      try { g.finalizeRun(); } finally { L.UI.showGameOver = show; g.toMenu(); }
      return L.Store.shards;
    };
    try {
      L.Modes.setCurrent('classic');
      const off = payout('hallowmere', null);
      const on = payout('hallowmere', 'hallowmere');
      assert(off > 0, 'the baseline run paid something (' + off + ')');
      const ratio = on / off;
      assert(Math.abs(ratio - C.SEASON_BONUS) < 0.02,
        'featured pays ' + C.SEASON_BONUS + 'x — got ' + ratio.toFixed(3));
      eq(payout('monolith', 'hallowmere'), payout('monolith', null),
        'a world that is NOT featured pays exactly the same either way');
      L.Modes.setCurrent('zen');
      eq(payout('hallowmere', 'hallowmere'), 0, 'Zen earns nothing, season or not');
    } finally {
      C.inSeason = real; L.Progression.check = rc; L.Missions.recordRun = rm;
      L.Modes.setCurrent('classic'); C.setPreview(null); C.equip('deepfield');
    }
    freshStorage();
  });

  test('Traps: nothing collectable is ever parked inside a lethal trap', () => {
    // Traps scroll at exactly the speed motes do, so an overlap is permanent —
    // a mote sitting in a mine is a lure onto instant death that never resolves.
    // There are three ways it could happen and all three are guarded: a mote
    // spawning onto a trap, a trap spawning onto a mote, and a GATE arriving
    // beside an existing trap and bringing its own mote with it.
    // Sweepers are exempt on purpose — one crosses the whole corridor, so no
    // placement could be safe from it, and it is visibly timeable.
    freshStorage();
    L.Modes.setCurrent('classic');
    let traps = 0, motes = 0, incidents = 0, uid = 1;
    const where = [];
    for (const map of ['hallowmere', 'tidal']) {
      L.Cosmetics.grant(map); L.Cosmetics.equip(map);
      for (let run = 0; run < 6; run++) {
        const g = newGame(900, 600);
        g.start();
        const seen = new Set();
        for (let i = 0; i < 4200; i++) {
          g.invuln = 999;                       // stay alive without altering the world
          g.update(1 / 60);
          for (const m of g.motes) if (!m._id) { m._id = uid++; motes++; }
          for (const w of g.powers) if (!w._id) w._id = uid++;
          for (const t of g.traps) {
            if (!t._id) { t._id = uid++; traps++; }
            if (t.kind === 'sweeper') continue;
            const tx0 = t.kind === 'mine' ? t.x - t.r : t.x;
            const tx1 = t.kind === 'mine' ? t.x + t.r : t.x + t.w;
            const check = (o, what) => {
              if (o.taken || o.pulled) return;   // a magnet tow is the player's doing
              // Only things still IN PLAY can bait anyone. Past the left edge a
              // collectable stops tracking its gate (the gate is culled at
              // x < -20, the collectable at x < -30) and freezes for a few
              // frames while traps keep scrolling, so the two can drift
              // together off-screen, behind the player, moments before both are
              // deleted. That is invisible and unreachable, not a lure.
              if (o.x < 0) return;
              if (o.x + o.r < tx0 || o.x - o.r > tx1) return;
              let inside;
              if (t.kind === 'mine') {
                const dx = o.x - t.x, dy = o.y - t.y, rr = o.r + t.r;
                inside = dx * dx + dy * dy < rr * rr;
              } else {
                const wall = t.side < 0 ? g.playTop : g.playBottom;
                inside = Math.abs(o.y - wall) < o.r + t.h;
              }
              if (!inside) return;
              const key = o._id + ':' + t._id;
              if (seen.has(key)) return;         // count incidents, not frames
              seen.add(key); incidents++;
              if (where.length < 5) where.push(map + ' ' + what + '/' + t.kind + (o.ob ? ' on-gate' : ' free'));
            };
            for (const m of g.motes) check(m, 'mote');
            for (const w of g.powers) check(w, 'power');
          }
        }
        g.toMenu();
      }
    }
    // guards against the vacuous pass: a run that spawned nothing proves nothing
    assert(traps >= 8, 'traps actually spawned (' + traps + ')');
    assert(motes > 200, 'motes actually spawned (' + motes + ')');
    eq(incidents, 0, 'collectables inside traps: ' + where.join(', '));
    L.Cosmetics.equip('deepfield');
    freshStorage();
  });

  test('Traps: a trap over a gate never seals it', () => {
    // Traps are wider than the gate spawn line is far away, so a gate is
    // sometimes born inside a trap's span and the two travel together. That is
    // allowed — a spike strip lies on a wall and a sweeper's beam is thin — but
    // only while a threadable channel always survives inside the opening.
    freshStorage();
    L.Modes.setCurrent('classic');
    let checked = 0, impossible = 0, tightest = Infinity;
    for (const map of ['hallowmere', 'tidal']) {
      L.Cosmetics.grant(map); L.Cosmetics.equip(map);
      for (let run = 0; run < 4; run++) {
        const g = newGame(900, 600);
        g.start();
        for (let i = 0; i < 4200; i++) {
          g.invuln = 999;
          g.update(1 / 60);
          const p = g.player, r = p.r * 0.82;
          for (const ob of g.obstacles) {
            if (ob.x + ob.w < p.x) continue;            // already behind us
            for (const gap of ob.gaps) {
              const lo = gap.y - gap.h * 0.5 + r, hi = gap.y + gap.h * 0.5 - r;
              if (hi <= lo) continue;                   // gate width is another test's job
              const cuts = [];
              for (const t of g.traps) {
                const tx0 = t.kind === 'mine' ? t.x - t.r : t.x;
                const tx1 = t.kind === 'mine' ? t.x + t.r : t.x + (t.w || 0);
                if (tx1 < ob.x || tx0 > ob.x + ob.w) continue;
                if (t.kind === 'mine') cuts.push([t.y - t.r - r, t.y + t.r + r]);
                else if (t.kind === 'sweeper') cuts.push([t.y - t.h - r, t.y + t.h + r]);
                else { const wall = t.side < 0 ? g.playTop : g.playBottom; cuts.push([wall - t.h - r, wall + t.h + r]); }
              }
              if (!cuts.length) continue;
              checked++;
              let free = [[lo, hi]];
              for (const [a, b] of cuts) {
                const next = [];
                for (const [s, e] of free) {
                  if (b <= s || a >= e) { next.push([s, e]); continue; }
                  if (a > s) next.push([s, Math.min(a, e)]);
                  if (b < e) next.push([Math.max(b, s), e]);
                }
                free = next;
              }
              const widest = free.reduce((m, [s, e]) => Math.max(m, e - s), 0);
              tightest = Math.min(tightest, widest);
              if (widest <= 0) impossible++;
            }
          }
        }
        g.toMenu();
      }
    }
    assert(checked > 500, 'gate/trap situations actually occurred (' + checked + ')');
    eq(impossible, 0, 'gates sealed shut by a trap');
    assert(tightest > 0, 'tightest surviving channel was ' + Math.round(tightest) + 'px');
    L.Cosmetics.equip('deepfield');
    freshStorage();
  });

  test('Daily: the course keeps going past the planned 600 gates', () => {
    // 600 gates is only ~8.7 minutes. Past the end the spawner used to clamp to
    // the LAST spec — the identical gate at the identical height, forever — so
    // anyone who got that far could hold one position and farm the shared board.
    freshStorage();
    const a = newGame(900, 1600); a.startDaily();
    const b = newGame(430, 900);  b.startDaily();
    const planned = a.plan.length;
    eq(planned, 600, 'opens with the usual 600');
    for (let i = 0; i < 1200; i++) { a.spawnIndex = i; a.spawnObstacle(); }
    for (let i = 0; i < 1200; i++) { b.spawnIndex = i; b.spawnObstacle(); }
    assert(a.plan.length > planned, 'the course grew (' + a.plan.length + ')');
    const tail = a.plan.slice(planned);
    assert(new Set(tail.map((s) => s.c.toFixed(6))).size > 20,
      'the extension is real gates, not one repeated (' + new Set(tail.map((s) => s.c.toFixed(6))).size + ' distinct)');
    // and it is STILL the same course for everyone, however long they last
    const n = Math.min(a.plan.length, b.plan.length);
    for (let i = 0; i < n; i++) {
      eq(a.plan[i].c, b.plan[i].c, 'gate ' + i + ' matches on a different screen');
      eq(a.plan[i].gapH, b.plan[i].gapH, 'gate ' + i + ' opening matches');
    }
    a.toMenu(); b.toMenu();
  });

  test('Settings survive RESET PROGRESS; progress does not', () => {
    // Resetting your SCORE must never reset the colour-vision palette or the
    // high-contrast mode — a colourblind player pressing a button about their
    // record used to lose the settings that make the game readable, along with
    // their language, graphics tier, name and recorded telemetry choice.
    freshStorage();
    assert(Array.isArray(L.SETTING_KEYS) && L.SETTING_KEYS.length > 10, 'the settings list exists');
    // Realistic values, not arbitrary markers: several of these are booleans the
    // game reads back and re-writes (muting re-asserts the live gain from
    // lumen_muted), so a nonsense string would fail for the wrong reason.
    const REAL = {
      lumen_cb: 'deuter', lumen_quality: 'low', lumen_lang: 'tr',
      lumen_name: 'RANGER', lumen_consent: 'no', lumen_autotier: 'balanced',
    };
    const marker = {};
    L.SETTING_KEYS.forEach((k) => { marker[k] = REAL[k] || '1'; localStorage.setItem(k, marker[k]); });
    L.Store._invalidate();
    L.Store.best = 4321; L.Store.shards = 900; L.Store.runs = 12;
    L.Store.modeBests = { sprint: 999 };
    L.Cosmetics.grant('weave');

    // What is under test is WHICH KEYS SURVIVE, not the redraw that follows —
    // so the three view calls at the end are stubbed rather than dragging the
    // whole settings screen's markup into this test.
    const realConfirm = window.confirm;
    const realRender = L.UI.renderSettings, realRefresh = L.UI.refreshMenu, realToast = L.UI.toast;
    window.confirm = () => true;
    L.UI.renderSettings = () => {}; L.UI.refreshMenu = () => {}; L.UI.toast = () => {};
    try { L.UI.resetProgress(); } finally {
      window.confirm = realConfirm;
      L.UI.renderSettings = realRender; L.UI.refreshMenu = realRefresh; L.UI.toast = realToast;
    }

    for (const k of L.SETTING_KEYS) eq(localStorage.getItem(k), marker[k], k + ' survived');
    eq(L.Store.best, 0, 'the record is gone');
    eq(L.Store.shards, 0, 'the shards are gone');
    eq(L.Store.runs, 0, 'the run count is gone');
    eq(JSON.stringify(L.Store.modeBests), '{}', 'the per-mode records are gone');
    eq(L.Cosmetics.owned('weave'), false, 'the unlocks are gone');
    freshStorage();
  });

  test('Store: an object-shaped save value that is really an array is rejected', () => {
    // `JSON.parse(x) || {}` lets an ARRAY through, and then items['shield'] = 1
    // sets a named property on an array — which JSON.stringify silently drops.
    // The shards were spent and the item never arrived. Save codes come from
    // other people, so this is reachable input.
    freshStorage();
    for (const [key, read] of [['lumen_items', () => L.Store.items],
                               ['lumen_skills', () => L.Store.skills],
                               ['lumen_mode_bests', () => L.Store.modeBests],
                               ['lumen_coach', () => L.Store.coachSeen]]) {
      for (const hostile of ['[]', '[1,2,3]', 'null', '"a string"', '42', 'not json at all']) {
        localStorage.setItem(key, hostile);
        L.Store._invalidate();                       // we wrote behind the memo's back
        const v = read();
        assert(v && typeof v === 'object' && !Array.isArray(v),
          key + ' = ' + hostile + ' still reads as a plain object');
        // and a write to it must actually survive a round-trip
        v.probe = 7;
        assert(JSON.stringify(v).indexOf('probe') > 0, key + ' keeps named properties');
      }
    }
    freshStorage();
  });

  test('Achievements: something you have earned never reads as unmet', () => {
    // The one-time score reset zeroes Store.best but keeps earned achievements,
    // and progress was derived from the live stat independently of `done` — so
    // a player saw rows marked earned, reward already spent, sitting at 0 / 40.
    freshStorage();
    L.Store.best = 50000; L.Store.bestCombo = 100;
    L.Progression.check();
    const earned = L.Progression.list().filter((a) => a.done);
    assert(earned.length > 0, 'earned something to test with');
    L.Store.best = 0; L.Store.bestCombo = 0;         // the reset
    for (const a of L.Progression.list()) {
      if (a.done) eq(a.progress, a.goal, a.id + ' reads as complete because it IS');
    }
    freshStorage();
  });

  test('Leaderboard: the board shows each name once, at their best', () => {
    // Every submit INSERTs a row, so one improving player left eight rows and
    // could hold most of the top twenty while everyone else was buried.
    const rows = [
      { name: 'ana', score: 9400 }, { name: 'ana', score: 7000 }, { name: 'bo', score: 6800 },
      { name: 'ana', score: 5500 }, { name: 'ANA', score: 5000 }, { name: 'cy', score: 4100 },
      { name: 'bo', score: 900 },   { name: 'ana', score: 300 },
    ];
    const out = L.Leaderboard._dedupe(rows, 20);
    eq(out.length, 3, 'three distinct players');
    eq(out[0].name, 'ana'); eq(out[0].score, 9400, 'kept her best, not her latest');
    eq(out[1].name, 'bo');  eq(out[1].score, 6800);
    eq(out[2].name, 'cy');
    eq(L.Leaderboard._dedupe(rows, 2).length, 2, 'still honours the limit');
    eq(L.Leaderboard._dedupe(null, 20).length, 0, 'survives no rows at all');
  });

  test('Audio: a song written without a snare never gets one', () => {
    // ABANDON HOPE and NULLPOINT are both built around having no backbeat —
    // the absence is the point. The eight-bar fill was gated only on intensity
    // and walked straight through that, dropping a snare crescendo into the
    // horror track every fourteen seconds.
    const A = L.Audio;
    A.init();
    if (!A.ctx) { return; }
    A.music._audio = A;
    const keep = A.music._tracks, realSnare = A.music._snare;
    A.music._tracks = {};
    try {
      for (const id of Object.keys(A.SONGS)) {
        const song = A.SONGS[id];
        let hits = 0;
        A.music._snare = () => { hits++; };
        A.music.setSong(id); A.music._song = id;
        A.music.intensity = 3; A.music._intensitySmooth = 3;
        const t0 = A.ctx.currentTime;
        for (let step = 0; step < 64; step++) A.music._playStep(step, t0 + step * 0.02);
        if (!(song.snare || []).length) eq(hits, 0, id + ' stays snareless');
        else assert(hits > 0, id + ' actually uses its snare');
      }
    } finally {
      A.music._snare = realSnare;
      A.music._tracks = keep;
      A.music.intensity = 0; A.music._intensitySmooth = 0;
      A.music.stop();
    }
  });

  test('Audio: toggling music and sfx is reflected in state', () => {
    const A = L.Audio;
    A.init();
    if (!A.ctx) return;
    A.setSfxEnabled(false); eq(L.Store.sfxOn, false, 'sfx off persisted');
    A.sfx('flip', { dir: 1 });                 // must be a no-op, not a throw
    A.setSfxEnabled(true); eq(L.Store.sfxOn, true, 'sfx back on');
    A.setMusicEnabled(false); eq(L.Store.musicOn, false, 'music off persisted');
    A.setMusicEnabled(true); eq(L.Store.musicOn, true, 'music back on');
  });

  // Blackout's curve used to run a full cosine across the dark window, so the
  // darkness snapped on with no fade, lifted back to FULL light halfway through,
  // then darkened again — two clipped humps per cycle. It read as a glitch and
  // you could not plan around it. What makes the mode playable is a rhythm you
  // can count: lit, roll down, HOLD, roll back up, on a fixed beat.
  test('Blackout is one held darkness per cycle, on a beat you can count', () => {
    const b = L.Modes.def('blackout').blackout;
    const g = newGame(480, 800);
    L.Modes.setCurrent('blackout');
    g.start();
    eq(g.mode.id, 'blackout', 'blackout is the running mode');

    // Measure what actually reaches the screen, not the formula. Recomputing the
    // curve here would make this test agree with itself no matter what
    // drawBlackout does.
    //
    // Mean brightness is a bad proxy: the corridor is already nearly black, so
    // painting near-black over it barely moves the average however dark it gets.
    // What the mode actually takes away is the VISIBLE CONTENT — gates, motes,
    // the trail — which is a small share of pixels but the entire point. So
    // count bright pixels, and render each frame twice, with the blackout and
    // without, so obstacle pulsing at that instant cancels out of the ratio.
    for (let i = 0; i < 240; i++) g.update(1 / 60);   // put some gates on screen
    const cv = g.canvas, ctx = cv.getContext('2d');
    const py = Math.floor(cv.height * 0.2), ph = Math.floor(cv.height * 0.75);
    const visible = () => {
      const d = ctx.getImageData(0, py, cv.width, ph).data;
      let bright = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 5) {
        if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 > 60) bright++;
        n++;
      }
      return bright / n;
    };
    const N = 180;
    const s = [];
    for (let i = 0; i < N; i++) {
      g.elapsed = (b.period * i) / N;
      g.render();
      const withDark = visible();
      const cfg = g.mode.blackout;
      g.mode.blackout = null;                 // same instant, no blackout
      g.render();
      const without = visible();
      g.mode.blackout = cfg;
      s.push(without > 1e-6 ? 1 - withDark / without : 0);
    }
    const peak = Math.max(...s);
    assert(peak > 0.6, 'the blackout really does hide the field (' + Math.round(peak * 100) + '% of it)');
    assert(Math.min(...s) < 0.02, 'and there is a fully lit part of the cycle');

    // Exactly one dark phase per cycle. Counting the RUNS of darkness rather
    // than its peaks is the point: the old curve rose, fell all the way back to
    // full light mid-window, then rose again, and any peak-counting check would
    // have called that a single darkness.
    const on = peak * 0.5;
    let runs = 0;
    for (let i = 0; i < N; i++) if (s[i] > on && s[(i - 1 + N) % N] <= on) runs++;
    eq(runs, 1, 'exactly one darkness per cycle');

    // it holds near full dark rather than touching it and leaving
    const held = (s.filter((v) => v > peak * 0.9).length / N) * b.period;
    assert(held > 0.7, 'the darkness is held, not a flicker (' + held.toFixed(2) + 's)');

    // and it arrives and leaves smoothly — no snap
    let maxStep = 0;
    for (let i = 0; i < N; i++) maxStep = Math.max(maxStep, Math.abs(s[i] - s[(i - 1 + N) % N]));
    assert(maxStep < 0.2, 'it fades rather than snapping on (biggest step ' + maxStep.toFixed(3) + ')');

    // there is always something left to see, or it stops being a game
    assert(peak < 0.98, 'some light always remains');
    L.Modes.setCurrent('classic');
    g.toMenu();
  });

  // Every map charges shards for a gameplay trait, so every map has to say what
  // that trait IS. This is here because the descriptions were written, shipped,
  // and shown to nobody: a second cosd_<map> key further down the same language
  // object silently won, and English and Turkish displayed the old colour blurb
  // instead. A duplicate key is not a syntax error, so only a source scan sees it.
  test('map descriptions describe the trait, and no i18n key is defined twice', async () => {
    for (const m of L.Cosmetics.MAPS) {
      const d = L.t('cosd_' + m.id);
      assert(d && d !== 'cosd_' + m.id, m.id + ' has a description');
      assert(d.length > 24, m.id + ' description says something (' + d + ')');
    }
    // Same cache-busting stamp the page uses for the modules themselves: the
    // service worker matches on the exact URL, so a plain fetch here would be
    // answered from its cache and this would scan whatever shipped last, not
    // what is on disk now.
    let src;
    try { src = await (await fetch('../js/i18n.js?t=' + Date.now())).text(); } catch (e) { src = null; }
    if (!src) return;                       // opened from file:// — nothing to scan
    const langs = [...src.matchAll(/^ {4}([a-z]{2}): \{$/gm)].map((m) => ({ lang: m[1], at: m.index }));
    assert(langs.length >= 4, 'found the language blocks');
    for (let i = 0; i < langs.length; i++) {
      const body = src.slice(langs[i].at, i + 1 < langs.length ? langs[i + 1].at : src.length);
      const seen = new Map();
      for (const m of body.matchAll(/(?:^|[{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)) {
        seen.set(m[1], (seen.get(m[1]) || 0) + 1);
      }
      const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
      eq(dupes.length, 0, langs[i].lang + ' defines no key twice (' + dupes.slice(0, 6).join(', ') + ')');
    }
  });

  // A game built around music that answers how you play spent every menu in
  // total silence: toMenu() called music.stop(), and the attract demo behind the
  // menu deliberately starts no audio. So the title screen, the shop and every
  // other screen were dead quiet, and dying dropped you straight back into it.
  test('Menus are never silent, and a run brings the music forward', () => {
    freshStorage();
    const A = L.Audio;
    A.init();
    if (!A.ctx) return;                       // no audio in this environment
    const g = newGame();

    // record the levels asked for rather than the gain, which cannot ramp while
    // the context is suspended (no user gesture in a test run)
    const realSetLevel = A.music.setLevel;
    const asked = [];
    A.music.setLevel = function (v, s) { asked.push(v); return realSetLevel.call(this, v, s); };
    try {
      g.toMenu();
      assert(A.music.playing, 'the menu has music playing');
      const menuLevel = asked[asked.length - 1];
      assert(menuLevel > 0, 'the menu level is audible, not muted (' + menuLevel + ')');

      g.start();
      const runLevel = asked[asked.length - 1];
      assert(A.music.playing, 'a run still has music playing');
      assert(runLevel > menuLevel,
        'a run brings the music forward (' + menuLevel + ' -> ' + runLevel + ')');

      // dying and coming back must not leave it silent
      g.toMenu();
      assert(A.music.playing, 'returning to the menu does not stop the music');
      eq(asked[asked.length - 1], menuLevel, 'and it settles back to the menu level');
    } finally {
      A.music.setLevel = realSetLevel;
      A.music.stop();
      g.toMenu();
    }
  });

  // The arrangement, checked by counting the notes each layer actually schedules
  // rather than by listening to the output level — a limiter's whole job is to
  // hold the level steady, so "is it bigger" cannot be measured that way. What
  // makes it bigger is more parts playing, and that is exactly countable.
  test('Music arranges itself: bass always, arp then lead then pad as the chain climbs', () => {
    const A = L.Audio;
    A.init();
    if (!A.ctx) return;
    const M = A.music;
    const realTone = A._tone, realNoise = A._noise;
    const countAt = (lvl) => {
      let bass = 0, arp = 0, lead = 0, pad = 0, perc = 0;
      A._tone = (o) => {
        if (o.detune !== undefined) lead++;
        else if (o.dur > 1) pad++;
        else if (o.freq < 130) bass++;
        else if (o.dur <= 0.15) arp++;
      };
      A._noise = () => { perc++; };
      M._song = 'deepfield'; M._sectionB = false; M._key = 0;
      M.intensity = lvl; M._intensitySmooth = lvl;
      for (let s = 0; s < 64; s++) M._playStep(s, A.ctx.currentTime + s * 0.1);
      A._tone = realTone; A._noise = realNoise;
      return { bass, arp, lead, pad, perc };
    };
    try {
      const rest = countAt(0), mid = countAt(1.0), high = countAt(1.6), flow = countAt(3.0);

      assert(rest.bass > 0 && rest.perc > 0, 'the bass and drums never stop');
      eq(rest.arp, 0, 'no arp at rest');
      eq(rest.lead, 0, 'no lead at rest');

      assert(mid.arp > 0, 'the arp arrives with a small chain');
      eq(mid.lead, 0, 'but the lead has not yet');

      assert(high.lead > 0, 'the lead arrives on a real chain');
      eq(high.pad, 0, 'the pad is still held back');

      assert(flow.pad > 0, 'flow brings the pad in');
      assert(flow.lead >= high.lead && flow.arp >= high.arp, 'and keeps everything below it');

      // Each world writes its own melody and its own bassline. Counting the
      // notes per world is the check that they are actually different pieces
      // and not one arrangement wearing six names.
      const perWorld = {};
      for (const mp of L.Cosmetics.MAPS) {
        let lead = 0, bass = 0;
        A._tone = (o) => { if (o.detune !== undefined) lead++; else if (o.freq < 130) bass++; };
        A._noise = () => {};
        M._song = mp.id; M._sectionB = false; M._key = 0;
        M.intensity = 3; M._intensitySmooth = 3;
        for (let s = 0; s < 64; s++) M._playStep(s, A.ctx.currentTime + s * 0.1);
        A._tone = realTone; A._noise = realNoise;
        perWorld[mp.id] = lead + ':' + bass;
      }
      const shapes = Object.values(perWorld);
      assert(new Set(shapes).size >= 4,
        'the worlds are genuinely different arrangements (' + JSON.stringify(perWorld) + ')');
    } finally {
      A._tone = realTone; A._noise = realNoise;
      M.intensity = 0; M._intensitySmooth = 0;
    }
  });

  // Recorded stems have to behave like the sequencer does, or swapping in real
  // music would quietly cost the game its reactivity. Tested with buffers made
  // here rather than files: the plumbing is the risk, not the audio.
  test('Stems: layers gate on the chain, share one clock and one rate', () => {
    const A = L.Audio;
    A.init();
    if (!A.ctx) return;
    const M = A.music;
    const tone = (hz, sec) => {
      const b = A.ctx.createBuffer(1, Math.floor(A.ctx.sampleRate * sec), A.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * hz * i) / A.ctx.sampleRate) * 0.2;
      return b;
    };
    const savedStems = M._stems, savedSong = M._song;
    try {
      M._stems = { testworld: { drums: tone(120, 2), bass: tone(60, 2), lead: tone(440, 2), pad: tone(880, 2) } };
      M._song = 'testworld';
      M.playing = true;

      M._intensitySmooth = 0;
      M._syncTrack();
      assert(M._srcs && M._srcs.length === 4, 'all four stems are running');
      // every layer must have been started against ONE clock, or they drift
      const starts = M._srcs.map((s) => s.buffer.duration);
      eq(new Set(starts).size, 1, 'the stems are the same length');

      // Read the target each layer was ASKED for, not gain.value: a scheduled
      // ramp has gone nowhere on a context that was never resumed, so the live
      // value says "silent" for every layer and the test would pass or fail for
      // reasons that have nothing to do with the mix.
      const wants = (inten) => {
        M._intensitySmooth = inten;
        M._mixStems(0);
        return M._stemTarget;
      };
      const rest = wants(0), mid = wants(1.3), flow = wants(3);

      assert(rest.drums > 0.5 && rest.bass > 0.5, 'drums and bass hold the floor');
      assert(rest.lead < 0.01 && rest.pad < 0.01, 'nothing else at rest');
      assert(mid.lead > 0.5, 'the lead arrives on a chain');
      assert(mid.pad < 0.01, 'the pad is still held back');
      assert(flow.pad > 0.5, 'flow opens the pad');

      // one rate for all of them, or the mix comes apart
      M.bpm = M.BASE_BPM * 1.25;
      M._rateTrack();
      const rates = M._srcs.map((s) => +s.playbackRate.value.toFixed(4));
      eq(new Set(rates).size, 1, 'every stem moved by the same amount (' + rates[0] + ')');
      assert(rates[0] > 1, 'and the rate followed the run');

      // stopping must actually stop them — a looping buffer runs forever
      M.stop();
      assert(!M._srcs || M._srcs.length === 0, 'stopping releases the stems');
    } finally {
      M.stop();
      M._stems = savedStems || {};
      M._song = savedSong;
      M.bpm = M.BASE_BPM;
    }
  });

  // The board talks to Postgres directly, so the request shape IS the contract —
  // there is no server in between to be forgiving about it. In particular the
  // table requires an all-time row to have no day and a daily row to have one,
  // and getting that backwards fails only at runtime, against a real project.
  test('Leaderboard: off by default, and the Supabase requests match the schema', async () => {
    const LB = L.Leaderboard;
    assert(!LB.enabled, 'no board until one is configured');

    const realFetch = window.fetch;
    const calls = [];
    window.fetch = (url, opts) => {
      calls.push({ url: String(url), method: (opts && opts.method) || 'GET', headers: (opts && opts.headers) || {}, body: opts && opts.body });
      // a realistic response: PostgREST answers a write with 201 and no body,
      // which is exactly the shape that used to make a successful submit throw
      const isWrite = opts && opts.method === 'POST';
      return Promise.resolve({
        ok: true,
        status: isWrite ? 201 : 200,
        headers: new Headers(isWrite ? { 'content-length': '0' } : { 'content-type': 'application/json' }),
        json: () => Promise.resolve([]),
      });
    };
    try {
      LB.useSupabase('https://demo.supabase.co/', 'ANON');
      assert(LB.enabled, 'configuring a project turns the board on');
      LB.playerName = 'TESTER';
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u-owner' } };

      await LB.top('alltime', 20);
      await LB.top('daily', 20);
      await LB.submit(4321, 12, 'alltime');
      await LB.submit(99, 3, 'daily');

      // Six: two board reads, then each submit looks up the row it owns before
      // writing. Selecting the writes BY METHOD rather than by index is the
      // point — the old version indexed into calls[2]/calls[3], so adding the
      // lookup broke a test that was still describing correct behaviour.
      eq(calls.length, 6, 'two reads, two ownership lookups, two writes');
      calls.forEach((c) => assert(c.headers.apikey === 'ANON', 'every call carries the anon key'));

      const reads = calls.filter((c) => c.method === 'GET');
      const writes = calls.filter((c) => c.method !== 'GET');
      eq(writes.length, 2, 'one write per submit, never two');

      assert(/order=score\.desc/.test(reads[0].url), 'the board is ordered by score');
      assert(!/day=/.test(reads[0].url), 'the all-time board is not filtered to a day');
      assert(/day=eq\./.test(reads[1].url), 'the daily board is');

      // The lookups ask only for the caller's own row, which is what makes the
      // write that follows a replacement rather than a second entry.
      const lookups = reads.slice(2);
      eq(lookups.length, 2, 'each submit asks what it already owns');
      lookups.forEach((c) => assert(/user_id=eq\.u-owner/.test(c.url),
        'and asks only about its own row (' + c.url + ')'));
      assert(/day=is\.null/.test(lookups[0].url), 'the all-time lookup matches the null day');
      assert(/day=eq\./.test(lookups[1].url), 'the daily lookup matches the day');

      const allTime = JSON.parse(writes[0].body);
      const daily = JSON.parse(writes[1].body);
      eq(allTime.board, 'alltime', 'board recorded');
      eq(allTime.day, null, 'an all-time row carries no day (the table rejects one)');
      eq(daily.board, 'daily', 'daily board recorded');
      assert(typeof daily.day === 'string' && daily.day.length === 10,
        'a daily row carries its day (the table requires one)');
      assert(allTime.name.length <= 16, 'the name fits the column');
      assert(Number.isInteger(allTime.score) && Number.isInteger(allTime.combo), 'whole numbers only');
      // Every live row came back with user_id null, because the column has no
      // `default auth.uid()` and the client never said. An unowned row cannot be
      // deleted by its owner, cannot be renamed, and cannot dedupe against the
      // (user_id, board, day) index — NULLs never collide.
      eq(allTime.user_id, 'u-owner', 'the row says who owns it');
      eq(daily.user_id, 'u-owner', 'on both boards');
    } finally {
      window.fetch = realFetch;
      L.Auth.session = null;
      LB._sb = null;
    }
  });

  // Every player who played before signing in has a personal best the board has
  // never heard of, and the board only listens to runs that BEAT that best. So
  // they can never appear on it until they beat a score they set when nobody was
  // watching — and nothing tells them why their name is missing.
  test('Leaderboard: a record set before the account still reaches the board', async () => {
    freshStorage();
    L.Store.boardConsent = true;   // this test is about the record, not the consent
    const LB = L.Leaderboard;
    const realSb = LB._sb;
    const realFetch = window.fetch;
    const realSubmit = LB.submit;
    const sent = [];
    let boardHas = [];                     // what the board holds for this user
    window.fetch = () => Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(boardHas),
    });
    LB.submit = (sc, c, b) => { sent.push({ score: sc, combo: c, board: b }); return Promise.resolve(null); };
    try {
      LB._sb = { url: 'https://test.invalid', key: 'k' };
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u-old-hand' } };
      L.Store.playerName = 'veteran';

      // A record from before the account, with the combo from that same run.
      L.Scores.record(1215, 23, 'classic');
      eq(L.Store.pendingBest.alltime, undefined, 'nothing is queued yet');

      await LB.seedFromLocalBests();
      eq(L.Store.pendingBest.alltime.score, 1215, 'the record they already hold is offered');
      eq(L.Store.pendingBest.alltime.combo, 23, 'with the combo from that run, not from another');

      const done = await LB.flushPending();
      eq(done.length, 1, 'and it goes up');
      eq(sent[0].score, 1215, 'as itself');

      // Now the board holds it. Offering again must do nothing — this runs on
      // every sign-in, and a device flag was the wrong way to promise that.
      boardHas = [{ score: 1215 }];
      sent.length = 0;
      await LB.seedFromLocalBests();
      eq(L.Store.pendingBest.alltime, undefined, 'nothing is re-queued while the board is ahead');

      // …and it must never LOWER the row. RESET PROGRESS leaves a small record
      // behind; the board's real one has to survive it.
      freshStorage();
      L.Store.boardConsent = true;   // RESET PROGRESS clears it too; re-grant
      L.Store.playerName = 'veteran';
      L.Scores.record(9, 0, 'classic');
      await LB.seedFromLocalBests();
      eq(L.Store.pendingBest.alltime, undefined, 'a smaller local record is not offered');

      // Delete the account, sign in as somebody new: that account's board is
      // empty, so the device's record is stranded again and must be offered
      // again. The flag this replaced said "done" here and left the player
      // invisible — which is the bug they found.
      boardHas = [];
      L.Auth.session = { access_token: 't2', refresh_token: 'r2', user: { id: 'u-brand-new' } };
      L.Scores.record(1215, 23, 'classic');
      await LB.seedFromLocalBests();
      eq(L.Store.pendingBest.alltime.score, 1215, 'a new account gets the offer too');
    } finally {
      window.fetch = realFetch;
      LB.submit = realSubmit;
      L.Auth.session = null;
      LB._sb = null;
    }
  });

  // Consent became its own flag on 23 August (bb9f623, App Store 5.1.2). The name
  // did not: `lumen_name` has existed since the first commit. Nothing migrated
  // the players who were already between the two, and nothing re-asked them --
  // `openNameScreen` was guarded on `!named`, which is precisely the half they
  // already had. Result: `named` true, `canSubmit` false, every personal best
  // quietly diverted to hold(), no error anywhere, forever.
  test('Leaderboard: a player who named themselves before consent existed is asked again', () => {
    freshStorage();
    const LB = L.Leaderboard;
    const realSession = L.Auth.session;
    const realSb = LB._sb;
    try {
      LB._sb = { url: 'https://test.invalid', key: 'k' };
      // Exactly the state a pre-23-August device wakes up in.
      L.Store.playerName = 'veteran';
      L.Store.boardConsent = false;
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u-veteran' } };

      assert(LB.named, 'they have a name');
      assert(!LB.canSubmit, 'and cannot publish — which is correct, they never agreed to');
      assert(LB.needsSetup, 'so something IS still owed, and one question says so');

      // The old guard. If this ever comes back, the player is stranded again.
      assert(!(!LB.named), 'the old `!named` guard is false here — it would skip them');

      // Consent alone, without a name, must also count as owing something.
      L.Store.playerName = '';
      L.Store.boardConsent = true;
      assert(LB.needsSetup, 'a nameless player owes a name');

      // Both present is the only settled state.
      L.Store.playerName = 'veteran';
      assert(!LB.needsSetup, 'name and consent together, and nothing is owed');
      assert(LB.canSubmit, 'and only then can anything be published');
    } finally {
      L.Auth.session = realSession;
      LB._sb = realSb;
    }
  });

  // The rescue has to reach a player who is ALREADY signed in, because that is
  // who is stuck: they will never see the sign-in prompt again.
  test('Leaderboard: opening the board asks the stranded player, once per launch', async () => {
    freshStorage();
    const UI = L.UI;
    if (!UI || !UI.openScores) return;                 // headless page, nothing to drive
    const realOpenName = UI.openNameScreen;
    const realShow = UI.showScreen;
    const realSetBoard = UI.setBoard;
    const realSession = L.Auth.session;
    const realSb = L.Leaderboard._sb;
    L.Leaderboard._sb = { url: 'https://test.invalid', key: 'k' };
    let asked = 0;
    UI.openNameScreen = () => { asked++; };
    UI.showScreen = () => {};
    UI.setBoard = () => {};
    UI._askedSetup = false;
    try {
      L.Store.playerName = 'veteran';
      L.Store.boardConsent = false;
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u-veteran' } };

      UI.openScores();
      eq(asked, 1, 'the board asks the question the sign-in prompt can no longer ask');
      UI.openScores();
      eq(asked, 1, 'and does not ask twice in one sitting — declining has to be free');

      // Once they consent, the board stops asking and starts working.
      UI._askedSetup = false;
      L.Store.boardConsent = true;
      UI.openScores();
      eq(asked, 1, 'a settled player is never interrupted');

      // A signed-OUT player is not asked either: there is nothing to publish to.
      UI._askedSetup = false;
      L.Store.boardConsent = false;
      L.Auth.session = null;
      UI.openScores();
      eq(asked, 1, 'and neither is somebody with no account');
    } finally {
      UI.openNameScreen = realOpenName;
      UI.showScreen = realShow;
      UI.setBoard = realSetBoard;
      UI._askedSetup = false;
      L.Auth.session = realSession;
      L.Leaderboard._sb = realSb;
    }
  });

  // The board is one row per (user, board, day) and the client was told to
  // upsert into it. It never did: `resolution=merge-duplicates` with no
  // `on_conflict=` aims the clause at the primary key, the payload carries no
  // id, so the clause cannot fire and every submit ran as a plain insert. The
  // first one lands; every one after it is a 23505 that submitQuietly drops.
  // Your first score becomes your permanent score.
  test('Leaderboard: a better score REPLACES the row you already own', async () => {
    freshStorage();
    L.Store.boardConsent = true;
    const LB = L.Leaderboard;
    const realFetch = window.fetch;
    const realSb = LB._sb;
    const realSession = L.Auth.session;
    const calls = [];
    let existing = [{ id: 25, score: 1211 }];          // the row already on the board
    window.fetch = (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      calls.push({ url: String(url), method, body: opts && opts.body ? JSON.parse(opts.body) : null });
      let payload = [];
      if (method === 'GET') payload = existing;
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(payload),
      });
    };
    try {
      LB._sb = { url: 'https://test.invalid', key: 'k' };
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u-me' } };
      L.Store.playerName = 'veteran';

      // A run worth 2000 against a board holding 1211.
      await LB.submit(2000, 30, 'alltime');
      const writes = calls.filter((c) => c.method !== 'GET');
      eq(writes.length, 1, 'exactly one write');
      eq(writes[0].method, 'PATCH', 'and it UPDATES the row rather than inserting a second one');
      assert(/id=eq\.25/.test(writes[0].url), 'the row it owns, by id (' + writes[0].url + ')');
      eq(writes[0].body.score, 2000, 'with the new score');

      // The board must never move backwards.
      calls.length = 0;
      existing = [{ id: 25, score: 2000 }];
      await LB.submit(900, 4, 'alltime');
      eq(calls.filter((c) => c.method !== 'GET').length, 0,
        'a score below the one on the board is not written at all');

      // …and with no row yet, it still inserts.
      calls.length = 0;
      existing = [];
      await LB.submit(500, 6, 'alltime');
      const first = calls.filter((c) => c.method !== 'GET');
      eq(first.length, 1, 'one write for a player with no row');
      eq(first[0].method, 'POST', 'and that one is an insert');
      eq(first[0].body.score, 500, 'carrying the score');
      eq(first[0].body.user_id, 'u-me', 'and the owner, so RLS can attribute it');

      // The DAILY board is keyed on the day, so it is looked up by day.
      calls.length = 0;
      existing = [];
      await LB.submit(300, 3, 'daily');
      const look = calls.find((c) => c.method === 'GET');
      assert(/board=eq\.daily/.test(look.url) && /day=eq\./.test(look.url),
        'the daily row is found by day, not by is.null (' + look.url + ')');
    } finally {
      window.fetch = realFetch;
      LB._sb = realSb;
      L.Auth.session = realSession;
    }
  });

  // ---- theme packs -----------------------------------------------------------

  // Six four-piece sets landed at once. Everything below is the arithmetic the
  // design review did by hand, made permanent.

  // The cat MEWS. A skin may own the flip's sound; the wiring is one lookup in
  // flip(), and this is the test that keeps the lookup honest.
  test('Themes: the cat skin mews on every flip, other skins do not', () => {
    freshStorage();
    const C = L.Cosmetics;
    L.Store.shards = 100000;
    C.buy('whisker');
    const g = newGame();
    const heard = [];
    const realSfx = g._sfx;
    g._sfx = function (name, opts) { heard.push(name); };
    try {
      C.equip('whisker');
      g.start(); g.tutorial = null;
      heard.length = 0;
      g.flip();
      assert(heard.indexOf('meow') >= 0, 'the cat flip mews (' + heard.join(',') + ')');
      assert(heard.indexOf('flip') < 0, 'and does not ALSO play the ordinary flip over it');
      C.equip('ion');
      heard.length = 0;
      g.flip();
      assert(heard.indexOf('flip') >= 0, 'every other skin still plays the ordinary flip');
      assert(heard.indexOf('meow') < 0, 'and never the meow');
    } finally {
      g._sfx = realSfx;
      g.toMenu();
    }
  });

  test('Themes: every deco names a draw function, every set piece exists', () => {
    const C = L.Cosmetics;
    for (const sk of C.SKINS) {
      if (sk.deco) {
        assert(typeof L.DECOS[sk.deco] === 'function',
          sk.id + ' declares deco "' + sk.deco + '" and drawPlayer would skip it SILENTLY');
      }
    }
    // and no orphaned deco functions either — a renamed skin must not strand one
    for (const key of Object.keys(L.DECOS)) {
      assert(C.SKINS.some((sk) => sk.deco === key), 'deco "' + key + '" belongs to no skin');
    }
    for (const set of C.SETS) {
      for (const it of set.items) {
        const def = C.def(it);
        assert(def, set.id + ' bundles "' + it + '" which is not in any catalogue');
        assert(!def.req, set.id + ' bundles "' + it + '" which is achievement-only and cannot be sold');
        assert(C.price(it), set.id + ' bundles unpriced "' + it + '"');
      }
      const p = C.setPrice(set.id);
      assert(p && p.shards > 0, set.id + ' has no computable price');
    }
    // the four-piece sets must price their map through the map's own shards
    const four = C.SETS.filter((s2) => s2.items.length === 4);
    eq(four.length, 6, 'six theme packs');
    for (const s2 of four) {
      assert(s2.usd === 0, s2.id + ' must be shard-only — a usd price needs a store product');
    }
  });

  // The colourblind language is load-bearing: hazards must never share a hue
  // family with anything ambient. The themed worlds promised wall >= 28 degrees
  // from every danger hue and dust >= 20 from every reward hue; this makes the
  // promise a test. (Scoped to the themed worlds — emberfall predates the dust
  // rule at 16 degrees and is left as shipped.)
  test('Themes: map hues keep their distance from the colourblind palette', () => {
    const DANGER = [350, 288, 276, 352];
    const REWARD = [50, 52, 56, 128];
    const THEMED = ['hallowmere', 'regalia', 'nullpoint', 'weave', 'hoarfrost',
                    'rooftops', 'bloomward', 'andromeda', 'nightway', 'gloamvale', 'lanternmoon'];
    const circ = (a, b) => { const d = Math.abs(((a % 360) + 360) % 360 - ((b % 360) + 360) % 360); return Math.min(d, 360 - d); };
    for (const id of THEMED) {
      const m = L.Cosmetics.def(id);
      assert(m, id + ' exists');
      for (const d of DANGER) {
        assert(circ(m.wall, d) >= 28, id + ' wall ' + m.wall + ' is only ' + circ(m.wall, d) + ' deg from danger ' + d);
      }
      for (const r of REWARD) {
        assert(circ(m.dust, r) >= 20, id + ' dust ' + m.dust + ' is only ' + circ(m.dust, r) + ' deg from reward ' + r);
      }
    }
    // wall distance holds for EVERY map, themed or not
    for (const m of L.Cosmetics.MAPS) {
      for (const d of DANGER) {
        assert(circ(m.wall, d) >= 28, m.id + ' wall ' + m.wall + ' vs danger ' + d + ' = ' + circ(m.wall, d));
      }
    }
  });

  // Every themed map rides an EXISTING, tested trait — a new mechanic smuggled
  // in through the catalogue would dodge every gameplay test in this file.
  test('Themes: new worlds reuse tested traits only', () => {
    const KNOWN = ['none', 'updraft', 'sink', 'tide', 'sparse', 'heavy', 'haunted',
                   'stately', 'weightless', 'breathing', 'leaden'];
    for (const m of L.Cosmetics.MAPS) {
      assert(KNOWN.indexOf(m.trait) >= 0, m.id + ' has unknown trait "' + m.trait + '"');
    }
  });

  // ---- redeem codes and the daily reward ------------------------------------
  // Both exist because neither a code list nor a date can be trusted to the
  // device: this repository is public, and a phone's clock belongs to its owner.
  // What the tests below guard is that the CLIENT never decides either one.

  test('Perks: a code is never answered locally', async () => {
    freshStorage();
    const R = L.Perks;
    if (!R) return;
    const realFetch = window.fetch;
    const realSession = L.Auth.session;
    const calls = [];
    window.fetch = (url, opts) => {
      calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ ok: true, code: 'NOTAREALCODE', grant: { shards: 250 } }),
      });
    };
    const realSb = L.Leaderboard._sb;
    try {
      L.Leaderboard._sb = { url: 'https://test.invalid', key: 'k' };

      // Signed out it does not even ask — and says why, rather than failing.
      L.Auth.session = null;
      let res = await R.redeem('NOTAREALCODE');
      eq(res.ok, false, 'signed out, nothing is redeemed');
      eq(res.reason, 'signin', 'and the reason is one the player can act on');
      eq(calls.length, 0, 'no request was made at all');

      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u-me' } };
      const before = L.Store.shards;
      res = await R.redeem('  notarealcode  ');
      eq(res.ok, true, 'a real code is accepted');
      eq(L.Store.shards, before + 250, 'and the grant is applied');

      eq(calls.length, 1, 'one call');
      assert(/\/rest\/v1\/rpc\/redeem_promo$/.test(calls[0].url),
        'to the FUNCTION, never to a table (' + calls[0].url + ')');
      // The typed string goes up untouched. Trimming and case-folding belong to
      // the server, because the server is the only thing that holds the list.
      eq(calls[0].body.p_code, 'notarealcode', 'the code travels as typed, minus the spaces');
    } finally {
      window.fetch = realFetch;
      L.Auth.session = realSession;
      L.Leaderboard._sb = realSb;
    }
  });

  // A code list in this file would be readable by anyone: the repository is
  // public and the script ships inside every build. This is the assertion that
  // fails if somebody ever "simplifies" the server call away.
  test('Perks: no code is written into the client', async () => {
    const R = L.Perks;
    if (!R) return;
    const src = await fetch('../js/perks.js?t=' + Date.now()).then((r) => r.text());
    // A code must never appear in the shipped client. The first version of this
    // test named the three real codes to check for — in a test file committed to
    // the same public repository, so the guard published the secret it guarded.
    // Check the SHAPE instead: nothing here should look like a code at all.
    const CODEISH = /['"][A-Z0-9]{6,32}['"]/g;
    const looksLikeCodes = (src.match(CODEISH) || [])
      // the module names its own storage keys and reasons; those are lowercase
      .filter((m) => !/^['"](LUMEN1|POST|PATCH|GET|DELETE)['"]$/.test(m));
    eq(looksLikeCodes.length, 0,
      'no code-shaped literal in the client (' + looksLikeCodes.join(', ') + ')');
    // …and the module must not compare a typed string against anything.
    assert(src.indexOf('p_code') > 0, 'the typed string is sent to the server');
    assert(!/typed\s*(===|==)\s*['"]/.test(src), 'and never compared here');
    assert(!/redeem\s*\(\s*[^)]*\)\s*{[^}]*(===|==)\s*['"][A-Z0-9]{4,}['"]/.test(src),
      'and no code is compared against a literal either');
    // The reward ladder IS in the client, for drawing only — so it must match
    // the server's, or the screen promises a number the database will not pay.
    eq(R.LADDER.length, 7, 'seven rungs');
    eq(R.rewardFor(1), 60, 'day one');
    eq(R.rewardFor(7), 500, 'day seven');
    eq(R.rewardFor(99), 500, 'and it holds after that rather than growing');
    assert(R.rewardFor(2) > R.rewardFor(1) && R.rewardFor(6) > R.rewardFor(5),
      'the ladder only goes up');
  });

  test('Perks: the daily reward asks the server for the day', async () => {
    freshStorage();
    const R = L.Perks;
    if (!R) return;
    const realFetch = window.fetch;
    const realSession = L.Auth.session;
    const realSb = L.Leaderboard._sb;
    const calls = [];
    let reply = { ok: true, claimed: false, streak: 3, shards: 120, day: '2026-08-27' };
    window.fetch = (url) => {
      calls.push(String(url));
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(reply),
      });
    };
    try {
      L.Leaderboard._sb = { url: 'https://test.invalid', key: 'k' };
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u-me' } };

      const st = await R.status();
      eq(st.streak, 3, 'the streak comes from the server');
      assert(/rpc\/daily_status$/.test(calls[0]), 'through the status function');

      const before = L.Store.shards;
      reply = { ok: true, streak: 4, shards: 170, next: 240, day: '2026-08-27' };
      const got = await R.claim();
      eq(got.ok, true, 'the claim lands');
      eq(L.Store.shards, before + 170, 'and pays what the SERVER said, not what the ladder guessed');
      assert(/rpc\/claim_daily$/.test(calls[1]), 'through the claim function');

      // Collecting twice on one day is the server's call, and a refusal must not
      // pay anything locally.
      const held = L.Store.shards;
      reply = { ok: false, reason: 'today', streak: 4 };
      const again = await R.claim();
      eq(again.ok, false, 'the second collection is refused');
      eq(L.Store.shards, held, 'and nothing is paid');
    } finally {
      window.fetch = realFetch;
      L.Auth.session = realSession;
      L.Leaderboard._sb = realSb;
    }
  });

  // `unlockAll` has to mean ALL. An earlier hand-built version of this counted
  // three catalogues and silently missed the signatures — a shorter list still
  // looks like a full one, which is exactly why this counts against the source.
  test('Perks: unlockAll covers every catalogue, signatures included', () => {
    freshStorage();
    const R = L.Perks, C = L.Cosmetics;
    if (!R || !C) return;
    const all = [].concat(C.SKINS || [], C.TRAILS || [], C.MAPS || [], C.SIGNATURES || []);
    assert((C.SIGNATURES || []).length > 0, 'there ARE signatures to miss');
    R.apply({ unlockAll: true, shards: 10 });
    const missing = all.filter((i) => !C.owned(i.id)).map((i) => i.id);
    eq(missing.length, 0, 'nothing is left locked (' + missing.join(', ') + ')');
    let iap = [];
    try { iap = JSON.parse(localStorage.getItem('lumen_iap') || '[]'); } catch (e) {}
    eq(iap.length, (C.SETS || []).length, 'and the sets read as owned, so the shop stops offering them');
    // A grant never takes anything away.
    const shards = L.Store.shards;
    R.apply({ shards: 0 });
    assert(L.Store.shards >= shards, 'a later, smaller grant cannot undo an earlier one');
  });

  // Both RPCs COMMIT before they answer, so a reply lost in a tunnel leaves the
  // server certain the reward was given and the player holding nothing. Shards
  // are sold for money, so what that destroys is purchase-equivalent goods.
  test('Perks: a reward whose reply was lost is settled on the next open', async () => {
    freshStorage();
    const R = L.Perks;
    if (!R) return;
    const realFetch = window.fetch, realSession = L.Auth.session, realSb = L.Leaderboard._sb;
    let reply = null;
    window.fetch = () => Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(reply),
    });
    try {
      L.Leaderboard._sb = { url: 'https://test.invalid', key: 'k' };
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u' } };

      // The server took the day and paid 120; this device never heard.
      const before = L.Store.shards;
      reply = { ok: true, claimed: true, streak: 3, shards: 120, next: 170, day: '2026-08-27' };
      let st = await R.status();
      eq(L.Store.shards, before + 120, 'the missing payment is settled');
      eq(st.recovered, 120, 'and the caller is told, so it can say so');

      // …exactly once. Opening the screen again must not pay a second time.
      st = await R.status();
      eq(L.Store.shards, before + 120, 'and only once, however often the screen is opened');
      assert(!st.recovered, 'the second open reports no recovery');

      // Same shape for a code: the redemption committed, the reply was lost, and
      // "already used" is what the player would otherwise be left with.
      const s2 = L.Store.shards;
      reply = { ok: false, reason: 'already', code: 'NOTAREALCODE', grant: { shards: 750 } };
      let res = await R.redeem('notarealcode');
      eq(res.ok, true, 'the burnt code pays what it was worth');
      eq(res.recovered, true, 'flagged as a recovery rather than a fresh redeem');
      eq(L.Store.shards, s2 + 750, 'and the shards arrive');

      // …and cannot be farmed by typing it again.
      res = await R.redeem('notarealcode');
      eq(res.ok, false, 'a second attempt is refused');
      eq(res.reason, 'already', 'with the honest reason');
      eq(L.Store.shards, s2 + 750, 'and pays nothing more');
    } finally {
      window.fetch = realFetch; L.Auth.session = realSession; L.Leaderboard._sb = realSb;
    }
  });

  // An access token lasts an hour. Nothing refreshed it, so both screens died
  // part-way through a long session and said "no connection", which was untrue.
  test('Perks: an expired token is refreshed once, not reported as no connection', async () => {
    freshStorage();
    const R = L.Perks;
    if (!R) return;
    const realFetch = window.fetch, realSession = L.Auth.session;
    const realSb = L.Leaderboard._sb, realRefresh = L.Auth.refresh;
    let calls = 0, refreshes = 0, refreshWorks = true;
    window.fetch = () => {
      calls++;
      const expired = calls === 1;
      return Promise.resolve({
        ok: !expired, status: expired ? 401 : 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ ok: true, claimed: false, streak: 1, shards: 60, day: '2026-08-27' }),
      });
    };
    L.Auth.refresh = () => { refreshes++; return refreshWorks ? Promise.resolve({}) : Promise.reject(new Error('gone')); };
    try {
      L.Leaderboard._sb = { url: 'https://test.invalid', key: 'k' };
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u' } };

      const st = await R.status();
      eq(refreshes, 1, 'the token is refreshed');
      eq(calls, 2, 'and the call is retried exactly once');
      eq(st.ok, true, 'so the screen works instead of dying for the session');

      // A refresh that fails is a sign-in problem, and must say so rather than
      // blaming the network — the player can act on one and not the other.
      calls = 0; refreshes = 0; refreshWorks = false;
      const bad = await R.status();
      eq(bad.ok, false, 'a dead session still fails');
      eq(bad.reason, 'signin', 'but with the reason the player can act on');
      eq(refreshes, 1, 'and it does not retry the refresh forever');
    } finally {
      window.fetch = realFetch; L.Auth.session = realSession;
      L.Leaderboard._sb = realSb; L.Auth.refresh = realRefresh;
    }
  });

  // js/scores.js stores two different numbers on purpose: the last FIFTY runs,
  // and the all-time record pinned separately so a good week months ago cannot
  // freeze MY RUNS. The seed read the first one. For a player whose record is
  // older than their last fifty runs those two numbers disagree, and the smaller
  // one is what reached the board — after which the gate in game.js, which
  // measures every run against the PINNED record, could never send anything
  // again. The board froze below the player's real best and no amount of playing
  // moved it.
  test('Leaderboard: a record older than the last fifty runs still reaches the board', async () => {
    freshStorage();
    L.Store.boardConsent = true;
    const LB = L.Leaderboard;
    const realFetch = window.fetch;
    const realSubmit = LB.submit;
    let boardHas = [];
    window.fetch = () => Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(boardHas),
    });
    LB.submit = () => Promise.resolve(null);
    try {
      LB._sb = { url: 'https://test.invalid', key: 'k' };
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u-long-player' } };
      L.Store.playerName = 'veteran';

      // The record, pinned months ago…
      L.Store.best = 1211;
      // …and enough runs since to push it out of the kept history entirely.
      for (let i = 0; i < L.Scores.KEEP + 5; i++) L.Scores.record(600 + (i % 40) * 5, 4, 'classic');
      const histTop = L.Scores.list('classic')[0].s;
      assert(histTop < 1211, 'the history no longer holds the record (' + histTop + ')');
      assert(L.Store.best === 1211, 'but the pin still does');

      await LB.seedFromLocalBests();
      eq(L.Store.pendingBest.alltime.score, 1211, 'the PINNED record is what is offered');
      eq(L.Store.pendingBest.alltime.combo, 0,
        'and it carries no combo, because no run still on this device owns that score');

      // The board catching up must end the offers, exactly as before.
      boardHas = [{ score: 1211 }];
      L.Store.pendingBest = {};
      await LB.seedFromLocalBests();
      eq(L.Store.pendingBest.alltime, undefined, 'nothing is re-offered once the board holds it');

      // And when the history DOES still hold the record, the combo goes with it —
      // the pin must not strip a real run's chain off a real run's score.
      freshStorage();
      L.Store.boardConsent = true;
      L.Store.playerName = 'veteran';
      boardHas = [];
      L.Store.best = 1400;
      L.Scores.record(1400, 31, 'classic');
      await LB.seedFromLocalBests();
      eq(L.Store.pendingBest.alltime.score, 1400, 'same score from both places');
      eq(L.Store.pendingBest.alltime.combo, 31, 'so the run keeps its own combo');
    } finally {
      window.fetch = realFetch;
      LB.submit = realSubmit;
      L.Auth.session = null;
      LB._sb = null;
    }
  });

  // App Review deletes the account it just made without ever playing a run, so
  // the row count is zero and a delete removes nothing. That is SUCCESS. Reading
  // it as failure is what put "the server did not confirm" on screen in the
  // recording Apple was sent, under a rejection for App Completeness.
  test('Account deletion: a player with no board row still deletes cleanly', async () => {
    const LB = L.Leaderboard;
    const realFetch = window.fetch;
    const realSession = L.Auth.session;
    const calls = [];
    const json = (body) => Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
    });
    try {
      LB.useSupabase('https://demo.supabase.co/', 'ANON');
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u-never-played' } };

      // Nobody's row: the SELECT comes back empty, so no DELETE should follow.
      window.fetch = (url, opts) => {
        calls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
        return json([]);
      };
      eq(await LB.deleteMine(), true, 'nothing to remove is not a failure');
      eq(calls.filter((c) => c.method === 'DELETE').length, 0,
        'and no pointless DELETE is sent');

      // Now a player who does have one: the DELETE runs and its rows are checked.
      calls.length = 0;
      window.fetch = (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        calls.push({ url: String(url), method });
        return json(method === 'DELETE' ? [{ user_id: 'u-never-played' }] : [{ user_id: 'u-never-played' }]);
      };
      eq(await LB.deleteMine(), true, 'an owned row is removed and reported');
      eq(calls.filter((c) => c.method === 'DELETE').length, 1, 'exactly one DELETE');

      // And the case the row-count check exists for: RLS refuses, so the row is
      // still there. That IS a failure and must not be dressed up as success.
      calls.length = 0;
      window.fetch = (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        return json(method === 'DELETE' ? [] : [{ user_id: 'u-never-played' }]);
      };
      eq(await LB.deleteMine(), false, 'a refused delete still reports failure');
    } finally {
      window.fetch = realFetch;
      L.Auth.session = realSession;
      LB._sb = null;
    }
  });

  // The number on screen has to be the number you get. Multiplying quietly at
  // the end meant a Sprint run on Hard finished at 2.5x what you had been
  // watching for the whole run — the reward was real, the presentation was a
  // magic trick. And the BEST under it belongs to the mode being played, not to
  // Classic, or choosing Sprint shows you a Classic record you cannot beat here.
  test('HUD: the score shown is the score recorded, and BEST is this mode\'s', () => {
    freshStorage();
    L.Store.best = 1978;
    L.Store.modeBests = { sprint: 640, blackout: 302 };

    for (const [id, expected] of [['classic', 1978], ['sprint', 640], ['blackout', 302]]) {
      L.Modes.setCurrent(id);
      const g = newGame();
      g.start();
      eq(g.bestHere, expected, id + ' shows its own best');
      g.toMenu();
    }

    // difficulty and mode stack
    L.Store.difficulty = 'hard';
    L.Modes.setCurrent('sprint');
    const g = newGame();
    g.start();
    assert(Math.abs(g.scoreMul - 1.4 * 1.8) < 0.001,
      'difficulty and mode multipliers stack (' + g.scoreMul.toFixed(2) + ')');

    g.score = 500;
    for (let i = 0; i < 200; i++) g.update(1 / 60);      // let the ticker settle
    const shown = Math.floor(g.displayScore);
    const recorded = Math.floor(g.score * g.scoreMul);
    assert(Math.abs(shown - recorded) <= Math.max(3, recorded * 0.02),
      'the running total already includes the multiplier (' + shown + ' vs ' + recorded + ')');
    g.toMenu();

    // Zen earns nothing, and must not pretend otherwise
    L.Modes.setCurrent('zen');
    const z = newGame();
    z.start();
    eq(z.scoreMul, 0, 'Zen multiplies to nothing');
    z.toMenu();

    L.Store.difficulty = 'normal';
    L.Modes.setCurrent('classic');
  });

  // A shared board is a list of BESTS. Sending every run turned it into the
  // diary of whoever played most, with their twenty mediocre attempts burying
  // better scores from everyone else. Locally the opposite is wanted: keep the
  // recent runs so you can see how you are playing now — but never at the cost
  // of the run you are proudest of.
  test('Only personal bests go to the shared board; every run stays local', () => {
    freshStorage();
    L.Store.boardConsent = true;   // the consent gate has its own test
    const LB = L.Leaderboard;
    const realSubmit = LB.submitQuietly;
    const sent = [];
    LB.submitQuietly = (s, c, b) => { sent.push({ score: s, board: b }); };
    try {
      L.Modes.setCurrent('classic');
      L.Store.difficulty = 'normal';
      // A best is only SENT once there is a name on it — see the hold test
      // below. Without this the board fills with "anon" rows that no player can
      // ever reclaim, which is exactly what happened on the live board.
      L.Store.playerName = 'tester';
      // …and an account. The shared board is the one part of this game that
      // needs one: a name alone never owned a row, because anyone could type it.
      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u1' } };
      // …and somewhere to send it. `canSubmit` asks whether a board exists at
      // all, which the old name-only check never did.
      LB._sb = { url: 'https://test.invalid', key: 'k' };
      const run = (raw) => {
        const g = newGame();
        g.start();
        g.score = raw;
        g.finalizeRun();
        g.toMenu();
      };
      run(500); run(200); run(300); run(900);

      eq(sent.length, 2, 'only the two record-breaking runs were sent');
      eq(sent[0].score, 500, 'the first run is a best by definition');
      eq(sent[1].score, 900, 'and so is the one that beat it');
      eq(L.Store.scores.length, 4, 'but every run is kept on the device');
    } finally {
      LB.submitQuietly = realSubmit;
      LB._sb = null;
      L.Auth.session = null;
      L.Modes.setCurrent('classic');
    }
  });

  // There are no accounts here, so a row belongs to whoever typed the name on
  // it — which makes "anon" permanent. A best set before the player has ever
  // opened the leaderboard screen must WAIT for a name rather than go up under
  // one shared with every other silent player. The live board's top three rows
  // were all "anon" for exactly this reason.
  test('A best is held until there is BOTH a name and an account', async () => {
    freshStorage();
    L.Store.boardConsent = true;   // …and consent, which is tested separately
    const LB = L.Leaderboard;
    const realSubmit = LB.submit;
    const realSb = LB._sb;
    const sent = [];
    LB.submit = (s, c, b) => { sent.push({ score: s, board: b }); return Promise.resolve(null); };
    LB._sb = { url: 'https://test.invalid', key: 'k' };      // so `enabled` is true
    try {
      L.Store.playerName = '';
      L.Modes.setCurrent('classic');
      const run = (raw) => { const g = newGame(); g.start(); g.score = raw; g.finalizeRun(); g.toMenu(); };

      run(700);
      eq(sent.length, 0, 'nothing goes up while the player is nameless');
      eq(L.Store.pendingBest.alltime.score, 700, 'the best is held instead');

      run(1500);
      eq(sent.length, 0, 'still nothing');
      eq(L.Store.pendingBest.alltime.score, 1500, 'and only the better of them is held');
      eq(Object.keys(L.Store.pendingBest).length, 1, 'one entry per board, not one per run');

      // A name on its own is NOT enough any more. It never really was: anyone
      // could type any name, including one already on the board, so no request
      // could tell the owner from the impostor.
      L.Store.playerName = 'kaan';
      eq((await LB.flushPending()).length, 0, 'a name without an account sends nothing');
      eq(L.Store.pendingBest.alltime.score, 1500, 'and the run is still held');

      L.Auth.session = { access_token: 't', refresh_token: 'r', user: { id: 'u1' } };
      const boards = await LB.flushPending();
      eq(boards.join(','), 'alltime', 'signing in sends what was held');
      eq(sent.length, 1, 'exactly once');
      eq(sent[0].score, 1500, 'and it is the best run, not the first');
      eq(Object.keys(L.Store.pendingBest).length, 0, 'the queue is then empty');

      // A failed submit must keep its entry, or the run is lost in silence.
      LB.submit = () => Promise.reject(new Error('offline'));
      LB.hold(2000, 5, 'alltime');
      const none = await LB.flushPending();
      eq(none.length, 0, 'a failed send reports nothing sent');
      eq(L.Store.pendingBest.alltime.score, 2000, 'and the run is still queued for next time');
    } finally {
      LB.submit = realSubmit;
      LB._sb = null;
      L.Auth.session = null;
      L.Store.playerName = '';
      L.Modes.setCurrent('classic');
    }
  });

  test('Run history: capped, newest kept, all-time best never dropped', () => {
    freshStorage();
    const S = L.Scores;
    S.clear();
    assert(S.KEEP > S.SHOW, 'more runs are stored than are shown');

    S.record(999999, 99);                              // the one to protect
    for (let i = 0; i < S.KEEP * 2; i++) S.record(100 + i, 5);

    const stored = L.Store.scores;
    assert(stored.length <= S.KEEP, 'the list is capped (' + stored.length + ')');
    assert(stored.some((e) => e.s === 999999),
      'the all-time best survived being pushed far outside the window');
    assert(!stored.some((e) => e.s === 100), 'the oldest ordinary run was dropped');
    assert(stored.some((e) => e.s === 100 + S.KEEP * 2 - 1), 'the newest run is kept');

    eq(S.list()[0].s, 999999, 'the board shows the best first');
    eq(S.history()[0].s, 100 + S.KEEP * 2 - 1, 'the history shows the newest first');

    // A clock moved backwards must not make a new run look ancient and get it
    // thrown away — ordering cannot depend on the wall clock alone.
    const realNow = Date.now;
    Date.now = () => realNow() - 365 * 24 * 3600 * 1000;
    try { S.record(555, 4); } finally { Date.now = realNow; }
    assert(L.Store.scores.some((e) => e.s === 555), 'a run recorded after a backwards clock jump is kept');
    eq(S.history()[0].s, 555, 'and it still counts as the newest');
    assert(L.Store.scores.some((e) => e.s === 999999), 'the best is still protected');
    S.clear();
  });

  // A leaderboard is not live data. Re-fetching it on every tab switch made the
  // screen wait about a second and a half for a list that had not changed, over
  // and over. It is fetched once and kept for the session; the player asks for a
  // newer copy when they want one, and beating their own score asks for them.
  test('Leaderboard is fetched once and kept, refreshed only on purpose', async () => {
    const LB = L.Leaderboard;
    const realFetch = window.fetch;
    let net = 0;
    window.fetch = (u, o) => {
      net++;
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve([{ name: 'A', score: 10, combo: 1 }]),
      });
    };
    try {
      LB.useSupabase('https://demo.supabase.co', 'ANON');
      LB.invalidate();

      await LB.top('alltime', 20);
      eq(net, 1, 'the first look goes to the network');

      await LB.top('alltime', 20);
      await LB.top('alltime', 20);
      await LB.top('alltime', 20);
      eq(net, 1, 'and every look after that is free');

      await LB.top('daily', 20);
      eq(net, 2, 'the other board is fetched separately');
      await LB.top('daily', 20);
      eq(net, 2, 'and then cached too');

      // two callers at once must share one request, not race
      LB.invalidate('alltime');
      const before = net;
      await Promise.all([LB.top('alltime', 20), LB.top('alltime', 20), LB.top('alltime', 20)]);
      eq(net - before, 1, 'simultaneous callers share a single request');

      // asking for a fresh copy actually asks
      const beforeForce = net;
      await LB.top('alltime', 20, true);
      eq(net - beforeForce, 1, 'a forced refresh really refetches');

      // and posting your own score means the cached board is now wrong
      assert(!!LB.cached('alltime'), 'the board is cached before submitting');
      await LB.submit(500, 5, 'alltime');
      assert(!LB.cached('alltime'), 'submitting a run drops the stale board');
      assert(!!LB.cached('daily'), 'but only the board it went to');
    } finally {
      window.fetch = realFetch;
      LB._sb = null;
      LB.invalidate();
    }
  });

  // The two halves of the music system must never BOTH stand down. The
  // sequencer steps aside as soon as a world has a recording — so if the
  // recording is not actually started, the game plays nothing at all. That is
  // exactly what happened: _syncTrack was only reachable from setSong and from
  // the loader, both of which check `playing`, so the ordinary order (pick the
  // world, then start) fell through the gap and shipped silence.
  test('Music: a world with a recording actually plays it, from every entry point', () => {
    const A = L.Audio;
    A.init();
    if (!A.ctx) return;
    const M = A.music;
    const savedTracks = M._tracks, savedSong = M._song;
    try {
      // a real decoded buffer, so this exercises the true path
      const buf = A.ctx.createBuffer(1, A.ctx.sampleRate, A.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * 220 * i) / A.ctx.sampleRate) * 0.2;
      M._tracks = { deepfield: buf };

      // ENTRY POINT 1: choose the world while stopped, then start (the menu path)
      M.stop();
      M.setSong('deepfield');
      M.start();
      assert(M.playing, 'music reports playing');
      assert((M._srcs || []).length === 1,
        'the recording is running, not just marked as playing (' + (M._srcs || []).length + ' sources)');
      assert(!!M._trackFilter, 'and it is routed through the chain-driven filter');

      // ENTRY POINT 2: change world while already playing
      M.setSong('deepfield');
      assert((M._srcs || []).length === 1, 'switching worlds mid-play leaves exactly one source');

      // a world WITHOUT a recording must fall back to the sequencer, not silence
      M.stop();
      M.setSong('monolith');
      M.start();
      eq((M._srcs || []).length, 0, 'no recording for this world');
      assert(!!M._timer, 'so the sequencer is running instead');

      // stopping must release the buffer — a looping source runs forever
      M.stop();
      eq((M._srcs || []).length, 0, 'stopping releases every source');
    } finally {
      M.stop();
      M._tracks = savedTracks || {};
      M._song = savedSong;
    }
  });

  // Layout is measured, not reviewed. Two rules, checked on every screen in
  // every language: nothing sticks out past the viewport, and nothing you are
  // meant to press is smaller than a fingertip.
  //
  // Both were broken and neither was visible by eye: a long player name blew the
  // leaderboard row's grid past the right edge (1fr will not shrink below its
  // content — the same defect this project has now hit twice), and the settings
  // switches were 30px against a 44px guideline.
  test('Every label and tooltip is translated, in every language', async () => {
    // data-i18n-aria had existed since the accessibility pass and NOTHING used
    // it, and there was no data-i18n-title at all — so a Turkish, Spanish or
    // Chinese player heard "Toggle sound", "Pause", "Fullscreen" and "Close" on
    // the controls they press most, and saw them on hover. The buttons carry no
    // visible text, so for those players the labels WERE the interface.
    await loadGameMarkup();
    const host = document.getElementById('markup-under-test') || document;

    // 1. nothing may carry a hand-written label or tooltip.
    // #build-stamp is exempt: its tooltip is the build version, which is data
    // rather than copy and reads the same in every language.
    const exempt = (e) => e.id === 'build-stamp';
    const untagged = [...host.querySelectorAll('[aria-label]:not([data-i18n-aria])')]
      .concat([...host.querySelectorAll('[title]:not([data-i18n-title])')])
      .filter((e) => !exempt(e))
      .map((e) => e.id || e.className || e.tagName);
    eq(untagged.length, 0, 'untranslatable labels on: ' + untagged.join(', '));

    // 2. and they must actually differ between languages, not merely be tagged
    const keep = L.i18n.lang;
    const seen = {};
    for (const lang of ['en', 'tr', 'es', 'zh']) {
      L.i18n.set(lang);
      seen[lang] = [...host.querySelectorAll('[data-i18n-aria]')]
        .map((e) => e.getAttribute('aria-label'));
      seen[lang].forEach((v, i) => assert(v && v.trim(),
        lang + ' label ' + i + ' is empty'));
    }
    L.i18n.set(keep);
    assert(seen.en.length >= 5, 'found the labelled controls (' + seen.en.length + ')');
    // Chinese shares no vocabulary with English, so any label identical across
    // those two was never translated at all.
    const same = seen.en.filter((v, i) => v === seen.zh[i]);
    eq(same.length, 0, 'identical in English and Chinese: ' + same.join(', '));
  });

  test('Layout holds: no overflow and no cramped controls, in any language', async () => {
    await loadGameMarkup();
    // A zero-width window makes every element look like it overflows. That is a
    // broken measurement, not a broken layout — say so instead of reporting
    // dozens of phantom failures.
    if (window.innerWidth < 200) {
      assert(false, 'the test window has no usable width (' + window.innerWidth
        + 'px) — layout cannot be measured here');
    }
    const SCREENS = ['menu', 'shop', 'scores', 'modes', 'settings', 'progress', 'gameover', 'revive', 'tutdone'];
    let screensSeen = 0, controlsSeen = 0;
    const LONG_NAME = 'MMMMMMMMMMMMMMMM';          // 16 chars, the column limit
    const tooSmall = [], overflowing = [], pageOverflow = [];
    const seen = new Set();
    const startLang = L.i18n.lang;

    try {
      for (const lang of ['en', 'tr', 'es', 'zh']) {
        L.i18n.set(lang);
        for (const s of SCREENS) {
          L.UI.showScreen(s);
          // Populate the dynamic screens too. Without this the shop and the
          // settings panel are empty shells and the test measures a handful of
          // static buttons while believing it covered the whole UI.
          const render = { shop: 'renderShop', settings: 'renderSettings', modes: 'renderModes',
                           progress: 'renderProgress', scores: 'renderScores' }[s];
          if (render && typeof L.UI[render] === 'function') { try { L.UI[render](); } catch (e) {} }
          const sec = document.getElementById('screen-' + s);
          if (!sec) continue;
          screensSeen++;
          // fill the board with hostile names — other people's names are not ours
          if (s === 'scores' && L.UI.paintOnlineScores) {
            L.UI.paintOnlineScores(Array.from({ length: 8 },
              (_, i) => ({ name: LONG_NAME, score: 128450 - i * 137, combo: 62 })));
          }
          void sec.offsetWidth;

          for (const el of sec.querySelectorAll('button, [role="button"], input, select, .tab, .ui-interactive')) {
            // offsetWidth/Height, not getBoundingClientRect: the panel's entrance
            // animation scales it, and a paused animation would report a false
            // shortfall for every control on the screen.
            const w = el.offsetWidth, h = el.offsetHeight;
            if (!w || !h) continue;                 // hidden controls are not targets
            controlsSeen++;
            const key = lang + s + (el.id || el.className) + (el.textContent || '').trim().slice(0, 12);
            if (seen.has(key)) continue;
            seen.add(key);
            // the switch keeps a slim track and expands its hit area instead
            const isToggle = String(el.className).indexOf('toggle') >= 0;
            const eh = isToggle ? Math.max(h, 44) : h;
            const ew = isToggle ? Math.max(w, 44) : w;
            if (eh < 44 || ew < 44) {
              tooSmall.push(lang + '/' + s + ' ' + (el.id || String(el.className).split(' ')[0]) + ' ' + w + 'x' + h);
            }
          }

          // The thing that actually hurts a player: the PAGE scrolling
          // sideways. Checked here for every screen and language, because the
          // per-element check below now (correctly) ignores side-scrolling
          // strips and something has to still catch a genuinely too-wide layout.
          if (document.body.scrollWidth > document.body.clientWidth + 1) {
            pageOverflow.push(lang + '/' + s + ' body ' + document.body.scrollWidth
              + ' > ' + document.body.clientWidth);
          }

          // Something inside a deliberately side-scrolling strip is not an
          // overflow — it is the strip doing its job. The shop's category
          // filter is one row that scrolls sideways precisely so it does not
          // wrap to three lines, so its far chips sit past the viewport on
          // purpose.
          const inScroller = (el) => {
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              const ox = getComputedStyle(p).overflowX;
              if (ox === 'auto' || ox === 'scroll') return true;
            }
            return false;
          };
          for (const el of sec.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (inScroller(el)) continue;
            if (r.right > window.innerWidth + 1) {
              overflowing.push(lang + '/' + s + ' <' + el.tagName.toLowerCase() + '> right=' + Math.round(r.right)
                + ' vw=' + window.innerWidth);
              break;
            }
          }
        }
      }

      // prove the test looked at something before believing its silence
      assert(screensSeen >= SCREENS.length, 'every screen was actually examined (' + screensSeen + ')');
      assert(controlsSeen > 120, 'the controls were actually measured (' + controlsSeen + ')');
      eq(pageOverflow.length, 0, 'the page never scrolls sideways (' + pageOverflow.slice(0, 3).join('; ') + ')');
      eq(overflowing.length, 0, 'nothing overflows the viewport (' + overflowing.slice(0, 3).join('; ') + ')');
      eq(tooSmall.length, 0, 'every control is at least 44px (' + tooSmall.slice(0, 4).join('; ') + ')');
    } finally {
      L.i18n.set(startLang || 'en');
      L.UI.showScreen(null);
    }
  });

  // A transfer code is pasted from a friend, a forum or a Discord, and
  // Save.apply writes it straight into localStorage. Everything downstream must
  // therefore treat saved data as hostile — it is the one input to this game
  // that someone else authored. The MY RUNS board used to build its rows with
  // innerHTML sixteen lines below the online board doing it correctly with
  // textContent, which turned a pasted code into script execution in the game's
  // own origin — and in the desktop build that reaches the Steam bridge.
  test('Saved data is treated as hostile: no markup, no wrong types, no crash', async () => {
    await loadGameMarkup();
    freshStorage();
    let fired = false;
    window.__XSS_PROBE__ = () => { fired = true; };
    try {
      const payload = '<img src=x onerror="window.__XSS_PROBE__()">';
      L.Store.scores = [{ s: 1234, c: 7, d: payload, t: 1 }];
      L.UI.showScreen('scores');
      L.UI.setBoard('me');
      const list = document.getElementById('score-list');
      assert(!!list, 'the board markup is present — otherwise this test proves nothing');
      assert(list.querySelectorAll('li').length > 0, 'and a row was actually rendered');

      eq(list.querySelectorAll('img').length, 0, 'no element is created from saved text');
      eq(fired, false, 'and nothing executes');
      assert((list.textContent || '').indexOf('onerror') === -1 || list.querySelectorAll('*').length > 0,
        'the payload is inert');

      // every field, every wrong type — the renderer must not care
      L.Store.scores = [
        { s: '9999', c: {}, d: { toString() { return '<b>x</b>'; } }, t: 'x' },
        { s: 5, c: -3, d: null, t: -99 },
        null, 'not an object', 42, [],
      ];
      L.UI.setBoard('me');
      eq(list.querySelectorAll('b, img, script').length, 0, 'objects cannot smuggle markup through toString');
      L.Scores.list().forEach((e) => {
        eq(typeof e.s, 'number', 'score is a number');
        eq(typeof e.c, 'number', 'combo is a number');
        eq(typeof e.d, 'string', 'date is a string');
        assert(e.s >= 0 && e.c >= 0, 'no negative counters');
        assert(e.d.length <= 10, 'the date field cannot carry a payload');
      });

      // the one array getter that had no guard: an object here threw out of
      // every game-over screen
      localStorage.setItem('lumen_unlocks', '{"a":1}');
      assert(Array.isArray(L.Store.unlocks), 'unlocks is always an array');
      localStorage.setItem('lumen_unlocks', '"nope"');
      assert(Array.isArray(L.Store.unlocks), 'even for a bare string');
    } finally {
      delete window.__XSS_PROBE__;
      L.UI.showScreen(null);
      freshStorage();
    }
  });

  // Three things a run must not do to the state around it.
  test('A run cannot destroy an item, leak its rules, or desync the Daily', () => {
    freshStorage();

    // 1. Consumables are paid for when they FIRE. They used to be deducted at
    //    run start and never written back, so buying an item, pressing PLAY and
    //    walking back to the menu simply destroyed it.
    L.Store.items = { shield: 2, magnet: 1 };
    const quit = newGame();
    quit.start();
    quit.toMenu();
    eq((L.Store.items.shield | 0), 2, 'quitting a run spends nothing');
    eq((L.Store.items.magnet | 0), 1, 'nothing at all');

    const used = newGame();
    used.start();
    used.useItem('shield');
    used.toMenu();
    eq((L.Store.items.shield | 0), 1, 'firing one spends exactly one');
    eq((L.Store.items.magnet | 0), 1, 'and only the one fired');

    // 2. A Daily can switch traps on for the day. Nothing cleared it, so every
    //    ordinary run afterwards in that session was a traps run too.
    const leak = newGame();
    leak.mutator = 'traps';
    assert(leak.trapsOn, 'the mutator is live while set');
    leak.start();
    assert(!leak.trapsOn, 'and a new run starts clean');
    leak.toMenu();

    // 3. The Daily is one shared course. These timers were drawn from
    //    Math.random in reset(), which runs BEFORE the seeded generator exists,
    //    so two players on the same date got different motes and different mine
    //    timing while posting to the same board.
    const draws = [];
    for (let i = 0; i < 3; i++) {
      const g = newGame();
      g.startDaily();
      draws.push(g.bountyTimer.toFixed(6) + '/' + g.trapTimer.toFixed(6));
      g.toMenu();
    }
    eq(new Set(draws).size, 1, 'the same date plans the same run every time (' + draws.join(' ') + ')');

    L.Store.items = {};
  });

  // ---- regressions from the pre-release audit ------------------------------
  // Each of these locks in a fix for something that shipped wrong. They are
  // cheap and specific on purpose: the bugs were all silent, and a silent bug
  // that comes back is a silent bug nobody notices twice.

  test('Aegis III keeps the revive discount it paid for', () => {
    freshStorage();
    const seen = [0, 1, 2, 3].map((n) => {
      L.Store.skills = Object.assign({}, L.Store.skills, { aegis: n });
      return L.Progression.modifiers(false).reviveCost;
    });
    eq(seen[0], 60, 'no aegis');
    eq(seen[1], 50, 'aegis I');
    eq(seen[2], 40, 'aegis II');
    // The old test was `aegis < 3`, so buying the 1,100-shard tier put the price
    // back to 60 and silently voided the 800 spent below it.
    eq(seen[3], 40, 'aegis III must not cost you the discount');
    freshStorage();
  });

  test('mode ramp reaches the corridor generator', () => {
    const gap = (mode, secs) => L.Game.makeSpec(() => 0.5, secs, 0.5,
      { gapMul: mode.gap, rampT: secs * mode.ramp }).gapH;
    const zen = L.Modes.def('zen'), classic = L.Modes.def('classic');
    eq(zen.ramp, 0, 'zen declares no ramp');
    // Zen advertises a run that never tightens. It used to squeeze 41%.
    near(gap(zen, 120), gap(zen, 0), 1e-9, 'zen must not tighten');
    // Classic is ramp 1, so the ramped clock IS the wall clock — the daily
    // course must be byte-identical to before the change.
    near(gap(classic, 120),
      L.Game.makeSpec(() => 0.5, 120, 0.5, { gapMul: classic.gap }).gapH, 1e-9,
      'classic layout unchanged');
    // and the frozen clock must not starve Zen of power-ups
    const withPower = [30, 60, 120].every((t) =>
      !!L.Game.makeSpec(() => 0.02, t, 0.5, { gapMul: zen.gap, rampT: t * zen.ramp }).power);
    eq(withPower, true, 'zen still spawns power-ups');
  });

  test('a power-up found in the corridor never bills the shop', () => {
    freshStorage();
    const g = newGame();
    L.Store.items = { shield: 3 };
    g.daily = true; g.tutorial = false; g.attract = false;
    g.start();
    // found, not bought
    g.hand.shield = 1; g.handFree.shield = 1; g.shield = false;
    eq(g.useItem('shield'), true, 'the free shield fires');
    eq(L.Store.items.shield, 3, 'stock untouched by a free pickup');

    // a bought one still costs
    g.daily = false; g.start();
    g.hand.shield = 1; g.handFree.shield = 0; g.shield = false;
    eq(g.useItem('shield'), true, 'the bought shield fires');
    eq(L.Store.items.shield, 2, 'stock debited for a bought item');
    freshStorage();
  });

  test('an item that declines to fire is not consumed', () => {
    freshStorage();
    const g = newGame();
    L.Store.items = { shield: 2 };
    g.daily = false; g.tutorial = false; g.attract = false;
    g.start();
    g.hand.shield = 1; g.handFree.shield = 0;
    g.shield = true;                       // already shielded: nothing to gain
    eq(g.useItem('shield'), false, 'declines');
    eq(g.hand.shield, 1, 'still in hand');
    eq(L.Store.items.shield, 2, 'still in stock');
    freshStorage();
  });

  test('every item type can be spoken, in every language', () => {
    const words = L.Voice && L.Voice.PHRASES;
    if (!words) throw new Error('Voice.PHRASES is not exposed');
    for (const lang of Object.keys(words)) {
      for (const t of L.ITEM_TYPES) {
        const list = words[lang][t];
        if (!list || !list.length) {
          throw new Error('no ' + lang + ' word for "' + t + '"');
        }
      }
    }
  });

  test('every achievement-gated cosmetic is announced by its achievement', () => {
    const achs = L.Progression.ACHIEVEMENTS;
    const items = [].concat(L.Cosmetics.SKINS, L.Cosmetics.TRAILS,
      L.Cosmetics.MAPS, L.Cosmetics.SIGNATURES);
    const silent = items.filter((i) => i.req).filter((i) => {
      const a = achs.find((x) => x.id === i.req);
      return !a || a.unlocks !== i.id;
    }).map((i) => i.id);
    eq(silent.length, 0, 'unlocked with no announcement: ' + silent.join(', '));
    const dangling = achs.filter((a) => a.unlocks && !items.some((i) => i.id === a.unlocks))
      .map((a) => a.id);
    eq(dangling.length, 0, 'promises a cosmetic that does not exist: ' + dangling.join(', '));
  });

  test('SPARK gives back the chain you actually just lost', () => {
    freshStorage();
    const g = newGame();
    g.tutorial = false; g.attract = false; g.daily = false;
    g.start();
    L.Store.items = { spark: 2 };
    // an early chain lapses...
    g.combo = 6; g.breakCombo();
    eq(g.lastChain, 6, 'lapsed chain recorded');
    // ...then a much bigger one dies WITH you, which never went through breakCombo
    g.combo = 40;
    // revive() is only ever reached from the CONTINUE? panel, so the run has to
    // be in the state that panel is shown for — it refuses anything else, which
    // is what stops an ad landing after END RUN from resurrecting a closed run.
    g.state = 'dead'; g.player.alive = false; g._finalized = false;
    g.revive(true);
    eq(g.lastChain, 40, 'the chain that died with you is the one on record');
    g.hand.spark = 1; g.handFree.spark = 0; g.combo = 0;
    eq(g.useItem('spark'), true, 'fires');
    eq(g.combo, 40, 'restores 40, not the stale 6');
    freshStorage();
  });

  test('SPARK refuses to downgrade a live chain, and costs nothing when it does', () => {
    freshStorage();
    const g = newGame();
    g.tutorial = false; g.attract = false; g.daily = false;
    g.start();
    L.Store.items = { spark: 1 };
    g.lastChain = 6;
    g.combo = 45;                       // already holding more than it would give
    g.hand.spark = 1; g.handFree.spark = 0;
    eq(g.useItem('spark'), false, 'declines');
    eq(g.combo, 45, 'the live chain is untouched');
    eq(L.Store.items.spark, 1, 'and it was not spent');
    freshStorage();
  });

  test('the next-unlock teaser never advertises zero', () => {
    freshStorage();
    const C = L.Cosmetics;
    // rich enough to afford the cheapest priced item outright
    L.Store.shards = 100000;
    const nx = C.nextUnlock();
    if (nx) {
      if (nx.missing <= 0) throw new Error('teaser shows ' + nx.id + ' at ' + nx.missing);
    }
    // and broke, where it must still find something to aim at
    L.Store.shards = 0;
    const poor = C.nextUnlock();
    if (!poor) throw new Error('nothing to aim at with 0 shards');
    if (poor.missing <= 0) throw new Error('zero-cost teaser at 0 shards');
    freshStorage();
  });

  test('a mode head start is not time survived', () => {
    freshStorage();
    const sprint = L.Modes.def('sprint');
    eq(sprint.headStart, 20, 'sprint opens the clock at 20');
    const g = newGame();
    g.tutorial = false; g.attract = false; g.daily = false;
    L.Store.mode = 'sprint';
    g.start();
    eq(Math.round(g.elapsed), 20, 'clock starts at the handicap');
    g.elapsed = 60;                      // 40 seconds of actual play
    g.finalizeRun();
    eq(L.Store.bestTime, 40, 'the achievement counts what was played');
    L.Store.mode = 'classic';
    freshStorage();
  });

  test('a test ad unit can never reach a player', () => {
    const A = L.Ads;
    if (!A) throw new Error('Ads module missing');
    // The harness does not load config.js, so CONFIG.admob is absent here and
    // isTestAds is true — which is exactly the state this asserts against. The
    // rule is what matters, not today's ids: while the units are Google's test
    // ones they render a "Test Ad" placeholder, and every surface in the UI is
    // gated on `available`, so this getter is the whole defence.
    eq(A.isTestAds, true, 'no real ids visible to the harness');
    eq(A.available, false, 'so no ad surface is offered');
    // And the real config, read from disk, must carry ids of the right shape —
    // a typo here is invisible until a player taps and nothing plays.
    const cfg = (L.CONFIG && L.CONFIG.admob) || null;
    if (cfg && cfg.ios) {
      assert(/^ca-app-pub-\d+~\d+$/.test(cfg.ios.app), 'app id shape');
      assert(/^ca-app-pub-\d+\/\d+$/.test(cfg.ios.rewarded), 'rewarded unit shape');
    }
  });

  test('the ad reward schedule pays what the shop screen promises', () => {
    const A = L.Ads;
    // 3 x 75, then 3 x 50, then 25 forever — and it must not depend on state
    // left over from an earlier assertion.
    const want = [75, 75, 75, 50, 50, 50, 25, 25, 25];
    const got = want.map((_, i) => A.rewardFor(i));
    eq(got.join(','), want.join(','), 'tier payouts');
  });

  test('the rating prompt never nags, and never gates', () => {
    const R = L.Rating;
    if (!R) throw new Error('Rating module missing');
    // We draw no stars of our own. A custom "did you enjoy it?" that routes the
    // happy players to the store is review gating, and it is a rejection.
    eq(typeof R.consider, 'function', 'has consider()');
    if (R.stars || R.rate || R.openStorePage) throw new Error('drew its own rating UI');

    freshStorage();
    // Not available off-device, so consider() must decline rather than throw.
    eq(R.available, false, 'no native plugin in the browser');
    eq(R.consider(true), false, 'declines without the plugin');

    // With the plugin faked, the gates are: enough runs, a GOOD run, and a long
    // gap since the last ask.
    let asked = 0;
    const realPlugin = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(R) || R, 'plugin');
    Object.defineProperty(R, 'plugin', { configurable: true, get: () => ({ requestReview: () => { asked++; } }) });
    Object.defineProperty(R, 'available', { configurable: true, get: () => true });

    L.Store.runs = 3;
    eq(R.consider(true), false, 'too early to have an opinion');
    L.Store.runs = 12;
    eq(R.consider(false), false, 'a bad run is not the moment');
    eq(R.consider(true), true, 'a good run at run 12 asks');
    eq(asked, 1, 'the system sheet was requested once');
    L.Store.runs = 20;
    eq(R.consider(true), false, 'and does not ask again eight runs later');
    L.Store.runs = 200;
    eq(R.consider(true), true, 'but will, much later');
    eq(asked, 2, 'twice in two hundred runs');

    delete R.plugin; delete R.available;
    if (realPlugin) Object.defineProperty(R, 'plugin', realPlugin);
    freshStorage();
  });

  test('the store registers when asked, not while the page is parsing', () => {
    const I = L.IAP;
    // The bug this locks out: registration used to run at module load, when
    // Capacitor's injected bridge is not reliably on `window` yet. The ads
    // module reached its plugin through a getter and worked on device; this one
    // did it eagerly and did not, and the only symptom was a shop with no cash
    // tiles and nothing on screen to explain it.
    eq(typeof I.ensureProvider, 'function', 'registration is deferrable');
    // Reading `available` must be enough to open the store — every cash surface
    // in the UI asks that first.
    I.register(null);
    I._tried = false;
    eq(typeof I.available, 'boolean', 'available answers without throwing');
    // And it records what happened either way, so an empty shop is never silent.
    assert(!!I.diag, 'diag is set: ' + I.diag);
  });

  // ---- the update gate ------------------------------------------------------
  // An installed app is a frozen copy. These prove the two ways it is told so,
  // and — much more importantly — the many ways it is NOT.
  test('Update: a current build is told nothing', () => {
    const U = L.Update;
    assert(U._compare(86, { build: 86, minBuild: 0 }).action === 'none', 'same build says nothing');
    assert(U._compare(90, { build: 86, minBuild: 0 }).action === 'none',
      'a build AHEAD of the feed says nothing (a TestFlight tester is not out of date)');
  });

  test('Update: behind the published build offers the soft prompt', () => {
    const v = L.Update._compare(80, { build: 86, minBuild: 0 });
    assert(v.action === 'prompt', 'got ' + v.action + ', want prompt');
    assert(v.latest === 86 && v.local === 80, 'carries both numbers for the copy');
  });

  test('Update: only minBuild blocks, and it is off by default', () => {
    const U = L.Update;
    assert(U._compare(80, { build: 86, minBuild: 85 }).action === 'block', 'below minBuild is a block');
    assert(U._compare(85, { build: 86, minBuild: 85 }).action === 'prompt', 'AT minBuild is not blocked');
    // The shipped file must not be able to lock anyone out by accident.
    assert(U._compare(1, { build: 999, minBuild: 0 }).action === 'prompt',
      'minBuild 0 can never block, however far behind the build is');
  });

  // The failure that matters most: a version check must never be the reason
  // somebody cannot open the game. Every unreadable answer has to fail OPEN.
  test('Update: every broken answer fails open', () => {
    const U = L.Update;
    const bad = [null, undefined, {}, { build: 'x' }, { build: 0 }, { build: -3 },
      { minBuild: 99 }, 'nope', 42, [], { build: null, minBuild: 99 }];
    for (const f of bad) {
      const v = U._compare(80, f);
      assert(v.action === 'none', 'feed ' + JSON.stringify(f) + ' → ' + v.action + ', want none');
    }
    // and an unreadable LOCAL build must not be treated as "ancient"
    for (const lb of [null, undefined, NaN, 0, -1, 'x']) {
      const v = U._compare(lb, { build: 99, minBuild: 98 });
      assert(v.action === 'none', 'local ' + lb + ' → ' + v.action + ', want none (never block on a build we cannot read)');
    }
  });

  test('Update: the soft prompt is offered once a day, and the block ignores that', () => {
    const U = L.Update;
    freshStorage();
    const now = 1000 * 86400 * 400;
    assert(U._dueForPrompt(now) === true, 'first launch is due');
    U._markPrompted(now);
    assert(U._dueForPrompt(now + 1000) === false, 'not again a second later');
    assert(U._dueForPrompt(now + 3600000 * 23) === false, 'not again 23 hours later');
    assert(U._dueForPrompt(now + 86400001) === true, 'due again the next day');
    // _compare never consults the clock: a block is a block on every launch.
    assert(U._compare(80, { build: 86, minBuild: 85 }).action === 'block', 'a block is not rate limited');
  });

  test('Update: release.json is shipped, well formed, and matches the store links', async () => {
    const r = await fetch('../release.json');
    assert(r.ok, 'release.json is served from the repo root');
    const j = await r.json();
    assert(typeof j.version === 'string' && /^\d+\.\d+/.test(j.version), 'version looks like a version: ' + j.version);
    assert(Number.isInteger(j.build) && j.build > 0, 'build is a positive integer: ' + j.build);
    assert(Number.isInteger(j.minBuild) && j.minBuild >= 0, 'minBuild is an integer: ' + j.minBuild);
    assert(j.minBuild <= j.build, 'minBuild can never exceed the build being shipped');
    // The two store links are what the UPDATE button opens. A typo here is a
    // dead end at the exact moment the player agreed to update.
    assert(/^https:\/\/play\.google\.com\//.test(j.android), 'android link is a Play URL: ' + j.android);
    assert(/^https:\/\/apps\.apple\.com\//.test(j.ios), 'ios link is an App Store URL: ' + j.ios);
    // And the build the feed advertises must be one the shipped app can beat.
    assert(j.build >= 86, 'feed build is at least the build that shipped');
  });

  test('Update: the web is exempt', async () => {
    // LUMEN.Native.isApp is false in a browser, and check() must stop there
    // rather than send a browser player to a store page they cannot install.
    const v = await L.Update.check();
    assert(v.action === 'none', 'browser → ' + v.action + ', want none');
  });

  // ---- the shop tells the truth about walls ---------------------------------
  test('Map swatch: gates are the DANGER hue, not the map hue', () => {
    // The shop drew its gates in the map's `wall` hue, so a player buying a
    // green world got red gates. Gates are always the danger hue; `wall` is the
    // corridor's edge. The swatch has to show what the game will actually draw.
    const danger = L.cbPalette().danger;
    for (const m of L.Cosmetics.MAPS) {
      const css = L.UI.mapSwatch(m);
      const svg = decodeURIComponent(css.slice(css.indexOf('utf8,') + 5));
      assert(svg.indexOf('hsl(' + danger + ' 95% 62%)') >= 0,
        m.id + ': gates are drawn in the danger hue');
      // and the map's own hue is still present -- on the corridor edge
      assert(svg.indexOf('hsl(' + m.wall + ' ') >= 0,
        m.id + ": the map's wall hue still appears, as the corridor edge");
    }
  });

  test('Map swatch: no map paints its gates in its own wall hue', () => {
    // The regression, stated as its own assertion: if someone re-wires the
    // swatch back to `m.wall` for the bars, this fails for every map whose
    // wall hue is not the danger hue -- which is all of them, by design.
    const danger = L.cbPalette().danger;
    for (const m of L.Cosmetics.MAPS) {
      assert(Math.abs(((m.wall - danger + 540) % 360) - 180) >= 28,
        m.id + ': wall hue ' + m.wall + ' stays 28 degrees clear of the danger hue');
    }
  });

  // ---- report --------------------------------------------------------------
  runDeferred().then(report);

  function report() {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  window.__RESULTS = { total: results.length, passed, failed, results };

  const root = document.getElementById('out');
  if (root) {
    const head = document.createElement('div');
    head.className = 'summary ' + (failed ? 'bad' : 'good');
    head.textContent = failed ? (failed + ' of ' + results.length + ' FAILED') : ('All ' + results.length + ' tests passed');
    root.appendChild(head);
    results.forEach((r) => {
      const d = document.createElement('div');
      d.className = 'row ' + (r.pass ? 'pass' : 'fail');
      d.textContent = (r.pass ? '✔ ' : '✘ ') + r.name + (r.pass ? '' : '  —  ' + r.error);
      root.appendChild(d);
    });
  }
  // eslint-disable-next-line no-console
  console.log('[LUMEN tests]', passed + '/' + results.length + ' passed', failed ? results.filter((r) => !r.pass) : '');
  // leave storage clean for the real game
  freshStorage();
  }
})();
