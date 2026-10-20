import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {mountSessionControls} from '../src/features/conversation/session-controls.js';
import {isStopRequest} from '../src/features/conversation/stop-request.js';
import {isTerminal} from '../src/features/conversation/state.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

const source=await readFile(new URL('../src/app/renderer.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('renderer.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const dependencies=new Map();let handler,hostProjection,renderFeedback;
function visit(node){
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='form.onsubmit')handler=node.right.getText(ast);
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='syncHostFeedback')hostProjection=node.getText(ast);
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='render'&&ts.isArrowFunction(node.right)){
    const body=ts.isBlock(node.right.body)?node.right.body.statements:[node.right.body];
    renderFeedback=body.filter(statement=>/data\.connectionError\|\|voiceError|preserveFeedback===false&&hostFeedback/.test(statement.getText(ast))).map(statement=>statement.getText(ast)).join('\n');
  }
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&!dependencies.has(node.name.text)&&['errorFeedbackRevision','setFeedback','hostFeedback','hostFeedbackRevision','syncHostFeedback','report'].includes(node.name.text))dependencies.set(node.name.text,node.getText(ast));
  ts.forEachChild(node,visit);
}
visit(ast);assert.ok(handler,'actual panel submit handler');assert.equal(hostProjection,'syncHostFeedback(data.connectionError||voiceError,{preserveFeedback:preserveFeedback!==undefined})','actual passive snapshot render projects Host feedback');
function fixture({nativeFlush=async()=>{}}={}){
  const documentBefore=globalThis.document,windowBefore=globalThis.window,optionBefore=globalThis.Option;
  const node=()=>({value:'',children:[],setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(){},addEventListener(){}});
  const fields=new Map();globalThis.document={createElement(){const value=node();value.querySelector=selector=>{if(!fields.has(selector))fields.set(selector,node());return fields.get(selector);};return value;}};globalThis.window={addEventListener(){}};globalThis.Option=function(text,value){this.text=text;this.value=value;};
  const listeners=new Map(),error={textContent:''},input={value:'synthetic draft',addEventListener(name,handler){(listeners.get(name)??listeners.set(name,[]).get(name)).push(handler);},dispatchEvent(event){for(const handler of listeners.get(event.type)??[])handler(event);}},sendBtn={disabled:false},calls=[];
  const current={conversationState:{activeId:'desktop-panel',draft:'synthetic draft',sessions:[{id:'desktop-panel',title:'original',archived:false}]}};
  const sessionControls=mountSessionControls(node(),input,async(name)=>{assert.equal(name,'conversation.draft');return {saved:true};},()=>{});sessionControls.update(current);
  globalThis.document=documentBefore;globalThis.window=windowBefore;globalThis.Option=optionBefore;
  const context=vm.createContext({root:{querySelector:()=>error},input,sendBtn,sessionControls,nativeReasoning:{flush:nativeFlush},isStopRequest,activeTasks:()=>[],current,Event,submitGeneration:0,pending:false,draftRevision:0,thread:{scrollTop:0,scrollHeight:100},requestAnimationFrame:callback=>callback(),setSendMode:()=>{},invoke:()=>new Promise((resolve,reject)=>calls.push({resolve,reject}))});
  for(const declaration of dependencies.values())vm.runInContext(`let ${declaration};`,context);
  return {error,input,calls,context,submit:vm.runInContext(`(${handler})`,context),host:(value,preserveFeedback)=>vm.runInContext(`{const data={connectionError:${JSON.stringify(value)}},voiceError='',preserveFeedback=${preserveFeedback};${renderFeedback}}`,context),report:value=>vm.runInContext(`report(${JSON.stringify(value)})`,context)};
}
const event={preventDefault(){}};
test('actual submit waits for native preference acknowledgement and a failed flush never submits',async()=>{
  let release;const f=fixture({nativeFlush:()=>new Promise(resolve=>release=resolve)}),run=f.submit(event);await tick();assert.equal(f.calls.length,0);assert.equal(f.context.pending,true);
  release();await tick();assert.equal(f.calls.length,1);f.calls[0].resolve();await run;
  const failed=fixture({nativeFlush:async()=>{throw Error('native settings unsaved');}});await failed.submit(event);assert.equal(failed.calls.length,0);assert.equal(failed.input.value,'synthetic draft');assert.equal(failed.error.textContent,'native settings unsaved');
});
test('failed submit retains draft and operation feedback through ordinary snapshots',async()=>{
  const f=fixture(),run=f.submit(event);await tick();f.calls[0].reject(Error('submit failed'));await run;
  f.host('');f.host('');assert.equal(f.error.textContent,'submit failed');assert.equal(f.input.value,'synthetic draft');assert.equal(f.context.pending,false);
});
test('older submit success cannot clear newer workspace or Host feedback',async()=>{
  for(const host of [false,true]){const f=fixture(),run=f.submit(event);await tick();if(host)f.host('Host failed');else f.report('workspace failed');f.calls[0].resolve();await run;assert.equal(f.error.textContent,host?'Host failed':'workspace failed');}
});
test('current submit success clears old operation error while retaining current Host error',async()=>{
  for(const host of [false,true]){const f=fixture();if(host)f.host('Host failed');else f.report('old operation failed');const run=f.submit(event);await tick();f.calls[0].resolve();await run;assert.equal(f.error.textContent,host?'Host failed':'');if(host){f.host('');assert.equal(f.error.textContent,'');}}
});
test('Host recovery clears its own feedback but never a newer operation with identical text',()=>{
  const f=fixture();f.host('same error');f.report('same error');f.host('');assert.equal(f.error.textContent,'same error');f.host('new Host error');f.host('');assert.equal(f.error.textContent,'');
});
test('feedback-preserving refresh retains newer operation feedback and updates the Host readback',async()=>{
  const f=fixture();f.host('old Host error');f.report('new operation error');f.host('',true);assert.equal(f.error.textContent,'new operation error');const run=f.submit(event);await tick();f.calls[0].resolve();await run;assert.equal(f.error.textContent,'');
});
test('current explicit Wake readback clears old operation feedback and Host recovery keeps ownership',()=>{
  const f=fixture();f.report('old operation');f.host('',false);assert.equal(f.error.textContent,'');f.host('current Host error',false);assert.equal(f.error.textContent,'current Host error');f.host('');assert.equal(f.error.textContent,'');
});
test('a changed draft remains intact and busy until the receipt settles',async()=>{
  const f=fixture(),run=f.submit(event);await tick();assert.equal(f.context.pending,true);f.input.value='new draft';f.input.dispatchEvent(new Event('input'));f.context.draftRevision++;f.host('');f.calls[0].resolve();await run;assert.equal(f.input.value,'new draft');assert.equal(f.context.pending,false);
});

// Exercise the actual renderer handlers: task cancellation and host playback are separate IPCs.
function stopFixture({tasks=[{taskId:'task-1',state:'running'}],failures={}}={}){
  const declarations=new Map();let stopHandler;
  const names=['pendingCancelIds','truncatedTaskIds','activeTasks','setSendMode','syncCancelButtons','stopActiveTasks'];
  function capture(node){
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&names.includes(node.name.text))declarations.set(node.name.text,node.getText(ast));
    if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='stopButton.onclick')stopHandler=node.right.getText(ast);
    ts.forEachChild(node,capture);
  }
  capture(ast);assert.equal(declarations.size,names.length);assert.ok(stopHandler);
  const calls=[],errors=[],feedback=[],input={value:'',dispatchEvent(){}},sendBtn={dataset:{},setAttribute(name,value){this[name]=value;}};
  const context=vm.createContext({input,sendBtn,current:{tasks,live:{active:true}},pending:false,Event,isStopRequest,isTerminal,
    window:{speechSynthesis:{cancel:()=>calls.push('browser-playback-stop')}},tasksNode:{querySelectorAll:()=>[]},
    report:error=>errors.push(error?.message??String(error)),setFeedback:value=>feedback.push(value),
    invoke:async(name,payload)=>{calls.push([name,payload]);if(failures[name])throw Error(failures[name]);return name==='voice.stop'?{stopped:true}:{cancelAccepted:true};}});
  for(const declaration of declarations.values())vm.runInContext(`const ${declaration};`,context);
  return {calls,errors,feedback,input,sendBtn,context,
    setText(value){input.value=value;vm.runInContext('setSendMode(Boolean(input.value.trim()))',context);},
    stop:vm.runInContext(`(${stopHandler})`,context),submit:vm.runInContext(`(${handler})`,context)};
}
test('panel stop interrupts host playback and cancels active tasks together',async()=>{
  const f=stopFixture();f.setText('保留普通草稿');assert.equal(f.sendBtn.dataset.mode,'stop');
  const stopping=f.stop();assert.equal(f.sendBtn.disabled,true);assert.equal(f.sendBtn['aria-busy'],'true');await stopping;
  assert.deepEqual(f.calls,['browser-playback-stop',['voice.stop',undefined],['task.cancel','task-1']]);
  assert.deepEqual(f.errors,[]);assert.equal(f.feedback.length,1);
  assert.equal(vm.runInContext('pendingCancelIds.size',f.context),0);
  assert.equal(f.input.value,'保留普通草稿');assert.equal(f.sendBtn.dataset.mode,'send');assert.equal(f.sendBtn.disabled,false);
});
for(const channel of ['voice.stop','task.cancel'])test(`panel stop still attempts both channels when ${channel} fails`,async()=>{
  const f=stopFixture({failures:{[channel]:'failed '+channel}});await f.stop();
  assert.equal(f.calls.some(call=>call[0]==='voice.stop'),true);assert.equal(f.calls.some(call=>call[0]==='task.cancel'),true);
  assert.deepEqual(f.errors,['failed '+channel]);assert.deepEqual(f.feedback,[]);
  assert.equal(vm.runInContext('pendingCancelIds.size',f.context),0);
  if(channel==='task.cancel'){assert.equal(f.sendBtn.dataset.mode,'stop');assert.equal(f.sendBtn.disabled,false);}
});
test('panel natural-language stop remains sendable during work and never submits a new task',async()=>{
  const f=stopFixture();f.setText('停止');assert.equal(f.sendBtn.disabled,false);await f.submit(event);
  assert.equal(f.calls.some(call=>call[0]==='task.cancel'),true);assert.equal(f.calls.some(call=>call[0]==='voice.stop'),true);
  assert.equal(f.calls.some(call=>call[0]==='task.submit'),false);assert.equal(f.context.pending,false);
  assert.equal(vm.runInContext('pendingCancelIds.size',f.context),0);
  const ordinary=stopFixture();ordinary.setText('另一个新任务');assert.equal(ordinary.sendBtn.dataset.mode,'stop');await ordinary.submit(event);
  assert.equal(ordinary.calls.length,0,'Enter cannot submit an ordinary new task while running');
});
test('panel stop without an active task only interrupts playback',async()=>{
  const f=stopFixture({tasks:[]});await f.stop();
  assert.deepEqual(f.calls,['browser-playback-stop',['voice.stop',undefined]]);assert.deepEqual(f.errors,[]);
});

test('task-row actions retain the like limit and truncate stopped output before the receipt',async()=>{
  let rowHandler,capDeclaration;
  function capture(node){
    if(ts.isBinaryExpression(node)&&node.left.getText(ast)==="root.querySelector('#tasks').onclick")rowHandler=node.right.getText(ast);
    if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='capCollection')capDeclaration=node.getText(ast);
    ts.forEachChild(node,capture);
  }
  capture(ast);assert.ok(rowHandler);assert.ok(capDeclaration);
  const likedTasks=new Set(Array.from({length:200},(_,index)=>`liked-${index}`));
  const pendingCancelIds=new Set(),truncatedTaskIds=new Set(),calls=[],errors=[],modes=[];
  let finish;
  const context=vm.createContext({likedTasks,pendingCancelIds,truncatedTaskIds,input:{value:'unsent draft'},
    invoke:(name,id)=>{calls.push([name,id]);return new Promise(resolve=>{finish=resolve;});},
    setSendMode:hasDraft=>modes.push(hasDraft),syncCancelButtons(){},report:error=>errors.push(error)});
  vm.runInContext(`const ${capDeclaration};`,context);
  const click=vm.runInContext(`(${rowHandler})`,context);
  const button=dataset=>({dataset,disabled:false,classList:{toggle(){}},setAttribute(){}});
  const like=button({uiAction:'like',id:'new-liked'});
  await click({target:{closest:()=>like}});
  assert.equal(likedTasks.size,200);assert.equal(likedTasks.has('liked-0'),false);assert.equal(likedTasks.has('new-liked'),true);
  const stop=button({action:'task.cancel',id:'running-task'});
  const pending=click({target:{closest:()=>stop}});
  assert.equal(truncatedTaskIds.has('running-task'),true);assert.equal(pendingCancelIds.has('running-task'),true);
  assert.deepEqual(modes,[true]);assert.equal(stop.disabled,true);assert.deepEqual(calls,[['task.cancel','running-task']]);
  assert.equal(context.input.value,'unsent draft');
  finish({cancelAccepted:true});await pending;
  assert.equal(pendingCancelIds.size,0);assert.equal(truncatedTaskIds.has('running-task'),true);assert.deepEqual(errors,[]);
});
