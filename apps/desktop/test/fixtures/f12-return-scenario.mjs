import {ProactiveWorkflowEngine} from '@personal-agent/agentarts';
import {createProactiveHostProofs} from '@personal-agent/agentarts-runtime/proactive-controller';

// Actual Runtime control/CAS and ProactiveWorkflowEngine. Image authority and UI command are explicit fixtures.
export async function originalReturn(app,{conversationId='fixture-chat',action='return',unknown=false}={}) {
  const runtime=app.runtime,deadline=new Date(Date.now()+120000).toISOString(),signal=new AbortController().signal;
  const task=runtime.submitTask({goal:'Public original ongoing responsibility',conversationId,idempotencyKey:'f12-proactive-task'});
  const user=runtime.submitTask({goal:'Public explicit user return instruction',conversationId,idempotencyKey:'f12-proactive-user'});
  const contract={id:'f12-fixture-return',version:'1',qualifiedForMain:false,batchIndependent:true,criteria:'Public fixture original return',
    candidates:[{id:'continue',description:'Continue the original responsibility',action:'continue'},
      {id:'defer',description:'Retain the original responsibility',action:'defer'}]};
  const proofs=createProactiveHostProofs('fixture-f12-return-original-signing-secret-32');
  const engine=new ProactiveWorkflowEngine({checkpointSecret:'fixture-f12-return-original-signing-secret-32',decisionContracts:[contract],
    verifyEvent:(value,binding)=>proofs.verify('event',value,binding),verifyResponsibility:(value,binding)=>proofs.verify('responsibility',value,binding),
    verifyReceipt:(value,_proposal,binding)=>proofs.verify('receipt',value,binding),verifyControl:(value,binding)=>proofs.verify('control',value,binding)});
  let permitted;
  const host=app.createProactiveWorkflowHost({taskId:task.taskId,sessionId:'fixture-f12-return-session',taskDeadline:deadline,contractRef:contract.id,
    advancePort:async input=>{if(unknown)throw Error('Fixture remote control result unknown');
      return proofs.sign('advance_result',{requestId:input.requestId,...await engine.advance(input)},input);},
    verifyAdvance:(result,input)=>result.requestId===input.requestId&&proofs.verify('advance_result',result,input),
    sign:(kind,value,binding)=>proofs.sign(kind,value,binding),localDeviceAvailable:()=>true,
    verifyControlCommand:command=>JSON.stringify(command)===JSON.stringify(permitted)});
  const control=async(action,commandId)=>{
    permitted={commandId,action,expectedControlRevision:host.binding.controlRevision,sourceTaskId:user.taskId};
    try{return await host.control(permitted,{signal,deadline});}finally{permitted=undefined;}
  };
  let error;try{await control(action,'fixture-explicit-return');}catch(value){error=value;}
  return {task,user,host,error,control,source:{taskId:task.taskId,sessionId:host.binding.sessionId,sourceTaskId:user.taskId,
    commandId:'fixture-explicit-return',controlRevision:host.binding.controlRevision}};
}
