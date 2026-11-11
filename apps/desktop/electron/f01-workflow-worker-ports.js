import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createF01WorkflowContextPorts} from './f01-workflow-context-ports.js';
import {createF01WorkflowLifecyclePorts} from './f01-workflow-lifecycle-ports.js';
import {createF01ClarificationQuestionHost} from './f01-clarification-question-host.js';

export function createConfiguredDesktopF01WorkflowPorts({runtimeModule,getApplication,getPublicFactHost,getProactiveHost,getAuthorizationIntentHost,
  models,readDeploymentBinding,getKnowledgeSourceConfig,toolExports,prepareCompetitionToolExport,authorizeExport,onUpdate}={}){
  if(typeof runtimeModule?.createF01WorkflowWorkerPorts!=='function'||[getApplication,getPublicFactHost,getProactiveHost,getAuthorizationIntentHost,
    readDeploymentBinding,getKnowledgeSourceConfig,prepareCompetitionToolExport,authorizeExport].some(value=>typeof value!=='function')
    ||typeof models?.snapshot!=='function'||typeof models.resolveExecutionModel!=='function'
    ||!['knowledge.search','subagent.dispatch'].every(name=>toolExports?.some(policy=>policy.toolName===name&&policy.toolVersion==='1.0.0'
      &&typeof policy.accepts==='function'&&typeof policy.project==='function')))
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f01_original_desktop_ports_unavailable'};
  const fail=()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','F01 原公开检索来源不可用');};
  const questions=createF01ClarificationQuestionHost({getApplication,onUpdate}),lifecycle=createF01WorkflowLifecyclePorts({getApplication,getProactiveHost});
  function expansionInput(query,scope){const configuration=getKnowledgeSourceConfig()?.snapshot(),saved=getApplication().runtime.loadCheckpoint(scope.taskId,'f01:expansion-source');
    if(!saved||scope.signal.aborted||configuration?.dataLevel!=='public'||!configuration.cloudExportAllowed||!configuration.available||!configuration.enabled
      ||saved.sourceId!==configuration.sourceId||saved.configRevision!==configuration.configRevision||!isDeepStrictEqual(saved.publicQueries,configuration.publicQueries)
      ||!configuration.publicQueries.includes(query))return fail();return {sourceId:saved.sourceId,configRevision:saved.configRevision,query,limit:5};}
  const bundle=runtimeModule.createF01WorkflowWorkerPorts({getApplication,lifecycle,question:questions,toolExports,prepareCompetitionToolExport,authorizeExport,
    resolveExpansionInput:expansionInput,
    createContextPorts:assertCurrent=>createF01WorkflowContextPorts({getApplication,getPublicFactHost,getProactiveHost,getAuthorizationIntentHost,
      models,readDeploymentBinding,assertCurrent,authorizeExport:async()=>{throw new ProtocolError('UNAUTHORIZED','Use the original configured F01 exact export');}}),
    assertExpansionCurrent(query,result,scope){
      const source=getKnowledgeSourceConfig(),configuration=source?.snapshot();
      if(scope.signal.aborted||Date.parse(scope.deadline)<=Date.now()||!configuration?.configured||!configuration.available||!configuration.enabled
        ||configuration.dataLevel!=='public'||!configuration.cloudExportAllowed||!configuration.publicQueries?.includes(query))return fail();
      const binding={sourceId:configuration.sourceId,configRevision:configuration.configRevision,publicQueries:configuration.publicQueries};
      const runtime=getApplication().runtime,saved=runtime.loadCheckpoint(scope.taskId,'f01:expansion-source');
      if(saved!==undefined&&!isDeepStrictEqual(binding,saved))return fail();runtime.saveCheckpointOnce(scope.taskId,'f01:expansion-source',binding);
      const lease=source.acquire({sourceId:configuration.sourceId,configRevision:configuration.configRevision},scope.signal);
      try{lease.assertCurrent();if(typeof lease.read?.assertCitationCurrent!=='function')return fail();
        if(result!==undefined){if(!result||!Array.isArray(result.hits)||result.hits.length>5)return fail();
          for(const hit of result.hits){if(typeof hit.excerpt!=='string'||hit.excerpt.length>200||hit.source?.vaultId!==configuration.sourceId)return fail();
            const checked=lease.read.assertCitationCurrent({source:hit.source,deadline:scope.deadline,signal:lease.signal});
            if(checked!==undefined){void Promise.resolve(checked).catch(()=>{});return fail();}}}
        lease.assertCurrent();if(source!==getKnowledgeSourceConfig()||!isDeepStrictEqual(source.snapshot(),configuration))return fail();
      }finally{lease.release();}
    }});
  return {...bundle,questions};
}
