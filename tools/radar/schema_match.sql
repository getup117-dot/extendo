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
