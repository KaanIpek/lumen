-- LUMEN — redeem codes and the daily reward.
--
-- Run once in Supabase -> SQL Editor. Both features need the same thing, and it
-- is the thing this project has never had: a little state that belongs to an
-- ACCOUNT rather than to a phone.
--
-- WHY NOT IN THE CLIENT
--   The repository is public and the JavaScript ships inside every build, so a
--   code list written into js/ is readable by anyone in about a minute. Shards
--   are also sold as an in-app purchase; a code that mints them and is legible
--   to everyone is not a promotion, it is a hole in the shop. The list lives
--   here, the client never receives it, and the only door is the function below.
--
--   The daily reward has the same shape of problem for a different reason: the
--   date. js/missions.js reads `new Date()`, which is the phone's clock, and a
--   phone's clock is whatever its owner sets it to. The day below comes from
--   the database.
--
-- WHAT A PLAYER CAN DO WITH THE PUBLISHABLE KEY AFTER THIS
--   Read their own redemptions and their own claims. Nothing else. They cannot
--   list the codes, cannot see anyone else's rows, and cannot write to either
--   table directly -- every write goes through a SECURITY DEFINER function that
--   takes the player's identity from auth.uid() and never from an argument.

-- ---------------------------------------------------------------- codes ---

create table if not exists public.promo_codes (
  code        text primary key,
  grant_json  jsonb       not null,
  max_uses    integer     not null default 1,   -- 0 means unlimited
  uses        integer     not null default 0,
  expires_at  timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  constraint  uses_sane check (uses >= 0 and max_uses >= 0)
);

-- RLS on, and DELIBERATELY no policies: with row-level security enabled and no
-- policy granting anything, no client role can read or write a single row. The
-- function below runs as this table's owner and is the only way in.
alter table public.promo_codes enable row level security;

create table if not exists public.promo_redemptions (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  code       text        not null references public.promo_codes(code) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (user_id, code)
);
alter table public.promo_redemptions enable row level security;

drop policy if exists "see my redemptions" on public.promo_redemptions;
create policy "see my redemptions" on public.promo_redemptions
  for select to authenticated using (auth.uid() = user_id);

-- Redeem. Returns {ok:false, reason} rather than raising, because every reason
-- is something the player should be told in their own language rather than an
-- error code they would have to look up.
create or replace function public.redeem_promo(p_code text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, auth
as $fn$
declare
  uid uuid := auth.uid();
  c   public.promo_codes%rowtype;
  key text := upper(btrim(coalesce(p_code, '')));
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'signin');
  end if;
  if key = '' or length(key) > 32 then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  -- FOR UPDATE so two devices spending the last use of a code cannot both win.
  select * into c from public.promo_codes where code = key for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.max_uses > 0 and c.uses >= c.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'usedup');
  end if;
  if exists (select 1 from public.promo_redemptions r
              where r.user_id = uid and r.code = c.code) then
    -- The grant travels with the refusal. The redemption COMMITS before this
    -- function answers, so a reply lost in transit burns the code and pays
    -- nothing; returning what it was worth lets the client notice it never
    -- applied this one and settle it. It cannot be used to farm: the client
    -- records which codes it has applied, and the row here is what stops a
    -- second redemption regardless.
    return jsonb_build_object('ok', false, 'reason', 'already', 'grant', c.grant_json,
                              'code', c.code);
  end if;

  insert into public.promo_redemptions (user_id, code) values (uid, c.code);
  update public.promo_codes set uses = uses + 1 where code = c.code;
  return jsonb_build_object('ok', true, 'grant', c.grant_json, 'code', c.code);
end $fn$;

revoke all on function public.redeem_promo(text) from public, anon;
grant execute on function public.redeem_promo(text) to authenticated;

-- ---------------------------------------------------------------- daily ---

create table if not exists public.daily_claims (
  user_id  uuid    not null references auth.users(id) on delete cascade,
  day      date    not null,
  streak   integer not null,
  shards   integer not null,
  primary key (user_id, day),
  constraint streak_sane check (streak between 1 and 100000),
  constraint shards_sane check (shards between 0 and 100000)
);
alter table public.daily_claims enable row level security;

drop policy if exists "see my claims" on public.daily_claims;
create policy "see my claims" on public.daily_claims
  for select to authenticated using (auth.uid() = user_id);

-- The ladder, in ONE place, so the status call and the claim call cannot drift.
create or replace function public.daily_reward(n integer)
  returns integer language sql immutable as $fn$
  select case
    when n >= 7 then 500
    when n = 6  then 320
    when n = 5  then 240
    when n = 4  then 170
    when n = 3  then 120
    when n = 2  then 85
    else 60
  end $fn$;

-- What the screen shows, without collecting anything.
create or replace function public.daily_status()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, auth
as $fn$
declare
  uid   uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  last  public.daily_claims%rowtype;
  n     integer;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'signin');
  end if;
  select * into last from public.daily_claims d
    where d.user_id = uid order by d.day desc limit 1;
  if found and last.day = today then
    -- Already collected. Say what tomorrow is worth, so the screen has
    -- something true to show rather than a blank.
    -- `shards` as well as `next`: the claim COMMITS before it answers, so a
    -- reply lost to a tunnel leaves the day taken and the player unpaid. This
    -- is the only way back — the client compares it against what it has
    -- recorded receiving and settles the difference. Without it the reward is
    -- destroyed, and shards are sold for money.
    return jsonb_build_object('ok', true, 'claimed', true, 'streak', last.streak,
                              'shards', last.shards,
                              'next', public.daily_reward(last.streak + 1), 'day', today);
  end if;
  if found and last.day = today - 1 then n := last.streak + 1; else n := 1; end if;
  return jsonb_build_object('ok', true, 'claimed', false, 'streak', n,
                            'shards', public.daily_reward(n), 'day', today);
end $fn$;

revoke all on function public.daily_status() from public, anon;
grant execute on function public.daily_status() to authenticated;

-- Collect. The DAY comes from this server, which is the whole point.
create or replace function public.claim_daily()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, auth
as $fn$
declare
  uid   uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  last  public.daily_claims%rowtype;
  n     integer;
  pay   integer;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'signin');
  end if;
  select * into last from public.daily_claims d
    where d.user_id = uid order by d.day desc limit 1;
  if found and last.day = today then
    return jsonb_build_object('ok', false, 'reason', 'today', 'streak', last.streak,
                              'shards', last.shards,
                              'next', public.daily_reward(last.streak + 1));
  end if;
  if found and last.day = today - 1 then n := last.streak + 1; else n := 1; end if;
  pay := public.daily_reward(n);

  -- The primary key is (user_id, day), so two devices tapping at once cannot
  -- both collect: the second insert loses and reports the day as already taken.
  begin
    insert into public.daily_claims (user_id, day, streak, shards)
    values (uid, today, n, pay);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'today', 'streak', n);
  end;

  return jsonb_build_object('ok', true, 'streak', n, 'shards', pay,
                            'next', public.daily_reward(n + 1), 'day', today);
end $fn$;

revoke all on function public.claim_daily() from public, anon;
grant execute on function public.claim_daily() to authenticated;

-- ------------------------------------------------------------- the codes ---
--
-- THIS FILE DELIBERATELY CONTAINS NO CODES, and the first version of it did.
--
-- The header above argues that a code cannot live in js/ because this
-- repository is public. It is the same repository. Writing three codes here --
-- one of them unlimited and granting every cosmetic plus 999,999 shards --
-- published them to the world in the same commit that explained why they must
-- never be published. A test meant to guard against exactly that hardcoded all
-- three as well, so the guard leaked the secret it guarded.
--
-- So: add yours BY HAND in the SQL editor, and never commit them. The template
-- is below; the values in it are not usable codes.
--
--   insert into public.promo_codes (code, grant_json, max_uses, expires_at, note)
--   values ('PICK-YOUR-OWN',
--           '{"unlockAll": true, "shards": 999999}'::jsonb,
--           5,                       -- a real limit, never 0 for a grant like this
--           now() + interval '30 days',
--           'what it is for');
--
-- Rules worth keeping:
--   * `max_uses = 0` is unlimited. Only ever use it for something you would be
--     happy to see on a forum -- a small shard gift, never `unlockAll`.
--   * Set `expires_at` on anything valuable. A code with no expiry is a
--     permanent liability the day it leaks.
--   * To retire a code, do NOT delete it: the foreign key on
--     promo_redemptions cascades, which erases the record of who used it, and
--     re-running this file would not remove it anyway. Expire it:
--         update public.promo_codes set expires_at = now() where code = 'X';
--   * Codes are typed by people. Avoid O next to 0 and I next to 1.

-- Check. Expect NO codes yet, four functions, and policies ONLY on the two
-- tables a player may read from -- promo_codes must have none.
select code, max_uses, uses, grant_json from public.promo_codes order by code;
select routine_name, security_type from information_schema.routines
 where routine_schema = 'public'
   and routine_name in ('redeem_promo', 'daily_status', 'claim_daily', 'daily_reward');
select tablename, policyname, cmd from pg_policies
 where tablename in ('promo_codes', 'promo_redemptions', 'daily_claims')
 order by tablename;
