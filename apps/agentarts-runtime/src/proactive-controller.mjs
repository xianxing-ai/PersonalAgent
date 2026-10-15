import {createHmac,timingSafeEqual} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {ProactiveWorkflowEngine,getProactiveWorkflowDescriptor,getProactiveWorkflowAdapterRequirements,proactiveWorkflowDigest} from '@personal-agent/agentarts';
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>{throw new ProtocolError('INVALID_ARGUMENT','Invalid proactive host protocol');};
const body=value=>{const {proof:_,...rest}=value;return rest;};
const identity=value=>({taskId:value.taskId,sessionId:value.sessionId,controlRevision:value.controlRevision,taskDeadline:value.taskDeadline});
/** A provenance signature is not an execution grant. Only the original Runtime/Policy may authorize proposals. */
export function createProactiveHostProofs(secret) {
  if(typeof secret!=='string'||Buffer.byteLength(secret)<32)invalid();
  const digest=(kind,value,binding)=>createHmac('sha256',secret).update('proactive-host-v1:'+proactiveWorkflowDigest({kind,binding:identity(binding),value:body(value)})).digest();
  return {
    sign(kind,value,binding){if(!plain(value))invalid();return {...value,proof:digest(kind,value,binding).toString('base64url')};},
    verify(kind,value,binding){
      if(!plain(value)||typeof value.proof!=='string')return false;
      try{const supplied=Buffer.from(value.proof,'base64url'),expected=digest(kind,value,binding);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}catch{return false;}
    },
  };
}
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
