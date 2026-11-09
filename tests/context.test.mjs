import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { setupDb } from './helpers/db.mjs';
import { makeAuth } from '../client/lib/auth.mjs';

// pg установлен только в client/node_modules — тот же приём, что и в tests/helpers/db.mjs
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'client/'));
const pg = require('pg');

test('resolve отдаёт ребёнка по токену устройства и по коду, отозванный токен не пускает', async () => {
  const db = await setupDb();
  const pool = new pg.Pool({ connectionString: db.url });
  const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows);
  const one = (sql, p = []) => q(sql, p).then((r) => r[0] || null);
  const auth = makeAuth(q, one);

  const raw = auth.newToken();
  await q('insert into device_tokens(token_hash, child_id, circle_id) values ($1,$2,$3)',
    [auth.hash(raw), db.childA1.id, db.circleA]);

  const byToken = await auth.resolve({ headers: { 'x-device-token': raw } });
  assert.equal(byToken.child, db.childA1.id);
  assert.equal(byToken.circle, db.circleA);
  assert.equal(byToken.role, 'child');

  const byCode = await auth.resolve({ headers: { 'x-child-code': encodeURIComponent(db.childA1.code) } });
  assert.equal(byCode.child, db.childA1.id);

  await q('update device_tokens set revoked_at=now() where token_hash=$1', [auth.hash(raw)]);
  const revoked = await auth.resolve({ headers: { 'x-device-token': raw } });
  assert.equal(revoked.child, undefined);
  await pool.end();
});
