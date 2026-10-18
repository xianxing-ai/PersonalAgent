/** Native effort is independent from the execution-step slider. */
export function nativeReasoningState(snapshot){
  const catalog=snapshot?.agentArtsModels?.catalog,preference=snapshot?.conversationPreference;
  const defaults=snapshot?.agentArtsModels?.preferences;
  const modelId=preference?.executionModel?.modelId??preference?.modelId??(defaults?.catalogRevision===catalog?.revision?defaults?.defaultModelId:catalog?.defaultModelId);
  const model=catalog?.models.find(m=>m.id===modelId&&m.type==='text'&&m.availability!=='unavailable');
  const effort=preference?.executionModel?.reasoningEffort??(!preference?.modelId&&defaults?.catalogRevision===catalog?.revision?defaults?.reasoningEffort:undefined);
  return {catalogRevision:catalog?.revision,modelId,efforts:model?.reasoningEfforts??[],reasoningEffort:effort,available:Boolean(model)};
}
export function mountNativeReasoning(root,invoke,report){
  const label=document.createElement('label');label.className='native-reasoning-control';label.textContent='原生推理强度';const select=document.createElement('select');select.setAttribute('aria-label','当前模型原生推理强度');label.append(select);root.append(label);
  let state,signature='',pending=false,owner,generation=0,externalBusy=false;
  function update(snapshot){const nextOwner=snapshot?.conversationState?.activeId;if(owner!==nextOwner){owner=nextOwner;generation++;pending=false;signature='';}state=nativeReasoningState(snapshot);const next=JSON.stringify(state);if(!pending&&next!==signature){signature=next;select.replaceChildren(new Option('供应商默认',''),...state.efforts.map(e=>new Option(e,e)));select.value=state.efforts.includes(state.reasoningEffort)?state.reasoningEffort:'';}select.disabled=externalBusy||pending||!state.available;label.title=state.available?'仅发送当前目录声明的原生强度；执行步骤预算单独设置':'当前目录尚无此模型的文本能力';}
  select.onchange=async()=>{if(externalBusy||pending||!state?.available)return;pending=true;select.disabled=true;const token=++generation;const executionModel={catalogRevision:state.catalogRevision,modelId:state.modelId,...(select.value?{reasoningEffort:select.value}:{})};try{await invoke('conversation.model',{executionModel,...(owner?{conversationId:owner}:{})});}catch(error){if(token===generation){report(error);select.value=state.efforts.includes(state.reasoningEffort)?state.reasoningEffort:'';}}finally{if(token===generation){pending=false;select.disabled=externalBusy||!state.available;signature='';}}};
  return {update,setBusy(value){externalBusy=value;select.disabled=externalBusy||pending||!state?.available;}};
}
