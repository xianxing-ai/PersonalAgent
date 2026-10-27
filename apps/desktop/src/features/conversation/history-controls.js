/** Page navigation lives outside the replaceable transcript. Draft/IME state and the canonical
 * authorization card are unaffected. The host validates conversation ownership again. */
export function mountHistoryControls(container,invoke,report,scrollContainer) {
  const root=document.createElement('nav');root.className='history-navigation';root.setAttribute('aria-label','对话历史翻页');
  root.innerHTML='<button type="button" data-history="older">更早记录</button><span role="status"></span><button type="button" data-history="newer">较新记录</button><button type="button" data-history="latest">回到最新</button>';
  container.prepend(root);
  let current,busy=false,closed=false,pendingNavigation;
  const update=(data,enabled=true)=>{
    current=data?.historyPage;
    if(pendingNavigation&&current?.pageRevision!==pendingNavigation.pageRevision){
      const direction=pendingNavigation.direction;pendingNavigation=undefined;
      requestAnimationFrame(()=>{if(!closed&&scrollContainer)scrollContainer.scrollTop=direction==='latest'?scrollContainer.scrollHeight:0;});
    }
    root.hidden=!enabled||!current||!current.hasOlder&&!current.hasNewer&&current.viewingLatest;
    root.querySelector('[role="status"]').textContent=(current?.viewingLatest?'最近记录':'历史记录')
      +(current?.activeCount>8?` · ${current.activeCount} 个未结束任务，较早任务可翻页查看`:'');
    for(const button of root.querySelectorAll('[data-history]')) {
      const direction=button.dataset.history;
      button.disabled=busy||!current||(direction==='older'?!current.hasOlder:direction==='newer'?!current.hasNewer:current.viewingLatest);
    }
  };
  root.onclick=async event=>{
    const button=event.target.closest('[data-history]');if(!button||button.disabled||busy||!current)return;
    const direction=button.dataset.history,conversationId=current.conversationId;
    pendingNavigation={direction,pageRevision:current.pageRevision};
    busy=true;update({historyPage:current});
    try {
      await invoke('conversation.page',{direction,...(conversationId?{conversationId}:{})});
    }catch(error){pendingNavigation=undefined;if(!closed)report(error);}
    finally{if(!closed){busy=false;update({historyPage:current});}}
  };
  return {update,dispose(){closed=true;root.onclick=null;}};
}
