import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied=()=>{throw new ProtocolError('UNAUTHORIZED','原知识核实结果的出机确认已失效，未重复执行原写入');};

/** A fresh exact export decision through the existing native intent host. It
 * neither revives old in-memory permission nor permits any business execution. */
export function createF04RecoveryExportConsent({getApplication,confirmAuthorization,readDeploymentBinding,now=Date.now}) {
  return {async prepare(request){
    if(request?.phase!=='projection'||request.proposal?.toolName!=='knowledge.apply_note_patch')return false;
    const application=getApplication(),read=application?.readF04RecoveredWriteExport;
    if(typeof read!=='function')return false;
    const source={sourceTaskId:request.taskId,sourceRunId:request.runId,deadline:request.deadline,signal:request.signal};
    const binding=read.call(application,source);if(!binding)return false;
    const deployment=readDeploymentBinding();if(typeof deployment!=='string'||!deployment)return denied();
    if(binding.workflowId!=='F04'||binding.sourceTaskId!==request.taskId||binding.sourceRunId!==request.runId
      ||binding.proposalId!==request.proposal.proposalId||request.proposal.toolVersion!=='1.0.0'
      ||binding.argumentsDigest!==toolArgumentsDigest(request.proposal.arguments))return denied();
    const captured=structuredClone(binding),value=structuredClone(binding.projection),payloadDigest=digest(value),proposal=structuredClone(request.proposal);
    const current=()=>{
      try{return getApplication()===application&&readDeploymentBinding()===deployment&&!request.signal.aborted
        &&request.taskId===captured.sourceTaskId&&request.runId===captured.sourceRunId&&request.deadline===captured.deadline
        &&request.phase==='projection'&&request.signal===source.signal
        &&Number.isFinite(Date.parse(request.deadline))&&Date.parse(request.deadline)>now()
        &&isDeepStrictEqual(request.proposal,proposal)&&digest(value)===payloadDigest
        &&isDeepStrictEqual(read.call(application,source),captured);}catch{return false;}
    };
    if(!current())return denied();
    const allowed=await confirmAuthorization('workflow.export',value,{scope:{...captured,deployment,payloadDigest},
      deadline:request.deadline,signal:request.signal,isCurrent:current,
      summary:'允许将这次原知识写入已核实的状态及是否发生变化发送到当前固定 AgentArts 部署；不发送正文、路径或恢复日志，不重新执行写入。'});
    if(allowed!==true||!current())return denied();return true;
  }};
}
