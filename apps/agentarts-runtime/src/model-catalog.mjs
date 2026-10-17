import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ProtocolError} from '@personal-agent/contracts';
const fail=()=>{throw new ProtocolError('INVALID_ARGUMENT','Invalid execution model configuration or selection');};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,names)=>object(value)&&Object.keys(value).every(key=>names.includes(key));
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value===value.trim()&&!/[\x00-\x1f]/u.test(value);
const efforts=['none','minimal','low','medium','high','xhigh','max'];
/** Only trusted startup environment supplies this path, never an invocation. */
export async function loadExecutionModelConfiguration(environment,{read=readFile}={}) {
  const inline=environment.PA_AGENT_MODEL_CATALOG;
  const file=environment.PA_AGENT_MODEL_CATALOG_FILE;
  if(inline!==undefined&&file!==undefined)fail();
  if(file===undefined)return inline;
  if(typeof file!=='string'||!file.trim()||/[\x00-\x1f]/u.test(file))fail();
  try {
    const content=await read(file,'utf8');
    return JSON.parse(content);
  }catch{fail();}
}
/** Trusted startup data only. The digest binds all public routing/capability declarations. */
export function createExecutionModelRegistry({configuration,createProvider}={}) {
  let value=configuration;
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{fail();}}
  if(!fields(value,['version','defaultModelId','models'])||value.version!=='1.0'||!text(value.defaultModelId)
    ||!Array.isArray(value.models)||!value.models.length||typeof createProvider!=='function')fail();
  const ids=new Set();
  const models=value.models.map(entry=>{
    if(!fields(entry,['id','displayName','reasoningEfforts','requestProfile','route','type','availability'])
      ||!text(entry.id)||!text(entry.displayName)||ids.has(entry.id)||!Array.isArray(entry.reasoningEfforts)
      ||new Set(entry.reasoningEfforts).size!==entry.reasoningEfforts.length||entry.reasoningEfforts.some(item=>!efforts.includes(item))
      ||!['standard','deepseek-native-v1','bailian-deepseek-v1','huawei-openai-v1'].includes(entry.requestProfile)
      ||!['agentarts-proxy','runtime-bailian'].includes(entry.route??'agentarts-proxy')
      ||!['text','audio','embedding','image','unknown'].includes(entry.type??'text')
      ||!['available','unverified','unavailable'].includes(entry.availability??'unverified'))fail();
    ids.add(entry.id);
    return {id:entry.id,displayName:entry.displayName,reasoningEfforts:[...entry.reasoningEfforts].sort(),requestProfile:entry.requestProfile,
      route:entry.route??'agentarts-proxy',type:entry.type??'text',availability:entry.availability??'unverified'};
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const defaultEntry=models.find(entry=>entry.id===value.defaultModelId);
  if(!defaultEntry||defaultEntry.type!=='text'||defaultEntry.availability==='unavailable')fail();
  const body={version:'1.0',defaultModelId:value.defaultModelId,models};
  const revision=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const providers=new Map();
  return {catalog:()=>structuredClone({...body,revision}),resolve(selection){
    if(selection!==undefined&&(!fields(selection,['catalogRevision','modelId','reasoningEffort'])
      ||selection.catalogRevision!==revision||!text(selection.modelId)
      ||(selection.reasoningEffort!==undefined&&!efforts.includes(selection.reasoningEffort))))fail();
    const entry=models.find(item=>item.id===(selection?.modelId??body.defaultModelId));
    if(!entry)fail();
    if(entry.type!=='text'||entry.availability==='unavailable')throw new ProtocolError('UNSUPPORTED_CAPABILITY','Execution model unavailable for text');
    const effort=selection?.reasoningEffort;
    if(effort!==undefined&&!entry.reasoningEfforts.includes(effort))throw new ProtocolError('UNSUPPORTED_CAPABILITY','Execution model reasoning effort unavailable');
    if(!providers.has(entry.id)){
      const provider=createProvider(structuredClone(entry));
      if(!provider||typeof provider.complete!=='function')fail();
      providers.set(entry.id,provider);
    }
    const provider=providers.get(entry.id);
    return {deployment:provider.deployment,complete(request){
      // Selection is authoritative, including an omitted depth; caller prompts cannot alter routing.
      const {reasoningEffort:ignored,...rest}=request;
      return provider.complete({...rest,...(effort===undefined?{}:{reasoningEffort:effort})});
    }};
  }};
}
