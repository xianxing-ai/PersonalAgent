import {ProtocolError} from '@personal-agent/contracts';

/** Provisional test protocol over the existing authenticated /invocations transport.
 * No local files, credentials, shells, tools, task state or Laya process live here.
 * Host TaskRuntime retains the existing resumable tool loop and authoritative Evidence.
 */
export function createTestVersionController({models,onCall=()=>{}}) {
  const refs=Object.keys(models);
  if(!refs.length||refs.some(ref=>!models[ref]?.complete))throw TypeError('Configured ModelGateway map required');
  return async({value,deadline,signal,requestId,sessionId})=>{
    if(value.testVersion!==1||!['capabilities','model_turn'].includes(value.operation))
      throw new ProtocolError('INVALID_ARGUMENT','Unknown test version operation');
    if(value.operation==='capabilities') {
      if(Object.keys(value).sort().join(',')!=='operation,testVersion')throw new ProtocolError('INVALID_ARGUMENT','Unexpected capability fields');
      return {testVersion:1,status:'experimental',localDecisionTool:'decision.choose_candidate',
        layaLocation:'local_host',models:refs.map(ref=>({ref,deployment:models[ref].deployment})),
        hostOwns:['TaskRuntime','Policy','ToolGateway','Evidence','local_modules','user_workspace'],
        productionAcceptance:false};
    }
    const allowed=['testVersion','operation','modelRef','messages','maxOutputTokens','reasoningEffort'];
    if(Object.keys(value).some(k=>!allowed.includes(k))||!refs.includes(value.modelRef)||!Array.isArray(value.messages)
      ||!value.messages.length||value.messages.some(m=>!m||Object.keys(m).sort().join(',')!=='content,role'
        ||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim())
      ||value.reasoningEffort!==undefined&&!['none','low','medium','high'].includes(value.reasoningEffort))
      throw new ProtocolError('INVALID_ARGUMENT','Invalid test model request');
    const result=await models[value.modelRef].complete({messages:value.messages,tools:[],deadline,signal,
      ...(value.reasoningEffort===undefined?{}:{reasoningEffort:value.reasoningEffort}),
      ...(value.maxOutputTokens===undefined?{}:{maxOutputTokens:value.maxOutputTokens})});
    onCall({event:'test_version_model_turn',requestId,sessionId,modelRef:value.modelRef,deployment:result.deployment,
      requestedReasoningEffort:value.reasoningEffort??null,
      usage:result.usage??null,latencyMs:result.latencyMs});
    return {testVersion:1,result};
  };
}
