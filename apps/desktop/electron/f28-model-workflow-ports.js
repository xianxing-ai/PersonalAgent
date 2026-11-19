import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createF28ModelCandidateWorkflowPorts,readF28LocalModelCandidates,restrictF28SubagentTools} from '@personal-agent/runtime/application';

/** Original saved model settings select endpoints; saving never verifies support. */
export function createDesktopF28WorkflowWorkerPorts({getApplication,modelApiHost,authorizeExport,confirmModelExport}={}) {
  if(typeof getApplication!=='function'||typeof modelApiHost?.snapshot!=='function'||typeof modelApiHost.getModelGateway!=='function'
    ||typeof modelApiHost.getGuardedModelGateway!=='function'||typeof authorizeExport!=='function'||typeof confirmModelExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f28_desktop_model_ports_unavailable'};
  const application=new Proxy({},{get(_target,name){const app=getApplication();
    if(!app)throw new ProtocolError('UNSUPPORTED_CAPABILITY','F28 Runtime unavailable');const value=app[name];return typeof value==='function'?value.bind(app):value;}});
  const readModel=(id,configurationRef)=>{
    const snapshot=modelApiHost.snapshot(),entry=snapshot.models.find(item=>item.id===id&&item.available===true
      &&(configurationRef===undefined||item.configurationRef===configurationRef));
    const gateway=entry&&modelApiHost.getModelGateway(id,entry.configurationRef);
    if(!entry||!gateway?.deployment.capabilities.text||!modelApiHost.getGuardedModelGateway(id,entry.configurationRef,()=>{}))
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original configured F28 model unavailable');
    return {id:entry.id,configurationRef:entry.configurationRef,destination:{provider:entry.provider,baseUrl:entry.baseUrl,model:entry.model,
      modelId:entry.id,configurationRef:entry.configurationRef},deployment:structuredClone(gateway.deployment)};
  };
  const ports=createF28ModelCandidateWorkflowPorts({application,getApplication,authorizeExport,confirmModelExport,
    readModels(selection={}){const defaultId=modelApiHost.snapshot().defaultId;
      return Object.fromEntries(['research','analysis','coder'].map(role=>[role,readModel(selection[role]??defaultId)]));},
    async complete(model,request,beforeSend){
      const current=()=>{if(!isDeepStrictEqual(readModel(model.id,model.configurationRef),model))
        throw new ProtocolError('REVISION_CONFLICT','Original F28 model configuration changed');};
      current();const gateway=modelApiHost.getGuardedModelGateway(model.id,model.configurationRef,()=>{current();beforeSend();});
      if(!gateway)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original guarded ModelGateway unavailable');
      const result=await gateway.complete(request);current();return result;
    }});
  return {...ports,getToolsForSubtask:(subtask,worker,tools)=>restrictF28SubagentTools(application,subtask,worker,tools),
    readLocalCandidates:request=>readF28LocalModelCandidates(application,request)};
}
