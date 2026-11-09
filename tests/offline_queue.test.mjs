import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox } from '../client/lib/offline-queue.mjs';
class Storage {
  data = new Map(); fail = false;
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k,v) { if (this.fail) throw new Error('quota'); this.data.set(k,v); }
}
function mutex() {
  const tails = new Map();
  return { request(key,fn) {
    const next = (tails.get(key) || Promise.resolve()).catch(()=>{}).then(fn);
    tails.set(key,next); return next;
  } };
}
const operation = (id) => ({path:'/api/pack/open',body:{nonce:id}});
const ack = (item) => ({ok:true,status:200,body:{ok:true,operation_id:item.id,cards:[],balance:10}});
const refresh = async () => ({'/api/state':{balance:10},'/api/cards':{cards:[]}});
function fixture(account='child-a', storage=new Storage(), locks=mutex()) {
  return { storage,locks,box:createOutbox({storage,locks,account,makeId:()=> 'legacy-stable-01'}) };
}

test('all HTTP errors preserve the operation and following order, including after reload', async () => {
  for (const status of [400,401,403,409,429,500,503]) {
    const {box,storage,locks} = fixture();
    await box.enqueue(operation('first-op-01'));
    await box.enqueue(operation('second-op-01'));
    let calls=0;
    await box.sync(async()=>{calls++;return {ok:false,status,body:{error:'failure'}};},refresh);
    assert.equal(calls,1);
    const reopened=fixture('child-a',storage,locks).box;
    assert.deepEqual(reopened.read().queue.map((x)=>x.id),['first-op-01','second-op-01']);
    assert.equal(reopened.read().queue[0].status,status);
    await reopened.sync(async(item)=>ack(item),refresh);
    assert.equal(reopened.read().queue.length,0);
    assert.equal(reopened.read().completed.length,2);
  }
});

test('network failure and malformed acknowledgements never delete operations', async () => {
  const {box} = fixture();
  await box.enqueue(operation('network-op-01'));
  await box.sync(async()=>{throw new Error('offline');},refresh);
  assert.equal(box.read().queue[0].deferred,true);
  await box.sync(async()=>({ok:true,status:200,body:{ok:true}}),refresh);
  assert.equal(box.read().queue.length,1);
  await box.sync(async()=>({ok:true,status:200,body:{operation_id:'another-id'}}),refresh);
  assert.equal(box.read().queue.length,1);
});

test('storage failure cannot report an unsaved purchase or consume local funds', async () => {
  const {box,storage} = fixture();
  storage.fail=true;
  await assert.rejects(box.enqueue(operation('quota-op-01'),{'/api/state':{balance:10}}),/quota/);
  storage.fail=false;
  assert.equal(box.read().queue.length,0);
  assert.deepEqual(box.read().snapshots,{});
});

test('failure persisting acknowledgement keeps original nonce for safe retry', async () => {
  const {box,storage} = fixture();
  await box.enqueue(operation('ack-write-op-01'));
  await assert.rejects(box.sync(async(item)=>{storage.fail=true;return ack(item);},refresh),/quota/);
  storage.fail=false;
  assert.equal(box.read().queue[0].id,'ack-write-op-01');
  const ids=[];
  await box.sync(async(item)=>{ids.push(item.id);return ack(item);},refresh);
  assert.deepEqual(ids,['ack-write-op-01']);
  assert.equal(box.read().completed.length,1);
});

test('two tabs serialize sends and preserve a newly appended action', async () => {
  const {box,storage,locks}=fixture();
  const other=fixture('child-a',storage,locks).box;
  await box.enqueue(operation('tab-first-01'));
  let release;
  const gate=new Promise((r)=>{release=r;});
  let entered;
  const started=new Promise((r)=>{entered=r;});
  const sent=[];
  const first=box.sync(async(item)=>{sent.push(item.id);entered();await gate;return ack(item);},refresh);
  await started;
  const append=other.enqueue(operation('tab-second-01'));
  const second=other.sync(async(item)=>{sent.push(item.id);return ack(item);},refresh);
  release();
  await Promise.all([first,append,second]);
  assert.deepEqual(sent,['tab-first-01','tab-second-01']);
  assert.equal(box.read().completed.length,2);
});

test('legacy queue persists stable ids before sending and never sends client-chosen cards', async () => {
  const {storage,locks}=fixture();
  storage.setItem('offq:child-a',JSON.stringify([
    {path:'/api/pack/offline',body:{nonce:'old-pack-01',cards:[{type:'fake',grade:6}]}},
    {path:'/api/card/merge',body:{type:'a',grade:1}},
  ]));
  const box=fixture('child-a',storage,locks).box;
  await box.sync(async(item)=>{
    assert.ok(storage.getItem(box.key));
    assert.equal(item.body.cards,undefined);
    return {ok:false,status:401,body:{error:'login'}};
  },refresh);
  assert.equal(box.read().queue[0].body.nonce,'old-pack-01');
  assert.equal(box.read().queue[1].body.nonce,'legacy-stable-01');
});

test('account separation and malformed storage fail closed without clearing data', async () => {
  const {box,storage,locks}=fixture();
  await box.enqueue(operation('account-a-op-01'));
  const other=fixture('child-b',storage,locks).box;
  assert.equal(other.read().queue.length,0);
  storage.setItem(box.key,'{broken');
  await assert.rejects(box.sync(async(item)=>ack(item),refresh));
  assert.equal(storage.getItem(box.key),'{broken');
});

test('failed refresh preserves receipt and blocks new optimistic actions until reconciliation', async () => {
  const {box}=fixture();
  await box.enqueue(operation('refresh-op-01'));
  await box.sync(async(item)=>ack(item),async()=>{throw new Error('offline');});
  assert.equal(box.read().queue.length,0);
  assert.equal(box.read().completed.length,1);
  assert.equal(box.read().needsRefresh,true);
  await assert.rejects(box.enqueue(operation('refresh-op-02')),/синхронизируйте/);
  await box.sync(async()=>{throw new Error('must not resend');},refresh);
  assert.equal(box.read().needsRefresh,false);
});

test('unsupported locks fail before persisting or sending an action', async () => {
  const storage=new Storage();
  const box=createOutbox({storage,account:'child',locks:null});
  await assert.rejects(box.enqueue(operation('no-locks-op-01')),/браузер/);
  assert.equal(box.read().queue.length,0);
});

test('legacy token queue moves into a stable account key once and survives token changes', async () => {
  const storage=new Storage(),locks=mutex();
  storage.setItem('offq:old-device-token',JSON.stringify([{path:'/api/pack/offline',body:{nonce:'rotate-op-01',cards:[{grade:6}]}}]));
  const box=createOutbox({storage,locks,account:'CHILDCODE',aliases:['old-device-token']});
  await box.sync(async()=>({ok:false,status:401,body:{error:'login'}}),refresh);
  const rotated=createOutbox({storage,locks,account:'CHILDCODE',aliases:['new-device-token']});
  assert.equal(rotated.read().queue[0].id,'rotate-op-01');
  await rotated.sync(async(item)=>ack(item),refresh);
  assert.equal(rotated.read().completed.length,1);
});

test('snapshot preview is computed inside the lock, so concurrent reservations accumulate', async () => {
  const {box}=fixture();
  const reserve=(id)=>box.enqueue(operation(id),(data)=>({'/api/state':{balance:(data.snapshots['/api/state']?.balance??60)-20}}));
  await Promise.all([reserve('reserve-op-01'),reserve('reserve-op-02')]);
  assert.equal(box.read().queue.length,2);
  assert.equal(box.read().snapshots['/api/state'].balance,20);
});

test('unrecognized queued routes are preserved as an error and never sent', async () => {
  const {storage,locks}=fixture();
  storage.setItem('offq:child-a',JSON.stringify([{path:'/api/transfer',body:{nonce:'foreign-route-01'}}]));
  const box=fixture('child-a',storage,locks).box;
  let sent=0;
  await assert.rejects(box.sync(async()=>{sent++;return {};},refresh),/Неизвестная/);
  assert.equal(sent,0);
  assert.ok(storage.getItem('offq:child-a'));
});

test('legacy merges without original receipts are quarantined, never retried or dropped',async()=>{
  const {storage,locks}=fixture();
  storage.setItem('offq:child-a',JSON.stringify([{path:'/api/card/merge',body:{type:'already-merged',grade:1}}]));
  let sends=0;
  const box=fixture('child-a',storage,locks).box;
  await box.sync(async()=>{sends++;return {};},refresh);
  assert.equal(sends,0);
  assert.equal(box.read().queue.length,1);
  assert.equal(box.read().queue[0].reviewRequired,true);
  const reopened=fixture('child-a',storage,locks).box;
  await reopened.sync(async()=>{sends++;return {};},refresh);
  assert.equal(sends,0);
  assert.match(reopened.read().queue[0].error,/проверки ведущим/);
});

test('already migrated v2 legacy merge with a synthesized nonce is also quarantined',async()=>{
  const {box,storage}=fixture();
  storage.setItem(box.key,JSON.stringify({version:2,queue:[{id:'synthesized-01',path:'/api/card/merge',body:{nonce:'synthesized-01',type:'a',grade:1},legacy:true}],snapshots:{},completed:[],needsRefresh:false}));
  let sends=0;
  await box.sync(async()=>{sends++;return {};},refresh);
  assert.equal(sends,0);
  assert.equal(box.read().queue[0].reviewRequired,true);
});

test('quarantined history cannot accumulate new optimistic purchases behind it',async()=>{
  const {box,storage}=fixture();
  storage.setItem('offq:child-a',JSON.stringify([{path:'/api/card/merge',body:{type:'a',grade:1}}]));
  await assert.rejects(box.enqueue(operation('after-legacy-01')),/проверка старого слияния/);
  assert.equal(box.read().queue.length,1);
});

test('restored generation never restamps existing requests and rejected sync preserves queue',async()=>{
  const {box}=fixture();
  await box.enqueue({path:'/api/pack/open',body:{nonce:'old-generation-01',epoch:'old'}});
  await assert.rejects(box.enqueue({path:'/api/pack/open',body:{nonce:'new-generation-01',epoch:'new'}}),/проверки/);
  const result=await box.sync(async(item)=>{
    assert.equal(item.body.epoch,'old');
    return {ok:false,status:503,body:{error:'recovery review'}};
  },async()=>{throw new Error('must not refresh');});
  assert.equal(result.queue.length,1);assert.equal(result.queue[0].body.epoch,'old');
  assert.equal(box.read().queue[0].id,'old-generation-01');
});
