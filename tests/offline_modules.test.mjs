import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../client/lib/http.mjs';
const root=fileURLToPath(new URL('../client/',import.meta.url));
test('offline browser modules load as JavaScript, while server modules stay private', async () => {
  for (const path of ['/lib/offline-cards.mjs','/lib/offline-queue.mjs','/lib/new-shelf.mjs']) {
    const [status,body,headers]=await serveStatic(path,root);
    assert.equal(status,200,path);
    assert.match(headers['Content-Type'],/javascript/);
    assert.ok(body.length>0);
  }
  for (const path of ['/server-pg.mjs','/lib/auth.mjs','/lib/http.mjs','/routes/cards.mjs','/lib/../server-pg.mjs'])
    assert.ok([403,404].includes((await serveStatic(path,root))[0]),path);
});
