// Real public provider; programmatic original approval response, no model/device claim.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createPublicConnectorHost} from '../../../apps/desktop/electron/public-connector-host.js';
const startedAt=new Date().toISOString(),directory=await mkdtemp('.cache/real-weather-');
const host=createPublicConnectorHost(),original=host.tools.find(t=>t.descriptor.name==='weather.forecast');
let executions=0,app;
const tool={descriptor:original.descriptor,execute:(input,context)=>{executions++;return original.execute(input,context);}};
const options={path:directory+'/runtime.sqlite',profile:'huawei_ict_agentarts',hostUserNamespace:'public-weather-real-acceptance-20261022',tools:[tool]};
const until=async predicate=>{const end=Date.now()+90000;while(!predicate()){assert.ok(Date.now()<end,'Runtime acceptance deadline');await new Promise(r=>setTimeout(r,20));}};
let taskId;
try{
 app=createRuntimeApplication(options);const client=new Client(app);await client.connect();
 const input={commandId:randomUUID(),toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
  arguments:{location:'北京',locationQuery:'Beijing',date:new Date().toISOString().slice(0,10),units:'metric'},deadline:new Date(Date.now()+90000).toISOString()};
 taskId=app.submitHostToolTask(input).task.taskId;
 await until(()=>app.runtime.getTask(taskId).state==='waiting_approval');assert.equal(executions,0);
 const approval=app.readHostToolTask(taskId).approval;
 await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
 await until(()=>app.activeTaskCount===0);
 const readback=app.readHostToolTask(taskId),records=app.runtime.readToolExecutions(taskId),evidence=app.runtime.readEvidence(taskId);
 const receipt={startedAt,finishedAt:new Date().toISOString(),profile:options.profile,approval:'programmatic original Client authorization.respond allow_once',
  taskId,executions,readback,records,evidence,physicalDevice:false,modelCalled:false,watchChain:false};
 if(readback.confirmed){assert.equal(readback.task.state,'succeeded');assert.equal(executions,1);assert.equal(records[0].policyDecision,'allow');
  assert.equal(records[0].state,'confirmed');assert.ok(evidence.length);assert.equal(app.runtime.policy.get(readback.confirmed.runId).usesRemaining,0);
  app.close();app=createRuntimeApplication(options);assert.deepEqual(app.readHostToolTask(taskId).confirmed,readback.confirmed);receipt.restartReadback=true;}
 await writeFile(directory+'/receipt.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({receiptPath:directory+'/receipt.json',taskId,state:readback.task.state,executions,
  runId:readback.confirmed?.runId,restartReadback:receipt.restartReadback,resultSha256:readback.confirmed?createHash('sha256').update(JSON.stringify(readback.confirmed.result)).digest('hex'):null}));
 assert.equal(readback.task.state,'succeeded','Real weather provider must succeed');
}finally{app?.close();host.close();}
