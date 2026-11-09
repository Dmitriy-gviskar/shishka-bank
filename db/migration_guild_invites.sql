create table if not exists guild_invites (
  guild_id   uuid not null references guilds(id) on delete cascade,
  child_id   uuid not null references users(id) on delete cascade,
  invited_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (guild_id, child_id)
);
create index if not exists guild_invites_child_idx on guild_invites(child_id);
