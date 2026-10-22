// Offline adapters and synthetic SQLite only. No Desktop/provider/model starts.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {adminPage,changeAudit,completeBaselineReady,completedNotification,readDeviceDelivery,failureFrames}=require('./desktop-change-notification-live.cjs');
const {createHash}=require('node:crypto');
const {approveConversationQuestions,validateWatchRead}=require('./desktop-weather-watch-live.cjs');

function globals(t,values){
  const previous=new Map(Object.keys(values).map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const [name,value]of Object.entries(values))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  t.after(()=>{for(const [name,value]of previous)if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];});
}
function navigation(t,target,{hiddenControl=false}={}){
  const trace=[],main={dataset:{section:'settings',navigationRevision:'6'},busy:'false',getAttribute:()=>main.busy};
  const content={dataset:{section:'settings'}};let selected=target,hostPage,controlReady=false,waits=0;
  const control={isConnected:true,disabled:false,checkVisibility:()=>controlReady,closest:()=>controlReady?null:{},
    getBoundingClientRect:()=>({width:controlReady?100:0,height:controlReady?30:0})};
  const nav={dataset:{page:target},getAttribute:()=>selected===target?'page':'false'};
  const document={querySelector(selector){
    if(selector==='.main')return main;if(selector==='#content')return content;
    if(selector.startsWith('.side'))return nav;
    if(selector==='[data-laya="start"]')return target==='connections'?control:null;
    if(selector==='[data-workspace="select"]')return null;
    throw Error('Unexpected selector '+selector);
  }};
  globals(t,{document,getComputedStyle:()=>({display:controlReady?'block':'none',visibility:'visible'}),
    window:{desktop:{invoke:async(name,input)=>{
      if(name==='admin.open'){hostPage=input.page;trace.push(['open',input.page]);return{ok:true};}
      assert.equal(name,'snapshot');return{ok:true,value:{adminNavigation:{page:hostPage,revision:7}}};
    }}}});
  const admin={url:()=>'?mode=admin',evaluate:fn=>fn(),
    async waitForFunction(fn,arg){
      waits++;trace.push(['wait',waits]);
      if(waits===1){
        assert.equal(fn(arg),false,'old sidebar selection must not acknowledge a stale host revision');
        main.dataset.navigationRevision='7';main.busy='true';assert.equal(fn(arg),false,'busy rendering cannot acknowledge navigation');
        main.dataset.section=hostPage;content.dataset.section=hostPage;selected=hostPage;main.busy='false';
      }else{
        content.dataset.section='settings';assert.equal(fn(arg),false,'matching sidebar alone cannot acknowledge the wrong content');
        main.dataset.section=target;content.dataset.section=target;selected=target;
      }
      assert.equal(fn(arg),true);
    },locator(selector){return{
      async waitFor(options){assert.deepEqual(options,{state:'visible'});trace.push(['visible',selector]);
        if(!selector.startsWith('.side')){assert.equal(waits,2);if(hiddenControl)throw Error('Synthetic hidden control');controlReady=true;}},
      getAttribute:async()=>nav.getAttribute(),async click(options){assert.equal(options,undefined,'ordinary clicks must not force hidden controls');
        trace.push(['click',selector]);selected=target;main.dataset.section=target;}
    };}};
  const report={},panel={evaluate:(fn,arg)=>fn(arg)},session={report,panel,app:{windows:()=>[admin]}};
  return{session,admin,trace,report};
}
for(const section of ['connections','notifications'])test('settings navigation consumes host/body revision before visible '+section+' controls',async t=>{
  const f=navigation(t,section);assert.equal(await adminPage(f.session,section),f.admin);
  assert.equal(f.report.settingsNavigation[0].state,'ready');
  assert.equal(f.report.settingsNavigation[0].observed.contentSection,section);
  assert.deepEqual(f.trace[0],['open',section==='notifications'?'settings':'connections']);
  assert.ok(f.trace.some(item=>item[0]==='visible'&&item[1]===(section==='connections'?'[data-laya="start"]':'[data-notifications="form"]')));
});
test('a hidden Laya control fails navigation with safe metadata and never force clicks',async t=>{
  const f=navigation(t,'connections',{hiddenControl:true});await assert.rejects(adminPage(f.session,'connections'),/Synthetic hidden/);
  assert.equal(f.report.settingsNavigation[0].state,'failed');assert.equal(f.report.settingsNavigation[0].observed.layaStart.visible,false);
  assert.equal(f.trace.filter(item=>item[0]==='click').length,0);
});

function database(t){
  const cache=path.resolve(__dirname,'../../../.cache');fs.mkdirSync(cache,{recursive:true});
  const directory=fs.mkdtempSync(path.join(cache,'connector-runner-direct-')),file=path.join(directory,'runtime.sqlite'),db=new DatabaseSync(file);
  t.after(()=>db.close());
  db.exec('CREATE TABLE task_checkpoints(task_id TEXT,checkpoint_key TEXT,value_json TEXT,PRIMARY KEY(task_id,checkpoint_key));'
    +'CREATE TABLE tasks(task_id TEXT,conversation_id TEXT,state TEXT,evidence_refs_json TEXT);'
    +'CREATE TABLE tool_execution_records(record_json TEXT); CREATE TABLE trusted_host_state(namespace TEXT,value_json TEXT)');
  const save=(task,key,value)=>db.prepare('INSERT OR REPLACE INTO task_checkpoints VALUES(?,?,?)').run(task,key,JSON.stringify(value));
  return{db,file,save};
}
test('baseline_ready waits for the original watch final page, not its first 100 items or another baseline',t=>{
  const f=database(t),secret='SYNTHETIC_PRIVATE_HEADER_DO_NOT_PROJECT';
  f.db.prepare('INSERT INTO trusted_host_state VALUES(?,?)').run('desktop-connector-changes',JSON.stringify({sources:{old:{kind:'mail',initialized:true}}}));
  const watch={id:'original-watch',source:'mail',enabled:true,state:'classifying',sequence:0,origin:{taskId:'synthetic-origin'},input:{}};
  const saveWatch=()=>f.db.prepare('INSERT OR REPLACE INTO trusted_host_state(rowid,namespace,value_json) VALUES(2,?,?)')
    .run('desktop-connector-watches',JSON.stringify({watches:{[watch.id]:watch}}));saveWatch();
  const record={taskId:'synthetic-read',evidenceId:'synthetic-run',toolName:'mail.inbox',state:'confirmed',policyDecision:'allow',
    executionStarted:true,finishedAt:'2026-10-22T10:00:00Z'};
  f.db.prepare('INSERT INTO tool_execution_records VALUES(?)').run(JSON.stringify(record));
  f.save(record.taskId,'desktop-connector-watch-origin',{watchId:'original-watch',source:'mail',sequence:0});
  const result={account:'desktop-qq-inbox',folder:'INBOX',items:Array.from({length:100},()=>({contentRef:secret})),hasMore:true};
  f.save(record.taskId,'tool-result-'+record.evidenceId,{result});
  assert.equal(completeBaselineReady(changeAudit(f.file),'mail','original-watch'),false);
  f.save(record.taskId,'tool-result-'+record.evidenceId,{result:{...result,hasMore:false}});
  assert.equal(completeBaselineReady(changeAudit(f.file),'mail','original-watch'),false,'final receipt may still await original classification completion');
  watch.sequence=1;watch.state='monitoring';saveWatch();
  assert.equal(completeBaselineReady(changeAudit(f.file),'mail','other-watch'),false);
  assert.equal(completeBaselineReady(changeAudit(f.file),'mail','original-watch'),true);
  assert.doesNotMatch(JSON.stringify(changeAudit(f.file)),new RegExp(secret+'|contentRef|items'));
  f.db.prepare('UPDATE tool_execution_records SET record_json=?').run(JSON.stringify({...record,state:'unknown'}));
  assert.equal(completeBaselineReady(changeAudit(f.file),'mail','original-watch'),false);
});
test('120-case cohort continues after its first native notification until all pages and classifications finish',()=>{
  const delivered={id:'synthetic-native-show'},manifest={total:120},summary={allReceived:true,allClassified:true,pageBoundaryCovered:true};
  for(const missing of Object.keys(summary))assert.equal(completedNotification(manifest,{summary:{...summary,[missing]:false}},delivered),undefined);
  assert.equal(completedNotification(manifest,undefined,delivered),undefined);
  assert.equal(completedNotification(manifest,{summary},undefined),undefined);
  assert.equal(completedNotification(manifest,{summary},delivered),delivered);
  assert.equal(completedNotification(undefined,undefined,delivered),delivered);
});
test('only the original conversation card is approved; task hints and linked pending records remain compatible',async t=>{
  const {toolArgumentsDigest}=await import('@personal-agent/tool-gateway'),f=database(t),args={watchId:'synthetic-original-watch'};
  const deadline=new Date(Date.now()+60_000).toISOString(),question={questionId:'synthetic-question',taskId:'synthetic-task',
    sourceApprovalId:'synthetic-run',toolName:'connector.watch.stop',revision:1,state:'pending',expiresAt:deadline,requirements:[]};
  f.save(question.taskId,'authorization-question-binding:'+question.sourceApprovalId,{taskId:question.taskId,runId:question.sourceApprovalId,
    toolName:question.toolName,argumentsDigest:toolArgumentsDigest(args),deadline});
  f.save(question.taskId,'application-tool-invocation:'+question.sourceApprovalId,{arguments:args});
  let current,value,clicks=0,fronts=0;
  globals(t,{window:{desktop:{invoke:async()=>({ok:true,value})}}});
  const panel={evaluate:fn=>fn(),bringToFront:async()=>fronts++,locator(selector){
    const decision=current.canReuseTask===true&&current.suggestedDecision==='allow_task'?'allow_task':'allow_once';
    assert.equal(selector,`[data-question-id="${question.questionId}"] [data-authorization-decision="${decision}"]`);
    const element={disabled:false,isConnected:true,dataset:{authorizationDecision:decision},getClientRects:()=>[{}],
      closest:()=>({dataset:{questionId:question.questionId}}),click:()=>clicks++};
    return{waitFor:async options=>assert.deepEqual(options,{state:'visible'}),isEnabled:async()=>true,evaluate:(fn,arg)=>fn(element,arg)};
  }};
  for(const hints of [{canReuseTask:true,suggestedDecision:'allow_task'},{canReuseTask:false,suggestedDecision:'allow_task'},{}]){
    current={...question,...hints};value={authorizationQuestions:[current],approvals:[{approvalId:question.sourceApprovalId,state:'pending'}]};
    const report={};await approveConversationQuestions({panel},{database:f.file,allowed:[question.toolName],report,
      validate:async(_,binding)=>assert.deepEqual(binding.arguments,args)});
    assert.equal(report.questions[0].decision,hints.canReuseTask===true?'allow_task':'allow_once');
  }
  assert.equal(clicks,3);assert.equal(fronts,3);
  value={authorizationQuestions:[],approvals:[{approvalId:'unlinked',state:'pending'}]};
  await assert.rejects(approveConversationQuestions({panel},{database:f.file,allowed:[],report:{},validate:()=>{}}),/legacy approval/);
  assert.equal(clicks,3);
});
test('weather read validation rejects changed city or date instead of creating a synthetic change',()=>{
  const query={location:'北京',locationQuery:'Beijing',date:'2026-10-22',units:'metric'};
  const watch={id:'synthetic-watch',origin:{taskId:'synthetic-origin'},configurationRef:'synthetic-config',input:{query}};
  for(const changed of [{...query,location:'上海'},{...query,date:'2026-10-23'}]){
    const row={result:{record:{source:'open-meteo'},cache:{state:'fetched',fetchedAt:'2026-10-22T10:00:00Z'},forecast:{units:'metric',temperatureMin:10,temperatureMax:20}},
      watch:{watchId:watch.id,source:'weather',sequence:0,origin:watch.origin,configurationRef:watch.configurationRef},intent:{arguments:changed}};
    assert.throws(()=>validateWatchRead({},row,watch,'2026-10-22T09:00:00Z'),{code:'ERR_ASSERTION'});
  }
});
test('independent persisted device readback requires delivered time and exports no private notification text',()=>{
  const cache=path.resolve(__dirname,'../../../.cache');fs.mkdirSync(cache,{recursive:true});
  const userData=fs.mkdtempSync(path.join(cache,'notification-readback-synthetic-')),file=path.join(userData,'desktop-notifications.json');
  const round='synthetic-round',id='notification-round-'+createHash('sha256').update(JSON.stringify(round)).digest('hex');
  const record={id,state:'persisted',title:'SYNTHETIC_PRIVATE',body:'SYNTHETIC_PRIVATE'};
  const save=()=>fs.writeFileSync(file,JSON.stringify({version:1,records:[record]}));save();assert.equal(readDeviceDelivery(userData,round),undefined);
  record.state='delivered';record.deliveredAt='2026-10-22T10:00:00Z';save();
  const receipt=readDeviceDelivery(userData,round);assert.equal(receipt.deliveryState,'delivered');assert.equal(receipt.userRead,false);
  assert.equal(receipt.physicalHumanView,'not_observed');assert.doesNotMatch(JSON.stringify(receipt),/SYNTHETIC_PRIVATE|title|body/);
  assert.equal(readDeviceDelivery(userData,'other-round'),undefined);
});
test('failed acceptance retains only runner frame coordinates, never assertion values or private contents',()=>{
  assert.deepEqual(failureFrames({stack:'Error: SYNTHETIC_PRIVATE\n at fn (D:/safe/tests/manual/connectors/desktop-weather-watch-live.cjs:123:4)\n at secret (C:/private.js:2:3)'}),
    [{file:'desktop-weather-watch-live.cjs',line:123,column:4}]);
});
