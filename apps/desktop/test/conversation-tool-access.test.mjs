import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,
  SUBAGENT_DISPATCH_TOOL_NAME,SUBAGENT_DISPATCH_TOOL_VERSION} from '@personal-agent/runtime/application';
import {createConversationToolAccess,projectComputerConversationStatus} from '../electron/conversation-tool-access.js';
import {createDesktopVoiceCommandHost} from '../electron/voice-command-host.js';
import {createVoiceRuntimeApprovalBridge} from '../electron/voice-runtime-approval-bridge.js';

// Local/Synthetic: real Runtime delegation and approval persistence; no audio/device/cloud.
const descriptor={name:'fixture.voice-pending',version:'1.0.0',sideEffect:'read',
  requiredScopes:['fixture:read'],requiresPresence:false,recoverySupport:true,idempotencySupport:true,
  inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
  outputSchema:{type:'object'}};
test('Live computer health excludes native prompts, paths and other conversation task identifiers',()=>{
  const value=projectComputerConversationStatus({state:'ready',available:true,providerAvailable:true,
    observationExportAllowed:false,taskId:'foreign-task',recoveryTaskId:'foreign-recovery-task',recoveryRunId:'foreign-original-run',
    presenceTasks:[{taskId:'another-ui'}],
    reason:'private window title',provider:{pythonExecutable:'private-path'},unknownCredential:'private-token'});
  assert.deepEqual(value,{state:'ready',available:true,providerAvailable:true,observationExportAllowed:false,
    verification:'not_device_verified'});
});
test('approval discovery follows the trusted F15 HostTask reader and hides opaque proofs from speech',()=>{
  const args={changes:['pelican.svg'],proof:'private-signature'};
  const approval={approvalId:'host-approval',taskId:'host',toolName:'workflow.host.f15_n06',state:'pending',revision:1,
    argumentsDigest:toolArgumentsDigest(args),expiresAt:new Date(Date.now()+30000).toISOString()};
  const tasks={parent:{taskId:'parent',state:'waiting_reconciliation'},
    child:{taskId:'child',state:'waiting_reconciliation'},host:{taskId:'host',state:'waiting_approval'}};
  const application={runtime:{getTask:id=>tasks[id],getApproval:()=>approval,
    listApprovals:({taskId})=>({items:taskId==='host'?[approval]:[]})},
    readToolConversation:id=>tasks[id]?'original-ui':undefined,
    readSubagentTasks:id=>id==='parent'?[{parentTaskId:'parent',taskId:'child'}]:[],
    readPendingOwnedWorkflowHostTask:id=>id==='child'?tasks.host:undefined,
    readPendingToolInvocation:()=>({toolName:approval.toolName,arguments:args})};
  const access=createConversationToolAccess({getApplication:()=>application,
    getConversations:()=>({containsConversation:id=>id==='original-ui'})});
  const scope={taskId:'parent',conversationId:'original-ui',deadline:approval.expiresAt,signal:new AbortController().signal};
  const found=access.readPendingApproval(scope);
  assert.equal(found.taskId,'host');assert.equal(found.requestTaskId,'parent');
  assert.match(found.summary,/交付到工作区/);assert.match(found.summary,/pelican\.svg/);
  assert.equal(found.summary.includes('private-signature'),false);
  assert.equal(access.readPendingApproval({...scope,conversationId:'foreign-ui'}),undefined);
});
async function until(condition) {
  const end=Date.now()+5000;
  while(Date.now()<end){if(condition())return;await new Promise(resolve=>setTimeout(resolve,5));}
  throw Error('Synthetic Runtime pending state did not arrive');
}
for(const count of [1,2])test(`same-conversation approval bridge: ${count} real delegated pending children`,async()=>{
  let application,executions=0;
  const dispatch=createDesktopSubagentDispatchTool({getRuntime:()=>application.runtime,
    getTools:()=>application.tools,runDefaultWorker:(subtask,worker,tools)=>application.runDefaultSubagentWorker(subtask,worker,tools)});
  application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    coordinationBinding:'synthetic-conversation-access',tools:[dispatch,{descriptor,
      async execute(input){executions++;return input;}}],
    automaticTools:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION}],
    coordination:{async execute(input){
      if(application.runtime.loadCheckpoint(input.taskId,'subtask-parent'))return {kind:'tool_proposal',
        proposalId:'synthetic-original-input',toolName:descriptor.name,toolVersion:descriptor.version,
        arguments:{value:'Synthetic exact input'},verification:'mock'};
      return {kind:'tool_proposal',proposalId:'synthetic-dispatch',toolName:SUBAGENT_DISPATCH_TOOL_NAME,
        toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,arguments:{subtasks:Array.from({length:count},(_,index)=>({
          subtaskId:`child-${index}`,role:'researcher',goal:`Synthetic child ${index}`}))},verification:'mock'};
    }}});
  try {
    const client=new Client(application,Date.now);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'Synthetic voice parent',conversationId:'dynamic-ui'},
      {idempotencyKey:`synthetic-access-${count}`,timeoutMs:30000});
    await until(()=>application.readSubagentTasks(taskId).length===count&&application.activeTaskCount===0);
    const access=createConversationToolAccess({getApplication:()=>application,
      getConversations:()=>({containsConversation:id=>id==='dynamic-ui'})});
    const scope={taskId,conversationId:'dynamic-ui',deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal};
    for(const child of application.readSubagentTasks(taskId)){
      assert.equal(access.resolveConversation(child.taskId),'dynamic-ui');
      assert.equal(access.authorizeTaskRead({taskId:child.taskId,conversationId:'foreign-ui'}),false);
    }
    assert.equal(access.readPendingApproval({...scope,conversationId:'foreign-ui'}),undefined);
    const pending=access.readPendingApproval(scope);
    if(count===2)assert.equal(pending,undefined,'voice cannot choose an arbitrary pending child');
    else {
      const child=application.readSubagentTasks(taskId)[0];
      assert.equal(pending.taskId,child.taskId);assert.equal(pending.requestTaskId,taskId);
      assert.match(pending.summary,/Synthetic exact input/);
      let currentCard=null,focused=0;
      const voice=createDesktopVoiceCommandHost({readCurrentQuestion:()=>currentCard,focusQuestion(){focused++;}});
      const bridge=createVoiceRuntimeApprovalBridge({readPendingApproval:access.readPendingApproval,
        readCurrentQuestion:()=>voice.snapshot('dynamic-ui'),focusQuestion(){focused++;}});
      assert.equal(await bridge.prepareTaskApproval(scope),null,'voice cannot create a second permission question');
      // Explicit Synthetic existing-card view. Original approval/task/args readback remains real Runtime data.
      currentCard={questionId:'synthetic-existing-card',sourceApprovalId:pending.approvalId,taskId:child.taskId,
        revision:1,state:'pending',expiresAt:pending.expiresAt};
      const question=await bridge.prepareTaskApproval(scope);
      assert.equal(question.taskId,child.taskId);assert.equal(question.sourceApprovalId,pending.approvalId);
      assert.equal(question.argumentsDigest,undefined,'public card never exposes the trusted argument digest');
      assert.equal(focused,1);
      assert.equal((await bridge.prepareTaskApproval(scope)).revision,question.revision,'reuse current exact question');
      const expired=createConversationToolAccess({getApplication:()=>application,
        getConversations:()=>({containsConversation:()=>true}),now:()=>Date.parse(pending.expiresAt)+1});
      assert.equal(expired.readApproval(pending.approvalId),undefined);
      const key=`application-tool-invocation:${pending.approvalId}`;
      const original=application.runtime.loadCheckpoint(child.taskId,key);
      application.runtime.saveCheckpoint(child.taskId,key,{...original,arguments:{value:'substituted'}});
      assert.equal(access.readApproval(pending.approvalId),undefined,'reject changed original tool arguments');
    }
    assert.equal(executions,0,'reading/preparing a question neither authorizes nor executes the tool');
  } finally {application.close();}
});
