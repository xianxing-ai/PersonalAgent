import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessWorkflowAvailability} from '../electron/business-workflow-availability.js';

test('business availability binds actual account revision and notification policy without granting tool access',()=>{
  let active=true,allowed=true,device=true,policy={revision:1},binding={accountRef:'Synthetic',calendarUrl:'https://synthetic.invalid/',revision:1};
  const read=createBusinessWorkflowAvailability({namespace:'Synthetic',getApplication:()=>active?{runtime:{}}:undefined,
    todoHost:{competitionToolAvailability:['todo.create','todo.update'].map(toolName=>({toolName,available:()=>allowed}))},
    notificationHost:{snapshot:()=>({available:active}),getInterruptionPolicy:()=>policy},
    readCalendarBinding:()=>binding,deviceAvailable:()=>device});
  const scope={taskId:'Synthetic',signal:new AbortController().signal};
  const todo=read('F06',scope),calendar=read('F07',scope),reschedule=read('F11',scope),notification=read('F12',scope);
  assert.equal(notification.ready,true);
  assert.equal(todo.ready,true);assert.equal(calendar.ready,true);assert.match(calendar.bindingId,/^[a-f0-9]{64}$/);
  assert.equal(reschedule.ready,true);assert.notEqual(reschedule.bindingId,calendar.bindingId);
  binding={...binding,revision:2};assert.notEqual(read('F07',scope).bindingId,calendar.bindingId);
  assert.notEqual(read('F11',scope).bindingId,reschedule.bindingId);
  policy={revision:2};assert.notEqual(read('F06',scope).bindingId,todo.bindingId);
  allowed=false;assert.equal(read('F06',scope).ready,false);assert.equal(read('F11',scope).ready,false);allowed=true;
  device=false;assert.equal(read('F06',scope).ready,false);
  assert.equal(read('F12',scope).ready,true);assert.notEqual(read('F12',scope).bindingId,notification.bindingId);device=true;
  binding=undefined;assert.equal(read('F07',scope).ready,false);assert.equal(read('F11',scope).ready,false);
  assert.equal(read('F08',scope).ready,false);assert.equal(read('F06',{...scope,signal:AbortSignal.abort()}).ready,false);
  active=false;assert.equal(read('F06',scope).ready,false);assert.equal(read('F12',scope).ready,false);
});

test('F08 availability pins the actual mailbox and public knowledge configuration without granting writes or private exports',()=>{
  let mail={configurationRef:'original-mail-binding'},knowledge={available:true,cloudExportAllowed:true,dataLevel:'public',
    namespace:'synthetic',sourceId:'original-source',configRevision:1,publicQueries:['explicit-public-query']};
  const read=createBusinessWorkflowAvailability({namespace:'synthetic',getApplication:()=>({runtime:{}}),
    readMailBinding:()=>mail,readKnowledgeBinding:()=>knowledge});
  const scope={taskId:'original-task',signal:new AbortController().signal},original=read('F08',scope);
  assert.equal(original.ready,true);assert.deepEqual(Object.keys(original).sort(),['bindingId','ready']);
  for(const patch of [{configRevision:2},{sourceId:'replacement'},{namespace:'replacement'},{publicQueries:['another-query']}]){
    const saved=knowledge;knowledge={...saved,...patch};assert.notEqual(read('F08',scope).bindingId,original.bindingId);knowledge=saved;
  }
  mail={configurationRef:'replacement-mail'};assert.notEqual(read('F08',scope).bindingId,original.bindingId);
  mail=undefined;assert.deepEqual(read('F08',scope),{ready:false});mail={configurationRef:'original-mail-binding'};
  for(const patch of [{available:false},{cloudExportAllowed:false},{dataLevel:'private'},{configRevision:0},{publicQueries:undefined}]){
    const saved=knowledge;knowledge={...saved,...patch};assert.deepEqual(read('F08',scope),{ready:false});knowledge=saved;
  }
  assert.deepEqual(read('F08',{...scope,signal:AbortSignal.abort()}),{ready:false});
});
