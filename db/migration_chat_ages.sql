-- T22: родительский контроль — возраст ребёнка и коридор тех, с кем можно писать.
alter table users add column if not exists age int;
alter table users add column if not exists chat_age_min int;
alter table users add column if not exists chat_age_max int;

alter table users drop constraint if exists users_age_check;
alter table users add constraint users_age_check
  check (age is null or (age >= 4 and age <= 17));
alter table users drop constraint if exists users_chat_age_min_check;
alter table users add constraint users_chat_age_min_check
  check (chat_age_min is null or (chat_age_min >= 4 and chat_age_min <= 17));
alter table users drop constraint if exists users_chat_age_max_check;
alter table users add constraint users_chat_age_max_check
  check (chat_age_max is null or (chat_age_max >= 4 and chat_age_max <= 17));
alter table users drop constraint if exists users_chat_age_range_check;
alter table users add constraint users_chat_age_range_check
  check (chat_age_min is null or chat_age_max is null or chat_age_min <= chat_age_max);
