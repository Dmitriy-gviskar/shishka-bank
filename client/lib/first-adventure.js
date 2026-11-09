/* Read-only guidance: rewards and operations stay in existing screens. */
(function(root){
  function firstAdventure(state, tasks, cards){
    if(!state || !Array.isArray(tasks) || !cards || !cards.pity || !Number.isInteger(cards.pity.opened) || cards.pity.opened<0) return null;
    const opened=Number(cards.pity.opened);
    if(opened>0) return null;
    const done=tasks.some(t=>t.status==='done');
    const ready=tasks.filter(t=>t.status==='open'&&!t.needs_photo).sort((a,b)=>(a.reward||0)-(b.reward||0))[0];
    const pending=tasks.some(t=>t.status==='pending_review'||t.status==='submitted');
    if(!done) return {step:1,title:'Начнём с доброго дела',text:ready ? `Выбери дело «${ready.title}». Сделай его в жизни и вернись отметить результат.` : pending ? 'Твоё дело на проверке. Пока ждёшь, можешь осмотреть лес — новое задание не обязательно.' : 'Загляни в дела и выбери то, что можешь сделать сейчас.',href:'quests.html',action:pending&&!ready?'Посмотреть дела':'Выбрать первое дело',hint:'Шишки за дело начисляются по обычным правилам.'};
    return {step:2,title:'Первое дело сделано!',text:'Теперь загляни в коллекцию: там можно открыть первый лесной пак. Его цена указана на кнопке открытия.',href:'collection.html',action:'В коллекцию',hint:'Открытие по твоему нажатию. Цена и награды остаются обычными.'};
  }
  if(typeof module==='object'&&module.exports) module.exports={firstAdventure};
  root.firstAdventureModel=firstAdventure;
})(typeof window==='undefined'?globalThis:window);
