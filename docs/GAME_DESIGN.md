# LUMEN — Game Design Document

*A one-page-ish GDD for a hypercasual arcade game engineered to scale.*

---

## 1. High concept

> **You are a spark of light. Tap to flip gravity, thread the gaps, and chain
> the light into a slow-motion flow.**

One-button, one-hit, endless. A gravity-flip weaver dressed in reactive
synthwave neon, with a greed-driven combo/flow system layered on top of the
survival loop to create risk, stories, and shareable moments.

- **Genre:** hypercasual arcade / endless / high-score chaser
- **Sessions:** 20–90 seconds per run, infinitely repeatable
- **Platform:** web-first (mobile + desktop), wrappable for app stores
- **Input:** a single binary action (tap / click / space)

## 2. The core loop

```
        ┌─────────────────────────────────────────────┐
        │  TAP to flip gravity  →  thread the gap      │
        │        ↑                        ↓            │
        │  chase the high        grab a mote (+combo)  │
        │        ↑                        ↓            │
        │  FLOW STATE  ←  chain 16  ←  multiplier up   │
        └─────────────────────────────────────────────┘
                     die → "so close" → RETRY
```

Every layer feeds the next: surviving earns points, greed earns motes, motes
earn combo, combo earns flow, flow earns the screenshot, the screenshot earns
the next player.

## 3. Mechanics

### Movement
- The orb is pulled toward one wall by gravity. A flip reverses the pull.
- Resting velocity is zeroed at each wall, so a flip always starts clean.
- **Skill = timing the flip mid-transit** to be at the right height as a gap
  passes. Threading a centre gap is a deliberately-timed flip, not luck.
- Gravity is tuned to a **~0.72 s wall-to-wall fall** — floaty enough to feel
  fair and controllable, tight enough to demand commitment.

### Motes & combo
- Glowing motes sit on or near the natural path (85% of gates carry one, plus
  free-floaters). Grabbing one: `+combo`, refreshes a decaying combo timer.
- Score per mote = `10 × multiplier`, where `multiplier = 1 + floor(combo / 4)`,
  capped at ×12.
- The combo timer decays (≈2.2–3.6 s), so the multiplier is a resource you have
  to keep *feeding* — it pushes players to take gaps aggressively.

### Flow state (the hook)
- At **combo 16**, the game enters **flow**: `timeScale → 0.62` (bullet-time),
  the palette ignites magenta, bloom + vignette intensify, and the soundtrack
  reaches full intensity. A "FLOW!" burst punctuates the entry.
- Flow makes you *better* (slow-mo = more reaction time) precisely when the game
  is fastest — a power-fantasy pay-off for greed, not a difficulty spike.
- Colour language holds under flow: **hero stays cyan, reward stays gold, danger
  owns magenta** — the world changes mood without ever confusing the read.

### Difficulty ramp (procedural, time-based)
| Time | Reaction window | Gate spacing | Gap size | New threat |
| --- | --- | --- | --- | --- |
| 0 s | 2.7 s | 1.55 s | 35% | — |
| 15 s | 2.4 s | 1.4 s | 32% | — |
| 30 s | 2.2 s | 1.2 s | 28% | moving gates appear |
| 45 s | 1.9 s | 1.0 s | 25% | moving gates common |
| 60 s+ | 1.5 s (cap) | 0.92 s (cap) | 20% (cap) | full pressure |

Reaction window scales with screen **width**, so difficulty feels identical on a
phone and a monitor. Everything caps ~67 s in, making a great run a test of
execution, not a war of attrition.

## 4. Feel / juice checklist

Feel is the product. Implemented:
- particle bursts (collect, flip, pass, crash) with additive glow
- fading light trail on the orb + a crisp white core so the hero always reads
- chromatic RGB-split on the hero, scaling with speed and flow
- screen shake (crash, flow entry), white flash (collect/flow), red flash (death)
- squash-and-stretch on flip
- floating score/`FLOW!`/combo popups
- time-dilation on flow entry
- reactive background: parallax star-dust + drifting nebulae + a palette that
  hue-shifts with flow
- haptics (collect / flow / crash) on supported devices
- adaptive audio that layers bass → arp → lead as the combo climbs

## 5. Audio direction

Everything is synthesised live (Web Audio) — **no sample files ship.**
- **SFX:** flip blip, combo-pitched collect (climbs a pentatonic ladder), crash
  (noise + descending saw + sub thump), flow chord, UI, new-best fanfare.
- **Music:** a 124-BPM synthwave sequencer over an Am–F–C–G loop with synth
  kick/hats/clap; layers unlock with combo intensity (0→3) and fade in musically.

## 6. Retention & monetisation (built)

- **Daily run** — one seeded layout per day, leaderboard, streak. ✅
- **Cosmetics** — 25 orb skins, 13 trails, 11 worlds, 8 signatures and 4 sets.
  The only things sold, and none of it touches how the game plays. ✅
- **Missions** — three rotating goals, light dopamine + session goals. ✅
- **Achievements** — 26 across five categories, paying shards, four of them
  handing over a skin that has **no price at all**. ✅
- **Consumables** — a shard sink you carry into a run, hard-capped. ✅
- **Rewarded continue** — a single revive per run; the seam is in place. ✅
- **Share-to-grow** — the run composites into a 1200×630 card. ✅

Guiding rule: **never tax the core loop.** The game is the funnel; monetise the
edges (cosmetics, optional continues), not the fun.

### The two-currency deal

Every skin and trail carries **both** a shard price and a cash price, and the two
scales are deliberately shaped differently:

| Tier | Shards | Cash |
| --- | --- | --- |
| Cheap | 550 | $0.99 |
| Mid | 1,400 | $1.49 |
| Premium | 4,500 | $2.49 |
| Elite | 9,000 | $3.49 |

The shard axis spans **16×** from cheap to elite; the cash axis spans **3.5×**.
That's the whole design: shards make the elite tier a genuine long-term goal
(the cheapest skin is already well beyond "play ten runs and own it"), while
money never asks for much and never asks for much *more* to get the best one.
Nobody is priced out, and nobody can trivially buy the whole catalogue's worth of
prestige — because the four best skins **aren't for sale in either currency.**

**Maps are shard-only.** Progression you can see should be earned, so the worlds
you unlock are the one thing money cannot skip.

No payment SDK ships. `js/iap.js` is a provider interface; until a provider is
registered the cash buttons don't render at all.

## 7. Roadmap

- **v1.0 (core slice):** full core loop, flow, adaptive audio, mobile, PWA. ✅
- **v1.1 (meta layer):** shards economy, cosmetic shop (6 orb skins + 5 trails),
  rotating missions, daily seeded challenge + streak, near-miss rewards,
  extra gate archetypes (pulsing + double gaps). ✅ **Built.**
- **v1.2 (retention + hardening):** local top-10 leaderboard, paid **revive**
  (one per run, with a grace shield), settings + accessibility, deterministic
  daily course planning, and a 42-case automated test suite. ✅ **Built.**
- **v1.3 (reach + trust):** online leaderboards (daily + all-time), gamepad,
  share-image cards, opt-in telemetry + privacy policy, colour-vision presets,
  four languages, interactive tutorial. ✅ **Built.**
- **v1.4 (depth + storefront):** 6 maps, dual-currency store with an IAP seam,
  14 skins / 8 trails incl. four earn-only, 26 achievements, 5 skill lines,
  carryable consumables with in-run buttons, voice control, difficulty levels,
  Español + 中文. ✅ **Built.**
- **v1.5 (next):** portal / split-gap gates, limited-time events, seasonal map
  rotation, store wrap (Play / App Store).

### Economy tuning (as shipped)
- **Shards per run** = `floor(score / 120) + motes + floor(flowSec × 3)` — a good
  run pays ~40–80, plus mission bonuses (25–80 each) and achievement payouts
  (20–400 one-offs).
- **Prices:** see the tier table above — cheap 550 through elite 9,000, plus maps
  at 0 → 4,800 shards. The cheapest cosmetic is roughly 8–12 good runs, the elite
  tier is a project. Cosmetics never affect gameplay; hero/reward/danger colours
  stay distinct under every skin *and* every map.
- **Consumables:** shield 320, magnet 240, slow 260 — priced above a single run's
  income on purpose, and capped at one of each / three total so no amount of
  shards converts into an easy run.
- **Revive: 60 shards, once per run, disabled in the daily.** It's a *sink* that
  competes with cosmetics, which is the point — spending to save a hot run should
  feel like a real trade-off, not a formality. It clears the road ahead, drops the
  combo (the chain is genuinely lost) and grants a 2 s shield so the continue is
  never an instant re-death.

### Fairness rules the code enforces
These are invariants, not intentions — the test suite asserts them:
1. **No unavoidable deaths.** Every gap is generated in playfield *fractions* with
   padding that already accounts for a moving gate's full travel, so an opening can
   never slide behind a wall. Verified across 6,000 generated gates at every
   difficulty.
2. **One layout, every device.** Because obstacles are fractions, the same course
   plays identically on a phone and a monitor — and survives a mid-run resize
   (an iOS URL bar collapsing no longer strands a gap off-screen).
3. **The daily is genuinely shared.** The whole course is planned up front from the
   date seed, so frame rate, screen size and time spent in slow-mo flow can't shift
   it between players. It also **ignores every skill, every carried item and the
   difficulty setting** — if it's the one course everybody runs, it has to be a
   test of hands, not of wallet.
4. **Nothing collectable is ever placed inside a wall.** A mote that looks
   reachable but sits in a bar is the game lying to you. Free motes are checked
   against the slice of a gate that stays open *for all time* — not the opening as
   it happens to look that frame — and are placed clear of the line new gates
   enter on, because a gate that doesn't exist yet can't be checked against.
   Verified across 12 viewports × 3 difficulties; the bug this replaced only
   appeared on some screen sizes, so a single-resolution test would have shipped it.
5. **Money buys no advantage.** The only things purchasable with cash are skins and
   trails. Maps cost shards, skills cost shards, items cost shards, and the four
   best skins cost neither — they're earned or not owned.

## 8. Why it can reach millions

It hits the exact profile of games that already have: a three-second learning
curve, a bottomless skill ceiling, a run length built for a bus stop, feel that
makes losing *fun*, and a signature moment (flow) that's built to be shared.
It weighs almost nothing, loads instantly, and runs on anything with a browser —
so the distribution ceiling is "everyone with a phone."
