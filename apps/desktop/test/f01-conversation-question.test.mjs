import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWorkflowQuestionCards,workflowQuestionReply} from '../src/features/conversation/workflow-question-card.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';

test('F01 clarification preserves the original question and submits text without an authorization decision',async t=>{
  const now=Date.parse('2030-11-01T02:00:00Z'),question={questionId:'original-question',taskId:'original-host',sourceTaskId:'original-user',
    conversationId:'original-conversation',revision:1,state:'pending',deadline:new Date(now+60_000).toISOString(),
    field:'responsibility.clarification',prompt:'这项责任的结束条件是什么？'};
  const f=authorizationDom(),calls=[],cards=mountWorkflowQuestionCards(f.root,{now:()=>now,commandId:()=> 'original-answer',invoke:async(action,body)=>{
    calls.push({action,body});return {...question,state:'answered',revision:2,answer:body.answer};}});
  t.after(()=>cards.dispose());cards.update([question],{conversationId:'another'});assert.equal(f.root.hidden,true);
  cards.update([question],{conversationId:question.conversationId});const input=f.root.querySelector('[name="answer"]');
  input.value=' 完成原报告后结束 ';await f.root.fire('input',input);
  await f.root.listeners.get('submit')({type:'submit',target:f.root.querySelector('[data-workflow-form]'),preventDefault(){}});
  assert.deepEqual(calls,[{action:'workflow.f01.clarification.respond',body:{taskId:'original-host',sourceTaskId:'original-user',
    questionId:'original-question',expectedRevision:1,commandId:'original-answer',answer:'完成原报告后结束'}}]);
  assert.equal(f.root.hidden,true);assert.throws(()=>workflowQuestionReply(question,'x'.repeat(2049),'overflow',now));
});
