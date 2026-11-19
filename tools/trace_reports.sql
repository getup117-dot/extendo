-- BEY TRACE：利用者から届く「直した内容」の保存先（Beybe Radar と同じプロジェクト）
-- 誰でも送れる（書き込みだけ）。読む・消すのは管理者（profiles.is_admin）だけ。送った本人も読めない。
create table if not exists public.bey_trace_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  payload jsonb not null,
  constraint bey_trace_reports_size check (octet_length(payload::text) < 300000),
  constraint bey_trace_reports_shape check (jsonb_typeof(payload) = 'object' and jsonb_typeof(payload->'items') = 'array' and jsonb_array_length(payload->'items') between 1 and 300)
);
alter table public.bey_trace_reports enable row level security;
revoke all on public.bey_trace_reports from anon, authenticated;
grant insert (payload) on public.bey_trace_reports to anon, authenticated;
grant select, delete on public.bey_trace_reports to authenticated;
drop policy if exists "anyone can send" on public.bey_trace_reports;
create policy "anyone can send" on public.bey_trace_reports for insert to anon, authenticated with check (true);
drop policy if exists "admin reads" on public.bey_trace_reports;
create policy "admin reads" on public.bey_trace_reports for select to authenticated using (public.is_admin());
drop policy if exists "admin deletes" on public.bey_trace_reports;
create policy "admin deletes" on public.bey_trace_reports for delete to authenticated using (public.is_admin());
