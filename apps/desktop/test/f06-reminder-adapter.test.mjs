import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {createDesktopTodoHost} from '../electron/todo-host.js';

// Synthetic bindings exercise the host boundary; they are not a graph receipt
// or a real OS notification acceptance test.
const cache=new URL('../../../.cache/f06-reminder-adapter/',import.meta.url);
mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),
  decryptString:value=>Buffer.from(value).toString()};
function application(){const checkpoints=new Map();return {runtime:{
  loadCheckpoint:(taskId,key)=>checkpoints.get(taskId+':'+key),
  saveCheckpoint:(taskId,key,value)=>checkpoints.set(taskId+':'+key,value),
  listSchedules:()=>[]}};}
function open(options={}) {
  const host=createDesktopTodoHost({userData:mkdtempSync(new URL('case-',cache)),safeStorage,namespace:'synthetic-f06',
    createDeliveryHost:()=>({async tick(){},async close(){}}),...options});
  host.bindApplication(application());return host;
}
function context(){return {taskId:'synthetic-task',runId:'synthetic-run',signal:new AbortController().signal,
  deadline:new Date(Date.now()+60_000).toISOString(),authorizationRef:'synthetic-grant',scopes:['todo:read']};}

test('F06 reminder adapter is absent without a trusted original graph binding provider',async()=>{
  const host=open();
  try {assert.equal(host.tools.some(tool=>tool.descriptor.name==='workflow.host.f06_n04'),false);}
  finally {await host.close();}
});

test('F06 reminder adapter reads actual time and revision only after matching consent and original binding',async()=>{
  let now=Date.now(),allowedBinding=true;
  const host=open({now:()=>now,verifyWorkflowReminderBinding:async()=>allowedBinding});
  try {
    const snapshot=await host.create({title:'Synthetic reminder',remindUtc:new Date(now+60_000).toISOString()});
    const item=snapshot.items[0],input={todoId:item.id,revision:item.revision},ctx=context();
    const tool=host.tools.find(item=>item.descriptor.name==='workflow.host.f06_n04');
    assert.ok(tool);host.authorize({readAndCloudConsent:true});
    assert.equal(host.competitionToolAvailability.find(item=>item.toolName===tool.descriptor.name).available(ctx),true);
    assert.deepEqual(await tool.execute(input,ctx),{isTaskAlreadyFinished:false,shouldFireAlarm:false});
    now+=61_000;
    assert.deepEqual(await tool.execute(input,ctx),{isTaskAlreadyFinished:false,shouldFireAlarm:true});
    allowedBinding=false;await assert.rejects(tool.execute(input,ctx),/原确认回执/);
    allowedBinding=true;await host.update({id:item.id,status:'done'});
    await assert.rejects(tool.execute(input,ctx),/版本已变化/);
    host.revoke();await assert.rejects(tool.execute(input,ctx),/许可已失效/);
  } finally {await host.close();}
});
