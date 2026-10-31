import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Exact graph payload consent uses the existing Runtime authorization card. It grants no tool execution. */
export function createWorkflowExportConsent({getApplication,confirmAuthorization,readDeploymentBinding,now=Date.now}) {
  return async request=>{
    try {
      const {taskId,workflowId,stage,deadline,signal}=request;
      if(!/^F(?:0[1-9]|1[0-9]|2[0-8])$/.test(workflowId)||!['initial','receipt','completion'].includes(stage))return false;
      const application=getApplication(),deployment=readDeploymentBinding();
      if(!application||typeof deployment!=='string'||!deployment)return false;
      const value=structuredClone(request.value),serialized=JSON.stringify(value);
      if(typeof serialized!=='string'||Buffer.byteLength(serialized,'utf8')>512*1024)return false;
      const proposal=application.runtime.loadCheckpoint(taskId,'competition-loop')?.pending;
      if(!proposal||typeof proposal.toolName!=='string'||!proposal.toolName.startsWith('workflow.'))return false;
      const proposalDigest=hash(proposal),payloadDigest=hash(value);
      const destination=application.readAuthorizationQuestionDestination(taskId);
      const current=()=>{
        try {
          const task=application.runtime.getTask(taskId);
          return getApplication()===application&&readDeploymentBinding()===deployment&&!signal.aborted
            &&!task.cancelRequested&&['running','waiting_approval'].includes(task.state)
            &&Date.parse(deadline)>now()&&application.runtime.loadCheckpoint(taskId,'application-deadline')===deadline
            &&hash(application.runtime.loadCheckpoint(taskId,'competition-loop')?.pending)===proposalDigest
            &&application.readAuthorizationQuestionDestination(taskId)===destination&&hash(value)===payloadDigest;
        }catch{return false;}
      };
      if(!current())return false;
      const allowed=await confirmAuthorization('workflow.export',value,{
        scope:{taskId,workflowId,stage,proposalDigest,payloadDigest,deployment,destination},deadline,signal,isCurrent:current,
        summary:`允许将 ${workflowId} 本次${stage==='initial'?'输入':stage==='receipt'?'工具回执':'完成结果'}发送到当前固定 AgentArts 部署；仅此原任务和所列内容，最多512KiB。此确认不授权工具执行。`,
      });
      return allowed===true&&current();
    }catch{return false;}
  };
}
