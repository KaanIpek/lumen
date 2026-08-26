-- LUMEN — why can ONE person not sign in when everybody else can?
--
-- Run this in Supabase -> SQL Editor, against the `lumen` project. It is
-- READ-ONLY: there is not a single write in this file, so it is safe to paste
-- and run without reading it first. It changes nothing and deletes nothing.
--
-- A sign-in that fails for one account and works for every other account is
-- never a configuration problem. If the Apple client id or the audience were
-- wrong, NOBODY could sign in. So the cause is a row, and one of the four
-- queries below is holding it.

-- 1. Every auth user, with the three flags that stop a sign-in dead.
select 'user' as kind,
       coalesce(u.email, '(no email)')                as who,
       left(u.id::text, 8)                            as id8,
       to_char(u.created_at,      'MM-DD HH24:MI')    as created,
       to_char(u.last_sign_in_at, 'MM-DD HH24:MI')    as last_sign_in,
       coalesce(u.raw_app_meta_data->>'provider', '?') as provider,
       nullif(concat_ws(' ',
         case when u.banned_until is not null then 'BANNED' end,
         case when u.deleted_at   is not null then 'SOFT-DELETED' end
       ), '')                                          as flags
from auth.users u

union all

-- 2. Every identity, and whether the user it points at still exists.
--
--    This is the one to look at first. Deleting a user is supposed to take its
--    identities with it. If an identity outlives its user, the next sign-in
--    with that Apple ID finds a row claiming a user that is gone, and fails
--    with a database error rather than creating a fresh account. It would
--    affect exactly one person: the one who deleted their account.
select 'identity',
       coalesce(i.identity_data->>'email', '(no email)'),
       left(i.user_id::text, 8),
       to_char(i.created_at,      'MM-DD HH24:MI'),
       to_char(i.last_sign_in_at, 'MM-DD HH24:MI'),
       i.provider,
       case when u.id is null then 'ORPHAN - owner is gone' end
from auth.identities i
left join auth.users u on u.id = i.user_id

order by 1, 4;


-- 3. Two users holding the same email address. Apple returns the same address
--    every time, so if a second row already carries it, the sign-in that has to
--    CREATE a user cannot. Expect zero rows.
select email, count(*) as rows_with_this_email
from auth.users
where email is not null
group by email
having count(*) > 1;


-- 4. Leaderboard rows with no living owner.
--
--    `scores_one_per_name_alltime` is a UNIQUE index on the display name. A row
--    left behind by a deleted account still occupies that name, so the player
--    coming back cannot claim the name that is visibly theirs — and the failure
--    surfaces at sign-in, because that is when the app claims it. Expect every
--    row to say `ok`.
select s.name, s.board, s.score,
       case when s.user_id is null then 'NO OWNER'
            when u.id is null      then 'OWNER DELETED'
            else 'ok' end as state
from public.scores s
left join auth.users u on u.id = s.user_id
order by state, s.score desc;
