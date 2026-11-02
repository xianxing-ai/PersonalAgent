import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeApplication} from '../dist/application.js';

const descriptor={name:'fixture.publish',version:'1.0.0',sideEffect:'external_write',requiredScopes:['fixture:publish'],
  inputSchema:{type:'object',properties:{body:{type:'string'}},required:['body'],additionalProperties:false},
  outputSchema:{type:'object'},requiresPresence:false,recoverySupport:false,idempotencySupport:false};

for(const changeDuringQuestion of [false,true])test(`conversation prohibition blocks actual execution ${changeDuringQuestion?'after waiting for consent':'before asking for consent'}`,async()=>{
  let blocked=!changeDuringQuestion,questions=0,executions=0,observed;
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'control-fixture',
    tools:[{descriptor,execute:async()=>{executions++;return {};}}],requiresToolAuthorization:()=>true,
    requestToolAuthorization:async()=>{questions++;await Promise.resolve();blocked=true;return 'allow_once';},
    assertToolAllowed:scope=>{observed=scope;if(blocked)throw new ProtocolError('UNAUTHORIZED','Synthetic current conversation prohibition');}});
  try{
    const submitted=app.submitHostToolTask({commandId:'publish',toolName:descriptor.name,toolVersion:descriptor.version,
      arguments:{body:'Complete public fixture'},deadline:new Date(Date.now()+10000).toISOString()});
    for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(app.activeTaskCount,0);
    assert.equal(app.runtime.getTask(submitted.task.taskId).state,'failed');
    assert.equal(executions,0);assert.equal(questions,changeDuringQuestion?1:0);
    assert.equal(observed.toolName,descriptor.name);assert.deepEqual(observed.arguments,{body:'Complete public fixture'});
    assert.ok(app.runtime.readToolExecutions(submitted.task.taskId).every(record=>!record.executionStarted));
  }finally{app.close();}
});

test('Desktop history overlay cannot erase original pending task metadata before compaction',()=>{
  const app=createRuntimeApplication({path:':memory:'});
  try{
    const task=app.runtime.submitTask({goal:'Keep the pending action',conversationId:'pending-fixture',idempotencyKey:'pending'});
    app.runtime.transitionTask(task.taskId,'planning');app.runtime.transitionTask(task.taskId,'running');
    const messages=app.readConversationContext({conversationId:'pending-fixture',deadline:new Date(Date.now()+10000).toISOString(),
      signal:new AbortController().signal,historyMessages:[{id:task.taskId+':user',role:'user',content:task.goal}]});
    assert.equal(messages.find(message=>message.id===task.taskId+':user').taskState,'running');
  }finally{app.close();}
});
