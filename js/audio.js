/*
 * LUMEN — Audio Engine
 * -------------------------------------------------------------
 * Every SFX and every adaptive layer is synthesized here. The six world
 * themes are the one exception: recorded tracks loaded by useTrack() (see
 * NOTICE), with this engine as the fallback when one is missing. Everything
 * is generated at runtime with the Web Audio API so the whole
 * game ships as a few tiny text files.
 *
 * Public surface (window.LUMEN.Audio):
 *   init()                     - create context (call on first user gesture)
 *   unlock()                   - resume context if suspended
 *   sfx(name, opts)            - one-shot sound effect
 *   music.start() / .stop()
 *   music.setIntensity(0..3)   - adaptive layers (bass -> arp -> lead -> flow)
 *   setMuted(bool) / toggleMuted() -> bool
 *   isMuted
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  // ---- Music theory helpers ------------------------------------------------
  const A4 = 440;
  const mtof = (m) => A4 * Math.pow(2, (m - 69) / 12); // midi -> hz
  const clampNum = (v, a, b) => (v < a ? a : v > b ? b : v);

  // A minor -> F -> C -> G, one bar each. Roots as MIDI notes.
  // Two four-bar sections. A long run used to hear the same eight seconds on
  // repeat; alternating an A and a B section doubles the loop and gives the
  // soundtrack somewhere to go.
  const PROG_A = [
    { root: 57, chord: [57, 60, 64] }, // Am  (A C E)
    { root: 53, chord: [53, 57, 60] }, // F   (F A C)
    { root: 48, chord: [48, 52, 55] }, // C   (C E G)
    { root: 55, chord: [55, 59, 62] }, // G   (G B D)
  ];
  const PROG_B = [
    { root: 50, chord: [50, 53, 57] }, // Dm  (D F A)
    { root: 55, chord: [55, 59, 62] }, // G   (G B D)
    { root: 48, chord: [48, 52, 55] }, // C   (C E G)
    { root: 52, chord: [52, 55, 59] }, // Em  (E G B)
  ];
  // ---- per-world soundtracks -------------------------------------------------
  // Every map gets its own piece, not a transposition of one. Different chords,
  // different tempo, different drum feel, different voices. Generated rather
  // than sampled, which is why it costs nothing to license and adds no files:
  // there is nothing here anyone else owns.
  //
  //   prog   two four-bar sections, so the loop is eight bars not four
  //   bpm    the piece's own resting tempo (the run still pushes it around)
  //   kick   16th-note positions the kick lands on
  //   wave   the lead's timbre — this is most of a track's personality
  //   arp    which chord tone each 16th of the arp reaches for
  const N = null;   // a rest, in the pattern tables below

  const SONGS = {
    // the original: driving synthwave, four-on-the-floor
    deepfield: {
      bpm: 124, wave: 'sawtooth', sub: 'triangle',
      kick: [0, 4, 8, 12], hat: 2,
      A: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
      B: [[50, 53, 57], [55, 59, 62], [48, 52, 55], [52, 55, 59]],
      arp: [0, 1, 2, 1],
      lead: [12, N, N, 7, N, N, 12, N, 15, N, 14, N, 12, N, N, N, 10, N, N, 7, N, N, 10, N, 12, N, 15, N, 14, N, N, N],
      bass: [0, N, 0, N, 0, N, 7, N, 0, N, 0, N, 12, N, 7, N],
      snare: [4, 12], open: [14],
    },
    // hot and urgent: a driving minor line with an off-beat push
    emberfall: {
      bpm: 138, wave: 'square', sub: 'sawtooth',
      kick: [0, 3, 8, 11], hat: 2,
      A: [[45, 48, 52], [50, 53, 57], [43, 47, 50], [48, 52, 55]],
      B: [[45, 48, 52], [52, 55, 59], [50, 53, 57], [55, 58, 62]],
      arp: [0, 2, 1, 2],
      lead: [12, N, 15, N, 12, N, N, 19, N, 17, N, 15, 12, N, N, N, 12, N, 15, 17, N, 19, N, 17, 15, N, 12, N, N, N, N, N],
      bass: [0, N, 0, 0, N, 0, N, 0, 7, N, 0, N, 0, 0, N, 0],
      snare: [4, 12], open: [6, 14],
    },
    // wide and slow: suspended chords, a half-time pulse
    tidal: {
      bpm: 104, wave: 'sine', sub: 'sine',
      kick: [0, 8], hat: 4,
      A: [[50, 55, 57], [45, 50, 52], [48, 53, 55], [43, 48, 50]],
      B: [[50, 55, 57], [52, 57, 59], [48, 53, 55], [45, 50, 52]],
      arp: [0, 1, 2, 1],
      lead: [7, N, N, N, N, N, N, N, 12, N, N, N, N, N, 14, N, N, N, N, N, 9, N, N, N, N, N, N, N, 7, N, N, N],
      bass: [0, N, N, N, N, N, N, N, 7, N, N, N, N, N, N, N],
      snare: [8], open: [12],
    },
    // organic and lilting: major-ish, gentle swing on the hats
    moss: {
      bpm: 112, wave: 'triangle', sub: 'triangle',
      kick: [0, 6, 8, 14], hat: 2,
      A: [[52, 56, 59], [47, 50, 54], [45, 49, 52], [50, 54, 57]],
      B: [[52, 56, 59], [54, 57, 61], [49, 52, 56], [47, 50, 54]],
      arp: [0, 2, 1, 0],
      lead: [12, N, 14, N, 16, N, 14, N, 12, N, N, 9, N, N, N, N, 9, N, 12, N, 14, N, 12, N, 9, N, 7, N, N, N, N, N],
      bass: [0, N, N, 0, N, N, 7, N, 0, N, N, 0, N, 7, N, N],
      snare: [4, 12], open: [14],
    },
    // vast and cold: fifths, almost no movement, a heavy slow kick
    monolith: {
      bpm: 92, wave: 'sine', sub: 'sine',
      kick: [0, 8], hat: 8,
      A: [[41, 48, 53], [41, 48, 53], [39, 46, 51], [43, 50, 55]],
      B: [[41, 48, 53], [36, 43, 48], [39, 46, 51], [41, 48, 53]],
      arp: [0, 1, 0, 2],
      lead: [N, N, N, N, N, N, N, N, 12, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, 19, N, N, N, N, N, N, N],
      bass: [0, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N],
      snare: [8], open: [],
    },
    // tense and bright: an unsettled progression, busy hats
    solaris: {
      bpm: 132, wave: 'sawtooth', sub: 'square',
      kick: [0, 4, 7, 8, 12], hat: 1,
      A: [[56, 59, 63], [54, 58, 61], [59, 63, 66], [52, 56, 59]],
      B: [[56, 59, 63], [61, 64, 68], [54, 58, 61], [57, 61, 64]],
      arp: [0, 2, 1, 2],
      lead: [12, N, 13, N, 15, N, 13, N, 12, N, 10, N, 12, N, 15, N, 17, N, 15, N, 13, N, 12, N, 10, N, 12, N, N, N, N, N],
      bass: [0, N, 0, N, 0, 0, N, 0, 0, N, 0, N, 7, N, 0, 0],
      snare: [4, 12], open: [2, 6, 10, 14],
    },

    // ---- themed worlds -------------------------------------------------------
    // Keys MUST equal the map ids: scoreMusic calls setSong(map.id), and a
    // mismatch silently falls back to deepfield — the map ships with the wrong
    // music and nothing errors.

    // Halloween: a music box wound too slowly. D harmonic minor — the A major
    // chord sitting in a minor world is the raised seventh, and it does all the
    // work on its own.
    hallowmere: {
      bpm: 96, wave: 'square', sub: 'sine',
      kick: [0, 7, 8], hat: 4,
      A: [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]],
      B: [[50, 53, 57], [44, 48, 51], [43, 46, 50], [45, 49, 52]],
      arp: [0, 1, 2, 2],
      lead: [12, N, N, 15, N, N, 12, N, N, N, 11, N, 12, N, N, N, 12, N, N, 15, N, N, 17, N, 15, N, N, N, N, N, N, N],
      bass: [0, N, N, N, N, N, N, N, 0, N, N, N, N, N, -2, N],
      snare: [12], open: [15],
    },

    // Processional. E-flat major, and the only snare in the game that never
    // lands on the beat: a military roll under two strikes a bar.
    regalia: {
      bpm: 88, wave: 'sawtooth', sub: 'sawtooth',
      kick: [0, 8], hat: 8,
      A: [[51, 55, 58], [46, 50, 53], [56, 60, 63], [51, 55, 58]],
      B: [[48, 51, 55], [56, 60, 63], [46, 50, 53], [51, 55, 58]],
      arp: [0, 2, 2, 1],
      lead: [12, N, N, N, 16, N, 19, N, 24, N, N, N, N, N, N, N, 19, N, N, N, 16, N, N, N, 12, N, N, N, N, N, N, N],
      bass: [0, N, N, N, 0, N, N, N, 7, N, N, N, 7, N, N, N],
      snare: [2, 6, 10, 14], open: [],
    },

    // The void: one kick a bar, no snare at all, and bare fifths with no third
    // anywhere — so the harmony never tells you whether it is major or minor.
    // High and absent, where Monolith is low and heavy.
    nullpoint: {
      bpm: 74, wave: 'sine', sub: 'sine',
      kick: [0], hat: 8,
      A: [[57, 64, 69], [57, 64, 69], [55, 62, 67], [59, 66, 71]],
      B: [[57, 64, 69], [52, 59, 64], [55, 62, 67], [57, 64, 69]],
      arp: [0, 1, 0, 1],
      lead: [N, N, N, N, N, N, N, N, N, N, N, N, 19, N, N, N, N, N, N, N, N, N, N, N, N, N, 24, N, N, N, N, N],
      bass: [0, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N],
      snare: [], open: [8],
    },

    // D lydian — the raised fourth, the enchanted interval. The arp is SIX steps
    // against a sixteen-step bar, and 64 % 6 = 4, so it never realigns across the
    // eight-bar loop and lands somewhere new every pass. That is the map.
    weave: {
      bpm: 118, wave: 'triangle', sub: 'sine',
      kick: [0, 5, 8, 13], hat: 3,
      A: [[50, 54, 57], [52, 56, 59], [47, 50, 54], [45, 49, 52]],
      B: [[50, 54, 57], [55, 59, 62], [52, 56, 59], [47, 50, 54]],
      arp: [2, 1, 0, 1, 2, 1],
      lead: [N, N, N, N, 12, N, N, N, N, N, 16, N, N, N, N, N, 19, N, N, N, N, N, 14, N, 12, N, N, N, N, N, N, N],
      bass: [0, N, N, N, N, N, 0, N, N, N, 7, N, N, N, N, N],
      snare: [12], open: [7],
    },

    // Sleet on a window: a hat on every sixteenth and nothing that rings out.
    // High, glassy and thin, where Regalia is fat and warm.
    hoarfrost: {
      bpm: 108, wave: 'triangle', sub: 'sine',
      kick: [0, 4, 8, 12], hat: 1,
      A: [[59, 62, 66], [55, 59, 62], [50, 54, 57], [54, 57, 61]],
      B: [[59, 62, 66], [57, 61, 64], [52, 56, 59], [55, 59, 62]],
      arp: [0, 2, 1, 2],
      lead: [12, N, N, N, 15, N, N, N, 14, N, N, N, 12, N, N, N, 10, N, N, N, 12, N, N, N, 15, N, N, N, N, N, N, N],
      bass: [0, N, N, N, 0, N, N, N, 7, N, N, N, 0, N, N, N],
      snare: [4, 12], open: [14],
    },


    // Cat burglar jazz: a walking bass sneaking up chromatic steps, brushed
    // hats, and a pentatonic lead that lands like paws — mostly rests, then
    // three quick steps. The only walking bass in the game.
    rooftops: {
      bpm: 100, wave: 'triangle', sub: 'triangle',
      kick: [0, 7, 10], hat: 2,
      A: [[45, 48, 52], [48, 52, 55], [50, 54, 57], [52, 56, 59]],
      B: [[45, 48, 52], [43, 47, 50], [50, 54, 57], [45, 48, 52]],
      arp: [0, 2, 1, 2],
      lead: [N, N, 12, 14, 15, N, N, N, N, N, 12, N, N, N, N, N, N, 15, 17, N, 15, N, 12, N, N, N, 10, N, N, N, N, N],
      bass: [0, N, 3, N, 5, N, 7, N, 8, N, 7, N, 5, N, 3, N],
      snare: [4, 12], open: [10],
    },

    // The last-episode chord loop — IV V iii vi, the progression half of anime
    // itself runs on — under a lead that holds its notes like a key frame.
    bloomward: {
      bpm: 100, wave: 'sine', sub: 'triangle',
      kick: [0, 4, 8, 12], hat: 4,
      A: [[41, 45, 48], [43, 47, 50], [40, 43, 47], [45, 48, 52]],
      B: [[41, 45, 48], [43, 47, 50], [48, 52, 55], [43, 47, 50]],
      arp: [0, 1, 2, 1],
      lead: [12, N, N, N, N, N, 14, N, 16, N, N, N, N, N, N, N, 14, N, N, N, 12, N, 11, N, 12, N, N, N, N, N, N, N],
      bass: [0, N, N, N, N, N, N, N, 0, N, N, N, 7, N, N, N],
      snare: [8], open: [14],
    },

    // A spiral arm: a FIVE-step arp against a sixteen-step bar (weave's trick
    // at a different prime), so the pattern precesses like the stars do. Ninth
    // chords, no third doing any work, one high lead note a bar.
    andromeda: {
      bpm: 76, wave: 'sine', sub: 'sine',
      kick: [0, 8], hat: 4,
      A: [[45, 52, 59], [43, 50, 57], [48, 55, 62], [41, 48, 55]],
      B: [[45, 52, 59], [50, 57, 64], [43, 50, 57], [45, 52, 59]],
      arp: [0, 1, 2, 1, 2],
      lead: [N, N, N, N, N, N, 19, N, N, N, N, N, N, N, N, N, 24, N, N, N, N, N, N, N, N, N, 21, N, N, N, N, N],
      bass: [0, N, N, N, N, N, N, N, 7, N, N, N, N, N, N, N],
      snare: [8], open: [12],
    },

    // i–VI–III–VII at 118 with an off-beat octave bass: the synthwave loop
    // itself. Where Deepfield drives, this one CRUISES — snare halved, the
    // open hat pushing the and-of-three.
    nightway: {
      bpm: 118, wave: 'sawtooth', sub: 'square',
      kick: [0, 4, 8, 12], hat: 2,
      A: [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]],
      B: [[45, 48, 52], [41, 45, 48], [50, 53, 57], [43, 47, 50]],
      arp: [0, 2, 1, 2],
      lead: [12, N, N, 15, N, N, 17, N, N, N, 15, N, 12, N, N, N, 10, N, N, 12, N, N, 15, N, 17, N, 19, N, N, N, N, N],
      bass: [0, N, 12, N, 0, N, 12, N, 0, N, 12, N, 7, N, 12, N],
      snare: [4, 12], open: [10],
    },

    // E phrygian — the flat second leaning on the tonic is the dread interval —
    // with one kick at the bar and a lead that only ever sighs downward by a
    // semitone. Hallowmere is a music box; this is the cold in the room.
    gloamvale: {
      bpm: 82, wave: 'sine', sub: 'sine',
      kick: [0, 10], hat: 8,
      A: [[40, 43, 47], [41, 45, 48], [38, 41, 45], [40, 43, 47]],
      B: [[40, 43, 47], [41, 45, 48], [43, 47, 50], [40, 43, 47]],
      arp: [0, 1, 0, 1],
      lead: [N, N, N, N, 13, N, 12, N, N, N, N, N, N, N, N, N, N, N, N, N, 15, N, 13, N, 12, N, N, N, N, N, N, N],
      bass: [0, N, N, N, N, N, N, N, 0, N, N, N, 1, N, 0, N],
      snare: [], open: [8],
    },

    // Lantern festival: gong fifths under a fully pentatonic lead — not one
    // note outside the five — and a firecracker kick pattern in pairs.
    lanternmoon: {
      bpm: 112, wave: 'triangle', sub: 'sine',
      kick: [0, 3, 8, 11], hat: 2,
      A: [[48, 55, 60], [45, 52, 57], [50, 57, 62], [48, 55, 60]],
      B: [[48, 55, 60], [43, 50, 55], [45, 52, 57], [48, 55, 60]],
      arp: [0, 1, 2, 1],
      lead: [12, N, 14, N, 16, N, N, N, 19, N, 16, N, 14, N, N, N, 21, N, 19, N, 16, N, 14, N, 12, N, N, N, N, N, N, N],
      bass: [0, N, N, 0, N, N, 7, N, 0, N, N, 0, N, N, 7, N],
      snare: [4, 12], open: [14],
    },

    // The hour before sunrise, written the way that hour sounds: nothing agrees
    // with anything else about where the bar is.
    //
    //   QUARTAL harmony -- [root, +5, +10], two stacked fourths, no third
    //   anywhere. Every other song here is triadic, or bare fifths, or
    //   sus4-with-a-fifth; nothing stacks two fourths, and a fourth stack cannot
    //   cadence. The roots move by whole tone and by fourth and NEVER by
    //   semitone, so there is no leading note and nothing to resolve to. It
    //   cycles, the way a dawn does.
    //
    //   Every pattern is a different length against the 64-step loop:
    //     hat 6   -> a 6-6-4 limp; no other song uses divisor 6
    //     bass 5  -> five bars to come back round; every other bass is sixteen
    //     arp 7   -> steps one 16th every four bars, realigns after seven passes
    //     lead 20 -> lands four steps later each section, home after twenty bars
    //   No snare: a backbeat promises somebody is keeping time with you, and
    //   this is an hour with nobody in it.
    ashrise: {
      bpm: 86, wave: 'triangle', sub: 'sine',
      kick: [0, 10], hat: 6,
      A: [[45, 50, 55], [47, 52, 57], [50, 55, 60], [52, 57, 62]],
      B: [[52, 57, 62], [50, 55, 60], [45, 50, 55], [43, 48, 53]],
      arp: [0, 1, 2, 1, 2, 0, 1],
      lead: [N, N, N, N, 12, N, N, N, N, N, N, N, 17, N, 14, N, N, N, N, N],
      bass: [0, N, 7, N, N],
      snare: [], open: [15],
    },

    // A terrace chant, basically: four-on-the-floor you could stamp to, a
    // handclap on the backbeat, and a brass-ish lead that only ever plays three
    // notes because a whole stand has to be able to sing it.
    pitch: {
      bpm: 128, wave: 'square', sub: 'triangle',
      kick: [0, 4, 8, 12], hat: 2,
      A: [[45, 49, 52], [43, 47, 50], [41, 45, 48], [43, 47, 50]],
      B: [[48, 52, 55], [47, 50, 54], [45, 49, 52], [43, 47, 50]],
      arp: [0, 2, 1, 2],
      lead: [12, N, N, 12, N, 15, N, N, 12, N, N, N, 10, N, N, N],
      bass: [0, 0, 7, 0, 0, 0, 7, 5, 0, 0, 7, 0, 3, 3, 5, 7],
      snare: [4, 12], open: [14],
    },

    // Something enormous and slow, with the current running over it. A drone
    // under everything, a lead that only moves by a tritone and a minor sixth --
    // the two intervals that refuse to settle -- and a hat on 3 so the pulse
    // never quite lands where you expect.
    eventhorizon: {
      bpm: 72, wave: 'sawtooth', sub: 'sine',
      kick: [0, 11], hat: 3,
      A: [[33, 39, 44], [33, 40, 45], [31, 37, 42], [33, 39, 44]],
      B: [[36, 42, 47], [35, 41, 46], [33, 39, 44], [31, 38, 43]],
      arp: [0, 2, 1, 2, 0, 1],
      lead: [N, N, 18, N, N, N, N, N, 24, N, N, N, N, 21, N, N, N, N],
      bass: [0, N, N, 0, N, N, 7, N],
      snare: [], open: [7, 15],
    },

    // ---- the living worlds ---------------------------------------------------

    // A mill floor. Everything here is MACHINE time: a four-square kick you could
    // set a stamping press to, a hat on the offbeat that reads as steam escaping,
    // and a bass that walks the same four steps forever because a machine has no
    // reason to vary. The lead is three notes hammered on the beat -- it is a
    // work whistle, not a melody. Deliberately the most metronomic piece in the
    // game, because this is the one world whose gates arrive on a clock.
    foundry: {
      bpm: 104, wave: 'square', sub: 'sawtooth',
      kick: [0, 4, 8, 12], hat: 2,
      A: [[36, 43, 48], [36, 43, 48], [34, 41, 46], [36, 43, 48]],
      B: [[39, 46, 51], [38, 45, 50], [36, 43, 48], [34, 41, 46]],
      arp: [0, 0, 2, 1],
      lead: [12, N, N, N, 12, N, N, N, 15, N, N, N, 12, N, N, N],
      bass: [0, 0, 0, 7, 0, 0, 0, 7],
      snare: [8], open: [6, 14],
    },

    // Noon heat. Almost nothing happens, and what does happen is BENT: the lead
    // is a slow bend between two notes a whole tone apart, the hat is sparse
    // because nothing wants to move at this temperature, and there is no snare
    // at all. Fastest tempo in the game paired with the emptiest pattern, so it
    // shimmers rather than drives -- the same trick the world plays with its air.
    saltglare: {
      bpm: 138, wave: 'triangle', sub: 'sine',
      kick: [0, 10], hat: 7,
      A: [[41, 45, 48], [41, 46, 48], [40, 45, 47], [41, 45, 48]],
      B: [[43, 47, 50], [41, 46, 48], [39, 44, 46], [41, 45, 48]],
      arp: [0, 1, 0, 2, 0, 1],
      lead: [N, N, 14, N, N, N, 16, N, N, N, 14, N, N, N, N, N, 12, N, N, N],
      bass: [0, N, N, N, 5, N, N, N],
      snare: [], open: [11],
    },

    // A fen at dusk. Two ideas: a low drone that never resolves, and an arp that
    // GATHERS and SCATTERS -- six steps that climb then fall away, which is the
    // flock and the flow tank both. The kick is a heartbeat rather than a beat,
    // and the open hat on the last step is the whole thing lifting off at once.
    murmurfen: {
      bpm: 78, wave: 'sine', sub: 'triangle',
      kick: [0, 9], hat: 5,
      A: [[38, 45, 50], [40, 45, 52], [38, 43, 50], [36, 43, 48]],
      B: [[43, 48, 55], [41, 48, 53], [38, 45, 50], [36, 43, 50]],
      arp: [0, 1, 2, 2, 1, 0],
      lead: [N, N, N, 19, N, N, 17, N, N, N, N, 14, N, N, N, N, N, 12, N, N, N, N],
      bass: [0, N, N, 5, N, N, 3, N],
      snare: [], open: [15],
    },

    // ---- a MODE's music, not a world's ---------------------------------------
    // Claimed by ABANDON HOPE through `mode.song`, so it follows you onto every
    // map. Everything here is chosen to withhold:
    //
    //   * the kick is a HEARTBEAT — two thumps then a long nothing — not a beat
    //     you can dance to. At 66 BPM that is a resting pulse; the run speeding
    //     it up is the point.
    //   * every chord holds a TRITONE (root + 6) and the progression slides by
    //     SEMITONE instead of resolving, so it never arrives anywhere.
    //   * no snare at all. A backbeat is a promise that something is keeping
    //     time with you, and nothing here is on your side.
    //   * the lead is almost entirely rests: one tritone stab every two bars.
    //     The silence does the work — a busy horror track is just a busy track.
    //   * a DRONE under all of it, which is the part that actually makes it
    //     frightening rather than merely empty — see _droneTick.
    //   * the kick is a heartbeat, not a beat: paired thuds a 16th apart
    //     (lub-dub), twice a bar. Each one ducks the bed, so the drone
    //     breathes in time with it.
    abandon: {
      bpm: 66, wave: 'sawtooth', sub: 'sine',
      kick: [0, 3, 8, 11], hat: 0,
      A: [[48, 54, 59], [47, 53, 58], [49, 55, 60], [46, 52, 57]],
      B: [[48, 54, 59], [44, 50, 55], [47, 53, 58], [43, 49, 54]],
      arp: [0, 1, 2, 1, 0, 2, 1, 2],
      lead: [N, N, N, N, N, N, N, N, N, N, N, N, 6, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, 6, N, 5, N],
      bass: [0, N, N, N, N, N, N, N, 6, N, N, N, N, N, N, N],
      drone: { notes: [-24, -12, -6], mix: [1, 0.62, 0.30], gain: 0.105, wave: 'sawtooth', cut: 210 },
      snare: [], open: [11],
    },
  };

  // Pentatonic ladder used by the "collect" sound as combo climbs.
  const PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88];

  const Audio = {
    ctx: null,
    master: null,
    musicBus: null,
    sfxBus: null,
    delay: null,
    isMuted: false,
    _started: false,

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());

      // Master chain: mix -> soft limiter -> destination
      const master = (this.master = ctx.createGain());
      master.gain.value = this.isMuted ? 0 : 0.9;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;

      master.connect(limiter).connect(ctx.destination);

      // Buses
      const st = LUMEN.Store;
      this.sfxOn = st ? st.sfxOn : true;
      this.musicOn = st ? st.musicOn : true;
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? 0.9 : 0;
      this.sfxBus.connect(master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.0; // faded in on music.start
      this.musicBus.connect(master);

      // Everything melodic goes through here so the kick can duck it — the
      // pumping this genre is built on. The kick itself connects to musicBus
      // directly: a drum that ducks itself just gets quieter.
      this.musicVoice = ctx.createGain();
      this.musicVoice.gain.value = 1;
      this.musicVoice.connect(this.musicBus);

      // A shared feedback delay for "space" (used by music + some sfx)
      const delay = (this.delay = ctx.createDelay(1.0));
      delay.delayTime.value = 0.34;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(master);
      this.delayIn = delay;

      this.music._audio = this;
    },

    unlock() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      // Every caller of this is a real gesture — a tap, a run starting, an
      // unmute. Once one has happened the autoplay policy is satisfied for the
      // life of this context, and a suspended context is ours to resume from
      // then on. `wake()` is the only thing that reads it; see the note there.
      if (this.ctx) this._gestured = true;
    },

    // Leaving the app has to take the sound with it.
    //
    // Pausing the RUN was not enough, because the menu plays too: a player who
    // backed out to the home screen from the title screen left LUMEN's music
    // playing behind it. A tester reported exactly that. Stopping the sequencer
    // is not enough either — the looping world stems and the drone are separate
    // sources and keep going on their own.
    //
    // Suspending the context is the one lever that covers all of them at once,
    // and it is reversible: the sequencer's next-note time is measured against
    // ctx.currentTime, which freezes with it, so waking up resumes mid-bar
    // rather than replaying or skipping.
    sleep() {
      if (!this.ctx || this.ctx.state !== 'running') return;
      try { this.ctx.suspend(); } catch (e) { /* already gone; nothing to stop */ }
    },
    // Resume a suspended context, once anything has ever unlocked this one.
    //
    // This used to resume only what `sleep()` had suspended, tracked with a flag
    // — and the flag was set INSIDE a guard that returns early when the context
    // is not already running. A fullscreen rewarded ad takes the audio session
    // away from the page and leaves the context suspended by itself, so leaving
    // the app during an ad reached a `sleep()` that found nothing to stop,
    // returned without setting the flag, and a `wake()` that then refused to
    // touch it. Every sound in the game was gone for the rest of the launch and
    // nothing but a relaunch brought it back.
    //
    // The rule that flag was protecting is real and still here: a context that
    // has NEVER run must wait for a gesture, or the first tap after returning is
    // answered with silence. `_gestured` says that directly instead of inferring
    // it from who suspended what.
    wake() {
      if (!this.ctx || !this._gestured) return;
      if (this.ctx.state === 'running') return;
      try { this.ctx.resume(); } catch (e) { /* the next unlock() will retry */ }
    },

    setMuted(m) {
      this.isMuted = m;
      if (this.master && this.ctx) {
        const now = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(m ? 0 : 0.9, now, 0.02);
      }
      // must go through Store: it memoises reads, so writing straight to
      // localStorage leaves the cache (and anything reading Store.muted) stale
      if (LUMEN.Store) LUMEN.Store.muted = m;
      else { try { localStorage.setItem('lumen_muted', m ? '1' : '0'); } catch (e) {} }
    },
    toggleMuted() { this.setMuted(!this.isMuted); return this.isMuted; },

    setSfxEnabled(on) {
      this.sfxOn = on;
      if (LUMEN.Store) LUMEN.Store.sfxOn = on;
      if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02);
    },
    setMusicEnabled(on) {
      this.musicOn = on;
      if (LUMEN.Store) LUMEN.Store.musicOn = on;
      if (this.musicBus && this.ctx) {
        const target = on ? (this.music.playing ? 0.5 : 0.0001) : 0.0001;
        this.musicBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
      }
    },

    // ---- Low level voice ---------------------------------------------------
    _tone(opts) {
      const ctx = this.ctx;
      if (!ctx) return;
      const t0 = opts.at != null ? opts.at : ctx.currentTime;
      const dur = opts.dur != null ? opts.dur : 0.2;
      const type = opts.type || 'sine';
      const f0 = opts.freq;
      const f1 = opts.freqTo != null ? opts.freqTo : f0;
      const peak = opts.gain != null ? opts.gain : 0.3;
      const atk = opts.attack != null ? opts.attack : 0.005;
      const rel = opts.release != null ? opts.release : dur * 0.8;
      const dest = opts.dest || this.sfxBus;

      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      if (opts.detune) osc.detune.value = opts.detune;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + rel);

      let node = osc;
      if (opts.filter) {
        const flt = ctx.createBiquadFilter();
        flt.type = opts.filter.type || 'lowpass';
        flt.frequency.setValueAtTime(opts.filter.freq || 2000, t0);
        if (opts.filter.freqTo != null)
          flt.frequency.exponentialRampToValueAtTime(Math.max(20, opts.filter.freqTo), t0 + dur);
        flt.Q.value = opts.filter.q || 1;
        node.connect(flt);
        node = flt;
      }
      node.connect(g);
      g.connect(dest);
      if (opts.send) g.connect(this.delayIn);

      osc.start(t0);
      // run at least as long as the pitch/filter sweep, or the glide gets cut off
      // mid-slide (the default release is only 0.8*dur)
      osc.stop(t0 + Math.max(dur, atk + rel) + 0.05);
      return osc;
    },

    _noise(opts) {
      const ctx = this.ctx;
      if (!ctx) return;
      const t0 = opts.at != null ? opts.at : ctx.currentTime;
      const dur = opts.dur != null ? opts.dur : 0.2;
      const peak = opts.gain != null ? opts.gain : 0.3;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;

      const flt = ctx.createBiquadFilter();
      flt.type = opts.filterType || 'lowpass';
      flt.frequency.setValueAtTime(opts.freq || 4000, t0);
      if (opts.freqTo != null)
        flt.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqTo), t0 + dur);
      flt.Q.value = opts.q || 0.7;

      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      src.connect(flt).connect(g).connect(opts.dest || this.sfxBus);
      if (opts.send) g.connect(this.delayIn);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    },

    // ---- Sound effects -----------------------------------------------------
    // ---- the wind bed -------------------------------------------------------
    // ALOFT needs to be HEARD, not just measured. One looping noise buffer with
    // a bandpass on it: climb and the filter opens and it gets louder, descend
    // and it closes to almost nothing. Two nodes for the whole run, created once
    // and reused -- a per-frame _noise() would allocate a fresh buffer sixty
    // times a second and is what this exists to avoid.
    //
    // It never plays in the menu, never survives a run, and starts only when a
    // mode actually asks for it, so the other eleven are silent exactly as
    // before.
    windStart() {
      const ctx = this.ctx;
      if (!ctx || this._wind || !this.sfxOn) return;
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      // brownish noise: integrated white, which sounds like air rather than hiss
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = 'bandpass'; flt.frequency.value = 420; flt.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(flt); flt.connect(g); g.connect(this.sfxBus || this.master || ctx.destination);
      try { src.start(); } catch (e) { return; }
      this._wind = { src: src, flt: flt, gain: g };
    },
    // `t` is 0 at the calm line, 1 at full gale, and may go negative below it.
    windSet(t) {
      const w = this._wind;
      if (!w || !this.ctx) return;
      const k = Math.max(0, Math.min(1, t));
      const now = this.ctx.currentTime;
      w.gain.gain.setTargetAtTime(0.015 + 0.075 * k * k, now, 0.12);
      w.flt.frequency.setTargetAtTime(360 + 900 * k, now, 0.12);
    },
    windStop() {
      const w = this._wind;
      if (!w) return;
      this._wind = null;
      try {
        w.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
        setTimeout(() => { try { w.src.stop(); } catch (e) {} }, 400);
      } catch (e) {}
    },

    sfx(name, opts) {
      if (!this.ctx || this.sfxOn === false) return;
      opts = opts || {};
      switch (name) {
        case 'flip': {
          const up = opts.dir < 0;
          this._tone({
            type: 'triangle',
            freq: up ? 320 : 260,
            freqTo: up ? 520 : 180,
            dur: 0.11, gain: 0.16, attack: 0.004, release: 0.09,
          });
          this._tone({ type: 'sine', freq: up ? 640 : 520, freqTo: up ? 900 : 360, dur: 0.08, gain: 0.05 });
          break;
        }
        case 'collect': {
          const combo = opts.combo || 0;
          const idx = Math.min(PENTA.length - 1, Math.floor(combo));
          const f = mtof(PENTA[idx]);
          this._tone({ type: 'triangle', freq: f, dur: 0.24, gain: 0.14, attack: 0.003, release: 0.22, send: true });
          this._tone({ type: 'sine', freq: f * 2, dur: 0.2, gain: 0.06, attack: 0.003, release: 0.18, detune: 4 });
          break;
        }
        case 'meow': {
          // A kitten's "mew": a fast rise into a longer falling tail, quiet
          // enough to survive being heard several hundred times a run. Every
          // meow is pitched a few percent differently — an identical sample on
          // every flip stops being a cat and starts being a metronome.
          const v = 1 + (Math.random() * 0.16 - 0.08);
          const t0 = this.ctx.currentTime;
          // the rise ("m-")
          this._tone({ type: 'sawtooth', freq: 460 * v, freqTo: 840 * v,
            dur: 0.07, gain: 0.045, attack: 0.015, release: 0.03, at: t0 });
          // the fall ("-ew"), overlapping the top of the rise
          this._tone({ type: 'sawtooth', freq: 840 * v, freqTo: 430 * v,
            dur: 0.16, gain: 0.05, attack: 0.008, release: 0.12, at: t0 + 0.055 });
          // a soft second harmonic gives it the nasal kitten timbre
          this._tone({ type: 'sine', freq: 1680 * v, freqTo: 900 * v,
            dur: 0.14, gain: 0.018, attack: 0.01, release: 0.1, at: t0 + 0.055 });
          break;
        }
        case 'nearmiss': {
          this._noise({ dur: 0.14, gain: 0.05, freq: 1800, freqTo: 400, filterType: 'bandpass', q: 2 });
          break;
        }
        case 'flow': {
          // bright rising chord
          const base = 60;
          [0, 4, 7, 12].forEach((iv, i) => {
            this._tone({
              type: 'sawtooth', freq: mtof(base + iv), dur: 0.9, gain: 0.09,
              attack: 0.01, release: 0.85, at: this.ctx.currentTime + i * 0.03,
              filter: { type: 'lowpass', freq: 1200, freqTo: 5000, q: 1 }, send: true,
            });
          });
          break;
        }
        case 'flowEnd': {
          this._tone({ type: 'sine', freq: 660, freqTo: 220, dur: 0.4, gain: 0.08, release: 0.36 });
          break;
        }
        // RUBBER's walls. Pitch follows the impact — a hard bounce should sound
        // like one, or every wall reads the same and the mode has no feedback.
        case 'boing': {
          const v = clampNum((opts && opts.v) || 0.3, 0.05, 1.2);
          const f = 180 + v * 520;
          this._tone({ type: 'triangle', freq: f, freqTo: f * 0.42, dur: 0.22,
            gain: 0.05 + v * 0.06, attack: 0.004, release: 0.2 });
          break;
        }
        // GLUTTON, losing the chain — the air going out of the orb. This is the
        // one place in the game where breaking a chain is a RELIEF, so it gets a
        // sound that reads as release rather than as loss.
        case 'deflate': {
          this._tone({ type: 'sawtooth', freq: 300, freqTo: 70, dur: 0.35, gain: 0.07,
            attack: 0.005, release: 0.32, filter: { type: 'lowpass', freq: 1400, q: 2 } });
          this._noise({ dur: 0.3, gain: 0.05, freq: 900, filterType: 'bandpass', q: 1.4 });
          break;
        }
        case 'crash': {
          this._noise({ dur: 0.5, gain: 0.4, freq: 3200, freqTo: 120, filterType: 'lowpass', q: 1, send: true });
          this._tone({ type: 'sawtooth', freq: 220, freqTo: 40, dur: 0.5, gain: 0.22, release: 0.45, filter: { type: 'lowpass', freq: 1400, freqTo: 200 } });
          this._tone({ type: 'sine', freq: 90, freqTo: 30, dur: 0.5, gain: 0.3, release: 0.4 }); // sub thump
          break;
        }
        // BRITTLE: a bar breaking. Bright and short, so a chain of them reads as
        // rhythm rather than as a series of crashes — the sound has to say
        // "that was the good outcome", which 'crash' emphatically does not.
        case 'shatter': {
          this._noise({ dur: 0.18, gain: 0.16, freq: 5200, freqTo: 1800, filterType: 'bandpass', q: 1.4 });
          this._tone({ type: 'triangle', freq: 1240, freqTo: 720, dur: 0.14, gain: 0.10, release: 0.12 });
          this._tone({ type: 'triangle', freq: 620, freqTo: 380, dur: 0.18, gain: 0.07, release: 0.15 });
          break;
        }
        case 'ui': {
          this._tone({ type: 'triangle', freq: 480, freqTo: 620, dur: 0.09, gain: 0.1, release: 0.08 });
          break;
        }
        case 'start': {
          [0, 7, 12].forEach((iv, i) =>
            this._tone({ type: 'triangle', freq: mtof(57 + iv), dur: 0.4, gain: 0.12, release: 0.36, at: this.ctx.currentTime + i * 0.06, send: true })
          );
          break;
        }
        case 'best': {
          [0, 4, 7, 12, 16].forEach((iv, i) =>
            this._tone({ type: 'triangle', freq: mtof(60 + iv), dur: 0.5, gain: 0.12, release: 0.45, at: this.ctx.currentTime + i * 0.08, send: true })
          );
          break;
        }
      }
    },

    // ---- Adaptive music sequencer -----------------------------------------
    music: {
      _audio: null,
      playing: false,
      intensity: 0,          // 0..3 target
      _intensitySmooth: 0,
      bpm: 124,
      _step: 0,              // 16th-note counter
      _nextNoteTime: 0,
      _timer: null,
      lookahead: 0.1,        // seconds
      scheduleAhead: 0.14,

      start() {
        const A = this._audio;
        if (!A || !A.ctx || this.playing) return;
        this._drainPending();
        this.playing = true;
        this._step = 0;
        this._nextNoteTime = A.ctx.currentTime + 0.06;
        A.musicBus.gain.cancelScheduledValues(A.ctx.currentTime);
        A.musicBus.gain.setValueAtTime(A.musicBus.gain.value, A.ctx.currentTime);
        A.musicBus.gain.linearRampToValueAtTime(A.musicOn === false ? 0.0001 : 0.5, A.ctx.currentTime + 1.2);
        const tick = () => {
          if (!this.playing) return;
          this._scheduler();
          this._timer = setTimeout(tick, this.lookahead * 1000);
        };
        tick();
        // If this world has a recording, START IT.
        //
        // The sequencer stands down whenever a track is loaded, so without this
        // the two halves both decline to play and the game is simply silent.
        // _syncTrack was only ever reached from setSong and from the loader —
        // both of which check `playing` — so the ordinary order (choose the
        // world, then start) fell straight through the gap.
        if (this._trackFor(this._song)) this._syncTrack();
      },

      // How loud the music sits, independent of which layers are playing. The
      // menu bed and a live run use the same piece, so intensity alone cannot
      // separate them — a run has to be able to bring the music forward even
      // though start() already returned early for music that was playing.
      setLevel(v, seconds) {
        const A = this._audio;
        if (!A || !A.ctx) return;
        const target = A.musicOn === false ? 0.0001 : Math.max(0.0001, v);
        A.musicBus.gain.cancelScheduledValues(A.ctx.currentTime);
        A.musicBus.gain.setValueAtTime(A.musicBus.gain.value, A.ctx.currentTime);
        A.musicBus.gain.linearRampToValueAtTime(target, A.ctx.currentTime + (seconds || 0.8));
      },

      // ---- the drone ------------------------------------------------------
      // Three oscillators and one gain, created once and left running for as
      // long as a droning piece is playing. Called on EVERY 16th rather than
      // at the top of a bar: that makes it self-healing (a stop/start mid-bar
      // recovers on the next step instead of after three seconds of nothing)
      // and it costs one number comparison when there is nothing to do.
      _drone: null,
      _droneTick(root, t, inten, spec) {
        const A = this._audio;
        if (!A || !A.ctx) return;
        const d = this._drone || this._droneStart(spec);
        if (!d) return;
        // Follow the run's heat, gently. The bed is the one thing that must
        // never disappear, so this floors well above zero.
        const lvl = (spec.gain || 0.1) * (0.72 + 0.16 * clampNum(inten, 0, 3));
        d.gain.gain.setTargetAtTime(lvl, t, 0.4);
        d.cut.frequency.setTargetAtTime((spec.cut || 220) + 45 * clampNum(inten, 0, 3), t, 0.6);
        if (root === d.root) return;
        d.root = root;
        // A glide, not a jump. secPerBar is the whole point: the pitch is still
        // arriving when the next chord is written, which is why it unsettles.
        const glide = secPerBar(this.bpm) * 0.55;
        d.notes.forEach((osc, i) => {
          const f = mtof(root + d.offsets[i]);
          osc.frequency.cancelScheduledValues(t);
          osc.frequency.setValueAtTime(osc.frequency.value, t);
          osc.frequency.exponentialRampToValueAtTime(Math.max(8, f), t + glide);
        });
      },
      _droneStart(spec) {
        const A = this._audio;
        if (!A || !A.ctx || !A.musicVoice) return null;
        const ctx = A.ctx;
        const offsets = spec.notes || [-24, -12, -6];
        const weights = spec.mix || [1, 0.7, 0.34];
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        const cut = ctx.createBiquadFilter();
        cut.type = 'lowpass';
        cut.frequency.value = spec.cut || 220;
        cut.Q.value = 0.7;
        cut.connect(gain);
        // Deliberately through musicVoice, the ducked bus: the heartbeat kick
        // pumps the bed, so the drone breathes instead of just sitting there.
        gain.connect(A.musicVoice);
        const notes = offsets.map((off, i) => {
          const osc = ctx.createOscillator();
          osc.type = i === 0 ? 'sine' : (spec.wave || 'sawtooth');   // a clean sub under the dirt
          osc.frequency.value = mtof(48 + off);
          osc.detune.value = i === 2 ? 9 : (i === 1 ? -6 : 0);        // never quite in tune
          const vg = ctx.createGain();
          vg.gain.value = weights[i] != null ? weights[i] : 0.5;
          osc.connect(vg); vg.connect(cut);
          osc.start();
          return osc;
        });
        this._drone = { notes, offsets, gain, cut, root: null };
        return this._drone;
      },
      _droneStop() {
        const d = this._drone;
        if (!d) return;
        this._drone = null;
        const A = this._audio;
        const now = A && A.ctx ? A.ctx.currentTime : 0;
        try {
          d.gain.gain.cancelScheduledValues(now);
          d.gain.gain.setTargetAtTime(0.0001, now, 0.25);
          d.notes.forEach((o) => o.stop(now + 1.6));
          setTimeout(() => { try { d.gain.disconnect(); d.cut.disconnect(); } catch (e) {} }, 2000);
        } catch (e) { /* a context torn down under us is not worth a crash */ }
      },

      stop() {
        const A = this._audio;
        this.playing = false;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        this._droneStop();
        this._stopSources();          // looping stems keep going forever otherwise
        if (A && A.ctx) {
          A.musicBus.gain.cancelScheduledValues(A.ctx.currentTime);
          A.musicBus.gain.setTargetAtTime(0.0001, A.ctx.currentTime, 0.25);
        }
      },

      // Anything asked for before the context existed was queued and then quietly
      // forgotten. Drain both queues the moment there is a context to decode into.
      _drainPending() {
        const A = this._audio;
        if (!A || !A.ctx) return;
        const t = this._pending; this._pending = null;
        (t || []).forEach(([id, url]) => this.useTrack(id, url));
        const s = this._pendingStems; this._pendingStems = null;
        (s || []).forEach(([id, urls]) => this.useStems(id, urls));
      },

      setIntensity(n) { this.intensity = Math.max(0, Math.min(3, n)); },

      // ---- live scoring -------------------------------------------------
      // The soundtrack answers the run instead of looping past it:
      //
      //   tempo  follows how fast the corridor is actually moving
      //   key    follows the map you chose
      //   layers follow your chain (setIntensity, driven by the game)
      //
      // Tempo is eased rather than set, because a step change mid-bar sounds
      // like a skip; and it is only read at the top of each 16th, so a note
      // already scheduled always finishes at the tempo it was written for.
      BASE_BPM: 124,
      _bpmTarget: 124,
      _key: 0,

      setPace(frac) {
        // frac 0..1, roughly "how far into the difficulty ramp are we"
        // The piece's own tempo is the FLOOR, not the middle. An earlier version
        // started at 0.86× and only reached the written tempo a third of the way
        // into a run, so every track opened slower than it was composed to be.
        const f = Math.max(0, Math.min(1.6, frac || 0));
        this._bpmTarget = this.BASE_BPM * (1 + f * 0.3);   // written tempo → +48%
      },
      // Semitones. Each map gets its own tonal centre so the worlds sound as
      // different as they look.
      setKey(semitones) { this._key = ((semitones | 0) % 12 + 12) % 12; },

      // Switch worlds. The piece's own tempo becomes the new resting point that
      // the run's pace multiplies, so Monolith stays heavy even at full speed and
      // Emberfall is urgent even at a standstill.
      setSong(id) {
        if (!SONGS[id] || this._song === id) return;
        this._song = id;
        this.BASE_BPM = SONGS[id].bpm;
        this._bpmTarget = SONGS[id].bpm;
        if (this.playing) this._syncTrack();
      },
      _song: 'deepfield',

      // ---- real audio files (optional) ------------------------------------
      // Everything above is generated, which is why the game ships with no
      // audio files and nothing to license. If you would rather use recorded
      // music, drop it in here and it takes over for that world:
      //
      //   LUMEN.Audio.music.useTrack('emberfall', 'assets/music/emberfall.ogg')
      //   LUMEN.Audio.music.useTrack('*', 'assets/music/theme.ogg')   // all worlds
      //
      // A loaded track replaces the sequencer for that map: the layers and the
      // key no longer apply (you cannot re-voice a finished recording), but the
      // PLAYBACK RATE still follows the run, so the track still speeds up with
      // the corridor. Anything the file does not cover falls back to the
      // generated piece, so a missing or failed download is never silence.
      //
      // Only use music you have the right to ship. See docs/MUSIC.md.
      _tracks: {},
      // fetch() refuses file:// URLs, and the desktop build runs on file://
      // (win.loadFile). Every world therefore fell back to the synth in the
      // shipped Steam build while 4.6 MB of unreachable MP3 went out with it.
      // XHR has no such restriction.
      _bytes(url) {
        if (location.protocol !== 'file:') {
          return fetch(url).then((r) => {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.arrayBuffer();
          });
        }
        return new Promise((resolve, reject) => {
          const x = new XMLHttpRequest();
          x.open('GET', url, true);
          x.responseType = 'arraybuffer';
          x.onload = () => (x.response ? resolve(x.response) : reject(new Error('empty')));
          x.onerror = () => reject(new Error('xhr failed'));
          x.send();
        });
      },

      useTrack(mapId, url) {
        const A = this._audio || LUMEN.Audio;
        if (!A || !A.ctx) { (this._pending = this._pending || []).push([mapId, url]); return; }
        this._bytes(url)
          .then((b) => A.ctx.decodeAudioData(b))
          .then((buf) => {
            this._tracks[mapId] = buf;
            // Only re-sync if THIS is the world being played. Re-syncing on every
            // decode restarted whatever was already playing from bar one, once
            // per world — five audible stutters in the first few seconds.
            if (this.playing && (mapId === this._song || mapId === '*')) this._syncTrack();
          })
          .catch((e) => {
            // stay on the generated piece, but say so once — silently falling
            // back is how the desktop build shipped with music that never played
            if (!this._trackWarned) {
              this._trackWarned = true;
              // eslint-disable-next-line no-console
              console.warn('[LUMEN] recorded music unavailable, using the generated score:', e && e.message);
            }
          });
      },

      // STEMS — a recorded world that still answers the run.
      //
      // One finished mixdown can only change speed. Rendered as separate layers
      // it can do what the sequencer does: drums and bass hold the floor, the
      // lead arrives on a chain, the pad opens in flow, and a broken chain
      // strips it all back. Same music, same reactivity.
      //
      //   LUMEN.Audio.music.useStems('emberfall', {
      //     drums: 'assets/music/emberfall/drums.ogg',
      //     bass:  'assets/music/emberfall/bass.ogg',
      //     lead:  'assets/music/emberfall/lead.ogg',
      //     pad:   'assets/music/emberfall/pad.ogg',
      //   })
      //
      // Every stem MUST be the same length and rendered at the same tempo, or
      // they drift apart: they are started on one clock and share one playback
      // rate. Any stem that fails to load is simply absent — the rest still play.
      _stems: {},
      STEM_IN: { drums: 0, bass: 0, lead: 1.15, pad: 1.8 },   // chain level each needs
      useStems(mapId, urls) {
        const A = this._audio || LUMEN.Audio;
        if (!A || !A.ctx) { (this._pendingStems = this._pendingStems || []).push([mapId, urls]); return; }
        const names = Object.keys(urls);
        Promise.all(names.map((n) => fetch(urls[n])
          .then((r) => r.arrayBuffer())
          .then((b) => A.ctx.decodeAudioData(b))
          .then((buf) => [n, buf])
          .catch(() => null)))
          .then((pairs) => {
            const got = {};
            pairs.filter(Boolean).forEach(([n, buf]) => { got[n] = buf; });
            if (!Object.keys(got).length) return;      // stay on the generated piece
            this._stems[mapId] = got;
            if (this.playing) this._syncTrack();
          });
      },

      _stemsFor(id) { return this._stems[id] || this._stems['*'] || null; },
      _trackFor(id) { return this._stems[id] || this._stems['*'] || this._tracks[id] || this._tracks['*'] || null; },

      _syncTrack() {
        const A = this._audio;
        if (!A || !A.ctx) return;
        this._stopSources();
        const stems = this._stemsFor(this._song);
        if (stems) {
          // one start time for all of them, or they are never in time again
          const at = A.ctx.currentTime + 0.06;
          this._srcs = []; this._stemGain = {};
          for (const name of Object.keys(stems)) {
            const src = A.ctx.createBufferSource();
            src.buffer = stems[name]; src.loop = true;
            const g = A.ctx.createGain();
            g.gain.value = 0.0001;
            src.connect(g).connect(A.musicVoice || A.musicBus);
            src.start(at);
            this._srcs.push(src);
            this._stemGain[name] = g;
          }
          this._mixStems(0.05);
          return;
        }
        const buf = this._tracks[this._song] || this._tracks['*'];
        if (!buf) return;
        const src = A.ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        // A finished recording cannot gain instruments, but it can be OPENED.
        // Running it through a lowpass that lifts with the chain makes the track
        // start muffled and distant and bloom as you climb — the same shape as
        // the sequencer's layers, from one file, and impossible to drift because
        // there is only one recording. (Rendering separate stems was measured
        // and does not work: aligned renders are near-identical, and renders
        // different enough to be layers no longer share a bar.)
        const flt = A.ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = 700;
        flt.Q.value = 0.7;
        src.connect(flt).connect(A.musicVoice || A.musicBus);
        src.start();
        this._srcs = [src];
        this._trackFilter = flt;
        this._openTrack(0.05);
      },

      // where the filter should sit for the chain we are on
      _openTrack(seconds) {
        const A = this._audio;
        if (!this._trackFilter || !A || !A.ctx) return;
        const f = clampNum(this._intensitySmooth / 3, 0, 1);
        // 700 Hz (behind a wall) up to 18 kHz (wide open), travelled musically
        // rather than linearly — pitch is logarithmic and so is this
        const hz = 700 * Math.pow(18000 / 700, f);
        const p = this._trackFilter.frequency;
        const t = A.ctx.currentTime;
        p.cancelScheduledValues(t);
        p.setValueAtTime(p.value, t);
        p.linearRampToValueAtTime(hz, t + (seconds == null ? 0.6 : seconds));
        this._trackCutoff = Math.round(hz);
      },

      _stopSources() {
        (this._srcs || []).forEach((s) => { try { s.stop(); } catch (e) {} });
        this._srcs = []; this._stemGain = null; this._trackFilter = null;
      },

      // fade each layer to where the current chain says it should be
      _mixStems(seconds) {
        const A = this._audio;
        if (!this._stemGain || !A || !A.ctx) return;
        const t = A.ctx.currentTime, dur = seconds == null ? 0.35 : seconds;
        const inten = this._intensitySmooth;
        // Record what each layer was ASKED for. Reading gain.value back gives
        // wherever the ramp has got to — which, on a context that has not been
        // resumed yet, is nowhere at all.
        this._stemTarget = {};
        for (const name of Object.keys(this._stemGain)) {
          const needs = this.STEM_IN[name] != null ? this.STEM_IN[name] : 0;
          const want = inten >= needs ? 1 : 0.0001;
          this._stemTarget[name] = want;
          const g = this._stemGain[name].gain;
          g.cancelScheduledValues(t);
          g.setValueAtTime(Math.max(g.value, 0.0001), t);
          g.linearRampToValueAtTime(want, t + dur);
        }
      },

      // a recording cannot be re-voiced, but it can still follow the pace — and
      // every layer has to move by the same amount or the mix falls apart
      _rateTrack() {
        const rate = clampNum(this.bpm / this.BASE_BPM, 0.7, 1.5);
        (this._srcs || []).forEach((s) => { s.playbackRate.value = rate; });
        if (this._stemGain) this._mixStems(0.35);
        if (this._trackFilter) this._openTrack(0.5);
      },

      _easeTempo() {
        const d = this._bpmTarget - this.bpm;
        if (Math.abs(d) < 0.05) { this.bpm = this._bpmTarget; return; }
        this.bpm += d * 0.06;
      },

      _scheduler() {
        const A = this._audio;
        const ctx = A.ctx;
        const secPer16 = 60 / this.bpm / 4;
        // A hidden tab clamps setTimeout to ~1s while the audio clock keeps running,
        // so _nextNoteTime can fall far behind. Without this catch-up the loop would
        // schedule a pile of notes at times already in the past and fire them all at
        // once — an audible machine-gun burst on tab-switch.
        if (this._nextNoteTime < ctx.currentTime) {
          const missed = Math.ceil((ctx.currentTime - this._nextNoteTime) / secPer16);
          this._nextNoteTime += missed * secPer16;
          this._step = (this._step + missed) % 64;
        }
        while (this._nextNoteTime < ctx.currentTime + this.scheduleAhead) {
          this._playStep(this._step, this._nextNoteTime);
          this._nextNoteTime += secPer16;
          this._step = (this._step + 1) % 64; // 4 bars of 16 steps
        }
      },

      _playStep(step, t) {
        const A = this._audio;
        // smooth the intensity so layers fade in musically
        this._intensitySmooth += (this.intensity - this._intensitySmooth) * 0.08;
        const inten = this._intensitySmooth;
        const bar = Math.floor(step / 16) % 4;
        const s = step % 16;
        // flip sections every full 4-bar cycle
        if (step === 0) this._sectionB = !this._sectionB;
        const song = SONGS[this._song] || SONGS.deepfield;
        const rows = this._sectionB ? song.B : song.A;
        const tri = rows[bar];
        const raw = { root: tri[0], chord: tri };
        // Transpose the whole progression into the map's key. Building a new
        // object per bar (not per note) keeps the source tables immutable.
        const k = this._key;
        const chord = k === 0 ? raw
          : { root: raw.root + k, chord: raw.chord.map((n) => n + k) };
        // ease the tempo once per 16th, between notes
        this._easeTempo();
        // A recorded track owns the music for this world — skip the sequencer
        // entirely, but keep nudging its playback rate so it still answers the run.
        if (this._trackFor(this._song)) { this._droneStop(); this._rateTrack(); return; }

        // --- Drone (a bed, not a layer) ------------------------------------
        // Horror is not written with fewer notes, it is written with something
        // that never stops. Every melodic layer below is gated on intensity —
        // arp at 0.72, lead at 1.15, pad at 1.8 — which is right for a piece
        // that should open up as a run heats up, and exactly wrong for one
        // whose job is to sit on your chest from the first frame. Measured on
        // the first draft: 93% of frames silent, peak 0.17 against 0.78 for a
        // normal track. That does not read as dread, it reads as broken audio.
        //
        // So the drone is ungated and continuous. Not a retriggered envelope —
        // Web Audio's exponential release collapses far too fast to cover a
        // 3.6s bar, and you hear the seam every time. These are oscillators
        // that simply never stop, whose pitch GLIDES to each new chord root.
        // The progression moves by semitones, so the bed creeps rather than
        // steps, and the ear can never find the bottom of it.
        if (song.drone) this._droneTick(chord.root, t, inten, song.drone);
        else this._droneStop();

        // --- Drums ---
        // Each world has its own feel, not one beat recoloured.
        if (song.kick.indexOf(s) >= 0) {
          this._kick(t, s === 0 ? 1 : 0.85);
          this._duck(t);                       // everything melodic dips under it
        }
        if (song.hat > 0 && s % song.hat === (1 % song.hat)) this._hat(t, 0.10 + 0.04 * inten);
        if ((song.open || []).indexOf(s) >= 0 && inten > 0.4) this._openHat(t, 0.09);
        // the backbeat, once the run is actually moving
        if (inten > 0.6 && (song.snare || []).indexOf(s) >= 0) this._snare(t, 0.9);
        // A fill on the last beat of every eighth bar. Without one, an eight-bar
        // loop just starts again; with one, it arrives somewhere.
        // ...but only on a piece that HAS a backbeat. ABANDON HOPE and
        // NULLPOINT are both written around having no snare anywhere — the
        // absence is the point — and the fill was walking straight through
        // that, dropping a four-hit crescendo into the horror track every
        // fourteen seconds.
        if (inten > 1.2 && bar === 3 && s >= 12 && (song.snare || []).length) {
          this._snare(t, 0.35 + 0.2 * (s - 12));
        }

        // --- Bass (always) ---
        // A written rhythm rather than a note on every other 16th: the pattern is
        // most of what separates these worlds down at the bottom of the mix.
        const bp = song.bass || [0, N, 0, N, 0, N, 0, N];
        const bOff = bp[s % bp.length];
        if (bOff !== null && bOff !== undefined) {
          const bn = chord.root - 12 + bOff;
          A._tone({
            type: song.sub, freq: mtof(bn), dur: 0.24, gain: 0.17,
            attack: 0.004, release: 0.2, at: t, dest: A.musicVoice,
            filter: { type: 'lowpass', freq: 380 + 520 * inten, q: 6 },
          });
          // a sine an octave down for weight the sub oscillator alone does not give
          A._tone({
            type: 'sine', freq: mtof(bn - 12), dur: 0.2, gain: 0.11,
            attack: 0.006, release: 0.16, at: t, dest: A.musicVoice,
          });
        }

        // --- Arp (layer 1) ---
        if (inten > 0.72) {
          const arpNotes = chord.chord;
          const pick = song.arp[step % song.arp.length];
          const n = arpNotes[pick % arpNotes.length] + 12;
          A._tone({
            type: song.wave === 'sine' ? 'triangle' : 'square', freq: mtof(n), dur: 0.14,
            gain: 0.045 * clampNum(inten - 0.7, 0.02, 1),
            attack: 0.003, release: 0.12, at: t, dest: A.musicVoice, send: true,
            filter: { type: 'lowpass', freq: 2200, q: 2 },
          });
        }

        // --- LEAD (layer 2) — the part you can actually hum ---
        // Offsets are relative to the bar's chord root, so the same written line
        // re-harmonises itself as the progression moves under it.
        const ld = song.lead;
        if (ld && inten > 1.15) {
          const off = ld[step % ld.length];
          if (off !== null && off !== undefined) {
            const n = chord.root + off + 12;
            const lvl = 0.085 * clampNum(inten - 1.1, 0.05, 1);
            // three voices a few cents apart: one oscillator sounds like a test
            // tone, a detuned stack sounds like an instrument
            [-7, 0, 7].forEach((cents, i) => {
              A._tone({
                type: song.wave, freq: mtof(n), detune: cents, dur: 0.34,
                gain: i === 1 ? lvl : lvl * 0.6,
                attack: 0.006, release: 0.3, at: t, dest: A.musicVoice, send: i === 1,
                filter: { type: 'lowpass', freq: 1500 + 1800 * clampNum(inten - 1, 0, 2), q: 3 },
              });
            });
          }
        }

        // --- Pad (layer 3, flow) ---
        if (inten > 1.8 && s === 0) {
          chord.chord.forEach((mNote) =>
            A._tone({
              type: song.wave, freq: mtof(mNote + 12), dur: secPerBar(this.bpm), gain: 0.042,
              attack: 0.18, release: secPerBar(this.bpm), at: t, dest: A.musicVoice,
              filter: { type: 'lowpass', freq: 1400, freqTo: 3200, q: 1 }, send: true,
            })
          );
        }
      },

      // Duck the melodic bus under each kick and let it breathe back in. This is
      // the pump the whole genre is built on, and its absence is most of why a
      // synthesised track sounds flat next to a produced one.
      _duck(t) {
        const A = this._audio;
        if (!A.musicVoice || !A.ctx) return;
        const g = A.musicVoice.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(1, t);
        g.linearRampToValueAtTime(0.42, t + 0.012);
        g.linearRampToValueAtTime(1, t + 0.19);
      },

      _kick(t, g) {
        const A = this._audio, ctx = A.ctx;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.68 * g, t + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(gain).connect(A.musicBus);
        osc.start(t); osc.stop(t + 0.2);
      },
      // Every one of these is handed the scheduled beat time and MUST pass it
      // on. Without `at`, _noise falls back to ctx.currentTime — so the hats
      // fired whenever the scheduler happened to wake rather than on the beat,
      // and the snare flammed against its own pitched body, which WAS timed.
      _hat(t, g) {
        this._audio._noise({ at: t, dur: 0.04, gain: g, freq: 9000, filterType: 'highpass', q: 0.7, dest: this._audio.musicBus });
      },
      _clap(t) {
        this._audio._noise({ at: t, dur: 0.14, gain: 0.16, freq: 2000, filterType: 'bandpass', q: 1.2, dest: this._audio.musicBus, send: true });
      },
      // A clap is noise. A snare is noise plus a pitched body — without the body
      // the backbeat disappears the moment anything else is playing.
      _snare(t, g) {
        const A = this._audio;
        const lvl = clampNum(g == null ? 1 : g, 0.05, 1.2);
        A._noise({ at: t, dur: 0.13, gain: 0.15 * lvl, freq: 1800, filterType: 'bandpass', q: 0.9, dest: A.musicBus, send: true });
        A._tone({ type: 'triangle', freq: 190, freqTo: 140, dur: 0.11, gain: 0.10 * lvl,
          attack: 0.002, release: 0.09, at: t, dest: A.musicBus });
      },
      _openHat(t, g) {
        this._audio._noise({ at: t, dur: 0.17, gain: g, freq: 7500, filterType: 'highpass', q: 0.6, dest: this._audio.musicBus, send: true });
      },
    },
  };

  function secPerBar(bpm) { return (60 / bpm) * 4; }

  // The score tables, exposed so the suite can play every song at every
  // intensity rather than trusting that whoever added one also added a test.
  Audio.SONGS = SONGS;

  LUMEN.Audio = Audio;
})();
