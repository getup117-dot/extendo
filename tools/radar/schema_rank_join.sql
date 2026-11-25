-- Beybe Radar ランキングに参加（2026-11-25）
-- まだ対戦していなくても、参加ボタンで戦闘力1500のまま順位に載る
alter table public.power_stats add column if not exists joined boolean not null default false;

drop policy if exists "power_read" on public.power_stats;
create policy "power_read" on public.power_stats for select to anon, authenticated
  using (calibrated or joined or user_id = (select auth.uid()));

create or replace function public.join_ranking() returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  insert into public.power_stats(user_id, joined) values (auth.uid(), true)
  on conflict (user_id) do update set joined = true, updated_at = now();
end $$;
revoke all on function public.join_ranking() from public, anon;
grant execute on function public.join_ranking() to authenticated;
