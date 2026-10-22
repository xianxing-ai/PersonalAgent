/* Real source -> original watch/Runtime -> local Laya -> original conversation ->
 * native show receipt. No synthetic source, forced selection, send-mail operation,
 * direct grant, private configuration read or private result projection. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {_electron}=require('playwright');
const {databaseRead,checkpoint}=require('./desktop-authorization-live.cjs');
const {snapshot,pageFor,close,wait,submit,approveConversationQuestions}=require('./desktop-weather-watch-live.cjs');
const {openSettings,settingsNavigationState}=require('../agentarts/desktop-pelican-default-live.cjs');
const {validateManifest}=require('./mail-header-batch-fixture.cjs');
const {authorizationMode,readCohortBindings,canFinishCohort,cohortCaseForEvent}=require('./mail-header-batch-audit.cjs');
const root=path.resolve(__dirname,'../../..'),desktop=path.join(root,'apps/desktop');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const choiceReasons=new Set(['selected','high_risk','uncertain','insufficient_candidates','invalid_response','unavailable',
  'cancelled','deadline','candidate_expired']);
const required=['real_source_baseline','real_source_change','original_local_laya_decision',
  'original_main_conversation','original_native_show_receipt','stop_fences_future_reads','closed_sqlite_readback'];
const cohortRequired=['cohort_all_received','cohort_all_classified','cohort_over_100','cohort_label_agreement'];
function changeAudit(database,{manifest}={}){return databaseRead(database,db=>{
  const states=namespace=>db.prepare('SELECT value_json FROM trusted_host_state WHERE namespace=?').all(namespace)
    .map(row=>{const saved=JSON.parse(row.value_json);return saved._paAtomicStateVersion===1?saved.value:saved;});
  const tasks=new Map(db.prepare('SELECT task_id,conversation_id,state,evidence_refs_json FROM tasks').all()
    .map(row=>[row.task_id,{taskId:row.task_id,conversationId:row.conversation_id,state:row.state,
      evidenceRefs:JSON.parse(row.evidence_refs_json)}]));
  const changes=states('desktop-connector-changes'),notification=states('device-notifications');
  const rounds=notification.flatMap(state=>Object.values(state.interruption?.rounds??{}));
  const records=db.prepare('SELECT record_json FROM tool_execution_records').all().map(row=>JSON.parse(row.record_json));
  const events=changes.flatMap(state=>Object.values(state.events??{})).map(event=>{
    const decision=event.decisionTaskId?checkpoint(db,event.decisionTaskId,'connector-change-decision'):undefined;
    const origin=records.find(record=>record.taskId===event.origin.taskId&&record.evidenceId===event.origin.runId);
    const round=rounds.find(item=>item.itemIds.includes(event.id));
    return {id:event.id,kind:event.kind,state:event.state,observedAt:event.observedAt,
      ...(manifest?{cohortCaseIndex:cohortCaseForEvent(db,event,manifest)}:{}),
      sourceTaskId:event.origin.taskId,sourceRunId:event.origin.runId,
      sourceWatch:checkpoint(db,event.origin.taskId,'desktop-connector-watch-origin')?.watchId,
      sourceExecution:origin?{toolName:origin.toolName,state:origin.state,policyDecision:origin.policyDecision,
        executionStarted:origin.executionStarted}:undefined,
      decisionTask:tasks.get(event.decisionTaskId),decision:decision?{action:decision.action,
        reason:choiceReasons.has(decision.reason)?decision.reason:'unknown',
        receiptId:decision.receiptId,decidedAt:decision.decidedAt,deadline:decision.deadline,calibrated:decision.calibrated}:undefined,
      batchId:event.notificationBatchId,round:round?{roundId:round.roundId,batchIds:round.batchIds,itemIds:round.itemIds,
        counted:round.counted,reason:round.reason,banner:round.attempts.banner?{state:round.attempts.banner.state,
          evidenceRefs:round.attempts.banner.evidenceRefs,observedAt:round.attempts.banner.observedAt}:undefined}:undefined};
  });
  return {baseline:changes.flatMap(state=>Object.values(state.sources??{})).map(source=>({kind:source.kind,initialized:source.initialized===true})),
    events,watches:states('desktop-connector-watches').flatMap(state=>Object.values(state.watches??{})).map(watch=>({
      watchId:watch.id,source:watch.source,enabled:watch.enabled,state:watch.state,sequence:watch.sequence,
      conversationId:watch.conversationId,originTaskId:watch.origin.taskId,expiresAt:watch.input.expiresAt})),
    completeBaselineReads:records.filter(record=>['mail.inbox','weather.forecast'].includes(record.toolName)
      &&record.state==='confirmed'&&record.policyDecision==='allow'&&record.executionStarted===true).flatMap(record=>{
      const origin=checkpoint(db,record.taskId,'desktop-connector-watch-origin');
      const result=checkpoint(db,record.taskId,'tool-result-'+record.evidenceId)?.result;
      if(!origin?.watchId||origin.source!==record.toolName.split('.')[0]||!result)return [];
      const complete=record.toolName==='mail.inbox'?result.account==='desktop-qq-inbox'&&result.folder==='INBOX'
        &&Array.isArray(result.items)&&result.hasMore===false:result.record?.source==='open-meteo'
          &&['fetched','fresh'].includes(result.cache?.state)&&!result.cache?.lastError;
      return complete?[{watchId:origin.watchId,source:record.toolName.split('.')[0],taskId:record.taskId,
        runId:record.evidenceId,sequence:origin.sequence,finishedAt:record.finishedAt}]:[];
    }),readCount:records.filter(record=>['mail.inbox','weather.forecast'].includes(record.toolName)).length};
});}
function completeBaselineReady(audit,source,watchId){
  const watch=audit.watches.find(item=>item.watchId===watchId&&item.source===source&&item.enabled);
  // The original watch advances only after the complete read/classification
  // session. A final page receipt alone can still be waiting for local Laya.
  return Boolean(watch&&audit.baseline.some(item=>item.kind===source&&(source!=='mail'||item.initialized))
    &&audit.completeBaselineReads.some(item=>item.watchId===watchId&&item.source===source
      &&Number.isSafeInteger(item.sequence)&&item.sequence>=0&&watch.sequence>item.sequence
      &&Number.isFinite(Date.parse(item.finishedAt))));
}
function completedNotification(manifest,cohort,delivered){return manifest
  ?cohort&&canFinishCohort(cohort,delivered)?delivered:undefined:delivered;}
async function readCohortAudit(app,{database,userData,manifest,watchId,baselineReadyAt}){
  const observed=databaseRead(database,db=>readCohortBindings(db,{manifest,watchId,baselineReadyAt}));
  // This callback runs in the original Electron host. Only the derived allowlist
  // crosses back to the driver; the account-bound storage namespace stays local.
  return app.evaluate(async({safeStorage},input)=>{
    const {createRequire}=await import('node:module'),{pathToFileURL}=await import('node:url');
    const require=createRequire(input.auditModule),{projectCohort}=require(input.auditModule);
    const {createMailMetadataStorage}=await import(pathToFileURL(input.storageModule).href);
    let keys=[];
    const readOnlySafeStorage={isEncryptionAvailable:()=>safeStorage.isEncryptionAvailable(),
      decryptString(ciphertext){
        const plaintext=safeStorage.decryptString(ciphertext);
        keys=Object.keys(JSON.parse(plaintext)).filter(key=>/^inbox-triage:v1:[a-f0-9]{64}$/.test(key));
        if(keys.length>32)throw Error('MAIL_DERIVED_NAMESPACE_AMBIGUOUS');
        return plaintext;
      },encryptString(){throw Error('MAIL_AUDIT_READ_ONLY');}};
    const storage=createMailMetadataStorage({userData:input.userData,safeStorage:readOnlySafeStorage});
    return projectCohort(input.manifest,input.observed,keys.map(key=>storage.get(key)),
      {baselineReadyAt:input.baselineReadyAt});
  },{userData,manifest,observed,baselineReadyAt,
    storageModule:path.join(desktop,'electron','mail-metadata-storage.js'),auditModule:path.join(__dirname,'mail-header-batch-audit.cjs')});
}
async function adminPage(session,page){
  if(page==='connections')return openSettings(session,page);
  assert.equal(page,'notifications','only declared acceptance settings may be opened');
  const entry={requested:page,state:'pending'};
  if(session.report)(session.report.settingsNavigation??=[]).push(entry);
  let admin;
  try{
    // notifications is a sidebar page; the original host accepts settings first.
    const opened=await session.panel.evaluate(()=>window.desktop.invoke('admin.open',{page:'settings'}));
    assert.equal(opened.ok,true);admin=await pageFor(session.app,'admin');
    const host=(await snapshot(admin)).adminNavigation;
    assert.ok(Number.isSafeInteger(host?.revision)&&host.revision>=0,'original navigation revision is required');
    entry.host={page:host.page,revision:host.revision};
    await admin.waitForFunction(revision=>Number(document.querySelector('.main')?.dataset.navigationRevision)>=revision
      &&document.querySelector('.main')?.getAttribute('aria-busy')==='false',host.revision);
    const nav=admin.locator('.side [data-page="notifications"]');await nav.waitFor({state:'visible'});
    if(await nav.getAttribute('aria-current')!=='page')await nav.click();
    await admin.waitForFunction(revision=>{
      const main=document.querySelector('.main');
      return main?.dataset.section==='notifications'&&main.getAttribute('aria-busy')==='false'
        &&Number(main.dataset.navigationRevision)>=revision&&document.querySelector('#content')?.dataset.section==='notifications'
        &&document.querySelector('.side [data-page="notifications"]')?.getAttribute('aria-current')==='page';
    },host.revision);
    await admin.locator('[data-notifications="form"]').waitFor({state:'visible'});
    entry.observed=await settingsNavigationState(admin);entry.state='ready';return admin;
  }catch(error){entry.state='failed';if(admin)entry.observed=await settingsNavigationState(admin).catch(()=>({state:'unavailable'}));throw error;}
}
function validateMailPage(question,binding,{database,watchId,expiresAt}){
  if(question.toolName!=='mail.inbox')return false;
  assert.ok(binding.watch&&(!watchId||binding.watch.watchId===watchId),'only the original watch may request a mail page');
  const watch=changeAudit(database).watches.find(item=>item.watchId===binding.watch.watchId);
  assert.ok(watch?.enabled&&watch.source==='mail'&&watch.expiresAt===expiresAt);
  assert.equal(binding.arguments.account,'desktop-qq-inbox');assert.equal(binding.arguments.folder,'INBOX');
  assert.equal(binding.arguments.limit,100,'original local batch page size is explicit');
  assert.ok(Object.keys(binding.arguments).every(key=>['account','folder','limit','cursor'].includes(key)));
  assert.ok(question.requirements.some(item=>item.requirementId==='mail-local-batch'&&item.kind==='connector_session'));
  assert.ok(question.requirements.every(item=>item.kind!=='export'),'local watch pages cannot grant cloud export');
  assert.ok(Date.parse(binding.anchor.deadline)<=Date.parse(expiresAt));return true;
}
async function configureNotifications(session,database,policy,report,persist,expiresAt){
  const admin=await adminPage(session,'notifications'),section=admin.locator('.notification-settings');
  const form=section.locator('form');await form.locator('[name="scope"]').selectOption('global');
  await section.locator('[data-notifications="load"]').click();
  await wait(async()=>{const value=(await snapshot(admin)).notificationCenter;return value?.available?value:undefined;},
    Date.parse(expiresAt),'original notification policy read');
  await form.locator('[name="mode"]').selectOption(policy.mode);
  await form.locator('[name="window"]').fill(String(policy.windowMinutes));
  await form.locator('[name="unlimited"]').setChecked(policy.maxInterruptions===null);
  await form.locator('[name="maximum"]').fill(policy.maxInterruptions===null?'':String(policy.maxInterruptions));
  await form.locator('[name="until"]').fill('');await form.locator('[name="channel"]').selectOption(policy.preferredChannel);
  await form.locator('[name="urgent"]').setChecked(policy.allowUrgentBreakthrough);
  await form.locator('[name="digest"]').selectOption(policy.digestMode);
  for(const name of ['quietStart','quietEnd','timezone'])await form.locator(`[name="${name}"]`).fill('');
  await form.locator('button[type="submit"]').click();
  await wait(async()=>{const value=await snapshot(admin);
    await approveConversationQuestions(session,{database,allowed:['notifications.interruption_policy.set'],report,persist,
      validate(question,binding){assert.deepEqual(binding.arguments.scope,{kind:'global'});assert.deepEqual(binding.arguments.patch,policy);}});
    return value.notificationCenter?.policy?.state==='configured'
      &&isDeepStrictEqual(value.notificationCenter.policy.effective,policy);
  },Date.parse(expiresAt),'original notification policy confirmation');
  report.notificationPolicy={configured:true,source:'original_settings_and_unified_card',policy};persist();
}
async function main(){
  assert.equal(process.env.PA_MANUAL_CHANGE_NOTIFICATION_LIVE,'1','explicit real change/notification opt-in required');
  assert.equal(process.platform,'win32');
  const source=process.env.PA_CHANGE_SOURCE,expiresAt=process.env.PA_CHANGE_WATCH_EXPIRES_AT,
    intervalMs=Number(process.env.PA_CHANGE_WATCH_INTERVAL_MS),configuration=process.env.PA_CHANGE_SAVED_CONFIG_DIR,
    executablePath=process.env.PA_CHANGE_ELECTRON,provenance=process.env.PA_CHANGE_EVENT_PROVENANCE;
  assert.ok(['mail','weather'].includes(source));assert.ok(Date.parse(expiresAt)>Date.now());
  assert.ok(Number.isSafeInteger(intervalMs)&&intervalMs>=1000&&intervalMs<=2147483647);
  assert.ok(path.isAbsolute(configuration??'')&&path.isAbsolute(executablePath??''));
  assert.ok(provenance==='natural'||source==='mail'&&provenance==='controlled_public_mail');
  const mailAuthorizationMode=source==='mail'?authorizationMode(process.env):undefined;
  let manifest;
  if(source==='mail'&&process.env.PA_CHANGE_MAIL_BATCH_MANIFEST){
    const file=process.env.PA_CHANGE_MAIL_BATCH_MANIFEST;assert.ok(path.isAbsolute(file));
    const info=fs.lstatSync(file);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.size<=262144);
    manifest=validateManifest(JSON.parse(fs.readFileSync(file,'utf8')));
  }
  if(mailAuthorizationMode==='approved_local_header_batch')assert.ok(manifest,'approved local header batch requires its public cohort manifest');
  const policy=JSON.parse(process.env.PA_CHANGE_NOTIFICATION_POLICY_JSON??'null');
  assert.ok(policy&&policy.mode==='normal'&&policy.preferredChannel==='banner'&&policy.silentUntilUtc===null&&policy.quietHours===null,
    'explicit isolated notification policy is required; existing user policies are never disabled');
  assert.deepEqual(Object.keys(policy).sort(),['mode','maxInterruptions','windowMinutes','silentUntilUtc','preferredChannel',
    'allowUrgentBreakthrough','digestMode','quietHours'].sort(),'complete exact notification policy required');
  assert.ok(Number.isFinite(policy.windowMinutes)&&policy.windowMinutes>0);
  assert.ok(policy.maxInterruptions===null||Number.isSafeInteger(policy.maxInterruptions)&&policy.maxInterruptions>=0);
  assert.equal(typeof policy.allowUrgentBreakthrough,'boolean');assert.ok(['on_return','on_demand','scheduled'].includes(policy.digestMode));
  const query=source==='weather'?JSON.parse(process.env.PA_CHANGE_WEATHER_QUERY_JSON??'null'):undefined;
  if(source==='weather')assert.ok(query&&typeof query.location==='string'&&query.location,'explicit public test location required');
  const cache=path.join(root,'.cache');fs.mkdirSync(cache,{recursive:true});
  const output=fs.mkdtempSync(path.join(cache,'desktop-change-notification-live-')),userData=path.join(output,'user-data');fs.mkdirSync(userData);
  const copied=['agentarts-config.json','Local State',...(source==='mail'?['mail-config.json']:[])];
  for(const name of copied)fs.copyFileSync(path.join(configuration,name),path.join(userData,name));
  const database=path.join(userData,'runtime.sqlite'),receipt=path.join(output,'receipt.json');
  const report={kind:'real_desktop_source_change_notification',profile:'huawei_ict_agentarts',source,provenance,
    provenanceAttestation:'operator_declared_real_source_event',
    status:'in_progress',stage:'launch',startedAt:new Date().toISOString(),expiresAt,intervalMs,turns:[],questions:[],
    checks:Object.fromEntries([...required,...(manifest?cohortRequired:[])].map(key=>[key,'not_run'])),fakeRuntime:false,fakeProvider:false,fakeModel:false,
    ...(mailAuthorizationMode?{mailAuthorizationMode}:{}),
    privacy:{configuration:'encrypted_copy_only',historyCopied:false,publicHeaderInboxDeclared:mailAuthorizationMode==='public_only_inbox',
      mailBodyRead:false,mailWrite:false,publicReceiptPrivateContent:false},physicalHumanClick:false,physicalHumanView:'not_run'};
  const persist=()=>fs.writeFileSync(receipt,JSON.stringify(report,null,2)+'\n');let session,interrupted=false;persist();
  const interrupt=()=>{interrupted=true;if(session)void close(session.app).catch(()=>{});};
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  console.log(JSON.stringify({status:'started',output,source,provenance}));
  try{
    const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^PA_/i.test(name)));
    Object.assign(env,{ELECTRON_RUN_AS_NODE:undefined,PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_DESKTOP_TEST_USER_DATA:userData});
    const app=await _electron.launch({executablePath,args:[desktop,'--pa-change-notification-acceptance='+path.basename(output)],env});
    session={app,report};await app.firstWindow();const orb=await pageFor(app,'orb');await orb.evaluate(()=>window.desktop.invoke('orb.open'));
    session.panel=await pageFor(app,'panel');const initial=await snapshot(session.panel);
    assert.equal(initial.fake,false);assert.equal(initial.fakeModel,false);assert.equal(initial.agentArts?.configured,true);
    report.stage='start-original-local-laya';persist();const admin=await adminPage(session,'connections');
    if(source==='mail'){assert.equal((await snapshot(admin)).mail.configured,true);assert.equal((await snapshot(admin)).mail.requiresRestart,false);
      assert.equal((await snapshot(admin)).mail.cloudAnalysisAllowed,false,'local header processing cannot enable cloud analysis');}
    if((await snapshot(admin)).laya?.ready!==true)await admin.locator('[data-laya="start"]').click();
    report.laya=await wait(async()=>{const value=(await snapshot(admin)).laya;
      if(['unavailable','memory_insufficient','error','stop_unconfirmed','identity_changed'].includes(value?.state))throw Error('Original local Laya startup refused');
      return value?.ready?{state:value.state,ready:true,calibrated:value.calibrated}:undefined;
    },Date.parse(expiresAt),'original Laya startup');persist();
    report.stage='configure-original-notification-policy';persist();
    await configureNotifications(session,database,policy,report,persist,expiresAt);
    const input={source,...(query?{query}:{}),intervalMs,expiresAt},extra=(question,binding)=>validateMailPage(question,binding,{database,expiresAt});
    report.stage='start-exact-watch';persist();
    await submit(session,database,'本次真实变化提醒验收。请实际调用当前目录connector.watch.start，严格参数为'+JSON.stringify(input)
      +'。只按原Scheduler读取；新来源变化交本机Laya自主判断是否提醒。不要伪造来源、强制notify、发送邮件或修改任何业务资源。',
      ['subagent.dispatch','connector.watch.start',...(source==='mail'?['mail.inbox']:[])],
      {purpose:'start_exact_real_change_watch',toolName:'connector.watch.start',arguments:input,authorizeAdditional:extra},report,persist);
    const watch=changeAudit(database).watches.find(item=>item.enabled&&item.source===source);assert.ok(watch);report.watchId=watch.watchId;
    const approveMail=async()=>{assert.equal(interrupted,false,'manual acceptance was interrupted');if(source!=='mail')return;const value=await snapshot(session.panel);
      assert.equal(value.mail.cloudAnalysisAllowed,false,'private inbox headers must remain local');
      await approveConversationQuestions(session,{database,allowed:['mail.inbox'],report,persist,
        validate:(question,binding)=>validateMailPage(question,binding,{database,watchId:watch.watchId,expiresAt})});};
    report.stage='wait-original-complete-baseline';persist();
    await wait(async()=>{await approveMail();const audit=changeAudit(database);report.persistence=audit;persist();
      return completeBaselineReady(audit,source,watch.watchId);
    },Date.parse(expiresAt),'original complete source baseline');report.checks.real_source_baseline='passed';
    report.baselineReadyAt=new Date().toISOString();report.stage='wait-real-source-change';persist();
    console.log(JSON.stringify({status:'baseline_ready',source,provenance,watchId:watch.watchId,
      ...(manifest?{cohortId:manifest.cohortId,expectedCount:manifest.total}:{}),
      externalInput:source==='mail'?'user_or_authorized_sender_must_create_new_public_test_mail':'wait_for_natural_significant_same_location_weather_change'}));
    let deliveredEvent,lastCohortRead=0;
    const delivered=await wait(async()=>{await approveMail();const audit=changeAudit(database,{manifest});report.persistence=audit;
      const events=audit.events.filter(item=>item.sourceWatch===watch.watchId&&Date.parse(item.observedAt)>=Date.parse(report.baselineReadyAt));
      const relevant=manifest?events.filter(item=>Number.isSafeInteger(item.cohortCaseIndex)):events;
      if(relevant.length)report.checks.real_source_change='passed';
      for(const event of relevant){assert.equal(event.sourceExecution?.state,'confirmed');assert.equal(event.sourceExecution.policyDecision,'allow');
        assert.equal(event.sourceExecution.executionStarted,true);
        if(event.decisionTask?.state==='succeeded'&&event.decision?.receiptId){report.checks.original_local_laya_decision='passed';}
        if(event.decisionTask?.state!=='succeeded'||event.decision?.action!=='notify')continue;
        assert.ok(event.decision.receiptId,'actual local decision must retain its receipt');
        const panelState=await snapshot(session.panel),projected=panelState.tasks.find(item=>item.taskId===event.decisionTask.taskId);
        const originalConversation=projected?.state==='succeeded'&&event.decisionTask.conversationId===watch.conversationId;
        if(originalConversation)
          report.checks.original_main_conversation='passed';
        if(!event.round?.roundId)continue;
        const evidence='desktop-notification:notification-round-'+hash(event.round.roundId)+':show';
        if(originalConversation&&event.state==='delivered'
          &&event.round.banner?.state==='delivered'&&event.round.banner.evidenceRefs.includes(evidence)){
          report.checks.original_native_show_receipt='passed';deliveredEvent??=event;
        }
      }
      if(manifest){
        if(Date.now()-lastCohortRead>=1000){
          report.cohort=await readCohortAudit(session.app,{database,userData,manifest,watchId:watch.watchId,baselineReadyAt:report.baselineReadyAt});
          lastCohortRead=Date.now();
          report.checks.cohort_all_received=report.cohort.summary.allReceived?'passed':'not_satisfied';
          report.checks.cohort_all_classified=report.cohort.summary.allClassified?'passed':'not_satisfied';
          report.checks.cohort_over_100=report.cohort.summary.pageBoundaryCovered?'passed':'not_satisfied';
          report.checks.cohort_label_agreement=!report.cohort.summary.allClassified?'not_satisfied':
            report.cohort.summary.mismatchCount===0&&report.cohort.summary.reviewCount===0?'passed':'review_required';
        }
        persist();return completedNotification(manifest,report.cohort,deliveredEvent);
      }
      persist();return deliveredEvent;
    },Date.parse(expiresAt),'real source event, autonomous Laya notify and original native show');
    assert.equal(report.checks.original_main_conversation,'passed');report.deliveredEventId=delivered.id;
    report.stage='stop-exact-original-watch';persist();
    await submit(session,database,'停止本次验收的原订阅。请实际调用connector.watch.stop，精确参数为'+JSON.stringify({watchId:watch.watchId})+'，不要新建或重启订阅。',
      ['subagent.dispatch','connector.watch.stop',...(source==='mail'?['mail.inbox']:[])],
      {purpose:'stop_original_change_watch',toolName:'connector.watch.stop',arguments:{watchId:watch.watchId},authorizeAdditional:extra},report,persist);
    const stopped=changeAudit(database);assert.equal(stopped.watches.find(item=>item.watchId===watch.watchId).enabled,false);
    await new Promise(resolve=>setTimeout(resolve,intervalMs+2000));assert.equal(changeAudit(database).readCount,stopped.readCount);
    report.checks.stop_fences_future_reads='passed';await close(session.app);session=undefined;
    report.persistence=changeAudit(database);assert.equal(report.persistence.events.find(item=>item.id===delivered.id).state,'delivered');
    report.checks.closed_sqlite_readback='passed';
    if(manifest){
      assert.equal(report.cohort.summary.allReceived,true);assert.equal(report.cohort.summary.allClassified,true);
      if(report.checks.cohort_label_agreement!=='passed'){
        report.status='completed_with_classification_review';report.stage='complete_with_review';process.exitCode=1;return;
      }
    }
    assert.ok(Object.values(report.checks).every(value=>value==='passed'));
    report.status='passed_real_source_laya_conversation_native_show';report.stage='complete';
  }catch(error){report.status='failed';report.failure={stage:report.stage,code:error?.code??'REQUIRED_REAL_ACCEPTANCE_NOT_SATISFIED'};
    for(const key of Object.keys(report.checks))if(!['passed','review_required'].includes(report.checks[key]))report.checks[key]='not_satisfied';
    process.exitCode=1;
  }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
    if(session)await close(session.app);if(fs.existsSync(database))try{report.persistence=changeAudit(database,{manifest});}catch{}
    report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({status:report.status,stage:report.stage,receipt}));}
}
module.exports={changeAudit,validateMailPage,readCohortAudit,adminPage,completeBaselineReady,completedNotification};
if(require.main===module)main().catch(()=>{console.error('Real source/notification acceptance prerequisites unavailable; no private data printed.');process.exitCode=1;});
