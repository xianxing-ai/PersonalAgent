import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,readdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {defaultThinkingSelection} from '../shared/thinking-selection.js';
import {createAgentArtsModelSettings,readDesktopExecutionModel} from '../electron/agentarts-model-settings.js';
import {Conversations} from '../electron/conversations.js';
import {createModelThinkingController} from '../src/features/conversation/model-thinking-picker.js';
import {snapshot as example,revision} from '../test-support/model-thinking-fixture.mjs';

const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),branches={};
function visit(node){if(ts.isIfStatement(node)&&["name === 'conversation.model'","name === 'thinking.update'"].includes(node.expression.getText(ast)))branches[node.expression.getText(ast).includes('conversation.model')?'conversation.model':'thinking.update']=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function hostFixture(file){
  const data=example(),catalog={version:'1.0',...structuredClone(data.agentArtsModels.catalog)};for(const model of catalog.models)model.requestProfile='standard';
  let preferences=data.agentArtsModels.preferences;
  const models=createAgentArtsModelSettings({configuration:{snapshot:()=>({gatewayUrl:'https://synthetic.invalid',runtimeName:'picker',deploymentVersion:'1'}),readModelPreferences:()=>preferences,saveModelPreferences:value=>{preferences=value;}},readCatalog:async()=>catalog});await models.refresh();
  const conversations=new Conversations(file),panel={},calls=[];let controller;
  const read=()=>({conversationState:conversations.snapshot('panel'),conversationPreference:conversations.preference('desktop-panel'),agentArtsModels:models.snapshot()});
  const invoke=async(name,payload)=>{calls.push({name,payload});const context={name,payload,sender:panel,panel,workspace:{},admin:{},competitionMode:true,conversations,thinking:{depth:1,fast:false},agentArtsModels:models,readDesktopExecutionModel,publish:()=>controller?.update(read())};return new AsyncFunction('context','with(context){'+branches[name]+'}')(context);};
  controller=createModelThinkingController(invoke,error=>{throw error;});controller.update(read());
  return {models,conversations,controller,calls,invoke,read};
}

test('default presets select only the configured pair and published native efforts',()=>{
  const data=example().agentArtsModels;
  for(let depth=0;depth<6;depth++){
    const selected=defaultThinkingSelection(data,depth),model=data.catalog.models.find(item=>item.id===selected.modelId);
    assert.equal(selected.modelId,depth<2?'b':'a');assert.ok(model.reasoningEfforts.includes(selected.reasoningEffort));
  }
  const updated=structuredClone(data);updated.preferences.defaultModelId='custom-model';
  assert.equal(Object.hasOwn(defaultThinkingSelection(updated,5),'reasoningEffort'),false);
  updated.preferences.defaultModelId='blocked';assert.throws(()=>defaultThinkingSelection(updated,5),/不可用/);
  for(const depth of [-1,6,1.5,NaN])assert.throws(()=>defaultThinkingSelection(data,depth));
});
test('default mode persists, creates a rollback copy and resolves changed configured defaults at execution time',async()=>{
  const folder=mkdtempSync(path.join(os.tmpdir(),'pa-default-thinking-')),file=path.join(folder,'conversations.json');
  const old=new Conversations(file);old.setDraft('panel','desktop-panel','保留历史草稿');const previous=readFileSync(file,'utf8');
  const f=await hostFixture(file);f.controller.previewLevel(5);await f.controller.commitLevel(5);await f.controller.flush();
  assert.deepEqual(f.conversations.preference('desktop-panel'),{depth:5,fast:false,modelSelection:'default'});
  const restored=new Conversations(file);assert.equal(restored.preference('desktop-panel').modelSelection,'default');assert.equal(restored.session('desktop-panel').draft,'保留历史草稿');
  const backup=readdirSync(folder).find(name=>name.includes('.before-default-thinking-'));assert.ok(backup);
  assert.equal(JSON.parse(previous).version,5,'the active path is an old-loader rejecting marker');
  const rollback=JSON.parse(readFileSync(path.join(folder,backup),'utf8'));
  assert.equal(rollback.version,4);assert.equal(rollback.sessions.find(s=>s.id==='desktop-panel').draft,'保留历史草稿');
  assert.deepEqual(rollback.preferences,[],'the one-time logical backup predates the default selection');
  f.models.configure({catalogRevision:revision,defaultModelId:'custom-model',defaultSubmodelId:'b'});
  assert.equal(readDesktopExecutionModel(f.models,restored.preference('desktop-panel')).modelId,'custom-model');
  assert.equal(readDesktopExecutionModel(f.models,restored.preference('desktop-panel')).reasoningEffort,undefined);
  restored.close();f.conversations.close();old.close();
});
test('actual main default-preset action rejects stale catalog, invalid input and stale conversation atomically',async()=>{
  const f=await hostFixture(),valid={modelId:'',modelSelection:'default',depth:5,fast:false,catalogRevision:revision,conversationId:'desktop-panel'};
  for(const change of [{catalogRevision:'b'.repeat(64)},{depth:6},{fast:'yes'},{executionModel:{modelId:'a'}},{conversationId:'old-session'},{modelSelection:'invented'}]){
    await assert.rejects(f.invoke('conversation.model',{...valid,...change}));assert.equal(f.conversations.preferences.size,0);
  }
  await assert.rejects(f.invoke('conversation.model',{modelId:'a',depth:5}));
  await f.invoke('conversation.model',valid);assert.equal(f.conversations.preference('desktop-panel').depth,5);
  await f.invoke('conversation.model',{modelId:'a',conversationId:'desktop-panel'});assert.equal(f.conversations.preference('desktop-panel').modelSelection,undefined);
});
test('slider -> actual main preference -> Runtime -> synthetic AgentArts request carries the selected model and native effort',async()=>{
  const f=await hostFixture(),requests=[];
  const app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://synthetic.huaweicloud-agentarts.com',runtimeName:'picker',responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',
    tools:[{descriptor:{name:'fixture.read',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{}},sideEffect:'read',requiredScopes:[],requiresPresence:false,idempotencySupport:true,recoverySupport:true},execute:async()=>{assert.fail('Preset selection must not execute tools');}}],
    competitionToolAvailability:[{toolName:'fixture.read',toolVersion:'1.0.0',available:()=>true}],
    competitionToolExports:[{toolName:'fixture.read',toolVersion:'1.0.0',exportPolicyVersion:'synthetic-picker-v1',accepts:()=>true,project:({result})=>result}],
    readConversationPreference:conversationId=>{const preference=f.conversations.preference(conversationId);return {...preference,executionModel:readDesktopExecutionModel(f.models,preference)};},
    readDefaultExecutionModel:role=>readDesktopExecutionModel(f.models,undefined,role),resolveExecutionModel:input=>f.models.resolveExecutionModel(input),
    authorizationProvider:{read:async()=>'Bearer synthetic-only'},fetchImpl:async(url,init)=>{
      assert.equal(url,'https://synthetic.huaweicloud-agentarts.com/runtimes/picker/invocations');requests.push(JSON.parse(JSON.parse(init.body).query));
      return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify({kind:'text',text:'synthetic picker receipt'}),index:0}}),{headers:{'content-type':'application/json'}});
    }});
  try{
    const client=new Client(app,Date.now);await client.connect();
    for(const depth of [0,1,2,3,4,5]){
      f.controller.previewLevel(depth);await f.controller.commitLevel(depth);await f.controller.flush();
      const {taskId}=await client.call('task.submit',{goal:'synthetic preset '+depth,conversationId:'desktop-panel'},{idempotencyKey:'preset-'+depth,timeoutMs:15000});
      const deadline=Date.now()+15000;while(!['succeeded','failed','waiting_reconciliation'].includes(app.runtime.getTask(taskId).state)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
      assert.equal(app.runtime.getTask(taskId).state,'succeeded',JSON.stringify(app.runtime.getTask(taskId).error));
      assert.deepEqual(requests.at(-1).executionModel,defaultThinkingSelection(f.models.snapshot(),depth));
      assert.deepEqual(app.runtime.loadCheckpoint(taskId,'execution-model'),requests.at(-1).executionModel);
      assert.equal(app.runtime.loadCheckpoint(taskId,'task-thinking').depth,depth);
    }
    await f.controller.chooseModel('a');f.controller.previewLevel(1);await f.controller.commitLevel(1);await f.controller.flush();
    assert.equal(f.conversations.preference('desktop-panel').modelSelection,undefined);assert.deepEqual(readDesktopExecutionModel(f.models,f.conversations.preference('desktop-panel')),{catalogRevision:revision,modelId:'a',reasoningEffort:'low'});
    for(const modelId of ['a','custom-model']){
      if(modelId==='custom-model')await f.controller.chooseModel(modelId);
      const {taskId}=await client.call('task.submit',{goal:'synthetic manual '+modelId,conversationId:'desktop-panel'},{idempotencyKey:'manual-'+modelId,timeoutMs:15000});
      const deadline=Date.now()+15000;while(!['succeeded','failed','waiting_reconciliation'].includes(app.runtime.getTask(taskId).state)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
      assert.equal(app.runtime.getTask(taskId).state,'succeeded');assert.equal(requests.at(-1).executionModel.modelId,modelId);
      if(modelId==='a')assert.equal(requests.at(-1).executionModel.reasoningEffort,'low');else assert.equal(Object.hasOwn(requests.at(-1).executionModel,'reasoningEffort'),false);
    }
    console.log(JSON.stringify({receipt:'default-thinking',transport:'explicit synthetic',realModelCalls:0,requests:requests.map(query=>query.executionModel)}));
  }finally{app.close();}
});
