import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {ProtocolError} from '@personal-agent/contracts';

// Execute the production Main action. Native UI/configuration/Goal admission
// are explicit Fakes; actual source admission is covered by plan-execution-host.
const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),blocks=[];
function visit(node){
  if(ts.isIfStatement(node)&&node.expression.getText(ast)==="name === 'goal.plan.execute'")blocks.push(node.thenStatement.getText(ast));
  ts.forEachChild(node,visit);
}
visit(ast);assert.equal(blocks.length,1);
function fixture({change,prior=false}={}){
  const owner=Object.assign(new EventEmitter(),{isDestroyed:()=>false}),added=[],dialogs=[];
  let conversationId='original-chat',selection={runtimeReady:true,deploymentSelection:'pinned',runtimeName:'original-runtime',
    deploymentVersion:'fixed-version',gatewayUrl:'https://synthetic.invalid/'};
  const task={taskId:'original-task',conversationId:prior?'previous-chat':'original-chat',goal:'Original selected Plan',state:'running'};
  const context={competitionMode:true,syntheticMvp:false,sender:owner,workspace:owner,panel:undefined,AbortController,Date,ProtocolError,
    payload:{plan:{id:'original-plan',revision:1},expectedGraphRevision:1,requestId:'original-request-id'},
    readCompetitionExecutionPolicy:()=>({taskTimeoutMs:60000}),runtimeApplication:{coordinationConfigurationRef:'original-configuration'},
    agentArtsConfig:{snapshot:()=>({...selection})},conversations:{activeConversationId:()=>conversationId,turns:new Map(),
      add:(...args)=>added.push(args)},rememberTaskGoal(){},publish(){},dialog:{showMessageBox:async(window,options)=>{
      assert.equal(window,owner);dialogs.push(options);
      if(change==='conversation')conversationId='replacement';
      if(change==='deployment')selection={...selection,deploymentVersion:'replacement'};
      if(change==='close')owner.emit('closed');
      return {response:change==='deny'?0:1};
    }},goalHost:{executePlan:async(payload,scope)=>{
      assert.equal(payload,context.payload);assert.equal(scope.conversationId,'original-chat');
      if(prior)return {state:'submitted',task};
      const accepted=await scope.confirm({summary:'Original selected Plan',plan:payload.plan,sourceDigest:'original-digest',
        configurationRef:'original-configuration',dependencyCount:1,factCount:1});
      return accepted?{state:'submitted',task}:{state:'declined'};
    }}};
  return {context,owner,dialogs,added,run:()=>vm.runInNewContext(`(async()=>${blocks[0]})()`,context)};
}

test('Main Plan confirmation shows the fixed destination and keeps the original conversation',async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.state,'submitted');assert.equal(f.dialogs.length,1);
  assert.match(f.dialogs[0].detail,/original-runtime \/ fixed-version/);assert.match(f.dialogs[0].detail,/Original selected Plan/);
  assert.equal(f.dialogs[0].defaultId,0);assert.equal(f.dialogs[0].cancelId,0);
  assert.deepEqual(f.added,[['original-task','workspace','Original selected Plan','original-chat']]);assert.equal(f.owner.listenerCount('closed'),0);
});

test('denial, changed conversation/deployment or closed original window cannot admit a Plan',async()=>{
  for(const change of ['deny','conversation','deployment','close']){
    const f=fixture({change});assert.equal((await f.run()).state,'declined');assert.equal(f.added.length,0);assert.equal(f.owner.listenerCount('closed'),0);
  }
});

test('reading a prior Plan task does not ask again or move it to another conversation',async()=>{
  const f=fixture({prior:true});assert.equal((await f.run()).task.conversationId,'previous-chat');
  assert.equal(f.dialogs.length,0);assert.equal(f.added.length,0);
});
