-- LUMEN — everything the account-deletion button needs, in one paste.
--
-- App Store Review Guideline 5.1.1(v): an app that lets you create an account
-- must let you delete it from inside the app. Run this once in
-- Supabase -> SQL Editor, against the `lumen` project.

-- 1. Let a signed-in player delete their own leaderboard row.
--
-- The project shipped with SELECT, INSERT and UPDATE policies and no DELETE
-- policy. Postgres does not error on a DELETE that matches no permitted row --
-- it returns 200 with an empty result -- so the app appeared to delete and did
-- not. js/leaderboard.js:deleteMine() checks the returned rows for that reason.
drop policy if exists "delete own score" on public.scores;
create policy "delete own score"
  on public.scores
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 2. Let a signed-in player delete their own ACCOUNT.
--
-- Removing a row from auth.users needs rights no browser may hold, so it runs
-- as the function's owner rather than as the caller. That is safe here for one
-- reason and you should check it before trusting this: the id comes from
-- auth.uid(), which is read out of the caller's own verified JWT, and never
-- from an argument. There is no parameter to lie about. A caller can delete
-- exactly themselves and nothing else.
create or replace function public.delete_own_account()
  returns void
  language plpgsql
  security definer
  set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.scores where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

-- Nobody signed out can call it, and it is not part of the public API surface.
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- 3. Check. Expect four policies on `scores` (select/insert/update/delete)
--    and one row for the function.
select policyname, cmd from pg_policies where tablename = 'scores' order by cmd;
select routine_name, security_type from information_schema.routines
  where routine_schema = 'public' and routine_name = 'delete_own_account';
