import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {workflowQuestionMarkup,mountWorkflowQuestionCards} from '../src/features/conversation/workflow-question-card.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';

test('F08 displays the exact original draft as text and sends only its bound adoption decision',async t=>{
  const now=Date.parse('2030-11-01T02:00:00Z'),question={questionId:'original-mail-question',taskId:'original-host',sourceTaskId:'original-user',
    conversationId:'mail-conversation',revision:1,state:'pending',deadline:new Date(now+60_000).toISOString(),field:'mail.decision',prompt:'是否采用这封草稿？',
    draft:{account:'original-account',to:'recipient@example.invalid',subject:'<original subject>',text:'完整原正文\n<script>external text</script>'},
    references:[{path:'source.md',line:3,revision:'a'.repeat(64)}]};
  const html=workflowQuestionMarkup(question,{now});assert.match(html,/recipient@example.invalid/);assert.match(html,/完整原正文/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|data-authorization-decision/);assert.match(html,/source.md · 第 3 行/);
  const f=authorizationDom(),calls=[],cards=mountWorkflowQuestionCards(f.root,{now:()=>now,commandId:()=> 'message-1',invoke:async(action,body)=>{
    calls.push({action,body});return {...question,state:'answered',revision:2,decision:body.decision};}});
  t.after(()=>cards.dispose());cards.update([question],{conversationId:'different'});assert.equal(f.root.hidden,true);
  cards.update([question],{conversationId:question.conversationId});await f.root.fire('click',f.root.querySelector('[data-workflow-answer="decline"]'));
  assert.deepEqual(calls,[{action:'workflow.f08.decision.respond',body:{taskId:'original-host',sourceTaskId:'original-user',questionId:'original-mail-question',
    expectedRevision:1,commandId:'message-1',decision:'decline'}}]);assert.equal(f.root.hidden,true);
});

test('actual Main binds the F08 decision to the trusted active conversation and rejects other windows',async()=>{
  const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8'),start=main.indexOf("if(['workflow.f11.location.respond'"),end=main.indexOf("if(['authorization.sandbox.read'",start);
  assert.ok(start>=0&&end>start);const calls=[],panel={},workspace={},admin={};
  const scope={name:'workflow.f08.decision.respond',payload:{decision:'decline'},panel,workspace,admin,sender:panel,
    conversations:{activeConversationId:surface=>surface+'-current'},publish(){},
    f08DecisionQuestion:{submitReply:(body,context)=>{calls.push({body,context});return {state:'answered'};}}};
  const run=()=>runInNewContext('(async()=>{'+main.slice(start,end)+'})()',scope);
  await run();assert.equal(calls[0].body,scope.payload);assert.equal(calls[0].context.conversationId,'panel-current');
  scope.sender=admin;await assert.rejects(run(),/原对话/);assert.equal(calls.length,1);
});
