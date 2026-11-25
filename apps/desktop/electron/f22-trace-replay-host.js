import {readFileSync,writeFileSync,renameSync,mkdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {createF22TraceReplayWorkflowPorts} from '@personal-agent/runtime/application';

/** Main-only settings; the existing admin confirmation must precede configure.
 * This preference is neither an execution grant nor permission to export a trace. */
export function createDesktopF22TraceReplayConfiguration({userData}={}) {
  if(typeof userData!=='string'||!userData)throw new ProtocolError('INVALID_ARGUMENT','F22 userData required');
  const filename=join(userData,'f22-trace-replay.json');let disposed=false;
  function read(){
    let value;try{const raw=readFileSync(filename,'utf8');if(Buffer.byteLength(raw)>1024)throw Error();value=JSON.parse(raw);}
    catch(error){if(error.code==='ENOENT')return {enabled:false,revision:1};throw new ProtocolError('INVALID_ARGUMENT','F22 trace replay configuration invalid');}
    if(!value||Object.keys(value).sort().join(',')!=='enabled,revision'||typeof value.enabled!=='boolean'
      ||!Number.isSafeInteger(value.revision)||value.revision<1)throw new ProtocolError('INVALID_ARGUMENT','F22 trace replay configuration invalid');
    return value;
  }
  function snapshot(){if(disposed)throw new ProtocolError('UNSUPPORTED_CAPABILITY','F22 configuration closed');return read();}
  return {snapshot,
    configure({enabled,expectedRevision}={}){
      const previous=snapshot();
      if(typeof enabled!=='boolean')throw new ProtocolError('INVALID_ARGUMENT','F22 enabled must be boolean');
      if(expectedRevision!==previous.revision)throw new ProtocolError('REVISION_CONFLICT','F22 configuration changed');
      const next={enabled,revision:previous.revision+1},temporary=filename+'.'+randomUUID()+'.tmp';
      mkdirSync(userData,{recursive:true});
      try{writeFileSync(temporary,JSON.stringify(next),{encoding:'utf8',flag:'wx',mode:0o600});renameSync(temporary,filename);}
      finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
      return next;
    },close(){disposed=true;}};
}

/** Admission is read from the persisted opt-in and actual Runtime activity.
 * The original root/worker/HostBridge children are the only allowed active tasks. */
export function createDesktopF22WorkflowWorkerPorts({getApplication,configuration,hostUserNamespace,getToolDescriptor,authorizeExport}={}) {
  if(typeof getApplication!=='function'||typeof configuration?.snapshot!=='function'||!hostUserNamespace
    ||typeof getToolDescriptor!=='function'||typeof authorizeExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f22_desktop_trace_ports_unavailable'};
  const application=new Proxy({},{get(_target,name){const app=getApplication();
    if(!app)throw new ProtocolError('UNSUPPORTED_CAPABILITY','F22 Runtime unavailable');
    const value=app[name];return typeof value==='function'?value.bind(app):value;}});
  return createF22TraceReplayWorkflowPorts({application,hostUserNamespace,getToolDescriptor,authorizeExport,
    readAdmission(scope){
      const settings=configuration.snapshot(),app=getApplication(),parent=app?.readDelegatedUserTaskParent(scope.taskId);
      if(!parent)return;
      let beforeSequence,snapshotSequence,mainPriorityAvailable=true;
      do {
        const page=app.runtime.listTasks({limit:100,...(beforeSequence===undefined?{}:{beforeSequence}),
          ...(snapshotSequence===undefined?{}:{snapshotSequence})});
        snapshotSequence=page.snapshotSequence;
        for(const task of page.items) {
          if(!app.runtime.isTaskActive(task.taskId)||[scope.taskId,parent.taskId].includes(task.taskId))continue;
          const edge=app.runtime.loadCheckpoint(task.taskId,'coding-repair:parent');
          const intent=edge&&app.runtime.loadCheckpoint(scope.taskId,'owned-workflow:intent:'+edge.operationId);
          const original=edge&&app.runtime.loadCheckpoint(scope.taskId,'coding-repair:host:'+edge.operationId);
          if(edge?.taskId!==scope.taskId||intent?.taskId!==scope.taskId||intent.workflowId!=='F22'
            ||intent.deadline!==scope.deadline||original?.localTaskId!==task.taskId)mainPriorityAvailable=false;
        }
        beforeSequence=page.nextBeforeSequence;
      }while(mainPriorityAvailable&&beforeSequence!==undefined);
      return {revision:settings.revision,advancedEnabled:settings.enabled,shadowAllowed:settings.enabled,mainPriorityAvailable};
    }});
}
