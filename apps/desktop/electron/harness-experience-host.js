import {randomUUID} from 'node:crypto';

const positive=value=>Number.isSafeInteger(value)&&value>0;
function selection(value,kind) {
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.workflowId!=='string'
    ||!value.workflowId.trim()||value.workflowId.length>128)throw Error('请选择原开发经验版本');
  const keys=kind==='validate'?['workflowId','revision']:kind==='activate'
    ?['workflowId','revision','expectedActiveRevision']:['workflowId','expectedActiveRevision'];
  if(Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('开发经验请求字段不匹配');
  if(kind!=='stop'&&!positive(value.revision))throw Error('开发经验版本无效');
  if(kind!=='validate'&&value.expectedActiveRevision!==null&&!positive(value.expectedActiveRevision))throw Error('请刷新当前启用版本');
  return value;
}
const view=(version,active)=>({workflowId:version.workflowId,revision:version.revision,summary:version.summary,
  validation:version.validation,hasEvidence:typeof version.evidenceRef==='string',activeRevision:active?.revision??null});

/** H2's existing admin sender gate must guard these invocations. This host never grants activation itself. */
export function createHarnessExperienceAdminHost({getApplication,context}) {
  if(typeof getApplication!=='function'||typeof context!=='function')throw Error('需要受信开发经验宿主');
  const read=()=>{
    const app=getApplication();
    if(!app)return {available:false,entries:[],reason:'开发经验尚未接通'};
    const entries=[];
    for(const head of app.listCandidates()) {
      const active=app.readActive(head.workflowId);
      entries.push(view(head,active));
      if(active&&active.revision!==head.revision)entries.push(view(active,active));
    }
    return {available:true,entries};
  };
  return Object.freeze({snapshot:read,async invoke(name,payload={}) {
    if(name==='harness.experience.list')return read();
    const kind=name==='harness.experience.validate'?'validate':name==='harness.experience.activate'?'activate'
      :name==='harness.experience.stop'?'stop':undefined;
    if(!kind)throw Error('不支持的开发经验操作');
    const app=getApplication();if(!app)throw Error('开发经验尚未接通');
    const selected=selection(payload,kind),trusted=context();
    if(!trusted||typeof trusted.signal?.aborted!=='boolean'||!Number.isFinite(Date.parse(trusted.deadline))
      ||trusted.signal.aborted||Date.now()>=Date.parse(trusted.deadline))throw Error('开发经验操作已失效');
    if(kind==='validate')await app.validate(selected.workflowId,selected.revision,trusted);
    else if(kind==='activate')await app.activate({...selected,...trusted,operationId:randomUUID(),activatedAt:new Date().toISOString()});
    else app.stop({...selected,...trusted,operationId:randomUUID(),stoppedAt:new Date().toISOString()});
    // Only this fresh authoritative readback updates the UI; a click or accepted request is not success.
    return read();
  }});
}
