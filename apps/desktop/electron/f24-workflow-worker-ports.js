import {ProtocolError} from '@personal-agent/contracts';
import {createF24RecoveryWorkflowPorts} from '@personal-agent/runtime/application';

/** Main supplies the same Knowledge source and tool host used by its existing
 * reconcileKnowledgeWriteTask adapter. No root paths or credentials are exported. */
export function createDesktopF24WorkflowWorkerPorts({getApplication,getKnowledgeSourceConfig,getKnowledgeTools,
  hostUserNamespace,authorizeExport}={}) {
  if(typeof getApplication!=='function'||typeof getKnowledgeSourceConfig!=='function'||typeof getKnowledgeTools!=='function'
    ||typeof authorizeExport!=='function'||!hostUserNamespace)
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f24_desktop_knowledge_ports_unavailable'};
  const application=new Proxy({},{get(_target,name){
    const app=getApplication();
    if(!app)throw new ProtocolError('UNSUPPORTED_CAPABILITY','F24 Runtime unavailable');
    const value=app[name];return typeof value==='function'?value.bind(app):value;
  }});
  return createF24RecoveryWorkflowPorts({application,hostUserNamespace,authorizeExport,sourceConfiguration(){
    const source=getKnowledgeSourceConfig(),config=source?.snapshot(),tools=getKnowledgeTools();
    if(!config?.configured||!config.enabled||!config.available||typeof tools?.reconcileWrite!=='function'||typeof tools.finalizeWrite!=='function')return;
    // New-write permission is not required to read a retained original journal.
    // Inspect the real readback lease, not only the catalog method's presence.
    const expected={sourceId:config.sourceId,configRevision:config.configRevision};
    const lease=source.acquire(expected,new AbortController().signal);
    try{lease.assertCurrent();if(typeof lease.reconcileWrite!=='function'||typeof lease.finalizeWrite!=='function')return;return expected;}
    finally{lease.release();}
  }});
}
