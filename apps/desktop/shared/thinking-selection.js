// Desktop-owned default presets. Only trusted catalog IDs and published efforts are used.
// Slots 0/1 use the configured submodel; slots 2..5 use the configured primary model.
const order=['none','minimal','low','medium','high','xhigh','max'];
const targets=['minimal','low','medium','high','xhigh','max'];
const sources=[
  ['agentarts-proxy','AgentArts'],
  ['runtime-huawei-maas','华为 MaaS'],
  ['runtime-bailian','阿里云百炼'],
];

// The trusted Desktop host has already filtered this catalog for the current deployment.
export function textModels(catalog){
  return (catalog?.models??[]).filter(model=>model.type==='text'&&model.availability!=='unavailable'&&model.available!==false);
}

export function groupTextModels(models){
  return sources.map(([id,label])=>({
    id,label,models:models.filter(model=>(model.route??'agentarts-proxy')===id).sort((a,b)=>
      (a.vendor??a.displayName).localeCompare(b.vendor??b.displayName,'zh-CN') ||
      Number(b.tier==='flagship')-Number(a.tier==='flagship') ||
      a.displayName.localeCompare(b.displayName,'zh-CN')),
  })).filter(group=>group.models.length);
}

export function modelOptionLabel(model){
  const tier=model.tier==='flagship'?'旗舰':model.tier==='flash'?'Flash 轻量':'';
  return [model.displayName,tier].filter(Boolean).join(' · ');
}

export function defaultModelId(catalog,preferences,role){
  if(!preferences)return catalog.defaultModelId;
  return role==='subagent'?preferences.defaultSubmodelId:preferences.defaultModelId;
}

export function isCurrentModelSelection(catalog,previousSelection,selection){
  return Boolean(catalog&&(selection.catalogRevision===catalog.revision
    ||selection.catalogRevision===previousSelection?.catalogRevision&&previousSelection.modelIds.includes(selection.modelId)));
}

export function defaultThinkingSelection(snapshot,depth){
  const catalog=snapshot?.catalog,preferences=snapshot?.preferences;
  if(!catalog||!Number.isInteger(depth)||depth<0||depth>5)throw Error('默认思考档位或模型目录不可用');
  const subagent=depth<2;
  const id=defaultModelId(catalog,preferences,subagent?'subagent':'primary');
  const model=textModels(catalog).find(item=>item.id===id);
  if(!model)throw Error('默认组合中的模型不可用，请在模型设置重新选择');
  const efforts=order.filter(effort=>model.reasoningEfforts?.includes(effort));
  const configuredEffort=subagent?preferences?.submodelReasoningEffort:preferences?.reasoningEffort;
  if(configuredEffort!==undefined&&!efforts.includes(configuredEffort))throw Error('默认推理强度不可用，请在模型设置重新选择');
  const target=order.indexOf(targets[depth]);
  const effort=efforts.reduce((best,value)=>best===undefined||Math.abs(order.indexOf(value)-target)<Math.abs(order.indexOf(best)-target)?value:best,undefined);
  return {catalogRevision:catalog.revision,modelId:model.id,...(effort?{reasoningEffort:effort}:{})};
}
