-- BEYSPOT Supabase SQL setup (run once in the SQL Editor)
-- Only authenticated people can access shared data. Never expose a service_role key.
-- All public data is readable by EVERY authenticated user; restrict sign-ups for private groups.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 32),
  created_at timestamptz not null default now()
);

-- Add profile details to both new and existing databases.
-- Provisional ranks are self-reported during the prototype.
alter table public.profiles
  add column if not exists stadium_status text not null default 'unset'
    check (stadium_status in ('unset', 'owned', 'not_owned', 'store')),
  add column if not exists rank_level text not null default 'unset'
    check (rank_level in ('unset', 'beginner', 'bronze', 'silver', 'gold', 'master'));

alter table public.profiles add column if not exists battle_ready boolean not null default false;

-- Exactly one position per user. Upserts replace the previous one; no route-history table.
create table if not exists public.positions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  precision text not null default 'approx' check (precision in ('approx','exact')),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint positions_expiry_valid check (expires_at > updated_at and expires_at <= updated_at + interval '6 hours 1 minute')
);
create index if not exists positions_active_idx on public.positions(expires_at, updated_at);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  place_name text not null check (char_length(btrim(place_name)) between 1 and 100),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  details text not null default '' check (char_length(details) <= 300),
  created_at timestamptz not null default now(),
  constraint events_times_valid check (ends_at > starts_at)
);
alter table public.events
  add column if not exists stadium_plan text not null default 'unset' check (stadium_plan in ('unset','bring','store','wanted')),
  add column if not exists auto_place text;
create index if not exists events_start_idx on public.events(starts_at);
create index if not exists events_end_idx on public.events(ends_at);

create table if not exists public.rsvps (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(event_id,user_id)
);

alter table public.profiles enable row level security;
alter table public.positions enable row level security;
alter table public.events enable row level security;
alter table public.rsvps enable row level security;

-- Recreate app-specific policies without disturbing unrelated roles.
drop policy if exists "profiles_read" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_read" on public.profiles for select to authenticated using (true);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "positions_read_active" on public.positions;
drop policy if exists "positions_read_own" on public.positions;
drop policy if exists "positions_insert_own" on public.positions;
drop policy if exists "positions_update_own" on public.positions;
drop policy if exists "positions_delete_own" on public.positions;
create policy "positions_read_active" on public.positions for select to authenticated
  using (expires_at > now() and updated_at > now() - interval '5 minutes');
-- Owner can also see/overwrite an expired own row (needed for UPSERT).
create policy "positions_read_own" on public.positions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "positions_insert_own" on public.positions for insert to authenticated
  with check (user_id = (select auth.uid()) and updated_at between now() - interval '2 minutes' and now() + interval '2 minutes' and expires_at > now());
create policy "positions_update_own" on public.positions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and updated_at between now() - interval '2 minutes' and now() + interval '2 minutes' and expires_at > now());
create policy "positions_delete_own" on public.positions for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "events_read" on public.events;
drop policy if exists "events_insert_own" on public.events;
drop policy if exists "events_update_own" on public.events;
drop policy if exists "events_delete_own" on public.events;
create policy "events_read" on public.events for select to authenticated using (true);
create policy "events_insert_own" on public.events for insert to authenticated
  with check (user_id = (select auth.uid()) and ends_at > now());
create policy "events_update_own" on public.events for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and ends_at > now());
create policy "events_delete_own" on public.events for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "rsvps_read" on public.rsvps;
drop policy if exists "rsvps_insert_own" on public.rsvps;
drop policy if exists "rsvps_delete_own" on public.rsvps;
create policy "rsvps_read" on public.rsvps for select to authenticated using (true);
create policy "rsvps_insert_own" on public.rsvps for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "rsvps_delete_own" on public.rsvps for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.profiles, public.positions, public.events, public.rsvps from anon;
grant select,insert,update,delete on public.profiles, public.positions, public.events, public.rsvps to authenticated;

-- Realtime events. Re-running this block is safe.
do $$
declare t text;
begin
  foreach t in array array['profiles','positions','events','rsvps'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Optional privacy/retention maintenance: schedule with pg_cron if enabled.
-- select cron.schedule('beyspot-purge-expired-positions', '*/10 * * * *',
--   $$delete from public.positions where expires_at < now() or updated_at < now() - interval '10 minutes'$$);

-- ============================================================
-- 通報・管理者（エクステン堂版で追加）
-- ・3人から通報された予定／位置共有は、本人と管理者以外から見えなくなる
-- ・管理者は profiles.is_admin = true の人（Table Editor で手動で設定）
-- ============================================================
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- 利用者が自分で is_admin を書きかえられないよう、更新・追加できる列を限定する
revoke insert, update on public.profiles from authenticated;
grant insert (id, display_name, stadium_status, rank_level, battle_ready) on public.profiles to authenticated;
-- upsert は id も SET するため id も含める（RLSで自分の行しか変えられない）
grant update (id, display_name, stadium_status, rank_level, battle_ready) on public.profiles to authenticated;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('event','user')),
  target_id text not null,
  reason text not null default 'その他' check (reason in ('迷惑・いたずら','個人の住所・職場','不適切な内容','その他')),
  created_at timestamptz not null default now(),
  unique (reporter, target_type, target_id)
);
alter table public.reports enable row level security;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

create or replace function public.is_hidden(t text, target text) returns boolean
  language sql stable security definer set search_path = public as
$$ select (select count(distinct reporter) from public.reports where target_type = t and target_id = target) >= 3 $$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_hidden(text, text) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_hidden(text, text) to authenticated;

drop policy if exists "reports_insert_own" on public.reports;
drop policy if exists "reports_read" on public.reports;
drop policy if exists "reports_delete_admin" on public.reports;
create policy "reports_insert_own" on public.reports for insert to authenticated
  with check (reporter = (select auth.uid()));
create policy "reports_read" on public.reports for select to authenticated
  using (reporter = (select auth.uid()) or public.is_admin());
create policy "reports_delete_admin" on public.reports for delete to authenticated
  using (public.is_admin());
revoke all on public.reports from anon;
grant select, insert, delete on public.reports to authenticated;

-- 通報が3人に達したものを隠す（本人と管理者には見える）
drop policy if exists "events_read" on public.events;
create policy "events_read" on public.events for select to authenticated
  using (not public.is_hidden('event', id::text) or user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "positions_read_active" on public.positions;
create policy "positions_read_active" on public.positions for select to authenticated
  using (expires_at > now() and updated_at > now() - interval '5 minutes'
         and (not public.is_hidden('user', user_id::text) or public.is_admin()));

-- 管理者はどの予定・位置共有でも削除できる
drop policy if exists "events_delete_admin" on public.events;
create policy "events_delete_admin" on public.events for delete to authenticated using (public.is_admin());
drop policy if exists "positions_delete_admin" on public.positions;
create policy "positions_delete_admin" on public.positions for delete to authenticated using (public.is_admin());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports') then
    execute 'alter publication supabase_realtime add table public.reports';
  end if;
end $$;

-- ============================================================
-- 「ここにいる」の時間指定（2026-11-19 追加）
-- kind = 'live'（GPSで自動更新。5分更新が止まると消える）/ 'checkin'（選んだ地点。期限まで表示）
alter table public.positions add column if not exists kind text not null default 'live';
alter table public.positions drop constraint if exists positions_kind_valid;
alter table public.positions add constraint positions_kind_valid check (kind in ('live','checkin'));
drop policy if exists "positions_read_active" on public.positions;
create policy "positions_read_active" on public.positions for select to authenticated
  using (expires_at > now() and (kind = 'checkin' or updated_at > now() - interval '5 minutes')
         and (not public.is_hidden('user', user_id::text) or public.is_admin()));
