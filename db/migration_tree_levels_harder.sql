-- Более длинные серии до уровней дерева.
-- Пороги: 7 → 21 → 45 → 90 дней (раньше 3 → 7 → 14 → 30).
-- Уровень только растёт (greatest), уже достигнутый не откатываем.
create or replace function daily_visit(p_child uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u users; d date := (now() at time zone 'Europe/Moscow')::date;
        new_streak int; ls int; rain int := 0; lvl int; c_id uuid;
        used_freeze boolean := false; freeze_granted boolean := false;
        bonus int; milestone int := 0; total int;
begin
  select * into u from users where id = p_child for update;
  if not found then raise exception 'user not found'; end if;
  select circle_id into c_id from users where id = p_child;

  if u.last_visit = d then
    return jsonb_build_object('streak', u.current_streak, 'best', u.longest_streak,
      'tree_level', u.tree_level, 'bonus', 0, 'milestone', 0, 'rain', 0,
      'first_today', false, 'freeze_used', false, 'freeze_granted', false);
  end if;

  if u.last_visit = d - 1 then
    new_streak := u.current_streak + 1;
  elsif u.last_visit = d - 2 and u.streak_freezes > 0 then
    new_streak := u.current_streak + 1;
    update users set streak_freezes = streak_freezes - 1 where id = p_child;
    used_freeze := true;
  else
    new_streak := 1;
  end if;
  ls := greatest(u.longest_streak, new_streak);
  lvl := case when ls >= 90 then 5 when ls >= 45 then 4
              when ls >= 21 then 3 when ls >= 7 then 2 else 1 end;
  lvl := greatest(coalesce(u.tree_level, 1), lvl);

  bonus := least(new_streak + 1, 10);
  if    new_streak = 7  then milestone := 25;
  elsif new_streak = 14 then milestone := 50;
  elsif new_streak = 30 then milestone := 100;
  end if;

  if (u.last_freeze_grant is null or d - u.last_freeze_grant >= 7) and u.streak_freezes < 2 then
    update users set streak_freezes = streak_freezes + 1, last_freeze_grant = d where id = p_child;
    freeze_granted := true;
  elsif u.last_freeze_grant is null or d - u.last_freeze_grant >= 7 then
    update users set last_freeze_grant = d where id = p_child;
  end if;

  if random() < 0.30 then rain := 1 + floor(random() * 3)::int; end if;

  update users set last_visit = d, current_streak = new_streak,
                   longest_streak = ls, tree_level = lvl
    where id = p_child;

  total := bonus + milestone + rain;
  update wallets set balance = balance + total, total_earned = total_earned + total
    where user_id = p_child;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, null, p_child, bonus, 'reward', 'Ежедневный подарок · серия ' || new_streak);
  if milestone > 0 then
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (c_id, null, p_child, milestone, 'reward', 'Серия ' || new_streak || ' дней! 🔥');
  end if;
  if rain > 0 then
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (c_id, null, p_child, rain, 'reward', 'Шишечный дождь');
  end if;

  perform check_achievements(p_child);
  return jsonb_build_object('streak', new_streak, 'best', ls, 'tree_level', lvl,
    'bonus', bonus, 'milestone', milestone, 'rain', rain,
    'first_today', true, 'freeze_used', used_freeze, 'freeze_granted', freeze_granted);
end $$;
