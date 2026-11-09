/* Presentation state only; permissions and rewards remain server-controlled. */
(function(root){function familyCycle(tasks,family){
 const own=Array.isArray(tasks)?tasks.filter(t=>t.kind==='family'):[];
 const count=statuses=>own.filter(t=>statuses.includes(t.status)).length;
 return {open:count(['open','rejected']),waiting:count(['submitted','pending_review']),done:count(['done']),total:own.length,kids:Array.isArray(family?.kids)?family.kids.length:0,review:Array.isArray(family?.pending)?family.pending.length:0};
}if(typeof module==='object'&&module.exports)module.exports={familyCycle};root.ShishkaFamilyCycle=familyCycle;})(typeof window==='undefined'?globalThis:window);
