import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnedWorkflowEngine,getOwnedWorkflowTemplate} from '../dist/index.js';

// Actual frontier with explicitly Synthetic host receipts; no cloud or effect
// verification is claimed by these template-ordering regressions.
for(const scenario of [
  {name:'ordinary',recovery:false,cancel:false,unknown:false},
  {name:'recovery without cancellation',recovery:true,cancel:false,unknown:false},
  {name:'cancelled in-flight',recovery:false,cancel:true,unknown:false},
  {name:'unknown recovery',recovery:true,cancel:false,unknown:true},
])test(`F24 ${scenario.name} preserves recovery ordering and truthful unknown`,async()=>{
  const template=getOwnedWorkflowTemplate('F24'),calls=[];
  for(const id of ['F24_N02','F24_N09'])assert.deepEqual(template.nodes.find(n=>n.id===id).dependencies.find(d=>d.nodeId==='F24_N11'),
    {nodeId:'F24_N11',required:false});
  const availableTools=template.nodes.flatMap(node=>[
    ...(node.kind==='host'?[{name:'workflow.host.'+node.id.toLowerCase(),version:'1.0.0',inputSchema:{type:'object'}}]:[]),
    ...(node.condition?[{name:'workflow.guard.'+node.id.toLowerCase(),version:'1.0.0',inputSchema:{type:'object'}}]:[]),
  ]);
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'synthetic-f24-template-checkpoint-secret-32',
    selector:{select:async()=> 'selected'},receiptVerifier:{verify:async receipt=>receipt.proof==='synthetic-f24-proof'},
    prepareCandidates:async()=>[{id:'selected',description:'Synthetic empty parameters',value:{arguments:{}}},
      {id:'recheck',description:'Synthetic abstention',value:{},abstain:true}]});
  const request={workflowId:'F24',taskId:'synthetic-task',sessionId:'synthetic-session',controlRevision:0,
    input:{synthetic:true},requestId:'synthetic-0',deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal,availableTools};
  let result=await engine.advance(request),sequence=0;
  for(;sequence<30&&!['settled','unknown'].includes(result.state);sequence++){
    const receipts=result.proposals.map(proposal=>{
      calls.push(proposal.toolName);
      const guard=proposal.toolName.startsWith('workflow.guard.');
      const selected=proposal.nodeId==='F24_N11'?scenario.recovery:
        ['F24_N06','F24_N08'].includes(proposal.nodeId)?scenario.cancel:
        proposal.nodeId==='F24_N09'?scenario.recovery||scenario.cancel:false;
      return {...proposal,state:!guard&&proposal.nodeId==='F24_N09'&&scenario.unknown?'unknown':'confirmed',
        result:guard?{state:selected?'selected':'skipped'}:{synthetic:true},evidenceRefs:['synthetic-evidence'],proof:'synthetic-f24-proof'};
    });
    result=await engine.advance({...request,requestId:'synthetic-'+(sequence+1),checkpoint:result.checkpoint,receipts});
  }
  assert.ok(sequence<30);assert.equal(result.state,scenario.unknown?'unknown':'settled');
  const recovery=calls.indexOf('workflow.host.f24_n11'),readback=calls.indexOf('workflow.host.f24_n09');
  if(scenario.recovery){assert.ok(recovery>=0);assert.ok(readback>recovery);}
  if(scenario.cancel)assert.ok(readback>calls.indexOf('workflow.host.f24_n08'));
  if(!scenario.cancel)assert.equal(calls.includes('workflow.host.f24_n06'),false);
  if(scenario.unknown)assert.notEqual(result.nodes.F24_N09.state,'completed');
});
