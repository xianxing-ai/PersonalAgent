// Navigate turns within one conversation, without opening another session.
export function mountConversationRail(container, scroller) {
  const rail=document.createElement('nav');rail.className='conversation-rail';rail.setAttribute('aria-label','对话消息定位');container.append(rail);
  let signature='';
  const sync=()=>{
    let active=0;const top=scroller.getBoundingClientRect().top+40;
    scroller.querySelectorAll('[data-turn]').forEach((article,index)=>{if(article.getBoundingClientRect().top<=top)active=index;});
    rail.querySelectorAll('button').forEach((button,index)=>button.setAttribute('aria-current',String(index===active)));
  };
  rail.onclick=event=>{const button=event.target.closest('[data-index]');if(button)scroller.querySelectorAll('[data-turn]')[Number(button.dataset.index)]?.scrollIntoView({behavior:document.documentElement.dataset.calm==='true'?'instant':'smooth',block:'start'});};
  scroller.addEventListener('scroll',sync,{passive:true});
  return ()=>{
    const articles=[...scroller.querySelectorAll('[data-turn]')];
    const summaryFor=article=>article.querySelector('.user-message, .assistant-message')?.textContent||'';
    const next=articles.map(article=>`${article.dataset.turn}:${summaryFor(article)}`).join('|');
    let focusedTurn;
    if(next!==signature){
      focusedTurn=rail.contains(document.activeElement)?document.activeElement.dataset.turnRef:undefined;
      signature=next;rail.replaceChildren(...articles.map((article,index)=>{
      const button=document.createElement('button');button.type='button';button.dataset.index=String(index);button.dataset.turnRef=article.dataset.turn;
      const summary=summaryFor(article)||`第 ${index+1} 轮对话`;
      button.setAttribute('aria-label',`查看：${summary.slice(0,100)}`);
      const dash=document.createElement('span');dash.className='rail-dash';
      const preview=document.createElement('span');preview.className='rail-preview';preview.textContent=summary.slice(0,160);
      button.append(dash,preview);return button;
    }));}
    rail.hidden=articles.length<2;sync();
    if(focusedTurn!==undefined && document.activeElement===document.body && rail.isConnected && rail.getClientRects().length) {
      [...rail.querySelectorAll('button')].find(button=>button.dataset.turnRef===focusedTurn)?.focus({preventScroll:true});
    }
  };
}
