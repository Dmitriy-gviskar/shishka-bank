import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setupDb,startServer} from './helpers/db.mjs';
const {Pool}=createRequire(new URL('../client/package.json',import.meta.url))('pg');
const P=(code,body)=>({method:'POST',headers:{'x-child-code':code,'content-type':'application/json'},body:JSON.stringify(body)});
for(const [game,n,reward] of [['quiz',8,5],['logic',5,6]])test(`${game}: private answers, verified completion and one daily reward`,async(t)=>{
 const db=await setupDb(),srv=await startServer(db.url),pool=new Pool({connectionString:db.url});t.after(async()=>{await srv.stop();await pool.end();});
 const started=await srv.api(`/api/game/${game}/start`,P(db.childA1.code,{}));assert.equal(started.status,200);assert.equal(started.body.questions.length,n);
 for(const q of started.body.questions){assert.equal(q.answer,undefined);if(game==='quiz'){assert.equal(q.options.length,4);assert.equal(new Set(q.options).size,4);}}
 const id=started.body.attemptId;
 const privateRow=(await pool.query('select challenge from game_attempts where id=$1',[id])).rows[0];
 for(let i=0;i<n;i++){
  const val=game==='quiz'&&i===n-1?'not an answer':privateRow.challenge.answers[i];
  const r=await srv.api('/api/game/answer',P(db.childA1.code,{attemptId:id,index:i,answer:val,expected:val}));assert.equal(r.body.correct,!(game==='quiz'&&i===n-1));
 }
 const done=await srv.api('/api/game/finish',P(db.childA1.code,{attemptId:id,score:999999}));assert.equal(done.status,200);assert.equal(done.body.reward,reward);
 assert.deepEqual((await srv.api('/api/game/finish',P(db.childA1.code,{attemptId:id}))).body,done.body);
 assert.equal((await srv.api('/api/game/finish',P(db.childA1.code,{game:'chess',score:3}))).status,400);
});
