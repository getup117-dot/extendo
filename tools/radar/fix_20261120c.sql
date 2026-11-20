-- Beybe Radar 戦闘力：測定期間（5戦・3人）をなくし、1戦目から公開（2026-11-20）
-- Supabase の SQL Editor で1回実行（何度実行しても大丈夫）
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
    if not sw.calibrated and sw.games >= 1 then
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

-- 格上撃破：相手が初めての対戦でも、対戦前の値が自分より高ければ格上
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
          (bp.winner = auth.uid() and bp.l_before > bp.w_before),
          bp.confirmed_at
     from public.battle_power bp
    where auth.uid() in (bp.winner, bp.loser)
    order by bp.confirmed_at desc
    limit 500 $$;

-- これまでの対象試合を新しいルールで計算し直す
select public.power_recompute();
