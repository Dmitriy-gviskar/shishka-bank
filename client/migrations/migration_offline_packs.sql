create table if not exists offline_pack_claims (
  child_id   uuid not null references users(id) on delete cascade,
  nonce      text not null,
  created_at timestamptz not null default now(),
  primary key (child_id, nonce)
);
create index if not exists offline_pack_claims_day_idx
  on offline_pack_claims (child_id, created_at);
