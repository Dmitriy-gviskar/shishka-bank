import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context={};vm.createContext(context);vm.runInContext(await readFile(new URL('../client/lib/card-presentation.js',import.meta.url),'utf8'),context);
const {rarity,pack}=context.ShishkaCardPresentation;
test('reward presentation preserves every server card and its flags without mutating receipts',()=>{
 const cards=Object.freeze([Object.freeze({code:'a',grade:2,is_new:true,qty:1}),Object.freeze({code:'b',grade:6,is_new:false,qty:2}),Object.freeze({code:'c',grade:2,is_new:false,qty:1})]);
 const result=pack(cards,[{grade:6,name:'Золотая',color:'#ffc21f'}]);
 assert.deepEqual(Array.from(result,c=>c.code),['b','a','c']);assert.equal(result.length,cards.length);
 assert.equal(result[0].is_new,false);assert.equal(result[0].qty,2);assert.equal(result[0].rarity.name,'Золотая');assert.equal(result[0].rarity.rank,'6 / 6');
 assert.deepEqual(cards.map(c=>c.code),['a','b','c']);assert.equal(cards[0].rarity,undefined);
});
test('rarity has a readable level independent of color and preserves authoritative names',()=>{
 assert.equal(rarity(4,[{grade:4,name:'Эпическая',color:'#a020f0'}]).rank,'4 / 6');
 assert.equal(rarity(1).name,'Обычная');assert.equal(rarity(5).name,'Легендарная');
 assert.equal(rarity(4,[{grade:4,name:'Название сервера',color:'red; display:none'}]).name,'Название сервера');
 assert.equal(rarity(4,[{grade:4,color:'red; display:none'}]).color,'#8c9870');
 assert.equal(rarity(99).rank,'—');assert.equal(rarity(99).name,'Неизвестная редкость');
});
