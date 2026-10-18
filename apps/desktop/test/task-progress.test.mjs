import test from 'node:test';
import assert from 'node:assert/strict';
import {taskProgress,mountTaskProgress} from '../src/features/conversation/task-progress.js';

test('progress selects an unfinished task ahead of a later finished turn without mutating state',()=>{
 const tasks=[{taskId:'active',state:'waiting_approval'},{taskId:'old',state:'succeeded'}],before=JSON.stringify(tasks);
 assert.equal(taskProgress(tasks).label,'等待授权');assert.match(taskProgress(tasks).detail,/需要你的确认/);
 assert.equal(JSON.stringify(tasks),before);assert.equal(taskProgress([]),null);
});
test('waiting and cancellation hints never claim completion or undo',()=>{
 assert.match(taskProgress([{state:'waiting_reconciliation'}]).detail,/尚未核实/);
 assert.match(taskProgress([{state:'cancelling'}]).detail,/等待执行结束/);
 assert.match(taskProgress([{state:'cancelled'}]).detail,/不会因此自动撤销/);
 assert.equal(taskProgress([{state:'unknown-new-state'}]).label,'状态待确认');
 assert.equal(taskProgress([{state:'succeeded'}]).label,'已完成');
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
