# LUMEN — online leaderboard

The daily challenge plans an identical course for every player, so a shared board
is the natural payoff. The game works completely without this; the board is
opt-in and additive.

## Run the reference server

```bash
node server/leaderboard-server.js
```

Defaults to `:5190`, storing JSON under `server/data/`. Override with
`PORT` and `DATA` environment variables.

## Point the game at it

In `js/leaderboard.js` (or from your own bootstrap):

```js
LUMEN.Leaderboard.endpoint = 'https://your-host.example';
```

Leave it `null` — the shipped default — and the game never contacts a network.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/top?board=daily\|alltime&day=YYYY-MM-DD&limit=20` | fetch a board |
| `POST` | `/submit` | `{name, score, combo, board, day}` |

## What it does and doesn't guarantee

**Does:** one entry per display name (the board shows people, not attempts),
per-IP rate limiting, rejects absurd or malformed scores, strips anything but
letters/digits/spaces from names, caps body size, and keeps daily boards in
separate files so they roll over naturally.

**Doesn't:** prove a score is real. No browser game can — the score is computed on
the player's machine and anyone can call the endpoint directly. This is fine for a
friendly board. If you need integrity, either move scoring server-side (replay the
seeded daily from the player's inputs) or sign runs with a server-issued token and
validate the input stream. Don't ship a board you'll treat as authoritative and
then be surprised.

**Privacy:** only the display name, score and combo are stored. Tell players to
pick a nickname — `privacy.html` already does. IPs are used for rate limiting and
not persisted.

## Porting

The whole thing is one dependency-free file of plain Node. The storage layer is
two functions (`load`/`save`) over JSON files — swap those for Redis, SQLite,
Postgres, a KV store, or a Worker binding and the rest is unchanged.
