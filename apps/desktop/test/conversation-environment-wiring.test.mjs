import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication, createDesktopSubagentDispatchTool, createReminderDeliveryHost} from '@personal-agent/runtime/application';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createConversationToolAccess} from '../electron/conversation-tool-access.js';
import {createConversationEnvironmentContext} from '../electron/conversation-environment-context.js';

const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const source = main.match(/function readDesktopRequestContext\(scope\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(source, 'actual Main environment callback must exist');
assert.match(main, /readRequestContext:readDesktopRequestContext/);
const encryption = {isEncryptionAvailable:() => true, encryptString:value => Buffer.from(value).reverse(),
  decryptString:value => Buffer.from(value).reverse().toString()};
const read = {name:'fixture.time-context.read', version:'1.0.0', sideEffect:'read', requiredScopes:['fixture:read'],
  requiresPresence:false, recoverySupport:true, idempotencySupport:true,
  inputSchema:{type:'object',properties:{},additionalProperties:false}, outputSchema:{type:'object'}};

test('Synthetic actual Main callback feeds fresh time and consent guidance through forced Competition child and parent continuation', async t => {
  const cache = path.resolve('.cache/issue-474-wiring'); mkdirSync(cache, {recursive:true});
  const base = realpathSync(cache);
  const userData = mkdtempSync(path.join(base, 'case-'));
  let app, clock = Date.parse('2030-10-21T15:59:59Z');
  const host = createDesktopTodoHost({userData,safeStorage:encryption,namespace:'synthetic-474',
    now:() => clock,createDeliveryHost:createReminderDeliveryHost});
  const access = createConversationToolAccess({getApplication:() => app,
    getConversations:() => ({containsConversation:id => id === 'synthetic-main'}), now:() => clock});
  const readRequestContext = vm.runInNewContext(`(${source})`, {conversationToolAccess:access,todoHost:host,
    createConversationEnvironmentContext:options => createConversationEnvironmentContext({...options,
      now:() => new Date(clock),readTimeZone:() => 'Asia/Shanghai'})});
  const dispatch = createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:() => app.runtime,
    getTools:() => app.tools,runDefaultWorker:(task,worker,tools) => app.runDefaultSubagentWorker(task,worker,tools)});
  const captured = [];
  app = createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,
    now:() => new Date(clock),tools:[dispatch,...host.tools,{descriptor:read,execute:async () => ({value:'Synthetic public read'})}],
    automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version},
      {toolName:read.name,toolVersion:read.version}],
    competitionToolAvailability:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version,available:() => true},
      ...host.competitionToolAvailability,{toolName:read.name,toolVersion:read.version,available:() => true}],
    competitionToolExports:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version,
      exportPolicyVersion:'synthetic-dispatch',accepts:() => true,project:({result}) => result},...host.competitionToolExports,
      {toolName:read.name,toolVersion:read.version,exportPolicyVersion:'synthetic-read',accepts:() => true,project:({result}) => result}],
    coordinationInput:{beforeCoordinationSend(){},readRequestContext},coordination:{execute:async request => {
      app.assertCompetitionExportAllowed(request);
      const data = JSON.parse(request.goal.split('\n')[1]);
      captured.push({request,data}); clock += 1000;
      assert.equal(data.capabilityGuidance[0].state,'authorization_required');
      assert.equal(request.availableTools?.some(tool => tool.name === 'todo.create') ?? false,false);
      if(app.runtime.getTask(request.taskId).conversationId.startsWith('desktop-subtask:') && !request.continuation) {
        return {kind:'tool_proposal',proposalId:'synthetic-read',toolName:read.name,toolVersion:read.version,
          arguments:{},verification:'unverified'};
      }
      return {kind:'text',text:'Synthetic answer: request the current conversation authorization card',verification:'mock'};
    }}});
  host.bindApplication(app);
  t.after(async () => {await host.close();app.close();assert.equal(path.dirname(realpathSync(userData)),base);
    rmSync(userData,{recursive:true,force:true});});
  const client = new Client(app, () => clock); await client.connect();
  const task = await client.call('task.submit',{goal:'3 分钟后提醒我 Synthetic laundry',conversationId:'synthetic-main'},
    {idempotencyKey:'synthetic-time',timeoutMs:60000});
  for(let n=0;n<200 && app.activeTaskCount;n++) await new Promise(resolve => setTimeout(resolve,5));
  assert.equal(app.runtime.getTask(task.taskId).state,'succeeded');
  const [child] = app.readSubagentTasks(task.taskId); assert.equal(child.state,'succeeded');
  assert.equal(captured.length,3);
  assert.equal(captured[0].data.time.localDateTime,'2030-10-21T23:59:59');
  assert.equal(captured[1].data.time.localDateTime,'2030-10-22T00:00:00');
  assert.equal(captured[2].data.time.localDateTime,'2030-10-22T00:00:01');
  assert.equal(captured[2].request.taskId,task.taskId);
  assert.equal(captured[0].request.taskId,child.taskId);
  for(const {request,data} of captured) {
    const checkpoint = app.runtime.loadCheckpoint(request.taskId,'competition-context:v1');
    assert.doesNotMatch(JSON.stringify(checkpoint), /trusted_desktop_environment|sampledAtUtc|authorization_required/);
    assert.match(data.capabilityGuidance[0].relativeReminder,/remindInMinutes/);
  }
  const calendar = await client.call('task.submit',{goal:'明天上午10点建 Synthetic 验收会议',conversationId:'synthetic-main'},
    {idempotencyKey:'synthetic-calendar-context',timeoutMs:60000});
  for(let n=0;n<200 && app.activeTaskCount;n++) await new Promise(resolve => setTimeout(resolve,5));
  assert.equal(app.runtime.getTask(calendar.taskId).state,'succeeded');
  assert.equal(captured.length,6);
  assert.match(captured[3].request.goal,/明天上午10点/);
  assert.equal(captured[3].data.time.timeZone,'Asia/Shanghai');
  assert.match(captured[3].data.time.localDateTime,/^2030-10-22T/);
  assert.equal(host.snapshot().items.length,0,'no todo or calendar is created by context or a guide');
  assert.deepEqual(host.readConversationGuidance(),{registered:true,availability:'consent_required',reasonCode:'TODO_CONSENT_REQUIRED'});
  assert.equal(readRequestContext({taskId:'unknown-scope'}),undefined,'unknown/internal scope does not receive chat environment data');
  host.authorize({readAndCloudConsent:true}); // Explicit Synthetic user, never a model action.
  assert.equal(JSON.parse(readRequestContext({taskId:task.taskId})).capabilityGuidance[0].state,'check_task_catalog');
  host.revoke();
  assert.equal(JSON.parse(readRequestContext({taskId:task.taskId})).capabilityGuidance[0].state,'authorization_required');
});
