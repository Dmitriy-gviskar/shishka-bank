-- Дружба и почта между кругами: заявка по коду с поляны (referral_code).
-- send_message больше не режет принятых друзей из другой семьи.

create or replace function send_message(p_from uuid, p_to uuid, p_type text, p_content text, p_reply_to uuid default null)
returns messages language plpgsql security definer set search_path = public as $$
declare m messages; c_id uuid; to_circle uuid;
begin
  select circle_id into c_id from users where id = p_from;
  select circle_id into to_circle from users where id = p_to;
  if c_id is distinct from to_circle then
    if not exists (
      select 1 from friendships
       where user_id = p_from and friend_id = p_to and status = 'accepted'
    ) then
      raise exception 'recipient is not in your circle';
    end if;
  end if;
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
