import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {locateTestFailures} from '@personal-agent/coding-tools';

test('actual task.locate route classifies private stack paths without opening any source file',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'task-locate-boundary-'));
  const file=path.join(root,'private.js');fs.writeFileSync(file,'const privateMarker = "must-not-leave-the-host";\n');
  const source=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let route;function visit(node){if(ts.isIfStatement(node)&&node.expression.getText(ast)==="name === 'task.locate'")route=node;
    ts.forEachChild(node,visit);}visit(ast);assert.ok(route);
  const panel={},context=vm.createContext({panel,admin:{},workspace:{},repoRootForLocate:()=>root,codingPorts:{locateTestFailures}});
  const invoke=vm.runInContext(`(async function(sender,name,payload){${route.getText(ast).replace("await import('@personal-agent/coding-tools')",'codingPorts')}})`,context);
  const original=fs.openSync;let reads=0;
  fs.openSync=(...args)=>{if(String(args[0])===file)reads++;return original(...args);};syncBuiltinESMExports();
  try {
    const result=await invoke(panel,'task.locate',{text:`✖ synthetic failure (1ms)\n  Error: synthetic\n      at fn (${file}:1:1)`});
    assert.equal(result.totalFailures,1);assert.equal(result.failures[0].frames[0].file,'private.js');
    assert.equal(result.failures[0].frames[0].snippet,null);assert.equal(reads,0);
    assert.equal(JSON.stringify(result).includes('must-not-leave-the-host'),false);
    await assert.rejects(invoke({},'task.locate',{text:'✖ untrusted'}));
  } finally {fs.openSync=original;syncBuiltinESMExports();fs.rmSync(root,{recursive:true,force:true});}
});
