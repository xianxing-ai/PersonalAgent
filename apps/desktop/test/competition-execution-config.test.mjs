import assert from 'node:assert/strict';
import test from 'node:test';
import {readCompetitionExecutionPolicy} from '../electron/competition-execution-config.js';
import {submitConversationTask} from '../electron/runtime.js';

test('default policy is a progressive window without an invented total step budget',()=>{
  const value=readCompetitionExecutionPolicy({});
  assert.equal(value.initialWindowSteps,32);assert.equal(value.policy.mode,'progressive');
  assert.equal(Object.hasOwn(value.policy,'maxSteps'),false);assert.ok(Object.isFrozen(value.policy));
});

test('explicit host capacity and long task deadline survive the actual submit helper',async()=>{
  const config=readCompetitionExecutionPolicy({PA_AGENTARTS_EXECUTION_WINDOW_STEPS:'96',PA_AGENTARTS_EXECUTION_MAX_STEPS:'900',
    PA_AGENTARTS_TASK_TIMEOUT_MS:String(6*60*60_000)});
  let received;
  await submitConversationTask({call:async(...args)=>{received=args;return {taskId:'synthetic'};}},
    {goal:'Synthetic large project',conversationId:'fixture'},{competition:true,competitionTimeoutMs:config.taskTimeoutMs});
  assert.equal(config.initialWindowSteps,96);assert.equal(config.policy.maxSteps,900);
  assert.equal(received[2].timeoutMs,6*60*60_000);
});

test('invalid settings are rejected with the setting name and no arbitrary value echo',()=>{
  for(const [name,value] of [['PA_AGENTARTS_EXECUTION_WINDOW_STEPS','0'],['PA_AGENTARTS_EXECUTION_MAX_STEPS','Infinity'],
    ['PA_AGENTARTS_TASK_TIMEOUT_MS','2147483648'],['PA_AGENTARTS_EXECUTION_WINDOW_STEPS','secret-value']]) {
    assert.throws(()=>readCompetitionExecutionPolicy({[name]:value}),error=>error.message.includes(name)&&!error.message.includes(value));
  }
});
