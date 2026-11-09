-- Old self-created links remain recorded but grant no rights until verified by the host.
alter table child_guardians add column if not exists verified_at timestamptz;
