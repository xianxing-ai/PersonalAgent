import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=await readFile(new URL('../src/app/renderer.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('renderer.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const dependencies=new Map();let handler,hostProjection,renderFeedback;
function visit(node){
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='form.onsubmit')handler=node.right.getText(ast);
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='syncHostFeedback')hostProjection=node.getText(ast);
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='render'&&ts.isArrowFunction(node.right))renderFeedback=node.right.body.statements.filter(statement=>/data\.connectionError\|\|voiceError|preserveFeedback===false&&hostFeedback/.test(statement.getText(ast))).map(statement=>statement.getText(ast)).join('\n');
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&!dependencies.has(node.name.text)&&['errorFeedbackRevision','setFeedback','hostFeedback','hostFeedbackRevision','syncHostFeedback','report'].includes(node.name.text))dependencies.set(node.name.text,node.getText(ast));
  ts.forEachChild(node,visit);
}
visit(ast);assert.ok(handler,'actual panel submit handler');assert.equal(hostProjection,'syncHostFeedback(data.connectionError||voiceError,{preserveFeedback:preserveFeedback!==undefined})','actual passive snapshot render projects Host feedback');
function fixture(){
  const error={textContent:''},input={value:'synthetic draft'},sendBtn={disabled:false},calls=[];
  const context=vm.createContext({root:{querySelector:()=>error},input,sendBtn,pending:false,draftRevision:0,thread:{scrollTop:0,scrollHeight:100},requestAnimationFrame:callback=>callback(),setSendMode:()=>{},invoke:()=>new Promise((resolve,reject)=>calls.push({resolve,reject}))});
  for(const declaration of dependencies.values())vm.runInContext(`let ${declaration};`,context);
  return {error,input,calls,context,submit:vm.runInContext(`(${handler})`,context),host:(value,preserveFeedback)=>vm.runInContext(`{const data={connectionError:${JSON.stringify(value)}},voiceError='',preserveFeedback=${preserveFeedback};${renderFeedback}}`,context),report:value=>vm.runInContext(`report(${JSON.stringify(value)})`,context)};
}
const event={preventDefault(){}};
test('failed submit retains draft and operation feedback through ordinary snapshots',async()=>{
  const f=fixture(),run=f.submit(event);f.calls[0].reject(Error('submit failed'));await run;
  f.host('');f.host('');assert.equal(f.error.textContent,'submit failed');assert.equal(f.input.value,'synthetic draft');assert.equal(f.context.pending,false);
});
test('older submit success cannot clear newer workspace or Host feedback',async()=>{
  for(const host of [false,true]){const f=fixture(),run=f.submit(event);if(host)f.host('Host failed');else f.report('workspace failed');f.calls[0].resolve();await run;assert.equal(f.error.textContent,host?'Host failed':'workspace failed');}
});
test('current submit success clears old operation error while retaining current Host error',async()=>{
  for(const host of [false,true]){const f=fixture();if(host)f.host('Host failed');else f.report('old operation failed');const run=f.submit(event);f.calls[0].resolve();await run;assert.equal(f.error.textContent,host?'Host failed':'');if(host){f.host('');assert.equal(f.error.textContent,'');}}
});
test('Host recovery clears its own feedback but never a newer operation with identical text',()=>{
  const f=fixture();f.host('same error');f.report('same error');f.host('');assert.equal(f.error.textContent,'same error');f.host('new Host error');f.host('');assert.equal(f.error.textContent,'');
});
test('feedback-preserving refresh retains newer operation feedback and updates the Host readback',async()=>{
  const f=fixture();f.host('old Host error');f.report('new operation error');f.host('',true);assert.equal(f.error.textContent,'new operation error');const run=f.submit(event);f.calls[0].resolve();await run;assert.equal(f.error.textContent,'');
});
test('current explicit Wake readback clears old operation feedback and Host recovery keeps ownership',()=>{
  const f=fixture();f.report('old operation');f.host('',false);assert.equal(f.error.textContent,'');f.host('current Host error',false);assert.equal(f.error.textContent,'current Host error');f.host('');assert.equal(f.error.textContent,'');
});
test('a changed draft remains intact and busy until the receipt settles',async()=>{
  const f=fixture(),run=f.submit(event);assert.equal(f.context.pending,true);f.input.value='new draft';f.context.draftRevision++;f.host('');f.calls[0].resolve();await run;assert.equal(f.input.value,'new draft');assert.equal(f.context.pending,false);
});
