-- ============================================================
-- 出没エリア・対戦記録・#番号（2026-11-20 追加）
-- Supabase の SQL Editor でこのファイルを丸ごと1回実行する（何度実行しても大丈夫）
-- ============================================================

-- 1) 名前の後ろにつく4ケタの番号（自動で決まる。本人は変えられない）
alter table public.profiles add column if not exists tag text not null
  default lpad((floor(random()*9000)+1000)::int::text, 4, '0');

-- 2) 出没エリア（期限なし・1人3か所まで）
create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  when_text text not null default '' check (char_length(when_text) <= 40),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
create index if not exists areas_user_idx on public.areas(user_id);
alter table public.areas enable row level security;

create or replace function public.areas_limit() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if (select count(*) from public.areas where user_id = new.user_id) >= 3 then
    raise exception '出没エリアは3か所までです';
  end if;
  return new;
end $$;
drop trigger if exists areas_limit_trg on public.areas;
create trigger areas_limit_trg before insert on public.areas for each row execute function public.areas_limit();

drop policy if exists "areas_read" on public.areas;
create policy "areas_read" on public.areas for select to authenticated
  using (not public.is_hidden('user', user_id::text) or user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "areas_read_anon" on public.areas;
create policy "areas_read_anon" on public.areas for select to anon using (not public.is_hidden('user', user_id::text));
drop policy if exists "areas_insert_own" on public.areas;
create policy "areas_insert_own" on public.areas for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "areas_update_own" on public.areas;
create policy "areas_update_own" on public.areas for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "areas_delete_own" on public.areas;
create policy "areas_delete_own" on public.areas for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
grant select on public.areas to anon;
grant select, insert, update, delete on public.areas to authenticated;

-- 3) 対戦記録
--   pending   = 相手の承認待ち（本人と相手だけが見える）
--   confirmed = 相手がOKした確定記録（全員に見える・戦績に数える）
--   memo      = 未登録の相手との記録（本人だけが見える）
create table if not exists public.battles (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null default auth.uid() references auth.users(id) on delete cascade,
  opponent uuid references auth.users(id) on delete cascade,
  opponent_name text not null default '' check (char_length(opponent_name) <= 32),
  result text not null check (result in ('win','lose','draw')),
  my_score smallint check (my_score between 0 and 99),
  their_score smallint check (their_score between 0 and 99),
  note text not null default '' check (char_length(note) <= 100),
  place text not null default '' check (char_length(place) <= 60),
  status text not null default 'pending' check (status in ('pending','confirmed','memo')),
  played_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint battles_opponent_valid check (
    (status = 'memo' and opponent is null and char_length(btrim(opponent_name)) between 1 and 32)
    or (status <> 'memo' and opponent is not null and opponent <> reporter))
);
create index if not exists battles_reporter_idx on public.battles(reporter, played_at desc);
create index if not exists battles_opponent_idx on public.battles(opponent, played_at desc);
alter table public.battles enable row level security;

drop policy if exists "battles_read" on public.battles;
create policy "battles_read" on public.battles for select to authenticated
  using (status = 'confirmed' or reporter = (select auth.uid()) or opponent = (select auth.uid()));
drop policy if exists "battles_read_anon" on public.battles;
create policy "battles_read_anon" on public.battles for select to anon using (status = 'confirmed');
-- 登録は承認待ちかメモとしてだけ（いきなり確定にはできない）
drop policy if exists "battles_insert_own" on public.battles;
create policy "battles_insert_own" on public.battles for insert to authenticated
  with check (reporter = (select auth.uid()) and status in ('pending','memo'));
-- 消せるのは、自分が登録した記録・自分あての承認待ち（＝「ちがう」）・管理者
drop policy if exists "battles_delete" on public.battles;
create policy "battles_delete" on public.battles for delete to authenticated
  using (reporter = (select auth.uid()) or (opponent = (select auth.uid()) and status = 'pending') or public.is_admin());
revoke update on public.battles from authenticated;
grant select on public.battles to anon;
grant select, insert, delete on public.battles to authenticated;

-- 相手がOKを押したときだけ確定にする
create or replace function public.confirm_battle(battle_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  update public.battles set status = 'confirmed'
   where id = battle_id and opponent = auth.uid() and status = 'pending';
  if not found then raise exception 'この対戦は承認できません'; end if;
end $$;
revoke all on function public.confirm_battle(uuid) from public, anon;
grant execute on function public.confirm_battle(uuid) to authenticated;

-- リアルタイム更新の対象に追加
do $$
declare t text;
begin
  foreach t in array array['areas','battles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
