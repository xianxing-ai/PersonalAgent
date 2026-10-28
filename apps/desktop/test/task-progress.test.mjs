import test from 'node:test';
import assert from 'node:assert/strict';
import {taskProgress,mountTaskProgress} from '../src/features/conversation/task-progress.js';

test('progress selects an unfinished task ahead of a later finished turn without mutating state',()=>{
 const tasks=[{taskId:'active',state:'waiting_approval'},{taskId:'old',state:'succeeded'}],before=JSON.stringify(tasks);
 assert.equal(taskProgress(tasks).label,'等待授权');assert.match(taskProgress(tasks).detail,/需要你的确认/);
 assert.equal(JSON.stringify(tasks),before);assert.equal(taskProgress([]),null);
});
test('waiting and cancellation hints never claim completion or undo',()=>{
 assert.match(taskProgress([{state:'waiting_reconciliation'}]).detail,/暂不能确认是否已执行/);
 assert.equal(taskProgress([{state:'waiting_reconciliation',error:{message:'具体安全原因'}}]).detail,'具体安全原因');
 assert.equal(taskProgress([{state:'waiting_reconciliation'}]).label,'执行异常');
 assert.match(taskProgress([{state:'cancelling'}]).detail,/等待执行结束/);
 assert.match(taskProgress([{state:'cancelled'}]).detail,/不会因此自动撤销/);
 assert.equal(taskProgress([{state:'unknown-new-state'}]).label,'状态待确认');
 assert.equal(taskProgress([{state:'succeeded'}]).label,'已完成');
});

test('pending child authorization is visible only in its owning conversation while still active',()=>{
 const tasks=[{taskId:'parent',state:'running'}],now=Date.now();
 const question={taskId:'child',conversationId:'main',state:'pending',expiresAt:new Date(now+1000).toISOString()};
 const scope={questions:[question],conversationId:'main',now};
 assert.equal(taskProgress(tasks,undefined,scope).label,'等待操作授权');
 assert.equal(taskProgress(tasks,undefined,{...scope,conversationId:'other'}).label,'执行中');
 assert.equal(taskProgress(tasks,undefined,{...scope,now:now+1000}).label,'执行中');
 assert.equal(taskProgress(tasks,undefined,{...scope,conversationId:undefined}).label,'执行中');
 assert.equal(taskProgress([{state:'cancelled'}],undefined,scope).label,'已取消');
 assert.equal(tasks[0].state,'running');
});
test('conversation-scoped computer wait explains the local gate instead of cloud coordination',()=>{
 const tasks=[{taskId:'parent',state:'running',steps:[{state:'running',label:'cloud coordination'}]}];
 const computer={waitingConfirmation:true,activeTaskId:'child'};
 assert.equal(taskProgress(tasks,computer).label,'等待本机确认');
 assert.match(taskProgress(tasks,computer).detail,/电脑操作尚未开始.*F9/);
 assert.equal(taskProgress(tasks,{waitingConfirmation:false}).detail,'当前步骤：cloud coordination');
 assert.equal(taskProgress(tasks,{waitingConfirmation:true}).detail,'当前步骤：cloud coordination');
 assert.equal(taskProgress([{taskId:'parent',state:'cancelled'}],computer).label,'已取消');
 assert.equal(tasks[0].state,'running');
});
test('current step text is safe text, and identical snapshots do not reannounce or replace content',t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');
 t.after(()=>original?Object.defineProperty(globalThis,'document',original):delete globalThis.document);
 let writes=0;
 function node(){return {dataset:{},attrs:{},children:[],hidden:false,setAttribute(k,v){this.attrs[k]=v;},append(...children){this.children.push(...children);},set textContent(value){this.value=value;writes++;},get textContent(){return this.value;}};}
 globalThis.document={createElement:node};const container={insertBefore(value){this.status=value;}};
 const render=mountTaskProgress(container),tasks=[{state:'running',steps:[{state:'running',label:'<img src=x onerror=alert(1)>'}]}];
 render(tasks);assert.equal(container.status.children[1].textContent,'当前步骤：<img src=x onerror=alert(1)>');
 const count=writes;render(structuredClone(tasks));assert.equal(writes,count);assert.equal(container.status.attrs.role,'status');
 render([]);assert.equal(container.status.hidden,true);assert.equal(container.status.children[1].textContent,'');
});
test('presence rendering never confirms automatically and a click binds the current pending task',async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');
 t.after(()=>original?Object.defineProperty(globalThis,'document',original):delete globalThis.document);
 function node(){return {dataset:{},children:[],setAttribute(){},append(...items){this.children.push(...items);}};}
 globalThis.document={createElement:node};const container={insertBefore(value){this.status=value;}},calls=[];
 let finish;const render=mountTaskProgress(container,null,taskId=>{calls.push(taskId);return new Promise(resolve=>{finish=resolve;});});
 const tasks=[{taskId:'root',state:'running'}];
 render(tasks,{waitingConfirmation:true,activeTaskId:'original-child'});assert.deepEqual(calls,[]);
 const button=container.status.children[2];assert.equal(button.hidden,false);
 const pending=button.onclick();await button.onclick();assert.deepEqual(calls,['original-child']);
 render(tasks,{waitingConfirmation:false});assert.equal(button.hidden,true);
 finish();await pending;await button.onclick();assert.deepEqual(calls,['original-child']);
});
