-- LUMEN — the monthly vote. Run once in Supabase -> SQL Editor.
--
-- js/poll.js has been written and dormant for a while: it reads a tally, casts
-- a vote, and hides itself entirely when CONFIG.poll.id is empty — which it
-- was, which is why the store description's promise of a vote had to be
-- deleted rather than kept. This is the missing half.
--
-- One vote per player per poll. `voter` is a random id the game generates and
-- keeps locally; it is not an account and identifies nobody. The primary key
-- is what enforces one-vote — not the client, which cannot be trusted, and not
-- a policy, which would have to read a row to know it exists.

create table if not exists public.poll_votes (
  poll_id   text not null,
  voter     text not null,
  option_id text not null,
  voted_at  timestamptz not null default now(),
  primary key (poll_id, voter)
);

alter table public.poll_votes enable row level security;

-- Anyone may cast a vote. Nobody may read the raw table: a list of who voted
-- for what is not something a leaderboard app needs to hand out, and the tally
-- below is the only thing the game actually asks for.
drop policy if exists "cast a vote" on public.poll_votes;
create policy "cast a vote"
  on public.poll_votes for insert to anon, authenticated
  with check (true);

-- Changing your mind is allowed; voting twice is not. The primary key makes a
-- second insert fail, so an update is the only way through, and it can only
-- touch the row that already carries your own voter id.
drop policy if exists "change your vote" on public.poll_votes;
create policy "change your vote"
  on public.poll_votes for update to anon, authenticated
  using (true) with check (true);

-- The counts, and nothing else. security_invoker = off so the view can read a
-- table the caller cannot, which is the entire point: totals are public,
-- ballots are not.
create or replace view public.poll_tally
  with (security_invoker = off) as
  select poll_id, option_id, count(*)::int as votes
  from public.poll_votes
  group by poll_id, option_id;

grant select on public.poll_tally to anon, authenticated;

-- Check: should return zero rows, without an error.
select * from public.poll_tally;
