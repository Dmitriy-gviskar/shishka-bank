-- Рефералка: код приглашения + журнал наград.
-- Код referral_code отделён от кода входа (child_logins) — его безопасно шарить.

alter table users add column if not exists referral_code text;
alter table users add column if not exists referred_by uuid references users(id) on delete set null;

do $$ begin
  alter table users add constraint users_referral_code_uniq unique (referral_code);
exception when duplicate_object then null; end $$;

create index if not exists users_referred_by_idx on users(referred_by);

create table if not exists referrals (
  id           uuid primary key default gen_random_uuid(),
  referrer_id  uuid not null references users(id) on delete cascade,
  referred_id  uuid not null unique references users(id) on delete cascade,
  reward       int  not null default 100 check (reward > 0),
  created_at   timestamptz not null default now(),
  rewarded_at  timestamptz
);

create index if not exists referrals_referrer_idx on referrals(referrer_id);
