import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createDeveloperSettingsHost} from '../electron/developer-settings-host.js';

// Execute the actual Desktop composition callback without starting Electron.
// Other participants are explicit Fakes; this is not a cloud/UI or full Runtime test.
const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.js',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),callbacks=[];
function visit(node){
  if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='prepareCompetitionToolExport')callbacks.push(node.initializer.getText(ast));
  ts.forEachChild(node,visit);
}
visit(ast);
assert.equal(callbacks.length,1,'actual Main export-preparation callback must remain uniquely identifiable');
const descriptor={name:'developer.repository_context',version:'1.0.0',sideEffect:'read',requiredScopes:['github:read']};
const proposal=(toolName,toolVersion='1.0.0',args={})=>({kind:'tool_proposal',proposalId:'composition-proposal',
  toolName,toolVersion,arguments:args,verification:'unverified'});
// Matches userTaskDelegationProposal's public shape; the existing Runtime
// user-task-delegation.test.mjs separately exercises its actual mandatory caller.
const delegation=()=>({...proposal('subagent.dispatch','1.0.0',{subtasks:[{subtaskId:'user-work',role:'coordinator',
  roleLabel:'任务执行',goal:'你好',thinkingDepth:2}]}),proposalId:'required-delegation-original-user-task'});

async function fixture(t,{connectorFailure,publicFailure,publicAvailable=true}={}){
  const base=path.resolve('.cache');mkdirSync(base,{recursive:true});
  const userData=mkdtempSync(path.join(base,'developer-export-composition-'));
  const calls=[];
  const settings=createDeveloperSettingsHost({userData,
    safeStorage:{isEncryptionAvailable:()=>false},readWorkspace:()=>undefined,
    readToolDescriptors:async()=>[descriptor],
    createDeployment:async()=>assert.fail('unconfigured settings must never construct a developer provider')});
  t.after(()=>{settings.close();rmSync(userData,{recursive:true,force:true});});
  const developerDeployment=await settings.createDeployment({});
  assert.equal(existsSync(path.join(userData,'developer-settings.json')),false);
  const context=vm.createContext({developerDeployment,todoHost:undefined,feedsHost:undefined,goalCloudHost:undefined,connectorConversationTools:{async prepareExport(scope){
    calls.push({participant:'connector',scope});if(connectorFailure)throw connectorFailure;
  }},publicReferenceConsent:publicAvailable?{
    async requestPreflight(query,scope){calls.push({participant:'public-preflight',query,scope});if(publicFailure)throw publicFailure;},
    async requestExact(query,scope){calls.push({participant:'public-exact',query,scope});if(publicFailure)throw publicFailure;},
  }:undefined,codingWorkspace:{readWorkspaceExportConfigurationRef:()=> 'original-public-binding'},
  referenceHost:{bindTask:()=> 'original-public-binding'},
  readNativePublicSkillSource:()=>({path:'public/guide.md'})});
  const prepare=vm.runInContext(`(${callbacks[0]})`,context);
  const scope={taskId:'original-user-task',runId:'original-trusted-run',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  return {calls,scope,async run(phase,value){return prepare({...scope,phase,proposal:value});}};
}

test('Main composition allows mandatory-delegation-shaped proposals through an unconfigured developer host in both phases',async t=>{
  const f=await fixture(t),p=delegation();
  for(const phase of ['preflight','projection']){
    await f.run(phase,p);
    const call=f.calls.at(-1);assert.equal(call.participant,'connector');
    assert.equal(call.scope.phase,phase);assert.equal(call.scope.proposal,p);
    assert.equal(call.scope.runId,f.scope.runId);
    assert.equal(call.scope.signal,f.scope.signal);assert.equal(call.scope.deadline,f.scope.deadline);
  }
  assert.equal(f.calls.length,2);
});

test('unconfigured developer host preserves downstream connector refusal for delegation',async t=>{
  const refusal=Object.assign(Error('connector refused exact export'),{code:'SCOPE_DENIED'});
  const f=await fixture(t,{connectorFailure:refusal});
  for(const phase of ['preflight','projection'])await assert.rejects(f.run(phase,delegation()),error=>error===refusal);
  assert.equal(f.calls.length,2);
});

test('Main still requests original public-reference preflight and exact consent after developer participation',async t=>{
  const f=await fixture(t),p=proposal('workspace.read_text','1.0.0',{path:'public/guide.md'});
  await f.run('preflight',p);await f.run('projection',p);
  assert.deepEqual(f.calls.map(call=>call.participant),['connector','public-preflight','connector','public-exact']);
  for(const call of f.calls.filter(call=>call.query)){
    assert.equal(call.query.configurationRef,'original-public-binding');assert.equal(call.query.taskId,f.scope.taskId);
    assert.equal(call.query.path,p.arguments.path);assert.equal(call.query.arguments,p.arguments);
    assert.equal(call.scope.signal,f.scope.signal);
  }
});

test('public-reference refusal and unavailable consent remain closed after developer skip',async t=>{
  const refusal=Error('native public consent refused'),p=proposal('workspace.read_text','1.0.0',{path:'public/guide.md'});
  const denied=await fixture(t,{publicFailure:refusal});
  for(const phase of ['preflight','projection'])await assert.rejects(denied.run(phase,p),error=>error===refusal);
  const unavailable=await fixture(t,{publicAvailable:false});
  for(const phase of ['preflight','projection'])await assert.rejects(unavailable.run(phase,p),/原生公开资料许可入口不可用/);
  assert.equal(unavailable.calls.length,2);
});

test('developer-owned exports cannot bypass missing configuration or reach later participants',async t=>{
  const f=await fixture(t);
  for(const phase of ['preflight','projection']){
    await assert.rejects(f.run(phase,proposal(descriptor.name,descriptor.version)),{code:'UNSUPPORTED_CAPABILITY'});
  }
  assert.equal(f.calls.length,0);
});
