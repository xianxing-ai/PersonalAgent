const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,readFileSync,rmSync}=require('node:fs');
const {EventEmitter}=require('node:events');
const {runInNewContext}=require('node:vm');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {originalQuestionBinding,approveOriginalQuestion,readAllowedOriginalQuestion,electronLaunchOptions,waitForStartupWindow,startupOutputMetadata}=require('./desktop-pelican-default-live.cjs');

test('pre-submission startup waits for a real matching window beyond thirty seconds without accepting another window',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
  const orb={url:()=> 'file:///synthetic?mode=orb'},admin={url:()=> 'file:///synthetic?mode=admin'};
  const app={windows:()=>Date.now()>=45_000?[admin,orb]:[admin]};let ready=false;
  const pending=waitForStartupWindow(app,'orb').then(value=>{ready=true;return value;});
  for(let seconds=0;seconds<45;seconds++){t.mock.timers.tick(1000);await Promise.resolve();await Promise.resolve();
    if(seconds===30)assert.equal(ready,false);}
  assert.equal(await pending,orb);assert.equal(ready,true);
  const absent=assert.rejects(waitForStartupWindow(app,'panel'),/Desktop panel did not reach the required state before its deadline/u);
  for(let seconds=0;seconds<121;seconds++){t.mock.timers.tick(1000);await Promise.resolve();await Promise.resolve();}
  await absent;
});
test('startup stdout diagnostics retain only fixed readiness metadata',()=>{
  assert.deepEqual(startupOutputMetadata('PersonalAgent startup '+JSON.stringify({runtime:'ready',agentArtsConfigured:true,
    liveReady:false,path:'PRIVATE_PATH',credentials:'PRIVATE_TOKEN'})),{runtime:'ready',agentArtsConfigured:true,liveReady:false});
  assert.deepEqual(startupOutputMetadata('PersonalAgent startup '+JSON.stringify({runtime:'PRIVATE_PATH',liveReady:'PRIVATE_TOKEN'})),{runtime:'unknown'});
  for(const line of ['PRIVATE_PATH','PersonalAgent startup PRIVATE_TOKEN','PersonalAgent startup null'])
    assert.equal(startupOutputMetadata(line),undefined);
});

test('explicit Electron startup loads the pinned ready gate and retains only the runner-owned PA settings',()=>{
  const options=electronLaunchOptions({executablePath:path.resolve('Synthetic-electron.exe'),userData:path.resolve('Synthetic-public-fixture/user-data')},
    {SyntheticMarker:'public',PA_RUNTIME_PROFILE:'local',PA_PRIVATE_SENTINEL:'must not inherit',pa_other_override:'must not inherit',ELECTRON_RUN_AS_NODE:'1'});
  assert.equal(options.args[0],'-r');assert.ok(options.args[1].endsWith(path.join('server','electron','loader.js')));
  assert.equal(options.args[2],path.resolve(__dirname,'../../../apps/desktop'));
  assert.equal(options.args[3],'--pa-public-pelican-acceptance=Synthetic-public-fixture');
  assert.equal(options.env.PA_RUNTIME_PROFILE,'huawei_ict_agentarts');assert.equal(options.env.SyntheticMarker,'public');
  assert.equal(Object.hasOwn(options.env,'PA_PRIVATE_SENTINEL'),false);assert.equal(Object.hasOwn(options.env,'pa_other_override'),false);
  assert.equal(options.env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(options.env.PA_DESKTOP_SYNTHETIC_MVP,undefined);
});

test('the actual pinned loader defers ready and whenReady until the driver attaches, with an explicit Fake Electron event source',async()=>{
  const options=electronLaunchOptions({executablePath:path.resolve('Synthetic-electron.exe'),userData:path.resolve('Synthetic-public-fixture/user-data')},{});
  let ready;const originalReady=new Promise(resolve=>{ready=resolve;}),events=[];
  const app=new EventEmitter();app.whenReady=()=>originalReady;app.commandLine={appendSwitch(){}};app.isReady=()=>true;
  const context={require:name=>{assert.equal(name,'electron');return {app};},process:{argv:['Synthetic-electron','--inspect=0','--remote-debugging-port=0',...options.args],env:{}}};
  runInNewContext(readFileSync(options.args[1],'utf8'),context,{filename:'pinned-playwright-electron-loader.js'});
  app.on('ready',()=>events.push('product-ready-event'));
  const startup=app.whenReady().then(()=>events.push('product-window-created'));
  app.emit('ready','Synthetic OS ready');ready('Synthetic OS ready');await Promise.resolve();
  assert.deepEqual(events,[],'OS readiness cannot race ahead of driver attachment');assert.equal(app.isReady(),false);
  events.push('driver-connected');await context.__playwright_run();await startup;
  assert.equal(app.isReady(),true);assert.deepEqual(events,['driver-connected','product-ready-event','product-window-created']);
});

test('public Pelican question automation verifies the original descendant and exact pending invocation read-only',async t=>{
  const {toolArgumentsDigest}=await import('@personal-agent/tool-gateway');
  const directory=mkdtempSync(path.join(tmpdir(),'pa-pelican-question-')),file=path.join(directory,'runtime.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const db=new DatabaseSync(file);
  db.exec('CREATE TABLE task_checkpoints(task_id TEXT, checkpoint_key TEXT, value_json TEXT, PRIMARY KEY(task_id,checkpoint_key));'
    +'CREATE TABLE trusted_host_state(namespace TEXT,state_key TEXT,value_json TEXT)');
  const save=(task,key,value)=>db.prepare('INSERT OR REPLACE INTO task_checkpoints VALUES(?,?,?)').run(task,key,JSON.stringify(value));
  const args={sessionId:'Synthetic-original-session',path:'pelican.svg'},deadline=new Date(Date.now()+60_000).toISOString();
  const question={questionId:'Synthetic-question',taskId:'Synthetic-host',sourceApprovalId:'host-tool-Synthetic-host',
    toolName:'coding.repair.read',expiresAt:deadline,conversationId:'Synthetic-conversation',revision:1,sandbox:{revision:1},
    requirements:[{requirementId:'tool',kind:'tool',summary:'Synthetic public fixture',scopes:['workspace:read']}]};
  save('Synthetic-host','coding-repair:parent',{taskId:'Synthetic-worker',operationId:'Synthetic-original-operation'});
  save('Synthetic-worker','subtask-parent',{parentTaskId:'Synthetic-original-main'});
  const invocation={toolName:question.toolName,arguments:args,argumentsDigest:toolArgumentsDigest(args),deadline};
  save(question.taskId,'application-tool-invocation:'+question.sourceApprovalId,invocation);
  const before=db.prepare('SELECT * FROM task_checkpoints ORDER BY task_id,checkpoint_key').all();
  assert.deepEqual(await originalQuestionBinding(file,'Synthetic-original-main',question),{argumentsDigest:invocation.argumentsDigest,deadline});
  assert.deepEqual(db.prepare('SELECT * FROM task_checkpoints ORDER BY task_id,checkpoint_key').all(),before,'the verifier must not update original checkpoints');
  const allowed={...question,runId:question.sourceApprovalId,revision:2,state:'allowed',decision:'allow_task',receiptRef:'Synthetic-receipt',
    argumentsDigest:invocation.argumentsDigest,deadline,sandbox:{ref:'Synthetic-restricted',revision:1}};
  const persistAllowed=value=>{db.prepare('DELETE FROM trusted_host_state').run();
    db.prepare('INSERT INTO trusted_host_state VALUES(?,?,?)').run('desktop-authorization:Synthetic','state',JSON.stringify({
      revision:1,selectedRef:'Synthetic-restricted',questions:[value]}));};
  persistAllowed(allowed);
  const binding={argumentsDigest:invocation.argumentsDigest,deadline},observed={...question,state:'allowed',revision:2};
  assert.equal(await readAllowedOriginalQuestion(file,'Synthetic-original-main',question,observed,binding),'allow_task');
  for(const patch of [{state:'stale'},{revision:1},{runId:'Synthetic-other-run'},{argumentsDigest:'0'.repeat(64)},
    {decision:'deny'},{receiptRef:''},{requirements:[]},{sandbox:{ref:'Synthetic-restricted',revision:2}},
    {deadline:new Date(Date.now()+30_000).toISOString()}]){
    persistAllowed({...allowed,...patch});
    await assert.rejects(readAllowedOriginalQuestion(file,'Synthetic-original-main',question,observed,binding));
  }
  await assert.rejects(originalQuestionBinding(file,'Synthetic-sibling-main',question),/descendants/);
  await assert.rejects(originalQuestionBinding(file,'Synthetic-original-main',{...question,toolName:'mail.inbox'}),/original pending/);
  save(question.taskId,'application-tool-invocation:'+question.sourceApprovalId,{...invocation,arguments:{...args,path:'other.svg'}});
  await assert.rejects(originalQuestionBinding(file,'Synthetic-original-main',question),/exact arguments/);
  save(question.taskId,'application-tool-invocation:'+question.sourceApprovalId,{...invocation,arguments:{...args,path:'other.svg'},
    argumentsDigest:toolArgumentsDigest({...args,path:'other.svg'})});
  await assert.rejects(originalQuestionBinding(file,'Synthetic-original-main',question),/public SVG/);
  db.close();
});

test('public Pelican approval follows only the current suggested task decision and records that actual choice',async t=>{
  const names=['window','document','getComputedStyle','innerHeight','innerWidth'];
  const original=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  t.after(()=>{for(const name of names){const value=original.get(name);if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];}});
  for(const [hints,decision]of [[{canReuseTask:true,suggestedDecision:'allow_task'},'allow_task'],
    [{canReuseTask:false,suggestedDecision:'allow_task'},'allow_once'],[{},'allow_once']]){
    const pending={questionId:'Synthetic-question',taskId:'Synthetic-task',sourceApprovalId:'Synthetic-run',conversationId:'Synthetic-conversation',
      revision:1,state:'pending',toolName:'coding.repair.start',expiresAt:new Date(Date.now()+60_000).toISOString(),requirements:[],...hints};
    let current=structuredClone(pending),clicks=0;
    const element={isConnected:true,disabled:false,dataset:{authorizationDecision:decision},
      getBoundingClientRect:()=>({width:100,height:30,top:10,bottom:40,left:10,right:110}),click:()=>{clicks++;current={...current,state:'allowed',revision:current.revision+1};}};
    const card={dataset:{questionId:pending.questionId},querySelector:selector=>{
      assert.equal(selector,`[data-authorization-decision="${decision}"]`);return element;}};
    globalThis.window={desktop:{invoke:async()=>({ok:true,value:{authorizationQuestions:[current],conversationState:{activeId:pending.conversationId}}})}};
    globalThis.document={querySelector:()=>({value:pending.conversationId}),querySelectorAll:()=>[card]};globalThis.getComputedStyle=()=>({display:'block',visibility:'visible'});
    globalThis.innerHeight=800;globalThis.innerWidth=1200;
    const panel={bringToFront:async()=>{},evaluate:(fn,args)=>fn(args)};
    const result=await approveOriginalQuestion(panel,pending,{verifyAllowed:async()=>decision});
    assert.equal(result.decision,decision);assert.equal(result.decisionSource,'runner_ui_activation');
    assert.equal(result.runnerClicked,true);assert.equal(result.physicalHumanClick,false);assert.equal(clicks,1);
    current={...current,canReuseTask:!current.canReuseTask};
    await assert.rejects(approveOriginalQuestion(panel,pending),/binding changed/);assert.equal(clicks,1,'a stale task suggestion grants nothing');
  }
});

test('a card settled while invisible is accepted only from a fresh exact allowed receipt, with no runner click',async t=>{
  const names=['window','document'];const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  t.after(()=>{for(const name of names){const value=originals.get(name);if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];}});
  const pending={questionId:'Synthetic-question',taskId:'Synthetic-task',sourceApprovalId:'Synthetic-run',conversationId:'desktop-panel',
    revision:1,state:'pending',toolName:'coding.repair.start',expiresAt:new Date(Date.now()+60_000).toISOString(),requirements:[],
    sandbox:{revision:1},canReuseTask:true,suggestedDecision:'allow_task'};
  let current=pending,reads=0,active='desktop-panel';const observations=[];
  globalThis.document={querySelector:()=>({value:active}),querySelectorAll:()=>[]};
  globalThis.window={desktop:{invoke:async()=>{reads++;if(reads===2)current={...pending,state:'allowed',revision:2};
    return{ok:true,value:{authorizationQuestions:[current],conversationState:{activeId:active}}};}}};
  const panel={bringToFront:async()=>{},evaluate:(fn,args)=>fn(args)};
  const result=await approveOriginalQuestion(panel,pending,{verifyAllowed:async value=>{
    assert.equal(value.state,'allowed');assert.equal(value.revision,2);return 'allow_once';},onObservation:value=>observations.push(value)});
  assert.deepEqual(result,{decision:'allow_once',observedRevision:2,decisionSource:'observed_existing',runnerClicked:false,physicalHumanClick:'unknown'});
  assert.equal(reads,2);assert.deepEqual(observations.map(item=>item.state),['pending','allowed']);
  for(const patch of [{state:'denied'},{state:'stale'},{state:'expired'},{state:'cancelled'},{revision:1},
    {taskId:'Synthetic-other'},{sourceApprovalId:'Synthetic-other'},{requirements:[{kind:'export'}]},
    {sandbox:{revision:2}},{expiresAt:new Date(Date.now()-1).toISOString()}]){
    current={...pending,state:'allowed',revision:2,...patch};
    await assert.rejects(approveOriginalQuestion(panel,pending,{verifyAllowed:async()=> 'allow_task'}));
  }
  current={...pending,state:'allowed',revision:2};active='Synthetic-other-conversation';
  await assert.rejects(approveOriginalQuestion(panel,pending,{verifyAllowed:async()=> 'allow_task'}),/active panel conversation/u);
  active='desktop-panel';
  await assert.rejects(approveOriginalQuestion(panel,pending),/persisted allowed receipt verification/u);
  await assert.rejects(approveOriginalQuestion(panel,pending,{verifyAllowed:async()=> 'deny'}),/actual persisted allowed decision/u);
  t.mock.timers.enable({apis:['Date','setTimeout'],now:0});current=pending;reads=100;let allowedChecks=0;
  const absent=assert.rejects(approveOriginalQuestion(panel,pending,{verifyAllowed:async()=>{allowedChecks++;return 'allow_task';}}),
    /did not become actionable or allowed before its deadline/u);
  for(let seconds=0;seconds<31;seconds++){t.mock.timers.tick(1000);for(let flush=0;flush<12;flush++)await Promise.resolve();}
  await absent;assert.equal(allowedChecks,0,'missing DOM and pending host state never imply consent');
});
