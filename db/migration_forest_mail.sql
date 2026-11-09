-- Письмо обитателю леса до дружбы: можно написать, заявка уходит сама.
-- Карты и шишки по-прежнему только после «Принять».

create or replace function send_message(p_from uuid, p_to uuid, p_type text, p_content text, p_reply_to uuid default null)
returns messages language plpgsql security definer set search_path = public as $$
declare m messages; c_id uuid;
begin
  if p_from = p_to then raise exception 'self message'; end if;
  if not exists (select 1 from users where id = p_to and role = 'child') then
    raise exception 'recipient is not in your circle';
  end if;
  select circle_id into c_id from users where id = p_from;
  if p_reply_to is not null then
    if not exists (
      select 1 from messages
       where id = p_reply_to
         and ((from_user = p_from and to_user = p_to) or (from_user = p_to and to_user = p_from))
    ) then
      raise exception 'replied message not found';
    end if;
  end if;
  insert into messages(circle_id, from_user, to_user, type, content, reply_to)
    values (c_id, p_from, p_to, p_type, p_content, p_reply_to) returning * into m;
  perform check_achievements(p_from);
  return m;
end $$;
