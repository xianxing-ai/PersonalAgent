import test from 'node:test';
import assert from 'node:assert/strict';
import {goalExportDiagnostic, assertGoalExportReceipt} from './support/goal-export-diagnostic.mjs';

const secret = 'SYNTHETIC_PRIVATE_BODY_AND_CREDENTIAL';
function fixture({deadline = '2026-10-21T11:00:10.000Z', loop, tools = [], task = {state:'failed',error:{code:'TIMEOUT'}}} = {}) {
  const reads = [];
  const runtime = {
    loadCheckpoint(taskId, key) {reads.push([taskId,key]);return key === 'application-deadline' ? deadline : loop;},
    readToolExecutions(taskId) {reads.push([taskId,'tools']);return tools;},
  };
  return {reads, input: {runtime,task:{taskId:secret,goal:secret,resultSummary:secret,...task},phase:'initial_goal',toolName:'goals.get',change:'unrelated',credentials:0,fetches:0,now:'2026-10-21T11:00:11.000Z'}};
}

test('initial-task diagnostic identifies expiry before credentials without exporting task data', () => {
  const {input,reads} = fixture();
  assert.deepEqual(goalExportDiagnostic(input), {
    phase:'initial_goal',toolName:'goals.get',change:'unrelated',state:'failed',errorCode:'TIMEOUT',
    deadline:'2026-10-21T11:00:10.000Z',now:'2026-10-21T11:00:11.000Z',deadlineExpired:true,
    credentials:0,fetches:0,tools:[],receiptCount:0,continuationPresent:false,externalCloud:false,
  });
  assert.deepEqual(reads, [[secret,'application-deadline'],[secret,'competition-loop'],[secret,'tools']]);
  assert.equal(JSON.stringify(goalExportDiagnostic(input)).includes(secret), false);
});

test('restored-task diagnostic preserves safe status while omitting errors and receipt payloads', () => {
  const {input} = fixture({
    task:{state:'succeeded',error:{code:'EXTERNAL_FAILURE',message:secret,detail:secret}},
    loop:{receipts:[{continuation:{state:'confirmed',result:{body:secret}},proposal:{arguments:secret}}],private:secret},
    tools:[{state:'confirmed',errorCode:undefined,result:secret,arguments:secret},{state:'failed',errorCode:'UNAUTHORIZED',error:secret}],
  });
  const result = goalExportDiagnostic({...input,phase:'restored_goal',change:'restricted',credentials:4,fetches:3,now:'2026-10-21T11:00:09.000Z'});
  assert.equal(result.phase,'restored_goal');assert.equal(result.state,'succeeded');
  assert.equal(result.errorCode,'EXTERNAL_FAILURE');assert.equal(result.deadlineExpired,false);
  assert.equal(result.receiptCount,1);assert.equal(result.continuationPresent,true);
  assert.deepEqual(result.tools,[{state:'confirmed',errorCode:null},{state:'failed',errorCode:'UNAUTHORIZED'}]);
  assert.equal(JSON.stringify(result).includes(secret),false);
});

test('unknown diagnostic strings and malformed timestamps or counts cannot leak', () => {
  const {input} = fixture({deadline:secret,loop:{receipts:secret},task:{state:secret,error:{code:secret,message:secret}},tools:[{state:secret,errorCode:secret}]});
  const result = goalExportDiagnostic({...input,phase:secret,toolName:secret,change:secret,now:secret,credentials:secret,fetches:-1});
  assert.deepEqual(result, {phase:'OTHER',toolName:'OTHER',change:'OTHER',state:'OTHER',errorCode:'OTHER',deadline:null,now:null,deadlineExpired:null,
    credentials:null,fetches:null,tools:[{state:'OTHER',errorCode:'OTHER'}],receiptCount:0,continuationPresent:false,externalCloud:false});
  assert.equal(JSON.stringify(result).includes(secret),false);
});

test('missing receipts fail with phase and bounded diagnostics instead of a dereference error', () => {
  const {input} = fixture({task:{state:'waiting_reconciliation',error:{code:'TIMEOUT',message:secret}}});
  const diagnostic = goalExportDiagnostic(input);
  for (const receipt of [undefined,{}, {continuation:undefined}, {continuation:null}]) {
    assert.throws(() => assertGoalExportReceipt(receipt,diagnostic), error => {
      assert.equal(error.code,'ERR_ASSERTION');
      assert.match(error.message,/Expected confirmed Goal export receipt/);
      assert.match(error.message,/"phase":"initial_goal"/);
      assert.match(error.message,/"receiptCount":0/);
      assert.match(error.message,/"errorCode":"TIMEOUT"/);
      assert.equal(error.message.includes(secret),false);
      return true;
    });
  }
  assert.doesNotThrow(() => assertGoalExportReceipt({continuation:{state:'confirmed',result:secret}},diagnostic));
});
