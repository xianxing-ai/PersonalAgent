import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createDesktopF15ReviewOriginHost,f15DeploymentAuthorId} from '../electron/f15-review-origin-host.js';

// Synthetic persisted records; actual Runtime/Policy acceptance is tested separately.
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(){
  const config={coordinationBinding:'original-deployment',imageBinding:'original-image'},taskId='task-1',sessionId='session-1',snapshotId='snapshot-1';
  const source='old source\n',sha=createHash('sha256').update(source).digest('hex');
  const patch={path:'app.js',expectedSha256:sha,edits:[{oldText:'old',newText:'new'}]};
  const key={taskId,sessionId,snapshotId,patchDigest:hash([patch]),reviewerId:'reviewer',authorId:f15DeploymentAuthorId(config),policyId:'policy'};
  const reviewId='f15-review-'+hash({taskId,sessionId,snapshotId,patchDigest:key.patchDigest});
  const pending={kind:'tool_proposal',toolName:'coding.repair.workflow',toolVersion:'1.0.0',arguments:{codingRepair:{mode:'main'},
    subtasks:[{subtaskId:'repair',role:'coder',goal:'repair'}]}};
  const deadline=new Date(Date.now()+60000).toISOString(),entries=new Map(),tasks=new Map(),backs=new Map(),evidence=new Map(),records={};
  const task={taskId,state:'running',cancelRequested:false,conversationId:'desktop-subtask:parent'};
  tasks.set(taskId,task);tasks.set('parent',{taskId:'parent',state:'waiting_approval',cancelRequested:false});
  const runtime={getTask:id=>tasks.get(id),loadCheckpoint:(id,name)=>entries.get(id+':'+name),readToolExecutions:id=>[evidence.get(id)],
    matchesToolExecutionInput:(record,input)=>input.scopeRef===record.evidenceId&&isDeepStrictEqual(input.arguments,record.arguments)};
  const app={runtime,readHostToolTask:id=>backs.get(id)};
  const store=(id,name,value)=>entries.set(id+':'+name,value);
  store(taskId,'application-profile','huawei_ict_agentarts');store(taskId,'application-deadline',deadline);
  store(taskId,'subtask-parent',{parentTaskId:'parent'});store(taskId,'subtask-coordination-binding',{profile:'huawei_ict_agentarts',configurationRef:config.coordinationBinding});
  store(taskId,'competition-loop',{pending,pendingRevision:1});
  store(taskId,'coding-repair:worker-capability',{taskId,deadline,revision:1,bindingId:config.imageBinding,proposalDigest:hash(pending),
    request:{version:1,...pending.arguments.codingRepair,subtasks:pending.arguments.subtasks}});
  const graph={sessionId,bindingId:config.imageBinding,controlRevision:0,input:{codingRepair:{session:{taskId,sessionId}}},confirmedOperations:records};
  store(taskId,'coding-repair:graph',graph);
  function add(nodeId,toolName,args,result){
    const operationId='op-'+Object.keys(records).length,localTaskId='host-'+operationId,runId='host-tool-'+localTaskId;
    const proposal={nodeId,toolName,toolVersion:'1.0.0',operationId,arguments:args};records[operationId]={nodeId,toolName,operationId,localTaskId,result};
    store(taskId,'owned-workflow:operation:'+operationId,{taskId,sessionId,workflowId:'F15',controlRevision:0,localTaskId,proposal});
    store(localTaskId,'coding-repair:parent',{taskId,operationId});store(taskId,'coding-repair:host:'+operationId,
      {localTaskId,request:{commandId:operationId,toolName,toolVersion:'1.0.0',arguments:args}});
    backs.set(localTaskId,{task:{state:'succeeded'},commandId:operationId,confirmed:{runId,result,evidenceRefs:[runId]}});
    evidence.set(localTaskId,{evidenceId:runId,state:'confirmed',policyDecision:'allow',executionStarted:true,toolName,toolVersion:'1.0.0',arguments:args});
    return operationId;
  }
  add('F15_N01','workspace.coding_snapshot',{sessionId},{snapshotId,files:[{path:'app.js',sha256:sha}]});
  add('F15_N03','coding.repair.read',{sessionId,path:'app.js'},{path:'app.js',sha256:sha,content:source});
  add('F15_N03','decision.choose_candidate',{context:JSON.stringify({workflowId:'F15',nodeId:'F15_N03',
    candidateValues:[{id:'selected',value:{patches:[patch]}}]})},{selectedId:'selected'});
  const preview=add('F15_N04','workflow.host.f15_n04',{sessionId,patches:[patch]},
    {sessionId,approved:true,previewed:true,patches:[{path:'app.js',beforeSha256:sha,afterSha256:'b'.repeat(64)}]});
  store(taskId,'coding-repair:review-preflight:'+reviewId,{taskId,sessionId,snapshotId,patchDigest:key.patchDigest});
  store(taskId,'owned-workflow:intent:'+reviewId,{taskId,sessionId,workflowId:'F15',proposal:{nodeId:'F15_N04',
    toolName:'workflow.host.f15_independent_review',operationId:reviewId,arguments:{sessionId,snapshotId,patchDigest:key.patchDigest}}});
  let allowed=true,disclosure=true,shown,onShow;const host=createDesktopF15ReviewOriginHost({getApplication:()=>app,readExecutionConfig:()=>config,
    assertWorkspacePermission:()=>allowed,confirmNativeDisclosure:async()=>disclosure,showNativePatch:async value=>{shown=value;await onShow?.();return true;}});
  return {host,key,graph,preview,backs,evidence,entries,task,config,source,setAllowed:value=>{allowed=value;},
    setDisclosure:value=>{disclosure=value;},setOnShow:value=>{onShow=value;},getShown:()=>shown};
}
test('original deployment and confirmed preview permit native-only patch display',async()=>{
  const f=fixture();assert.equal(f.host.assertOriginalOwner(f.key),true);
  f.setDisclosure(false);assert.deepEqual(await f.host.showOriginalPatch(f.key),{shown:false});assert.equal(f.getShown(),undefined);f.setDisclosure(true);
  assert.deepEqual(await f.host.showOriginalPatch(f.key),{shown:true});assert.equal(f.getShown().sources[0].source,f.source);
  assert.equal(f.getShown().authorId,f15DeploymentAuthorId(f.config));
});
test('replaced author, task, patch, policy receipt or workspace permission is denied',async()=>{
  const f=fixture();
  assert.equal(f.host.assertOriginalOwner({...f.key,authorId:'someone-else'}),false);
  assert.equal(f.host.assertOriginalOwner({...f.key,patchDigest:'a'.repeat(64)}),false);
  f.setAllowed(false);assert.equal(f.host.assertOriginalOwner(f.key),false);await assert.rejects(f.host.showOriginalPatch(f.key),{code:'UNAUTHORIZED'});
  f.setAllowed(true);const local=f.graph.confirmedOperations[f.preview].localTaskId,record=f.evidence.get(local);
  f.evidence.set(local,{...record,policyDecision:'deny'});assert.equal(f.host.assertOriginalOwner(f.key),false);
  f.evidence.set(local,record);f.task.cancelRequested=true;assert.equal(f.host.assertOriginalOwner(f.key),false);
});
test('source bytes and selected patch cannot be replaced during native display',async()=>{
  const f=fixture(),source=Object.values(f.graph.confirmedOperations).find(item=>item.toolName==='coding.repair.read');
  source.result={...source.result,content:'different source'};assert.equal(f.host.assertOriginalOwner(f.key),false);
  const g=fixture();g.setOnShow(()=>{g.task.cancelRequested=true;});
  await assert.rejects(g.host.showOriginalPatch(g.key),{code:'UNAUTHORIZED'});
});
