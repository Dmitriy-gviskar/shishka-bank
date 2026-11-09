import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {familyCycle}=createRequire(import.meta.url)('../client/lib/family-cycle.js');
test('family counters separate action, review and accepted result',()=>{const g=familyCycle(['open','rejected','submitted','pending_review','done'].map(status=>({kind:'family',status})),{});assert.deepEqual([g.open,g.waiting,g.done,g.total],[2,2,1,5]);});
test('daily and camp tasks do not inflate family progress',()=>{const g=familyCycle([{kind:'day',status:'done'},{kind:'daily',status:'open'},{kind:'family',status:'submitted'}],{});assert.equal(g.total,1);assert.equal(g.done,0);});
test('pending review is never counted as accepted or awarded',()=>{const g=familyCycle([{kind:'family',status:'submitted'}],{});assert.equal(g.done,0);assert.equal(g.waiting,1);});
test('guardian summary uses only server-returned kids and pending rows',()=>{const g=familyCycle([],{kids:[{id:1}],pending:[{id:2},{id:3}]});assert.equal(g.kids,1);assert.equal(g.review,2);});
test('missing or failed data produces no invented family progress',()=>{const g=familyCycle({error:'offline'},{error:'unauthorized'});assert.deepEqual(g,{open:0,waiting:0,done:0,total:0,kids:0,review:0});});
