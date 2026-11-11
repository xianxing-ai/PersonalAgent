import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {parseF20DocumentCandidate} from '@personal-agent/contracts/f20-candidate';
const fail=()=>{throw new ProtocolError('UNAUTHORIZED','F20 原图、来源或受信模型配置已变化');};

/** Main-only providers. The existing AgentArts composition supplies the pinned image. */
export function createF20WorkflowWorkerPorts({getApplication,codingWorkspace,readHarnessVersions,readReviewerIdentity,runtimeModule}) {
  const identity=()=>({versions:readHarnessVersions(),reviewer:readReviewerIdentity()});
  const current=scope=>{
    const now=identity();
    if(!now.reviewer||now.versions?.executionKind!=='real_host'||!now.versions.workflowVersion?.startsWith('agentarts-deployment:')
      ||scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))fail();
    const app=getApplication(),task=app.runtime.getTask(scope.taskId);
    const saved=app.runtime.loadCheckpoint(scope.taskId,'f20-desktop-provider:v1');
    if(saved&&!isDeepStrictEqual(saved,now))fail();
    if(task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state))fail();
    codingWorkspace.assertF20Current(scope);return app;
  };
  return {
    available(scope){try{current(scope);return codingWorkspace.f20Available(scope)===true;}catch{return false;}},
    async resolveInput(inputRef,scope){const app=current(scope),value=codingWorkspace.resolveF20Case(inputRef,scope);
      if(value)app.runtime.saveCheckpointOnce(scope.taskId,'f20-desktop-provider:v1',identity());current(scope);return value;},
    assertCurrent:current,
    async authorizeExport(input){current(input);const allowed=await codingWorkspace.authorizeF20Export(input);current(input);return allowed===true;},
    assertFrontier(request){
      const app=current(request),original=app.readF20WorkflowBinding(request);
      if(!original||!isDeepStrictEqual(original.input,request.input)||original.state.sessionId!==request.state.sessionId)fail();
      const proposal=request.proposal;
      if(proposal.toolName==='decision.choose_candidate'){
        let context;try{context=JSON.parse(proposal.arguments.context);}catch{fail();}
        if(context.workflowId!=='F20'||context.nodeId!==proposal.nodeId||!isDeepStrictEqual(context.input,original.input))fail();
        if(['F20_N02','F20_N04'].includes(proposal.nodeId)){
          if(!Array.isArray(context.candidateValues))fail();
          for(const value of context.candidateValues)if(value.abstain!==true)parseF20DocumentCandidate(value.value);
          const node=proposal.nodeId==='F20_N02'?'F20_N01':'F20_N03';
          const name=node==='F20_N01'?'workspace.read_text':'coding.repair.trial';
          const predecessor=Object.values(original.state.confirmedOperations??{}).find(item=>item.nodeId===node&&item.toolName===name);
          if(!predecessor||!isDeepStrictEqual(context.predecessors?.[node],predecessor.result))fail();
        }
      }
      return true;
    },
    async verifyCompletion(request){
      const app=current(request),context=app.readF20HarnessContext(request);if(!context)fail();
      if(await codingWorkspace.assertF20CompletionSources(request,context.baseline)!==true)fail();
      runtimeModule.verifyF20ReviewCompletion(app,request);
      const result=runtimeModule.verifyF20HarnessCompletion({...request,expected:{candidateId:request.candidateId,
        candidate:request.candidate,samplePath:request.samplePath,context}});
      current(request);return result;
    },
  };
}
