// Navigate turns within one conversation, without opening another session.
export function mountConversationRail(container, scroller) {
  const rail=document.createElement('nav');rail.className='conversation-rail';rail.setAttribute('aria-label','对话消息定位');container.append(rail);
  let signature='',articles=[],buttons=[],offsets=[],cachedScrollHeight=-1,cachedClientHeight=-1,activeIndex=-1,scrollFrame=0;
  const applyActive=nextActive=>{
    if(nextActive===activeIndex)return;
    if(activeIndex===-1){
      buttons.forEach((button,index)=>button.setAttribute('aria-current',String(index===nextActive)));
    }else{
      buttons[activeIndex]?.setAttribute('aria-current','false');
      buttons[nextActive]?.setAttribute('aria-current','true');
    }
    activeIndex=nextActive;
  };
  const sync=()=>{
    scrollFrame=0;
    if(!buttons.length)return;
    let active=0;
    if(typeof scroller.scrollTop==='number'){
      const sh=scroller.scrollHeight??0,ch=scroller.clientHeight??0;
      if(sh!==cachedScrollHeight||ch!==cachedClientHeight||offsets.length!==articles.length){
        const base=scroller.getBoundingClientRect().top-scroller.scrollTop;
        offsets=articles.map(article=>article.getBoundingClientRect().top-base);
        cachedScrollHeight=sh;cachedClientHeight=ch;
      }
      const threshold=scroller.scrollTop+40;
      for(let index=0;index<offsets.length;index++){if(offsets[index]<=threshold)active=index;}
    }else{
      const top=scroller.getBoundingClientRect().top+40;
      articles.forEach((article,index)=>{if(article.getBoundingClientRect().top<=top)active=index;});
    }
    applyActive(active);
  };
  const onScroll=()=>{
    if(rail.hidden||buttons.length<2||scrollFrame)return;
    if(typeof requestAnimationFrame==='function')scrollFrame=requestAnimationFrame(sync);
    else sync();
  };
  rail.onclick=event=>{const button=event.target.closest('[data-index]');if(button)scroller.querySelectorAll('[data-turn]')[Number(button.dataset.index)]?.scrollIntoView({behavior:document.documentElement.dataset.calm==='true'?'instant':'smooth',block:'start'});};
  scroller.addEventListener('scroll',onScroll,{passive:true});
  scroller.addEventListener?.('toggle',()=>{cachedScrollHeight=-1;},true);
  return ()=>{
    articles=[...scroller.querySelectorAll('[data-turn]')];
    cachedScrollHeight=-1;cachedClientHeight=-1;offsets=[];
    const summaryFor=article=>article.querySelector('.user-message, .assistant-message')?.textContent||'';
    const next=articles.map(article=>`${article.dataset.turn}:${summaryFor(article)}`).join('|');
    let focusedTurn;
    if(next!==signature){
      focusedTurn=rail.contains(document.activeElement)?document.activeElement.dataset.turnRef:undefined;
      signature=next;activeIndex=-1;
      buttons=articles.map((article,index)=>{
        const button=document.createElement('button');button.type='button';button.dataset.index=String(index);button.dataset.turnRef=article.dataset.turn;
        const summary=summaryFor(article)||`第 ${index+1} 轮对话`;
        button.setAttribute('aria-label',`查看：${summary.slice(0,100)}`);
        const dash=document.createElement('span');dash.className='rail-dash';
        const preview=document.createElement('span');preview.className='rail-preview';preview.textContent=summary.slice(0,160);
        button.append(dash,preview);return button;
      });
      rail.replaceChildren(...buttons);
    }
    rail.hidden=articles.length<2;sync();
    if(focusedTurn!==undefined && document.activeElement===document.body && rail.isConnected && rail.getClientRects().length) {
      buttons.find(button=>button.dataset.turnRef===focusedTurn)?.focus({preventScroll:true});
    }
  };
}
