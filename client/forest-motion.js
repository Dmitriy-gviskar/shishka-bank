/* Optional decoration only. No requests, rewards or gameplay state. */
(function(root){
  const enabled=(preference,reduced)=>preference!=='off'&&!reduced;
  if(typeof module==='object'&&module.exports) module.exports={enabled};
  if(!root.document) return;
  const key='shishka:forest-motion:v1';
  let media;try{media=root.matchMedia('(prefers-reduced-motion: reduce)');}catch{media={matches:false};}
  let preference;try{preference=root.localStorage.getItem(key);}catch{}
  function paint(){
    const on=enabled(preference,media.matches);
    document.documentElement.dataset.forestMotion=on?'on':'off';
    const input=document.getElementById('forestMotionToggle');
    if(input){input.checked=on;input.disabled=!!media.matches;}
    const note=document.getElementById('forestMotionNote');
    if(note)note.textContent=media.matches?'Движение отключено в настройках устройства.':'Мягкое движение дерева и Духа. Можно выключить в любой момент.';
    if(!on)document.querySelectorAll('.forest-reward-pulse,.rain').forEach(el=>{if(el.classList.contains('rain'))el.remove();else el.classList.remove('forest-reward-pulse');});
  }
  root.forestMotionEnabled=()=>enabled(preference,media.matches);
  root.runForestMotion=function(){
    paint();const input=document.getElementById('forestMotionToggle');
    if(input)input.onchange=()=>{preference=input.checked?'on':'off';try{root.localStorage.setItem(key,preference);}catch{}paint();};
  };
  root.forestRewardPulse=function(){
    if(!root.forestMotionEnabled())return;
    const el=document.querySelector('.wallet-card');if(!el)return;
    el.classList.remove('forest-reward-pulse');void el.offsetWidth;el.classList.add('forest-reward-pulse');
    root.setTimeout(()=>el.classList.remove('forest-reward-pulse'),900);
  };
  if(media.addEventListener)media.addEventListener('change',paint);else if(media.addListener)media.addListener(paint);
  root.addEventListener('storage',e=>{if(e.key===key||e.key===null){try{preference=root.localStorage.getItem(key);}catch{}paint();}});
  paint();
})(typeof window==='undefined'?globalThis:window);
