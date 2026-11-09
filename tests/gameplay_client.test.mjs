import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../client/games.js',import.meta.url),'utf8');
function mount(api){
 const nodes=new Map();
 class Node{
  constructor(tag='div'){this.tag=tag;this.style={};this.dataset={};this.children=[];this.value='';this.textContent='';this._html='';const classes=new Set();this.classList={add:(...x)=>x.forEach(c=>classes.add(c)),remove:(...x)=>x.forEach(c=>classes.delete(c)),contains:x=>classes.has(x)};}
  set innerHTML(v){this._html=v;this.children=[];}get innerHTML(){return this._html;}
  appendChild(n){this.children.push(n);}setAttribute(){}removeAttribute(){}addEventListener(){}focus(){}blur(){}
  querySelectorAll(tag){return this.children.filter(n=>tag==='button'?n.tag==='button':true);}
  querySelector(selector){if(!this.face)this.face=new Node();return this.face;}
  click(){return this.onclick?.();}
 }
 const get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
 const doc={getElementById:get,createElement:tag=>new Node(tag),querySelector:()=>get('phone'),querySelectorAll:()=>get('gameLevels').children};
 const window={api,esc:String,cardUrl:code=>'/cards/'+code};
 const ctx={window,document:doc,location:{pathname:'/home'},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,requestAnimationFrame:()=>1};vm.createContext(ctx);vm.runInContext(source,ctx);window.runGames();return {window,get};
}

test('count UI verifies answers and sends attempt id, never a claimed score; failed finish remains retryable',async()=>{
 const calls=[];let finishes=0;
 const ui=mount(async(path,b)=>{calls.push({path,b});if(path.endsWith('/start'))return {attemptId:'attempt-count',questions:[{a:2,op:'+',b:3}],duration:30};if(path.endsWith('/answer'))return {correct:true,expected:'5'};return ++finishes===1?{error:'temporary'}:{ok:true,reward:1,balance:31};});
 await ui.window._startCount();ui.get('gameA').value='5';await ui.get('gameBtn').click();await ui.get('gameClaim').click();await ui.get('gameClaim').click();
 const answer=calls.find(x=>x.path.endsWith('/answer'));assert.equal(answer.b.attemptId,'attempt-count');assert.equal(answer.b.index,0);assert.equal(answer.b.answer,5);assert.equal(answer.b.expected,undefined);
 const done=calls.filter(x=>x.path.endsWith('/finish'));assert.equal(done.length,2);assert.equal(done[0].b.score,undefined);assert.equal(done[1].b.attemptId,done[0].b.attemptId);assert.equal(ui.get('topBal').textContent,31);
});

test('quiz UI works with redacted answer keys and displays the server result',async()=>{
 const calls=[];const ui=mount(async(path,b)=>{calls.push({path,b});return path.endsWith('/start')?{attemptId:'quiz-attempt',questions:Array.from({length:8},()=>({q:'question',options:['A','B','C','D']}))}:{correct:false,expected:'B'};});
 await ui.window._startQuiz();ui.get('gameA').value='A';await ui.get('gameBtn').click();assert.match(ui.get('gameMsg').textContent,/B/);
 assert.equal(calls[1].b.attemptId,'quiz-attempt');assert.equal(calls[1].b.expected,undefined);
 await ui.get('gameBtn').click();assert.equal(calls.length,2,'double click during feedback must not answer the next unseen question');
});

test('memory UI sends ordered opaque tile moves and retries the same move after a lost response',async()=>{
 const calls=[];let flips=0;const ui=mount(async(path,b)=>{calls.push({path,b});if(path.endsWith('/start'))return {attemptId:'memory-attempt',tiles:[0,1],duration:90};if(++flips===1)return {error:'lost response'};return {code:'fox',matched:flips===3};});
 await ui.window._startMemory();const cards=ui.get('gameQ').children[0].children;assert.ok(cards.every(c=>!c.innerHTML.includes('<img')));
 await cards[0].click();await cards[0].click();await cards[1].click();const moves=calls.filter(x=>x.path.endsWith('/flip')).map(x=>x.b);assert.deepEqual(moves.map(x=>x.move),[0,0,1]);assert.deepEqual(moves.map(x=>x.tile),[0,0,1]);assert.ok(moves.every(x=>x.attemptId==='memory-attempt'));
});
