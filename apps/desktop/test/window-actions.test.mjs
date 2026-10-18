import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const main=ts.createSourceFile('main.js',await readFile(new URL('../electron/main.js',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const host=ts.createSourceFile('desktop-host.js',await readFile(new URL('../electron/desktop-host.js',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function branch(ast,expression) {
  const found=[];
  function visit(node) {if(ts.isIfStatement(node)&&node.expression.getText(ast)===expression)found.push(node.getText(ast));ts.forEachChild(node,visit);}
  visit(ast);assert.equal(found.length,1);return found[0];
}
const controls=branch(main,"name === 'admin.minimize' || name === 'admin.maximize'");
const state=branch(host,"name === 'window-state'");

test('admin window commands cannot operate another renderer and preserve maximize/restore behavior',()=>{
  const calls=[];let maximized=false;
  const admin={minimize(){calls.push('minimize');},isMaximized:()=>maximized,
    maximize(){calls.push('maximize');maximized=true;},unmaximize(){calls.push('restore');maximized=false;}};
  const invoke=vm.runInNewContext(`(name,sender)=>{${controls}}`,{admin});
  for(const name of ['admin.minimize','admin.maximize'])assert.throws(()=>invoke(name,{}),/Untrusted sender/);
  assert.deepEqual(calls,[]);
  invoke('admin.minimize',admin);invoke('admin.maximize',admin);invoke('admin.maximize',admin);
  assert.deepEqual(calls,['minimize','maximize','restore']);
});

test('native window state is readable only for settings and workspace surfaces',()=>{
  const read=vm.runInNewContext(`owner=>{const name='window-state';${state}}`);
  for(const mode of ['admin','workspace'])assert.equal(read({mode,win:{isMaximized:()=>true}}).maximized,true);
  for(const mode of ['orb','panel','desktop-settings'])assert.throws(()=>read({mode,win:{isMaximized(){assert.fail('state must not be read');}}}),/unavailable/);
});
