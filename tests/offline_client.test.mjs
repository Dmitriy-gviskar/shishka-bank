import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as queue from '../client/lib/offline-queue.mjs';
import * as cards from '../client/lib/offline-cards.mjs';
const full=await readFile(new URL('../client/app.js',import.meta.url),'utf8');
const source=full.slice(full.indexOf('function offWho()'),full.indexOf('if (!window.__offOnlineHook)'))
  .replaceAll("import('./lib/offline-queue.mjs')",'Promise.resolve(__modules.queue)')
  .replaceAll("import('./lib/offline-cards.mjs')",'Promise.resolve(__modules.cards)');
class Storage {
  constructor(){this.values=new Map();}
  getItem(k){return this.values.get(k)??null;}
  setItem(k,v){this.values.set(k,v);}
  removeItem(k){this.values.delete(k);}
}
function mount(fetcher,storage=new Storage()) {
  storage.setItem('card-epoch:CHILD-A','11111111-1111-4111-8111-111111111111');storage.setItem('childCode','CHILD-A');storage.setItem('deviceToken','token-a');
  if(!storage.getItem('off:CHILD-A:/api/state')) storage.setItem('off:CHILD-A:/api/state',JSON.stringify({balance:60}));
  const elements=new Map();
  const node=()=>({style:{},setAttribute(){},appendChild(){},replaceChildren(){}});
  const ctx={localStorage:storage,sessionStorage:new Storage(),navigator:{locks:{request:(_,fn)=>fn()}},
    window:{dispatchEvent(){}},document:{getElementById:(id)=>elements.get(id),createElement:()=>node(),body:{appendChild(x){elements.set(x.id,x);}}},
    crypto:{randomUUID:()=> 'client-operation-01'},AbortSignal,CustomEvent:class {},fetch:(path,opt)=>path==='/api/card/epoch'?Promise.resolve(response({epoch:'11111111-1111-4111-8111-111111111111'})):fetcher(path,opt),__modules:{queue,cards}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,storage,act:(body={})=>ctx.performCardAction('/api/pack/open',body,{'x-device-token':'token-a'}),
    flush:()=>ctx.flushOfflineQueue({'x-device-token':'token-a'})};
}
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const canonical=(path)=>response(path==='/api/state'?{balance:40}:path==='/api/cards'?{cards:[{code:'server-card'}]}:[]);

test('client saves nonce and reservation before network; offline pack has no invented cards',async()=>{
  let ui;
  ui=mount(async(path,opt)=>{
    const saved=JSON.parse(ui.storage.getItem('offv2:CHILD-A'));
    assert.equal(saved.queue[0].body.nonce,JSON.parse(opt.body).nonce);
    assert.equal(saved.snapshots['/api/state'].balance,40);
    throw new Error('network');
  });
  const result=await ui.act();
  assert.equal(result.pending,true);
  assert.equal(result.cards.length,0);
  const pending=JSON.parse(ui.storage.getItem('offv2:CHILD-A')).queue[0];
  assert.equal(pending.body.cards,undefined);
  assert.equal(pending.deferred,true);
});

test('client retries uncertain purchase with the same nonce and refreshes canonical cards/balance',async()=>{
  let online=false;const sent=[];
  const ui=mount(async(path,opt)=>{
    if(!online){sent.push(JSON.parse(opt.body).nonce);throw new Error('reply lost after commit');}
    if(opt.method==='POST'){
      const body=JSON.parse(opt.body);sent.push(body.nonce);
      assert.equal(path,'/api/pack/offline');
      return response({ok:true,operation_id:body.nonce,cards:[{code:'server-card',grade:1}],balance:40});
    }
    return canonical(path);
  });
  await ui.act();online=true;
  await ui.flush();
  assert.deepEqual(sent,['client-operation-01','client-operation-01']);
  const record=JSON.parse(ui.storage.getItem('offv2:CHILD-A'));
  assert.equal(record.queue.length,0);
  assert.equal(record.completed.length,1);
  assert.equal(record.needsRefresh,false);
  assert.equal(JSON.parse(ui.storage.getItem('off:CHILD-A:/api/state')).balance,40);
  assert.equal(JSON.parse(ui.storage.getItem('off:CHILD-A:/api/cards')).cards[0].code,'server-card');
});

test('client leaves insufficient-funds conflict in durable queue and reports it',async()=>{
  const ui=mount(async()=>response({error:'Не хватает шишек'},409));
  const result=await ui.act();
  assert.match(result.error,/остаётся в очереди/);
  const record=JSON.parse(ui.storage.getItem('offv2:CHILD-A'));
  assert.equal(record.queue.length,1);
  assert.equal(record.queue[0].status,409);
});

test('client storage failure prevents any purchase request',async()=>{
  let sends=0;
  const ui=mount(async()=>{sends++;return response({});});
  const original=ui.storage.setItem.bind(ui.storage);
  ui.storage.setItem=(key,value)=>{if(key.startsWith('offv2:'))throw new Error('storage unavailable');original(key,value);};
  const result=await ui.act();
  assert.ok(result.error);
  assert.equal(sends,0);
});

test('new handshake cannot promote an existing queue without a recovery generation',async()=>{
  const storage=new Storage();
  storage.setItem('offv2:CHILD-A',JSON.stringify({version:2,queue:[{id:'pre-restore-01',path:'/api/pack/open',body:{protocol:2,nonce:'pre-restore-01'}}],snapshots:{},completed:[],needsRefresh:false}));
  let posts=0;
  const ui=mount(async()=>{posts++;return response({error:'review required'},503);},storage);
  const action=await ui.act();
  assert.match(action.error,/проверки/);
  assert.equal(posts,0);
  await ui.flush();
  const saved=JSON.parse(storage.getItem('offv2:CHILD-A'));
  assert.equal(saved.queue.length,1);assert.equal(saved.queue[0].body.epoch,undefined);
  assert.equal(saved.queue[0].id,'pre-restore-01');
});
