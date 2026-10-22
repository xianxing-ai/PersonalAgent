import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {validateContextConfiguration} from './harness-configuration.js';

const denied=()=>{throw new ProtocolError('UNAUTHORIZED','Original context summary permission or source is unavailable');};
const unavailable=()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','Explicit context summary configuration is unavailable');};
const hash=value=>createHash('sha256').update(value).digest('hex');

/** Main-process composition only. Neither a model nor a renderer can enable this. */
export function createDesktopHarnessContextHost({readConfiguration,modelApi,getApplication,resolveConversation,
  readSnapshot,confirmExport,createModelSummarizer,now=Date.now}={}) {
  let active=true;
  const configuration=validateContextConfiguration(readConfiguration?.()??{enabled:false});
  const configurationDigest=hash(JSON.stringify(configuration));
  const enabled=configuration?.enabled===true;
  const state=()=>({state:active?(enabled?'configured':'disabled'):'closed',enabled:active&&enabled,
    ...(enabled?{modelId:configuration.modelId,configurationRef:configuration.configurationRef,
      policyVersion:configuration.policy.version}:{}),verification:'not_run'});
  if(!enabled)return {snapshot:state,preflight:(goal,prepared,messages,compile)=>compile(goal,prepared,messages),dispose:()=>{active=false;}};
  if(typeof modelApi?.getGuardedModelGateway!=='function'||typeof createModelSummarizer!=='function'
    ||typeof getApplication!=='function'||typeof resolveConversation!=='function'||typeof readSnapshot!=='function'
    ||typeof confirmExport!=='function')unavailable();
  const {modelId,configurationRef,maxOutputTokens,policy}=configuration;
  const selected=modelApi.snapshot().models.find(model=>model.id===modelId&&model.configurationRef===configurationRef&&model.available===true);
  const model=modelApi.getModelGateway(modelId,configurationRef);
  // Constructing a port does not contact an endpoint; unsupported factories fail closed.
  if(!selected||!model||!modelApi.getGuardedModelGateway(modelId,configurationRef,()=>{}))unavailable();
  const destination={provider:selected.provider,baseUrl:selected.baseUrl,model:selected.model,modelId,configurationRef};
  const assertConfiguration=()=>{
    if(!active||hash(JSON.stringify(readConfiguration?.()))!==configurationDigest)denied();
    const current=modelApi.snapshot().models.find(entry=>entry.id===modelId&&entry.configurationRef===configurationRef&&entry.available===true);
    if(!current||current.provider!==destination.provider||current.baseUrl!==destination.baseUrl||current.model!==destination.model)denied();
  };
  const assertCurrent=scope=>{
    assertConfiguration();const application=getApplication();
    if(!application||scope.signal.aborted||!(Date.parse(scope.deadline)>now()))denied();
    const task=application.runtime.getTask(scope.taskId);
    if(task.cancelRequested||task.state!=='running'||task.conversationId!==scope.conversationId||!resolveConversation(scope.taskId))denied();
    // An existing private-memory lease is specific to its original destination.
    // The summarizer never inherits or exports its prepared private goal.
    if(application.readPrivateTaskBinding?.(scope.taskId)!==undefined
      ||application.runtime.loadCheckpoint(scope.taskId,'private-memory:consumption:v1')!==undefined)denied();
  };
  const summarize=async input=>{
    assertCurrent(input.scope);
    const source=input.authorizationSource;
    if(!source||typeof source.configurationRef!=='string'||!source.configurationRef.trim()
      ||!Number.isSafeInteger(source.sourceCount)||source.sourceCount<1||source.sourceCount>policy.maxSourceMessages
      ||!['sourceDigest','tailDigest','goalFrameDigest'].every(key=>/^[a-f0-9]{64}$/u.test(source[key]??'')))denied();
    const sourceBinding=JSON.stringify(source);
    const policyBinding=hash(JSON.stringify({configurationDigest,destination,policy,conversationId:input.scope.conversationId,
      cutoff:input.scope.cutoff,source}));
    const assertSourceBinding=()=>{assertCurrent(input.scope);if(JSON.stringify(input.authorizationSource)!==sourceBinding)denied();};
    const summarizeWithModel=createModelSummarizer({model,configurationRef,maxOutputTokens,now,assertModelConfiguration:assertConfiguration,
      authorizeModelRequest:async(request,scope)=>{
        assertSourceBinding();
        const payload={purpose:'conversation_history_summary',destination,request:{messages:structuredClone(request.messages),
          tools:[],requiredCapabilities:['text'],maxOutputTokens:request.maxOutputTokens,deadline:request.deadline}};
        const serialized=JSON.stringify(payload);
        if(/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9_.-]{16,}|\bsk-[A-Za-z0-9_-]{16,})/u.test(serialized))denied();
        if(await confirmExport({taskId:scope.taskId,kind:'harness_context_summary',payload,policyBinding,deadline:scope.deadline,signal:scope.signal})!==true)denied();
        assertSourceBinding();
      },guardedComplete:async(request,beforeSend)=>{
        assertSourceBinding();
        const isolated=modelApi.getGuardedModelGateway(modelId,configurationRef,()=>{assertSourceBinding();beforeSend();});
        if(!isolated)unavailable();
        return isolated.complete(request);
      }});
    return summarizeWithModel(input);
  };
  return {snapshot:state,runtimeHooks:{policy:structuredClone(policy),modelConfigurationRef:modelId+'@'+configurationRef,summarize,assertCurrent,
    readSnapshot:(scope,maxMessages)=>{assertCurrent(scope);return readSnapshot(scope,maxMessages);}},
    preflight:(goal,prepared,messages,compile)=>{
      assertConfiguration();compile(goal,prepared,[]);
      try{return compile(goal,prepared,messages);}catch(error){
        if(error?.code!=='INVALID_ARGUMENT')throw error;
        let boundary=Math.max(0,messages.length-policy.retainMessages);
        while(boundary>0&&boundary<messages.length&&messages[boundary]?.taskId
          &&messages[boundary]?.taskId===messages[boundary-1]?.taskId)boundary--;
        if(!boundary)throw error;
        const tail=compile(goal,prepared,messages.slice(boundary));
        if(tail.length>=policy.targetCharacters)throw error;
        // Actual summary text and final budget are checked by Runtime, after consent.
        return tail;
      }
    },dispose:()=>{active=false;}};
}
