-- Гильдии v2 (аддитивно): чат готовыми фразами + выплата заказа БЕЗ закрытия гильдии.
-- Свободного текста в чате нет по этике: content всегда из белого списка (валидирует сервер).

create table if not exists guild_messages (
  id         uuid primary key default gen_random_uuid(),
  guild_id   uuid not null references guilds(id) on delete cascade,
  from_user  uuid references users(id) on delete set null,
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists guild_messages_guild_idx on guild_messages(guild_id, created_at desc);

-- Выплата за заказ гильдии: делит p_amount по долям (последнему — остаток),
-- эмиссия от Банка (from_user null), гильдия ОСТАЁТСЯ open — живёт дальше.
create or replace function guild_payout(p_guild uuid, p_amount int, p_title text default 'Заказ гильдии')
returns int language plpgsql security definer set search_path = public as $$
declare g guilds; total int; paid int := 0; n int; i int := 0; cut int; m record;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into g from guilds where id = p_guild for update;
  if not found then raise exception 'guild not found'; end if;
  if g.status <> 'open' then raise exception 'guild is not open'; end if;

  select coalesce(sum(share),0), count(*) into total, n from guild_members where guild_id = p_guild;
  if total = 0 then raise exception 'guild has no members'; end if;

  for m in select * from guild_members where guild_id = p_guild order by child_id loop
    i := i + 1;
    if i = n then cut := p_amount - paid;
    else cut := (p_amount * m.share) / total; end if;
    paid := paid + cut;
    if cut > 0 then
      update wallets set balance = balance + cut, total_earned = total_earned + cut
        where user_id = m.child_id;
      insert into transactions(circle_id, from_user, to_user, amount, type, message)
        values (g.circle_id, null, m.child_id, cut, 'reward', p_title);
    end if;
  end loop;
  return paid;
end $$;

-- Котлы v2: котёл может принадлежать гильдии (доп. колонка, аддитивно).
alter table pots add column if not exists guild_id uuid references guilds(id) on delete set null;
