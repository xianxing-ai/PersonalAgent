import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

/** Consume the existing public source, controlled writer and scoped Fact host. */
export function createDesktopF04WorkflowWorkerPorts({runtimeModule,getApplication,getKnowledgeSourceConfig,getPublicFactHost,
  knowledgeToolExports,prepareCompetitionToolExport,authorizeExport}={}) {
  if(typeof runtimeModule?.createF04WorkflowWorkerPorts!=='function'||typeof getApplication!=='function'
    ||typeof getKnowledgeSourceConfig!=='function'||typeof getPublicFactHost!=='function'||typeof authorizeExport!=='function'
    ||!Array.isArray(knowledgeToolExports)||typeof prepareCompetitionToolExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f04_desktop_source_ports_unavailable'};
  const unavailable=()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','F04 original scoped public sources unavailable');};
  const methods=['readCurrentPublicFact','readPublicSourceHead','recordPublicSource','drain','processImpacts','listImpactReceipts','readCompletedImpact'];
  function sourceConfiguration(){
    const source=getKnowledgeSourceConfig(),config=source?.snapshot(),memory=getPublicFactHost();
    if(!config?.configured||!config.available||!config.enabled||config.dataLevel!=='public'||!config.cloudExportAllowed
      ||!config.publicQueries?.length||!config.allowedNotePaths?.length||!memory?.memoryNamespace
      ||!['listCurrent','listHistory'].every(name=>typeof memory.facts?.publicMemory?.[name]==='function')
      ||!methods.every(name=>typeof memory.facts?.[name]==='function'))return;
    let lease;
    try{
      lease=source.acquire({sourceId:config.sourceId,configRevision:config.configRevision},new AbortController().signal);lease.assertCurrent();
      if(typeof lease.read?.readCitation!=='function'||typeof lease.read.assertCitationCurrent!=='function')return;
    }catch{return;}finally{lease?.release();}
    return {sourceId:config.sourceId,configRevision:config.configRevision,publicQueries:[...config.publicQueries],
      allowedNotePaths:[...config.allowedNotePaths],memoryNamespace:memory.memoryNamespace,writeAvailable:config.writeAvailable===true};
  }
  const facts=Object.fromEntries(methods.map(name=>[name,(...args)=>{
    if(!sourceConfiguration())return unavailable();return getPublicFactHost().facts[name](...args);
  }]));
  facts.publicMemory=Object.fromEntries(['listCurrent','listHistory'].map(name=>[name,async request=>{
    if(!sourceConfiguration())return unavailable();const original=getPublicFactHost(),result=await original.facts.publicMemory[name](request);
    const current=getPublicFactHost();if(current?.facts!==original.facts||current.memoryNamespace!==original.memoryNamespace||!sourceConfiguration())return unavailable();return result;
  }]));
  function acquire(source,configuration,scope){
    if(!isDeepStrictEqual(sourceConfiguration(),configuration)||source.vaultId!==configuration.sourceId)return unavailable();
    const host=getKnowledgeSourceConfig(),lease=host.acquire({sourceId:configuration.sourceId,configRevision:configuration.configRevision},scope.signal);
    const current=()=>{lease.assertCurrent();if(host!==getKnowledgeSourceConfig()||!isDeepStrictEqual(sourceConfiguration(),configuration))return unavailable();};
    return {lease,current};
  }
  return runtimeModule.createF04WorkflowWorkerPorts({getApplication,sourceConfiguration,facts,knowledgeToolExports,prepareCompetitionToolExport,authorizeExport,
    assertCitationCurrent({source,configuration},scope){
      const {lease,current}=acquire(source,configuration,scope);
      try{current();const result=lease.read.assertCitationCurrent({source,deadline:scope.deadline,signal:lease.signal});
        if(result!==undefined){void Promise.resolve(result).catch(()=>{});return unavailable();}current();}finally{lease.release();}
    },
    async readCitation({source,configuration},scope){
      const {lease,current}=acquire(source,configuration,scope);
      try{current();const result=await lease.read.readCitation({source,deadline:scope.deadline,signal:lease.signal});current();return result;}finally{lease.release();}
    },
    clearIndex(configuration,scope){
      if(scope.signal.aborted||Date.parse(scope.deadline)<=Date.now()||!isDeepStrictEqual(sourceConfiguration(),configuration))return unavailable();
      const source=getKnowledgeSourceConfig();if(typeof source.clearIndex!=='function')return unavailable();source.clearIndex();
      if(source!==getKnowledgeSourceConfig()||!isDeepStrictEqual(sourceConfiguration(),configuration))return unavailable();
    }});
}
