import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {Conversations} from '../electron/conversations.js';import {handleConversationAction} from '../electron/conversation-actions.js';import {createConversationDelivery} from '../electron/conversation-delivery.js';
const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8'),ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const branches={};function visit(node){if(ts.isIfStatement(node)){const expression=node.expression.getText(ast);if(expression==="name === 'task.submit' || name==='skill.run'")branches.submit=node.getText(ast);if(expression==="name === 'conversation.model'")branches.model=node.getText(ast);if(expression==="name === 'thinking.update'")branches.thinking=node.getText(ast);if(expression==="name === 'authorization.respond'")branches.approval=node.getText(ast);}ts.forEachChild(node,visit);}visit(ast);const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
// Execute the production cache helper too: task submission now depends on it.
test('actual main text submission binds the accepted task to Live only after Runtime acceptance',async()=>{
  const f=fixture(),tracked=[];
  f.context.liveVoice={trackTextTask:task=>tracked.push(task)};
  await f.run();
  assert.deepEqual(tracked,[{taskId:'new-1',conversationId:'desktop-panel'}]);
  assert.equal(f.conversations.conversationIdForTask({taskId:'new-1'}),'desktop-panel');
});
branches.submit=source.match(/const TASK_GOAL_LIMIT = \d+;/)[0]+ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='rememberTaskGoal').getText(ast)+branches.submit;
function fixture(){const conversations=new Conversations();const panel={},workspace={},tasks=new Map(),calls=[],submitting=new Set();const context={liveVoice:undefined,name:'task.submit',payload:'goal',sender:panel,panel,workspace,admin:{},competitionMode:true,agentArtsConfig:{snapshot:()=>({configured:true})},fakeMode:true,conversations,submitting,conversationDelivery:createConversationDelivery(submitting),tasks,taskSurface:t=>t.surface,terminalTaskStates:new Set(['succeeded','failed','cancelled']),client:{async call(name,{taskId}){calls.push({operation:name,taskId});return {taskId,cancelAccepted:true,state:'cancelling'};}},publish(){},taskGoals:new Map(),pinned:false,async submitConversationTask(_client,request){calls.push(request);return {taskId:'new-'+calls.length};},async refresh(taskId){return {taskId,state:'created'};}};context.interruptConversation=new Function('context','with(context){return '+ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='interruptConversation').getText(ast)+'}')(context);return {context,conversations,tasks,calls,run:()=>new AsyncFunction('context','with(context){'+branches.submit+'}')(context)};}
test('actual main submission protects the original busy conversation but accepts an independent conversation',async()=>{const f=fixture();f.tasks.set('old',{taskId:'old',surface:'panel',conversationId:'desktop-panel',state:'waiting_reconciliation'});await assert.rejects(f.run(),/当前回答/);const fresh=f.conversations.create('panel');f.context.payload={text:'independent goal',conversationId:fresh.id};await f.run();assert.equal(f.calls.length,1);assert.equal(f.calls[0].conversationId,fresh.id);assert.equal(f.conversations.conversationIdForTask({taskId:'new-1'}),fresh.id);f.context.payload={text:'stale edit',conversationId:'desktop-panel'};await assert.rejects(f.run(),/当前对话已切换/);});
test('actual panel async submission stays on the panel main conversation',async()=>{const f=fixture();let finish;f.context.submitConversationTask=(_client,request)=>{f.calls.push(request);return new Promise(resolve=>finish=resolve);};const old=f.run();assert.equal(f.context.submitting.has('desktop-panel'),true);finish({taskId:'accepted-panel'});await old;assert.equal(f.conversations.conversationIdForTask({taskId:'accepted-panel'}),'desktop-panel');assert.equal(f.context.submitting.size,0);});
test('workspace preview does not extend the optional production Local entry',async()=>{const f=fixture();f.context.sender=f.context.workspace;f.context.competitionMode=false;f.context.fakeMode=false;f.context.payload={text:'workspace goal',conversationId:'desktop-workspace'};await assert.rejects(f.run(),/AgentArts/);assert.equal(f.calls.length,0);assert.equal(f.context.submitting.has('desktop-workspace'),false);});
test('trusted command center binds submit to its workspace conversation and rejects foreign identities',async()=>{const f=fixture();f.context.sender=f.context.workspace;f.context.payload={text:'workspace goal',conversationId:'desktop-workspace'};await f.run();assert.equal(f.calls[0].conversationId,'desktop-workspace');f.context.payload={text:'wrong identity',conversationId:'desktop-panel'};await assert.rejects(f.run(),/当前对话已切换/);f.context.sender={};await assert.rejects(f.run(),/可信界面/);assert.equal(f.calls.length,1);});

test('small workspace rejects alternate main conversations and preserves legacy histories and draft',()=>{
  const conversations=new Conversations(),legacy=conversations.create('panel').id;
  conversations.setDraft('panel',legacy,'retained draft');const before=conversations.snapshot('panel');let publications=0;
  const context={surface:'panel',conversations,tasks:new Map(),taskSurface:t=>t.surface,submitting:new Set(),publish(){publications++;}};
  for(const name of ['conversation.new','conversation.switch','conversation.archive','conversation.restore'])assert.throws(()=>handleConversationAction({...context,name,payload:{conversationId:'desktop-panel'}}),/只保留一个主对话/);
  assert.deepEqual(conversations.snapshot('panel'),before);assert.equal(conversations.session(legacy).draft,'retained draft');assert.equal(publications,0);
  handleConversationAction({...context,name:'conversation.draft',payload:{conversationId:legacy,text:'updated draft'}});assert.equal(conversations.session(legacy).draft,'updated draft');
  const workspace=handleConversationAction({...context,surface:'workspace',name:'conversation.new',payload:{}});assert.notEqual(workspace.activeId,'desktop-workspace');
});

test('eleven restored cancelled-requested unknown tasks never block a new message or become fabricated terminal states',async()=>{
  const f=fixture();
  for(let index=0;index<11;index++){
    const task={taskId:'held-'+index,surface:'panel',conversationId:'desktop-panel',state:'waiting_reconciliation',revision:15,cancelRequested:true};
    f.tasks.set(task.taskId,task);assert.equal(f.context.conversationDelivery.project(task).outputTruncated,true);
  }
  await f.run();assert.equal(f.calls.length,1);assert.equal(f.calls[0].goal,'goal');
  for(const task of f.tasks.values())assert.equal(task.state,'waiting_reconciliation');
});
test('actual approval action rejects an old conversation approval after switching without sending any response',async()=>{const f=fixture();f.tasks.set('old',{taskId:'old',surface:'panel',conversationId:'desktop-panel',state:'waiting_approval'});f.conversations.create('panel');const visibleSource=source.match(/function visibleConversationTask[^\r\n]+/)?.[0];const visible=new Function('conversations','taskSurface','return '+visibleSource)(f.conversations,f.context.taskSurface);let responded=0;Object.assign(f.context,{name:'authorization.respond',payload:{approvalId:'approval-old',taskId:'old',decision:'allow_once',expectedRevision:1},approvals:new Map([['approval-old',{taskId:'old'}]]),visibleConversationTask:visible,publish(){},client:{async call(){responded++;}}});await assert.rejects(new AsyncFunction('context','with(context){'+branches.approval+'}')(f.context),/不属于当前对话/);assert.equal(responded,0);});

test('actual main rejects old-session model/effort and step-budget requests after switching',async()=>{for(const branch of ['model','thinking']){const f=fixture();const old=f.conversations.activeConversationId('panel');const fresh=f.conversations.create('panel');Object.assign(f.context,{name:branch==='model'?'conversation.model':'thinking.update',payload:branch==='model'?{conversationId:old,executionModel:{catalogRevision:'a'.repeat(64),modelId:'text',reasoningEffort:'high'}}:{conversationId:old,depth:5,fast:true},thinking:{depth:1,fast:false},modelApiHost:undefined,agentArtsModels:{resolveExecutionModel:input=>({...input})}});await assert.rejects(new AsyncFunction('context','with(context){'+branches[branch]+'}')(f.context),/当前对话已切换/);assert.deepEqual(f.conversations.preference(fresh.id),{depth:1,fast:false});assert.equal(f.conversations.preferences.has(fresh.id),false);}});

test('steering cancels only the original conversation and never waits for its stalled readback',async()=>{
  const f=fixture();f.tasks.set('old',{taskId:'old',surface:'panel',conversationId:'desktop-panel',state:'running',resultSummary:'partial'});
  f.tasks.set('other',{taskId:'other',surface:'workspace',conversationId:'desktop-workspace',state:'running'});
  f.context.refresh=taskId=>taskId==='old'?new Promise(()=>{}):Promise.resolve({taskId,state:'created'});
  f.context.payload={text:'换个方向继续',conversationId:'desktop-panel',delivery:'steer'};
  await f.run();assert.equal(f.calls[0].operation,'task.cancel');assert.equal(f.calls[0].taskId,'old');
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].goal,'换个方向继续');
  assert.equal(f.tasks.get('old').state,'running','Desktop cannot fabricate a Runtime terminal state');
  const projected=f.context.conversationDelivery.project({...f.tasks.get('old'),resultSummary:'late answer'});
  assert.equal(projected.resultSummary,'partial');assert.equal(projected.outputTruncated,true);
  assert.equal(f.context.conversationDelivery.project(f.tasks.get('other')).outputTruncated,undefined);
});
test('rejected cancellation blocks steering without leaving the submission lock held',async()=>{
  const f=fixture();f.tasks.set('old',{taskId:'old',surface:'panel',conversationId:'desktop-panel',state:'running'});
  f.context.client.call=async()=>{throw Error('cancel unavailable');};f.context.payload={text:'继续',delivery:'steer'};
  await assert.rejects(f.run(),/cancel unavailable/);assert.equal(f.calls.length,0);assert.equal(f.context.submitting.size,0);
});
test('stop during steering preflight prevents submitting the new task',async()=>{
  const f=fixture();f.tasks.set('old',{taskId:'old',surface:'panel',conversationId:'desktop-panel',state:'running'});
  let release;f.context.client.call=()=>new Promise(resolve=>{release=resolve;});f.context.payload={text:'引导',delivery:'steer'};
  const sending=f.run();f.context.conversationDelivery.interruptPending('desktop-panel');
  release({taskId:'old',cancelAccepted:true,state:'cancelling'});assert.deepEqual(await sending,{interrupted:true});assert.equal(f.calls.length,0);
});
test('late acceptance after stop is cancelled without releasing a newer submission lock',async()=>{
  const f=fixture();let accept;f.context.submitConversationTask=()=>new Promise(resolve=>{accept=resolve;});
  const old=f.run();f.context.conversationDelivery.interruptPending('desktop-panel');
  const newer=f.context.conversationDelivery.begin('desktop-panel');accept({taskId:'late'});
  const result=await old;assert.equal(result.interrupted,true);assert.equal(f.calls[0].operation,'task.cancel');assert.equal(f.calls[0].taskId,'late');
  assert.equal(f.context.submitting.has('desktop-panel'),true);f.context.conversationDelivery.finish(newer);assert.equal(f.context.submitting.size,0);
});
test('delivery options cannot select another surface or bypass validation',async()=>{
  for(const payload of [{text:'x',delivery:'queue'},{text:'x',delivery:'steer',unknown:true},{text:'x',delivery:'steer',conversationId:'another'}]){
    const f=fixture();f.context.payload=payload;await assert.rejects(f.run(),/格式无效|当前对话已切换/);assert.equal(f.calls.length,0);
  }
});

for(const steering of [false,true])test(`accepted task remains stoppable before first readback${steering?' when steering':' by Stop'}`,async()=>{
  const f=fixture();let releaseReadback,readbackHeld=false;
  f.context.refresh=taskId=>{
    if(taskId==='new-1'&&!readbackHeld){readbackHeld=true;return new Promise(resolve=>{releaseReadback=()=>resolve({taskId,state:'running'});});}
    return Promise.resolve({taskId,state:taskId==='new-1'?'cancelling':'created'});
  };
  const original=f.run();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(releaseReadback);assert.equal(f.tasks.size,0,'first task.get has not populated the Desktop cache');
  let newer;
  if(steering){f.context.payload={text:'new direction',delivery:'steer'};newer=f.run();await new Promise(resolve=>setImmediate(resolve));}
  else await f.context.interruptConversation('desktop-panel','panel');
  assert.equal(f.calls.some(call=>call.operation==='task.cancel'&&call.taskId==='new-1'),true,'cancel is sent without waiting for task.get');
  releaseReadback();assert.equal((await original).interrupted,true);
  assert.equal(f.context.conversationDelivery.project({taskId:'new-1',state:'running',resultSummary:'late output'}).outputTruncated,true);
  if(newer)await newer;
});
