import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Evaluate the original handler and its original render feedback statement.
// Other DOM rendering is outside this isolated interleaving test.
const source=readFileSync(new URL('../src/app/renderer.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('renderer.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=new Map();let handler,renderArrow;
function visit(node) {
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&!declarations.has(node.name.text)) declarations.set(node.name.text,node.getText(ast));
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='wakeButton.onclick') handler=node.right.getText(ast);
  if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='render'&&ts.isArrowFunction(node.right)
    &&node.right.body.getText(ast).includes('const voiceError=')) renderArrow=node.right;
  ts.forEachChild(node,visit);
}
visit(ast);assert.ok(handler&&renderArrow);
const feedback=renderArrow.body.statements.find(node=>node.getText(ast).includes('data.connectionError||voiceError'));
assert.ok(feedback);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function harness() {
  const response=deferred(),error={textContent:'older error'},wakeButton={disabled:false};
  const context=vm.createContext({root:{querySelector:()=>error},wakeButton,Promise,
    wakePending:false,wakeClosed:false,updateVersion:0,current:{wake:{phase:'listening'}},
    renderWake(){},invoke:async name=>name==='snapshot'?response.promise:{}});
  for(const name of ['errorFeedbackRevision','setFeedback','report']) {
    if(declarations.has(name)) vm.runInContext(`let ${declarations.get(name)};`,context);
  }
  vm.runInContext(`render=(${renderArrow.parameters.map(p=>p.getText(ast)).join(',')})=>{
    updateVersion++;current=data;const voiceError=data.voiceError??'';${feedback.getText(ast)}};
    wakeButton.onclick=${handler};`,context);
  return {context,error,response,run:()=>wakeButton.onclick(),report:value=>vm.runInContext(`report(${JSON.stringify(value)})`,context)};
}
async function waiting(h) {const pending=h.run();await Promise.resolve();await Promise.resolve();return{pending};}
test('late Wake snapshot preserves a newer shared error while still updating snapshot state',async()=>{
  const h=harness(),{pending}=await waiting(h);h.report('new SIS configuration error');
  h.response.resolve({wake:{phase:'disabled'},connectionError:''});await pending;
  assert.equal(h.error.textContent,'new SIS configuration error');assert.equal(h.context.current.wake.phase,'disabled');
});
test('late Wake failure cannot replace a newer shared error',async()=>{
  const h=harness(),{pending}=await waiting(h);h.report('new task error');h.response.reject(Error('old Wake error'));await pending;
  assert.equal(h.error.textContent,'new task error');
});
test('feedback ownership changes even when a newer writer uses identical text',async()=>{
  const h=harness(),{pending}=await waiting(h);h.report('older error');h.response.resolve({wake:{phase:'disabled'}});await pending;
  assert.equal(h.error.textContent,'older error');
});
test('current Wake completion clears its original error through the current snapshot',async()=>{
  const h=harness(),{pending}=await waiting(h);h.response.resolve({wake:{phase:'disabled'},connectionError:''});await pending;
  assert.equal(h.error.textContent,'');
});
test('current snapshot connection and voice failures remain visible',async()=>{
  for(const data of [{connectionError:'new connection failure'},{voiceError:'new recognition failure'}]) {
    const h=harness(),{pending}=await waiting(h);h.response.resolve(data);await pending;
    assert.equal(h.error.textContent,data.connectionError??data.voiceError);
  }
});
test('a newer successful configuration notice also owns the shared feedback',async()=>{
  const h=harness(),{pending}=await waiting(h);
  vm.runInContext(`typeof setFeedback==='function'?setFeedback('saved; Runtime pending'):report('saved; Runtime pending')`,h.context);
  h.response.resolve({wake:{phase:'disabled'}});await pending;assert.equal(h.error.textContent,'saved; Runtime pending');
});
test('later snapshot and unload retain their existing stale-result guards',async()=>{
  for(const closed of [false,true]) {const h=harness(),{pending}=await waiting(h);
    if(closed)h.context.wakeClosed=true;else h.context.updateVersion++;
    h.response.resolve({wake:{phase:'disabled'}});await pending;assert.equal(h.error.textContent,'older error');
    assert.equal(h.context.current.wake.phase,'listening');}
});
