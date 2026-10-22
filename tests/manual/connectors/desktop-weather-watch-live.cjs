/* Explicit real acceptance: default Desktop UI -> AgentArts -> original child,
 * Scheduler/Policy/ToolGateway -> Open-Meteo. No Fake ports or direct cloud call.
 * Beijing is a public test location and says nothing about the user's location.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {_electron}=require('playwright');
const {approveQuestions}=require('./desktop-authorization-live.cjs');
const root=path.resolve(__dirname,'../../..'),desktop=path.join(root,'apps/desktop');
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hashValue=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal=state=>['succeeded','failed','cancelled'].includes(state);
const query={location:'北京',locationQuery:'Beijing',units:'metric'};
const intervalMs=15_000;

function regular(file){assert.ok(file&&path.isAbsolute(file));const info=fs.lstatSync(file);
  assert.ok(info.isFile()&&!info.isSymbolicLink(),'explicit input must be a regular file');return fs.realpathSync.native(file);}
async function wait(check,deadline,label){while(Date.now()<deadline){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,200));}
  throw Error(label+' did not reach its required original deadline');}
async function snapshot(page){let timer;try{const reply=await Promise.race([page.evaluate(()=>window.desktop.invoke('snapshot')),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Original renderer snapshot unavailable')),10_000);})]);assert.equal(reply.ok,true);return reply.value;
}finally{clearTimeout(timer);}}
async function pageFor(app,mode){return wait(()=>app.windows().find(page=>page.url().includes('mode='+mode)),Date.now()+30_000,mode+' window');}
async function close(app){let timer;try{await Promise.race([app.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Isolated Desktop close timeout')),10_000);})]);}
  catch{await app.evaluate(({app})=>app.exit(1)).catch(()=>{});}finally{clearTimeout(timer);}}
async function capture(app,file){let timer;try{const encoded=await Promise.race([app.evaluate(async({BrowserWindow})=>{
  const window=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes('mode=panel'));
  if(!window)throw Error('Original panel unavailable');return (await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64');
}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Original renderer capture timeout')),10_000);})]);fs.writeFileSync(file,Buffer.from(encoded,'base64'));
}finally{clearTimeout(timer);}}
function databaseRead(database,read){const db=new DatabaseSync(database,{readOnly:true});try{return read(db);}finally{db.close();}}
function checkpoint(db,taskId,key){const row=db.prepare('SELECT value_json FROM task_checkpoints WHERE task_id=? AND checkpoint_key=?').get(taskId,key);return row?JSON.parse(row.value_json):undefined;}
function audit(database){return databaseRead(database,db=>{
  const tasks=db.prepare('SELECT task_id,conversation_id,state,error_json,cancel_requested FROM tasks').all().map(row=>({taskId:row.task_id,
    conversationId:row.conversation_id,state:row.state,errorCode:row.error_json?JSON.parse(row.error_json).code:undefined,cancelRequested:Boolean(row.cancel_requested)}));
  const records=db.prepare('SELECT record_json FROM tool_execution_records').all().map(row=>JSON.parse(row.record_json));
  const hosts=db.prepare("SELECT value_json FROM trusted_host_state WHERE namespace='desktop-connector-watches'").all();
  const watches=hosts.flatMap(row=>Object.values(JSON.parse(row.value_json).value?.watches??{}));
  const schedules=db.prepare("SELECT schedule_id,conversation_id,status,task_id,run_at FROM task_schedules WHERE conversation_id LIKE 'connector-watch:%'").all()
    .map(row=>({...row,admission:row.task_id?checkpoint(db,row.task_id,'connector-watch-wake-admission'):undefined}));
  const changes=db.prepare("SELECT value_json FROM trusted_host_state WHERE namespace='desktop-connector-changes'").all().map(row=>JSON.parse(row.value_json).value);
  const observation={baselineCount:changes.reduce((sum,value)=>sum+Object.keys(value?.sources??{}).length,0),
    weatherEvents:changes.flatMap(value=>Object.values(value?.events??{})).filter(item=>item.kind==='weather.changed').map(item=>({id:item.id,state:item.state}))};
  const clouds=tasks.flatMap(task=>(checkpoint(db,task.taskId,'competition-cloud-request-identity')?.requests??[]).map(value=>({taskId:task.taskId,
    requestId:value.requestId,sessionId:value.sessionId,payloadDigest:value.payloadDigest,revision:value.revision,
    recordedAt:value.recordedAt,attempts:value.attempts})));
  const catalogs=tasks.map(task=>({taskId:task.taskId,entries:checkpoint(db,task.taskId,'competition-tool-catalog')?.entries??[]}));
  const reads=records.filter(row=>row.toolName==='weather.forecast').map(row=>({taskId:row.taskId,runId:row.evidenceId,state:row.state,
    policyDecision:row.policyDecision,executionStarted:row.executionStarted,startedAt:row.startedAt,finishedAt:row.finishedAt,
    watch:checkpoint(db,row.taskId,'desktop-connector-watch-origin'),
    preparation:checkpoint(db,row.taskId,'host-tool-preparation'),intent:checkpoint(db,row.taskId,'host-tool-intent'),
    grant:(()=>{const saved=db.prepare('SELECT value_json FROM authorization_grants WHERE authorization_ref=?').get('host-tool-'+row.taskId);
      return saved?JSON.parse(saved.value_json):undefined;})(),
    result:checkpoint(db,row.taskId,'tool-result-'+row.evidenceId)?.result}));
  return {tasks,records,watches,schedules,clouds,catalogs,reads,observation};
});}
function publicAudit(value){return {tasks:value.tasks,records:value.records.map(row=>({taskId:row.taskId,toolName:row.toolName,toolVersion:row.toolVersion,
  state:row.state,policyDecision:row.policyDecision,executionStarted:row.executionStarted,evidenceId:row.evidenceId,errorCode:row.errorCode})),
  catalogs:value.catalogs.map(row=>({taskId:row.taskId,count:row.entries.length,tools:row.entries.map(tool=>tool.name)})),cloudRequests:value.clouds,
  observation:value.observation,
  watches:value.watches.map(row=>({watchId:row.id,source:row.source,enabled:row.enabled,state:row.state,intervalMs:row.input.intervalMs,
    expiresAt:row.input.expiresAt,conversationId:row.conversationId,originTaskId:row.origin.taskId,sequence:row.sequence})),schedules:value.schedules,
  weatherReads:value.reads.map(row=>({taskId:row.taskId,runId:row.runId,state:row.state,policyDecision:row.policyDecision,executionStarted:row.executionStarted,
    watchId:row.watch?.watchId,sequence:row.watch?.sequence,startedAt:row.startedAt,finishedAt:row.finishedAt,
    queryDigest:row.watch?.queryDigest,commandId:row.preparation?.commandId,arguments:row.intent?.arguments,
    authorization:row.grant?{authorizationRef:row.grant.authorizationRef,taskId:row.grant.taskId,toolName:row.grant.toolName,
      scopes:row.grant.scopes,argumentsDigest:row.grant.argumentsDigest,expiresAt:row.grant.expiresAt,usesRemaining:row.grant.usesRemaining}:undefined,
    provider:row.result?.record?.source,cache:row.result?.cache,
    forecast:row.result?.forecast?{location:row.result.forecast.location,date:row.result.forecast.date,units:row.result.forecast.units,
      temperatureMin:row.result.forecast.temperatureMin,temperatureMax:row.result.forecast.temperatureMax,
      precipitationProbability:row.result.forecast.precipitationProbability}:undefined}))};}
function acceptedReads(value,watchId){return value.reads.filter(row=>row.state==='confirmed'&&row.policyDecision==='allow'&&row.executionStarted
  &&(!watchId||row.watch?.watchId===watchId));}
function validatePublicRead(row,startedAt){assert.equal(row.result?.record?.source,'open-meteo','original public provider must identify Open-Meteo');
  assert.ok(['fetched','fresh'].includes(row.result?.cache?.state),'stale/failed weather cannot pass');
  assert.ok(Date.parse(row.result.cache.fetchedAt)>=Date.parse(startedAt),'weather receipt must be fetched in this isolated run');
  assert.equal(row.result.forecast.units,'metric');assert.ok(Number.isFinite(row.result.forecast.temperatureMin));
  assert.ok(Number.isFinite(row.result.forecast.temperatureMax));
  const resolved=row.result.forecast.resolved;if(resolved){assert.ok(Math.abs(resolved.latitude-39.9)<1);assert.ok(Math.abs(resolved.longitude-116.4)<1);}}
function validateWatchRead(value,row,watch,startedAt){
  validatePublicRead(row,startedAt);assert.equal(row.watch?.watchId,watch.id);assert.equal(row.watch.source,'weather');
  assert.ok(Number.isSafeInteger(row.watch.sequence)&&row.watch.sequence>=0);
  assert.deepEqual(row.watch.origin,watch.origin);assert.equal(row.watch.configurationRef,watch.configurationRef);
  assert.deepEqual(row.watch.readTool,watch.readTool);assert.deepEqual(row.intent?.arguments,watch.input.query);
  assert.equal(row.intent.argumentsDigest,row.watch.queryDigest);
  assert.equal(row.preparation?.namespace,row.watch.namespace);assert.equal(row.preparation.toolName,watch.readTool.name);
  assert.equal(row.preparation.toolVersion,watch.readTool.version);
  assert.equal(row.preparation?.commandId,'connector-watch-'+hashValue([watch.id,row.watch.sequence,'read']));
  assert.deepEqual(row.intent,{...row.preparation,arguments:watch.input.query,argumentsDigest:row.watch.queryDigest});
  const grant=row.grant;assert.ok(grant,'original single-use grant remains available for readback');
  assert.equal(grant.authorizationRef,'host-tool-'+row.taskId);assert.equal(grant.taskId,row.taskId);
  assert.equal(grant.toolName,watch.readTool.name);assert.equal(grant.argumentsDigest,row.watch.queryDigest);
  assert.equal(grant.expiresAt,row.preparation.deadline);assert.equal(grant.usesRemaining,0,'one-use grant must have been consumed');
  assert.deepEqual(grant.scopes,['weather:read']);assert.ok(Date.parse(grant.expiresAt)<=Date.parse(watch.input.expiresAt));
  assert.equal(value.records.filter(record=>record.taskId===row.taskId).length,1,'each scheduled read owns one original execution');
  const schedule=value.schedules.find(item=>item.schedule_id==='connector-watch-'+hashValue([watch.id,row.watch.sequence]));
  assert.ok(schedule&&schedule.status==='fired'&&schedule.task_id,'read must bind its exact original fired Scheduler admission');
  assert.equal(schedule.conversation_id,'connector-watch:'+row.watch.namespace+':'+watch.id);
  assert.equal(schedule.admission?.scheduleId,schedule.schedule_id);assert.equal(schedule.admission.taskId,schedule.task_id);
  assert.equal(schedule.admission.deadline,watch.input.expiresAt);
  assert.equal(value.tasks.find(task=>task.taskId===schedule.task_id)?.state,'succeeded');
  return schedule;
}
async function launch(executablePath,userData,report){
  const env={...process.env,ELECTRON_RUN_AS_NODE:undefined};for(const key of Object.keys(env))if(key.startsWith('PA_'))delete env[key];
  env.PA_RUNTIME_PROFILE='huawei_ict_agentarts';env.PA_DESKTOP_TEST_USER_DATA=userData;
  const app=await _electron.launch({executablePath,args:[desktop,'--pa-public-weather-watch-acceptance='+path.basename(path.dirname(userData))],env});
  try{await app.firstWindow();const orb=await pageFor(app,'orb');const opened=await orb.evaluate(()=>window.desktop.invoke('orb.open'));assert.equal(opened.ok,true);
    const panel=await pageFor(app,'panel');await panel.waitForSelector('#send');const value=await snapshot(panel);
    assert.equal(value.fake,false);assert.equal(value.fakeModel,false);assert.equal(value.agentArts?.configured,true,'original encrypted config must load');
    assert.notEqual(value.laya?.ready,true,'this runner must not start another local Laya process');
    report.launches=(report.launches??0)+1;report.target={configured:true,deploymentVersion:value.agentArts.deploymentVersion,
      transport:value.agentArts.effectiveTransport??'unknown',platformVersionReadback:'not_run'};return {app,panel};
  }catch(error){await close(app);throw error;}
}
// Unified questions live only in their original conversation, never in settings.
async function approveConversationQuestions(session,options){
  const value=await snapshot(session.panel);
  assert.ok(!(value.approvals??[]).some(item=>item.state==='pending'
    &&!(value.authorizationQuestions??[]).some(question=>question.sourceApprovalId===item.approvalId)),
  'a legacy approval cannot replace the original unified question');
  if((value.authorizationQuestions??[]).some(question=>question.state==='pending'))await session.panel.bringToFront();
  await approveQuestions({...options,page:session.panel,value});
  return value;
}
async function submit(session,database,goal,allowed,expected,report,persist){
  await session.panel.locator('textarea[aria-label="任务内容"]').fill(goal);await session.panel.locator('#send').click();
  const task=await wait(async()=>{const value=await snapshot(session.panel);return value.tasks.find(item=>item.userMessage===goal||item.goal===goal);},Date.now()+30_000,'original main submission');
  const deadline=databaseRead(database,db=>Date.parse(checkpoint(db,task.taskId,'application-deadline')));assert.ok(Number.isFinite(deadline));
  report.turns.push({taskId:task.taskId,purpose:expected.purpose,deadline:new Date(deadline).toISOString()});persist();
  await wait(async()=>{
    const value=await snapshot(session.panel),state=value.tasks.find(item=>item.taskId===task.taskId);
    if(state?.state==='waiting_reconciliation')throw Error('Original task requires reconciliation; no resubmission is allowed');
    if(terminal(state?.state)){assert.equal(state.state,'succeeded','original main task must succeed');return state;}
    await approveConversationQuestions(session,{database,allowed,report,persist,validate(question,binding){
      if(expected.authorizeAdditional?.(question,binding)===true)return;
      assert.ok(question.taskId===task.taskId||binding.parent?.parentTaskId===task.taskId,'question belongs to this original main/child');
      if(question.toolName!=='subagent.dispatch')assert.deepEqual(binding.arguments,expected.arguments,
        'question must bind exact public query/watch/stop parameters');
    }});
    return undefined;
  },deadline+15_000,'original default task terminal');
  const value=audit(database),children=databaseRead(database,db=>value.tasks.filter(item=>checkpoint(db,item.taskId,'subtask-parent')?.parentTaskId===task.taskId));
  assert.ok(children.length>0,'default production main must create an original child');assert.ok(children.every(item=>item.state==='succeeded'),'original children must succeed');
  assert.ok(value.records.some(row=>row.taskId===task.taskId&&row.toolName==='subagent.dispatch'&&row.state==='confirmed'&&row.policyDecision==='allow'));
  assert.ok(children.some(child=>value.clouds.some(item=>item.taskId===child.taskId)),'original delegated AgentArts request identity must persist');
  assert.ok(children.some(child=>value.catalogs.find(item=>item.taskId===child.taskId)?.entries.some(item=>item.name===expected.toolName)),
    'the original default child catalog must actually publish the requested capability');
  assert.ok(value.catalogs.every(item=>item.entries.length<=64));
  const records=value.records.filter(row=>children.some(child=>child.taskId===row.taskId)&&row.toolName===expected.toolName);
  assert.ok(records.some(row=>row.state==='confirmed'&&row.policyDecision==='allow'&&row.executionStarted),'the actual requested tool must confirm locally');
  report.persistence=publicAudit(value);persist();return task.taskId;
}
async function main(){
  assert.equal(process.env.PA_MANUAL_DESKTOP_WEATHER_WATCH_LIVE,'1','explicit real public weather/Desktop cloud opt-in required');
  assert.equal(process.platform,'win32');const executablePath=regular(process.env.PA_WEATHER_ELECTRON),source=process.env.PA_WEATHER_SAVED_CONFIG_DIR;
  assert.ok(source&&path.isAbsolute(source),'explicit approved encrypted configuration directory required');
  const cache=path.join(root,'.cache');fs.mkdirSync(cache,{recursive:true});const output=fs.mkdtempSync(path.join(cache,'desktop-weather-watch-live-'));
  const userData=path.join(output,'user-data');fs.mkdirSync(userData);for(const name of ['agentarts-config.json','Local State'])
    fs.copyFileSync(regular(path.join(source,name)),path.join(userData,name));
  assert.deepEqual(fs.readdirSync(userData).sort(),['Local State','agentarts-config.json'],'copy only encrypted AgentArts configuration and encryption state');
  const report={schemaVersion:1,kind:'real_default_desktop_public_weather_watch',profile:'huawei_ict_agentarts',startedAt:new Date().toISOString(),
    status:'in_progress',stage:'launch',location:{query,testLocation:true,userLocation:false},intervalMs,turns:[],approvals:[],
    configurationCopy:{files:['agentarts-config.json','Local State'],mail:'not_copied',history:'not_copied'},
    source:{mainSha256:sha(path.join(desktop,'electron/main.js')),watchHostSha256:sha(path.join(desktop,'electron/connector-watch-host.js')),
      publicProviderHostSha256:sha(path.join(desktop,'electron/public-connector-host.js')),runnerSha256:sha(__filename)},
    fakeRuntime:false,fakeModel:false,fakeProvider:false,layaStartup:'not_requested',significantChange:'not_run',realChangeNotification:'not_run',
    limitations:['not a platform trace/API readback','not physical human approval clicks','no mailbox/private history copied or read','no forced weather or Laya selection']};
  const receipt=path.join(output,'receipt.json'),database=path.join(userData,'runtime.sqlite'),persist=()=>fs.writeFileSync(receipt,JSON.stringify(report,null,2)+'\n');
  let session;persist();console.log(JSON.stringify({status:'started',output}));
  try{
    session=await launch(executablePath,userData,report);
    report.stage='query-real-public-weather';persist();
    await submit(session,database,'这是公开天气连接器验收，北京/Beijing只是测试地点，不代表用户位置。请使用目录内真实weather.forecast查询北京今天的天气，精确参数为'+JSON.stringify(query)+'。请实际读取并依据返回结果回答，不创建订阅，不猜天气。',
      ['subagent.dispatch','weather.forecast'],{purpose:'public_weather_query',toolName:'weather.forecast',arguments:query},report,persist);
    const queryRead=acceptedReads(audit(database)).find(row=>!row.watch);assert.ok(queryRead);validatePublicRead(queryRead,report.startedAt);
    const watchInput={source:'weather',query,intervalMs,expiresAt:new Date(Date.now()+10*60_000).toISOString()};report.expiresAt=watchInput.expiresAt;
    report.stage='start-exact-public-weather-watch';persist();
    await submit(session,database,'继续本次公开天气验收。请实际调用当前目录的connector.watch.start，严格使用以下完整参数：'+JSON.stringify(watchInput)
      +'。这是北京测试地点，每15秒只读检查，明确在expiresAt停止；允许本机原Scheduler继续这些精确读取。变化交原Laya判断是否告知。不要启动模型、修改天气数据、邮箱或其他资源，不再追问，执行成功后简短确认。',
      ['subagent.dispatch','connector.watch.start'],{purpose:'start_explicit_weather_watch',toolName:'connector.watch.start',arguments:watchInput},report,persist);
    let value=audit(database);assert.equal(value.watches.length,1);const watch=value.watches[0];report.watchId=watch.id;
    assert.deepEqual(watch.input,watchInput);assert.equal(watch.enabled,true);
    report.stage='observe-two-original-scheduler-reads';persist();
    await wait(()=>{value=audit(database);return acceptedReads(value,watch.id).length>=2;},Date.parse(watchInput.expiresAt),'two original Scheduler reads');
    for(const row of acceptedReads(value,watch.id))validateWatchRead(value,row,watch,report.startedAt);
    assert.ok(value.schedules.filter(row=>row.status==='fired'&&row.conversation_id.endsWith(':'+watch.id)).length>=2);
    assert.ok(new Set(acceptedReads(value,watch.id).map(row=>row.watch.sequence)).size>=2);
    report.confirmedSchedulerReads=acceptedReads(value,watch.id).length;report.persistence=publicAudit(value);persist();
    await capture(session.app,path.join(output,'weather-watch-before-restart.png'));await close(session.app);session=undefined;
    const beforeRestart=audit(database),oldReads=beforeRestart.reads.filter(row=>row.watch?.watchId===watch.id),
      previousTaskIds=new Set(oldReads.map(row=>row.taskId)),previousMaxSequence=Math.max(...oldReads.map(row=>row.watch.sequence));
    report.restart={startedAt:new Date().toISOString(),beforeReadTaskIds:[...previousTaskIds],beforeMaxSequence:previousMaxSequence,
      beforeFrozenInput:beforeRestart.watches.find(item=>item.id===watch.id)?.input};
    report.stage='restart-original-persistent-watch';persist();session=await launch(executablePath,userData,report);
    const restored=await wait(async()=>{await snapshot(session.panel);return audit(database).watches.find(item=>item.id===watch.id&&item.enabled);},
      Date.now()+30_000,'persisted original watch');
    assert.deepEqual(restored.input,watchInput);assert.deepEqual(restored.origin,watch.origin);
    assert.equal(restored.configurationRef,watch.configurationRef);
    report.watchSurvivedDesktopRestart=true;
    report.stage='observe-new-original-scheduler-read-after-restart';persist();
    const resumedRead=await wait(()=>{value=audit(database);return acceptedReads(value,watch.id).find(row=>!previousTaskIds.has(row.taskId)
      &&row.watch.sequence>previousMaxSequence&&Date.parse(row.startedAt)>=Date.parse(report.restart.startedAt));},
      Date.parse(watchInput.expiresAt),'new original Scheduler read after Desktop restart');
    const resumedSchedule=validateWatchRead(value,resumedRead,restored,report.startedAt);
    report.restart={...report.restart,confirmedNewReadTaskId:resumedRead.taskId,confirmedNewReadRunId:resumedRead.runId,
      confirmedNewSequence:resumedRead.watch.sequence,confirmedNewStartedAt:resumedRead.startedAt,
      firedScheduleId:resumedSchedule.schedule_id,admissionTaskId:resumedSchedule.task_id,
      frozenParametersMatch:true,singleUseGrantConsumed:true,originalSchedulerReadAfterRestart:true};
    report.confirmedSchedulerReads=acceptedReads(value,watch.id).length;report.persistence=publicAudit(value);persist();
    await capture(session.app,path.join(output,'weather-watch-resumed-read.png'));
    report.stage='stop-through-default-main-ui';persist();
    await submit(session,database,'停止本次公开天气验收订阅。请实际调用当前目录connector.watch.stop，精确参数为'+JSON.stringify({watchId:watch.id})
      +'，仅停止这个已存在订阅，不创建或重启其他订阅。成功后简短确认。',
      ['subagent.dispatch','connector.watch.stop'],{purpose:'stop_original_watch',toolName:'connector.watch.stop',arguments:{watchId:watch.id}},report,persist);
    const stopped=audit(database);assert.equal(stopped.watches.find(item=>item.id===watch.id).enabled,false);
    const count=stopped.reads.filter(item=>item.watch?.watchId===watch.id).length;report.stage='verify-no-post-stop-read';persist();
    await new Promise(resolve=>setTimeout(resolve,intervalMs+2000));value=audit(database);
    assert.equal(value.reads.filter(item=>item.watch?.watchId===watch.id).length,count,'stopped watch cannot submit another read');
    const state=await snapshot(session.panel),changes=state.proactive?.connectorChanges;
    assert.equal(changes?.available,true,'the production change observer must be assembled');
    assert.ok(value.observation.baselineCount>=2,'original one-shot and watch observations must persist separate source responsibilities');
    report.significantChange=value.observation.weatherEvents.length?'observed_see_original_receipts':'no_significant_change';
    report.realChangeNotification='not_verified';report.stop={persistedEnabled:false,observedForMs:intervalMs+2000,noFurtherRead:true};
    report.persistence=publicAudit(value);await capture(session.app,path.join(output,'weather-watch-stopped.png'));
    await close(session.app);session=undefined;report.stage='read-only-persistence-after-close';report.persistence=publicAudit(audit(database));
    report.status='passed_real_default_desktop_public_weather_watch';report.stage='complete';
  }catch(error){report.status='failed';report.failure={stage:report.stage,code:error?.code??'ACCEPTANCE_FAILED',
    message:String(error?.message??'Acceptance failed').replace(/[A-Z]:[\\/][^\n]+/gi,'[local path]').slice(0,400)};
    if(session){try{await capture(session.app,path.join(output,'weather-watch-failed.png'));}catch{}await close(session.app);session=undefined;}
    if(fs.existsSync(database)){try{report.persistence=publicAudit(audit(database));}catch{}}
    process.exitCode=1;
  }finally{report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({status:report.status,stage:report.stage,watchId:report.watchId,receipt}));}
}
module.exports={audit,publicAudit,validatePublicRead,validateWatchRead,submit,launch,snapshot,pageFor,close,capture,wait,approveConversationQuestions};
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({status:'preflight_failed',code:error?.code??'PRECONDITION_FAILED',
  message:String(error?.message??'Acceptance prerequisites unavailable').replace(/[A-Z]:[\\/][^\n]+/gi,'[local path]').slice(0,300)}));process.exitCode=1;});
