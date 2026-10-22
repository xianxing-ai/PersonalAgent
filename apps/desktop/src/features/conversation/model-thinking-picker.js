import {nativeReasoningState} from './native-reasoning.js';
import {defaultThinkingSelection} from '../../../shared/thinking-selection.js';

const depthLabels=['最低','轻度','平衡','深入','高','极高'];
const effortLabels={none:'关闭',minimal:'最低',low:'低',medium:'平衡',high:'高',xhigh:'极高',max:'最高'};
const effortDepth={none:0,minimal:0,low:1,medium:2,high:4,xhigh:5,max:5};
const modelKey=value=>JSON.stringify([value.modelId||'',value.executionModel??null,value.modelSelection??null]);
const preferenceKey=value=>JSON.stringify([modelKey(value),value.depth,value.fast]);
const clamp=value=>Math.max(0,Math.min(5,Number.isFinite(Number(value))?Math.round(Number(value)):1));
export const availableThinkingModels=snapshot=>(snapshot?.agentArtsModels?.catalog?.models??[]).filter(model=>model.type==='text'&&model.availability!=='unavailable'&&model.available!==false);

/** Shared writer for both conversation surfaces. A drag previews locally until released. */
export function createModelThinkingController(invoke,report,{onChange=()=>{},readFeedbackRevision,clearFeedback}={}){
  let snapshot={},owner,binding,generation=0,sequence=0,queued,draining,accepted,optimistic,preview,failure,reportedFailure,busy=false;
  const observed=()=>({...snapshot.conversationPreference,depth:clamp(snapshot.conversationPreference?.depth??snapshot.thinking?.depth),fast:Boolean(snapshot.conversationPreference?.fast??snapshot.thinking?.fast)});
  const confirmed=()=>({...observed(),...accepted});
  const effective=()=>preview??optimistic??confirmed();
  function state(){
    const preference=effective();
    let resolved,selectionError;
    if(preference.modelSelection==='default'){try{resolved=defaultThinkingSelection(snapshot.agentArtsModels,preference.depth);}catch(error){selectionError=error.message;}}
    const native=nativeReasoningState({...snapshot,conversationPreference:resolved?{executionModel:resolved}:preference});
    const manual=Boolean(preference.modelId||preference.executionModel),nativeSlider=manual&&native.available&&native.efforts.length>0;
    const values=['',...native.efforts];let index=nativeSlider?Math.max(0,values.indexOf(native.reasoningEffort??'')):preference.depth;
    if(!manual&&preference.modelSelection!=='default'&&native.available){
      const matches=[];for(let depth=0;depth<6;depth++){try{const selected=defaultThinkingSelection(snapshot.agentArtsModels,depth);if(selected.modelId===native.modelId&&selected.reasoningEffort===native.reasoningEffort)matches.push(depth);}catch{/* unavailable defaults are explained by the host */}}
      if(matches.length&&!matches.includes(index))index=matches[0];
    }
    const level=nativeSlider?(effortLabels[values[index]]??'默认'):depthLabels[index];
    const models=availableThinkingModels(snapshot),model=models.find(item=>item.id===native.modelId);
    const defaults=snapshot.agentArtsModels?.preferences,catalog=snapshot.agentArtsModels?.catalog;
    const submodel=defaults?.catalogRevision===catalog?.revision?models.find(item=>item.id===defaults?.defaultSubmodelId):undefined;
    const configured=snapshot.agentArts?.configured===true||snapshot.model?.configured===true;
    const modelLabel=!native.available&&(manual||catalog)
      ?model?.displayName?`${model.displayName}（不可用）`:manual?'所选模型不可用':'默认模型不可用'
      :model?.displayName??(configured?'AgentArts 默认模型':'模型未配置');
    const catalogDetail=!catalog?(configured
      ?'模型目录未加载；AgentArts 已配置，具体模型和原生思考强度待目录确认。'
      :'模型连接未配置，请在模型设置完成配置。'):undefined;
    return {preference,native,models,manual,nativeSlider,index,max:nativeSlider?values.length-1:5,level,
      modelLabel,
      detail:catalogDetail??selectionError??(manual?(native.available?nativeSlider?'调整当前模型的原生思考强度': '原生思考由供应商管理；滑块调整执行深度':native.reason):`默认组合：低两档使用${submodel?.displayName??'默认子模型'}，其余使用已配置主模型；当前原生强度：${effortLabels[native.reasoningEffort]??'供应商默认'}。不支持原生调节时仅调整执行深度。`),
      busy, saving:Boolean(optimistic),failure,disabled:busy||!catalog};
  }
  const project=()=>onChange(state());
  function update(value){
    const nextOwner=value?.conversationState?.activeId,nextBinding=value?.agentArtsModels?.catalog?.revision;
    if(owner!==nextOwner||binding!==nextBinding){generation++;owner=nextOwner;binding=nextBinding;queued=accepted=optimistic=preview=failure=reportedFailure=undefined;}
    snapshot=value;
    if(accepted&&preferenceKey(confirmed())===preferenceKey(observed()))accepted=undefined;
    project();
  }
  async function drain(){
    while(queued){
      const intent=queued;queued=undefined;
      try{
        const context=owner?{conversationId:owner}:{};
        if(intent.preference.modelSelection==='default'){
          const result=await invoke('conversation.model',{modelId:'',modelSelection:'default',depth:intent.preference.depth,fast:intent.preference.fast,catalogRevision:binding,...context});
          if(intent.generation!==generation)continue;
          accepted={...intent.preference,...result,modelId:'',executionModel:undefined};
        }else if(modelKey(intent.preference)!==modelKey(confirmed())){
          const selection=intent.preference.executionModel?{executionModel:intent.preference.executionModel}:{modelId:intent.preference.modelId||'',...(intent.preference.modelSelection?{modelSelection:intent.preference.modelSelection}:{})};
          const result=await invoke('conversation.model',{...selection,...context});
          if(intent.generation!==generation)continue;
          accepted={...accepted,modelId:result?.modelId??intent.preference.modelId,executionModel:result?.executionModel??intent.preference.executionModel,modelSelection:result?.modelSelection??intent.preference.modelSelection};
        }
        const current=confirmed();
        if(current.depth!==intent.preference.depth||current.fast!==intent.preference.fast){
          const result=await invoke('thinking.update',{depth:intent.preference.depth,fast:intent.preference.fast,...context});
          if(intent.generation!==generation)continue;
          accepted={...accepted,depth:result?.depth??intent.preference.depth,fast:result?.fast??intent.preference.fast};
        }
        if(intent.generation===generation&&intent.sequence===sequence){
          optimistic=undefined;failure=undefined;
          if(reportedFailure!==undefined&&readFeedbackRevision?.()===reportedFailure)clearFeedback?.();
          reportedFailure=undefined;
        }
      }catch(error){
        if(intent.generation===generation&&intent.sequence===sequence){optimistic=undefined;failure=error;report(error);reportedFailure=readFeedbackRevision?.();}
      }finally{project();}
    }
  }
  function save(preference){
    if(state().disabled)return;
    failure=undefined;preview=undefined;optimistic=preference;
    queued={preference,generation,sequence:++sequence};project();
    if(!draining)draining=drain().finally(()=>{draining=undefined;});
    return draining;
  }
  function previewLevel(index){
    const current=state();if(current.disabled)return;
    index=Math.max(0,Math.min(current.max,Math.round(Number(index))||0));
    if(current.nativeSlider){
      const effort=['',...current.native.efforts][index];
      const executionModel={catalogRevision:binding,modelId:current.native.modelId,...(effort?{reasoningEffort:effort}:{})};
      preview={...effective(),modelId:current.native.modelId,executionModel,modelSelection:undefined,depth:effort?effortDepth[effort]:effective().depth};
    }else preview={...effective(),depth:index,...(!current.manual?{modelId:'',executionModel:undefined,modelSelection:'default'}:{})};
    project();
  }
  return {update,state,previewLevel,commitLevel(index){if(!preview)previewLevel(index);return save(effective());},
    chooseModel(modelId){if(modelId&&!availableThinkingModels(snapshot).some(model=>model.id===modelId))return;return save({...effective(),modelId,executionModel:undefined,modelSelection:modelId?undefined:'default'});},
    setFast(fast){return save({...effective(),fast:Boolean(fast)});},
    setBusy(value){busy=value;project();},
    async flush(){const token=generation;if(preview)await save(preview);while(draining)await draining;if(token!==generation)throw Error('当前对话或模型目录已切换，请重新发送');if(failure)throw Error('模型或思考设置未保存，请重试后发送');}};
}

/** A compact model + thinking entry, with one slider and all published text models. */
export function mountModelThinkingPicker(root,invoke,report,options={}){
  root.classList.add('model-thinking-picker');
  root.innerHTML=`<button type="button" class="model-thinking-trigger" aria-label="模型与思考" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.5 3.5a7 7 0 1 0 3 7M15.5 5.5a5 5 0 1 0 0 7"/></svg><span data-picker-model>默认组合</span><span data-picker-level>平衡</span><svg class="picker-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg></button>
    <div class="model-thinking-menu" role="dialog" aria-label="模型与思考设置" hidden>
      <div class="picker-power-top"><button type="button" class="picker-fast" aria-label="快速模式" aria-pressed="false" title="快速模式"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="m11 2-7 9h5l-1 7 8-10h-6z"/></svg></button><button type="button" class="picker-model-heading" aria-label="选择具体模型" aria-expanded="false"><span data-power-model>默认组合</span><output data-picker-output>平衡</output><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg></button></div>
      <div class="picker-thinking"><input type="range" min="0" max="5" step="1" aria-label="思考强度"></div>
      <p class="picker-detail" hidden></p><p class="picker-save-status" role="status" hidden></p>
      <div class="picker-model-choices" hidden><button type="button" class="picker-model-option picker-default" data-default aria-pressed="true"><span>默认模型组合</span><small>滑块联动已配置的主模型与子模型</small><span data-check aria-hidden="true">✓</span></button>
        <input type="search" class="picker-search" placeholder="搜索模型" aria-label="搜索模型"><div class="picker-model-list" role="group" aria-label="可用模型"></div><button type="button" class="picker-settings">模型与默认设置 <span aria-hidden="true">↗</span></button></div>
    </div>`;
  const button=root.querySelector('.model-thinking-trigger'),menu=root.querySelector('.model-thinking-menu');
  const slider=root.querySelector('[type=range]'),fast=root.querySelector('.picker-fast'),search=root.querySelector('[type=search]'),list=root.querySelector('.picker-model-list'),heading=root.querySelector('.picker-model-heading'),choices=root.querySelector('.picker-model-choices');
  const hideChoices=()=>{choices.hidden=true;heading.setAttribute('aria-expanded','false');};
  let catalogSignature='',lastState;
  function filter(){let visible=0;for(const item of list.children){item.hidden=!item.textContent.toLowerCase().includes(search.value.trim().toLowerCase());if(!item.hidden)visible++;}list.dataset.empty=String(visible===0);}
  const control=createModelThinkingController(invoke,report,{...options,onChange:state=>{
    lastState=state;
    root.querySelector('[data-picker-model]').textContent=state.modelLabel;root.querySelector('[data-picker-level]').textContent=state.level;
    root.querySelector('[data-power-model]').textContent=state.modelLabel;heading.title=state.detail;
    button.title=`${state.modelLabel} · ${state.level}`;button.setAttribute('aria-busy',String(state.saving));
    const signature=JSON.stringify(state.models.map(model=>[model.id,model.displayName]));
    if(signature!==catalogSignature){catalogSignature=signature;list.replaceChildren();for(const model of state.models){const item=document.createElement('button');item.type='button';item.className='picker-model-option';item.dataset.modelId=model.id;item.textContent=model.displayName??model.id;item.title=model.id;item.onclick=()=>{control.chooseModel(model.id);hideChoices();};list.append(item);}filter();}
    for(const item of list.children){item.setAttribute('aria-pressed',String(state.manual&&item.dataset.modelId===state.native.modelId));item.disabled=state.disabled;}
    const defaults=root.querySelector('[data-default]');defaults.setAttribute('aria-pressed',String(!state.manual));defaults.disabled=state.disabled;
    slider.max=String(state.max);slider.value=String(state.index);slider.disabled=state.disabled;slider.setAttribute('aria-valuetext',state.level);slider.setAttribute('aria-busy',String(state.saving));slider.style.setProperty('--picker-fill',`${6+88*state.index/(state.max||1)}%`);
    const ticks=Array.from({length:state.max+1},(_,i)=>`radial-gradient(circle at ${6+88*i/(state.max||1)}% 50%,rgba(255,255,255,.3) 0 1.8px,transparent 2.1px)`);slider.style.setProperty('--picker-track',[...ticks,'linear-gradient(90deg,#0877d9 0 var(--picker-fill),#414141 var(--picker-fill) 100%)'].join(','));
    root.querySelector('[data-picker-output]').textContent=state.level;
    fast.setAttribute('aria-pressed',String(state.preference.fast));fast.disabled=state.disabled;
    const detail=root.querySelector('.picker-detail');detail.textContent=state.native.available&&!state.native.efforts.length?'原生思考由供应商管理；此档仅调整执行深度。':state.detail;detail.hidden=state.native.available&&state.native.efforts.length>0;
    const status=root.querySelector('.picker-save-status');status.textContent=state.failure?'设置未保存，请重新选择后重试':state.saving?'正在保存…':'';status.hidden=!status.textContent;
  }});
  const close=()=>{menu.hidden=true;hideChoices();button.setAttribute('aria-expanded','false');};
  button.onclick=event=>{event.stopPropagation();menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden){hideChoices();search.value='';filter();const rect=button.getBoundingClientRect();menu.style.setProperty('--picker-left',`${Math.max(8,Math.min(rect.left,window.innerWidth-Math.min(288,window.innerWidth-16)-8))}px`);const above=rect.top>window.innerHeight/2;menu.style.top=above?'auto':`${rect.bottom+8}px`;menu.style.bottom=above?`${window.innerHeight-rect.top+8}px`:'auto';menu.style.maxHeight=`${Math.max(160,(above?rect.top:window.innerHeight-rect.bottom)-16)}px`;}};
  heading.onclick=()=>{choices.hidden=!choices.hidden;heading.setAttribute('aria-expanded',String(!choices.hidden));if(!choices.hidden)search.focus();};
  root.querySelector('[data-default]').onclick=()=>{control.chooseModel('');hideChoices();};search.oninput=filter;
  slider.oninput=()=>control.previewLevel(Number(slider.value));slider.onchange=()=>control.commitLevel(Number(slider.value));fast.onclick=()=>control.setFast(fast.getAttribute('aria-pressed')!=='true');
  root.querySelector('.picker-settings').onclick=()=>{close();invoke('admin.open',{page:'models'}).catch(report);};
  const outside=event=>{if(!root.contains(event.target))close();};document.addEventListener('click',outside);
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();if(!choices.hidden){hideChoices();heading.focus({preventScroll:true});}else{close();button.focus({preventScroll:true});}}else if(event.key==='ArrowDown'&&event.target===button){event.preventDefault();if(menu.hidden)button.click();slider.focus();}});
  return {...control,button,menu,close,dispose(){document.removeEventListener('click',outside);},getState:()=>lastState};
}
