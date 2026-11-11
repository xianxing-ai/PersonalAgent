import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

/** The same configured Knowledge source and public Fact host used by the existing tools. */
export function createDesktopF05WorkflowWorkerPorts({runtimeModule,getApplication,getKnowledgeSourceConfig,getPublicFactHost,authorizeExport,
  knowledgeToolExports,prepareCompetitionToolExport}={}) {
  if(typeof runtimeModule?.createF05WorkflowWorkerPorts!=='function'||typeof getApplication!=='function'
    ||typeof getKnowledgeSourceConfig!=='function'||typeof getPublicFactHost!=='function'||typeof authorizeExport!=='function'
    ||!Array.isArray(knowledgeToolExports)||typeof prepareCompetitionToolExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f05_desktop_source_ports_unavailable'};
  const unavailable=()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','F05 original public sources unavailable');};
  function sourceConfiguration(){
    const source=getKnowledgeSourceConfig(),config=source?.snapshot(),memory=getPublicFactHost();
    if(!config?.configured||!config.available||!config.enabled||config.dataLevel!=='public'||!config.cloudExportAllowed
      ||!Array.isArray(config.publicQueries)||!config.publicQueries.length||!memory?.memoryNamespace
      ||typeof memory.facts?.publicMemory?.listCurrent!=='function'||typeof memory.facts.readCurrentPublicFact!=='function')return;
    let lease;
    try{
      lease=source.acquire({sourceId:config.sourceId,configRevision:config.configRevision},new AbortController().signal);lease.assertCurrent();
      if(typeof lease.read?.readCitation!=='function'||typeof lease.read.assertCitationCurrent!=='function')return;
    }catch{return;}finally{lease?.release();}
    return {sourceId:config.sourceId,configRevision:config.configRevision,publicQueries:[...config.publicQueries],memoryNamespace:memory.memoryNamespace};
  }
  return runtimeModule.createF05WorkflowWorkerPorts({getApplication,sourceConfiguration,authorizeExport,prepareCompetitionToolExport,
    knowledgeToolExport:knowledgeToolExports.find(policy=>policy.toolName==='knowledge.search'&&policy.toolVersion==='1.0.0'),
    memory:{async listCurrent(request){
      const original=getPublicFactHost();if(!sourceConfiguration())return unavailable();
      const result=await original.facts.publicMemory.listCurrent(request),current=getPublicFactHost();
      if(current?.facts!==original.facts||current.memoryNamespace!==original.memoryNamespace||!sourceConfiguration())return unavailable();return result;
    }},
    readCurrentFact(ref){const original=getPublicFactHost();if(!sourceConfiguration())return unavailable();return original.facts.readCurrentPublicFact(ref);},
    assertCitationCurrent({source,configuration},scope){
      if(!isDeepStrictEqual(sourceConfiguration(),configuration)||source.vaultId!==configuration.sourceId)return unavailable();
      const sourceHost=getKnowledgeSourceConfig(),lease=sourceHost.acquire({sourceId:configuration.sourceId,configRevision:configuration.configRevision},scope.signal);
      try{
        lease.assertCurrent();if(typeof lease.read?.assertCitationCurrent!=='function')return unavailable();
        const result=lease.read.assertCitationCurrent({source,deadline:scope.deadline,signal:lease.signal});
        if(result!==undefined){void Promise.resolve(result).catch(()=>{});return unavailable();}
        lease.assertCurrent();if(getKnowledgeSourceConfig()!==sourceHost||!isDeepStrictEqual(sourceConfiguration(),configuration))return unavailable();
      }finally{lease.release();}
    },
    async readCitation({source,configuration},scope){
      if(!isDeepStrictEqual(sourceConfiguration(),configuration)||source.vaultId!==configuration.sourceId)return unavailable();
      const sourceHost=getKnowledgeSourceConfig(),lease=sourceHost.acquire({sourceId:configuration.sourceId,configRevision:configuration.configRevision},scope.signal);
      try{
        lease.assertCurrent();if(typeof lease.read?.readCitation!=='function')return unavailable();
        const result=await lease.read.readCitation({source,deadline:scope.deadline,signal:lease.signal});lease.assertCurrent();
        if(getKnowledgeSourceConfig()!==sourceHost||!isDeepStrictEqual(sourceConfiguration(),configuration))return unavailable();return result;
      }finally{lease.release();}
    }});
}
