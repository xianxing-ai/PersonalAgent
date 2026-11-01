import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {readF11ConversationQuestions} from '../electron/f11-conversation-questions.js';
import {workflowQuestionReply,workflowQuestionMarkup,mountWorkflowQuestionCards} from '../src/features/conversation/workflow-question-card.js';
import {taskProgress} from '../src/features/conversation/task-progress.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';

const instant=Date.parse('2030-11-01T02:00:00Z');
const question=(extra={})=>({questionId:'original-question',taskId:'original-host',sourceTaskId:'original-user',
  graphTaskId:'original-graph',conversationId:'original-conversation',revision:1,state:'pending',field:'weather.location',
  prompt:'请补充地点',deadline:new Date(instant+60_000).toISOString(),...extra});

test('F11 projection discovers each original graph question and excludes unrelated conversations and withheld tasks',()=>{
  const reads=[],application={readSubagentTasks:id=>{assert.equal(id,'original-user');return [{taskId:'graph-a'},{taskId:'graph-b'}];}};
  const host={readQuestion:scope=>{reads.push(scope);return scope.taskId==='graph-a'?question():scope.taskId==='graph-b'?question({questionId:'another',conversationId:'other'}):undefined;}};
  const tasks=[{taskId:'original-user',state:'running'},{taskId:'private',state:'running',bodyWithheld:true},{taskId:'finished',state:'succeeded'}];
  assert.deepEqual(readF11ConversationQuestions({application,hosts:[host,host],tasks,conversationId:'original-conversation'}),[question()]);
  assert.ok(reads.every(scope=>scope.conversationId==='original-conversation'));
  assert.deepEqual(readF11ConversationQuestions({application,hosts:[host],tasks}),[]);
  assert.deepEqual(readF11ConversationQuestions({application:{},hosts:[undefined],tasks,conversationId:'original-conversation'}),[],
    'unconfigured and Fake Main snapshots do not require a real Runtime question port');
});

test('F11 reply contains exact original question identity and only the requested field',()=>{
  assert.deepEqual(workflowQuestionReply(question(),' Beijing ','message',instant),{taskId:'original-host',sourceTaskId:'original-user',
    questionId:'original-question',expectedRevision:1,commandId:'message',location:'Beijing'});
  for(const value of ['', '\n', 'a\u0000b','a'.repeat(513)])assert.throws(()=>workflowQuestionReply(question(),value,'message',instant));
  assert.throws(()=>workflowQuestionReply(question(),'Beijing','message',instant+60_000));
  const decision=question({field:'plan.decision',plan:{update:{externalId:'event',location:'<script>bad</script>'},reminder:{todoId:'old'}}});
  assert.equal(workflowQuestionReply(decision,'decline','message',instant).decision,'decline');
  assert.throws(()=>workflowQuestionReply(decision,'allow_once','message',instant));
  const html=workflowQuestionMarkup(decision,{now:instant});
  assert.match(html,/不采用/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|data-authorization-decision/);
  assert.match(html,/旧提醒将失效/);
});

test('F11 location draft survives progress and retries use the identical original message after uncertain delivery',async t=>{
  const f=authorizationDom(),calls=[],q=question();let attempt=0,ids=0;
  const cards=mountWorkflowQuestionCards(f.root,{now:()=>instant,commandId:()=>`message-${++ids}`,invoke:async(action,body)=>{
    calls.push({action,body});if(++attempt===1)throw Error('transport unknown');return {...q,state:'answered',revision:2,location:body.location};}});
  t.after(()=>cards.dispose());cards.update([q],{conversationId:q.conversationId});
  const input=f.root.querySelector('[name="location"]');input.value='Beijing';input.focus();await f.root.fire('input',input);
  cards.update([q],{conversationId:q.conversationId});assert.equal(f.root.querySelector('[name="location"]'),input);assert.equal(input.value,'Beijing');
  await f.root.listeners.get('submit')({type:'submit',target:f.root.querySelector('[data-workflow-form]'),preventDefault(){}});
  assert.match(f.root.html,/同一条回答/);assert.equal(f.root.querySelector('[name="location"]').disabled,true);
  await f.root.fire('click',f.root.querySelector('[data-workflow-retry]'));
  assert.equal(ids,1);assert.equal(calls.length,2);assert.equal(calls[0].action,'workflow.f11.location.respond');assert.equal(calls[0].body,calls[1].body);
  assert.equal(f.root.hidden,true);cards.update([q],{conversationId:q.conversationId});assert.equal(f.root.hidden,true,'stale pending snapshot cannot reopen an answered question');
});

test('F11 decision controls preserve the original candidate and never appear outside its conversation',async t=>{
  const f=authorizationDom(),calls=[],q=question({field:'plan.decision',plan:{update:{externalId:'event',location:'online'},reminder:{todoId:'old'}}});
  const cards=mountWorkflowQuestionCards(f.root,{now:()=>instant,commandId:()=> 'original-message',invoke:async(action,body)=>{calls.push({action,body});return {...q,state:'answered',revision:2,decision:body.decision};}});
  t.after(()=>cards.dispose());cards.update([q]);assert.equal(f.root.hidden,true);cards.update([q],{conversationId:'other'});assert.equal(f.root.hidden,true);
  cards.update([q],{conversationId:q.conversationId});await f.root.fire('click',f.root.querySelector('[data-workflow-answer="decline"]'));
  assert.equal(calls[0].action,'workflow.f11.decision.respond');assert.deepEqual(Object.keys(calls[0].body).sort(),['commandId','decision','expectedRevision','questionId','sourceTaskId','taskId']);
  assert.equal(calls[0].body.decision,'decline');assert.equal(f.root.hidden,true);
  const task={taskId:'user',state:'running',updatedAt:new Date(instant).toISOString()};
  assert.equal(taskProgress([task],null,{workflowQuestions:[q],conversationId:q.conversationId,now:instant}).label,'等待补充信息');
  assert.notEqual(taskProgress([task],null,{workflowQuestions:[q],conversationId:'other',now:instant}).label,'等待补充信息');
});

test('actual Main F11 reply uses the trusted active conversation and rejects the admin surface',async()=>{
  const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8'),start=main.indexOf("if(['workflow.f11.location.respond'"),end=main.indexOf("if(['authorization.sandbox.read'",start);
  assert.ok(start>=0&&end>start);const calls=[],panel={},workspace={},admin={},payload={location:'Beijing'};
  const scope={name:'workflow.f11.location.respond',payload,panel,workspace,admin,sender:panel,
    conversations:{activeConversationId:surface=>surface+'-current'},publish(){},
    f11LocationQuestion:{submitReply:(body,context)=>{calls.push({body,context});return {state:'answered'};}},
    f11DecisionQuestion:{submitReply:(body,context)=>{calls.push({body,context,decision:true});return {state:'answered'};}}};
  const run=()=>runInNewContext('(async()=>{'+main.slice(start,end)+'})()',scope);
  await run();assert.equal(calls[0].body,payload);assert.equal(calls[0].context.conversationId,'panel-current');
  scope.sender=workspace;await run();assert.equal(calls[1].context.conversationId,'workspace-current');
  scope.sender=admin;await assert.rejects(run(),/原对话/);assert.equal(calls.length,2);
  scope.name='workflow.f11.decision.respond';await assert.rejects(run(),/原对话/);scope.sender=panel;await run();
  assert.equal(calls[2].decision,true);assert.equal(calls[2].context.conversationId,'panel-current');
});
