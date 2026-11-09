import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {enabled}=require('../client/forest-motion.js');
test('ambient animation respects saved opt-out and system reduced motion',()=>{assert.equal(enabled(null,false),true);assert.equal(enabled('off',false),false);assert.equal(enabled('on',true),false);assert.equal(enabled(null,true),false);});
function setup({reduced=false,blocked=false}={}){
 const input={checked:false,disabled:false};const note={};const document={documentElement:{dataset:{}},getElementById:id=>id==='forestMotionToggle'?input:note,querySelectorAll:()=>[],querySelector:()=>null};
 let saved=null,listener;const media={matches:reduced,addEventListener:(e,fn)=>listener=fn};
 const window={document,localStorage:{getItem(){if(blocked)throw Error('denied');return saved;},setItem(k,v){if(blocked)throw Error('denied');saved=v;}},matchMedia:()=>media,addEventListener(){},setTimeout(){}};
 vm.runInNewContext(readFileSync(new URL('../client/forest-motion.js',import.meta.url),'utf8'),{window,document});
 return {window,document,input,note,media,change:()=>listener(),saved:()=>saved};
}
test('switch applies immediately and survives screen reinitialization',()=>{const s=setup();s.window.runForestMotion();s.input.checked=false;s.input.onchange();assert.equal(s.saved(),'off');assert.equal(s.document.documentElement.dataset.forestMotion,'off');s.window.runForestMotion();assert.equal(s.input.checked,false);});
test('system setting changes disable motion and its switch',()=>{const s=setup();s.window.runForestMotion();s.media.matches=true;s.change();assert.equal(s.window.forestMotionEnabled(),false);assert.equal(s.input.disabled,true);assert.equal(s.input.checked,false);});
test('blocked browser storage never prevents screen controls or safe reward feedback',()=>{const s=setup({blocked:true});s.window.runForestMotion();s.input.checked=false;assert.doesNotThrow(()=>s.input.onchange());assert.equal(s.window.forestMotionEnabled(),false);assert.doesNotThrow(()=>s.window.forestRewardPulse());});
