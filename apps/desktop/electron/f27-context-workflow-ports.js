import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createF27ContextWorkflowPorts} from '@personal-agent/runtime/application';

/** Same catalog/selected model used by the real Competition caller. Configuration
 * is conditional metadata; it cannot attest native tools, vision or a measured window. */
export function createDesktopF27WorkflowWorkerPorts({getApplication,models,readDeploymentBinding,authorizeExport,
  getKnowledgeSourceConfig,knowledgeToolExports,prepareCompetitionToolExport}={}) {
  if(typeof getApplication!=='function'||typeof models?.snapshot!=='function'||typeof models.resolveExecutionModel!=='function'
    ||typeof readDeploymentBinding!=='function'||typeof authorizeExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f27_desktop_model_context_unavailable'};
  const application=new Proxy({},{get(_target,name){const app=getApplication();
    if(!app)throw new ProtocolError('UNSUPPORTED_CAPABILITY','F27 Runtime unavailable');const value=app[name];return typeof value==='function'?value.bind(app):value;}});
  return createF27ContextWorkflowPorts({application,getApplication,authorizeExport,prepareCompetitionToolExport,
    knowledgeToolExport:knowledgeToolExports?.find(policy=>policy.toolName==='knowledge.search'&&policy.toolVersion==='1.0.0'),
    readKnowledge(scope,queryIndex){
      const source=getKnowledgeSourceConfig?.(),config=source?.snapshot(),query=config?.publicQueries?.[queryIndex];
      if(!config?.available||!config.configured||!config.enabled||config.dataLevel!=='public'||!config.cloudExportAllowed||typeof query!=='string'||!query)
        throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original public Knowledge query is unavailable');
      const lease=source.acquire({sourceId:config.sourceId,configRevision:config.configRevision},scope.signal);
      try{lease.assertCurrent();return {sourceId:config.sourceId,configRevision:config.configRevision,queryIndex,query};}
      finally{lease.release();}
    },readModels(scope){
    const binding=application.readF27ContextBinding(scope),selection=binding.selection,snapshot=models.snapshot(),deployment=readDeploymentBinding();
    if(!deployment||!snapshot.available||snapshot.catalog?.revision!==selection.catalogRevision
      ||!isDeepStrictEqual(models.resolveExecutionModel(selection),selection))throw new ProtocolError('REVISION_CONFLICT','F27 original model catalog changed');
    const entry=snapshot.catalog.models.find(model=>model.id===selection.modelId);
    if(!entry||entry.type!=='text'||!['available','unverified'].includes(entry.availability))throw new ProtocolError('UNSUPPORTED_CAPABILITY','F27 selected text model unavailable');
    return {revision:createHash('sha256').update(JSON.stringify([deployment,binding.destination,selection,entry])).digest('hex'),models:[{
      id:entry.id,verification:'conditional',type:'text',availability:entry.availability,requestProfile:entry.requestProfile,
      reasoningEfforts:[...entry.reasoningEfforts],...(selection.reasoningEffort?{selectedReasoningEffort:selection.reasoningEffort}:{})}]};
  }});
}
