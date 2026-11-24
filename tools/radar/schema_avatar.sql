-- Beybe Radar プロフィール画像（2026-11-24）
-- 128×128 の小さな画像だけを保存する。1人1枚（avatars/<ユーザーID>.webp）
alter table public.profiles add column if not exists avatar_ver bigint;
grant update (avatar_ver) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 51200, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update set public = true, file_size_limit = 51200,
  allowed_mime_types = array['image/webp','image/jpeg','image/png'];

drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '.webp');
drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '.webp')
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '.webp');
drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (name = (select auth.uid())::text || '.webp' or public.is_admin()));
