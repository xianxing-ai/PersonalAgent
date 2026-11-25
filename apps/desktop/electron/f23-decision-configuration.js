import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {workflowShadowReleaseDigest} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

export const F23_INITIALIZE_TOOL='workflow.decision_configuration.initialize';
export const F23_CONFIGURATION_ID='competition-f03-model';
export const F23_CONFIGURATION_KEY='f03-model';

/** One-time admission of the current explicit model into the existing F23 CAS ledger. */
export function createDesktopF23DecisionConfiguration({runtimeModule,getApplication,models,namespace,onUpdate=()=>{}}){
  const stateNamespace=namespace+':decision-configuration';let initializationTaskId;
  const fail=()=>{throw new ProtocolError('UNAUTHORIZED','原决策配置初始化授权已失效');};
  const consumer=()=>runtimeModule.createCompetitionDecisionConfigurationConsumer({runtime:getApplication().runtime,
    namespace:stateNamespace,stateKey:F23_CONFIGURATION_KEY,configurationId:F23_CONFIGURATION_ID,
    resolveExecutionModel:selection=>models.resolveExecutionModel(selection)});
  function assertOriginal(context,initial){
    const application=getApplication(),runtime=application.runtime;
    const invocation=application.readAuthorizationQuestionInvocation(context.taskId,context.runId);
    const task=application.readHostToolTask(context.taskId),grant=runtime.policy.get(context.authorizationRef);
    const record=runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId);
    if(context.signal.aborted||!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now()||!invocation||!task
      ||task.task.state!=='running'||task.task.cancelRequested||task.toolName!==F23_INITIALIZE_TOOL||task.toolVersion!=='1.0.0'
      ||!task.commandId.startsWith('f23-initialize:')||invocation.toolName!==F23_INITIALIZE_TOOL||invocation.deadline!==context.deadline
      ||!isDeepStrictEqual(initial,[snapshot(invocation.arguments.selection)])
      ||!isDeepStrictEqual(models.readExecutionModel('primary'),invocation.arguments.selection)
      ||!grant||grant.taskId!==context.taskId||grant.toolName!==F23_INITIALIZE_TOOL||grant.argumentsDigest!==toolArgumentsDigest(invocation.arguments)
      ||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=Date.now()||!grant.scopes.includes('workflow:configuration:write')
      ||!record||record.state!=='started'||record.policyDecision!=='allow'||!record.executionStarted||!runtime.isToolExecutionActive(record)
      ||!runtime.matchesToolExecutionInput(record,{arguments:invocation.arguments,scopeRef:context.authorizationRef}))fail();
  }
  function snapshot(selection){const parameters=models.resolveExecutionModel(selection);
    return {configurationId:F23_CONFIGURATION_ID,revision:1,version:'initial-1',parameters,parametersDigest:workflowShadowReleaseDigest(parameters)};}
  const tool={descriptor:{name:F23_INITIALIZE_TOOL,version:'1.0.0',sideEffect:'local_write',requiredScopes:['workflow:configuration:write'],
    idempotencySupport:false,recoverySupport:false,requiresPresence:false,
    inputSchema:{type:'object',additionalProperties:false,required:['selection'],properties:{selection:{type:'object',additionalProperties:false,
      required:['catalogRevision','modelId'],properties:{catalogRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},modelId:{type:'string',minLength:1,maxLength:200},
        reasoningEffort:{type:'string',minLength:1,maxLength:30}}}}},
    outputSchema:{type:'object',additionalProperties:false,required:['configurationId','revision','version','parametersDigest'],properties:{
      configurationId:{const:F23_CONFIGURATION_ID},revision:{const:1},version:{const:'initial-1'},parametersDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}}}},
    async execute(input,context){
      const application=getApplication(),initial=[snapshot(input.selection)],runtime=application.runtime;
      assertOriginal(context,initial);
      const port=runtimeModule.createRuntimeWorkflowShadowConfigurationPort({runtime,namespace:stateNamespace,stateKey:F23_CONFIGURATION_KEY,
        requiredScopes:['workflow:configuration:write'],authorize:async(scope,action,value)=>{
          if(action!=='initialize'||application!==getApplication())return false;assertOriginal(scope,value);return true;},
        initializeGuard:{runtime,assertCurrent:(scope,value)=>{if(application!==getApplication())fail();assertOriginal(scope,value);}}});
      await port.initialize(initial,context);assertOriginal(context,initial);
      const result=consumer().read();if(!isDeepStrictEqual(result?.executionModel,input.selection))throw new ProtocolError('RESULT_UNKNOWN','原决策配置初始化待核实');
      onUpdate();return result.configuration;
    }};
  return Object.freeze({tool,stateNamespace,stateKey:F23_CONFIGURATION_KEY,configurationId:F23_CONFIGURATION_ID,
    readDecisionConfiguration:()=>consumer().read(),assertDecisionConfiguration:binding=>consumer().assertCurrent(binding),
    snapshot(){try{if(!models.snapshot().catalog)throw Error('Model catalog unavailable');
      const current=consumer().read(),task=initializationTaskId?getApplication().runtime.getTask(initializationTaskId):undefined;
      return {available:true,initialized:!!current,...(current?{binding:current}:{}),...(task?{initialization:{taskId:task.taskId,state:task.state}}:{})};}
      catch{return {available:false,initialized:false,reason:'当前原模型目录或配置不可用'};}},
    initialize(input,{deadline,signal}){
      if(!input||Object.keys(input).sort().join(',')!=='catalogRevision,commandId'||typeof input.commandId!=='string'
        ||!input.commandId||input.commandId.length>128||input.catalogRevision!==models.snapshot().catalog?.revision||signal.aborted)
        throw new ProtocolError('INVALID_ARGUMENT','请重新选择当前模型目录');
      if(consumer().read())throw new ProtocolError('REVISION_CONFLICT','基线已经初始化；请读取原版本，后续变更须通过评测晋升');
      const selection=models.readExecutionModel('primary');
      const read=getApplication().submitHostToolTask({commandId:'f23-initialize:'+input.commandId,toolName:F23_INITIALIZE_TOOL,
        toolVersion:'1.0.0',arguments:{selection},deadline});
      initializationTaskId=read.task.taskId;
      return {taskId:read.task.taskId,state:read.task.state};
    },
  });
}
