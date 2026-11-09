-- Статус «в лесу»: время последней активности
alter table users add column if not exists last_seen timestamptz;
create index if not exists idx_users_last_seen on users(last_seen);
