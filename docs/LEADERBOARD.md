# Online leaderboard on Supabase

The game ships with the board **off**. Nothing is sent anywhere until you point
it at a project, and if the network fails the local top-10 still works — an
offline board is the fallback, not an error state.

## The one thing to understand first

**A browser leaderboard cannot be made cheat-proof.** The client runs on the
player's machine; they can read every key it holds and send whatever they like.
Anyone telling you otherwise is selling something.

What you can do is raise the cost and cap the damage:

- database constraints reject impossible values outright
- nobody can edit or delete anyone else's row
- you can delete junk from the dashboard in seconds

Plan for a fake score eventually appearing, and for being able to remove it.
That is the realistic bar for a free arcade board.

## Setup

### 1. Table and policies

Supabase dashboard → SQL Editor → run this:

```sql
create table public.scores (
  id         bigint generated always as identity primary key,
  name       text        not null,
  score      integer     not null,
  combo      integer     not null default 0,
  board      text        not null,
  day        date,
  created_at timestamptz not null default now(),

  -- plausibility, enforced by the database rather than by trust
  constraint name_len   check (char_length(name) between 1 and 16),
  -- A display name is the one thing one player can show another, so it is the
  -- one thing that can be used to say something vile to a stranger. Letters,
  -- digits, space and . _ - only: that keeps ırmak and 深蓝 and drops symbols,
  -- direction-overrides (U+202E), zero-width joiners and lookalike glyphs.
  -- The game cleans the same way before it posts, but the game is not the only
  -- thing that can post — the publishable key is public by design, so a name
  -- rule that lives only in JavaScript is a rule that does not exist.
  constraint name_chars check (name ~ '^[\p{L}\p{N} ._-]+$'),
  constraint score_sane check (score between 0 and 5000000),
  constraint combo_sane check (combo between 0 and 5000),
  constraint board_ok   check (board in ('daily', 'alltime')),
  -- a daily row must say which day; an all-time row must not
  constraint day_ok     check ((board = 'daily') = (day is not null))
);

-- the two reads the game actually makes
create index scores_alltime on public.scores (board, score desc);
create index scores_daily   on public.scores (board, day, score desc);

alter table public.scores enable row level security;

-- OPTIONAL, RECOMMENDED: one row per player, instead of one per personal best.
--
-- The game submits whenever a run beats the player's own record, and every
-- submit is an INSERT — so somebody who improves eight times leaves eight rows,
-- and since the board is just "order by score desc" they can occupy most of the
-- top twenty on their own while everybody else is pushed off it.
--
-- The client already collapses duplicates on READ (Leaderboard._dedupe), so the
-- board is correct without this. What this adds is not writing the junk in the
-- first place: the table stops growing without bound, and a player's row simply
-- climbs. Safe to apply to a table that already has duplicates — the DISTINCT ON
-- keeps each name's best and drops the rest.

-- collapse whatever is already there
delete from public.scores s using public.scores t
  where s.name = t.name and s.board = t.board and s.day is not distinct from t.day
    and (t.score, t.id) > (s.score, s.id);

-- one row per (name, board, day); `day` is null for all-time, so it needs its
-- own index — a unique index treats every NULL as distinct
create unique index scores_one_per_name_daily
  on public.scores (name, board, day) where day is not null;
create unique index scores_one_per_name_alltime
  on public.scores (name, board) where day is null;

-- keep the HIGHER of the two on conflict, never overwrite a better score
create or replace function public.keep_best() returns trigger as $$
begin
  update public.scores
     set score = greatest(scores.score, new.score),
         combo = case when new.score > scores.score then new.combo else scores.combo end,
         created_at = now()
   where name = new.name and board = new.board and day is not distinct from new.day;
  if found then return null; end if;
  return new;
end $$ language plpgsql;

create trigger scores_keep_best before insert on public.scores
  for each row execute function public.keep_best();

-- anyone may read the board
create policy "read scores" on public.scores
  for select using (true);

-- anyone may add a score, and that is all they may do
create policy "insert scores" on public.scores
  for insert with check (true);

-- no update policy and no delete policy: without one, RLS denies both.
-- A player can add their run and can never touch anybody else's.
```

### 2. Point the game at it

Dashboard → Project Settings → API. Copy the **Project URL** and the
**anon / public** key.

In `js/main.js`, inside `boot()`:

```js
LUMEN.Leaderboard.useSupabase(
  'https://YOUR-PROJECT.supabase.co',
  'eyJhbGciOi...'            // the anon key
);
```

**The anon key belongs in the client.** It is published in every copy of the
game by design, and Row Level Security — not the key — is what protects the
table.

**The `service_role` key must never go anywhere near this file.** It ignores
every policy you just wrote. It belongs in server-side code only, and this game
has no server.

### 3. Check it

Play a run, then in the SQL editor:

```sql
select name, score, combo, board, day, created_at
from public.scores order by created_at desc limit 10;
```

## Free tier, and where it runs out

500 MB database, unlimited API requests, 5 GB egress a month, commercial use
allowed, no card required.

A score row is roughly 60 bytes, so 500 MB is millions of runs — you will hit
the egress ceiling long before the storage one, and only with real traffic.

**Free projects pause after 7 days with no database activity.** Players keep it
awake; a quiet game does not. If it pauses, resume it from the dashboard — the
data is kept.

## Keeping it tidy

Old daily rows are dead weight once the day is gone:

```sql
delete from public.scores
where board = 'daily' and day < current_date - interval '30 days';
```

Run it from the dashboard now and then, or attach it to a scheduled job.

And when someone posts 4,999,999:

```sql
delete from public.scores where id = 1234;
```

### Already have a table? Add the name rule to it

`name_chars` arrived after the first tables were created. Adding it to a live
table needs the existing rows cleaned first, or the constraint refuses to
validate:

```sql
-- see what would be affected before changing anything
select id, name from public.scores where name !~ '^[\p{L}\p{N} ._-]+$';

-- strip the disallowed characters; anything left empty becomes 'anon'
update public.scores
   set name = coalesce(nullif(btrim(regexp_replace(name, '[^\p{L}\p{N} ._-]', '', 'g')), ''), 'anon')
 where name !~ '^[\p{L}\p{N} ._-]+$';

alter table public.scores
  add constraint name_chars check (name ~ '^[\p{L}\p{N} ._-]+$');
```

This is the check that lets you answer Apple's user-generated-content question
honestly. A 16-character display name with no messaging, no profiles and no
images is the mildest form of it there is — but "mildest" is not "none", and
what makes the answer true is that the database, not the client, decides what a
name may contain. Keep the delete-a-row snippet above to hand regardless: a
filter stops symbols, not every word someone can spell with letters.

## If you want to make cheating harder later

The write path can move behind an Edge Function that holds a secret, rate-limits
by IP, and rejects scores that no real run could reach in the time submitted.
That raises the bar considerably. It does not remove the problem — nothing does,
short of simulating the run server-side.

---

# The next-update vote

Two tables and one view, in the same project as the board. Skip this and the
vote simply does not exist — the game checks for a poll in `config.js` and shows
nothing if there isn't one.

```sql
-- one row per vote
create table public.poll_votes (
  id         bigint generated always as identity primary key,
  poll_id    text        not null,
  option_id  text        not null,
  voter      text        not null,
  created_at timestamptz not null default now(),

  constraint poll_len   check (char_length(poll_id) between 1 and 32),
  constraint option_len check (char_length(option_id) between 1 and 40),
  constraint voter_len  check (char_length(voter) between 6 and 64)
);

-- One vote per install per poll. This is what actually enforces it; the client
-- also refuses, but the client is on somebody else's computer.
create unique index poll_votes_one_each on public.poll_votes (poll_id, voter);

-- The tallies, and ONLY the tallies. Players must never be able to read the
-- raw rows: `voter` is not personal data, but a public list of who voted for
-- what is a shape you do not want to have to defend later.
create view public.poll_tally
with (security_invoker = off) as
  select poll_id, option_id, count(*)::int as votes
  from public.poll_votes
  group by poll_id, option_id;

alter table public.poll_votes enable row level security;

-- Anyone may cast a vote…
create policy "cast a vote" on public.poll_votes
  for insert with check (true);

-- …and nobody may read, change or delete one. The tally view is the only way
-- back out, which is exactly the amount of access a poll needs.
grant select on public.poll_tally to anon;
```

## Why the client sends `Prefer: resolution=ignore-duplicates`

A second vote from the same install hits the unique index. Without that header
Postgres answers with a 409 and the player sees an error for doing nothing
wrong; with it, the duplicate is quietly dropped and the first vote stands.

## What this does not defend against

Somebody who clears their browser storage can vote again. That is a deliberate
limit: stopping it means accounts, and accounts cost more than a preference
poll among people who already like your game is worth. If a poll is ever close
enough that this matters, the honest fix is to say so and re-run it, not to
build a login.

## Account deletion (App Store Guideline 5.1.1(v))

An app that lets you create an account must let you delete it from inside the
app. Settings -> ACCOUNT -> DELETE ACCOUNT does that, and it needs one thing
that lives in the Supabase project rather than in this repository: run
`supabase/delete-policy.sql` once in the SQL editor.

It adds two things. A DELETE policy on `scores`, without which a delete returns
200 with an empty body -- Postgres politely saying no row matched anything you
may touch, which looks exactly like success, and is why
`Leaderboard.deleteMine()` checks the returned rows rather than the status code.
And `public.delete_own_account()`, a SECURITY DEFINER function that removes the
auth user, which needs rights no browser may hold.

An Edge Function holding the service_role key would also work and was the first
approach here. The database function is better for one reason worth keeping in
mind: it takes the identity from `auth.uid()`, read out of the caller's own
verified JWT, and has no parameter at all. There is nothing to lie about, so a
caller can delete exactly themselves. The Edge Function had to be trusted to
ignore the `user_id` in the request body; this cannot get that wrong.

Until it is run, the button still signs the player out on the device and says
plainly that the server did not confirm, rather than claiming a deletion that
did not happen.
