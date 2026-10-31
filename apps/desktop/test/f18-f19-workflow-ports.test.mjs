import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Client} from '@personal-agent/client';
import {createGitHubF18F19Tools} from '@personal-agent/github';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {OwnedWorkflowEngine,createWorkflowDecisionTool,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createDesktopF18F19WorkflowPorts} from '../electron/f18-f19-workflow-ports.js';
import {createF18ReviewConfiguration,createConfiguredDesktopF18F19WorkflowPorts} from '../electron/f18-review-config-host.js';
import {readConfiguredWorkflowDecisionScope} from '../electron/configured-workflow-decision-source.js';
import {createToolPresenceHost} from '../electron/tool-presence-host.js';

const sha='a'.repeat(40),baseSha='b'.repeat(40),mergedSha='c'.repeat(40),repo='synthetic/repository';
const selection={repo,prNumber:42,headSha:sha,baseSha,mergeMethod:'merge'};
const diff='diff --git a/synthetic.js b/synthetic.js\n+fixed\n';
const diffDigest=createHash('sha256').update(diff).digest('hex');
const sleep=()=>new Promise(resolve=>setTimeout(resolve,5));

// Real Engine + Runtime + Policy + SQLite + graph/business bridge + presence
// broker. Only GitHub transport, native gesture, model selection and user consent
// are explicit synthetic boundaries. No account or cloud writes occur.
async function fixture(t,{unknown=false,deny=false,blocking=false,ciFailure=false,moveHead=false,missingSelection=false}={}){
  const cache=resolve('.cache/f18-f19');await mkdir(cache,{recursive:true});const directory=await mkdtemp(join(cache,'runtime-'));
  let app,client,ports,presence,configuration,revoked=false,merged=false;const calls=[],exports=[],prompts=[],decisions=[];
  const current=scope=>{if(revoked||scope.signal.aborted)throw Error('Synthetic configuration revoked');};
  const runner={async run(request){
    const endpoint=request.args[5],method=request.args[4];calls.push({endpoint,method});let value;
    if(endpoint==='graphql')value={data:{repository:{nameWithOwner:repo,pullRequest:{number:42,state:'OPEN',isDraft:false,
      headRefOid:sha,baseRefOid:baseSha,mergeable:'MERGEABLE',mergeStateStatus:'CLEAN',reviewDecision:'APPROVED',
      author:{login:'author',__typename:'User'},baseRepository:{nameWithOwner:repo},headRepository:{nameWithOwner:repo},
      latestReviews:{pageInfo:{hasNextPage:false},nodes:[{state:'APPROVED',author:{login:'reviewer',__typename:'User'},commit:{oid:sha}}]},
      reviewThreads:{pageInfo:{hasNextPage:false},nodes:[]},commits:{nodes:[{commit:{oid:sha,statusCheckRollup:{state:ciFailure?'FAILURE':'SUCCESS',
        contexts:{pageInfo:{hasNextPage:false},nodes:[{__typename:'CheckRun',name:'technical-ci',status:'COMPLETED',
          conclusion:ciFailure?'FAILURE':'SUCCESS',checkSuite:{commit:{oid:sha}}}]}}}}]}}}}};
    else if(endpoint.endsWith('/merge')){assert.equal(method,'PUT');assert.deepEqual(JSON.parse(request.stdin),{sha,merge_method:'merge'});
      merged=true;if(unknown)throw Error('Synthetic network result lost after effect');value={merged:true,sha:mergedSha};}
    else if(endpoint.endsWith('/pulls/42'))value=request.args.includes('Accept: application/vnd.github.diff')?diff:
      {number:42,state:merged?'closed':'open',merged,head:{sha:moveHead?'d'.repeat(40):sha,repo:{full_name:repo}},
        base:{sha:merged?mergedSha:baseSha,repo:{full_name:repo}},merge_commit_sha:merged?mergedSha:null,changed_files:1,additions:1,deletions:0};
    else throw Error('Unexpected synthetic endpoint '+endpoint);
    return {exitCode:0,stdout:typeof value==='string'?value:JSON.stringify(value),stderr:''};
  }};
  const secret='synthetic-f18-receipt-secret-at-least-32-characters';
  const engine=new OwnedWorkflowEngine({checkpointSecret:secret,externalHost:true,
    decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    prepareCandidates:async context=>{assert.match(context.input.reviewRequirements,/headSha and diffDigest/);
      return [{id:'execute',description:'Explicit synthetic candidate',value:context.node.kind==='host'?{arguments:{}}:
      {headSha:sha,diffDigest,hasBlockingBugs:blocking,blockingCount:blocking?1:0}},
      {id:'defer',description:'Defer original operation',value:{},abstain:true}];}});
  const image={bindingId:'synthetic-f18-owned-engine',advance:request=>engine.advance(request),receiptSecret:async()=>secret};
  const decision=createWorkflowDecisionTool({selector:{select:async request=>({selectedId:request.candidates[0].id})}});
  const decisionTool={...decision,async execute(input,context){
    const proof=readConfiguredWorkflowDecisionScope(app,context);assert.equal(proof.workflowId,'F18');decisions.push(proof);
    return decision.execute(input,context);
  }};
  function open(){
    configuration=createF18ReviewConfiguration({userData:directory,
      safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},
      readRepositoryBinding:()=>revoked?undefined:{repository:repo,bindingId:'synthetic-original-workspace'}});
    if(!missingSelection&&!configuration.snapshot().configured)configuration.configureFromNativeSelection({selection,
      requiredChecks:['technical-ci'],eligibleReviewers:['reviewer']});
    const workspace={bindingId:'synthetic-original-workspace',rootPath:directory,assertCurrent:current};
    const host={createF18F19Tools:options=>createGitHubF18F19Tools({...options,runner,readToken:async()=> 'synthetic-credential',repositories:[repo]}),
      competitionToolAvailability:[{toolName:'github.pr.get',toolVersion:'0.1.0-alpha.1',available:async()=>!revoked}]};
    ports=createConfiguredDesktopF18F19WorkflowPorts({getApplication:()=>app,reviewConfiguration:configuration,
      codingWorkspace:{readDeveloperConfiguration:()=>workspace},developerDeployment:{host,
        snapshot:()=>({configured:!revoked,state:revoked?'closed':'configured',repository:repo})},
      authorizeExport:async value=>{exports.push(value);return true;},
      requestPresence:scope=>presence.requestPresence(scope)});
    const tools=[decisionTool,...ports.tools,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,
      getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(task,worker,scope)=>app.runDefaultSubagentWorker(task,worker,scope)})];
    app=runtimeModule.createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,
      competitionMaxSteps:8,hostUserNamespace:'synthetic-f18',coordinationBinding:'synthetic-pinned-deployment',tools,
      configuredWorkflowWorkers:ports.configuredWorkflowWorkerPorts.map(port=>({...port,image})),
      isUserPresent:taskId=>presence.isUserPresent(taskId),requestToolAuthorization:async scope=>{
        const proof=ports.prepareMergeQuestion?.(scope,{prepare:(_scope,fence)=>assert.equal(fence.assertCurrent(),true)});
        if(proof){
          assert.equal(scope.toolName,'github.registered_merge');
          assert.throws(()=>ports.prepareMergeQuestion({...scope,argumentsDigest:'f'.repeat(64)},{prepare(){}}),{code:'UNAUTHORIZED'});
          assert.throws(()=>ports.prepareMergeQuestion({...scope,toolName:'github.pr.comment'},{prepare(){}}),{code:'UNAUTHORIZED'});
          const marker=app.runtime.loadCheckpoint(scope.taskId,'workflow-business-tool:source');
          const key='workflow-business-tool:'+marker.commandId,original=app.runtime.loadCheckpoint(marker.sourceTaskId,key);
          const replaced={...original,actionKey:'f18.foreign'};
          app.runtime.saveCheckpoint(marker.sourceTaskId,key,replaced);
          app.runtime.saveCheckpoint(scope.taskId,'workflow-business-tool:source',{...marker,intentDigest:toolArgumentsDigest(replaced)});
          assert.throws(()=>ports.prepareMergeQuestion(scope,{prepare(){}}),{code:'REVISION_CONFLICT'});
          app.runtime.saveCheckpoint(marker.sourceTaskId,key,original);
          app.runtime.saveCheckpoint(scope.taskId,'workflow-business-tool:source',marker);
          if(deny)return 'deny';
          await ports.confirmMergePresence(scope);
        }
        return 'allow_once';
      },
      coordination:{execute:async request=>app.runtime.getTask(request.taskId).conversationId==='fixture-chat'||request.continuation
        ?{kind:'text',text:'Synthetic workflow continuation',verification:'unverified'}
        :{kind:'tool_proposal',proposalId:'synthetic-f18',toolName:'workflow.f18.review_merge',toolVersion:'1.0.0',
          arguments:structuredClone(selection),verification:'unverified'}},
      competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
        publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:tool.descriptor.name==='github.registered_merge'?['/mergeMethod']:[]})),
      competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
        exportPolicyVersion:'synthetic-explicit-consent',accepts:()=>true,project:({result})=>result}))});
    presence=createToolPresenceHost({isTaskCurrent:id=>['running','waiting_approval'].includes(app.runtime.getTask(id).state),
      readTaskBinding:id=>app.readToolConversation(id)?JSON.stringify(app.readToolConversation(id)):undefined,
      registerNativeShortcut:()=>()=>{},onPrompt:prompt=>{if(prompt.state==='waiting')queueMicrotask(()=>{
        prompts.push(prompt.taskId);assert.equal(presence.confirmPending(prompt.taskId),true);
      });}});
    client=new Client(app);
  }
  open();await client.connect();
  t.after(async()=>{for(let i=0;i<500&&app.activeTaskCount;i++)await sleep();presence.close();configuration.close();app.close();await rm(directory,{recursive:true,force:true});});
  const settle=async taskId=>{
    for(let i=0;i<3000;i++){
      const task=app.runtime.getTask(taskId);
      if(app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(task.state))return task;
      await sleep();
    }
    throw Error('Original workflow did not settle: '+JSON.stringify(app.runtime.listTasks({limit:100}).items.map(task=>({state:task.state,error:task.error,
      tool:app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName}))));
  };
  return {get app(){return app;},get ports(){return ports;},calls,exports,prompts,decisions,
    async run(){const submitted=await client.call('task.submit',{goal:'Review the explicitly selected synthetic PR',conversationId:'fixture-chat'},
      {idempotencyKey:'synthetic-user-f18',timeoutMs:120000});
      await settle(submitted.taskId);const child=app.readSubagentTasks(submitted.taskId)[0];
      if(child?.state!=='succeeded')t.diagnostic(JSON.stringify(app.runtime.listTasks({limit:100}).items.filter(task=>task.error).map(task=>({state:task.state,
        error:task.error,tool:app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName}))));return child;
    },
    async reopen(){assert.equal(app.activeTaskCount,0);presence.close();configuration.close();app.close();open();await client.connect();},
    async inspect(taskId){const inspection=ports.readUnknownMergeInspection(taskId);
      const request={commandId:'synthetic-explicit-inspection',toolName:inspection.toolName,toolVersion:inspection.toolVersion,
        arguments:inspection.arguments,deadline:new Date(Date.now()+60000).toISOString()};
      const prepared=app.prepareHostToolTask(request);app.finalizeHostToolTask({taskId:prepared.taskId,commandId:request.commandId,
        arguments:request.arguments,expectedTaskRevision:prepared.revision});await settle(prepared.taskId);return app.readHostToolTask(prepared.taskId);
    },revoke:()=>{revoked=true;}};
}

test('F18 actual OwnedWorkflowEngine consumes Desktop/GitHub ports via original Policy children and exact native presence',async t=>{
  const f=await fixture(t),task=await f.run();assert.equal(task.state,'succeeded');
  assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(f.decisions.length,5);
  const merge=f.app.runtime.listTasks({limit:100}).items.find(task=>f.app.runtime.loadCheckpoint(task.taskId,'f18:original-github-merge-attempt'));
  assert.ok(merge);assert.deepEqual(f.prompts,[merge.taskId]);assert.equal(merge.state,'succeeded');
  const marker=f.app.runtime.loadCheckpoint(merge.taskId,'workflow-business-tool:source');
  const intent=f.app.runtime.loadCheckpoint(marker.sourceTaskId,'workflow-business-tool:'+marker.commandId);
  const reference={taskId:merge.taskId,runId:'host-tool-'+merge.taskId,scopeRef:'host-tool-'+merge.taskId,
    toolVersion:'0.1.0-alpha.1',arguments:selection};
  const owner={parentTaskId:intent.parentTaskId,sessionId:intent.sessionId,deadline:intent.request.deadline};
  assert.equal(runtimeModule.readWorkflowBusinessToolSource(f.app,owner,reference,'github.registered_merge').graph.nodeId,'F18_N05');
  assert.throws(()=>runtimeModule.readWorkflowBusinessToolSource(f.app,{...owner,parentTaskId:'foreign'},reference,'github.registered_merge'),{code:'UNAUTHORIZED'});
  f.app.runtime.saveCheckpoint(merge.taskId,'workflow-business-tool:source',{...marker,sourceTaskId:'foreign'});
  assert.throws(()=>runtimeModule.readWorkflowBusinessToolSource(f.app,owner,reference,'github.registered_merge'),{code:'UNAUTHORIZED'});
  f.app.runtime.saveCheckpoint(merge.taskId,'workflow-business-tool:source',marker);
  assert.ok(f.exports.some(value=>value.stage==='completion'));assert.ok(f.ports.unavailable.some(reason=>reason.startsWith('f19_')));
  assert.deepEqual(f.ports.configuredWorkflowWorkerPorts.map(port=>port.workflowId),['F18']);
  await f.reopen();assert.equal(f.app.runtime.getTask(task.taskId).state,'succeeded');assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
});

for(const [name,options] of [['denied original child',{deny:true}],['model blocking finding',{blocking:true}],
  ['failed technical CI',{ciFailure:true}],['changed current HEAD',{moveHead:true}],['missing native selection',{missingSelection:true}]])
test('F18 actual Engine blocks '+name+' with no GitHub write',async t=>{
  const f=await fixture(t,options),task=await f.run();assert.notEqual(task.state,'succeeded');assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);
});

test('F18 unknown merge survives SQLite reopen and only inspects original PR; it never replays or attributes another effect',async t=>{
  const f=await fixture(t,{unknown:true});await f.run();
  const merge=f.app.runtime.listTasks({limit:100}).items.find(task=>f.app.runtime.loadCheckpoint(task.taskId,'f18:original-github-merge-attempt'));
  assert.equal(merge.state,'waiting_reconciliation');assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
  await f.reopen();const start=f.calls.length,inspection=await f.inspect(merge.taskId);
  assert.equal(inspection.task.state,'succeeded');assert.equal(inspection.confirmed.result.merged,true);
  assert.ok(f.calls.slice(start).every(call=>call.method==='GET'));assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
  assert.equal(f.app.runtime.getTask(merge.taskId).state,'waiting_reconciliation');
  assert.equal(f.ports.readUnknownMergeInspection(merge.taskId).meaning,'target_state_only_original_write_remains_unknown');
});

test('F18/F19 missing trusted ports publish no worker or write tools',()=>{
  const bundle=createDesktopF18F19WorkflowPorts();assert.deepEqual(bundle.tools,[]);assert.deepEqual(bundle.configuredWorkflowWorkerPorts,[]);
});
