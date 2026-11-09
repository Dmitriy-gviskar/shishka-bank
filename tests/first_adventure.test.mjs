import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {firstAdventure}=require('../client/lib/first-adventure.js');
const state={balance:30};const cards={pity:{opened:0}};
test('new player is guided to a real task before the first pack',()=>{const m=firstAdventure(state,[{title:'Полить цветок',status:'open',needs_photo:false}],cards);assert.equal(m.step,1);assert.equal(m.href,'quests.html');assert.match(m.text,/Полить цветок/);});
test('completed server task moves guidance to collection',()=>{const m=firstAdventure(state,[{status:'done'}],cards);assert.equal(m.step,2);assert.equal(m.href,'collection.html');});
test('pending review does not pretend reward has been issued',()=>{const m=firstAdventure(state,[{status:'pending_review'}],cards);assert.equal(m.step,1);assert.match(m.text,/на проверке/);});
test('photo task is never presented as an immediately completed task',()=>{const m=firstAdventure(state,[{title:'Фото',status:'open',needs_photo:true}],cards);assert.doesNotMatch(m.text,/«Фото»/);});
test('no tasks still leaves a usable route without fake rewards',()=>assert.equal(firstAdventure(state,[],cards).href,'quests.html'));
test('any previously opened pack suppresses beginner guidance',()=>{for(const opened of [1,2,50])assert.equal(firstAdventure(state,[],{pity:{opened}}),null);});
test('invalid or unavailable data does not present misleading progress',()=>{for(const c of [null,{}, {pity:{}},{pity:{opened:'bad'}}])assert.equal(firstAdventure(state,[],c),null);assert.equal(firstAdventure(null,[],cards),null);assert.equal(firstAdventure(state,{error:'offline'},cards),null);});
test('guidance derives progress without mutating account or tasks',()=>{const s=Object.freeze({...state});const ts=Object.freeze([Object.freeze({status:'done'})]);const cs=Object.freeze({pity:Object.freeze({opened:0})});assert.equal(firstAdventure(s,ts,cs).step,2);assert.equal(s.balance,30);});

// Regression: a previously visible guide must disappear without leaving the home CTA hidden.
test('completed route clears visible guidance and restores the normal home action',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const box={isConnected:true,hidden:false};const next={hidden:true};
 const window={firstAdventureModel:()=>null,api:async()=>({})};
 const document={getElementById:id=>id==='firstAdventure'?box:id==='nextDeed'?next:null};
 vm.runInNewContext(readFileSync(new URL('../client/first-adventure.js',import.meta.url),'utf8'),{window,document});
 await window.runFirstAdventure();assert.equal(box.hidden,true);assert.equal(next.hidden,false);
});
