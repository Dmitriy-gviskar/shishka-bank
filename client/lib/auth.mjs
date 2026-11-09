// Авторизация Шишка Банк: контекст запроса, токены устройств, сессии взрослых.
// В БД хранятся только хэши токенов; сырой токен живёт у клиента.
import { createHash, randomBytes } from 'node:crypto';

const CTX_TTL = 5 * 60e3;   // код входа / сессия взрослого → круг меняется редко (токен устройства не кэшируем, см. resolve)

export function makeAuth(q, one) {
  const cache = new Map();
  const hash = (raw) => createHash('sha256').update(String(raw)).digest('hex');
  const newToken = () => randomBytes(24).toString('hex');

  const readCookie = (req, name) => {
    const raw = req.headers?.cookie;
    if (!raw) return null;
    for (const part of raw.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  };

  const cached = async (key, load) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < CTX_TTL) return hit.v;
    const v = await load();
    if (v) cache.set(key, { v, t: Date.now() });
    return v;
  };

  async function resolve(req) {
    const h = req.headers || {};

    const dt = h['x-device-token'];
    if (dt) {
      // без кэша: отзыв токена (revoked_at) обязан блокировать доступ немедленно,
      // а не по истечении TTL — это единственная по-настоящему отзываемая проверка
      // (у кода входа и сессии взрослого в схеме нет колонки отзыва).
      // circle берём join'ом с users, а не из device_tokens.circle_id: колонка токена
      // ничем не связана с users.circle_id и может рассинхронизироваться (ребёнку достанется чужой круг)
      const r = await one(
        `select d.child_id child, u.circle_id circle from device_tokens d
           join users u on u.id=d.child_id
           where d.token_hash=$1 and d.revoked_at is null`, [hash(dt)]);
      if (r) {
        const ctx = { child: r.child, circle: r.circle, role: 'child' };
        q('update device_tokens set last_seen_at=now() where token_hash=$1', [hash(dt)]).catch(() => {});
        return ctx;
      }
    }

    const cc = h['x-child-code'];
    if (cc) {
      const code = decodeURIComponent(cc);
      const ctx = await cached('c:' + code, async () => {
        const r = await one(
          `select u.id child, u.circle_id circle from child_logins cl
             join users u on u.id=cl.child_id where cl.code=$1`, [code]);
        return r ? { child: r.child, circle: r.circle, role: 'child' } : null;
      });
      if (ctx) return ctx;
    }

    const sess = readCookie(req, 'sb_session');
    if (sess) {
      const ctx = await cached('s:' + sess, async () => {
        const r = await one(
          `select s.adult_id adult, m.circle_id circle, m.role from adult_sessions s
             left join memberships m on m.adult_id=s.adult_id
            where s.token_hash=$1 order by m.role limit 1`, [hash(sess)]);
        return r ? { adult: r.adult, circle: r.circle, role: r.role || 'owner' } : null;
      });
      if (ctx) return ctx;
    }

    return {};
  }

  const dropCache = () => cache.clear();
  return { resolve, hash, newToken, readCookie, dropCache };
}
