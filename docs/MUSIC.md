# Music in LUMEN

## What ships today

Two layers, and the split matters.

**Synthesised, always.** Every sound effect, and the adaptive arrangement that
thickens as your chain climbs and drops away the moment it breaks, is generated
at runtime by the Web Audio API. That is about 4 KB of source and it reacts to
the run frame by frame, which no recording can.

**Recorded, per world.** Each of the six worlds also has a full theme in
`assets/music/` — about 4.5 MB of MP3 in total. These are **fetched lazily**:
the game boots and plays on the synthesised engine, and a track takes over when
it lands. So the first screen never waits on 4.5 MB, and a world whose file is
missing or fails to load simply keeps playing the live sequencer. There is no
state in which the game is silent because of a missing asset.

### Where the recorded tracks came from

They were generated **locally** with **Stable Audio 3**, in `D:\cowork\StableAudio`:

| | |
| --- | --- |
| Generator | `generate.py` — one prompt per world, tempo and key stated |
| Model | `models/sa3-medium` (`stabilityai/stable-audio-3-medium-base`, 9.2 GB) |
| Renders | `out/<world>/full.wav`, 45 s each, seed 7 |
| Prompts used | `out/prompts.json` |
| Shipped as | `assets/music/<world>.mp3` (LAME 3.100, VBR) |

Nothing was uploaded and no service was paid. **We own the audio** — the
Stability AI Community License assigns output ownership to whoever generated it.

Two obligations come with that, and both are already met in the repo except the
one that needs your account:

- **Attribution.** "Powered by Stability AI" appears on the Settings screen, in
  `NOTICE`, and in the README. Do not remove it.
- **Registration.** Commercial use is free under USD $1M annual revenue *but
  requires registering* at <https://stability.ai/community-license>. LUMEN sells
  cosmetics, so it is commercial. **This is a to-do, not a done.**

The model also bundles a Gemma-derived text encoder, redistributed under the
[Gemma Terms of Use](https://ai.google.dev/gemma/terms). See `NOTICE`.

## Six worlds, six pieces

Each map has its own composition — not one track transposed six ways. Different
chords, different tempo, different drum pattern, different instrument voices.
The synthesised fallback for each world is written to the same brief.

| World | Tempo | Feel |
| --- | --- | --- |
| Deep Field | 124 | Driving synthwave, four-on-the-floor |
| Emberfall | 138 | Hot and urgent, off-beat push |
| Tidal | 104 | Wide and slow, suspended chords, half-time |
| Mosslight | 112 | Organic and lilting, gentle major |
| Monolith | 92 | Vast and cold, open fifths, heavy slow kick |
| Solaris | 132 | Tense and bright, unsettled, busy hats |

The synthesised versions are defined in `SONGS` at the top of `js/audio.js`.
Editing one is editing an array of chords — you do not need to touch the
sequencer.

## How it answers the run

| The run does | The music does |
| --- | --- |
| Speeds up | Tempo rises with it (about 107 → 166 BPM) |
| Chain reaches 4 | The arp comes in |
| Chain nears flow | Pad and lead come in |
| Flow triggers | Full arrangement |
| Chain breaks | Layers drop away immediately |
| You change world | A different piece, at its own tempo |

The Daily Challenge always plays Deep Field, for the same reason it always flies
the neutral map: a shared course cannot sound different depending on what you own.

## If you want recorded music instead

There is a drop-in slot. Put a file in `assets/music/` and claim a world:

```js
LUMEN.Audio.music.useTrack('emberfall', 'assets/music/emberfall.ogg')
LUMEN.Audio.music.useTrack('*', 'assets/music/theme.ogg')   // every world
```

A loaded track replaces the sequencer for that map. The adaptive layers and the
key no longer apply — you cannot re-voice a finished recording — but the
**playback rate still follows the run**, so it still accelerates with the
corridor. A missing or failed file falls back to the generated piece, so a bad
path is never silence.

### Where to get music you can actually ship

**I did not download any of these for you, and you should not take my word for
the licence — check the page for the specific track before you ship it.** Terms
differ per track even on the same site, and they change.

| Source | Typical licence | Attribution |
| --- | --- | --- |
| [OpenGameArt](https://opengameart.org) | CC0 / CC-BY / GPL, per track | Depends |
| [Free Music Archive](https://freemusicarchive.org) | CC, per track | Usually yes |
| [Incompetech](https://incompetech.com) (Kevin MacLeod) | CC-BY | Yes |
| [Pixabay Music](https://pixabay.com/music/) | Pixabay licence | No |
| [ccMixter](https://ccmixter.org) | CC, per track | Usually yes |

Two things that will get a build rejected or a video demonetised:

1. **"Free to download" is not "free to use."** Check the licence, not the
   download button.
2. **CC-BY needs credit.** If you use an attribution track, the credit has to be
   somewhere a player can find it — add it to the settings screen, not just a
   README nobody opens.

CC0 avoids both problems entirely, which is why it is worth filtering for.

## Turning it off

Music and SFX are independent toggles in Settings, and both persist. The engine
never starts a context until the first user gesture, so an autoplay policy can
never leave the game silent-but-thinking-it-is-playing.
