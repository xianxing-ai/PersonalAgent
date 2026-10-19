import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {mountSessionControls} from '../src/features/conversation/session-controls.js';
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
function fixture(){
  const documentBefore=globalThis.document,windowBefore=globalThis.window,optionBefore=globalThis.Option;
  const node=()=>({value:'',children:[],setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(){},addEventListener(){}});
  const fields=new Map();globalThis.document={createElement(){const value=node();value.querySelector=selector=>{if(!fields.has(selector))fields.set(selector,node());return fields.get(selector);};return value;}};globalThis.window={addEventListener(){}};globalThis.Option=function(text,value){this.text=text;this.value=value;};
  const listeners=new Map(),error={textContent:''},input={value:'synthetic draft',addEventListener(name,handler){(listeners.get(name)??listeners.set(name,[]).get(name)).push(handler);},dispatchEvent(event){for(const handler of listeners.get(event.type)??[])handler(event);}},sendBtn={disabled:false},calls=[];
  const current={conversationState:{activeId:'desktop-panel',draft:'synthetic draft',sessions:[{id:'desktop-panel',title:'original',archived:false}]}};
  const sessionControls=mountSessionControls(node(),input,async(name)=>{assert.equal(name,'conversation.draft');return {saved:true};},()=>{});sessionControls.update(current);
  globalThis.document=documentBefore;globalThis.window=windowBefore;globalThis.Option=optionBefore;
  const context=vm.createContext({root:{querySelector:()=>error},input,sendBtn,sessionControls,current,Event,submitGeneration:0,pending:false,draftRevision:0,thread:{scrollTop:0,scrollHeight:100},requestAnimationFrame:callback=>callback(),setSendMode:()=>{},invoke:()=>new Promise((resolve,reject)=>calls.push({resolve,reject}))});
  for(const declaration of dependencies.values())vm.runInContext(`let ${declaration};`,context);
  return {error,input,calls,context,submit:vm.runInContext(`(${handler})`,context),host:(value,preserveFeedback)=>vm.runInContext(`{const data={connectionError:${JSON.stringify(value)}},voiceError='',preserveFeedback=${preserveFeedback};${renderFeedback}}`,context),report:value=>vm.runInContext(`report(${JSON.stringify(value)})`,context)};
}
const event={preventDefault(){}};
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
