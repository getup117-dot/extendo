-- Beybe Radar：気配（過去7日間に「いた」場所の記録）
-- 位置共有・ここにいる が保存されるたびに、約500m単位に丸めた場所を自動で記録します（同じ人は30分に1回まで）。
create table if not exists public.traces (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  seen_at timestamptz not null default now()
);
create index if not exists traces_seen_idx on public.traces(seen_at);
alter table public.traces enable row level security;
drop policy if exists "traces_read_recent" on public.traces;
grant execute on function public.is_hidden(text, text) to anon;
create policy "traces_read_recent" on public.traces for select to anon, authenticated
  using (seen_at > now() - interval '7 days' and not public.is_hidden('user', user_id::text));
drop policy if exists "traces_delete_admin" on public.traces;
create policy "traces_delete_admin" on public.traces for delete to authenticated using (public.is_admin());
grant select on public.traces to anon, authenticated;
grant delete on public.traces to authenticated;

create or replace function public.log_trace() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.traces t where t.user_id = new.user_id and t.seen_at > now() - interval '30 minutes') then
    insert into public.traces(user_id, lat, lng)
    values (new.user_id, round(new.lat * 200) / 200.0, round(new.lng * 200) / 200.0);
  end if;
  delete from public.traces where seen_at < now() - interval '8 days';
  return new;
end $$;
drop trigger if exists positions_log_trace on public.positions;
create trigger positions_log_trace after insert or update on public.positions
  for each row execute function public.log_trace();
