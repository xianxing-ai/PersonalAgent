import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,CODING_REPAIR_WORKFLOW_TOOL} from '../dist/application.js';
import {createRuntimeCodingRepairWorkerCapability} from '../dist/application/coding-repair-worker-capability.js';
import {createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {createRuntimeCodingRepairSignedReview,codingRepairReviewBytes} from '../dist/application/coding-repair-signed-review.js';

// Synthetic frontier and coding host. The real TaskRuntime/Policy/ToolGateway,
// host-child identities, approval recovery and source-export checks are exercised.
const sha=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>sha(JSON.stringify(value));
const source='export const answer = 1;\n',updated='export const answer = 2;\n';
const snapshot=(after=false)=>({snapshotId:after?'after':'before',packages:[{id:'pkg',path:'',dependencies:[]}],
  files:[{path:'app.js',sha256:sha(after?updated:source),packageId:'pkg',kind:'source'}]});
function fixture({metadata=true,sourceAllowed=true,unknown=false,bindImage='synthetic-image',delegate=true,depth=2,proposalSubtask={},verification='unverified'}={}){
  let app;const cloud=[],images=[],calls=[],exports=[];
  const session='synthetic-session';
  const tool=(name,sideEffect,execute,properties={},required=[])=>({descriptor:{name,version:'1.0.0',sideEffect,
    requiredScopes:['synthetic:coding'],inputSchema:{type:'object',properties,required,additionalProperties:false},
    outputSchema:{type:'object'},idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    execute:async(args,context)=>{calls.push({name,taskId:context.taskId,runId:context.runId});return execute(args,context);}});
  const sessionSchema={sessionId:{type:'string'}};
  const patch={path:'app.js',expectedSha256:sha(source),edits:[{oldText:'1',newText:'2'}]};
  const tools=[tool('coding.repair.start','local_write',async(args,context)=>({version:1,
    session:{version:1,sessionId:session,taskId:context.taskId,workspaceId:'synthetic-workspace',mode:args.mode,baselineSnapshotId:'before'},
    initialSnapshot:snapshot(),recipes:[{recipeId:'unit',packageIds:['pkg'],required:true}]}),
    {mode:{type:'string',enum:['main','isolated']},allowedPaths:{type:'array',items:{type:'string'}}},['mode']),
  tool('coding.repair.read','read',async()=>({path:'app.js',sha256:sha(source),content:source}),
    {...sessionSchema,path:{type:'string'}},['sessionId','path']),
  tool('workspace.coding_snapshot','read',async()=>snapshot(),sessionSchema,['sessionId']),
  tool('workflow.host.f15_n04','read',async()=>({sessionId:session,approved:true,previewed:true,patches:[{
    path:'app.js',beforeSha256:sha(source),afterSha256:sha(updated),changed:true}]}),
    {...sessionSchema,patches:{type:'array',items:{type:'object'}}},['sessionId','patches']),
  tool('workflow.host.f15_n05','local_write',async(_args,context)=>{
    if(unknown)throw new ProtocolError('RESULT_UNKNOWN','Synthetic unknown write');
    return {version:1,sessionId:session,snapshot:snapshot(true),verification:[{version:1,sessionId:session,
      runId:context.runId,recipeId:'unit',packageIds:['pkg'],inputSnapshotId:'after',files:snapshot(true).files,
      exitCode:0,status:'VALID',evidenceRefs:[],diagnostics:[]}]};
  },{...sessionSchema,patches:{type:'array',items:{type:'object'}},recipeIds:{type:'array',items:{type:'string'}}},['sessionId','patches','recipeIds']),
  tool('workflow.host.f15_n06','local_write',async()=>({version:1,sessionId:session,state:'published',
    files:[{path:'app.js',beforeSha256:sha(source),afterSha256:sha(updated)}],evidenceRefs:[]}),
    {...sessionSchema,version:{const:1},baselineSnapshotId:{type:'string'},snapshotId:{type:'string'},paths:{type:'array',items:{type:'string'}},
      verificationRunIds:{type:'array',items:{type:'string'}}},['version','sessionId','baselineSnapshotId','snapshotId','paths','verificationRunIds'])];
  tools.push(createWorkflowDecisionTool({selector:{select:async()=> 'selected'}}));
  // Synthetic signed reviewer: only the fixture owns this ephemeral key. Every
  // operation still enters the original Runtime, Policy and ToolGateway.
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'),reviews=new Map();
  const review=createRuntimeCodingRepairSignedReview(()=>app,{reviewerId:'synthetic-reviewer',authorId:'synthetic-author',policyId:'fixture-policy',
    publicKey:publicKey.export({type:'spki',format:'pem'}),assertCurrent:()=>true,read:key=>{
      const id=JSON.stringify(key);let value=reviews.get(id);if(!value){const signed={version:1,...key,reviewerId:'synthetic-reviewer',
        authorId:'synthetic-author',policyId:'fixture-policy',decision:'approved',reviewedAt:new Date(Date.now()-1000).toISOString(),
        expiresAt:new Date(Date.now()+120000).toISOString()};value={review:signed,signature:sign(null,codingRepairReviewBytes(signed),privateKey).toString('base64')};reviews.set(id,value);}
      return value;}});
  tools.push(review.tool);
  tools.unshift(createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)}));
  const proposal={kind:'tool_proposal',proposalId:'same-worker-f15',toolName:CODING_REPAIR_WORKFLOW_TOOL,toolVersion:'1.0.0',
    arguments:{subtasks:[{subtaskId:'repair',role:'coder',goal:'Repair the synthetic app',...proposalSubtask}],codingRepair:{mode:'main'}},verification};
  const image={bindingId:bindImage,receiptSecret:async()=> 'synthetic-private-receipt-key-at-least-32-chars',advance:async request=>{
    images.push(structuredClone({...request,signal:undefined}));
    const phase=request.checkpoint?Number(request.checkpoint.split('-').at(-1)):0;
    if(phase>0)assert.equal(request.receipts[0].state,'confirmed');
    const decision=(nodeId,value)=>({context:JSON.stringify({workflowId:'F15',nodeId,candidateValues:[{id:'selected',value},{id:'review',value:null,abstain:true}]}),
      candidates:[{id:'selected',description:'Synthetic selection'},{id:'review',description:'Synthetic abstention'}],requestId:`${request.requestId}-${nodeId}`});
    const check=request.receipts.find(receipt=>receipt.nodeId==='F15_N05')?.result;
    const specs=phase===0?[
      ['workspace.coding_snapshot','F15_N01',{sessionId:session}],
      ['decision.choose_candidate','F15_N02',decision('F15_N02',{scope:['app.js']})],
      ['coding.repair.read','F15_N03',{sessionId:session,path:'app.js'}],
      ['decision.choose_candidate','F15_N03',decision('F15_N03',{diagnosis:'Synthetic candidate',patches:[patch]})],
      ['workflow.host.f15_n04','F15_N04',{sessionId:session,patches:[patch]}]]:
      phase===1?[['workflow.host.f15_n05','F15_N05',{sessionId:session,patches:[patch],recipeIds:['unit']}]]:
      phase===2?[['workflow.host.f15_n06','F15_N06',{version:1,sessionId:session,baselineSnapshotId:'before',snapshotId:'after',
        paths:['app.js'],verificationRunIds:[check?.verification?.[0]?.runId]}]]:[];
    const proposals=specs.map(([name,node,args],index)=>{const descriptor=request.availableTools.find(tool=>tool.name===name);
      const operationId=`synthetic-${request.taskId}-${phase}-${index}`;
      return {kind:'tool_proposal',nodeId:node,operationId,proposalId:operationId,inputDigest:hash(args),originControlRevision:0,
        toolName:name,toolVersion:'1.0.0',toolSchemaDigest:hash(descriptor.inputSchema),arguments:args,resourceKeys:['synthetic-workspace'],
        effect:['workflow.host.f15_n05','workflow.host.f15_n06'].includes(name)?'write':'read'};});
    return {workflowVersion:'1.0.0',workflowId:'F15',state:phase===3?'settled':'awaiting_host',verification:'unverified',
      checkpoint:`synthetic-stage-${phase+1}`,codingRepair:{snapshotId:'after'},
      nodes:{...Object.fromEntries(specs.map(([,node])=>[node,{state:'waiting_receipt'}])),
        ...(phase===3?{F15_N06:{state:'completed',value:{state:'published'}}}:{})},unavailable:[],feedback:[],proposals};
  }};
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',...(delegate?{delegateUserTasks:true}:{}),
    hostUserNamespace:'synthetic-owner',coordinationBinding:'synthetic-fixed-deployment',tools,
    readConversationPreference:()=>({depth,fast:false}),
    coordination:{execute:async request=>{cloud.push(request);
      if(request.continuation)return {kind:'text',text:'Synthetic verified workflow continuation',verification:'unverified'};
      if(delegate&&app.runtime.getTask(request.taskId).conversationId==='user-chat')return {kind:'text',text:'Synthetic parent summary',verification:'unverified'};
      return structuredClone(proposal);
    }},codingRepair:{image,authorizeMetadata:input=>{if(!metadata)throw new ProtocolError('UNAUTHORIZED','Synthetic metadata denied');exports.push({kind:'metadata',taskId:input.taskId,value:input.value});},
      projectSource:async input=>{if(!sourceAllowed)throw new ProtocolError('UNAUTHORIZED','Synthetic exact source denied');exports.push({kind:'source',taskId:input.taskId});return input.receipt.result;},
      independentReview:review.port,independentReviewProducer:true},
    automaticTools:tools.filter(tool=>tool.descriptor.sideEffect==='read').map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0'})),
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result})),
  });
  return {app,cloud,images,calls,exports,proposal};
}
async function drive(f,client,root,{approve=true,onApproval,legacyHosts=false}={}){
  for(let attempt=0;attempt<600;attempt++){
    const tasks=[f.app.runtime.getTask(root),...f.app.readSubagentTasks(root)];
    for(const task of [...tasks]){const host=f.app.readPendingOwnedWorkflowHostTask(task.taskId);if(host)tasks.push(host);}
    if(legacyHosts)tasks.push(...f.app.runtime.listTasks({limit:30}).items.filter(task=>task.conversationId?.startsWith('host-tool:')));
    if(approve)for(const task of tasks)for(const approval of f.app.runtime.listApprovals({taskId:task.taskId,state:'pending'}).items){
      const original=f.app.readPendingToolInvocation(task.taskId,approval.approvalId);
      assert.ok(original,'Exact original start/host nested arguments are publicly readable');
      assert.equal(original.argumentsDigest,approval.argumentsDigest);
      await onApproval?.(task,approval,original);
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    }
    const result=f.app.runtime.getTask(root);
    if(f.app.activeTaskCount===0&&(['succeeded','failed','cancelled'].includes(result.state)||!approve))return result;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Synthetic F15 did not settle: '+JSON.stringify(f.app.runtime.listTasks({limit:30}).items));
}
async function submit(f){const client=new Client(f.app);await client.connect();const task=await client.call('task.submit',
  {goal:'Use F15 for the synthetic source',conversationId:'user-chat'},{idempotencyKey:'synthetic-f15',timeoutMs:60000});return {client,task};}

test('main conversation F15 runs in the original user-work and resumes exact start plus host approvals',async()=>{
  const f=fixture(),{client,task}=await submit(f);let hostApprovals=0;
  try{
    const final=await drive(f,client,task.taskId,{onApproval:async(current,approval,original)=>{
      if(!f.app.runtime.getTask(current.taskId).conversationId?.startsWith('host-tool:'))return;
      hostApprovals++;assert.equal(f.app.readToolConversation(current.taskId),'user-chat');
      assert.equal(original.toolName,approval.action);
      // The exact original HostIntent is sufficient even when a legacy wrapper
      // did not save the redundant application-tool-invocation checkpoint.
      const key='application-tool-invocation:'+approval.approvalId,load=f.app.runtime.loadCheckpoint.bind(f.app.runtime);
      f.app.runtime.loadCheckpoint=(id,name)=>id===current.taskId&&name===key?undefined:load(id,name);
      try{assert.deepEqual(f.app.readPendingToolInvocation(current.taskId,approval.approvalId),original);}
      finally{f.app.runtime.loadCheckpoint=load;}
      const intent=load(current.taskId,'host-tool-intent');
      for(const replacement of [{...intent,namespace:'foreign-owner'},{...intent,deadline:'invalid'}]){
        f.app.runtime.loadCheckpoint=(id,name)=>id===current.taskId&&name==='host-tool-intent'?replacement:load(id,name);
        try{assert.equal(f.app.readPendingToolInvocation(current.taskId,approval.approvalId),undefined);
          assert.equal(f.app.readToolConversation(current.taskId),undefined);}
        finally{f.app.runtime.loadCheckpoint=load;}
      }
      f.app.runtime.loadCheckpoint=(id,name)=>id===current.taskId&&name==='coding-repair:parent'?undefined:load(id,name);
      try{assert.equal(f.app.readToolConversation(current.taskId),undefined,'HostIntent alone cannot claim the user conversation');}
      finally{f.app.runtime.loadCheckpoint=load;}
    }});
    assert.equal(final.state,'succeeded',JSON.stringify(final.error));
    const [child]=f.app.readSubagentTasks(task.taskId);assert.equal(child.state,'succeeded');assert.equal(child.role,'coordinator');
    assert.deepEqual(f.app.readSubagentTasks(child.taskId),[],'No recursive coder subtask was created');
    assert.equal(hostApprovals,2);assert.equal(f.calls.filter(call=>call.name==='coding.repair.start').length,1);
    assert.equal(f.calls.filter(call=>call.name==='workflow.host.f15_n05').length,1);
    assert.equal(f.images.length,4);assert.ok(f.exports.some(item=>item.kind==='source'));
    assert.equal(f.cloud.filter(request=>request.taskId===child.taskId).length,2,'Approvals resume the original proposal without requerying it');
    const continuation=f.cloud.find(request=>request.taskId===child.taskId&&request.continuation)?.continuation;
    assert.equal(continuation.result.workflowId,'F15');assert.equal(continuation.result.state,'settled');
    assert.equal(JSON.stringify(continuation.result).includes(source),false);
    assert.ok(f.app.runtime.readToolExecutions(child.taskId).every(record=>record.toolName!==CODING_REPAIR_WORKFLOW_TOOL),
      'The same-worker capability is not summarized as a second child dispatch');
  }finally{f.app.close();}
});
test('the actual fixed depth-one worker advertises only inherited execution settings and completes F15 without replacement',async()=>{
  const f=fixture({depth:1}),{client,task}=await submit(f);
  try{
    const final=await drive(f,client,task.taskId);assert.equal(final.state,'succeeded',JSON.stringify(final.error));
    const [child]=f.app.readSubagentTasks(task.taskId);assert.equal(child.state,'succeeded');
    const initial=f.cloud.find(request=>request.taskId===child.taskId&&!request.continuation);
    const entry=initial.availableTools.find(tool=>tool.name===CODING_REPAIR_WORKFLOW_TOOL);
    assert.ok(entry);const subtask=entry.inputSchema.properties.subtasks.items;
    for(const key of ['model','reasoningEffort','thinkingDepth'])assert.equal(Object.hasOwn(subtask.properties,key),false,key);
    assert.equal(subtask.additionalProperties,false);
    assert.equal(f.app.runtime.loadCheckpoint(child.taskId,'subtask-thinking-binding').depth,1);
    assert.deepEqual(f.app.runtime.loadCheckpoint(child.taskId,'competition-tool-catalog').entries,initial.availableTools,
      'approval and workflow continuation preserve the initial directory');
    const root=f.app.tools.list().find(tool=>tool.name===CODING_REPAIR_WORKFLOW_TOOL);
    for(const key of ['model','reasoningEffort','thinkingDepth'])assert.ok(root.inputSchema.properties.subtasks.items.properties[key],key);
    assert.equal(f.images.length,4);assert.deepEqual(f.app.readSubagentTasks(child.taskId),[]);
  }finally{f.app.close();}
});

test('an explicit root without fixed worker context retains execution choices even when user delegation is enabled',async()=>{
  const f=fixture();
  try{
    const task=f.app.runtime.submitTask({goal:'Synthetic explicit root directory',conversationId:'explicit-root',idempotencyKey:'explicit-root-directory'});
    const deadline=new Date(Date.now()+60_000).toISOString();
    const final=await f.app.runtime.runTask(task.taskId,async worker=>{
      worker.saveCheckpoint('application-profile','huawei_ict_agentarts');worker.saveCheckpoint('application-deadline',deadline);
      const directory=await f.app.prepareCompetitionToolCatalog({taskId:task.taskId,deadline,signal:worker.signal});
      const entry=directory.find(tool=>tool.name===CODING_REPAIR_WORKFLOW_TOOL);assert.ok(entry);
      for(const key of ['model','reasoningEffort','thinkingDepth'])assert.ok(entry.inputSchema.properties.subtasks.items.properties[key],key);
      assert.equal(f.app.runtime.loadCheckpoint(task.taskId,'subtask-coordination-binding'),undefined);
      return {resultSummary:'Synthetic root directory checked'};
    },{deadline,sideEffect:'read'});
    assert.equal(final.state,'succeeded',JSON.stringify(final.error));assert.equal(f.images.length,0);assert.equal(f.calls.length,0);
  }finally{f.app.close();}
});

for(const [key,value] of [['model','substitute-model'],['reasoningEffort','high'],['thinkingDepth',3]])
test(`the same-worker catalog rejects a forged ${key} before any F15 operation`,async()=>{
  const f=fixture({depth:1,proposalSubtask:{[key]:value}}),{client,task}=await submit(f);
  try{
    await drive(f,client,task.taskId);const [child]=f.app.readSubagentTasks(task.taskId);
    assert.equal(child.state,'failed');assert.equal(child.error.code,'INVALID_ARGUMENT');
    assert.equal(f.app.runtime.loadCheckpoint(child.taskId,'subtask-thinking-binding').depth,1);
    assert.equal(f.images.length,0);assert.equal(f.calls.length,0);
  }finally{f.app.close();}
});

test('the original runtime worker guards still reject execution replacement without a model-facing catalog',async t=>{
  for(const [key,value] of [['model','substitute-model'],['reasoningEffort','high'],['thinkingDepth',3]])await t.test(key,async()=>{
    const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});
    try{
      const task=app.runtime.submitTask({goal:'Synthetic fixed worker guard',conversationId:'synthetic-guard',idempotencyKey:'fixed-worker-'+key});
      const deadline=new Date(Date.now()+60_000).toISOString();
      app.runtime.saveCheckpoint(task.taskId,'application-deadline',deadline);
      app.runtime.saveCheckpoint(task.taskId,'subtask-thinking-binding',{depth:1});
      app.runtime.saveCheckpoint(task.taskId,'execution-model',{modelId:'original-model',reasoningEffort:'low'});
      const original={kind:'tool_proposal',proposalId:'synthetic-fixed-'+key,toolName:CODING_REPAIR_WORKFLOW_TOOL,toolVersion:'1.0.0',
        arguments:{subtasks:[{subtaskId:'repair',role:'coder',goal:'Repair the synthetic app',[key]:value}],codingRepair:{mode:'main'}},verification:'unverified'};
      const capability=createRuntimeCodingRepairWorkerCapability(app,{image:{bindingId:'synthetic-fixed',
        receiptSecret:async()=>assert.fail('guard must precede image access'),advance:async()=>assert.fail('guard must precede image access')},
        authorizeMetadata:()=>assert.fail('guard must precede exports'),projectSource:async()=>assert.fail('guard must precede exports')},
      ()=>assert.fail('guard must precede tool access'));
      await assert.rejects(capability.dispatch(original,{taskId:task.taskId,revision:task.revision,deadline,signal:new AbortController().signal,
        loadCheckpoint:name=>app.runtime.loadCheckpoint(task.taskId,name),saveCheckpoint:(name,value)=>app.runtime.saveCheckpoint(task.taskId,name,value)}),
      {code:'REVISION_CONFLICT'});
      assert.equal(app.runtime.loadCheckpoint(task.taskId,'coding-repair:worker-capability'),undefined);
    }finally{app.close();}
  });
});

test('legacy direct-root coding dispatch keeps its original coder child and graph runner',async()=>{
  const f=fixture({delegate:false}),{client,task}=await submit(f);
  try{
    const final=await drive(f,client,task.taskId,{legacyHosts:true});
    assert.equal(final.state,'succeeded',JSON.stringify(final.error));
    const [child]=f.app.readSubagentTasks(task.taskId);assert.equal(child.role,'coder');assert.equal(child.state,'succeeded');
    assert.equal(f.app.runtime.loadCheckpoint(child.taskId,'coding-repair:worker-capability'),undefined);
    const entry=f.cloud.find(request=>request.taskId===task.taskId&&!request.continuation).availableTools.find(tool=>tool.name===CODING_REPAIR_WORKFLOW_TOOL);
    for(const key of ['model','reasoningEffort','thinkingDepth'])assert.ok(entry.inputSchema.properties.subtasks.items.properties[key],key);
    assert.equal(f.images.length,4);assert.equal(f.calls.filter(call=>call.name==='coding.repair.start').length,1);
  }finally{f.app.close();}
});
test('original F15 proposal, deployment and deadline cannot change across start approval',async()=>{
  const f=fixture(),{client,task}=await submit(f);
  try{
    let child;
    for(let n=0;n<200;n++){
      child=f.app.readSubagentTasks(task.taskId)[0];
      if(child&&f.app.activeTaskCount===0&&f.app.runtime.listApprovals({taskId:child.taskId,state:'pending'}).items.length)break;
      for(const approval of f.app.runtime.listApprovals({taskId:task.taskId,state:'pending'}).items)
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.ok(child);const load=f.app.runtime.loadCheckpoint.bind(f.app.runtime);
    const binding=load(child.taskId,'coding-repair:worker-capability');assert.ok(binding);
    for(const replacement of [{...binding,proposalDigest:'0'.repeat(64)},
      {...binding,bindingId:'different-deployment'},{...binding,deadline:'2000-01-01T00:00:00.000Z'}]){
      f.app.runtime.loadCheckpoint=(id,name)=>id===child.taskId&&name==='coding-repair:worker-capability'?replacement:load(id,name);
      try{assert.throws(()=>f.app.resumeTask(child.taskId),{code:'UNAUTHORIZED'});}
      finally{f.app.runtime.loadCheckpoint=load;}
    }
    assert.equal(f.calls.length,0);assert.equal(f.images.length,0);
  }finally{f.app.close();}
});
test('a corrupt Synthetic reciprocal host graph cycle returns no conversation',()=>{
  const f=fixture(),namespace='synthetic-owner';
  const requests=new Map(['cycle-a','cycle-b'].map(id=>[id,{commandId:'op-'+id,toolName:'coding.repair.read',
    toolVersion:'1.0.0',arguments:{sessionId:'synthetic-session',path:'app.js'},deadline:'2099-01-01T00:00:00.000Z'}]));
  const other=id=>id==='cycle-a'?'cycle-b':'cycle-a';
  const originalLoad=f.app.runtime.loadCheckpoint.bind(f.app.runtime),originalTask=f.app.runtime.getTask.bind(f.app.runtime);
  const originalHost=f.app.readHostToolTask.bind(f.app);
  f.app.runtime.getTask=id=>requests.has(id)?{taskId:id,conversationId:'host-tool:'+namespace}:originalTask(id);
  f.app.readHostToolTask=id=>requests.has(id)?{commandId:requests.get(id).commandId}:originalHost(id);
  f.app.runtime.loadCheckpoint=(id,key)=>{
    if(!requests.has(id))return originalLoad(id,key);
    const request=requests.get(id);
    if(key==='coding-repair:parent')return {taskId:other(id),operationId:request.commandId};
    if(key==='host-tool-intent')return {...request,namespace,argumentsDigest:toolArgumentsDigest(request.arguments)};
    if(key==='coding-repair:host:'+requests.get(other(id)).commandId)return {localTaskId:other(id),request:requests.get(other(id))};
    return undefined;
  };
  try{assert.equal(f.app.readToolConversation('cycle-a'),undefined);}
  finally{f.app.runtime.loadCheckpoint=originalLoad;f.app.runtime.getTask=originalTask;f.app.readHostToolTask=originalHost;f.app.close();}
});
for(const kind of ['metadata','source'])test(`F15 ${kind} export denial stops the Synthetic image boundary`,async()=>{
  const f=fixture(kind==='metadata'?{metadata:false}:{sourceAllowed:false}),{client,task}=await submit(f);
  try{await drive(f,client,task.taskId);assert.equal(f.app.readSubagentTasks(task.taskId)[0].state,'failed');
    assert.equal(f.images.length,kind==='metadata'?0:1);assert.equal(f.calls.some(call=>call.name==='workflow.host.f15_n05'),false);
    assert.equal(f.exports.some(item=>item.kind==='source'),false);
  }finally{f.app.close();}
});
test('an unknown original F15 host write remains bound and is never retried',async()=>{
  const f=fixture({unknown:true}),{client,task}=await submit(f);
  try{
    await drive(f,client,task.taskId,{approve:false});
    // Drive until the unknown host receipt, approving only original requests.
    for(let n=0;n<100;n++){
      const [child]=f.app.readSubagentTasks(task.taskId);
      if(child?.state==='waiting_reconciliation')break;
      const tasks=[f.app.runtime.getTask(task.taskId),...(child?[f.app.runtime.getTask(child.taskId)]:[])];
      if(child){const host=f.app.readPendingOwnedWorkflowHostTask(child.taskId);if(host)tasks.push(host);}
      for(const current of tasks)for(const approval of f.app.runtime.listApprovals({taskId:current.taskId,state:'pending'}).items)
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    const [child]=f.app.readSubagentTasks(task.taskId);assert.equal(child.state,'waiting_reconciliation',JSON.stringify({calls:f.calls,images:f.images.length,
      tasks:f.app.runtime.listTasks({limit:20}).items,resume:f.app.runtime.loadCheckpoint(child.taskId,'coding-repair:resume-error'),
      graph:f.app.runtime.loadCheckpoint(child.taskId,'coding-repair:graph')}));
    const before=f.calls.filter(call=>call.name==='workflow.host.f15_n05').length;
    assert.equal(before,1);assert.throws(()=>f.app.resumeTask(child.taskId),{code:'RESULT_UNKNOWN'});
    assert.equal(f.calls.filter(call=>call.name==='workflow.host.f15_n05').length,before);
    assert.equal(f.calls.some(call=>call.name==='workflow.host.f15_n06'),false);
  }finally{f.app.close();}
});
