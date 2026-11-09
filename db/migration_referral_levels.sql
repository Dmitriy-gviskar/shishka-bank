-- Многоуровневая рефералка: журнал выплат по уровням (1 = прямой друг, 2 = друг друга).
-- Потолка приглашений нет.

create table if not exists referral_rewards (
  id             uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references users(id) on delete cascade,
  source_user_id uuid not null references users(id) on delete cascade,
  level          int  not null check (level in (1, 2)),
  amount         int  not null check (amount > 0),
  created_at     timestamptz not null default now(),
  unique (beneficiary_id, source_user_id, level)
);

create index if not exists referral_rewards_beneficiary_idx on referral_rewards(beneficiary_id);

-- Перенести уже выплаченные прямые рефералы в журнал (идемпотентно)
insert into referral_rewards(beneficiary_id, source_user_id, level, amount, created_at)
select r.referrer_id, r.referred_id, 1, r.reward, coalesce(r.rewarded_at, r.created_at)
  from referrals r
 where r.rewarded_at is not null
on conflict (beneficiary_id, source_user_id, level) do nothing;
