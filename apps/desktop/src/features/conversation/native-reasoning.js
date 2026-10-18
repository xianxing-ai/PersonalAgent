const effortLabels={none:'关闭',minimal:'最低',low:'低',medium:'平衡',high:'高',xhigh:'更高',max:'最高'};
const effortOrder=Object.keys(effortLabels);
const labelFor=effort=>effortLabels[effort]??effort;

/** Resolve the same per-conversation/default selection as the trusted host. */
export function nativeReasoningState(snapshot){
  const catalog=snapshot?.agentArtsModels?.catalog,preference=snapshot?.conversationPreference;
  const defaults=snapshot?.agentArtsModels?.preferences;
  const useDefaults=Boolean(catalog)&&defaults!=null&&!preference?.executionModel&&!preference?.modelId&&defaults.catalogRevision===catalog.revision;
  const modelId=preference?.executionModel?.modelId??(preference?.modelId||undefined)??(useDefaults?defaults?.defaultModelId:catalog?.defaultModelId);
  const model=catalog?.models.find(m=>m.id===modelId&&m.type==='text'&&m.availability!=='unavailable'&&m.available!==false);
  const effort=preference?.executionModel?.reasoningEffort??(useDefaults?defaults?.reasoningEffort:undefined);
  const efforts=[...new Set(model?.reasoningEfforts??[])].sort((a,b)=>effortOrder.indexOf(a)-effortOrder.indexOf(b));
  const stale=Boolean(preference?.executionModel&&preference.executionModel.catalogRevision!==catalog?.revision);
  const available=Boolean(model)&&!stale&&(effort===undefined||efforts.includes(effort));
  return {catalogRevision:catalog?.revision,modelId,efforts,reasoningEffort:effort,available,
    reason:stale?'模型目录已改变，请重新选择主思考模型':!model?'当前目录尚无此模型的文本能力':!available?'目录不再支持已保存的强度，请重新选择模型':!efforts.length?'此模型未公布可调强度，使用供应商默认':'仅发送当前目录声明的原生强度；执行步骤预算单独设置'};
}

/** One writer for model + effort. Intermediate drag positions are coalesced. */
export function mountNativeReasoning(root,invoke,report,{slider,output,modelChoice,modelOutput,readFeedbackRevision,clearFeedback}={}){
  if(!slider){
    const depth=document.createElement('label');depth.textContent='思考深度';
    slider=document.createElement('input');slider.type='range';slider.setAttribute('aria-label','模型原生思考深度');
    output=document.createElement('output');depth.append(slider,output);root.append(depth);
  }
  const status=document.createElement('span');status.className='notice';status.setAttribute('role','status');root.append(status);
  let snapshot={},owner,binding,generation=0,sequence=0,queued,draining,accepted,optimistic,failure,externalBusy=false,reportedFailure;
  const modelValues=()=>[{id:'',displayName:'使用默认主思考模型'},...(snapshot.modelChoices??[]).filter(model=>model.available!==false)];
  const preferenceKey=value=>JSON.stringify([value?.modelId??'',value?.executionModel??null]);
  const effective=()=>nativeReasoningState({...snapshot,conversationPreference:optimistic??accepted??snapshot.conversationPreference});
  function project(){
    const state=effective(),values=['',...state.efforts],value=state.reasoningEffort??'';
    const index=Math.max(0,values.indexOf(value));slider.min='0';slider.max=String(state.efforts.length);slider.step='1';slider.value=String(index);
    const text=!state.available?'不可用':value?labelFor(value):'供应商默认';
    if(output)output.textContent=text;
    slider.setAttribute('aria-valuetext',text);slider.style.setProperty('--fill',`${6+88*(state.efforts.length?index/state.efforts.length:0)}%`);
    const ticks=values.map((_,i)=>`radial-gradient(circle at ${6+88*(state.efforts.length?i/state.efforts.length:0)}% 50%,rgba(255,255,255,.3) 0 1.6px,transparent 1.9px)`);
    slider.style.setProperty('--native-reasoning-track',[...ticks,'linear-gradient(90deg,#0877d9 0 var(--fill),#3a3a3a var(--fill) 100%)'].join(','));
    slider.disabled=externalBusy||!state.available||!state.efforts.length;slider.title=state.reason+(value?`；当前值 ${value}`:'');slider.setAttribute('aria-busy',String(Boolean(optimistic)));
    if(modelChoice){
      const models=modelValues(),id=(optimistic??accepted??snapshot.conversationPreference)?.modelId??'',selected=models.findIndex(model=>model.id===id);
      modelChoice.min='0';modelChoice.max=String(models.length-1);modelChoice.step='1';modelChoice.value=String(Math.max(0,selected));
      const text=selected<0?'当前模型不可用，请重新选择':id?models[selected].displayName:`默认 · ${snapshot.agentArtsModels?.catalog?.models.find(model=>model.id===state.modelId)?.displayName??'未公布模型'}`;
      if(modelOutput)modelOutput.textContent=text;
      modelChoice.setAttribute('aria-valuetext',text);modelChoice.title=text;modelChoice.disabled=externalBusy||!snapshot.agentArtsModels?.catalog||models.length<2;modelChoice.setAttribute('aria-busy',String(Boolean(optimistic)));
    }
    status.textContent=failure?'设置未保存，请重试':optimistic?'正在保存…':!state.available||!state.efforts.length?state.reason:'';
    status.hidden=!status.textContent;
  }
  function update(value){
    const nextOwner=value?.conversationState?.activeId,nextBinding=value?.agentArtsModels?.catalog?.revision;
    if(owner!==nextOwner||binding!==nextBinding){generation++;owner=nextOwner;binding=nextBinding;queued=accepted=optimistic=failure=reportedFailure=undefined;}
    snapshot=value;
    if(accepted&&preferenceKey(accepted)===preferenceKey(value.conversationPreference))accepted=undefined;
    project();
  }
  async function drain(){
    while(queued){
      const intent=queued;queued=undefined;
      try{
        const result=await invoke('conversation.model',intent.payload);
        if(intent.generation===generation){
          // Keep the acknowledged selection until its published snapshot arrives.
          accepted=result??intent.preference;
          if(intent.sequence===sequence){optimistic=undefined;failure=undefined;if(reportedFailure!==undefined&&readFeedbackRevision?.()===reportedFailure)clearFeedback?.();reportedFailure=undefined;}
        }
      }catch(error){
        if(intent.generation===generation&&intent.sequence===sequence){optimistic=undefined;failure=error;report(error);reportedFailure=readFeedbackRevision?.();}
      }finally{project();}
    }
  }
  function save(payload,preference){
    failure=undefined;optimistic=preference;
    queued={payload:{...payload,...(owner?{conversationId:owner}:{})},preference,generation,sequence:++sequence};
    project();
    if(!draining)draining=drain().finally(()=>{draining=undefined;});
    return draining;
  }
  function chooseEffort(value){
    const state=effective();if(externalBusy||!state.available||!state.efforts.length||value&&!state.efforts.includes(value))return;
    const executionModel={catalogRevision:state.catalogRevision,modelId:state.modelId,...(value?{reasoningEffort:value}:{})};
    return save({executionModel},{modelId:state.modelId,executionModel});
  }
  slider.oninput=()=>chooseEffort(['',...effective().efforts][Number(slider.value)]??'');
  function chooseModel(modelId){return save({modelId},{modelId});}
  if(modelChoice)modelChoice.oninput=()=>{if(!modelChoice.disabled)return chooseModel(modelValues()[Number(modelChoice.value)]?.id??'');};
  return {update,chooseModel,
    async flush(){const token=generation;while(draining)await draining;if(token!==generation)throw Error('当前对话或模型目录已切换，请重新发送');if(failure)throw Error('模型或原生推理强度未保存，请重试设置后发送');},
    setBusy(value){externalBusy=value;project();}};
}
