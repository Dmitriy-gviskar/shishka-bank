import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setupDb,startServer} from './helpers/db.mjs';
const {Pool}=createRequire(new URL('../client/package.json',import.meta.url))('pg');
const P=(k,b)=>({method:'POST',headers:{'x-child-code':k.code,'content-type':'application/json'},body:JSON.stringify(b)});
async function fixture(t){const db=await setupDb(),srv=await startServer(db.url),pool=new Pool({connectionString:db.url,max:12});t.after(async()=>{await srv.stop();await pool.end();});const q=async(s,p=[]) =>(await pool.query(s,p)).rows;return {db,srv,pool,q,post:(path,b,k=db.childA1)=>srv.api(path,P(k,b)),wallet:async(k=db.childA1)=>(await q('select balance from wallets where user_id=$1',[k.id]))[0].balance};}
async function started(f,game='count',k=f.db.childA1){const s=await f.post(game==='multiply'?'/api/game/start':`/api/game/${game}/start`,{},k);assert.equal(s.status,200,JSON.stringify(s.body));return s.body;}
async function answer(f,s,i=0,k=f.db.childA1,value){const [a]=await f.q('select challenge from game_attempts where id=$1',[s.attemptId]);return f.post('/api/game/answer',{attemptId:s.attemptId,index:i,answer:value??a.challenge.answers[i]},k);}
const finish=(f,s,k=f.db.childA1,extra={})=>f.post('/api/game/finish',{attemptId:s.attemptId,...extra},k);

async function concurrentLocked(f,k,actions,inventory=false){
 const c=await f.pool.connect();await c.query('begin');await c.query('select 1 from wallets where user_id=$1 for update',[k.id]);
 if(inventory)await c.query('select 1 from user_cards where user_id=$1 order by type_id,grade for update',[k.id]);
 const pending=actions.map(fn=>fn().catch(e=>({status:0,body:{error:e.message}})));
 try{
  let reached=false;for(let i=0;i<200;i++){
   const [r]=await f.q("select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()");
   if(r.n>=actions.length){reached=true;break;}await new Promise(r=>setTimeout(r,25));
  }assert.ok(reached,'all concurrent requests reached the controlled lock');
 }finally{await c.query('commit');c.release();}
 return Promise.all(pending);
}

test('unstarted, foreign, incomplete and expired games never pay; client score/expected cannot forge progress',async(t)=>{
 const f=await fixture(t);const bal=await f.wallet();
 assert.equal((await f.post('/api/game/finish',{game:'count',score:30})).status,503);
 const s=await started(f,'quiz');assert.equal((await finish(f,s)).status,409);
 assert.equal((await finish(f,s,f.db.childA2)).status,400);
 assert.equal((await f.post('/api/game/answer',{attemptId:s.attemptId,index:1,answer:'bad'})).status,409);
 const wrong=await f.post('/api/game/answer',{attemptId:s.attemptId,index:0,answer:'bad',expected:'bad'});assert.equal(wrong.body.correct,false);
 assert.equal((await f.post('/api/game/answer',{attemptId:s.attemptId,index:0,answer:'different'})).status,409);
 for(let i=1;i<8;i++)await answer(f,s,i,f.db.childA1,'bad');
 const done=await finish(f,s,f.db.childA1,{score:1000000});assert.equal(done.body.score,0);assert.equal(done.body.reward,0);assert.equal(await f.wallet(),bal);
 const expired=await started(f);await f.q("update game_attempts set expires_at=now()-interval '1 second' where id=$1",[expired.attemptId]);assert.equal((await finish(f,expired)).status,409);
});

test('all eleven games use private persisted challenges and verified answers, including opaque memory tiles',async(t)=>{
 const f=await fixture(t);
 for(const game of ['multiply','count','guess','memory','word','odd','number','compare','story','quiz','logic']){
  const s=await started(f,game);const [a]=await f.q('select challenge from game_attempts where id=$1',[s.attemptId]);
  if(game==='memory'){
   assert.equal(s.pairs,undefined);assert.equal(s.tiles.length,12);const groups=new Map();
   a.challenge.deck.forEach((code,i)=>groups.set(code,[...(groups.get(code)||[]),i]));let move=0;
   for(const tiles of groups.values())for(const tile of tiles){const r=await f.post('/api/game/memory/flip',{attemptId:s.attemptId,move:move++,tile});assert.equal(r.status,200);}
  }else{
   for(const q of s.questions||s.rounds){assert.equal(q.answer,undefined);assert.equal(q.oddCode,undefined);if(game==='guess'||game==='word')assert.equal(q.name,undefined);if(game==='number')assert.equal(q.n,undefined);}
   for(let i=0;i<a.challenge.answers.length;i++){await new Promise(r=>setTimeout(r,150));const r=await answer(f,s,i);assert.equal(r.body.correct,true,game);}
  }
  const done=await finish(f,s);assert.equal(done.status,200,JSON.stringify(done.body));assert.ok(done.body.reward>0,game);
 }
});

test('same and distinct concurrent game attempts grant exactly one daily reward; retry never increments score',async(t)=>{
 const f=await fixture(t),a=await started(f),b=await started(f);await answer(f,a);await answer(f,b);
 const before=await f.wallet();const replies=await concurrentLocked(f,f.db.childA1,[()=>finish(f,a),()=>finish(f,a),()=>finish(f,b)]);assert.ok(replies.every(r=>r.status===200));
 assert.equal(await f.wallet(),before+1);
 assert.equal((await f.q("select count(*)::int n from transactions where message='Мини-игра: блиц-счёт'"))[0].n,1);
 assert.equal((await f.q("select score from mini_games where child_id=$1 and game='count'",[f.db.childA1.id]))[0].score,1);
 assert.deepEqual((await finish(f,a)).body,replies[0].body);
});

test('game history failure rolls back progress, wallet, daily claim and receipt; retry pays once',async(t)=>{
 const f=await fixture(t),s=await started(f);await answer(f,s);const before=await f.wallet();
 await f.q("create function fail_game_history() returns trigger language plpgsql as $$begin if new.message like 'Мини-игра:%' then raise exception 'injected';end if;return new;end$$");
 await f.q('create trigger fail_game_history before insert on transactions for each row execute function fail_game_history()');
 assert.equal((await finish(f,s)).status,500);assert.equal(await f.wallet(),before);
 assert.equal((await f.q('select count(*)::int n from game_daily_claims'))[0].n,0);
 assert.equal((await f.q('select count(*)::int n from mini_games where child_id=$1',[f.db.childA1.id]))[0].n,0);
 assert.equal((await f.q('select result from game_attempts where id=$1',[s.attemptId]))[0].result,null);
 await f.q('drop trigger fail_game_history on transactions');assert.equal((await finish(f,s)).body.reward,1);assert.equal(await f.wallet(),before+1);
});

test('attempt receipt failure also rolls back reward and daily claim',async(t)=>{
 const f=await fixture(t),s=await started(f);await answer(f,s);const before=await f.wallet();
 await f.q("create function fail_game_receipt() returns trigger language plpgsql as $$begin if new.result is not null then raise exception 'injected';end if;return new;end$$");
 await f.q('create trigger fail_game_receipt before update on game_attempts for each row execute function fail_game_receipt()');
 assert.equal((await finish(f,s)).status,500);assert.equal(await f.wallet(),before);assert.equal((await f.q('select count(*)::int n from game_daily_claims'))[0].n,0);
});

test('count deadline, answer retries and restored generations are enforced before scoring',async(t)=>{
 const f=await fixture(t),s=await started(f);const r=await answer(f,s);assert.deepEqual((await answer(f,s)).body,r.body);
 await f.q("update game_attempts set answer_until=now()-interval '1 second' where id=$1",[s.attemptId]);assert.equal((await answer(f,s,1)).status,409);
 await f.q("update game_attempts set epoch='22222222-2222-4222-8222-222222222222' where id=$1",[s.attemptId]);
 assert.equal((await answer(f,s)).status,503);assert.equal((await finish(f,s)).status,503);
 assert.equal((await f.q('select count(*)::int n from game_daily_claims'))[0].n,0);
});

test('legacy reward today blocks a new payout; yesterday claim does not block today',async(t)=>{
 const f=await fixture(t),s=await started(f);await answer(f,s);
 await f.q("insert into transactions(circle_id,to_user,amount,type,message) values($1,$2,1,'reward','Мини-игра: блиц-счёт')",[f.db.circleA,f.db.childA1.id]);
 assert.equal((await finish(f,s)).body.already,true);
 await f.q("update transactions set created_at=now()-interval '1 day' where message='Мини-игра: блиц-счёт'");
 const n=await started(f);await answer(f,n);assert.equal((await finish(f,n)).body.reward,1);
});

test('memory move retry is stable, changed/reordered/repeated tile is rejected and client score ignored',async(t)=>{
 const f=await fixture(t),s=await started(f,'memory');const body={attemptId:s.attemptId,move:0,tile:0};const r=await f.post('/api/game/memory/flip',body);assert.equal(r.status,200);
 assert.deepEqual((await f.post('/api/game/memory/flip',body)).body,r.body);
 assert.equal((await f.post('/api/game/memory/flip',{...body,tile:1})).status,409);
 assert.equal((await f.post('/api/game/memory/flip',{...body,move:1})).status,409);
 assert.equal((await finish(f,s,f.db.childA1,{score:6})).body.score,0);
});

async function collector(f){const [a]=await f.q('select id from card_types where pack_drop limit 1');await f.q('insert into user_cards(user_id,type_id,grade,qty) values($1,$2,1,2)',[f.db.childA1.id,a.id]);await f.post('/api/gather/train',{type:a.id,grade:1});return a;}
test('parallel collector claims pay one daily reward; yesterday claim becomes claimable again',async(t)=>{
 const f=await fixture(t);await collector(f);const before=await f.wallet();const r=await concurrentLocked(f,f.db.childA1,[1,2,3].map(()=>()=>f.post('/api/gather/claim',{})));
 assert.equal(r.reduce((s,x)=>s+x.body.gained,0),1);assert.equal(await f.wallet(),before+1);
 await f.q("update card_gatherers set last_claim=(now() at time zone 'Europe/Moscow')::date-1");assert.equal((await f.post('/api/gather/claim',{})).body.gained,1);
});
test('collector history failure rolls back last_claim and wallet',async(t)=>{
 const f=await fixture(t);await collector(f);const before=await f.wallet();
 await f.q("create function fail_collection() returns trigger language plpgsql as $$begin if new.message='Сбор с карт' then raise exception 'injected';end if;return new;end$$");await f.q('create trigger fail_collection before insert on transactions for each row execute function fail_collection()');
 assert.equal((await f.post('/api/gather/claim',{})).status,400);assert.equal(await f.wallet(),before);assert.equal((await f.q('select last_claim from card_gatherers'))[0].last_claim,null);
});

test('concurrent gifts across card types and recipients respect the shared three-per-day limit',async(t)=>{
 const f=await fixture(t);const types=await f.q('select id from card_types where pack_drop limit 3');for(const a of types)await f.q('insert into user_cards(user_id,type_id,grade,qty) values($1,$2,1,10)',[f.db.childA1.id,a.id]);
 // Give the second recipient a verified friendship, independent of the circle.
 await f.q("insert into friendships(user_id,friend_id,status) values($1,$2,'accepted') on conflict do nothing",[f.db.childA1.id,f.db.childB1.id]);
 const gift=(type,to)=>f.post('/api/card/gift',{type,grade:1,to});
 for(let i=0;i<2;i++)assert.equal((await gift(types[0].id,f.db.childA2.id)).status,200);
 const r=await concurrentLocked(f,f.db.childA1,types.map((a,i)=>()=>gift(a.id,i===1?f.db.childB1.id:f.db.childA2.id)),true);
 assert.equal(r.filter(x=>x.status===200).length,1);assert.equal((await f.q('select count(*)::int n from card_gifts'))[0].n,3);
 await f.q("update card_gifts set created_at=now()-interval '1 day'");assert.equal((await gift(types[0].id,f.db.childA2.id)).status,200);
});
test('gift message failure rolls back both inventories and daily gift counter',async(t)=>{
 const f=await fixture(t);const [a]=await f.q('select id from card_types where pack_drop limit 1');await f.q('insert into user_cards(user_id,type_id,grade,qty) values($1,$2,1,5)',[f.db.childA1.id,a.id]);
 await f.q("create function fail_gift_message() returns trigger language plpgsql as $$begin raise exception 'injected';end$$");await f.q('create trigger fail_gift_message before insert on messages for each row execute function fail_gift_message()');
 assert.equal((await f.post('/api/card/gift',{type:a.id,grade:1,to:f.db.childA2.id})).status,400);
 assert.equal((await f.q('select qty from user_cards where user_id=$1',[f.db.childA1.id]))[0].qty,5);assert.equal((await f.q('select count(*)::int n from card_gifts'))[0].n,0);
});

test('missing recovery generation closes all new game starts',async(t)=>{
 const db=await setupDb(),srv=await startServer(db.url,{CARD_OPERATION_EPOCH:''});t.after(()=>srv.stop());
 assert.equal((await srv.api('/api/game/count/start',P(db.childA1,{}))).status,503);
});

test('a later level selection cannot increase an earlier multiplication attempt reward',async(t)=>{
 const f=await fixture(t);const a=await f.post('/api/game/start',{level:1});
 for(let i=0;i<10;i++)await answer(f,a.body,i);
 await f.post('/api/game/start',{level:3});const r=await finish(f,a.body);assert.equal(r.body.reward,3);
});

test('achievement write failure rolls back the complete game reward',async(t)=>{
 const f=await fixture(t),s=await started(f);await answer(f,s);const before=await f.wallet();
 await f.q("insert into achievements(code,title,description,metric,threshold,reward) values('review_atomic','Atomic','','count_score',1,0)");
 await f.q("create function fail_game_achievement() returns trigger language plpgsql as $$begin if new.code='review_atomic' then raise exception 'injected';end if;return new;end$$");
 await f.q('create trigger fail_game_achievement before insert on user_achievements for each row execute function fail_game_achievement()');
 assert.equal((await finish(f,s)).status,500);assert.equal(await f.wallet(),before);assert.equal((await f.q('select count(*)::int n from game_daily_claims'))[0].n,0);
 assert.equal((await f.q('select result from game_attempts where id=$1',[s.attemptId]))[0].result,null);
});
