const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Private source content stays in this admin component; only an explicitly chosen summary is saved. */
export function mountMailSourceControls(parent,invoke){
  const element=parent.ownerDocument.createElement('section');element.className='sheet';parent.append(element);
  element.innerHTML=`<h3>邮件来源记忆</h3><p>从仍在处理的原邮件任务选择来源，再确认摘要和有效期。不会自动发送到云端。</p>
    <form data-mail-source-read><label>原任务<select name="taskId" required></select></label><button class="btn btn-sm">读取来源</button></form>
    <button type="button" class="btn btn-sm" data-mail-review-read>检查来源变化</button>
    <button type="button" class="btn btn-sm" data-mail-review-submit hidden>确认审查原计划</button>
    <pre data-mail-source-preview></pre><form data-mail-source-save hidden>
    <label>保存的摘要<textarea name="summary" maxlength="4000" required></textarea></label>
    <label>生效时间<input name="validFrom" type="datetime-local" required></label>
    <label>失效时间<input name="validUntil" type="datetime-local" required></label><button class="btn btn-sm">检查并确认保存</button></form>
    <button class="btn btn-sm" data-mail-source-list>查看已保存来源</button><div data-mail-source-facts></div>
    <p role="status" aria-live="polite"></p>`;
  const query=s=>element.querySelector(s),status=query('[role="status"]'),select=query('select'),save=query('[data-mail-source-save]');
  let source,review,pendingReview,facts=[],busy=false,pendingSave,closed=false,taskOptions='';const operations=new Map();
  const setBusy=value=>{busy=value;for(const input of element.querySelectorAll('button,input,textarea,select'))input.disabled=value;
    if(pendingSave){for(const input of save.querySelectorAll('input,textarea'))input.disabled=true;
      query('[data-mail-source-read] button').disabled=true;select.disabled=true;}};
  const renderFacts=()=>{query('[data-mail-source-facts]').innerHTML=facts.map((fact,index)=>`<article>
    <p>${escape(fact.summary)}</p><small>版本 ${escape(fact.ref.revision)} · ${fact.state==='active'?'有效':'已撤回'}</small>
    ${fact.state==='active'?`<button class="btn btn-sm" data-mail-source-action="withdraw" data-index="${index}">撤回</button>`:''}
    <button class="btn btn-sm" data-mail-source-action="erase" data-index="${index}">删除全部版本</button></article>`).join('');};
  const list=async()=>{facts=(await invoke('memory.mail.listSources')).facts;renderFacts();};
  async function run(event){
    const target=event.type==='submit'?event.target:event.target.closest('[data-mail-source-list],[data-mail-source-action],[data-mail-review-read],[data-mail-review-submit]');
    if(closed||!target||busy)return;event.preventDefault();setBusy(true);status.textContent='正在处理…';
    try{
      if(target.hasAttribute('data-mail-review-read')){
        review=await invoke('memory.mail.readReview',{taskId:select.value});pendingReview=undefined;
        query('[data-mail-source-preview]').textContent=JSON.stringify({plan:review.plan,affected:review.affected},null,2);
        query('[data-mail-review-submit]').hidden=!review.canSubmit;
        status.textContent=review.canSubmit?'已核实原来源变化；确认后审查原计划。':'原任务缺少明确计划来源，仍需审查。';
      }else if(target.hasAttribute('data-mail-review-submit')){
        if(!review?.canSubmit)throw Error('请先检查原来源变化');
        pendingReview??={taskId:review.taskId,reviewId:review.reviewId,commandId:crypto.randomUUID()};
        const result=await invoke('memory.mail.submitReview',pendingReview);
        status.textContent=result.state==='review_submitted'?'原审查任务已受理；尚不代表计划修复完成。':'未执行审查。';
        if(result.state==='declined')pendingReview=undefined;
      }else if(target.hasAttribute('data-mail-source-read')){
        source=await invoke('memory.mail.readSource',{taskId:select.value});pendingSave=undefined;
        query('[data-mail-source-preview]').textContent=`${source.account} / ${source.folder}\n${JSON.stringify(source.items,null,2)}`;
        save.hidden=false;status.textContent='请填写摘要及有效期，再确认保存。';
      }else if(target===save){
        if(!source)throw Error('请先读取原邮件来源');
        pendingSave??={taskId:source.taskId,sourceId:source.sourceId,commandId:crypto.randomUUID(),summary:save.elements.summary.value,
          validFrom:new Date(save.elements.validFrom.value).toISOString(),validUntil:new Date(save.elements.validUntil.value).toISOString()};
        const result=await invoke('memory.mail.remember',pendingSave);pendingSave=undefined;
        status.textContent=result?.fact?'已保存并读回原版本。':'未获确认，未保存。';await list();
      }else if(target.hasAttribute('data-mail-source-list')){await list();status.textContent=facts.length?'已读回当前版本。':'没有已保存的邮件来源记忆。';}
      else{
        const fact=facts[Number(target.dataset.index)],action=target.dataset.mailSourceAction,key=action+':'+fact.ref.id+':'+fact.ref.revision;
        if(!operations.has(key))operations.set(key,crypto.randomUUID());
        const result=await invoke('memory.mail.'+action,{factId:fact.ref.id,expectedRevision:fact.ref.revision,operationId:operations.get(key)});
        status.textContent=result.state==='deleted'?'已删除原私人记忆和绑定图副本；不包括历史邮箱记录及备份。':result.state==='withdrawn'?'已撤回，停止后续消费。':'本次未执行。';await list();
      }
    }catch(error){status.textContent=error.message+'；结果未确认时再次操作会沿用原请求。';}
    finally{setBusy(false);}
  }
  element.addEventListener('submit',run);element.addEventListener('click',run);
  return {element,update(tasks=[]){
    const options=tasks.filter(task=>task.state!=='cancelled')
      .map(task=>`<option value="${escape(task.taskId)}">${escape(task.goal||task.taskId)}</option>`).join('');
    if(options!==taskOptions&&!busy){const chosen=select.value;select.innerHTML=options;taskOptions=options;
      if([...select.options].some(option=>option.value===chosen))select.value=chosen;}
  },dispose(){closed=true;element.removeEventListener('submit',run);element.removeEventListener('click',run);source=undefined;facts=[];}};
}
