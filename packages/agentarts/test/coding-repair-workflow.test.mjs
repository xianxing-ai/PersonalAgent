import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,createHmac} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {OwnedWorkflowEngine} from '../dist/owned-workflows.js';
import {boundSourceReadCandidates} from '../dist/workflow-dataflow.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const source=value=>'export function answer() { return '+value+'; }\n';
const objectSchema={type:'object'};
const toolNames=['workspace.coding_snapshot','coding.repair.read','workflow.host.f15_n04','workflow.host.f15_n05','workflow.host.f15_n06','decision.choose_candidate'];
function fixture(options={}){
  const initialSource=source(1)+(options.sourcePadding??'');
  let current=initialSource,checks=0,publishes=0,reads=0;
  const snapshot=()=>({snapshotId:'snapshot-'+sha(current),packages:[{id:'app',path:'',dependencies:[]}],
    files:[{path:'main.ts',sha256:sha(current),packageId:'app',kind:'source'}]});
  const initial=snapshot(),session={version:1,taskId:'coding-task',sessionId:'coding-session',workspaceId:'workspace',mode:options.isolated?'isolated':'main',baselineSnapshotId:initial.snapshotId};
  const original={workflowId:'F15',input:{goal:'Repair the real failed expectation incrementally',codingRepair:{version:1,session,initialSnapshot:initial,
    recipes:[...(options.multiRecipe?[{recipeId:'syntax',packageIds:['app'],required:true}]:[]),{recipeId:'unit',packageIds:['app'],required:true}]}},taskId:session.taskId,sessionId:session.sessionId,requestId:'first',
    controlRevision:1,deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal,
    availableTools:toolNames.map(name=>({name,version:'1.0.0',inputSchema:objectSchema}))};
  if(options.isolated){original.mode='isolated';original.snapshot={namespace:'isolated-coding',asOf:new Date().toISOString(),sourceVersions:{baseline:initial.snapshotId}};}
  const prepared=[];
  const engine=new OwnedWorkflowEngine({checkpointSecret:'synthetic-coding-workflow-checkpoint-32',externalHost:true,allowIsolatedProposals:true,
    ...(options.externalDecision?{decisionTool:{name:'decision.choose_candidate',version:'1.0.0'}}:{selector:{select:async request=>request.candidates.find(c=>c.id!=='review').id}}),receiptVerifier:{verify:async value=>value.proof==='synthetic-original-host'},
    prepareCandidates:async context=>{
      prepared.push({nodeId:context.node.id,round:context.codingRepair?.round,kind:context.node.kind});
      const bound=boundSourceReadCandidates(context);
      const candidates=bound??[{id:'selected',description:'specific evidence-supported repair',value:context.node.id==='F15_N02'
        ?{scope:['main.ts'],forbiddenActions:['unrelated changes']}
        :{diagnosis:context.codingRepair.round?'Actual unit failure persists; increment only the return value':'First incremental candidate',
          patches:[{path:'main.ts',expectedSha256:sha(current),edits:[{oldText:'return '+(context.codingRepair.round?2:1)+';',newText:'return '+(context.codingRepair.round?3:2)+';'}]}]}}];
      return [...candidates,{id:'review',description:'no justified candidate',value:null,abstain:true}];
    }});
  const execute=proposal=>{
    let result;
    if(proposal.toolName==='decision.choose_candidate')result={selectedId:proposal.arguments.candidates.find(c=>c.id!=='review').id};
    else if(proposal.toolName==='workspace.coding_snapshot')result=snapshot();
    else if(proposal.toolName==='coding.repair.read'){reads++;result={path:'main.ts',sha256:sha(current),content:current};}
    else if(proposal.toolName==='workflow.host.f15_n04')result={sessionId:session.sessionId,approved:true};
    else if(proposal.toolName==='workflow.host.f15_n05'){
      if(options.multiRecipe)assert.deepEqual(proposal.arguments.recipeIds,['syntax','unit'],'A new patch must not skip a check that only passed before this patch');
      checks++;for(const patch of proposal.arguments.patches){assert.equal(patch.expectedSha256,sha(current));for(const edit of patch.edits)current=current.replace(edit.oldText,edit.newText);}
      const s=snapshot(),pass=checks>1;
      result={version:1,sessionId:session.sessionId,snapshot:s,verification:[...(options.multiRecipe?[{version:1,sessionId:session.sessionId,runId:'syntax-verification-'+checks,
        recipeId:'syntax',packageIds:['app'],inputSnapshotId:s.snapshotId,files:s.files,exitCode:0,status:'VALID',evidenceRefs:[],diagnostics:[]}]:[]),{version:1,sessionId:session.sessionId,runId:'verification-'+checks,
        recipeId:'unit',packageIds:['app'],inputSnapshotId:s.snapshotId,files:s.files,exitCode:options.unknown?null:pass?0:1,
        status:options.unknown?'UNKNOWN':pass?'VALID':'FAILED',evidenceRefs:[],diagnostics:pass?[]:[{source:'node:test',path:'main.ts',line:1,message:'Expected return value 3'}]}]};
    }else if(proposal.toolName==='workflow.host.f15_n06'){
      publishes++;assert.equal(checks,2);assert.deepEqual(proposal.arguments.verificationRunIds,[...(options.multiRecipe?['syntax-verification-2']:[]),'verification-2']);
      result={version:1,sessionId:session.sessionId,state:'published',files:[{path:'main.ts',beforeSha256:sha(initialSource),afterSha256:sha(current)}],evidenceRefs:[]};
    }else throw Error('Unexpected operation');
    return {...proposal,state:options.outerUnknown&&proposal.toolName==='workflow.host.f15_n05'?'unknown':'confirmed',result,
      evidenceRefs:['actual-'+proposal.operationId],proof:'synthetic-original-host'};
  };
  return {engine,original,execute,prepared,get current(){return current;},get checks(){return checks;},get publishes(){return publishes;},get reads(){return reads;}};
}
async function drive(f,{stopAfterCheck=false}={}){
  let graph,receipts=[];const resolvedValues={},operations=[];
  for(let step=0;step<40;step++){
    graph=await f.engine.advance({...f.original,requestId:'request-'+step,...(graph?{checkpoint:graph.checkpoint}:{}),receipts,resolvedValues});receipts=[];
    for(const proposal of graph.proposals){
      const receipt=f.execute(proposal);operations.push({proposal,receipt});receipts.push(receipt);
      if(proposal.toolName==='workspace.coding_snapshot')resolvedValues.F15_N01=receipt.result;
      if(proposal.toolName==='coding.repair.read')resolvedValues['coding-source:'+receipt.result.path]=receipt.result;
    }
    if(graph.state==='settled'||graph.state==='unknown'||graph.state==='failed'||stopAfterCheck&&f.checks>0&&receipts.length===0)return {graph,operations,resolvedValues};
  }
  throw Error('Fixture did not finish its graph');
}

const eventBytes=result=>Buffer.byteLength(JSON.stringify([{event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}]));
test('F15 retains exact source and host Evidence through 64KB WSS envelopes with compressed checkpoints',async()=>{
  const padding='// '+('public SVG fixture '.repeat(140))+'\n';
  const f=fixture({externalDecision:true,sourcePadding:padding});
  f.original.input.goal+=' Public requirements: '+('preserve animation and user source; '.repeat(180));
  let compressed=0;
  f.original.resultFits=result=>{
    const fits=eventBytes(result)<=64_000;
    if(fits&&result.checkpoint.startsWith('deflate:'))compressed++;
    return fits;
  };
  const {graph,operations}=await drive(f);
  assert.equal(graph.state,'settled');assert.ok(compressed>0,'the bounded transport must exercise compressed continuation');
  assert.equal(f.current,source(3)+padding);assert.equal(f.checks,2);assert.equal(f.publishes,1);
  assert.ok(operations.some(item=>item.proposal.toolName==='workflow.host.f15_n04'));
  assert.ok(operations.filter(item=>item.proposal.toolName==='workflow.host.f15_n05').every(item=>item.receipt.evidenceRefs.length));
  assert.ok(eventBytes(graph)<=64_000);
});

test('legacy plain checkpoints resume, while compressed encoding tampering and bounded inflation are rejected',async()=>{
  const f=fixture({externalDecision:true});
  const first=await f.engine.advance(f.original);
  assert.ok(!first.checkpoint.startsWith('deflate:'));
  const secret='synthetic-coding-workflow-checkpoint-32';
  const signed=encoded=>encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url');
  const json=Buffer.from(first.checkpoint.split('.')[0],'base64url');
  const encoded='deflate:'+deflateRawSync(json).toString('base64url');
  const compressed=signed(encoded);
  const receipts=first.proposals.map(f.execute);
  const next=await f.engine.advance({...f.original,checkpoint:first.checkpoint,receipts});
  const equivalent=await f.engine.advance({...f.original,checkpoint:compressed,receipts});
  assert.deepEqual(equivalent.nodes,next.nodes);
  assert.deepEqual(equivalent.proposals,next.proposals);
  const [payload,signature]=compressed.split('.');
  for(const checkpoint of [compressed.replace('deflate:','unknown:'),payload+'.'+(signature.startsWith('A')?'B':'A')+signature.slice(1)])
    await assert.rejects(f.engine.advance({...f.original,checkpoint}),{code:'INVALID_ARGUMENT'});
  const bomb=signed('deflate:'+deflateRawSync(Buffer.alloc(1_100_001,32)).toString('base64url'));
  assert.ok(bomb.length<64_000);
  await assert.rejects(f.engine.advance({...f.original,checkpoint:bomb}),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(inflateRawSync(Buffer.from(encoded.slice(8),'base64url')),json);
});
test('F15 itself performs two exact repair rounds, explicit source reads, actual-failure feedback and verified publication',async()=>{
  const f=fixture(),{graph,operations}=await drive(f);
  assert.equal(graph.state,'settled');for(const id of ['01','02','03','04','05','06'])assert.equal(graph.nodes['F15_N'+id].state,'completed');
  assert.equal(f.current,source(3));assert.equal(f.checks,2);assert.equal(f.reads,2);assert.equal(f.publishes,1);
  assert.equal(graph.codingRepair.round,1);assert.equal(graph.codingRepair.history.length,1);
  const writes=operations.filter(item=>item.proposal.toolName==='workflow.host.f15_n05');assert.equal(writes.length,2);
  assert.notEqual(writes[0].proposal.operationId,writes[1].proposal.operationId);
  assert.ok(graph.codingRepair.history[0].operationIds.includes(writes[0].proposal.operationId));
  assert.ok(graph.codingRepair.history[0].evidenceRefs.includes('actual-'+writes[0].proposal.operationId));
  assert.equal(graph.codingRepair.verification.at(-1).status,'VALID');assert.ok(graph.codingRepair.verification.at(-1).evidenceRefs.length>0);
  const initialRead=operations.find(item=>item.proposal.toolName==='coding.repair.read');
  await assert.rejects(f.engine.advance({...f.original,checkpoint:graph.checkpoint,receipts:[initialRead.receipt]}),{code:'INVALID_ARGUMENT'});
});
for(const outerUnknown of [false,true])test(`F15 ${outerUnknown?'unknown original write':'unknown verification'} never begins a replacement round or publishes`,async()=>{
  const f=fixture(outerUnknown?{outerUnknown:true}:{unknown:true}),{graph,operations,resolvedValues}=await drive(f);
  assert.equal(graph.state,'unknown');assert.equal(graph.codingRepair.round,0);assert.equal(f.checks,1);assert.equal(f.publishes,0);
  const original=operations.find(item=>item.proposal.toolName==='workflow.host.f15_n05').proposal;
  const next=await f.engine.advance({...f.original,checkpoint:graph.checkpoint,resolvedValues});
  assert.equal(next.state,'unknown');assert.equal(next.nodes.F15_N05.proposal.operationId,original.operationId);
  assert.equal(next.proposals.length,0);assert.equal(f.checks,1);
});
test('coding input remains bound to the original session and cannot introduce unpublished adapters',async()=>{
  const f=fixture();await assert.rejects(f.engine.advance({...f.original,sessionId:'different-session'}),{code:'INVALID_ARGUMENT'});
  const graph=await f.engine.advance({...f.original,availableTools:[]});assert.equal(graph.state,'unavailable');assert.equal(graph.proposals.length,0);
});
test('production-style external decision receipts do not replay an earlier source-read selection as the patch candidate',async()=>{
  const f=fixture({externalDecision:true}),{graph,operations}=await drive(f);
  assert.equal(graph.state,'settled');assert.equal(f.checks,2);assert.equal(f.reads,2);assert.equal(f.publishes,1);
  const decisions=operations.filter(o=>o.proposal.toolName==='decision.choose_candidate').map(o=>JSON.parse(o.proposal.arguments.context));
  assert.ok(decisions.some(context=>context.nodeId==='F15_N03'&&context.nodeContract.kind==='executor'
    &&context.codingRepair.currentSnapshot.files[0].content===source(1)),'The actual read source reaches the original selector');
});
test('isolated F15 finishes with a verified shadow artifact and never requests main publication',async()=>{
  const f=fixture({isolated:true,externalDecision:true}),{graph,operations}=await drive(f);
  assert.equal(graph.state,'settled');assert.equal(f.checks,2);assert.equal(f.reads,2);assert.equal(f.publishes,0);
  assert.equal(graph.nodes.F15_N06.state,'completed');assert.equal(graph.nodes.F15_N06.value.state,'shadow_artifact_verified');
  assert.equal(graph.nodes.F15_N06.value.published,false);assert.equal(graph.nodes.F15_N06.value.files[0].sha256,sha(source(3)));
  assert.ok(graph.nodes.F15_N06.evidenceRefs.length>0);assert.ok(graph.nodes.F15_N06.value.evidenceRefs.length>0);
  assert.ok(operations.every(operation=>operation.proposal.toolName!=='workflow.host.f15_n06'));
});
test('a new repair patch revalidates previously passing required recipes against the changed source',async()=>{
  const f=fixture({multiRecipe:true}),{graph,operations}=await drive(f);
  assert.equal(graph.state,'settled');assert.equal(f.checks,2);assert.equal(f.publishes,1);
  const checks=operations.filter(operation=>operation.proposal.toolName==='workflow.host.f15_n05');
  assert.equal(checks[0].receipt.result.verification[0].status,'VALID');
  assert.equal(checks[0].receipt.result.verification[1].status,'FAILED');
  assert.deepEqual(checks[1].proposal.arguments.recipeIds,['syntax','unit']);
  assert.ok(graph.codingRepair.verification.some(receipt=>receipt.runId==='syntax-verification-1'&&receipt.status==='STALE'));
  assert.equal(graph.codingRepair.verification.find(receipt=>receipt.runId==='syntax-verification-2').status,'VALID');
});
