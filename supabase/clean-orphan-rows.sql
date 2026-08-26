-- LUMEN — retire the rows from before the board had owners.
--
-- Run once in Supabase -> SQL Editor. Read-only until `commit`, and it either
-- all happens or none of it does.
--
-- WHY THERE ARE ORPHANS: `scores.user_id` had no `default auth.uid()` until
-- 2026-08-24 and the client never sent one, so every row written before then
-- landed with a null owner. An unowned row still shows on the board and still
-- outranks people, but nobody can delete it, rename it or claim it -- and two
-- were sitting at the top: `anon` with 12000, ten times any real score, and
-- `Rldranger` with 1211, which belongs to a player who is right here.
--
-- ORDER MATTERS, and the first version of this file got it wrong.
-- `scores_one_row_per_user` is unique on (user_id, board, coalesce(day, ...)),
-- so an account may hold exactly one all-time row. Handing the 1211 over while
-- its owner still held a 900 raised 23505. The 900 goes first.
--
-- (That index is also why seventeen `anon` rows could pile up at all: they all
-- carry a null user_id, and NULLs never collide in a unique index.)

begin;

-- 1. The row this account holds today, so the claim below has somewhere to land.
delete from public.scores
 where user_id = '3cdc859b-7be4-417f-ab05-0702c5b048e6'
   and board   = 'alltime';

-- 2. Give the 1211 back to the account that earned it, under the name that
--    account uses now. Renaming rather than deleting matters: it is a real
--    personal best from 2026-08-04, and it is the number that player's device
--    still holds as their record.
update public.scores
   set user_id = '3cdc859b-7be4-417f-ab05-0702c5b048e6',
       name    = 'Rldrangers'
 where id = 25;

-- 3. Everything still without an owner is from before ownership existed:
--    seventeen rows written 2026-07-30 to 2026-08-03, all `anon` or `RLD`,
--    none of them reachable by whoever set them. Row 25 now has an owner, so
--    it is not caught by this.
delete from public.scores
 where user_id is null;

commit;

-- Check. Every row should have an owner, and `Rldrangers` should read 1211.
select id, name, score, board, user_id
  from public.scores
 order by board, score desc;
