import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWorkspaceApprovals} from '../src/features/workspace/workspace-approvals.js';

function fixture(t){
  let now=1_700_000_000_000,unload,html='',buttons=[],revision=0;
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  globalThis.window={addEventListener(_name,listener){unload=listener;}};
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
  t.mock.method(Date,'now',()=>now);
  const timers=new Map();let timerId=0;
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;});
  t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  const slot={dataset:{workspaceApprovals:'task'},querySelectorAll(){return buttons;}};
  Object.defineProperty(slot,'innerHTML',{get:()=>html,set(value){html=value;buttons=[...value.matchAll(/data-approval-decision="([^"]+)" data-approval-id="([^"]+)"/g)].map(([,decision,id])=>({dataset:{approvalDecision:decision,approvalId:id},disabled:false}));}});
  let handler;const conversation={querySelectorAll:()=>[slot],addEventListener(_name,listener){handler=listener;},removeEventListener(){handler=undefined;}};
  const calls=[],errors=[];
  const control=mountWorkspaceApprovals(conversation,(name,payload)=>new Promise((resolve,reject)=>calls.push({name,payload,resolve,reject})),error=>{revision++;errors.push(error.message);},()=>revision);
  const data=(owner='session')=>({conversationState:{activeId:owner},tasks:[{taskId:'task',state:'waiting_approval'}],approvals:[{approvalId:'grant',taskId:'task',state:'pending',revision:3,action:'fixture-read',scopes:['fixture:read'],expiresAt:new Date(now+1000).toISOString()}]});
  control.update(data());
  return {control,data,calls,errors,timers,get html(){return html;},get buttons(){return buttons;},click:button=>handler({target:{closest:()=>button}}),advance(ms){now+=ms;},unload:()=>unload(),newFeedback(){revision++;}};
}
test('workspace approval expires without a new snapshot and a stale button cannot submit',async t=>{
  const f=fixture(t),old=f.buttons[0],timer=[...f.timers.values()][0];assert.equal(timer.delay,1001);f.advance(1001);timer.callback();assert.match(f.html,/已过期/);assert.equal(f.buttons.length,0);await f.click(old);assert.equal(f.calls.length,0);assert.match(f.errors[0],/授权已变化/);f.unload();assert.equal(f.timers.size,0);
});
test('workspace approval sends the original revision once and keeps pending controls disabled until readback',async t=>{
  const f=fixture(t),first=f.click(f.buttons[0]);await f.click(f.buttons[1]);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].payload,{approvalId:'grant',decision:'allow_once',expectedRevision:3,taskId:'task'});f.calls[0].resolve({});await first;assert.ok(f.buttons.every(button=>button.disabled));f.control.update({...f.data(),approvals:[]});assert.equal(f.buttons.length,0);f.unload();
});
test('late workspace approval failure does not replace newer feedback or another conversation',async t=>{
  const f=fixture(t),pending=f.click(f.buttons[0]);f.newFeedback();f.calls[0].reject(Error('old rejection'));await pending;assert.deepEqual(f.errors,[]);assert.ok(f.buttons.every(button=>!button.disabled));const retry=f.click(f.buttons[0]);f.control.update({...f.data('other'),tasks:[],approvals:[]});f.calls[1].reject(Error('old session'));await retry;assert.deepEqual(f.errors,[]);f.unload();
});

test('workspace does not duplicate an approval represented by the current unified question',t=>{
  const f=fixture(t);f.control.update({...f.data(),authorizationQuestions:[{questionId:'question',sourceApprovalId:'grant',conversationId:'session'}]});
  assert.equal(f.buttons.length,0);assert.equal(f.timers.size,0);
  f.control.update({...f.data(),authorizationQuestions:[{questionId:'foreign',sourceApprovalId:'grant',conversationId:'another'}]});
  assert.equal(f.buttons.length,2,'a question belonging to another conversation cannot hide this approval');f.unload();
});
