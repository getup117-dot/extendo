-- Beybe Radar: ID（名前#番号）と合言葉での引き継ぎ
-- Supabase の SQL Editor で1回実行してください。
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

create or replace function public.find_recovery(p_name text, p_tag text)
returns table(user_id uuid, hint text, ready boolean)
language sql security definer set search_path = public as $$
  select p.id, coalesce(h.hint, ''), coalesce(u.email like '%@users.beybe-radar.app', false)
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.recovery_hints h on h.user_id = p.id
  where p.display_name = trim(p_name) and p.tag = trim(p_tag)
  limit 3;
$$;

revoke all on function public.set_recovery_hint(text) from public;
revoke all on function public.find_recovery(text, text) from public;
grant execute on function public.set_recovery_hint(text) to authenticated;
grant execute on function public.find_recovery(text, text) to anon, authenticated;
