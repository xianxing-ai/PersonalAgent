import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runCodingRepairFullGraphFixture} from '../../../tests/manual/agentarts/coding-repair-full-graph.mjs';
import {createWorkspaceCommandTool} from '@personal-agent/coding-tools';
const validate=report=>{
  assert.equal(report.parent.state,'succeeded',JSON.stringify(report.parent.error));
  assert.equal(report.child.state,'succeeded',JSON.stringify(report.child.error));
  assert.equal(report.graph.state,'settled');
  for(const id of ['01','02','03','04','05','06'])assert.equal(report.graph.nodes['F15_N'+id],'completed');
  assert.equal(report.graph.codingRepair.round,1);assert.equal(report.operations.filter(operation=>operation.name==='check').length,2);
  assert.equal(report.operations.filter(operation=>operation.name==='read').length,2);
  assert.equal(report.retainsUserComment,true);assert.equal(report.unrelatedUnchanged,true);
  assert.ok(report.timings.some(item=>item.stage==='image-advance'));
  assert.ok(report.timings.some(item=>item.stage==='host-readback'));
  assert.ok(report.evidence.every(record=>record.state==='confirmed'&&record.policyDecision==='allow'));
  assert.ok(report.observed.every(item=>item.catalogCount<=64&&item.catalogBytes<=32000));
};
test('normal main Agent dispatch runs the entire real isolated F15 graph, fails a real test and repairs only the original source',{skip:process.platform!=='win32'},async()=>{
  const report=await runCodingRepairFullGraphFixture({fakeModel:true});validate(report);
  assert.notEqual(report.mainRootAfterSha256,report.mainRootBeforeSha256);
  assert.match(await readFile(join(report.user,report.target),'utf8'),/=>3/);
  assert.equal(report.operations.filter(item=>item.name==='publish').length,1);
  assert.equal(report.cloudCalls,2,'Main Agent resumes once from the actual F15 child summary');
});
test('isolated shadow has its own complete F15 graph and verified artifact, with zero main-root publication',{skip:process.platform!=='win32'},async()=>{
  const report=await runCodingRepairFullGraphFixture({fakeModel:true,mode:'isolated'});validate(report);
  assert.equal(report.mainRootAfterSha256,report.mainRootBeforeSha256);
  assert.equal(report.operations.filter(item=>item.name==='publish').length,0);
});
test('original N05 approval survives SQLite restart and resumes only the same graph and operation',{skip:process.platform!=='win32'},async()=>{
  const report=await runCodingRepairFullGraphFixture({fakeModel:true,manualApprovalTools:['workflow.host.f15_n05'],approveOriginalOperations:true,restartOnApproval:true});
  validate(report);assert.equal(report.approvals,2);assert.equal(report.restarts,2);
  assert.equal(report.evidence.filter(record=>record.toolName==='workflow.host.f15_n05').length,2);
  assert.equal(report.evidence.filter(record=>record.toolName==='coding.repair.start').length,1);
});
test('concurrent target user change is preserved and original verified CAS delivery reports conflict',{skip:process.platform!=='win32'},async()=>{
  let changed=false;
  const report=await runCodingRepairFullGraphFixture({fakeModel:true,beforeHostOperation:async({name,user,app})=>{
    if(name==='publish'&&!changed){changed=true;const parent=app.runtime.listTasks({limit:100}).items.find(task=>task.conversationId==='synthetic-f15');
      const child=app.runtime.findTaskByIdempotencyKey('subagent-dispatch-'+parent.taskId+'-repair');
      const target=app.runtime.loadCheckpoint(child.taskId,'coding-repair:graph').input.codingRepair.initialSnapshot.files.find(file=>file.path.startsWith('feature-')).path;
      await writeFile(join(user,target),'User edited this target while Agent worked\n');}
  }});
  assert.equal(report.graph.state,'failed');assert.equal(report.child.state,'failed');
  assert.equal(await readFile(join(report.user,report.target),'utf8'),'User edited this target while Agent worked\n');
  assert.equal(report.operations.filter(item=>item.name==='publish').length,1);assert.equal(report.unrelatedUnchanged,true);
});
test('cloud self-reported settled cannot complete F15 without original local verification and publish evidence',{skip:process.platform!=='win32'},async()=>{
  const report=await runCodingRepairFullGraphFixture({fakeModel:true,image:{bindingId:'explicit-fake-malicious-image',receiptSecret:async()=> 'explicit-fake-host-receipt-key-more-than-32',
    advance:async()=>({workflowVersion:'1.0.0',workflowId:'F15',state:'settled',verification:'unverified',checkpoint:'untrusted-cloud-claim',
      nodes:{F15_N06:{state:'completed',value:{state:'published'}}},proposals:[],unavailable:[],feedback:[]})}});
  assert.equal(report.child.state,'failed');assert.equal(report.child.error.code,'UNAUTHORIZED');
  assert.equal(report.mainRootAfterSha256,report.mainRootBeforeSha256);
  assert.equal(report.operations.some(item=>item.name==='check'||item.name==='publish'),false);
});
test('cancel propagates from original graph into its running N05 host command and never publishes the main root',{skip:process.platform!=='win32'},async()=>{
  let application,commandFinished=false;
  const report=await runCodingRepairFullGraphFixture({fakeModel:true,beforeHostOperation:async({app})=>{application=app;},hostOptions:{
    createCommandTool:({rootPath,session})=>{
      const original=createWorkspaceCommandTool({rootPath,recipes:[{id:'unit',executable:process.execPath,args:['-e','setInterval(()=>{},1000)']}]});
      return {...original,execute:async(input,context)=>{
        const timer=setTimeout(()=>application.runtime.requestCancel(session.taskId,'Explicit fixture cancel during original command'),100);
        try{return await original.execute(input,context);}finally{clearTimeout(timer);commandFinished=true;}
      }};
    }}});
  assert.equal(report.child.state,'cancelled');assert.equal(report.mainRootAfterSha256,report.mainRootBeforeSha256);
  assert.equal(commandFinished,true,'the report must wait for the original command cancellation to finish');
  assert.equal(report.operations.filter(item=>item.name==='check').length,1);
  assert.equal(report.operations.some(item=>item.name==='publish'),false);
  const host=report.evidence.find(record=>record.toolName==='workflow.host.f15_n05');
  assert.ok(host);assert.ok(['unknown','failed'].includes(host.state));
});
