-- LUMEN — make every row on the board belong to somebody.
--
-- Run this once in Supabase -> SQL Editor, against the `lumen` project.
--
-- WHY. Every row on the live board came back with `user_id: null`, including
-- rows written by a signed-in player. js/leaderboard.js assumed the column
-- defaulted to auth.uid(); it does not. Nothing complained, because an unowned
-- row still shows up on the board and still scores — but:
--
--   * DELETE /scores?user_id=eq.<me> matched nothing, so account deletion
--     could never remove a player's entry and said "the server did not
--     confirm". Personal data stayed on a public board after a deletion, which
--     is the thing App Store Guideline 5.1.1(v) exists to prevent.
--   * rename() could not find the rows to rewrite, so an old display name
--     stayed up forever.
--   * the (user_id, board, day) unique index could not dedupe, because NULLs
--     never collide in a unique index. That is why one player's 5000 is on the
--     board twice.
--
-- The client now sends user_id itself, so this is defence in depth: it stops
-- the server accepting an orphan from an older build that is still installed.

-- 1. A row with no author defaults to its author.
alter table public.scores alter column user_id set default auth.uid();

-- 2. And nobody may file a row under somebody else — or under nobody.
--
-- RLS policies are OR'd together, so adding a strict one while a permissive one
-- survives changes nothing at all. Drop whatever INSERT policies exist by name,
-- whatever they were called, then write the single rule that should hold.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'scores' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.scores', p.policyname);
  end loop;
end $$;

create policy "insert own score"
  on public.scores
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- 3. Check. `orphans` counts rows nobody can ever delete or rename; it will not
--    fall on its own, because the rows predate this rule.
select count(*) filter (where user_id is null) as orphans,
       count(*)                                as total
  from public.scores;

select policyname, cmd from pg_policies
 where schemaname = 'public' and tablename = 'scores'
 order by cmd, policyname;

-- 4. OPTIONAL, and your call — the old unowned rows.
--
-- They are the board as it stood before accounts existed. Nobody can delete
-- their own, because none of them say whose they are. Leaving them is honest
-- history; clearing them gives everyone a board they can actually control.
-- Uncomment ONE line if you want them gone. There is no undo.
--
-- delete from public.scores where user_id is null;                    -- all of them
-- delete from public.scores where user_id is null and name = 'anon';  -- just the nameless
