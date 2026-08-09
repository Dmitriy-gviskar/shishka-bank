-- IP при посадке дерева: анти-дубль Telegram→Safari и восстановление по имени без кода.
alter table users add column if not exists signup_ip text;
create index if not exists users_signup_ip_created_idx on users (signup_ip, created_at desc);
