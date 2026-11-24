import {defaultModelId,defaultThinkingSelection,isCurrentModelSelection,textModels} from '../shared/thinking-selection.js';

/** An unavailable implicit default never replaces an explicit user selection. */
export function readDesktopExecutionModel(models,preference,role='primary') {
  if(role==='primary'&&preference?.modelSelection==='default')return models.resolveExecutionModel(defaultThinkingSelection(models.snapshot(),preference.depth));
  if(preference?.executionModel)return models.resolveSavedExecutionModel(preference.executionModel);
  if(preference?.modelId)return models.resolveExecutionModel({modelId:preference.modelId});
  const snapshot=models.snapshot();
  if(!snapshot.catalog&&!snapshot.preferences)return undefined;
  return models.readExecutionModel(role);
}

/** The live catalog publishes the approved model list for the bound deployment. */
export function createAgentArtsModelSettings({configuration,readCatalog,allowUnverified=false}) {
  let catalog,previousCatalog,reason='尚未读取当前部署模型目录';
  const destination=()=>JSON.stringify(configuration.snapshot(),['gatewayUrl','runtimeName','deploymentVersion']);
  let binding=destination();
  const current=()=>{
    const target=destination();
    if(binding!==target){catalog=previousCatalog=undefined;binding=target;reason='部署已改变，请重新读取模型目录';}
    return catalog;
  };
  function selectableCatalog(){
    const value=current();
    if(!value)return null;
    const version=configuration.snapshot().deploymentVersion;
    const accepting=allowUnverified&&Boolean(version)&&version.toLowerCase()!=='latest';
    const models=textModels(value).filter(model=>model.availability==='available'||accepting&&model.availability==='unverified');
    return {...value,models};
  }
  function snapshot(){
    const visible=selectableCatalog(),preferences=configuration.readModelPreferences?.()??null;
    return {
      available:Boolean(visible?.models.length),
      catalog:visible?structuredClone(visible):null,
      previousSelection:compatibleSelection(visible),
      preferences,
      reason:visible&&!visible.models.length?'当前部署没有已发布的可用模型':
        visible&&preferences&&!validPreferences(visible,preferences)?'默认模型或原生推理强度已不可用，请重新选择':reason,
    };
  }
  function compatibleSelection(visible){
    if(!visible||!previousCatalog||visible.revision===previousCatalog.revision)return null;
    const previous=new Map(previousCatalog.models.map(model=>[model.id,model]));
    const modelIds=visible.models.filter(model=>{
      const old=previous.get(model.id);
      return old&&(old.route??'agentarts-proxy')===(model.route??'agentarts-proxy')
        &&(old.providerModelId??old.id)===(model.providerModelId??model.id);
    }).map(model=>model.id);
    return {catalogRevision:previousCatalog.revision,modelIds};
  }
  function validPreferences(visible,preferences){
    return [[preferences.defaultModelId,preferences.reasoningEffort],[preferences.defaultSubmodelId,preferences.submodelReasoningEffort]]
      .every(([id,effort])=>visible.models.some(model=>model.id===id&&(effort===undefined||model.reasoningEfforts.includes(effort))));
  }
  function resolveExecutionModel(input){
    const c=selectableCatalog();
    if(!c || !input || Object.keys(input).some(k=>!['modelId','reasoningEffort','catalogRevision'].includes(k)) || input.catalogRevision!==undefined&&input.catalogRevision!==c.revision)throw Error('模型目录已改变，请刷新后选择');
    const model=c.models.find(m=>m.id===input.modelId);
    if(!model)throw Error('所选模型不可用，请重新选择当前部署已发布的模型');
    if(input.reasoningEffort!==undefined&&!model.reasoningEfforts.includes(input.reasoningEffort))throw Error('此模型不支持所选原生推理强度');
    return {catalogRevision:c.revision,modelId:model.id,...(input.reasoningEffort===undefined?{}:{reasoningEffort:input.reasoningEffort})};
  }
  return {snapshot,resolveExecutionModel,
    resolveSavedExecutionModel(selection){
      const visible=selectableCatalog();
      if(isCurrentModelSelection(visible,compatibleSelection(visible),selection))
        return resolveExecutionModel({...selection,catalogRevision:visible.revision});
      return resolveExecutionModel(selection);
    },
    async refresh(lifetime={deadline:new Date(Date.now()+15000).toISOString(),signal:AbortSignal.timeout(15000)}){
      try {current();const expected=binding;const value=await readCatalog(lifetime);
      if(expected!==destination())throw Error('读取期间部署已改变');
      if(!value||value.version!=='1.0'||!/^([a-f0-9]{64})$/.test(value.revision)||!Array.isArray(value.models)||value.models.length>1024||!value.models.length)throw Error('模型目录格式无效');
      const ids=new Set();
      for(const m of value.models){
        if(!m||typeof m.id!=='string'||m.id.length>200||ids.has(m.id)
          ||typeof m.displayName!=='string'||m.displayName.length>300
          ||!Array.isArray(m.reasoningEfforts)||m.reasoningEfforts.some(e=>typeof e!=='string'||e.length>30)
          ||!['standard','deepseek-native-v1','bailian-deepseek-v1','huawei-openai-v1'].includes(m.requestProfile)
          ||!['text','audio','embedding','image','unknown'].includes(m.type)
          ||!['available','unverified','unavailable'].includes(m.availability)
          ||m.route!==undefined&&!['agentarts-proxy','runtime-huawei-maas','runtime-bailian'].includes(m.route)
          ||m.providerModelId!==undefined&&(typeof m.providerModelId!=='string'||!m.providerModelId||m.providerModelId.length>256)
          ||m.vendor!==undefined&&(typeof m.vendor!=='string'||!m.vendor||m.vendor.length>256)
          ||m.tier!==undefined&&!['flagship','flash'].includes(m.tier))throw Error('模型目录条目无效');
        ids.add(m.id);
      }
      if(!ids.has(value.defaultModelId))throw Error('模型目录默认项无效');
      if(catalog&&catalog.revision!==value.revision)previousCatalog=catalog;
      catalog=structuredClone(value);binding=expected;reason='已读取当前部署的模型目录';return snapshot();
      }catch{catalog=undefined;reason='当前部署模型目录读取失败；模型执行不可用，请在设置重试';throw Error(reason);}
    },
    configure(input){
      if(!input||Object.keys(input).some(k=>!['catalogRevision','defaultModelId','defaultSubmodelId','reasoningEffort','submodelReasoningEffort'].includes(k)))throw Error('模型偏好格式无效');
      resolveExecutionModel({catalogRevision:input.catalogRevision,modelId:input.defaultModelId,reasoningEffort:input.reasoningEffort});
      resolveExecutionModel({catalogRevision:input.catalogRevision,modelId:input.defaultSubmodelId,reasoningEffort:input.submodelReasoningEffort});
      configuration.saveModelPreferences(input);return snapshot();
    },
    readExecutionModel(role='primary'){
      const c=current();if(!c)throw Error(reason);
      const p=configuration.readModelPreferences?.();
      return resolveExecutionModel({modelId:defaultModelId(c,p,role),reasoningEffort:role==='subagent'?p?.submodelReasoningEffort:p?.reasoningEffort});
    }};
}

/** Metadata only; failure is isolated from Desktop and Runtime startup. */
export async function refreshAgentArtsModelsOnStartup({configuration,models,onUpdate=()=>{}}){
 if(configuration.snapshot().configured!==true)return;
 try{await models.refresh();}catch{/* refresh exposes a bounded unavailable state; never an API fallback. */}
 finally{onUpdate();}
}
