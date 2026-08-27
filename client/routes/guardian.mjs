// Родитель в приложении (свой код дерева), не кабинет ведущего.
const MAX_FAMILY_TASKS = 5;
const MAX_FAMILY_REWARD = 15;
const MAX_WARDS = 5;

export function parseChatAges(b) {
  const year = (raw, label) => {
    if (raw == null || raw === '') return null;
    const n = parseInt(raw, 10);
    if (!(n >= 4 && n <= 17)) throw { code: 400, msg: `${label} от 4 до 17` };
    return n;
  };
  const age = year(b.age, 'возраст');
  let chatMin = year(b.chatMin, 'нижняя граница');
  let chatMax = year(b.chatMax, 'верхняя граница');
  if (chatMin != null && chatMax == null) chatMax = 17;
  if (chatMax != null && chatMin == null) chatMin = 4;
  if (chatMin != null && chatMax != null && chatMin > chatMax) {
    throw { code: 400, msg: 'нижняя граница больше верхней' };
  }
  return { age, chatMin, chatMax };
}

function familyReward(raw) {
  const amount = parseInt(raw, 10);
  if (!(amount > 0)) throw { code: 400, msg: 'укажи награду' };
  if (amount > MAX_FAMILY_REWARD) throw { code: 400, msg: `не больше ${MAX_FAMILY_REWARD} шишек за семейное дело` };
  return amount;
}

async function assertWard(one, guardianId, childId) {
  const row = await one(
    `select u.id, u.name, u.circle_id
       from child_guardians g
       join users u on u.id = g.child_id
      where g.guardian_id = $1 and g.child_id = $2`,
    [guardianId, childId]);
  if (!row) throw { code: 403, msg: 'это не твой ребёнок' };
  return row;
}

export function routesGuardian({ q, one, rpc, sendPush }) {
  return {
'GET /api/guardian/family': async (b, ctx) => {
  const kids = await q(
    `select u.id, u.name, u.age, u.chat_age_min as "chatMin", u.chat_age_max as "chatMax",
            (select count(*)::int from tasks t
              where t.child_id = u.id and t.kind = 'family'
                and t.created_by = $1
                and t.status in ('open','pending_review','rejected')) as hanging
       from child_guardians g
       join users u on u.id = g.child_id
      where g.guardian_id = $1
      order by u.name`, [ctx.child]);
  const pending = await q(
    `select t.id, t.title, t.reward, t.proof_url as photo, u.name as "childName"
       from tasks t
       join child_guardians g on g.child_id = t.child_id and g.guardian_id = $1
       join users u on u.id = t.child_id
      where t.status = 'pending_review' and t.kind = 'family'
      order by t.created_at`, [ctx.child]);
  const templates = await q(
    `select id, title, least(reward, $1)::int as reward, category, needs_photo
       from task_templates
      where coalesce(pack, '') <> 'bereza'
      order by category nulls last, reward, title
      limit 50`, [MAX_FAMILY_REWARD]);
  return { kids, pending, templates, maxTasks: MAX_FAMILY_TASKS, maxReward: MAX_FAMILY_REWARD };
},

'POST /api/guardian/link': async (b, ctx) => {
  // как /api/link: кириллица в коде (ТАЯ-01) должна остаться. Тире из мессенджеров → ASCII.
  const code = String(b.code || '').toUpperCase().replace(/[\u2010-\u2015\u2212]/g, '-').trim();
  if (!code) throw { code: 400, msg: 'введи код дерева ребёнка' };
  const kid = await one(
    `select u.id, u.name
       from child_logins cl join users u on u.id = cl.child_id
      where cl.code = $1 and u.role = 'child'`, [code]);
  if (!kid) throw { code: 400, msg: 'код не найден' };
  if (kid.id === ctx.child) throw { code: 400, msg: 'нельзя привязать себя' };
  const n = await one('select count(*)::int as c from child_guardians where guardian_id=$1', [ctx.child]);
  if ((n?.c || 0) >= MAX_WARDS) throw { code: 400, msg: `не больше ${MAX_WARDS} детей` };
  await q(
    'insert into child_guardians(child_id, guardian_id) values($1,$2) on conflict do nothing',
    [kid.id, ctx.child]);
  return { ok: true, name: kid.name, childId: kid.id };
},

'POST /api/guardian/chat-ages': async (b, ctx) => {
  await assertWard(one, ctx.child, b.childId);
  const { age, chatMin, chatMax } = parseChatAges(b);
  await q(
    'update users set age=$2, chat_age_min=$3, chat_age_max=$4 where id=$1',
    [b.childId, age, chatMin, chatMax]);
  return { ok: true, age, chatMin, chatMax };
},

'POST /api/guardian/unlink': async (b, ctx) => {
  await assertWard(one, ctx.child, b.childId);
  await q('delete from child_guardians where child_id=$1 and guardian_id=$2', [b.childId, ctx.child]);
  return { ok: true };
},

'POST /api/guardian/task': async (b, ctx) => {
  const kid = await assertWard(one, ctx.child, b.childId);
  let title = String(b.title || '').replace(/[<>]/g, '').trim().slice(0, 60);
  let reward = b.reward;
  let photo = !!b.photo;
  let category = 'дом';
  if (b.templateId) {
    const tpl = await one(
      `select title, least(reward, $2)::int as reward, needs_photo, category
         from task_templates where id=$1`, [b.templateId, MAX_FAMILY_REWARD]);
    if (!tpl) throw { code: 400, msg: 'нет такого шаблона' };
    title = title || tpl.title;
    if (reward == null || reward === '') reward = tpl.reward;
    if (b.photo == null) photo = !!tpl.needs_photo;
    category = tpl.category || 'дом';
  }
  reward = familyReward(reward);
  if (!title) throw { code: 400, msg: 'укажи задание' };
  const hanging = await one(
    `select count(*)::int as c from tasks
      where child_id=$1 and created_by=$2 and kind='family'
        and status in ('open','pending_review','rejected')`, [kid.id, ctx.child]);
  if ((hanging?.c || 0) >= MAX_FAMILY_TASKS) {
    throw { code: 400, msg: `не больше ${MAX_FAMILY_TASKS} своих дел сразу` };
  }
  const dup = await one(
    `select id from tasks where child_id=$1 and lower(title)=lower($2)
        and status in ('open','pending_review','rejected') limit 1`, [kid.id, title]);
  if (dup) throw { code: 400, msg: 'такое задание уже висит' };
  await q(
    `insert into tasks(circle_id,child_id,created_by,title,reward,category,needs_photo,kind)
     values($1,$2,$3,$4,$5,$6,$7,'family')`,
    [kid.circle_id, kid.id, ctx.child, title, reward, category, photo]);
  sendPush(kid.id, '📋 Новое дело', `${title} · +${reward} шишек`, '/quests.html').catch(() => {});
  return { ok: true, title, reward };
},

'POST /api/guardian/approve': async (b, ctx) => {
  const t = await one(
    `select t.id, t.child_id, t.title
       from tasks t
       join child_guardians g on g.child_id = t.child_id and g.guardian_id = $1
      where t.id = $2 and t.kind = 'family' and t.status = 'pending_review'`,
    [ctx.child, b.id]);
  if (!t) throw { code: 400, msg: 'нет задания на проверке' };
  try { await rpc('approve_task', [t.id]); }
  catch { throw { code: 400, msg: 'нет задания на проверке' }; }
  sendPush(t.child_id, '✅ Задание одобрено', t.title, '/quests.html').catch(() => {});
  return { ok: true };
},

'POST /api/guardian/reject': async (b, ctx) => {
  const own = await one(
    `select t.id, t.child_id, t.title
       from tasks t
       join child_guardians g on g.child_id = t.child_id and g.guardian_id = $1
      where t.id = $2 and t.kind = 'family'`,
    [ctx.child, b.id]);
  if (!own) throw { code: 400, msg: 'нет такого задания' };
  let t;
  try { [t] = await rpc('reject_task', [b.id]); }
  catch { return { ok: true }; }
  if (t?.child_id) {
    sendPush(t.child_id, '📝 Доработай дело', `«${t.title}» вернули — отправь ещё раз`, '/quests.html').catch(() => {});
  }
  return { ok: true };
},
  };
}
