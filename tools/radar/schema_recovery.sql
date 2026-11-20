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
