-- Шишка Банк — атомарные операции (PostgreSQL / Supabase RPC).
-- Все переводы шишек идут ТОЛЬКО через эти функции: они блокируют кошелёк
-- (select ... for update), меняют баланс и пишут transaction в одной транзакции.
-- Прямой UPDATE wallets в обход этих функций запрещён политиками RLS.

-- Ребёнок отправляет задание на проверку (с фото, если нужно)
create or replace function submit_task(p_task uuid, p_proof text default null)
returns tasks language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'task not found'; end if;
  if t.status not in ('open','rejected') then
    raise exception 'task % is not submittable (status=%)', p_task, t.status;
  end if;
  if t.needs_photo and p_proof is null then
    raise exception 'task requires a photo proof';
  end if;
  update tasks set status = 'pending_review', proof_url = p_proof
    where id = p_task returning * into t;
  return t;
end $$;

-- Родитель подтверждает задание -> начисление награды (эмиссия шишек ребёнку)
create or replace function approve_task(p_task uuid)
returns wallets language plpgsql security definer set search_path = public as $$
declare t tasks; w wallets; rew int;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'task not found'; end if;
  if t.status <> 'pending_review' then
    raise exception 'task % not awaiting review (status=%)', p_task, t.status;
  end if;

  rew := round(t.reward * event_multiplier(t.circle_id, 'task_reward'));  -- Ярмарка/сезон
  update wallets set balance = balance + rew,
                     total_earned = total_earned + rew
    where user_id = t.child_id returning * into w;

  update tasks set status = 'done', completed_at = now() where id = p_task;

  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    values (t.circle_id, null, t.child_id, rew, 'reward', t.id, t.title);

  perform bump_reputation(t.child_id, 'honesty', 1);   -- честно выполненное задание
  perform check_achievements(t.child_id);                -- «Работяга»/«Запасливый» по счётчикам
  return w;
end $$;

create or replace function reject_task(p_task uuid)
returns tasks language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  update tasks set status = 'rejected'
    where id = p_task and status = 'pending_review' returning * into t;
  if not found then raise exception 'task % not awaiting review', p_task; end if;
  return t;
end $$;

-- Ребёнок покупает приз: резерв шишек (списание), создание обещания родителю
create or replace function purchase_item(p_child uuid, p_item uuid)
returns purchases language plpgsql security definer set search_path = public as $$
declare it shop_items; w wallets; pu purchases;
begin
  select * into it from shop_items where id = p_item;
  if not found or not it.is_active then raise exception 'item unavailable'; end if;

  select * into w from wallets where user_id = p_child for update;
  if not found then raise exception 'wallet not found'; end if;
  if w.balance < it.price then
    raise exception 'not enough cones: have %, need %', w.balance, it.price;
  end if;

  update wallets set balance = balance - it.price,
                     total_spent = total_spent + it.price
    where user_id = p_child;

  insert into purchases(circle_id, child_id, item_id, price)
    values (it.circle_id, p_child, it.id, it.price) returning * into pu;

  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    values (it.circle_id, p_child, null, it.price, 'purchase', pu.id, it.title);
  return pu;
end $$;

-- Перевод шишек между детьми (подарок). Атомарно: списание у одного, зачисление другому.
create or replace function transfer_cones(p_from uuid, p_to uuid, p_amount int, p_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w_from wallets; c_id uuid;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_from = p_to then raise exception 'cannot transfer to self'; end if;

  -- блокируем оба кошелька в детерминированном порядке (по user_id) — против дедлоков
  perform 1 from wallets where user_id in (p_from, p_to)
    order by user_id for update;

  select * into w_from from wallets where user_id = p_from;
  if not found then raise exception 'sender wallet not found'; end if;
  if w_from.balance < p_amount then
    raise exception 'not enough cones: have %, need %', w_from.balance, p_amount;
  end if;

  update wallets set balance = balance - p_amount, total_spent = total_spent + p_amount
    where user_id = p_from;
  update wallets set balance = balance + p_amount, total_earned = total_earned + p_amount
    where user_id = p_to;

  select circle_id into c_id from users where id = p_from;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, p_from, p_to, p_amount, 'transfer', p_message);

  perform bump_reputation(p_from, 'generosity', 1);       -- подарок = щедрость
  perform check_achievements(p_from);                     -- Даритель/Меценат/Великий Меценат
end $$;

-- ─────────────────────────── Онбординг ───────────────────────────

-- Родитель создаёт семейный круг (при регистрации). Возвращает круг с кодом-приглашением.
create or replace function create_circle(p_name text, p_parent_name text)
returns circles language plpgsql security definer set search_path = public as $$
declare c circles; code text;
begin
  code := upper(substr(md5(random()::text), 1, 6));   -- код-приглашение ребёнку
  insert into circles(name, invite_code) values (p_name, code) returning * into c;
  insert into users(circle_id, role, name, auth_id)
    values (c.id, 'parent', p_parent_name, auth.uid());
  return c;
end $$;

-- Родитель добавляет ребёнка в свой круг (создаёт профиль + кошелёк).
create or replace function add_child(p_circle uuid, p_name text, p_tree_type text default 'pine')
returns users language plpgsql security definer set search_path = public as $$
declare u users;
begin
  insert into users(circle_id, role, name, tree_type)
    values (p_circle, 'child', p_name, p_tree_type) returning * into u;
  insert into wallets(user_id) values (u.id);
  -- весь каталог заданий новому ребёнку (как в сиде gen_seed/seed.sql)
  insert into tasks(circle_id, child_id, title, reward, category, needs_photo)
    select p_circle, u.id, t.title, t.reward, coalesce(t.category,'home'), t.needs_photo
    from task_templates t;
  return u;
end $$;

-- Родитель создаёт задание ребёнку из шаблона справочника (в 1 тап).
create or replace function create_task_from_template(p_circle uuid, p_child uuid, p_template uuid)
returns tasks language plpgsql security definer set search_path = public as $$
declare tmpl task_templates; t tasks;
begin
  select * into tmpl from task_templates where id = p_template;
  if not found then raise exception 'template not found'; end if;
  insert into tasks(circle_id, child_id, created_by, title, reward, category, needs_photo)
    values (p_circle, p_child, auth.uid(), tmpl.title, tmpl.reward, tmpl.category, tmpl.needs_photo)
    returning * into t;
  return t;
end $$;

-- ═══════════════════════ Фаза 2: Дупло-сейф + репутация/бейджи ═══════════════════════

-- Прибавить очко черте «Лесного паспорта» (honesty/generosity/reliability/wisdom)
create or replace function bump_reputation(p_user uuid, p_trait text, p_delta int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_trait not in ('honesty','generosity','reliability','wisdom') then
    raise exception 'unknown reputation trait: %', p_trait;
  end if;
  update users
    set reputation = jsonb_set(reputation, array[p_trait],
        to_jsonb(coalesce((reputation->>p_trait)::int, 0) + p_delta))
    where id = p_user;
end $$;

-- Выдать бейдж (идемпотентно: повторная выдача игнорируется благодаря unique)
create or replace function award_badge(p_user uuid, p_type text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into badges(user_id, badge_type) values (p_user, p_type)
    on conflict (user_id, badge_type) do nothing;
end $$;

-- Открыть Дупло-сейф: заморозить шишки на срок под процент. Досрочно снять нельзя.
-- Разрешённые сроки: 3д→5%, 7д→10%, 30д→20%.
create or replace function open_safe(p_child uuid, p_amount int, p_days int)
returns safes language plpgsql security definer set search_path = public as $$
declare w wallets; s safes; rate int;
begin
  rate := case p_days when 3 then 5 when 7 then 10 when 30 then 20
                      else null end;
  if rate is null then raise exception 'invalid term: % days (allowed 3/7/30)', p_days; end if;
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;

  select * into w from wallets where user_id = p_child for update;
  if not found then raise exception 'wallet not found'; end if;
  if w.balance < p_amount then
    raise exception 'not enough cones: have %, need %', w.balance, p_amount;
  end if;

  update wallets set balance = balance - p_amount where user_id = p_child;

  insert into safes(user_id, amount, interest_rate, unlock_date)
    values (p_child, p_amount, rate, now() + make_interval(days => p_days))
    returning * into s;

  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    select circle_id, p_child, null, p_amount, 'deposit', s.id, 'Дупло на '||p_days||' дн.'
      from users where id = p_child;

  perform bump_reputation(p_child, 'wisdom', 1);   -- отложенное вознаграждение = мудрость
  perform check_achievements(p_child);             -- Осторожный (первое Дупло)
  return s;
end $$;

-- Забрать из Дупло по истечении срока: тело + процент. Досрочно — ошибка.
create or replace function redeem_safe(p_safe uuid)
returns wallets language plpgsql security definer set search_path = public as $$
declare s safes; w wallets; interest int; done int;
begin
  select * into s from safes where id = p_safe for update;
  if not found then raise exception 'safe not found'; end if;
  if s.status <> 'locked' then raise exception 'safe already redeemed'; end if;
  if now() < s.unlock_date then
    raise exception 'safe locked until % (no early withdrawal)', s.unlock_date;
  end if;

  interest := round(s.amount * s.interest_rate / 100.0
                    * event_multiplier((select circle_id from users where id = s.user_id), 'safe_interest'));  -- Осень х2

  update wallets set balance = balance + s.amount + interest,
                     total_earned = total_earned + interest
    where user_id = s.user_id returning * into w;
  update safes set status = 'unlocked' where id = p_safe;

  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    select circle_id, null, s.user_id, interest, 'interest', s.id, 'Прирост Дупла'
      from users where id = s.user_id;

  perform bump_reputation(s.user_id, 'reliability', 1);  -- дождался срока = надёжность
  perform check_achievements(s.user_id);                 -- Хранитель (3 закрытых Дупла)
  return w;
end $$;

-- ═══════════════════ Удержание: стрик-полив, дневной квест, шишечный дождь ═══════════════════

-- Ежедневный подарок + серия. Первый заход за день (граница — полночь по Москве):
--   • гарантированный растущий бонус min(серия+1, 10) шишек;
--   • вехи серии: 7 дней → +25, 14 → +50, 30 → +100 сверху;
--   • авто-«дождик»-защитник серии раз в 7 дней (не более 2 в запасе) — один пропуск не рвёт серию;
--   • «Шишечный дождь» ~30% как приятный сюрприз сверху;
--   • дерево растёт по МАКСИМУМУ серии (не деградирует).
-- Возвращает json: streak, best, bonus, milestone, rain, freeze_used, freeze_granted, tree_level, first_today.
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

  if u.last_visit = d then   -- уже забирал сегодня — ничего не начисляем повторно
    return jsonb_build_object('streak', u.current_streak, 'best', u.longest_streak,
      'tree_level', u.tree_level, 'bonus', 0, 'milestone', 0, 'rain', 0,
      'first_today', false, 'freeze_used', false, 'freeze_granted', false);
  end if;

  if u.last_visit = d - 1 then
    new_streak := u.current_streak + 1;                            -- заходил вчера — серия растёт
  elsif u.last_visit = d - 2 and u.streak_freezes > 0 then
    new_streak := u.current_streak + 1;                            -- защитник спас пропущенный день
    update users set streak_freezes = streak_freezes - 1 where id = p_child;
    used_freeze := true;
  else
    new_streak := 1;                                               -- первый заход или пропуск без защиты
  end if;
  ls := greatest(u.longest_streak, new_streak);
  lvl := case when ls >= 30 then 5 when ls >= 14 then 4
              when ls >= 7 then 3 when ls >= 3 then 2 else 1 end;

  -- гарантированный растущий подарок: день1=2 … потолок 10
  bonus := least(new_streak + 1, 10);
  -- крупные вехи серии
  if    new_streak = 7  then milestone := 25;
  elsif new_streak = 14 then milestone := 50;
  elsif new_streak = 30 then milestone := 100;
  end if;

  -- авто-защитник серии раз в 7 дней (в запасе держим максимум 2)
  if (u.last_freeze_grant is null or d - u.last_freeze_grant >= 7) and u.streak_freezes < 2 then
    update users set streak_freezes = streak_freezes + 1, last_freeze_grant = d where id = p_child;
    freeze_granted := true;
  elsif u.last_freeze_grant is null or d - u.last_freeze_grant >= 7 then
    update users set last_freeze_grant = d where id = p_child;   -- отметить окно, даже если запас полон
  end if;

  -- Шишечный дождь: ~30% шанс, 1-3 шишки (переменная награда за возврат)
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

  perform check_achievements(p_child);   -- «Неделя в лесу»/«Хозяин леса» по серии
  return jsonb_build_object('streak', new_streak, 'best', ls, 'tree_level', lvl,
    'bonus', bonus, 'milestone', milestone, 'rain', rain,
    'first_today', true, 'freeze_used', used_freeze, 'freeze_granted', freeze_granted);
end $$;

-- Дневной квест от Духа: если на сегодня нет — создаёт из случайного шаблона (награда +5 за ежедневность)
create or replace function get_daily_quest(p_child uuid)
returns daily_quests language plpgsql security definer set search_path = public as $$
declare q daily_quests; tmpl task_templates;
begin
  select * into q from daily_quests where child_id = p_child and quest_date = current_date;
  if found then return q; end if;
  select * into tmpl from task_templates order by random() limit 1;
  if not found then raise exception 'no task templates seeded'; end if;
  insert into daily_quests(child_id, title, reward)
    values (p_child, tmpl.title, tmpl.reward + 5) returning * into q;
  return q;
end $$;

-- Завершить дневной квест -> награда
create or replace function complete_daily_quest(p_quest uuid)
returns wallets language plpgsql security definer set search_path = public as $$
declare q daily_quests; w wallets;
begin
  select * into q from daily_quests where id = p_quest for update;
  if not found then raise exception 'quest not found'; end if;
  if q.status = 'done' then raise exception 'daily quest already done'; end if;
  update daily_quests set status = 'done' where id = p_quest;
  update wallets set balance = balance + q.reward, total_earned = total_earned + q.reward
    where user_id = q.child_id returning * into w;
  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    select circle_id, null, q.child_id, q.reward, 'reward', q.id, 'Квест дня: ' || q.title
      from users where id = q.child_id;
  return w;
end $$;

-- ═══════════════════ Удержание v2: дождик-защитник + достижения-вехи ═══════════════════

-- Начислить бейджи-достижения по достигнутым порогам (идемпотентно). Зовётся после
-- ключевых действий (заход, задание, депозит).
create or replace function check_milestones(p_child uuid)
returns void language plpgsql security definer set search_path = public as $$
declare u users; done int; earned int;
begin
  select * into u from users where id = p_child;
  if u.longest_streak >= 7  then perform award_badge(p_child, 'week_in_forest'); end if;
  if u.longest_streak >= 30 then perform award_badge(p_child, 'forest_master');  end if;

  select count(*) into done from tasks where child_id = p_child and status = 'done';
  if done >= 10 then perform award_badge(p_child, 'hard_worker'); end if;

  select total_earned into earned from wallets where user_id = p_child;
  if earned >= 100 then perform award_badge(p_child, 'saver'); end if;
end $$;

-- Купить «Дождик-защитник» за шишки (страхует серию при пропуске 1 дня; sink против инфляции).
create or replace function buy_streak_freeze(p_child uuid)
returns users language plpgsql security definer set search_path = public as $$
declare w wallets; u users; price int := 20;
begin
  select * into w from wallets where user_id = p_child for update;
  if not found then raise exception 'wallet not found'; end if;
  if w.balance < price then
    raise exception 'not enough cones: have %, need %', w.balance, price;
  end if;
  update wallets set balance = balance - price, total_spent = total_spent + price
    where user_id = p_child;
  update users set streak_freezes = streak_freezes + 1 where id = p_child returning * into u;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (u.circle_id, p_child, null, price, 'purchase', 'Дождик-защитник');
  return u;
end $$;

-- ═══════════════════ Коллекции скинов: покупка (владение) + надевание ═══════════════════

-- Купить скин: владение навсегда (в отличие от impression-обещания). Дважды нельзя.
create or replace function purchase_skin(p_child uuid, p_item uuid)
returns user_skins language plpgsql security definer set search_path = public as $$
declare it shop_items; w wallets; us user_skins;
begin
  select * into it from shop_items where id = p_item;
  if not found or not it.is_active then raise exception 'skin unavailable'; end if;
  if it.type <> 'skin' then raise exception 'item is not a skin'; end if;
  if exists (select 1 from user_skins where user_id = p_child and skin_id = p_item) then
    raise exception 'skin already owned';
  end if;

  select * into w from wallets where user_id = p_child for update;
  if not found then raise exception 'wallet not found'; end if;
  if w.balance < it.price then
    raise exception 'not enough cones: have %, need %', w.balance, it.price;
  end if;

  update wallets set balance = balance - it.price, total_spent = total_spent + it.price
    where user_id = p_child;
  insert into user_skins(user_id, skin_id) values (p_child, p_item) returning * into us;
  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    values (coalesce(it.circle_id, (select circle_id from users where id = p_child)), p_child, null, it.price, 'purchase', p_item, 'Скин: ' || it.title);
  perform check_achievements(p_child);   -- Модник/Коллекционер
  return us;
end $$;

-- Надеть скин (образ дерева). Базовый образ доступен всегда; остальные — только если куплены.
create or replace function equip_skin(p_child uuid, p_skin uuid)
returns users language plpgsql security definer set search_path = public as $$
declare it shop_items; u users;
begin
  select * into it from shop_items where id = p_skin;
  if not found or it.type <> 'skin' then raise exception 'skin not found'; end if;
  if it.rarity <> 'base'
     and not exists (select 1 from user_skins where user_id = p_child and skin_id = p_skin) then
    raise exception 'skin not owned';
  end if;
  update users set avatar_skin = p_skin::text where id = p_child returning * into u;
  return u;
end $$;

-- ═══════════════════ Общий котёл: совместная семейная цель ═══════════════════

-- Родитель создаёт котёл (общую цель на сумму в шишках).
create or replace function create_pot(p_circle uuid, p_title text, p_goal int)
returns pots language plpgsql security definer set search_path = public as $$
declare p pots;
begin
  if p_goal <= 0 then raise exception 'goal must be positive'; end if;
  insert into pots(circle_id, title, goal, created_by)
    values (p_circle, p_title, p_goal, auth.uid()) returning * into p;
  return p;
end $$;

-- Ребёнок вкладывает шишки в котёл. Списывает из кошелька, растит сбор,
-- при достижении цели помечает 'reached'. Вклад в общее = щедрость.
create or replace function contribute_pot(p_child uuid, p_pot uuid, p_amount int)
returns pots language plpgsql security definer set search_path = public as $$
declare pt pots; w wallets; c_id uuid;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into pt from pots where id = p_pot for update;
  if not found then raise exception 'pot not found'; end if;
  if pt.status = 'fulfilled' then raise exception 'pot already fulfilled'; end if;

  select * into w from wallets where user_id = p_child for update;
  if not found then raise exception 'wallet not found'; end if;
  if w.balance < p_amount then
    raise exception 'not enough cones: have %, need %', w.balance, p_amount;
  end if;

  update wallets set balance = balance - p_amount, total_spent = total_spent + p_amount
    where user_id = p_child;   -- ушло из кошелька в общий котёл
  update pots set collected = collected + p_amount,
                  status = case when collected + p_amount >= goal then 'reached' else status end
    where id = p_pot returning * into pt;
  insert into pot_contributions(pot_id, child_id, amount) values (p_pot, p_child, p_amount);

  select circle_id into c_id from users where id = p_child;
  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    values (c_id, p_child, null, p_amount, 'pot_contribution', p_pot, 'В котёл: ' || pt.title);

  perform bump_reputation(p_child, 'generosity', 1);   -- вклад в общее дело
  perform check_achievements(p_child);                 -- Друг семьи
  return pt;
end $$;

-- Родитель исполняет цель котла (шишки уходят на реальную покупку — сжигаются).
create or replace function fulfill_pot(p_pot uuid)
returns pots language plpgsql security definer set search_path = public as $$
declare pt pots;
begin
  select * into pt from pots where id = p_pot for update;
  if not found then raise exception 'pot not found'; end if;
  if pt.status = 'fulfilled' then raise exception 'pot already fulfilled'; end if;
  update pots set status = 'fulfilled', fulfilled_at = now()
    where id = p_pot returning * into pt;
  return pt;
end $$;

-- ═══════════════════ Лесной гороскоп: ежедневное предсказание от Духа ═══════════════════

-- Предсказание дня: если на сегодня нет — выбирает из справочника, иногда (~20%) дарит
-- «счастливый» бонус 1-3 шишки, за 7 прочтений — бейдж «Звездочёт». Мягко, не инфляционно.
create or replace function get_daily_horoscope(p_child uuid)
returns daily_horoscopes language plpgsql security definer set search_path = public as $$
declare h daily_horoscopes; txt text; bonus int := 0; c_id uuid; cnt int;
begin
  select * into h from daily_horoscopes where child_id = p_child and horoscope_date = current_date;
  if found then return h; end if;

  select text into txt from horoscope_texts order by random() limit 1;
  if txt is null then raise exception 'no horoscope texts seeded'; end if;
  if random() < 0.20 then bonus := 1 + floor(random() * 3)::int; end if;

  insert into daily_horoscopes(child_id, text, bonus) values (p_child, txt, bonus) returning * into h;

  if bonus > 0 then
    update wallets set balance = balance + bonus, total_earned = total_earned + bonus
      where user_id = p_child;
    select circle_id into c_id from users where id = p_child;
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (c_id, null, p_child, bonus, 'reward', 'Лесной гороскоп');
  end if;

  perform check_achievements(p_child);   -- Звездочёт (7 гороскопов)
  return h;
end $$;

-- ═══════════════════ Сезонные события: движок модификаторов ═══════════════════

-- Запустить событие с модификаторами на срок (родитель/система). Пример modifiers:
-- Ярмарка {"task_reward":2}, Осень {"safe_interest":2}, Засуха {"task_reward":0.5}.
create or replace function start_event(p_circle uuid, p_type text, p_title text,
                                       p_modifiers jsonb, p_days int)
returns events language plpgsql security definer set search_path = public as $$
declare e events;
begin
  insert into events(circle_id, type, title, modifiers, end_date)
    values (p_circle, p_type, p_title, coalesce(p_modifiers, '{}'::jsonb),
            now() + make_interval(days => p_days))
    returning * into e;
  return e;
end $$;

-- Действующий множитель по ключу из всех активных событий (своих и глобальных).
-- Нет события с этим ключом → 1 (нейтрально).
create or replace function event_multiplier(p_circle uuid, p_key text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(max((modifiers ->> p_key)::numeric), 1)
    from events
   where (circle_id = p_circle or circle_id is null)
     and start_date <= now() and (end_date is null or end_date > now())
     and modifiers ? p_key
$$;

-- Глобальный «Шишечный дождь»: всем детям круга падает по p_amount шишек.
create or replace function trigger_cone_rain(p_circle uuid, p_amount int)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  for r in select id from users where circle_id = p_circle and role = 'child' loop
    update wallets set balance = balance + p_amount, total_earned = total_earned + p_amount
      where user_id = r.id;
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (p_circle, null, r.id, p_amount, 'reward', 'Шишечный дождь для всех');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ═══════════════════ Достижения: data-driven движок с прогрессом ═══════════════════

-- Текущее значение метрики достижения для ребёнка.
create or replace function achievement_metric(p_child uuid, p_metric text)
returns int language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'transfers_count'   then (select count(*) from transactions where from_user = p_child and type = 'transfer')
    when 'gifts_sum'         then (select coalesce(sum(amount),0) from transactions where from_user = p_child and type = 'transfer')
    when 'tasks_done'        then (select count(*) from tasks where child_id = p_child and status = 'done')
    when 'cones_earned'      then (select coalesce(total_earned,0) from wallets where user_id = p_child)
    when 'longest_streak'    then (select coalesce(longest_streak,0) from users where id = p_child)
    when 'deposits_count'    then (select count(*) from safes where user_id = p_child)
    when 'deposits_closed'   then (select count(*) from safes where user_id = p_child and status = 'unlocked')
    when 'horoscopes_read'   then (select count(*) from daily_horoscopes where child_id = p_child)
    when 'skins_owned'       then (select count(*) from user_skins where user_id = p_child)
    when 'pot_contributions' then (select count(*) from pot_contributions where child_id = p_child)
    when 'purchases_count'   then (select count(*) from purchases where child_id = p_child)
    when 'daily_quests_done' then (select count(*) from daily_quests where child_id = p_child and status = 'done')
    when 'rep_honesty'       then (select coalesce((reputation->>'honesty')::int,0) from users where id = p_child)
    when 'rep_generosity'    then (select coalesce((reputation->>'generosity')::int,0) from users where id = p_child)
    when 'rep_reliability'   then (select coalesce((reputation->>'reliability')::int,0) from users where id = p_child)
    when 'rep_wisdom'        then (select coalesce((reputation->>'wisdom')::int,0) from users where id = p_child)
    when 'total_reputation'  then (select coalesce((reputation->>'honesty')::int,0)+coalesce((reputation->>'generosity')::int,0)+coalesce((reputation->>'reliability')::int,0)+coalesce((reputation->>'wisdom')::int,0) from users where id = p_child)
    when 'cone_rain_caught'  then (select count(*) from transactions where to_user = p_child and message like 'Шишечный дождь%')
    when 'freezes_bought'    then (select count(*) from transactions where from_user = p_child and message = 'Дождик-защитник')
    when 'interest_earned'   then (select coalesce(sum(amount),0) from transactions where to_user = p_child and type = 'interest')
    when 'current_balance'   then (select coalesce(balance,0) from wallets where user_id = p_child)
    when 'cones_spent'       then (select coalesce(total_spent,0) from wallets where user_id = p_child)
    when 'tasks_photo'       then (select count(*) from tasks where child_id = p_child and status = 'done' and proof_url is not null)
    when 'tree_level'        then (select coalesce(tree_level,0) from users where id = p_child)
    when 'transfers_received' then (select count(*) from transactions where to_user = p_child and type = 'transfer')
    when 'gifts_received_sum' then (select coalesce(sum(amount),0) from transactions where to_user = p_child and type = 'transfer')
    when 'categories_done'   then (select count(distinct category) from tasks where child_id = p_child and status = 'done')
    when 'sales_count'       then (select count(*) from orders where seller_id = p_child and status = 'delivered')
    when 'sales_sum'         then (select coalesce(sum(price),0) from orders where seller_id = p_child and status = 'delivered')
    when 'shop_buys'         then (select count(*) from orders where buyer_id = p_child and status = 'delivered')
    when 'messages_sent'     then (select count(*) from messages where from_user = p_child)
    else 0 end::int
$$;

-- Пересчитать достижения: открыть все, где метрика достигла порога (+бонус за открытие).
-- Идемпотентно (уже открытые пропускаются). Зовётся после любого значимого действия.
create or replace function check_achievements(p_child uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a achievements; val int; c_id uuid;
begin
  for a in select * from achievements loop
    if exists (select 1 from user_achievements where child_id = p_child and code = a.code) then
      continue;
    end if;
    val := achievement_metric(p_child, a.metric);
    if val >= a.threshold then
      insert into user_achievements(child_id, code) values (p_child, a.code);
      if a.reward > 0 then
        update wallets set balance = balance + a.reward, total_earned = total_earned + a.reward
          where user_id = p_child;
        select circle_id into c_id from users where id = p_child;
        insert into transactions(circle_id, from_user, to_user, amount, type, message)
          values (c_id, null, p_child, a.reward, 'reward', 'Достижение: ' || a.title);
      end if;
    end if;
  end loop;
end $$;

-- Прогресс по всем достижениям (для экрана достижений): current/threshold/unlocked.
create or replace function achievement_progress(p_child uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', a.code, 'title', a.title, 'desc', a.description, 'tier', a.tier,
    'threshold', a.threshold, 'current', achievement_metric(p_child, a.metric),
    'unlocked', exists (select 1 from user_achievements where child_id = p_child and code = a.code)
  ) order by a.tier, a.code), '[]'::jsonb) from achievements a
$$;

-- ═══════════════════ Лавки-мастерские: детский бизнес с эскроу ═══════════════════

-- Ребёнок открывает свою лавку (одну).
create or replace function open_shop(p_child uuid, p_name text, p_desc text default null)
returns shops language plpgsql security definer set search_path = public as $$
declare s shops; c_id uuid;
begin
  select * into s from shops where owner_id = p_child;
  if found then
    if s.is_active then raise exception 'child already has a shop'; end if;
    update shops set name = p_name, description = p_desc, is_active = true where id = s.id returning * into s;
    return s;
  end if;
  select circle_id into c_id from users where id = p_child;
  insert into shops(owner_id, circle_id, name, description)
    values (p_child, c_id, p_name, p_desc) returning * into s;
  return s;
end $$;

-- Выставить лот в своей лавке (товар/услуга/цифровой артефакт).
create or replace function add_lot(p_child uuid, p_title text, p_type text, p_price int)
returns shop_lots language plpgsql security definer set search_path = public as $$
declare sh shops; l shop_lots;
begin
  select * into sh from shops where owner_id = p_child;
  if not found then raise exception 'open a shop first'; end if;
  insert into shop_lots(shop_id, title, type, price)
    values (sh.id, p_title, coalesce(p_type,'goods'), p_price) returning * into l;
  return l;
end $$;

-- Покупатель резервирует лот: шишки блокируются (списываются из баланса в эскроу-заказ).
create or replace function reserve_lot(p_buyer uuid, p_lot uuid)
returns orders language plpgsql security definer set search_path = public as $$
declare l shop_lots; sh shops; w wallets; o orders;
begin
  select * into l from shop_lots where id = p_lot;
  if not found or not l.is_active then raise exception 'lot unavailable'; end if;
  select * into sh from shops where id = l.shop_id;
  if not sh.is_active then raise exception 'shop closed'; end if;
  if sh.owner_id = p_buyer then raise exception 'cannot buy from your own shop'; end if;

  select * into w from wallets where user_id = p_buyer for update;
  if w.balance < l.price then
    raise exception 'not enough cones: have %, need %', w.balance, l.price;
  end if;
  update wallets set balance = balance - l.price where user_id = p_buyer;  -- эскроу-заморозка

  insert into orders(lot_id, buyer_id, seller_id, price)
    values (p_lot, p_buyer, sh.owner_id, l.price) returning * into o;
  return o;
end $$;

-- Покупатель подтверждает получение: шишки уходят продавцу (сделка завершена).
create or replace function confirm_order(p_order uuid)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders; c_id uuid;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.status <> 'reserved' then raise exception 'order not reservable (status=%)', o.status; end if;

  update wallets set balance = balance + o.price, total_earned = total_earned + o.price
    where user_id = o.seller_id;                       -- продавец получает доход
  update wallets set total_spent = total_spent + o.price
    where user_id = o.buyer_id;                        -- у покупателя это трата (было в эскроу)
  update orders set status = 'delivered', confirmed_at = now() where id = p_order;

  select circle_id into c_id from users where id = o.buyer_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
    values (c_id, o.buyer_id, o.seller_id, o.price, 'transfer', p_order, 'Покупка в лавке');

  perform check_achievements(o.seller_id);   -- продажи (Акула Бизнеса)
  perform check_achievements(o.buyer_id);
  return o;
end $$;

-- Отмена заказа: эскроу-шишки возвращаются покупателю.
create or replace function cancel_order(p_order uuid)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.status <> 'reserved' then raise exception 'only reserved orders can be canceled'; end if;
  update wallets set balance = balance + o.price where user_id = o.buyer_id;  -- вернуть эскроу
  update orders set status = 'canceled' where id = p_order;
  return o;
end $$;

-- ═══════════════════ Гильдии: совместный заказ с распределением по долям ═══════════════════

-- Создать гильдию (создатель становится первым участником со своей долей).
create or replace function create_guild(p_creator uuid, p_name text, p_share int default 1)
returns guilds language plpgsql security definer set search_path = public as $$
declare g guilds; c_id uuid;
begin
  select circle_id into c_id from users where id = p_creator;
  insert into guilds(circle_id, name, created_by) values (c_id, p_name, p_creator) returning * into g;
  insert into guild_members(guild_id, child_id, share) values (g.id, p_creator, greatest(p_share,1));
  return g;
end $$;

-- Присоединиться к гильдии (пока она открыта) со своей долей.
create or replace function join_guild(p_guild uuid, p_child uuid, p_share int default 1)
returns guild_members language plpgsql security definer set search_path = public as $$
declare g guilds; m guild_members;
begin
  select * into g from guilds where id = p_guild;
  if not found then raise exception 'guild not found'; end if;
  if g.status <> 'open' then raise exception 'guild is not open'; end if;
  insert into guild_members(guild_id, child_id, share) values (p_guild, p_child, greatest(p_share,1))
    on conflict (guild_id, child_id) do update set share = excluded.share
    returning * into m;
  return m;
end $$;

-- Завершить заказ гильдии: доход p_amount делится между участниками ПО ДОЛЯМ.
-- Округление точное: последнему участнику — остаток, чтобы сумма выплат = p_amount.
create or replace function complete_guild_order(p_guild uuid, p_amount int)
returns int language plpgsql security definer set search_path = public as $$
declare g guilds; total int; paid int := 0; n int; i int := 0; cut int; m record; c_id uuid;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into g from guilds where id = p_guild for update;
  if not found then raise exception 'guild not found'; end if;
  if g.status <> 'open' then raise exception 'guild order already closed'; end if;

  select coalesce(sum(share),0), count(*) into total, n from guild_members where guild_id = p_guild;
  if total = 0 then raise exception 'guild has no members'; end if;

  for m in select * from guild_members where guild_id = p_guild order by child_id loop
    i := i + 1;
    if i = n then cut := p_amount - paid;                 -- последнему остаток (точная сумма)
    else cut := (p_amount * m.share) / total; end if;     -- целочисленное деление
    paid := paid + cut;
    if cut > 0 then
      update wallets set balance = balance + cut, total_earned = total_earned + cut
        where user_id = m.child_id;
      select circle_id into c_id from users where id = m.child_id;
      insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
        values (c_id, null, m.child_id, cut, 'reward', p_guild, 'Заказ гильдии: ' || g.name);
      perform check_achievements(m.child_id);
    end if;
  end loop;

  update guilds set status = 'completed' where id = p_guild;
  return p_amount;
end $$;

-- ═══════════════════ Лесная почта: эмоции/стикеры/аудио + «Шёпот леса» ═══════════════════

-- Отправить сообщение (эмодзи/стикер/аудио). Только внутри своего круга.
create or replace function send_message(p_from uuid, p_to uuid, p_type text, p_content text, p_reply_to uuid default null)
returns messages language plpgsql security definer set search_path = public as $$
declare m messages; c_id uuid;
begin
  select circle_id into c_id from users where id = p_from;
  if c_id is distinct from (select circle_id from users where id = p_to) then
    raise exception 'recipient is not in your circle';
  end if;
  if p_reply_to is not null then
    if not exists (select 1 from messages where id=p_reply_to and circle_id=c_id) then
      raise exception 'replied message not found';
    end if;
  end if;
  insert into messages(circle_id, from_user, to_user, type, content, reply_to)
    values (c_id, p_from, p_to, p_type, p_content, p_reply_to) returning * into m;
  perform check_achievements(p_from);
  return m;
end $$;

-- «Шёпот леса»: отложенное тёплое голосовое от родителя, появится через p_delay_hours.
create or replace function send_whisper(p_parent uuid, p_child uuid, p_audio_url text, p_delay_hours int default 6)
returns messages language plpgsql security definer set search_path = public as $$
declare m messages; c_id uuid;
begin
  select circle_id into c_id from users where id = p_child;
  insert into messages(circle_id, from_user, to_user, type, content, is_whisper, deliver_at)
    values (c_id, p_parent, p_child, 'audio', p_audio_url, true,
            now() + make_interval(hours => greatest(p_delay_hours, 0)))
    returning * into m;
  return m;
end $$;

-- Входящие ребёнка: только уже доставленные (deliver_at <= now), новые сверху.
create or replace function get_inbox(p_child uuid)
returns setof messages language sql stable security definer set search_path = public as $$
  select * from messages
   where to_user = p_child and deliver_at <= now()
   order by created_at desc
$$;

-- Пометить сообщение прочитанным.
create or replace function mark_read(p_message uuid)
returns messages language plpgsql security definer set search_path = public as $$
declare m messages;
begin
  update messages set read_at = now()
    where id = p_message and read_at is null returning * into m;
  if not found then select * into m from messages where id = p_message; end if;
  return m;
end $$;

-- ═══════════════════ Перевод-оплата с комиссией банка (НЕ подарок) ═══════════════════

-- Оплата между детьми за услугу/игру/сделку. Банк берёт фикс-комиссию (сгорает — sink).
-- В отличие от transfer_cones (подарок): комиссия есть, щедрость НЕ начисляется.
create or replace function pay_cones(p_from uuid, p_to uuid, p_amount int, p_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w_from wallets; c_id uuid; fee int := 1; net int;
begin
  if p_from = p_to then raise exception 'cannot pay yourself'; end if;
  if p_amount <= fee then raise exception 'amount must exceed the % cone fee', fee; end if;
  net := p_amount - fee;

  perform 1 from wallets where user_id in (p_from, p_to) order by user_id for update;
  select * into w_from from wallets where user_id = p_from;
  if not found then raise exception 'sender wallet not found'; end if;
  if w_from.balance < p_amount then
    raise exception 'not enough cones: have %, need %', w_from.balance, p_amount;
  end if;

  update wallets set balance = balance - p_amount, total_spent = total_spent + p_amount
    where user_id = p_from;
  update wallets set balance = balance + net, total_earned = total_earned + net
    where user_id = p_to;

  select circle_id into c_id from users where id = p_from;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, p_from, p_to, net, 'transfer', coalesce(p_message, 'Оплата'));
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, p_from, null, fee, 'fee', 'Комиссия банка');
  update bank_account set treasury = treasury + fee where id = 'main';   -- комиссия в кассу банка
end $$;

-- ═══════════════════ Касса банка (казна семьи): комиссии копятся здесь ═══════════════════

-- Текущий баланс ГЛОБАЛЬНОЙ кассы банка-оператора.
create or replace function bank_treasury()
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(treasury,0) from bank_account where id = 'main'
$$;

-- Выплата ребёнку из ГЛОБАЛЬНОЙ кассы банка (страховка, бонус, услуга). Не эмиссия — из казны.
create or replace function bank_payout(p_child uuid, p_amount int, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare bal bigint; c_id uuid;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select treasury into bal from bank_account where id = 'main' for update;
  if bal < p_amount then raise exception 'not enough in bank treasury: have %, need %', bal, p_amount; end if;
  update bank_account set treasury = treasury - p_amount where id = 'main';
  update wallets set balance = balance + p_amount, total_earned = total_earned + p_amount
    where user_id = p_child;
  select circle_id into c_id from users where id = p_child;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, null, p_child, p_amount, 'payout', coalesce(p_reason, 'Выплата банка'));  -- из казны, не эмиссия
  return p_amount;
end $$;

-- ═══════════════════ Лесная страховка + Лесной Совет (голосования) ═══════════════════

-- Добровольный взнос в страховой фонд семьи (обычно 1 шишка). Шишка уходит из кошелька в фонд.
create or replace function pay_premium(p_child uuid, p_amount int default 1)
returns int language plpgsql security definer set search_path = public as $$
declare w wallets; c_id uuid;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select circle_id into c_id from users where id = p_child;
  select * into w from wallets where user_id = p_child for update;
  if w.balance < p_amount then raise exception 'not enough cones: have %, need %', w.balance, p_amount; end if;
  update wallets set balance = balance - p_amount, total_spent = total_spent + p_amount where user_id = p_child;
  update circles set insurance_fund = insurance_fund + p_amount where id = c_id;
  insert into transactions(circle_id, from_user, to_user, amount, type, message)
    values (c_id, p_child, null, p_amount, 'insurance', 'Взнос в Лесную страховку');
  return p_amount;
end $$;

-- Ребёнок «попал в беду» — подаёт заявку на страховую выплату (решает Лесной Совет).
create or replace function file_claim(p_child uuid, p_amount int, p_reason text)
returns proposals language plpgsql security definer set search_path = public as $$
declare p proposals; c_id uuid;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select circle_id into c_id from users where id = p_child;
  insert into proposals(circle_id, type, title, target_user, amount, created_by)
    values (c_id, 'insurance_claim', coalesce(p_reason,'Страховая выплата'), p_child, p_amount, p_child)
    returning * into p;
  return p;
end $$;

-- Голос в Лесном Совете: 1 ребёнок = 1 голос (равный, не плутократия). Повтор — меняет голос.
create or replace function vote_proposal(p_proposal uuid, p_voter uuid, p_choice text)
returns votes language plpgsql security definer set search_path = public as $$
declare pr proposals; v votes;
begin
  select * into pr from proposals where id = p_proposal;
  if not found then raise exception 'proposal not found'; end if;
  if pr.status <> 'voting' then raise exception 'voting is closed'; end if;
  insert into votes(proposal_id, voter_id, choice) values (p_proposal, p_voter, p_choice)
    on conflict (proposal_id, voter_id) do update set choice = excluded.choice
    returning * into v;
  return v;
end $$;

-- Подвести итог: если «за» больше «против» — принято. Для страховки — выплата из фонда пострадавшему.
create or replace function close_proposal(p_proposal uuid)
returns proposals language plpgsql security definer set search_path = public as $$
declare pr proposals; yes int; no int; payout int;
begin
  select * into pr from proposals where id = p_proposal for update;
  if not found then raise exception 'proposal not found'; end if;
  if pr.status <> 'voting' then raise exception 'proposal already closed'; end if;

  select count(*) filter (where choice='yes'), count(*) filter (where choice='no')
    into yes, no from votes where proposal_id = p_proposal;

  if yes > no then
    update proposals set status = 'passed' where id = p_proposal;
    if pr.type = 'insurance_claim' and pr.target_user is not null then
      select least(pr.amount, insurance_fund) into payout from circles where id = pr.circle_id;
      if payout > 0 then
        update circles set insurance_fund = insurance_fund - payout where id = pr.circle_id;
        update wallets set balance = balance + payout, total_earned = total_earned + payout
          where user_id = pr.target_user;
        insert into transactions(circle_id, from_user, to_user, amount, type, message)
          values (pr.circle_id, null, pr.target_user, payout, 'payout', 'Страховая выплата (Совет)');
      end if;
    end if;
  else
    update proposals set status = 'rejected' where id = p_proposal;
  end if;
  select * into pr from proposals where id = p_proposal;
  return pr;
end $$;

-- ═══════════════════ Лесной аукцион: ставки с эскроу, победитель платит в кассу банка ═══════════════════

-- Ближайший понедельник 15:00 по Москве как timestamptz (дедлайн еженедельного аукциона).
-- Если этот понедельник 15:00 уже прошёл — берём следующий.
create or replace function next_monday_15msk()
returns timestamptz language sql stable as $$
  select (case
     when (date_trunc('week', (now() at time zone 'Europe/Moscow')) + interval '15 hours')
          > (now() at time zone 'Europe/Moscow')
     then (date_trunc('week', (now() at time zone 'Europe/Moscow')) + interval '15 hours')
     else (date_trunc('week', (now() at time zone 'Europe/Moscow')) + interval '15 hours' + interval '7 days')
   end) at time zone 'Europe/Moscow'
$$;

-- Админ/банк выставляет супер-лот на торги. Дедлайн — ближайший понедельник 15:00 МСК.
create or replace function create_auction(p_title text, p_prize_skin uuid, p_min_bid int, p_created_by uuid default null)
returns auctions language plpgsql security definer set search_path = public as $$
declare a auctions;
begin
  if p_min_bid <= 0 then raise exception 'min_bid must be positive'; end if;
  insert into auctions(title, prize_skin, min_bid, created_by, ends_at)
    values (p_title, p_prize_skin, p_min_bid, p_created_by, next_monday_15msk()) returning * into a;
  return a;
end $$;

-- Сделать ставку. Эскроу: резерв у нового лидера, ВОЗВРАТ прежнему лидеру (он ничего не теряет).
create or replace function place_bid(p_auction uuid, p_bidder uuid, p_amount int)
returns auctions language plpgsql security definer set search_path = public as $$
declare a auctions; w wallets;
begin
  select * into a from auctions where id = p_auction for update;
  if not found then raise exception 'auction not found'; end if;
  if a.status <> 'live' then raise exception 'auction is closed'; end if;
  if a.ends_at is not null and now() >= a.ends_at then raise exception 'auction ended'; end if;
  if p_bidder = a.current_leader then raise exception 'you are already the top bidder'; end if;
  if p_amount < a.min_bid then raise exception 'bid below minimum %', a.min_bid; end if;
  if p_amount <= a.current_bid then raise exception 'bid must beat current %', a.current_bid; end if;

  select * into w from wallets where user_id = p_bidder for update;
  if w.balance < p_amount then raise exception 'not enough cones: have %, need %', w.balance, p_amount; end if;

  -- вернуть эскроу прежнему лидеру
  if a.current_leader is not null then
    update wallets set balance = balance + a.current_bid where user_id = a.current_leader;
  end if;
  -- зарезервировать у нового лидера
  update wallets set balance = balance - p_amount where user_id = p_bidder;

  update auctions set current_bid = p_amount, current_leader = p_bidder where id = p_auction;
  insert into bids(auction_id, bidder_id, amount) values (p_auction, p_bidder, p_amount);
  select * into a from auctions where id = p_auction;
  return a;
end $$;

-- Закрыть аукцион: победитель платит (эскроу -> касса банка), забирает приз-скин.
create or replace function close_auction(p_auction uuid)
returns auctions language plpgsql security definer set search_path = public as $$
declare a auctions; c_id uuid;
begin
  select * into a from auctions where id = p_auction for update;
  if not found then raise exception 'auction not found'; end if;
  if a.status <> 'live' then raise exception 'auction already closed'; end if;

  if a.current_leader is not null then
    -- эскроу победителя (уже списан с баланса) уходит в кассу банка-оператора
    update wallets set total_spent = total_spent + a.current_bid where user_id = a.current_leader;
    update bank_account set treasury = treasury + a.current_bid where id = 'main';
    select circle_id into c_id from users where id = a.current_leader;
    insert into transactions(circle_id, from_user, to_user, amount, type, message)
      values (c_id, a.current_leader, null, a.current_bid, 'fee', 'Ставка на аукционе: ' || a.title);
    -- приз-скин победителю
    if a.prize_skin is not null then
      insert into user_skins(user_id, skin_id) values (a.current_leader, a.prize_skin)
        on conflict do nothing;
      perform check_achievements(a.current_leader);
    end if;
  end if;

  update auctions set status = 'closed' where id = p_auction;
  select * into a from auctions where id = p_auction;
  return a;
end $$;

-- ═══════════════════ Лесной Альбом: тёплая хроника жизни (поверх журнала) ═══════════════════

-- Лента событий ребёнка из журнала транзакций + достижений + фотоотчётов.
-- Возвращает jsonb-массив {kind, title, amount, at}, новые сверху. kind -> иконка на клиенте
-- («не сухой список транзакций»: типы человекочитаемые, клиент рисует картинку/цвет).
create or replace function get_album(p_child uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(ev order by (ev->>'at')::timestamptz desc), '[]'::jsonb)
  from (
    -- события из журнала транзакций
    select jsonb_build_object(
      'kind', case
        when type = 'reward' then 'earn'
        when type = 'transfer' and to_user = p_child then 'gift_in'
        when type = 'transfer' and from_user = p_child then 'gift_out'
        when type = 'purchase' then 'buy'
        when type = 'interest' then 'interest'
        when type = 'deposit' then 'deposit'
        when type = 'insurance' then 'insurance'
        when type = 'pot_contribution' then 'pot'
        when type = 'fee' then 'spend'
        when type = 'payout' then 'payout'
        else type end,
      'title', coalesce(message, ''),
      'amount', amount,
      'at', created_at) as ev
    from transactions
    where to_user = p_child or from_user = p_child

    union all
    -- открытые достижения
    select jsonb_build_object('kind', 'achievement', 'title', a.title, 'amount', null, 'at', ua.unlocked_at)
    from user_achievements ua join achievements a on a.code = ua.code
    where ua.child_id = p_child

    union all
    -- задания с фотоотчётом (памятные моменты)
    select jsonb_build_object('kind', 'photo', 'title', title, 'amount', null, 'at', completed_at)
    from tasks
    where child_id = p_child and status = 'done' and proof_url is not null and completed_at is not null
  ) src
$$;

-- ═══════════════════ Нарративные квесты от Духа (многошаговые истории) ═══════════════════

-- Запустить квест-линию из встроенного шаблона. Пока есть 'golden_cone' — «Золотая Шишка».
create or replace function start_quest(p_circle uuid, p_code text)
returns quests language plpgsql security definer set search_path = public as $$
declare q quests; gold uuid;
begin
  if p_code <> 'golden_cone' then raise exception 'unknown quest template: %', p_code; end if;
  select id into gold from shop_items where type = 'skin' and title = 'Золотое дерево' limit 1;
  insert into quests(circle_id, code, title, reward_cones, reward_skin)
    values (p_circle, 'golden_cone', 'Пропала Золотая Шишка', 10, gold) returning * into q;
  insert into quest_steps(quest_id, step_order, kind, text, goal) values
    (q.id, 1, 'narrative', 'Беда! Золотая Шишка исчезла из леса. Лесной Дух просит семью о помощи.', 0),
    (q.id, 2, 'collect',   'Соберите 30 шишек в фонд поисков.', 30),
    (q.id, 3, 'task',      'Каждый обыщет свою поляну — сделайте 3 вылазки.', 3),
    (q.id, 4, 'narrative', 'След ведёт к старому дубу на краю леса...', 0),
    (q.id, 5, 'finale',    'Золотая Шишка найдена! Награда всем искателям.', 0);
  return q;
end $$;

-- Вклад шишек в фонд поисков (для шага 'collect').
create or replace function quest_contribute(p_child uuid, p_quest uuid, p_amount int)
returns quests language plpgsql security definer set search_path = public as $$
declare q quests; st quest_steps; w wallets;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select * into q from quests where id = p_quest for update;
  if not found or q.status <> 'active' then raise exception 'quest not active'; end if;
  select * into st from quest_steps where quest_id = p_quest and step_order = q.current_step;
  if st.kind <> 'collect' then raise exception 'current step is not a collect step'; end if;

  select * into w from wallets where user_id = p_child for update;
  if w.balance < p_amount then raise exception 'not enough cones: have %, need %', w.balance, p_amount; end if;
  update wallets set balance = balance - p_amount, total_spent = total_spent + p_amount where user_id = p_child;
  update quests set fund = fund + p_amount where id = p_quest;
  update quest_steps set progress = progress + p_amount where quest_id = p_quest and step_order = q.current_step;
  select * into q from quests where id = p_quest;
  return q;
end $$;

-- Личное действие ребёнка в истории (для шага 'task') — +1 к прогрессу.
create or replace function quest_action(p_child uuid, p_quest uuid)
returns quests language plpgsql security definer set search_path = public as $$
declare q quests; st quest_steps;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.status <> 'active' then raise exception 'quest not active'; end if;
  select * into st from quest_steps where quest_id = p_quest and step_order = q.current_step;
  if st.kind <> 'task' then raise exception 'current step is not a task step'; end if;
  update quest_steps set progress = progress + 1 where quest_id = p_quest and step_order = q.current_step;
  select * into q from quests where id = p_quest;
  return q;
end $$;

-- Продвинуть квест: если текущий шаг выполнен — к следующему; при финале — награда всем детям.
create or replace function advance_quest(p_quest uuid)
returns quests language plpgsql security definer set search_path = public as $$
declare q quests; st quest_steps; nxt quest_steps; r record; c_id uuid;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.status <> 'active' then raise exception 'quest not active'; end if;
  select * into st from quest_steps where quest_id = p_quest and step_order = q.current_step;

  -- narrative проходится сразу; collect/task — по достижению цели
  if st.kind not in ('narrative') and st.progress < st.goal then
    raise exception 'current step not complete (%/%)', st.progress, st.goal;
  end if;
  update quest_steps set done = true where quest_id = p_quest and step_order = q.current_step;
  update quests set current_step = current_step + 1 where id = p_quest returning * into q;

  select * into nxt from quest_steps where quest_id = p_quest and step_order = q.current_step;
  if nxt.kind = 'finale' then
    -- финал: награда всем детям круга (фонд поисков потрачен на приключение)
    for r in select id from users where circle_id = q.circle_id and role = 'child' loop
      update wallets set balance = balance + q.reward_cones, total_earned = total_earned + q.reward_cones
        where user_id = r.id;
      insert into transactions(circle_id, from_user, to_user, amount, type, ref_id, message)
        values (q.circle_id, null, r.id, q.reward_cones, 'reward', p_quest, 'Награда квеста: ' || q.title);
      if q.reward_skin is not null then
        insert into user_skins(user_id, skin_id) values (r.id, q.reward_skin) on conflict do nothing;
      end if;
      perform check_achievements(r.id);
    end loop;
    update quest_steps set done = true where quest_id = p_quest and step_order = q.current_step;
    update quests set status = 'completed' where id = p_quest returning * into q;
  end if;
  return q;
end $$;
