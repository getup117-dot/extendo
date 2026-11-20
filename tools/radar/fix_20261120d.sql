-- Beybe Radar 戦闘力：同じ相手との「1日1戦」制限をなくす（2026-11-20）
-- 相手と勝敗がある申請は、すべて戦闘力の対象にする
create or replace function public.battles_power_slot() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  new.rated := false; new.confirmed_at := null;
  new.rate_slot := (new.status = 'pending' and new.opponent is not null and new.result in ('win','lose'));
  return new;
end $$;
-- 承認待ちのまま残っている申請も対象にする
update public.battles set rate_slot = true
 where status = 'pending' and opponent is not null and result in ('win','lose') and not rate_slot;
