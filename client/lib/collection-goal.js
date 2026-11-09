/* Read-only collection goals, derived from authoritative card inventory. */
(function(root){
 function collectionGoal(data){
  if(!data||data.peek||!Array.isArray(data.cards))return null;
  const cards=data.cards.filter(c=>c.category!=='special');
  const ranks=c=>new Set((c.grades||[]).filter(g=>Number(g.qty)>0&&Number.isInteger(g.grade)&&g.grade>=1&&g.grade<=6).map(g=>g.grade));
  const progress=cards.map(c=>({card:c,have:ranks(c)}));
  const incomplete=progress.filter(p=>p.have.size>0&&p.have.size<6).sort((a,b)=>b.have.size-a.have.size||String(a.card.code).localeCompare(String(b.card.code)));
  const target=incomplete[0];
  if(!target)return {kind:progress.length&&progress.every(p=>p.have.size===6)?'complete':'empty',complete:progress.filter(p=>p.have.size===6).length,total:cards.length};
  const c=target.card,missing=[1,2,3,4,5,6].filter(g=>!target.have.has(g));
  const seasonCards=progress.filter(p=>p.card.season===c.season);
  const season=(data.seasons||[]).find(s=>s.code===c.season);
  return {kind:'target',id:c.id,name:c.name,have:target.have.size,missing,missingNames:missing.map(g=>(data.rarities||[]).find(r=>r.grade===g)?.name||`Редкость ${g}`),season:season?.name||null,seasonCells:seasonCards.reduce((n,p)=>n+p.have.size,0),seasonTotal:seasonCards.length*6};
 }
 if(typeof module==='object'&&module.exports)module.exports={collectionGoal};
 root.ShishkaCollectionGoal=collectionGoal;
})(typeof window==='undefined'?globalThis:window);
