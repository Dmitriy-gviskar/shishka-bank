/* Visible viewport adaptation only; never submits inputs or alters game state. */
(function(root){
 function viewportState({baseline,visible,editing,width,scale=1,offset=0}){
  const valid=Number.isFinite(visible)&&visible>0&&Number.isFinite(baseline)&&baseline>0;
  const keyboard=valid&&editing&&width<=600&&scale<=1.05&&baseline-visible>120;
  return {keyboard:!!keyboard,height:keyboard?Math.round(visible):null,top:keyboard?Math.max(0,Math.round(offset||0)):0};
 }
 if(typeof module==='object'&&module.exports)module.exports={viewportState};
 if(!root.document)return;
 const doc=root.document,vv=root.visualViewport;
 let baseline=root.innerHeight,lastWidth=root.innerWidth,queued=false;
 function editable(el){return !!el&&!el.disabled&&!el.readOnly&&(el.tagName==='TEXTAREA'||el.isContentEditable||(el.tagName==='INPUT'&&!['button','submit','reset','checkbox','radio','range','file','color','hidden'].includes(el.type)));}
 function paint(){
  queued=false;const editing=editable(doc.activeElement);
  if(!editing||root.innerWidth!==lastWidth)baseline=root.innerHeight;
  lastWidth=root.innerWidth;
  const state=viewportState({baseline,visible:vv?vv.height:root.innerHeight,editing,width:root.innerWidth,scale:vv?vv.scale:1,offset:vv?vv.offsetTop:0});
  doc.documentElement.dataset.keyboardOpen=state.keyboard?'true':'false';
  if(state.keyboard){doc.documentElement.style.setProperty('--forest-visible-height',state.height+'px');doc.documentElement.style.setProperty('--forest-visible-top',state.top+'px');}
  else{doc.documentElement.style.removeProperty('--forest-visible-height');doc.documentElement.style.removeProperty('--forest-visible-top');}
 }
 function schedule(){if(queued)return;queued=true;root.requestAnimationFrame(paint);}
 root.runMobileViewport=paint;
 root.addEventListener('resize',schedule);
 doc.addEventListener('focusin',schedule);
 doc.addEventListener('focusout',()=>root.setTimeout(schedule,0));
 if(vv){vv.addEventListener('resize',schedule);vv.addEventListener('scroll',schedule);}
 paint();
})(typeof window==='undefined'?globalThis:window);
