/** Host-owned catalog selection. Catalog availability is not provider verification. */
export function createAgentArtsModelSettings({configuration,readCatalog}) {
  let catalog,reason='尚未读取当前部署模型目录';
  const destination=()=>JSON.stringify(configuration.snapshot(),['gatewayUrl','runtimeName','deploymentVersion']);
  let binding=destination();
  const current=()=>{if(binding!==destination()){catalog=undefined;binding=destination();reason='部署已改变，请重新读取模型目录';}return catalog;};
  const snapshot=()=>({available:Boolean(current()),catalog:catalog?structuredClone(catalog):null,preferences:configuration.readModelPreferences?.()??null,reason});
  function resolveExecutionModel(input){
    const c=current();
    if(!c || !input || Object.keys(input).some(k=>!['modelId','reasoningEffort','catalogRevision'].includes(k)) || input.catalogRevision!==undefined&&input.catalogRevision!==c.revision)throw Error('模型目录已改变，请刷新后选择');
    const model=c.models.find(m=>m.id===input.modelId);
    if(!model || model.availability==='unavailable' || model.available===false || model.type!=='text')throw Error('此模型尚未公布文本执行能力');
    if(input.reasoningEffort!==undefined&&!model.reasoningEfforts.includes(input.reasoningEffort))throw Error('此模型不支持所选原生推理强度');
    return {catalogRevision:c.revision,modelId:model.id,...(input.reasoningEffort===undefined?{}:{reasoningEffort:input.reasoningEffort})};
  }
  return {snapshot,resolveExecutionModel,
    async refresh(lifetime={deadline:new Date(Date.now()+15000).toISOString(),signal:AbortSignal.timeout(15000)}){
      try {const expected=destination();const value=await readCatalog(lifetime);
      if(expected!==destination())throw Error('读取期间部署已改变');
      if(!value||value.version!=='1.0'||!/^([a-f0-9]{64})$/.test(value.revision)||!Array.isArray(value.models)||value.models.length>1024||!value.models.length)throw Error('模型目录格式无效');
      const ids=new Set();for(const m of value.models){if(!m||typeof m.id!=='string'||m.id.length>200||ids.has(m.id)||typeof m.displayName!=='string'||m.displayName.length>300||!Array.isArray(m.reasoningEfforts)||m.reasoningEfforts.some(e=>typeof e!=='string'||e.length>30)||!['standard','deepseek-native-v1','bailian-deepseek-v1','huawei-openai-v1'].includes(m.requestProfile)||!['text','audio','embedding','image','unknown'].includes(m.type)||!['available','unverified','unavailable'].includes(m.availability)||m.route!==undefined&&!['agentarts-proxy','runtime-bailian'].includes(m.route))throw Error('模型目录条目无效');ids.add(m.id);}
      if(!ids.has(value.defaultModelId))throw Error('模型目录默认项无效');
      catalog=structuredClone(value);binding=expected;reason='当前部署目录已读取；各模型真实调用验收以任务证据为准';return snapshot();
      }catch{catalog=undefined;reason='当前部署模型目录读取失败；模型执行不可用，请在设置重试';throw Error(reason);}
    },
    configure(input){
      if(!input||Object.keys(input).some(k=>!['catalogRevision','defaultModelId','defaultSubmodelId','reasoningEffort','submodelReasoningEffort'].includes(k)))throw Error('模型偏好格式无效');
      resolveExecutionModel({catalogRevision:input.catalogRevision,modelId:input.defaultModelId,reasoningEffort:input.reasoningEffort});
      resolveExecutionModel({catalogRevision:input.catalogRevision,modelId:input.defaultSubmodelId,reasoningEffort:input.submodelReasoningEffort});
      configuration.saveModelPreferences(input);return snapshot();
    },
    readExecutionModel(role='primary'){
      const c=current();if(!c)throw Error(reason);const p=configuration.readModelPreferences?.();
      const sub=role==='subagent', valid=p?.catalogRevision===c.revision;
      return resolveExecutionModel({modelId:valid?(sub?p.defaultSubmodelId:p.defaultModelId):c.defaultModelId,reasoningEffort:valid?(sub?p.submodelReasoningEffort:p.reasoningEffort):undefined});
    }};
}

/** Metadata only; failure is isolated from Desktop and Runtime startup. */
export async function refreshAgentArtsModelsOnStartup({configuration,models,onUpdate=()=>{}}){
 if(configuration.snapshot().configured!==true)return;
 try{await models.refresh();}catch{/* refresh exposes a bounded unavailable state; never an API fallback. */}
 finally{onUpdate();}
}
