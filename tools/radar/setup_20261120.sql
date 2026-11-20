-- Beybe Radar 2026-11-20 追加分まとめ（引き継ぎ・戦闘力・あと1人で開催）
-- Supabase の SQL Editor に全部貼り付けて1回実行（何度実行しても大丈夫）

-- ===== schema_recovery.sql =====
-- Beybe Radar: ID（#番号）と合言葉での引き継ぎ
-- Supabase の SQL Editor で1回実行してください（何度実行しても大丈夫）。

-- 0) 番号をIDにするため、全員ちがう番号にする
create or replace function public.next_tag()
returns text language plpgsql volatile set search_path = public as $$
declare t text;
begin
  loop
    t := lpad((floor(random()*9000)+1000)::int::text, 4, '0');
    exit when not exists (select 1 from public.profiles where tag = t);
  end loop;
  return t;
end $$;

-- 重なっている番号は、あとから登録した人だけ新しい番号に変える
do $$
declare r record;
begin
  for r in select id from (
    select id, row_number() over (partition by tag order by created_at) rn from public.profiles
  ) x where rn > 1 loop
    update public.profiles set tag = public.next_tag() where id = r.id;
  end loop;
end $$;

create unique index if not exists profiles_tag_unique on public.profiles(tag);
alter table public.profiles alter column tag set default public.next_tag();
create table if not exists public.recovery_hints (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hint text not null default '' check (char_length(hint) <= 30),
  updated_at timestamptz not null default now()
);
alter table public.recovery_hints enable row level security;
-- 直接の読み書きは許可しない（下の関数経由のみ）

create or replace function public.set_recovery_hint(p_hint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.recovery_hints(user_id, hint)
  values (auth.uid(), left(coalesce(trim(p_hint), ''), 30))
  on conflict (user_id) do update set hint = excluded.hint, updated_at = now();
end $$;

drop function if exists public.find_recovery(text, text);
create or replace function public.find_recovery(p_tag text)
returns table(user_id uuid, hint text, ready boolean)
language sql security definer set search_path = public as $$
  select p.id, coalesce(h.hint, ''), coalesce(u.email like '%@users.beybe-radar.app', false)
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.recovery_hints h on h.user_id = p.id
  where p.tag = trim(p_tag)
  limit 1;
$$;

revoke all on function public.set_recovery_hint(text) from public;
revoke all on function public.find_recovery(text) from public;
grant execute on function public.set_recovery_hint(text) to authenticated;
grant execute on function public.find_recovery(text) to anon, authenticated;

-- ===== schema_power.sql =====
-- ============================================================
-- 戦闘力（2026-11-20 追加）
-- Supabase の SQL Editor でこのファイルを丸ごと1回実行する（何度実行しても大丈夫）
-- 先に schema_areas_battles.sql が実行済みであること
-- ============================================================

-- 1) 対戦記録に「戦闘力の対象か」を足す
alter table public.battles
  add column if not exists rate_slot boolean not null default false,   -- その日その2人の最初の申請（対象候補）
  add column if not exists rated boolean not null default false,       -- 承認されて戦闘力に反映済み
  add column if not exists confirmed_at timestamptz;

-- 2) 戦闘力（本人は自分の行、ほかの人は測定完了した人の行だけ見える）
create table if not exists public.power_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rating integer not null default 1500 check (rating >= 0),
  best integer,
  games integer not null default 0,
  opponents integer not null default 0,
  calibrated boolean not null default false,
  last_rated_at timestamptz,
  reveal_seen boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.power_stats enable row level security;
drop policy if exists "power_read" on public.power_stats;
create policy "power_read" on public.power_stats for select to anon, authenticated
  using (calibrated or user_id = (select auth.uid()));
revoke insert, update, delete on public.power_stats from anon, authenticated;
grant select on public.power_stats to anon, authenticated;

-- 3) 同じ2人・日本時間の1日に1枠（却下されても枠は戻らない）
create table if not exists public.power_slots (
  a uuid not null references auth.users(id) on delete cascade,
  b uuid not null references auth.users(id) on delete cascade,
  day date not null,
  battle_id uuid not null,
  primary key (a, b, day)
);
alter table public.power_slots enable row level security;
drop policy if exists "slots_read_own" on public.power_slots;
create policy "slots_read_own" on public.power_slots for select to authenticated
  using ((select auth.uid()) in (a, b));
revoke insert, update, delete on public.power_slots from anon, authenticated;
grant select on public.power_slots to authenticated;

-- 4) 各対象試合の前後の値（直接は読めない。本人の分だけ関数で返す）
create table if not exists public.battle_power (
  battle_id uuid primary key references public.battles(id) on delete cascade,
  winner uuid not null, loser uuid not null,
  w_before integer not null, w_after integer not null,
  l_before integer not null, l_after integer not null,
  w_public_before boolean not null, l_public_before boolean not null,
  w_public_after boolean not null default false, l_public_after boolean not null default false,
  w_cal_now boolean not null default false, l_cal_now boolean not null default false,
  w_new_best boolean not null default false, l_new_best boolean not null default false,
  confirmed_at timestamptz not null
);
alter table public.battle_power enable row level security;
revoke all on public.battle_power from anon, authenticated;

-- 5) 申請時：その日の最初の申請だけ対象候補にする（本人は値を決められない）
create or replace function public.battles_power_slot() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  new.rated := false; new.confirmed_at := null; new.rate_slot := false;
  if new.status = 'pending' and new.opponent is not null and new.result in ('win','lose') then
    insert into public.power_slots(a, b, day, battle_id)
    values (least(new.reporter, new.opponent), greatest(new.reporter, new.opponent),
            (now() at time zone 'Asia/Tokyo')::date, new.id)
    on conflict do nothing;
    new.rate_slot := found;
  end if;
  return new;
end $$;
drop trigger if exists battles_power_slot on public.battles;
create trigger battles_power_slot before insert on public.battles
  for each row execute function public.battles_power_slot();

-- 6) 1試合ぶんを反映する（内部用）
create or replace function public.power_apply(bid uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare
  bt public.battles%rowtype; w uuid; l uuid;
  sw public.power_stats%rowtype; sl public.power_stats%rowtype;
  ew double precision; mv integer; x uuid;
begin
  select * into bt from public.battles where id = bid;
  if bt.result = 'win' then w := bt.reporter; l := bt.opponent; else w := bt.opponent; l := bt.reporter; end if;
  insert into public.power_stats(user_id) values (w), (l) on conflict do nothing;
  perform 1 from public.power_stats where user_id in (w, l) order by user_id for update;
  select * into sw from public.power_stats where user_id = w;
  select * into sl from public.power_stats where user_id = l;
  ew := 1.0 / (1.0 + power(10.0, (sl.rating - sw.rating) / 400.0));
  mv := least(sl.rating, round((24 * (1 - ew))::numeric)::integer);
  insert into public.battle_power(battle_id, winner, loser, w_before, w_after, l_before, l_after,
    w_public_before, l_public_before, confirmed_at)
  values (bid, w, l, sw.rating, sw.rating + mv, sl.rating, sl.rating - mv, sw.calibrated, sl.calibrated, bt.confirmed_at)
  on conflict (battle_id) do update set winner = excluded.winner, loser = excluded.loser,
    w_before = excluded.w_before, w_after = excluded.w_after, l_before = excluded.l_before, l_after = excluded.l_after,
    w_public_before = excluded.w_public_before, l_public_before = excluded.l_public_before,
    w_public_after = false, l_public_after = false, w_cal_now = false, l_cal_now = false,
    w_new_best = false, l_new_best = false, confirmed_at = excluded.confirmed_at;
  update public.power_stats set rating = rating + mv, games = games + 1, last_rated_at = bt.confirmed_at, updated_at = now() where user_id = w;
  update public.power_stats set rating = rating - mv, games = games + 1, last_rated_at = bt.confirmed_at, updated_at = now() where user_id = l;
  foreach x in array array[w, l] loop
    update public.power_stats s set opponents = (
      select count(distinct case when bp.winner = x then bp.loser else bp.winner end)
        from public.battle_power bp where x in (bp.winner, bp.loser))
     where s.user_id = x;
  end loop;
  -- 測定完了と自己最高
  foreach x in array array[w, l] loop
    select * into sw from public.power_stats where user_id = x;
    if not sw.calibrated and sw.games >= 5 and sw.opponents >= 3 then
      update public.power_stats set calibrated = true, best = rating where user_id = x;
      if x = w then update public.battle_power set w_cal_now = true where battle_id = bid;
      else update public.battle_power set l_cal_now = true where battle_id = bid; end if;
    elsif sw.calibrated and sw.rating > coalesce(sw.best, 0) then
      update public.power_stats set best = rating where user_id = x;
      if x = w then update public.battle_power set w_new_best = true where battle_id = bid;
      else update public.battle_power set l_new_best = true where battle_id = bid; end if;
    end if;
  end loop;
  update public.battle_power bp set
    w_public_after = (select calibrated from public.power_stats where user_id = w),
    l_public_after = (select calibrated from public.power_stats where user_id = l)
   where bp.battle_id = bid;
end $$;
revoke all on function public.power_apply(uuid) from public, anon, authenticated;

-- 7) 全部を最初から計算し直す（確定済みの対象試合が消されたとき用）
create or replace function public.power_recompute() returns void
  language plpgsql security definer set search_path = public as
$$ declare r record;
begin
  lock table public.power_stats in exclusive mode;
  delete from public.battle_power;
  update public.power_stats set rating = 1500, best = null, games = 0, opponents = 0,
    calibrated = false, last_rated_at = null, updated_at = now();
  for r in select id from public.battles where rated and status = 'confirmed' order by confirmed_at, id loop
    perform public.power_apply(r.id);
  end loop;
end $$;
revoke all on function public.power_recompute() from public, anon, authenticated;

create or replace function public.battles_power_after_delete() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if exists (select 1 from old_rows where rated) then perform public.power_recompute(); end if;
  return null;
end $$;
drop trigger if exists battles_power_after_delete on public.battles;
create trigger battles_power_after_delete after delete on public.battles
  referencing old table as old_rows for each statement execute function public.battles_power_after_delete();

-- 8) 承認：確定と戦闘力の更新を1回の処理でまとめて行う（連打・同時承認でも1回だけ）
create or replace function public.confirm_battle(battle_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare bt public.battles%rowtype;
begin
  update public.battles set status = 'confirmed', confirmed_at = now()
   where id = battle_id and opponent = auth.uid() and status = 'pending'
   returning * into bt;
  if not found then raise exception 'この対戦は承認できません'; end if;
  if bt.rate_slot and bt.result in ('win','lose') then
    update public.battles set rated = true where id = bt.id;
    perform public.power_apply(bt.id);
  end if;
end $$;
revoke all on function public.confirm_battle(uuid) from public, anon;
grant execute on function public.confirm_battle(uuid) to authenticated;

-- 9) 確定して戦闘力に反映した試合は、本人には消せない（管理者は消せる。消すと計算し直す）
drop policy if exists "battles_delete" on public.battles;
create policy "battles_delete" on public.battles for delete to authenticated
  using ((reporter = (select auth.uid()) and not (status = 'confirmed' and rated))
         or (opponent = (select auth.uid()) and status = 'pending')
         or public.is_admin());

-- 10) 本人の結果だけを返す
create or replace function public.my_power_results()
returns table(battle_id uuid, won boolean, opponent uuid, before integer, after integer,
  public_before boolean, public_after boolean, cal_now boolean, new_best boolean, upset boolean, confirmed_at timestamptz)
  language sql stable security definer set search_path = public as
$$ select bp.battle_id, bp.winner = auth.uid(),
          case when bp.winner = auth.uid() then bp.loser else bp.winner end,
          case when bp.winner = auth.uid() then bp.w_before else bp.l_before end,
          case when bp.winner = auth.uid() then bp.w_after else bp.l_after end,
          case when bp.winner = auth.uid() then bp.w_public_before else bp.l_public_before end,
          case when bp.winner = auth.uid() then bp.w_public_after else bp.l_public_after end,
          case when bp.winner = auth.uid() then bp.w_cal_now else bp.l_cal_now end,
          case when bp.winner = auth.uid() then bp.w_new_best else bp.l_new_best end,
          (bp.winner = auth.uid() and bp.l_public_before and bp.l_before > bp.w_before),
          bp.confirmed_at
     from public.battle_power bp
    where auth.uid() in (bp.winner, bp.loser)
    order by bp.confirmed_at desc
    limit 500 $$;
revoke all on function public.my_power_results() from public, anon;
grant execute on function public.my_power_results() to authenticated;

create or replace function public.mark_power_reveal() returns void
  language sql security definer set search_path = public as
$$ update public.power_stats set reveal_seen = true where user_id = auth.uid() $$;
revoke all on function public.mark_power_reveal() from public, anon;
grant execute on function public.mark_power_reveal() to authenticated;

-- 11) リアルタイム更新の対象に追加
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'power_stats') then
    alter publication supabase_realtime add table public.power_stats;
  end if;
exception when undefined_object then null;
end $$;

-- ===== schema_match.sql =====
-- ============================================================
-- 出没予定「相手がいれば行く」（あと1人で開催）2026-11-20 追加
-- Supabase の SQL Editor でこのファイルを丸ごと1回実行する（何度実行しても大丈夫）
-- ============================================================
alter table public.events
  add column if not exists mode text not null default 'go' check (mode in ('go','match')),
  add column if not exists partner uuid references auth.users(id) on delete set null,
  add column if not exists matched_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists dropped_partner uuid references auth.users(id) on delete set null;

-- 成立相手などは本人の編集では変えられない。成立後に日時・場所を変えたら約束を取り消して再募集
create or replace function public.events_match_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if coalesce(current_setting('beyradar.match', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.partner := null; new.matched_at := null; new.cancelled_at := null; new.dropped_partner := null;
    return new;
  end if;
  new.partner := old.partner; new.matched_at := old.matched_at;
  new.cancelled_at := old.cancelled_at; new.dropped_partner := old.dropped_partner;
  if old.partner is not null and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
      or new.lat is distinct from old.lat or new.lng is distinct from old.lng
      or new.place_name is distinct from old.place_name or new.mode is distinct from old.mode) then
    new.dropped_partner := old.partner; new.partner := null; new.matched_at := null;
  end if;
  return new;
end $$;
drop trigger if exists events_match_guard on public.events;
create trigger events_match_guard before insert or update on public.events
  for each row execute function public.events_match_guard();

-- 自分も行ける（最初の1人だけ成立）
create or replace function public.join_match(event_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare e public.events%rowtype;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  perform set_config('beyradar.match', 'on', true);
  update public.events set partner = auth.uid(), matched_at = now(),
         dropped_partner = case when dropped_partner = auth.uid() then null else dropped_partner end
   where id = event_id and mode = 'match' and partner is null and cancelled_at is null
     and user_id <> auth.uid() and starts_at > now();
  if not found then
    select * into e from public.events where id = event_id;
    if not found then raise exception 'この募集は見つかりません'; end if;
    if e.user_id = auth.uid() then raise exception '自分の募集には参加できません'; end if;
    if e.partner is not null then raise exception 'この募集は成立しました'; end if;
    raise exception 'この募集は締め切られました';
  end if;
end $$;

-- 辞退（開始前なら募集を再開）
create or replace function public.leave_match(event_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  perform set_config('beyradar.match', 'on', true);
  update public.events set partner = null, matched_at = null
   where id = event_id and partner = auth.uid() and starts_at > now();
  if not found then raise exception '辞退できませんでした'; end if;
end $$;

-- 投稿者が取り消す（相手がいなければ削除、成立済みなら「中止」として残す）
create or replace function public.cancel_match(event_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  perform set_config('beyradar.match', 'on', true);
  delete from public.events where id = event_id and user_id = auth.uid() and partner is null;
  if found then return; end if;
  update public.events set cancelled_at = now() where id = event_id and user_id = auth.uid() and cancelled_at is null;
  if not found then raise exception '取り消せませんでした'; end if;
end $$;

revoke all on function public.join_match(uuid) from public, anon;
revoke all on function public.leave_match(uuid) from public, anon;
revoke all on function public.cancel_match(uuid) from public, anon;
grant execute on function public.join_match(uuid) to authenticated;
grant execute on function public.leave_match(uuid) to authenticated;
grant execute on function public.cancel_match(uuid) to authenticated;
