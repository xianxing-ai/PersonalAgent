import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createDesktopDeveloperToolsHost} from '../electron/developer-tools-host.js';

const context=()=>({taskId:'synthetic',runId:'log-run',authorizationRef:'log-run',deadline:new Date(Date.now()+60000).toISOString(),
  signal:new AbortController().signal,scopes:['workspace:read']});
test('missing trusted configuration is unavailable and never constructs a provider',()=>{
  const host=createDesktopDeveloperToolsHost();assert.deepEqual(host.tools,[]);assert.deepEqual(host.runtimeOptions,{});
  assert.ok(host.unavailable.some(item=>item.capability==='github'));assert.ok(host.unavailable.some(item=>item.capability==='developer.workflows'));host.close();
});
test('public failure parser receives an empty host root and cannot export source snippets',async()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'developer-parser-'));
  const source=path.join(root,'private.test.js');writeFileSync(source,'const privateValue = "PRIVATE SOURCE";\n');
  const host=createDesktopDeveloperToolsHost({testLocate:{cacheRootPath:root,available:()=>true}});
  try {
    const tool=host.tools.find(tool=>tool.descriptor.name==='workspace.locate_test_failures');
    const result=await tool.execute({output:`TAP version 13\nnot ok 1 - fails\n  ---\n  error: bad value\n  stack: |-\n    TestContext.<anonymous> (${source}:1:1)\n  ...\n`},context());
    assert.equal(result.totalFailures,1);assert.ok(result.failures[0].frames.length);
    assert.equal(JSON.stringify(result).includes('PRIVATE SOURCE'),false);assert.ok(result.failures[0].frames.every(frame=>!('snippet'in frame)));
    await assert.rejects(tool.execute({output:'',root:root},context()),{code:'INVALID_ARGUMENT'});
    await assert.rejects(tool.execute({output:''},{...context(),scopes:[]}),{code:'SCOPE_DENIED'});
    assert.deepEqual(host.competitionToolExports,[]);
  }finally{host.close();rmSync(root,{recursive:true,force:true});}
});
test('provider registration keeps write presence and dynamic revocation; export is explicit',async()=>{
  let online=true,disposed=0;
  const descriptor={name:'github.issue.label',version:'1.0.0',sideEffect:'external_write',requiresPresence:true};
  const githubModule={register(host){const remove=host.register({descriptor,execute:async()=>({state:'confirmed'})});return()=>{disposed++;remove();};}};
  const host=createDesktopDeveloperToolsHost({githubModule,github:{provider:{verification:'conditional'},available:()=>online},
    exports:[{toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'synthetic-explicit',accepts:()=>true,project:({result})=>result}]});
  assert.equal(host.tools[0].descriptor.requiresPresence,true);assert.equal(await host.competitionToolAvailability[0].available(context()),true);
  online=false;assert.equal(await host.competitionToolAvailability[0].available(context()),false);
  await assert.rejects(host.tools[0].execute({},context()),{code:'UNSUPPORTED_CAPABILITY'});
  host.close();host.close();assert.equal(disposed,1);assert.equal(host.competitionToolExports[0].accepts({}),false);
});
