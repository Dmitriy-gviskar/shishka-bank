-- Третий уровень рефералки: +25 шишек.

alter table referral_rewards drop constraint if exists referral_rewards_level_check;
alter table referral_rewards add constraint referral_rewards_level_check check (level in (1, 2, 3));
