-- Друзья: в круге — авто; между кругами — заявка по коду с поляны.
-- Переписка/подарки только с accepted.

create table if not exists friendships (
  user_id    uuid not null references users(id) on delete cascade,
  friend_id  uuid not null references users(id) on delete cascade,
  status     text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create index if not exists friendships_friend_status_idx
  on friendships(friend_id, status);

create index if not exists friendships_user_status_idx
  on friendships(user_id, status);

-- Текущие дети одного круга уже общаются — сохраняем доступ
insert into friendships(user_id, friend_id, status)
select a.id, b.id, 'accepted'
  from users a
  join users b on b.circle_id = a.circle_id
               and b.role = 'child'
               and b.id <> a.id
 where a.role = 'child'
on conflict do nothing;
