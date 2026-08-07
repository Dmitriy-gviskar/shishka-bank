import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupDb, startServer, url } from './helpers/db.mjs';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'client/'));
const pg = require('pg');

test('гильдия v3: создать, вступить, роли, чат, история, сон/пробуждение', async (t) => {
  const db = await setupDb();
  const srv = await startServer(db.url);
  t.after(() => srv.stop());

  const api = (p, body, kid = db.childA1) =>
    srv.api(p, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-child-code': kid.code },
      body: body ? JSON.stringify(body) : undefined });

  // ── создать гильдию ──
  let r = await api('/api/guilds');
  assert.equal(r.body.length, 0, 'гильдий ещё нет');

  r = await api('/api/guild/create', { name: 'Лесные мастера' });
  assert.equal(r.body.name, 'Лесные мастера');

  // ── список: создатель в гильдии, статус open, роль founder ──
  r = await api('/api/guilds');
  assert.equal(r.body.length, 1);
  const g = r.body[0];
  assert.equal(g.status, 'open');
  assert.ok(g.mine);
  const me = g.members.find((m) => m.mine);
  assert.ok(me, 'создатель в составе');
  assert.equal(me.role, 'founder');
  assert.equal(me.share, 1);

  // ── второй ребёнок вступает ──
  const api2 = (p, body) => srv.api(p, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-child-code': db.childA2.code },
    body: body ? JSON.stringify(body) : undefined });

  r = await api2('/api/guild/join', { id: g.id });
  assert.equal(r.body.ok, true);

  // ── чат ──
  r = await api('/api/guild/chat', { id: g.id });
  assert.ok(Array.isArray(r.body), 'чат — массив');

  r = await api('/api/guild/say', { id: g.id, phrase: 'Собираемся!' });
  assert.equal(r.body.ok, true);

  r = await api('/api/guild/chat', { id: g.id });
  assert.ok(r.body.some((m) => m.content === 'Собираемся!'), 'фраза в чате');

  // ── сменить роль (основатель → казначей для второго) ──
  r = await api('/api/guild/role', { id: g.id, childId: db.childA2.id, role: 'treasurer' });
  assert.equal(r.body.ok, true);

  // ── сменить долю (казначей меняет себе) ──
  r = await api2('/api/guild/share', { id: g.id, childId: db.childA2.id, share: 3 });
  assert.equal(r.body.ok, true);

  // ── история ──
  r = await api('/api/guild/history', { id: g.id });
  assert.ok(r.body.length >= 3, 'минимум 3 события: создание, вступление, смена роли');
  assert.ok(r.body.some((e) => e.kind === 'member_joined'), 'member_joined');
  assert.ok(r.body.some((e) => e.kind === 'role_changed'), 'role_changed');

  // ── сон / пробуждение ──
  // симулируем простой: двигаем last_activity в прошлое
  const pool = new pg.Pool({ connectionString: url });
  await pool.query("update guilds set last_activity = now() - interval '8 days' where id = $1", [g.id]);
  await pool.query("select sweep_sleeping_guilds(7)");
  await pool.end();

  r = await api('/api/guilds');
  const sg = r.body.find((x) => x.id === g.id);
  assert.equal(sg.status, 'sleeping', 'гильдия уснула');

  // пробуждение
  r = await api('/api/guild/awaken', { id: g.id });
  assert.equal(r.body.ok, true);

  r = await api('/api/guilds');
  const ag = r.body.find((x) => x.id === g.id);
  assert.equal(ag.status, 'open', 'гильдия проснулась');
});
