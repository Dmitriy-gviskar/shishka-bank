-- One database statement commits the charge, cards, rewards and durable receipt.
create table if not exists card_operation_receipts (
  child_id uuid not null references users(id) on delete cascade,
  nonce text not null,
  kind text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (child_id, nonce)
);

create or replace function apply_card_operation(
  p_child uuid, p_nonce text, p_kind text, p_payload jsonb default '{}'::jsonb,
  p_offline boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare receipt card_operation_receipts; output jsonb; rewards jsonb; bal int;
begin
  if p_nonce is null or p_nonce !~ '^[a-zA-Z0-9_-]{8,80}$' then
    raise exception using errcode='22023', message='invalid operation id';
  end if;
  if p_kind not in ('pack','merge') or p_kind is null then
    raise exception using errcode='22023', message='invalid operation kind';
  end if;
  -- Serializes retries and concurrent purchases, including distinct ids with one wallet.
  perform 1 from wallets where user_id=p_child for update;
  if not found then raise exception using errcode='22023', message='wallet not found'; end if;
  select * into receipt from card_operation_receipts where child_id=p_child and nonce=p_nonce;
  if found then
    if receipt.kind <> p_kind or receipt.payload <> p_payload then
      raise exception using errcode='P0409', message='operation id conflict';
    end if;
    return receipt.result;
  end if;
  if p_kind='pack' then
    -- Legacy receipts lack a saved result: never charge them again.
    if exists (select 1 from offline_pack_claims where child_id=p_child and nonce=p_nonce) then
      raise exception using errcode='P0409', message='legacy pack requires review';
    end if;
    if p_offline and (select count(*) from offline_pack_claims where child_id=p_child
       and (created_at at time zone 'Europe/Moscow')::date = (now() at time zone 'Europe/Moscow')::date) >= 5 then
      raise exception using errcode='P0429', message='offline daily limit';
    end if;
    output := jsonb_build_object('cards',open_pack(p_child));
    if p_offline then insert into offline_pack_claims(child_id,nonce) values(p_child,p_nonce); end if;
  else
    output := merge_cards(p_child,(p_payload->>'type')::uuid,(p_payload->>'grade')::int);
  end if;
  rewards := check_card_rewards(p_child);
  select balance into bal from wallets where user_id=p_child;
  output := output || jsonb_build_object('ok',true,'operation_id',p_nonce,'rewards',rewards,'balance',bal);
  insert into card_operation_receipts(child_id,nonce,kind,payload,result)
    values(p_child,p_nonce,p_kind,p_payload,output);
  return output;
end $$;
