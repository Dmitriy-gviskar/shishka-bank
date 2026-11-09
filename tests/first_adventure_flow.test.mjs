import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setupDb,startServer} from './helpers/db.mjs';
const {firstAdventure}=createRequire(import.meta.url)('../client/lib/first-adventure.js');
test('fresh signup completes task, opens first pack once and retains every received card',async t=>{
 const db=await setupDb();const srv=await startServer(db.url);t.after(()=>srv.stop());
 const signup=await srv.api('/api/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Первый лес тест',tree:'pine',force:true})});assert.equal(signup.status,200);
 const headers={'x-device-token':signup.body.token,'content-type':'application/json'};assert.ok(signup.body.token);
 const get=async p=>(await srv.api(p,{headers})).body;
 const post=(p,b)=>srv.api(p,{method:'POST',headers,body:JSON.stringify(b)});
 const initial=await get('/api/state');assert.equal(initial.balance,30);
 const tasks=await get('/api/tasks');const beforeCards=await get('/api/cards');assert.equal(beforeCards.pity.opened,0);assert.equal(firstAdventure(initial,tasks,beforeCards).step,1);
 const task=tasks.filter(x=>x.status==='open'&&!x.needs_photo).sort((a,b)=>a.reward-b.reward)[0];assert.ok(task);
 const submitted=await post('/api/task/done',{id:task.id});assert.equal(submitted.status,200);assert.equal(submitted.body.approved,true);
 const earned=await get('/api/state');assert.equal(earned.balance,30+task.reward);assert.equal(firstAdventure(earned,await get('/api/tasks'),beforeCards).step,2);
 const repeat=await post('/api/task/done',{id:task.id});assert.equal(repeat.status,400);assert.equal((await get('/api/state')).balance,earned.balance);
 const {epoch}=await get('/api/card/epoch');const request={protocol:2,epoch,nonce:'first-adventure-flow-01'};
 const pack=await post('/api/pack/open',request);assert.equal(pack.status,200);assert.equal(pack.body.cards.length,7);
 const after=await get('/api/state');assert.equal(after.balance,earned.balance-20);
 const album=await get('/api/cards');assert.equal(album.pity.opened,1);assert.equal(firstAdventure(after,await get('/api/tasks'),album),null);
 for(const reward of pack.body.cards){const own=album.cards.find(c=>c.code===reward.code);assert.ok(own,reward.code);assert.ok(own.grades.some(g=>g.grade===reward.grade&&g.qty>0));}
 const retry=await post('/api/pack/open',request);assert.equal(retry.status,200);assert.deepEqual(retry.body,pack.body);assert.equal((await get('/api/state')).balance,after.balance);assert.equal((await get('/api/cards')).pity.opened,1);
});
