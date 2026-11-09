-- Опекуны ребёнка (родители внутри лагерного круга).
-- Ребёнок остаётся в LESFRIEND; заказы из магазина впечатлений уходят и опекунам.
create table if not exists child_guardians (
  child_id    uuid not null references users(id) on delete cascade,
  guardian_id uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (child_id, guardian_id),
  check (child_id <> guardian_id)
);

create index if not exists child_guardians_guardian_idx on child_guardians (guardian_id);
create index if not exists child_guardians_child_idx on child_guardians (child_id);
