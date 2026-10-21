import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {approvalCards,nextApprovalExpiry} from '../src/features/conversation/approval-card.js';
import {approvalsWithoutQuestionCards} from '../src/features/conversation/authorization-question-card.js';

const source=await readFile(new URL('../src/app/renderer.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('renderer.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functions=new Map();let syncButtons,unload;
function visit(node) {
  if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node.getText(ast));
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='syncApprovalButtons')syncButtons=node.initializer.getText(ast);
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='window.addEventListener'
    &&node.arguments[0]?.getText(ast)==="'unload'"&&node.arguments[1]?.getText(ast).includes('wakeClosed=true'))unload=node.arguments[1].getText(ast);
  ts.forEachChild(node,visit);
}
visit(ast);assert.ok(functions.has('refreshApprovalCards')&&functions.has('scheduleApprovalExpiry')&&syncButtons&&unload);
const initialTime=Date.parse('2026-10-07T19:30:00Z');
const task={taskId:'task',state:'waiting_approval'};
const grant=(milliseconds,extra={})=>({approvalId:'grant',taskId:'task',state:'pending',revision:3,
  action:'workspace.read_text',scopes:['workspace:read'],expiresAt:new Date(milliseconds).toISOString(),...extra});

function fixture() {
  let now=initialTime,nextTimer=0,insertions=0,removals=0;
  const timers=new Map(),article={cards:[],buttons:[],body:'task body',
    querySelectorAll(selector){assert.equal(selector,'.approval-card');return [...this.cards];},
    insertAdjacentHTML(position,markup){
      assert.equal(position,'beforeend');insertions++;
      this.cards.push({remove:()=>{removals++;article.cards=[];article.buttons=[];}});
      this.markup=markup;
      this.buttons=[...markup.matchAll(/data-approval-decision="([^"]+)" data-approval-id="([^"]+)"/g)]
        .map(([,decision,id])=>({dataset:{approvalDecision:decision,approvalId:id},disabled:false}));
    }};
  const tasksNode={querySelector(selector){assert.equal(selector,'[data-turn="task"]');return article;},
    querySelectorAll(selector){assert.equal(selector,'[data-approval-decision]');return article.buttons;},
    set innerHTML(_value){assert.fail('expiry must not rebuild task DOM');}};
  const context=vm.createContext({current:{tasks:[task],approvals:[grant(initialTime+100)]},wakeClosed:false,locateClosed:false,locateFeedback:new Map(),
    tasksNode,approvalDecisions:new Map(),approvalCards,nextApprovalExpiry,approvalsWithoutQuestionCards,CSS:{escape:value=>value},Date:{now:()=>now},
    setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{callback,delay});return id;},
    clearTimeout(id){timers.delete(id);}});
  vm.runInContext(`let approvalExpiryTimer;const syncApprovalButtons=${syncButtons};${functions.get('refreshApprovalCards')}\n${functions.get('scheduleApprovalExpiry')}\nconst unload=${unload};`,context);
  return {context,article,timers,
    refresh:()=>vm.runInContext('refreshApprovalCards();scheduleApprovalExpiry();',context),
    unload:()=>vm.runInContext('unload()',context),
    setNow(value){now=value;},
    fire(){assert.equal(timers.size,1);const [id,timer]=[...timers][0];timers.delete(id);timer.callback();},
    get insertions(){return insertions;},get removals(){return removals;}};
}

test('next panel expiry includes only valid pending approvals for waiting tasks',()=>{
  const approvals=[grant(initialTime+500),grant(initialTime+200,{approvalId:'soon'}),
    grant(initialTime+1,{taskId:'other'}),grant(initialTime+2,{state:'allowed'}),
    grant(initialTime),grant(initialTime-1),grant(initialTime+3,{expiresAt:'invalid'}),
    grant(initialTime+4,{expiresAt:7})];
  assert.equal(nextApprovalExpiry([task],approvals,initialTime),initialTime+200);
  assert.equal(nextApprovalExpiry([{...task,state:'running'}],approvals,initialTime),undefined);
  assert.equal(nextApprovalExpiry([task],approvals,initialTime+500),undefined);
});

test('actual renderer expiry callback replaces only approval cards and removes expired decisions',()=>{
  const f=fixture();f.refresh();const article=f.article,buttons=article.buttons;
  assert.equal(buttons.length,2);assert.equal([...f.timers.values()][0].delay,125);
  f.refresh();assert.equal(article.buttons,buttons);assert.equal(f.insertions,1);
  f.setNow(initialTime+126);f.fire();
  assert.equal(f.article,article);assert.equal(article.body,'task body');assert.equal(article.buttons.length,0);
  assert.match(article.markup,/授权已过期/);assert.equal(f.insertions,2);assert.equal(f.removals,1);assert.equal(f.timers.size,0);
});

test('merged stop truncation and exact conversation-question dedupe independently suppress legacy approval actions',()=>{
  const f=fixture(),approval=grant(initialTime+500);
  f.context.current={tasks:[{...task,outputTruncated:true}],approvals:[approval]};f.refresh();
  assert.equal(f.article.buttons.length,0,'stopped output must not regain legacy decisions');
  f.context.current={tasks:[task],approvals:[approval],conversationState:{activeId:'original-chat'},
    authorizationQuestions:[{conversationId:'original-chat',sourceApprovalId:approval.approvalId}]};f.refresh();
  assert.equal(f.article.buttons.length,0,'the same formal question must not produce a second allow button');
  f.context.current.authorizationQuestions=[{conversationId:'foreign-chat',sourceApprovalId:approval.approvalId}];f.refresh();
  assert.equal(f.article.buttons.length,2,'a different conversation cannot hide the original approval');
});

test('expiry callbacks use latest task and approval snapshots rather than the scheduled snapshot',()=>{
  const f=fixture();f.refresh();
  f.context.current={tasks:[{...task,state:'running'}],approvals:[grant(initialTime+100)]};
  f.setNow(initialTime+126);f.fire();assert.equal(f.article.cards.length,0);assert.equal(f.article.buttons.length,0);assert.equal(f.timers.size,0);
  f.context.current={tasks:[task],approvals:[grant(initialTime+500,{revision:4})]};
  f.refresh();assert.equal(f.article.buttons.length,2);assert.equal([...f.timers.values()][0].delay,399);
});

test('pending and submitted decision locks survive unrelated updates and approval card refresh',()=>{
  for(const phase of ['pending','submitted']){
    const f=fixture();f.context.approvalDecisions.set('grant',phase);f.refresh();
    assert.equal(f.article.buttons.every(button=>button.disabled),true);
    f.context.current={tasks:[task],approvals:[grant(initialTime+300,{revision:4})]};f.refresh();
    assert.equal(f.context.approvalDecisions.get('grant'),phase);assert.equal(f.article.buttons.every(button=>button.disabled),true);
    f.setNow(initialTime+326);f.fire();assert.equal(f.article.buttons.length,0);
    assert.equal(f.context.approvalDecisions.get('grant'),phase);
  }
});

test('actual unload clears expiry timer and ignores an already queued callback',()=>{
  const f=fixture();f.refresh();const callback=[...f.timers.values()][0].callback;
  f.context.removeDictation=()=>{};f.unload();assert.equal(f.timers.size,0);assert.equal(f.context.wakeClosed,true);
  f.setNow(initialTime+126);callback();assert.equal(f.insertions,1);assert.equal(f.removals,0);assert.equal(f.timers.size,0);
});

test('long browser delays are capped and elapsed or invalid deadlines schedule no timer',()=>{
  const f=fixture();f.context.current={tasks:[task],approvals:[grant(initialTime+2_147_483_648)]};f.refresh();
  assert.equal([...f.timers.values()][0].delay,2_147_483_647);
  f.context.current={tasks:[task],approvals:[grant(initialTime),grant(initialTime,{expiresAt:'invalid'})]};f.refresh();
  assert.equal(f.timers.size,0);assert.equal(f.article.buttons.length,0);
});
