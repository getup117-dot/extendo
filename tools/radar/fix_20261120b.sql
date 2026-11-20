-- Beybe Radar バグ修正（2026-11-20 GPTチェック分）
-- Supabase の SQL Editor で1回実行（何度実行しても大丈夫）

-- 通報で非表示になった人は「気配」にも出さない
grant execute on function public.is_hidden(text, text) to anon;
drop policy if exists "traces_read_recent" on public.traces;
create policy "traces_read_recent" on public.traces for select to anon, authenticated
  using (seen_at > now() - interval '7 days' and not public.is_hidden('user', user_id::text));

-- 戦闘力：初回の同時承認で行き詰まらないよう、いつも同じ順番で行を作る
create or replace function public.power_apply(bid uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare
  bt public.battles%rowtype; w uuid; l uuid;
  sw public.power_stats%rowtype; sl public.power_stats%rowtype;
  ew double precision; mv integer; x uuid;
begin
  select * into bt from public.battles where id = bid;
  if bt.result = 'win' then w := bt.reporter; l := bt.opponent; else w := bt.opponent; l := bt.reporter; end if;
  insert into public.power_stats(user_id) values (least(w, l)) on conflict do nothing;
  insert into public.power_stats(user_id) values (greatest(w, l)) on conflict do nothing;
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

-- 募集：非表示の募集には参加できない
create or replace function public.join_match(event_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare e public.events%rowtype;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  perform set_config('beyradar.match', 'on', true);
  update public.events ev set partner = auth.uid(), matched_at = now(),
         dropped_partner = case when ev.dropped_partner = auth.uid() then null else ev.dropped_partner end
   where ev.id = event_id and ev.mode = 'match' and ev.partner is null and ev.cancelled_at is null
     and ev.user_id <> auth.uid() and ev.starts_at > now()
     and not public.is_hidden('event', ev.id::text) and not public.is_hidden('user', ev.user_id::text);
  if not found then
    select * into e from public.events where id = event_id;
    if not found then raise exception 'この募集は見つかりません'; end if;
    if e.user_id = auth.uid() then raise exception '自分の募集には参加できません'; end if;
    if e.partner is not null then raise exception 'この募集は成立しました'; end if;
    raise exception 'この募集は締め切られました';
  end if;
end $$;

-- 中止になった約束は辞退できない（中止の表示が相手から消えないように）
create or replace function public.leave_match(event_id uuid) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  perform set_config('beyradar.match', 'on', true);
  update public.events set partner = null, matched_at = null
   where id = event_id and partner = auth.uid() and cancelled_at is null and starts_at > now();
  if not found then raise exception '辞退できませんでした'; end if;
end $$;

-- 成立中の約束は、投稿者が直接削除できない（取り消しは「中止」として残す）
create or replace function public.events_match_delete_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if coalesce(current_setting('beyradar.match', true), '') <> 'on' and not public.is_admin()
     and old.mode = 'match' and old.partner is not null and old.cancelled_at is null and old.ends_at > now() then
    raise exception '成立中の約束は「募集を取り消す」から中止してください';
  end if;
  return old;
end $$;
drop trigger if exists events_match_delete_guard on public.events;
create trigger events_match_delete_guard before delete on public.events
  for each row execute function public.events_match_delete_guard();

revoke all on function public.join_match(uuid) from public, anon;
revoke all on function public.leave_match(uuid) from public, anon;
grant execute on function public.join_match(uuid) to authenticated;
grant execute on function public.leave_match(uuid) to authenticated;
