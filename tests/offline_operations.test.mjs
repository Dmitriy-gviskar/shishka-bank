import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setupDb, startServer } from './helpers/db.mjs';
const pg = createRequire(new URL('../client/package.json', import.meta.url))('pg');
const post = (code, body) => ({ method: 'POST', headers: { 'x-child-code': code, 'content-type': 'application/json' }, body: JSON.stringify({protocol:2,epoch:'11111111-1111-4111-8111-111111111111',...body}) });
async function fixture(t, balance = 30) {
  const db = await setupDb();
  const srv = await startServer(db.url);
  const pool = new pg.Pool({ connectionString: db.url });
  t.after(async () => { await srv.stop(); await pool.end(); });
  const q = (s, p = []) => pool.query(s,p).then((r) => r.rows);
  await q('update wallets set balance=$2 where user_id=$1', [db.childA1.id,balance]);
  const buy = (nonce, extra = {}, path = '/api/pack/offline', code = db.childA1.code) => srv.api(path,post(code,{nonce,...extra}));
  const stats = async () => (await q(`select w.balance,w.total_spent,u.packs_opened,
    (select coalesce(sum(qty),0)::int from user_cards where user_id=u.id) as cards,
    (select count(*)::int from card_operation_receipts where child_id=u.id) as receipts,
    (select count(*)::int from offline_pack_claims where child_id=u.id) as claims,
    (select count(*)::int from transactions where from_user=u.id) as transactions
    from users u join wallets w on w.user_id=u.id where u.id=$1`,[db.childA1.id]))[0];
  return { db,srv,q,buy,stats };
}

test('pack composition and ranks are server-owned; invalid payload never charges', async (t) => {
  const f = await fixture(t);
  const before = await f.stats();
  for (const extra of [{cards:[{type:'forged',grade:6}]},{grade:6},{price:0}])
    assert.equal((await f.buy('forged-pack-01',extra)).status,extra.cards ? 503 : 400);
  assert.equal((await f.srv.api('/api/pack/open',post(f.db.childA1.code,{}))).status,503);
  assert.deepEqual(await f.stats(),before);
  const opened = await f.buy('honest-pack-01');
  assert.equal(opened.status,200);
  assert.equal(opened.body.cards.length,7);
  const catalog = await f.q('select code from card_types where pack_drop and (active_season() is null or season=active_season())');
  assert.ok(opened.body.cards.every((x) => catalog.some((c) => c.code===x.code) && x.grade>=1 && x.grade<=6));
});

test('lost reply retries return identical receipt across online/offline endpoints without charging twice', async (t) => {
  const f = await fixture(t);
  const first = await f.buy('lost-reply-01',{},'/api/pack/open');
  const state = await f.stats();
  const second = await f.buy('lost-reply-01');
  assert.equal(first.status,200);
  assert.deepEqual(second.body,first.body);
  assert.deepEqual(await f.stats(),state);
  assert.equal(state.balance,10);
  assert.equal(state.cards,7);
  assert.equal(state.receipts,1);
});

test('parallel retries of one operation charge once and return the same seven cards', async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({length:8},() => f.buy('parallel-same-01')));
  assert.ok(results.every((x)=>x.status===200));
  for (const r of results) assert.deepEqual(r.body,results[0].body);
  const state = await f.stats();
  assert.equal(state.balance,10); assert.equal(state.cards,7); assert.equal(state.receipts,1); assert.equal(state.transactions,1);
});

test('parallel different purchases cannot spend the same wallet balance', async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.buy('parallel-first-01'),f.buy('parallel-second-01')]);
  assert.deepEqual(results.map((x)=>x.status).sort(),[200,409]);
  const state = await f.stats();
  assert.equal(state.balance,10); assert.equal(state.cards,7); assert.equal(state.receipts,1);
});

test('failure during card grant rolls back balance, transaction, pack counter, claim and receipt; retry works', async (t) => {
  const f = await fixture(t);
  const before = await f.stats();
  await f.q(`create function test_card_failure() returns trigger language plpgsql as $$ begin raise exception 'injected card failure'; end $$;
    create trigger test_card_failure before insert on user_cards for each row execute function test_card_failure()`);
  assert.equal((await f.buy('rollback-card-01')).status,500);
  assert.deepEqual(await f.stats(),before);
  await f.q('drop trigger test_card_failure on user_cards');
  assert.equal((await f.buy('rollback-card-01')).status,200);
});

test('failure saving final receipt rolls back the entire purchase after card grant', async (t) => {
  const f = await fixture(t);
  const before = await f.stats();
  await f.q(`create function test_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'injected receipt failure'; end $$;
    create trigger test_receipt_failure before insert on card_operation_receipts for each row execute function test_receipt_failure()`);
  assert.equal((await f.buy('rollback-receipt-01')).status,500);
  assert.deepEqual(await f.stats(),before);
  await f.q('drop trigger test_receipt_failure on card_operation_receipts');
  assert.equal((await f.buy('rollback-receipt-01')).status,200);
});

test('offline daily limit is serialized and retries still succeed at the limit', async (t) => {
  const f = await fixture(t,200);
  const results = await Promise.all(Array.from({length:6},(_,i)=>f.buy('limit-offline-'+i)));
  assert.equal(results.filter((x)=>x.status===200).length,5);
  assert.equal(results.filter((x)=>x.status===429).length,1);
  const success = results.find((x)=>x.status===200);
  assert.deepEqual((await f.buy(success.body.operation_id)).body,success.body);
  assert.equal((await f.stats()).claims,5);
});

test('legacy applied nonce cannot charge again; the same nonce is scoped to the authenticated child', async (t) => {
  const f = await fixture(t);
  await f.q('insert into offline_pack_claims(child_id,nonce) values($1,$2)',[f.db.childA1.id,'legacy-nonce-01']);
  assert.equal((await f.buy('legacy-nonce-01')).status,409);
  assert.equal((await f.stats()).balance,30);
  assert.equal((await f.buy('legacy-nonce-01',{},'/api/pack/offline',f.db.childB1.code)).status,200);
  assert.equal((await f.stats()).balance,30);
});

test('queued merge is idempotent and reusing its id with another payload is a conflict', async (t) => {
  const f = await fixture(t);
  const [type] = await f.q('select id from card_types where pack_drop limit 1');
  await f.q('insert into user_cards(user_id,type_id,grade,qty) values($1,$2,1,6)',[f.db.childA1.id,type.id]);
  const body = {nonce:'merge-retry-01',type:type.id,grade:1};
  const merge = (b) => f.srv.api('/api/card/merge',post(f.db.childA1.code,b));
  const first = await merge(body);
  assert.equal(first.status,200);
  assert.deepEqual((await merge(body)).body,first.body);
  assert.equal((await f.q('select qty from user_cards where user_id=$1 and type_id=$2 and grade=1',[f.db.childA1.id,type.id]))[0].qty,3);
  assert.equal((await merge({...body,grade:2})).status,409);
  assert.equal((await f.buy(body.nonce)).status,409);
});

test('an already committed legacy merge is not executed again by queue migration',async(t)=>{
  const {createOutbox}=await import('../client/lib/offline-queue.mjs');
  const f=await fixture(t);
  const [type]=await f.q('select id from card_types where pack_drop limit 1');
  await f.q('insert into user_cards(user_id,type_id,grade,qty) values($1,$2,1,6)',[f.db.childA1.id,type.id]);
  await f.q('select merge_cards($1,$2,1)',[f.db.childA1.id,type.id]);
  const memory=new Map([['offq:child',JSON.stringify([{path:'/api/card/merge',body:{type:type.id,grade:1}}])]]);
  const box=createOutbox({storage:{getItem:(k)=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)},account:'child',locks:{request:(_,fn)=>fn()}});
  let sends=0;
  await box.sync(async(item)=>{sends++;const r=await f.srv.api(item.path,post(f.db.childA1.code,item.body));return {ok:r.status===200,status:r.status,body:r.body};},async()=>({}));
  assert.equal(sends,0);
  assert.equal((await f.q('select qty from user_cards where user_id=$1 and type_id=$2 and grade=1',[f.db.childA1.id,type.id]))[0].qty,3);
  assert.equal(box.read().queue[0].reviewRequired,true);
});

test('old clients receive retryable 503 instead of dropping legacy queues on 4xx',async(t)=>{
  const f=await fixture(t);
  for(const [path,body] of [['/api/card/merge',{type:'old',grade:1}],['/api/card/merge',{nonce:'old-synthetic-01',type:'old',grade:1}],['/api/pack/offline',{nonce:'old-pack-01',cards:[]}]] ) {
    const request={method:'POST',headers:{'x-child-code':f.db.childA1.code,'content-type':'application/json'},body:JSON.stringify(body)};
    assert.equal((await f.srv.api(path,request)).status,503);
  }
  assert.equal((await f.stats()).balance,30);
  assert.equal((await f.stats()).receipts,0);
});

test('restore barrier rejects lost-receipt retries and allows fresh generation exactly once', async (t) => {
  const f = await fixture(t,100);
  const first=await f.buy('restore-lost-01',{},'/api/pack/open');
  assert.equal(first.status,200);
  await f.srv.stop();
  // Restore has lost the receipt journal; retained funds/cards make a replay observable.
  await f.q('delete from card_operation_receipts');
  await f.q('delete from offline_pack_claims');
  const epoch='22222222-2222-4222-8222-222222222222';
  const srv=await startServer(f.db.url,{CARD_OPERATION_EPOCH:epoch});t.after(()=>srv.stop());
  const before=await f.stats();
  for(const path of ['/api/pack/open','/api/pack/offline','/api/card/merge']) {
    const reply=await srv.api(path,post(f.db.childA1.code,{nonce:'restore-lost-01',type:'00000000-0000-4000-8000-000000000000',grade:1}));
    assert.equal(reply.status,503);
  }
  assert.deepEqual(await f.stats(),before);
  const info=await srv.api('/api/card/epoch',{headers:{'x-child-code':f.db.childA1.code}});
  assert.equal(info.body.epoch,epoch);
  const request=post(f.db.childA1.code,{epoch,nonce:'restore-fresh-01'});
  const fresh=await srv.api('/api/pack/open',request);assert.equal(fresh.status,200);
  const after=await f.stats();
  assert.deepEqual((await srv.api('/api/pack/open',request)).body,fresh.body);
  assert.deepEqual(await f.stats(),after);
});

test('missing or invalid external recovery epoch closes card writes', async(t)=>{
  const f=await fixture(t);await f.srv.stop();
  for(const value of ['', 'not-a-generation']) {
    const srv=await startServer(f.db.url,{CARD_OPERATION_EPOCH:value});
    try {
      const before=await f.stats();
      assert.equal((await srv.api('/api/pack/open',post(f.db.childA1.code,{nonce:'closed-epoch-01'}))).status,503);
      assert.equal((await srv.api('/api/card/epoch',{headers:{'x-child-code':f.db.childA1.code}})).status,503);
      assert.deepEqual(await f.stats(),before);
    } finally {await srv.stop();}
  }
});

test('protocol 2 without a generation remains blocked without charging',async(t)=>{
  const f=await fixture(t);const before=await f.stats();
  assert.equal((await f.buy('no-generation-01',{epoch:null})).status,503);
  assert.deepEqual(await f.stats(),before);
});
