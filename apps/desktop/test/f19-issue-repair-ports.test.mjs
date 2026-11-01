import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createGitHubF18F19Tools} from '@personal-agent/github';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {ProtocolError} from '@personal-agent/contracts';
import * as r from '@personal-agent/runtime/application';
import {createDesktopF19IssueRepairPorts} from '../electron/f19-issue-repair-ports.js';
import {runCodingRepairFullGraphFixture} from '../../../tests/manual/agentarts/coding-repair-full-graph.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const issue={repo:'synthetic/f19',issueId:19,updatedAt:'2026-11-01T00:00:00Z',title:'Public fixture returns 1 instead of 3',body:'Repair feature.cjs; preserve unrelated user edits.'};
const selection={repo:issue.repo,issueId:issue.issueId,expectedUpdatedAt:issue.updatedAt,allowedPaths:['feature.cjs']};
const secret='synthetic-f19-receipt-secret-at-least-32-characters';

// Actual F19 Engine -> configured worker -> graph/Policy/business child ->
// original F15 dispatcher -> actual F15 Engine/isolated filesystem/CAS. Model,
// GitHub transport, consent and ephemeral independent signature are explicit
// fixture boundaries. This is not a real human signature or GitHub acceptance.
async function fixture({replaceDigest=false,denyDispatch=false,cancelDispatch=false,revokeDuringExport=false}={}) {
  let app,ports,revoked=false,closedEvidence,dispatchApprovals=0;const requests=[],exports=[],nodes=[];
  const current=()=>{if(revoked)throw new ProtocolError('UNAUTHORIZED','Synthetic original selection revoked');};
  const engine=new OwnedWorkflowEngine({checkpointSecret:secret,externalHost:true,
    decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    prepareCandidates:async context=>{nodes.push(context.node.id);return [{id:'candidate',description:'Explicit synthetic issue triage',
      value:context.node.kind==='host'?{arguments:{}}:{snapshotDigest:replaceDigest?'f'.repeat(64):digest(issue),
        canonicalIssueId:19,isDuplicate:false,triageCategory:'bug'}},
      {id:'review',description:'Defer unsupported issue',value:null,abstain:true}];}});
  const image={bindingId:'synthetic-f19-engine',advance:request=>engine.advance(request),receiptSecret:async()=>secret};
  const report=await runCodingRepairFullGraphFixture({fakeModel:true,targetPath:'feature.cjs',
    artifactRoot:'.cache/f19-original-repair',createApplication(config){
      ports=createDesktopF19IssueRepairPorts({getApplication:()=>app,selection:{configurationRef:'a'.repeat(64),assertCurrent:current,readSelection:async()=>selection},
        github:{assertCurrent:current,createTools:()=>createGitHubF18F19Tools({runner:{async run(request){
          assert.equal(request.args[4],'GET');assert.equal(request.args[5],'repos/synthetic/f19/issues/19');requests.push(request.args[5]);
          return {exitCode:0,stderr:'',stdout:JSON.stringify({number:19,updated_at:issue.updatedAt,title:issue.title,body:issue.body,
            state:'open',html_url:'https://github.com/synthetic/f19/issues/19'})};}},readToken:async()=> 'synthetic-only-token',
          repositories:[issue.repo],requiredChecks:['unused-read-fixture'],eligibleReviewers:['unused-read-fixture'],beforeWrite(){assert.fail('No GitHub write permitted');}})},
        authorizeExport:async value=>{exports.push(value);if(revokeDuringExport&&value.value?.repairTaskId)revoked=true;return true;}});
      assert.equal(ports.configuredWorkflowWorkerPorts[0].available(),false);
      // Stage-one boundary only: explicitly let this fixture reach N03. The
      // production worker stays unavailable and the fixture N04 rejects all completion.
      const missing=['f19_n04','f19_n05'].map(name=>({descriptor:{name:'workflow.host.'+name,version:'1.0.0',
        inputSchema:{type:'object',additionalProperties:false,properties:{}},outputSchema:{},sideEffect:'read',requiredScopes:['github:read'],
        idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute(){throw new ProtocolError('UNSUPPORTED_CAPABILITY','Explicit fixture: original publication/regression absent');}}));
      const tools=[...config.tools,...ports.tools,...missing,r.createDesktopSubagentDispatchTool({competitionOnly:true,
        getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(task,worker,scope)=>app.runDefaultSubagentWorker(task,worker,scope)})];
      app=r.createRuntimeApplication({...config,tools,delegateUserTasks:true,configuredWorkflowWorkers:ports.configuredWorkflowWorkerPorts.map(worker=>({...worker,image,available:()=>true})),
        automaticTools:config.automaticTools.filter(tool=>tool.toolName!=='coding.repair.workflow'),
        requestToolAuthorization:async scope=>{if(scope.toolName==='coding.repair.workflow'){
          dispatchApprovals++;if(cancelDispatch)app.runtime.requestCancel(scope.taskId,'Synthetic original dispatch cancellation');
          return denyDispatch?'deny':'allow_once';}return 'allow_once';},
        competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true})),
        competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
          exportPolicyVersion:'explicit-f19-fixture-consent',accepts:()=>true,project:({result})=>result})),
        coordination:{execute:async request=>request.continuation||app.runtime.getTask(request.taskId).conversationId==='synthetic-f15'?{kind:'text',text:'Synthetic stopped workflow',verification:'mock'}:
          {kind:'tool_proposal',proposalId:'original-f19',toolName:'workflow.f19.issue_repair',toolVersion:'1.0.0',arguments:selection,verification:'mock'}}});
      const originalClose=app.close.bind(app);app.close=()=>{
        const tasks=app.runtime.listTasks({limit:100}).items;
        const hosts=tasks.filter(task=>app.runtime.loadCheckpoint(task.taskId,'host-tool-intent'));
        const dispatch=hosts.find(task=>app.runtime.loadCheckpoint(task.taskId,'host-tool-intent').toolName==='coding.repair.workflow');
        const children=dispatch?tasks.filter(task=>app.runtime.loadCheckpoint(task.taskId,'subtask-parent')?.parentTaskId===dispatch.taskId):[];
        closedEvidence={tasks,hosts:hosts.map(task=>app.readHostToolTask(task.taskId)),children,dispatchApprovals};
        if(dispatch?.state==='succeeded'){
          const intent=app.runtime.loadCheckpoint(dispatch.taskId,'host-tool-intent'),runId='host-tool-'+dispatch.taskId;
          const ref={taskId:dispatch.taskId,runId,scopeRef:runId,toolVersion:'1.0.0',arguments:intent.arguments};
          const proof=r.readRuntimeCodingRepairDispatchChild(app,ref);closedEvidence.proof=proof;closedEvidence.reference=ref;
          assert.equal(proof.taskId,children[0].taskId);assert.equal(proof.mode,'main');assert.equal(proof.state,'succeeded');
          assert.throws(()=>{proof.taskId='foreign';},TypeError);
          for(const patch of [{runId:'foreign'},{scopeRef:'foreign'},{arguments:{...ref.arguments,codingRepair:{mode:'isolated'}}}])
            assert.throws(()=>r.readRuntimeCodingRepairDispatchChild(app,{...ref,...patch}));
          const parent=app.runtime.loadCheckpoint(proof.taskId,'subtask-parent');
          for(const patch of [{parentTaskId:'foreign'},{subtaskId:'foreign'},{goal:'changed'},{parentDeadline:'2000-01-01T00:00:00Z'}]){
            app.runtime.saveCheckpoint(proof.taskId,'subtask-parent',{...parent,...patch});
            assert.throws(()=>r.readRuntimeCodingRepairDispatchChild(app,ref),{code:'UNAUTHORIZED'});
          }
          app.runtime.saveCheckpoint(proof.taskId,'subtask-parent',parent);
          const graph=app.runtime.loadCheckpoint(proof.taskId,'coding-repair:graph');
          app.runtime.saveCheckpoint(proof.taskId,'coding-repair:graph',{...graph,input:{...graph.input,codingRepair:{...graph.input.codingRepair,
            session:{...graph.input.codingRepair.session,sessionId:'foreign'}}}});
          assert.throws(()=>r.readRuntimeCodingRepairDispatchChild(app,ref),{code:'UNAUTHORIZED'});
          app.runtime.saveCheckpoint(proof.taskId,'coding-repair:graph',graph);
          assert.deepEqual(r.readRuntimeCodingRepairDispatchChild(app,ref),proof);
          const source=app.runtime.loadCheckpoint(dispatch.taskId,'coding-repair:parent');
          const original=app.runtime.loadCheckpoint(source.taskId,'f19:original-issue-repair:v1');
          assert.equal(original.snapshot.snapshotDigest,digest(issue));assert.equal(original.snapshot.issueId,19);
          closedEvidence.original=original;
        }
        originalClose();
      };return app;
    }});
  return {report,evidence:closedEvidence,requests,exports,nodes};
}

test('F19 original issue and selected candidate create exactly one real F15 child; unsupported close stays unavailable',async()=>{
  const f=await fixture();
  assert.ok(f.evidence.proof,JSON.stringify({hosts:f.evidence.hosts.map(value=>({tool:value.toolName,state:value.task.state,error:value.task.error})),tasks:f.evidence.tasks}));
  assert.equal(f.evidence.children.length,1);assert.equal(f.evidence.dispatchApprovals,1);assert.equal(f.requests.length,1);
  const enqueue=f.evidence.hosts.find(value=>value.toolName==='workflow.host.f19_n03');
  assert.equal(enqueue.task.state,'succeeded');assert.deepEqual(enqueue.confirmed.result,{issueId:19,repairTaskId:f.evidence.proof.taskId});
  assert.ok(f.nodes.includes('F19_N02'));assert.ok(f.nodes.includes('F19_N03'));
  assert.equal(f.evidence.hosts.some(value=>value.toolName==='workflow.host.f19_n05'),false);
  assert.equal(f.report.unrelatedUnchanged,true);assert.equal(f.report.retainsUserComment,true);
  const reopened=r.createRuntimeApplication({path:join(f.report.directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f15-host'});
  try{assert.deepEqual(r.readRuntimeCodingRepairDispatchChild(reopened,f.evidence.reference),f.evidence.proof);
    assert.equal(reopened.runtime.listTasks({conversationId:'desktop-subtask:'+f.evidence.proof.dispatchTaskId,limit:100}).items.length,1);
  }finally{reopened.close();}
});

for(const [name,options] of [['changed original candidate digest',{replaceDigest:true}],['denied original F15 dispatch',{denyDispatch:true}],
  ['cancelled original F15 dispatch',{cancelDispatch:true}]])
test('F19 '+name+' never creates a repair child',async()=>{
  const f=await fixture(options);assert.equal(f.evidence.children.length,0);assert.equal(f.evidence.proof,undefined);
  assert.ok(f.nodes.includes('F19_N02'));assert.equal(f.requests.length,1);
  assert.equal(f.evidence.dispatchApprovals,options.denyDispatch||options.cancelDispatch?1:0);
  assert.equal(f.evidence.hosts.some(value=>value.toolName==='workflow.host.f19_n05'),false);
});

test('F19 export revocation preserves the original completed child and refuses the outer receipt',async()=>{
  const f=await fixture({revokeDuringExport:true});assert.ok(f.evidence.proof);assert.equal(f.evidence.children.length,1);
  assert.notEqual(f.evidence.hosts.find(value=>value.toolName==='workflow.host.f19_n03').task.state,'succeeded');
  assert.equal(f.evidence.hosts.some(value=>value.toolName==='workflow.host.f19_n05'),false);
});

test('F19 missing trusted providers exposes no tools or worker',()=>{
  const ports=createDesktopF19IssueRepairPorts();assert.deepEqual(ports.tools,[]);assert.deepEqual(ports.configuredWorkflowWorkerPorts,[]);
});
