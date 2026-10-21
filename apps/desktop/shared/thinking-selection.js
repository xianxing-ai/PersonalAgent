// Desktop-owned default presets. Only trusted catalog IDs and published efforts are used.
// Slots 0/1 use the configured submodel; slots 2..5 use the configured primary model.
const order=['none','minimal','low','medium','high','xhigh','max'];
const targets=['minimal','low','medium','high','xhigh','max'];
export function defaultThinkingSelection(snapshot,depth){
  const catalog=snapshot?.catalog,preferences=snapshot?.preferences;
  if(!catalog||!Number.isInteger(depth)||depth<0||depth>5)throw Error('默认思考档位或模型目录不可用');
  const configured=preferences?.catalogRevision===catalog.revision;
  const id=configured?(depth<2?preferences.defaultSubmodelId:preferences.defaultModelId):catalog.defaultModelId;
  const model=catalog.models.find(item=>item.id===id&&item.type==='text'&&item.availability!=='unavailable'&&item.available!==false);
  if(!model)throw Error('默认组合中的模型不可用，请在模型设置重新选择');
  const efforts=order.filter(effort=>model.reasoningEfforts?.includes(effort));
  const target=order.indexOf(targets[depth]);
  const effort=efforts.reduce((best,value)=>best===undefined||Math.abs(order.indexOf(value)-target)<Math.abs(order.indexOf(best)-target)?value:best,undefined);
  return {catalogRevision:catalog.revision,modelId:model.id,...(effort?{reasoningEffort:effort}:{})};
}
