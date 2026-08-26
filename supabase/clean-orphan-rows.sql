-- LUMEN — retire the rows from before the board had owners.
--
-- Run once in Supabase -> SQL Editor. Every row it touches is listed below and
-- nothing else is affected; the six rows written on 2026-08-26 by real accounts
-- are left alone except where step 2 says otherwise.
--
-- WHY THERE ARE ORPHANS AT ALL: `scores.user_id` had no `default auth.uid()`
-- until 2026-08-24 and the client never sent one, so every row written before
-- then landed with a null owner. An unowned row still shows on the board and
-- still outranks people, but nobody can delete it, rename it or claim it -- and
-- two of them were sitting at the top: `anon` with 12000, which is ten times
-- any real score on the board, and `Rldranger` with 1211, which belongs to a
-- player who is right here and cannot reach it.

begin;

-- 1. Give the 1211 back to the account that earned it, under the name that
--    account is currently using. Renaming rather than deleting matters: it is a
--    real personal best set on 2026-08-04, and it is the number that player's
--    device still holds as their record.
update public.scores
   set user_id = '3cdc859b-7be4-417f-ab05-0702c5b048e6',
       name    = 'Rldrangers'
 where id = 25;

-- 2. That account now has two all-time rows. Keep the better one.
delete from public.scores
 where user_id = '3cdc859b-7be4-417f-ab05-0702c5b048e6'
   and board   = 'alltime'
   and id     <> 25;

-- 3. Everything still without an owner is from before ownership existed:
--    seventeen rows written 2026-07-30 to 2026-08-03, all of them `anon` or
--    `RLD`, none of them reachable by the person who set them.
delete from public.scores
 where user_id is null;

commit;

-- Check. Expect every row to have an owner, and `Rldrangers` to read 1211.
select id, name, score, board, user_id
  from public.scores
 order by board, score desc;
