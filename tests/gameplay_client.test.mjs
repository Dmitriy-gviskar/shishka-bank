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

test('quiz keeps server feedback visible until Next and marks both selected and correct options',async()=>{
 const calls=[];const ui=mount(async(path,b)=>{calls.push({path,b});return path.endsWith('/start')?{attemptId:'quiz-feedback',questions:Array.from({length:8},()=>({q:'question',options:['A','B','C','D']}))}:{correct:b.answer==='B',expected:'B'};});
 await ui.window._startQuiz();
 assert.equal(ui.get('gameNext').hidden,true);assert.ok(ui.get('gameLevels').children.every(b=>!b.dataset.result));
 ui.get('gameA').value='A';await ui.get('gameBtn').click();
 assert.equal(ui.get('gameLevels').children[0].dataset.result,'incorrect');assert.equal(ui.get('gameLevels').children[1].dataset.result,'correct');
 assert.ok(ui.get('gameLevels').children.every(b=>b.disabled));assert.equal(ui.get('gameNext').hidden,false);
 assert.match(ui.get('gameMsg').textContent,/Верный ответ: B/);assert.ok(ui.get('gameMsg').classList.contains('feedback-incorrect'));
 await ui.get('gameBtn').click();assert.equal(calls.length,2);
 await ui.get('gameNext').click();assert.equal(calls.length,2);assert.match(ui.get('gameProg').textContent,/Вопрос 2/);
 assert.equal(ui.get('gameNext').hidden,true);assert.ok(ui.get('gameLevels').children.every(b=>!b.dataset.result));
 ui.get('gameA').value='B';await ui.get('gameBtn').click();assert.match(ui.get('gameMsg').textContent,/Верно!/);assert.ok(ui.get('gameMsg').classList.contains('feedback-correct'));
 assert.equal(calls[2].b.index,1);assert.equal(calls[2].b.attemptId,'quiz-feedback');assert.equal(calls[2].b.expected,undefined);
});

test('quiz answer failure remains on the same question and retry preserves attempt and index',async()=>{
 let tries=0;const calls=[];const ui=mount(async(path,b)=>{calls.push({path,b});if(path.endsWith('/start'))return {attemptId:'quiz-retry',questions:Array.from({length:8},()=>({q:'question',options:['A','B']}))};return ++tries===1?{error:'Нет связи'}:{correct:true,expected:'B'};});
 await ui.window._startQuiz();ui.get('gameA').value='B';await ui.get('gameBtn').click();
 assert.equal(ui.get('gameNext').hidden,true);assert.match(ui.get('gameMsg').textContent,/Нет связи/);assert.ok(ui.get('gameLevels').children.every(b=>b.disabled===false));
 await ui.get('gameBtn').click();assert.equal(calls[1].b.attemptId,calls[2].b.attemptId);assert.equal(calls[1].b.index,calls[2].b.index);assert.equal(ui.get('gameNext').hidden,false);
});

test('eighth quiz answer stays readable before results and reward still uses the server attempt',async()=>{
 const calls=[];const ui=mount(async(path,b)=>{calls.push({path,b});if(path.endsWith('/start'))return {attemptId:'quiz-complete',questions:Array.from({length:8},()=>({q:'question',options:['A','B']}))};if(path.endsWith('/answer'))return {correct:true,expected:'B'};return {ok:true,reward:6,balance:36};});
 await ui.window._startQuiz();for(let i=0;i<8;i++){ui.get('gameA').value='B';await ui.get('gameBtn').click();if(i<7)await ui.get('gameNext').click();}
 assert.equal(calls.filter(c=>c.path.endsWith('/answer')).length,8);assert.equal(calls.filter(c=>c.path.endsWith('/finish')).length,0);
 assert.equal(ui.get('gameDone').classList.contains('on'),false);assert.equal(ui.get('gameNext').textContent,'Посмотреть результат →');assert.match(ui.get('gameMsg').textContent,/Верно!/);
 await ui.get('gameNext').click();assert.equal(ui.get('gameResult').textContent,'Верно: 8 из 8');
 await ui.get('gameClaim').click();const finish=calls.find(c=>c.path.endsWith('/finish'));assert.equal(finish.b.attemptId,'quiz-complete');assert.equal(finish.b.score,undefined);assert.equal(ui.get('topBal').textContent,36);
});

test('quiz shows pending state without inventing correctness and blocks repeated requests while waiting',async()=>{
 let release;const calls=[];const ui=mount(async(path,b)=>{calls.push({path,b});if(path.endsWith('/start'))return {attemptId:'quiz-pending',questions:Array.from({length:8},()=>({q:'question',options:['A','B']}))};return new Promise(resolve=>{release=resolve;});});
 await ui.window._startQuiz();ui.get('gameA').value='A';const waiting=ui.get('gameBtn').click();
 assert.match(ui.get('gameMsg').textContent,/Проверяем/);assert.equal(ui.get('gameLevels').children[0].dataset.result,'pending');assert.equal(ui.get('gameNext').hidden,true);
 await ui.get('gameBtn').click();assert.equal(calls.length,2);release({correct:false,expected:'B'});await waiting;
 assert.equal(ui.get('gameLevels').children[0].dataset.result,'incorrect');assert.equal(ui.get('gameLevels').children[1].dataset.result,'correct');
});
