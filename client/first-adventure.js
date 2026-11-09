// Guidance only: never submits a task, buys a pack or changes the balance.
window.runFirstAdventure = async function(){
  const box=document.getElementById('firstAdventure');
  if(!box || !window.api || !window.firstAdventureModel) return;
  try{
    const [state,tasks,cards]=await Promise.all([window.api('/api/state'),window.api('/api/tasks'),window.api('/api/cards')]);
    if(!box.isConnected) return;
    const model=window.firstAdventureModel(state,tasks,cards);
    if(!model){box.hidden=true;const next=document.getElementById('nextDeed');if(next)next.hidden=false;return;}
    const screen=box.dataset.screen;
    if(screen==='home'){const next=document.getElementById('nextDeed');if(next)next.hidden=true;}

    const label=document.createElement('div');label.className='adventure-kicker';label.textContent='Твоё первое приключение';
    const steps=document.createElement('ol');steps.className='adventure-steps';
    ['Доброе дело','Первый пак','Лесной житель'].forEach((text,i)=>{const li=document.createElement('li');li.textContent=text;if(i+1===model.step)li.setAttribute('aria-current','step');if(i+1<model.step)li.className='complete';steps.appendChild(li);});
    const title=document.createElement('h2');title.textContent=model.title;
    const text=document.createElement('p');text.textContent=model.text;
    const hint=document.createElement('small');hint.textContent=model.hint;
    box.replaceChildren(label,steps,title,text);
    if(screen==='collection'){
      title.textContent='Познакомимся с лесными жителями';text.textContent='Открой пак кнопкой внизу. После открытия рассмотри награду: имя и редкость показаны рядом с карточкой. Карта останется в твоём альбоме.';
      hint.textContent='Приветственные шишки уже на балансе. Новые можно заработать за дела; открытие пака — по обычной цене.';
    }else if(screen==='quests'){
      title.textContent=model.step===1?'Выбери одно посильное дело':'Доброе дело уже сделано';
      text.textContent=model.step===1?'Сделай дело в жизни, затем нажми «Готово» или отправь фото, если оно требуется.':model.text;
    }
    if(screen==='home' || (screen==='quests'&&model.step===2)){
      const link=document.createElement('a');link.href=model.href;link.textContent=model.action;link.className='adventure-action';box.appendChild(link);
    }
    box.appendChild(hint);box.hidden=false;
  }catch{/* Normal screens remain available when guidance cannot load. */}
};
