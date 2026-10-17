import {ProtocolError} from '@personal-agent/contracts';
import {ProactiveWorkflowEngine,getProactiveWorkflowDescriptor,getProactiveWorkflowAdapterRequirements,createProactiveHostProofs} from '@personal-agent/agentarts';
export {createProactiveHostProofs} from '@personal-agent/agentarts';
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>{throw new ProtocolError('INVALID_ARGUMENT','Invalid proactive host protocol');};
export function createProactiveWorkflowController({receiptSecret,checkpointSecret=receiptSecret,decisionContracts=[],onStage}={}) {
  const proofs=createProactiveHostProofs(receiptSecret);
  const engine=new ProactiveWorkflowEngine({checkpointSecret,decisionContracts,onStage,
    verifyEvent:(v,r)=>Promise.resolve(proofs.verify('event',v,r)),
    verifyResponsibility:(v,r)=>Promise.resolve(proofs.verify('responsibility',v,r)),
    verifyReceipt:(v,_p,r)=>Promise.resolve(proofs.verify('receipt',v,r)),
    verifyControl:(v,r)=>Promise.resolve(proofs.verify('control',v,r))});
  return async ({value,sessionId,requestId,deadline,signal})=>{
    if(!plain(value)||value.proactiveVersion!==1)invalid();
    if(value.operation==='describe') {
      if(Object.keys(value).some(k=>!['proactiveVersion','operation'].includes(k)))invalid();
      return {proactiveVersion:1,verification:'unverified',descriptor:getProactiveWorkflowDescriptor(),adapters:getProactiveWorkflowAdapterRequirements(),
        contracts:decisionContracts.map(({id,version,qualifiedForMain})=>({id,version,qualifiedForMain}))};
    }
    const allowed=['proactiveVersion','operation','taskId','controlRevision','taskDeadline','checkpoint','events','responsibilities','receipts','control','hostFrame'];
    if(value.operation!=='advance'||Object.keys(value).some(k=>!allowed.includes(k))||!plain(value.hostFrame))invalid();
    const binding={...value,sessionId};
    // Request identity makes availability/capability observations fresh for this RPC; caller JSON cannot add a tool.
    const frame=value.hostFrame;
    if(frame.requestId!==requestId||!proofs.verify('frame',frame,binding))throw new ProtocolError('UNAUTHORIZED','Trusted current host availability required');
    if(Object.keys(frame).some(k=>!['requestId','hostAvailability','availableCapabilities','proof'].includes(k)))invalid();
    const result=await engine.advance({taskId:value.taskId,sessionId,requestId,deadline,signal,controlRevision:value.controlRevision,
      taskDeadline:value.taskDeadline,...(value.checkpoint?{checkpoint:value.checkpoint}:{}),events:value.events??[],responsibilities:value.responsibilities??[],
      receipts:value.receipts??[],...(value.control?{control:value.control}:{}),hostAvailability:frame.hostAvailability,availableCapabilities:frame.availableCapabilities});
    return proofs.sign('advance_result',{proactiveVersion:1,requestId,...result},binding);
  };
}
