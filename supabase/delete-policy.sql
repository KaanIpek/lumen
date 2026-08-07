-- Lets a signed-in player delete their OWN leaderboard row.
--
-- The project shipped with SELECT, INSERT and UPDATE policies and no DELETE
-- policy. Postgres does not error on a DELETE that matches no permitted row —
-- it returns 200 with an empty result — so the app appeared to delete and did
-- not. js/leaderboard.js:deleteMine now checks what actually came back, which
-- is why it reports false until you run this.
--
-- Run it once in Supabase -> SQL Editor.

create policy "delete own score"
  on public.scores
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Verify: this should now list four policies for the table.
-- select policyname, cmd from pg_policies where tablename = 'scores';
