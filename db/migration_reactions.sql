-- Реакции на сообщения: ❤️🔥😂👍😢
create table if not exists message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists idx_msg_reactions on message_reactions(message_id);
