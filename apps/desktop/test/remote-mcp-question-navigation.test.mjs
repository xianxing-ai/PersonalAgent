import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
test('actual Main focuses the exact live MCP question without deciding it or changing conversations',()=>{
  const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='focusRemoteMcpAuthorizationQuestion');
  assert.ok(node,'Main must supply the original-question navigation port');
  const original={taskId:'original',sourceApprovalId:'original-approval',questionId:'original-question',conversationId:'original-panel',
    state:'pending',expiresAt:new Date(Date.now()+60000).toISOString()};
  function fixture(){const questions=[structuredClone(original)],opened=[];
    const context={authorizationQuestionHost:{snapshot:()=>questions,respond(){assert.fail('Navigation cannot decide authorization');}},
      conversations:{activeConversationId:()=> 'original-panel',switch(){assert.fail('Navigation cannot silently change the conversation');}},
      panel:{isDestroyed:()=>false},pinned:false,openPanel:value=>opened.push(value),publish(){},Date};
    const focus=new Function('context','with(context){return '+node.getText(ast)+';}')(context);
    return {context,questions,opened,focus};}
  const binding={taskId:original.taskId,approvalId:original.sourceApprovalId};
  const valid=fixture();assert.equal(valid.focus(binding),true);assert.deepEqual(valid.opened,[true]);assert.equal(valid.context.pinned,true);
  assert.deepEqual(valid.questions,[original]);
  for(const change of [f=>{f.questions[0].taskId='other';},f=>{f.questions[0].sourceApprovalId='other';},
    f=>{f.questions[0].state='cancelled';},f=>{f.questions[0].conversationId='other';},
    f=>{f.questions[0].expiresAt=new Date(Date.now()-1000).toISOString();},f=>{f.context.panel.isDestroyed=()=>true;},
    f=>{f.context.panel=undefined;},f=>{f.context.authorizationQuestionHost=undefined;}]){
    const invalid=fixture();change(invalid);assert.equal(invalid.focus(binding),false);assert.deepEqual(invalid.opened,[]);assert.equal(invalid.context.pinned,false);
  }
});
