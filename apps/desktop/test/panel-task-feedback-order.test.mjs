import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {mountSessionControls} from '../src/features/conversation/session-controls.js';
import {isStopRequest} from '../src/features/conversation/stop-request.js';
import {isTerminal} from '../src/features/conversation/state.js';
import {createMessageQueue} from '../src/features/conversation/message-queue.js';
import {errorDisplayText} from '../src/shared/error-display.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

const source=await readFile(new URL('../src/app/renderer.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('renderer.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const dependencies=new Map();let handler,hostProjection,renderFeedback,submitDeclaration;
function visit(node){
  if(ts.isFunctionDeclaration(node)&&node.name?.text==='submitMessage')submitDeclaration=node.getText(ast);
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='form.onsubmit')handler=node.right.getText(ast);
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='syncHostFeedback')hostProjection=node.getText(ast);
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='render'&&ts.isArrowFunction(node.right)){
    const body=ts.isBlock(node.right.body)?node.right.body.statements:[node.right.body];
    const feedback=body.filter(statement=>/data\.connectionError\|\|voiceError|preserveFeedback===false&&hostFeedback/.test(statement.getText(ast)));
    if(feedback.length){assert.equal(renderFeedback,undefined,'one actual panel Host feedback adapter');renderFeedback=feedback.map(statement=>statement.getText(ast)).join('\n');}
  }
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&!dependencies.has(node.name.text)&&['errorFeedbackRevision','setFeedback','hostFeedback','hostFeedbackRevision','syncHostFeedback','report'].includes(node.name.text))dependencies.set(node.name.text,node.getText(ast));
  ts.forEachChild(node,visit);
}
visit(ast);assert.ok(handler,'actual panel submit handler');assert.equal(hostProjection,'syncHostFeedback(data.connectionError||voiceError,{preserveFeedback:preserveFeedback!==undefined})','actual passive snapshot render projects Host feedback');
assert.ok(renderFeedback,'actual panel Host feedback statements are extracted before the question wrapper');
function fixture({nativeFlush=async()=>{}}={}){
  const documentBefore=globalThis.document,windowBefore=globalThis.window,optionBefore=globalThis.Option;
  const node=()=>({value:'',children:[],setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(){},addEventListener(){}});
  const fields=new Map();globalThis.document={createElement(){const value=node();value.querySelector=selector=>{if(!fields.has(selector))fields.set(selector,node());return fields.get(selector);};return value;}};globalThis.window={addEventListener(){}};globalThis.Option=function(text,value){this.text=text;this.value=value;};
  const listeners=new Map(),error={textContent:''},input={value:'synthetic draft',addEventListener(name,handler){(listeners.get(name)??listeners.set(name,[]).get(name)).push(handler);},dispatchEvent(event){for(const handler of listeners.get(event.type)??[])handler(event);}},sendBtn={disabled:false},calls=[];
  const current={conversationState:{activeId:'desktop-panel',draft:'synthetic draft',sessions:[{id:'desktop-panel',title:'original',archived:false}]}};
  const sessionControls=mountSessionControls(node(),input,async(name)=>{assert.equal(name,'conversation.draft');return {saved:true};},()=>{});sessionControls.update(current);
  globalThis.document=documentBefore;globalThis.window=windowBefore;globalThis.Option=optionBefore;
  const context=vm.createContext({errorDisplayText,root:{querySelector:()=>error},input,sendBtn,sessionControls,nativeReasoning:{flush:nativeFlush},isStopRequest,activeTasks:()=>[],current,Event,submitGeneration:0,pending:false,draftRevision:0,wakeClosed:false,messageQueue:createMessageQueue(),sendingQueueIds:new Set(),renderQueue(){},deliveryMode:{value:'steer'},thread:{scrollTop:0,scrollHeight:100},requestAnimationFrame:callback=>callback(),setSendMode:()=>{},invoke:()=>new Promise((resolve,reject)=>calls.push({resolve,reject}))});
  for(const declaration of dependencies.values())vm.runInContext(`let ${declaration};`,context);
  vm.runInContext(submitDeclaration,context);
  return {error,input,calls,context,submit:vm.runInContext(`(${handler})`,context),host:(value,preserveFeedback)=>vm.runInContext(`{const data={connectionError:${JSON.stringify(value)}},voiceError='',preserveFeedback=${preserveFeedback};${renderFeedback}}`,context),report:value=>vm.runInContext(`report(${JSON.stringify(value)})`,context)};
}
const event={preventDefault(){}};
test('actual submit waits for native preference acknowledgement and a failed flush never submits',async()=>{
  let release;const f=fixture({nativeFlush:()=>new Promise(resolve=>release=resolve)}),run=f.submit(event);await tick();assert.equal(f.calls.length,0);assert.equal(f.context.pending,true);
  release();await tick();assert.equal(f.calls.length,1);f.calls[0].resolve();await run;
  const failed=fixture({nativeFlush:async()=>{throw Error('native settings unsaved');}});await failed.submit(event);assert.equal(failed.calls.length,0);assert.equal(failed.input.value,'synthetic draft');assert.equal(failed.error.textContent,errorDisplayText(Error('native settings unsaved')));
});
test('failed submit retains draft and operation feedback through ordinary snapshots',async()=>{
  const f=fixture(),run=f.submit(event);await tick();f.calls[0].reject(Error('submit failed'));await run;
  f.host('');f.host('');assert.equal(f.error.textContent,errorDisplayText(Error('submit failed')));assert.equal(f.input.value,'synthetic draft');assert.equal(f.context.pending,false);
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

// Exercise production stop handlers with deliberately stalled cleanup channels.
function stopFixture({tasks=[{taskId:'task-1',state:'running'}],failures={},stall=false}={}){
  const names=['pendingCancelIds','truncatedTaskIds','activeTasks','setSendMode','syncCancelButtons','stopActiveTasks'];
  const declarations=new Map();let stopHandler;
  function capture(node){
    if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(ast)))declarations.set(node.name.getText(ast),node.getText(ast));
    if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='stopButton.onclick')stopHandler=node.right.getText(ast);
    ts.forEachChild(node,capture);
  }
  capture(ast);
  const calls=[],errors=[],feedback=[],input={value:'',dispatchEvent(){}},sendBtn={dataset:{},setAttribute(name,value){this[name]=value;}};
  const context=vm.createContext({input,sendBtn,stopButton:{setAttribute(){}},stopPlaybackIcon:'playback',deliveryMode:{value:'steer'},deliveryHint:{},
    current:{tasks,live:{active:true},conversationState:{activeId:'desktop-panel'}},pending:false,submitGeneration:0,
    truncatedOutput:new Map(),structuredClone,Event,isStopRequest,isTerminal,wakeClosed:false,errorFeedbackRevision:0,
    messageQueue:createMessageQueue(),lastTaskSignature:'',render(){},setTimeout:()=>1,clearTimeout(){},
    window:{speechSynthesis:{cancel:()=>calls.push('browser-playback-stop')}},tasksNode:{querySelectorAll:()=>[]},
    report:error=>errors.push(error?.message??String(error)),setFeedback:value=>feedback.push(value),
    invoke:(name,payload)=>{calls.push([name,payload]);if(stall)return new Promise(()=>{});
      if(failures[name])return Promise.reject(Error(failures[name]));
      return Promise.resolve(name==='voice.stop'?{stopped:true}:{interrupted:true});}});
  for(const declaration of declarations.values())vm.runInContext('const '+declaration+';',context);
  return {calls,errors,feedback,input,sendBtn,context,
    setText(value){input.value=value;vm.runInContext('setSendMode(Boolean(input.value.trim()))',context);},
    stop:vm.runInContext('('+stopHandler+')',context),submit:vm.runInContext('('+handler+')',context)};
}
test('stop releases the composer immediately even when both host channels never settle',async()=>{
  const f=stopFixture({stall:true});f.setText('保留普通草稿');
  assert.equal(f.sendBtn.dataset.mode,'send','text remains sendable during work');
  f.context.pending=true;const before=f.context.submitGeneration;
  await f.stop();
  assert.equal(f.context.pending,false);assert.ok(f.context.submitGeneration>before);
  assert.equal(f.sendBtn.disabled,false);assert.equal(f.sendBtn['aria-busy'],'false');
  assert.equal(f.input.value,'保留普通草稿');assert.equal(f.sendBtn.dataset.mode,'send');
  assert.equal(vm.runInContext('pendingCancelIds.size',f.context),0);
  assert.equal(vm.runInContext('truncatedTaskIds.has("task-1")',f.context),true);
  assert.equal(f.context.messageQueue.paused,true);
  assert.deepEqual(structuredClone(f.calls),['browser-playback-stop',['conversation.interrupt',{conversationId:'desktop-panel'}],['voice.stop',undefined]]);
});
for(const channel of ['voice.stop','conversation.interrupt'])test('stop attempts both channels when '+channel+' fails',async()=>{
  const f=stopFixture({failures:{[channel]:'failed '+channel}});await f.stop();await tick();
  assert.equal(f.calls.some(call=>call[0]==='voice.stop'),true);assert.equal(f.calls.some(call=>call[0]==='conversation.interrupt'),true);
  assert.deepEqual(f.errors,['failed '+channel]);assert.equal(f.sendBtn.disabled,false);
  assert.equal(vm.runInContext('truncatedTaskIds.has("task-1")',f.context),true,'failed cleanup never resumes old output');
});
test('natural-language stop cancels without submitting and can stop a pending acceptance',async()=>{
  for(const tasks of [[{taskId:'task-1',state:'running'}],[]]){
    const f=stopFixture({tasks,stall:true});f.context.pending=true;f.setText('停止');await f.submit(event);
    assert.equal(f.calls.some(call=>call[0]==='conversation.interrupt'),true);
    assert.equal(f.calls.some(call=>call[0]==='task.submit'),false);assert.equal(f.context.pending,false);assert.equal(f.input.value,'');
  }
});
test('stop with no task or pending acceptance only interrupts playback',async()=>{
  const f=stopFixture({tasks:[]});await f.stop();assert.deepEqual(f.calls,['browser-playback-stop',['voice.stop',undefined]]);
});
test('task-row cancellation targets only its task and likes stay bounded',async()=>{
  let rowHandler,capDeclaration;
  function capture(node){
    if(ts.isBinaryExpression(node)&&node.left.getText(ast)==="root.querySelector('#tasks').onclick")rowHandler=node.right.getText(ast);
    if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='capCollection')capDeclaration=node.getText(ast);
    ts.forEachChild(node,capture);
  }
  capture(ast);
  const likedTasks=new Set(Array.from({length:200},(_,i)=>'liked-'+i)),calls=[],visibleLikes=[];
  const context=vm.createContext({likedTasks,input:{value:'unsent draft'},tasksNode:{querySelectorAll:()=>visibleLikes},
    current:{tasks:[{taskId:'running-task',state:'running'}]},window:{speechSynthesis:{cancel(){}}},
    stopTask:task=>calls.push(task)});
  vm.runInContext('const '+capDeclaration+';',context);const click=vm.runInContext('('+rowHandler+')',context);
  const button=dataset=>({dataset,disabled:false,classList:{toggle(name,value){this[name]=value;}},setAttribute(name,value){this[name]=value;}});
  const like=button({uiAction:'like',id:'new-liked'}),oldest=button({uiAction:'like',id:'liked-0'});visibleLikes.push(oldest,like);
  await click({target:{closest:()=>like}});
  assert.equal(likedTasks.size,200);assert.equal(likedTasks.has('liked-0'),false);assert.equal(oldest['aria-pressed'],'false');
  await click({target:{closest:()=>button({action:'task.cancel',id:'running-task'})}});
  assert.equal(calls.length,1);assert.equal(calls[0].taskId,'running-task');assert.equal(context.input.value,'unsent draft');
});

test('21 locate requests clear evicted progress and stale replies cannot overwrite a retry',async()=>{
  const declarations=new Map(),names=['capCollection','currentLocateFailure','projectLocateFeedback','locateFailure'];
  function capture(node){
    if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(ast)))declarations.set(node.name.getText(ast),node.getText(ast));
    ts.forEachChild(node,capture);
  }
  capture(ast);assert.equal(declarations.size,names.length);
  const tasks=Array.from({length:21},(_,i)=>({taskId:`failed-${i}`,state:'failed',error:{message:`error-${i}`}}));
  const nodes=tasks.map(task=>{
    const result={hidden:true,textContent:''};
    return {dataset:{locateId:task.taskId,locateText:task.error.message},result,
      closest:()=>({querySelector:()=>result})};
  });
  const replies=[],locateFeedback=new Map();
  const context=vm.createContext({current:{tasks},locateFeedback,locateClosed:false,isTerminal,
    resultText:()=>'',tasksNode:{querySelectorAll:()=>nodes},escape:value=>value,
    invoke:()=>new Promise(resolve=>replies.push(resolve))});
  for(const name of names)vm.runInContext(`const ${declarations.get(name)};`,context);
  const locate=vm.runInContext('locateFailure',context),pending=nodes.map(node=>locate(node));
  assert.equal(locateFeedback.size,20);assert.equal(nodes[0].result.hidden,true);assert.equal(nodes[0].result.textContent,'');
  const retry=locate(nodes[0]);assert.equal(nodes[0].result.textContent,'定位中…');
  replies[0]({failures:[]});await pending[0];
  assert.equal(nodes[0].result.textContent,'定位中…','evicted reply cannot replace the newer pending request');
  replies[21]({failures:[]});await retry;
  assert.equal(nodes[0].result.textContent,'未能从错误输出定位到源码位置');
  for(let i=1;i<21;i++)replies[i]({failures:[]});await Promise.all(pending);
  assert.equal(nodes[0].result.textContent,'未能从错误输出定位到源码位置');
});
