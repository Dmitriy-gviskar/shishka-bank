import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const {viewportState}=createRequire(import.meta.url)('../client/mobile-viewport.js');
const base={baseline:844,visible:430,editing:true,width:390};
test('keyboard is detected only for a focused editor and substantial mobile height loss',()=>{assert.equal(viewportState(base).keyboard,true);assert.equal(viewportState({...base,editing:false}).keyboard,false);assert.equal(viewportState({...base,visible:790}).keyboard,false);assert.equal(viewportState({...base,width:1024}).keyboard,false);});
test('pinch zoom never masquerades as an open keyboard',()=>assert.equal(viewportState({...base,scale:2}).keyboard,false));
test('invalid viewport measurements fail closed',()=>{for(const visible of [0,-1,NaN,Infinity])assert.equal(viewportState({...base,visible}).keyboard,false);});
test('visible height and pan offset are bounded and rounded',()=>{assert.deepEqual(viewportState({...base,visible:430.4,offset:-5}),{keyboard:true,height:430,top:0});assert.equal(viewportState({...base,offset:12.6}).top,13);});
test('resize while editing applies variables; blur restores normal navigation mode',()=>{
 const listeners={},vars=new Map();const doc={activeElement:{tagName:'INPUT',type:'text'},documentElement:{dataset:{},style:{setProperty:(k,v)=>vars.set(k,v),removeProperty:k=>vars.delete(k)}},addEventListener:(e,fn)=>listeners[e]=fn};
 const root={document:doc,innerHeight:844,innerWidth:390,requestAnimationFrame:fn=>fn(),setTimeout:fn=>fn(),addEventListener:(e,fn)=>listeners[e]=fn};
 vm.runInNewContext(readFileSync(new URL('../client/mobile-viewport.js',import.meta.url),'utf8'),{window:root});root.innerHeight=430;listeners.resize();assert.equal(doc.documentElement.dataset.keyboardOpen,'true');assert.equal(vars.get('--forest-visible-height'),'430px');doc.activeElement={tagName:'BODY'};listeners.focusout();assert.equal(doc.documentElement.dataset.keyboardOpen,'false');assert.equal(vars.size,0);
});
