/* Real, operator-started Radicale -> production Desktop UI -> AgentArts child ->
 * original calendar.update -> independent HTTP GET. Public dedicated fixtures
 * only; this runner never installs/starts a server or opens the formal app. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {snapshot,pageFor,launch,close,wait,submit}=require('./desktop-weather-watch-live.cjs');
const {databaseRead,checkpoint}=require('./desktop-authorization-live.cjs');
const {openSettings}=require('../agentarts/desktop-pelican-default-live.cjs');
const root=path.resolve(__dirname,'../../..');
const principal='pa-public-calendar-test',password='pa-public-calendar-test-only';
const authorization='Basic '+Buffer.from(principal+':'+password).toString('base64');
const hash=value=>createHash('sha256').update(value).digest('hex');
function testCollection(value){
  const url=new URL(value);
  assert.ok(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)
    &&!url.username&&!url.password&&!url.search&&!url.hash,'dedicated loopback HTTP test server required');
  assert.match(url.pathname,new RegExp('^/'+principal+'/[a-z0-9-]{8,80}/$'),'a fresh dedicated test collection is required');
  return url.href;
}
function regular(file){assert.ok(path.isAbsolute(file??''));const info=fs.lstatSync(file);
  assert.ok(info.isFile()&&!info.isSymbolicLink(),'explicit regular input required');return file;}
const stamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function publicIcs(value){return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PersonalAgent//Public CalDAV acceptance//EN',
  'BEGIN:VEVENT','UID:'+value.uid,'DTSTAMP:'+stamp(Date.now()),'DTSTART:'+stamp(value.startUtc),'DTEND:'+stamp(value.endUtc),
  'SUMMARY:'+value.summary,'SEQUENCE:0','END:VEVENT','END:VCALENDAR',''].join('\r\n');}
function calendarUpdateArgs(expected){return{externalId:expected.uid,summary:expected.summary,startUtc:expected.startUtc,endUtc:expected.endUtc};}
function strongEtag(value){assert.ok(typeof value==='string'&&/^"[\x21\x23-\x7e\x80-\xff]*"$/u.test(value),'strong ETag required');return value;}
async function http(method,url,{body,headers={}}={}){
  const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(10_000),
    headers:{Authorization:authorization,...headers},...(body===undefined?{}:{body})});
  const text=await response.text();assert.ok(Buffer.byteLength(text)<=1024*1024,'bounded public calendar response required');
  return{status:response.status,etag:response.headers.get('etag'),text};
}
async function verifyCalendarGet(response,expected,previous){
  assert.equal(response.status,200,'independent GET must read the real resource');strongEtag(response.etag);
  const {parseCalDavEvents}=await import('@personal-agent/calendar'),events=parseCalDavEvents(response.text);
  assert.equal(events.length,1);const event=events[0];assert.equal(event.uid,expected.uid);assert.equal(event.summary,expected.summary);
  assert.equal(event.startMs,Date.parse(expected.startUtc));assert.equal(event.endMs,Date.parse(expected.endUtc));
  if(previous){assert.notEqual(response.etag,previous.etag,'real update must change the strong ETag');
    assert.equal(event.sequence,previous.sequence+1,'one original update must advance the resource once');}
  return{etag:response.etag,sequence:event.sequence,uid:event.uid,summary:event.summary,
    startUtc:new Date(event.startMs).toISOString(),endUtc:new Date(event.endMs).toISOString()};
}
async function selectMode(session,mode){
  const reply=await session.panel.evaluate(()=>window.desktop.invoke('admin.open',{page:'authorizations'}));assert.equal(reply.ok,true);
  const admin=await pageFor(session.app,'admin'),host=(await snapshot(admin)).adminNavigation;
  assert.ok(Number.isSafeInteger(host?.revision));
  await admin.waitForFunction(revision=>{
    const main=document.querySelector('.main');return main?.dataset.section==='authorizations'
      &&Number(main.dataset.navigationRevision)>=revision&&main.getAttribute('aria-busy')==='false'
      &&document.querySelector('#content')?.dataset.section==='authorizations';
  },host.revision);
  const select=admin.locator('[data-authorization-profile]');await select.waitFor({state:'visible'});
  await wait(()=>select.isEnabled(),Date.now()+30_000,'original sandbox profile load');
  const selectedMode=mode==='full-access'?'full-access':'read-only';
  const original=await admin.evaluate(()=>window.desktop.invoke('authorization.sandbox.read'));assert.equal(original.ok,true);
  const profile=original.value.profiles.find(item=>item.available&&item.mode===selectedMode);assert.ok(profile);
  await select.selectOption(profile.ref);
  await wait(async()=>{const value=await admin.evaluate(()=>window.desktop.invoke('authorization.sandbox.read'));
    return value.ok&&value.value.selected.mode===selectedMode&&await select.isEnabled();},Date.now()+30_000,'UI sandbox selection');
  return{mode:selectedMode,selection:'original_settings_ui'};
}
async function configureCalendar(session,url){
  const admin=await openSettings(session,'connections');
  const details=admin.locator('details').filter({has:admin.locator('[data-calendar="save"]')});
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
  for(const [field,value]of Object.entries({name:'Public CalDAV acceptance',url,user:principal,password}))
    await details.locator(`[data-calendar="${field}"]`).fill(value);
  await details.locator('[data-calendar="save"]').click();
  await wait(async()=>{const value=(await snapshot(admin)).calendar;return value?.configured&&value.hasCredentials;},
    Date.now()+30_000,'original encrypted calendar configuration');
}
function verifyCards(mode,questions,history,observed){
  assert.ok(!history.some(item=>item.state==='pending'),'no pending authorization may survive completion');
  assert.equal(observed.remaining,0,'decided cards must be removed from the real DOM');
  if(mode==='full-access'){
    assert.equal(questions.length,0,'Full access must complete without a manual card');
    assert.equal(observed.ids.length,0,'Full access must never render an approval card');
  }
  else{
    assert.ok(questions.length>=1&&questions.length<=2,'restricted mode requires one or two original cards');
    assert.equal(questions.filter(item=>item.toolName==='calendar.update').length,1,'exactly one merged calendar update card required');
    assert.ok(questions.every(item=>['calendar.update','subagent.dispatch'].includes(item.toolName)),
      'only calendar update and optional dispatch cards are permitted');
    assert.ok(questions.filter(item=>item.toolName==='subagent.dispatch').length<=1,'at most one optional dispatch card permitted');
    assert.equal(new Set(questions.map(item=>item.questionId)).size,questions.length,'original question IDs must be unique');
    const update=questions.find(item=>item.toolName==='calendar.update');
    assert.ok(['tool','connector_session','export'].every(kind=>update.requirements.some(item=>item.kind===kind)),
      'calendar execution, configured session and result export must share one original card');
    assert.deepEqual([...observed.ids].sort(),questions.map(item=>item.questionId).sort(),'actual DOM must show precisely the original cards');
  }
  for(const question of questions)assert.ok(history.some(item=>item.questionId===question.questionId&&item.state==='allowed'),
    'decided cards must remain only as allowed snapshot history');
}
const safeAssertions=new Map([
  ['no pending authorization may survive completion','pending_authorization'],
  ['decided cards must be removed from the real DOM','decided_card_still_rendered'],
  ['restricted mode requires one or two original cards','restricted_card_count'],
  ['exactly one merged calendar update card required','calendar_update_card_count'],
  ['only calendar update and optional dispatch cards are permitted','unexpected_card_tool'],
  ['at most one optional dispatch card permitted','duplicate_dispatch_card'],
  ['original question IDs must be unique','duplicate_question_id'],
  ['calendar execution, configured session and result export must share one original card','calendar_requirements_not_merged'],
  ['actual DOM must show precisely the original cards','dom_question_id_mismatch'],
  ['decided cards must remain only as allowed snapshot history','allowed_history_missing'],
  ['Full access must complete without a manual card','full_access_manual_card'],
  ['Full access must never render an approval card','full_access_rendered_card']
]);
function failureDiagnostic(error,stage){
  const assertion=error?.code==='ERR_ASSERTION';
  const firstLine=typeof error?.message==='string'?error.message.split(/\r?\n/u,1)[0]:'';
  const reason=assertion?safeAssertions.get(firstLine):undefined;
  return{stage,code:assertion?'ERR_ASSERTION':'REAL_CALENDAR_ACCEPTANCE_NOT_SATISFIED',
    reason:reason??(assertion?'assertion_failed':'acceptance_failed'),
    message:reason?firstLine:(assertion?'Public calendar acceptance assertion failed':'Public calendar acceptance failed')};
}
function readback(database,parentTaskId,expected){return databaseRead(database,db=>{
  const parent=db.prepare('SELECT task_id,state,evidence_refs_json FROM tasks WHERE task_id=?').get(parentTaskId);assert.equal(parent?.state,'succeeded');
  const children=db.prepare('SELECT task_id,state FROM tasks').all().filter(item=>checkpoint(db,item.task_id,'subtask-parent')?.parentTaskId===parentTaskId);
  assert.ok(children.length>0&&children.every(item=>item.state==='succeeded'),'all original children must finish outside waiting states');
  const ids=new Set(children.map(item=>item.task_id)),records=db.prepare('SELECT record_json FROM tool_execution_records').all()
    .map(row=>JSON.parse(row.record_json)).filter(item=>ids.has(item.taskId)&&item.toolName==='calendar.update');
  assert.equal(records.length,1,'one original calendar update execution required');const record=records[0];
  assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);
  const result=checkpoint(db,record.taskId,'tool-result-'+record.evidenceId)?.result;
  assert.equal(result?.state,'updated');assert.equal(result.item.source,'calendar');assert.equal(result.item.accountRef,'desktop-calendar');
  assert.equal(result.item.externalId,expected.uid);
  assert.equal(result.item.validFor,expected.startUtc+'/'+expected.endUtc);
  assert.ok(JSON.parse(parent.evidence_refs_json).includes(record.evidenceId),'parent must retain original child execution evidence');
  const requests=checkpoint(db,record.taskId,'competition-cloud-request-identity')?.requests??[];
  assert.ok(requests.length>=2,'actual AgentArts initial request and result continuation must persist');
  return{parentTaskId,parentState:parent.state,children:children.map(item=>({taskId:item.task_id,state:item.state})),
    update:{taskId:record.taskId,runId:record.evidenceId,state:record.state,policyDecision:record.policyDecision,executionStarted:true},
    cloudRequests:requests.map(item=>({requestId:item.requestId,revision:item.revision,recordedAt:item.recordedAt}))};
});}
async function main(){
  assert.equal(process.env.PA_MANUAL_DESKTOP_CALENDAR_LIVE,'1','explicit real calendar/Desktop/cloud opt-in required');
  assert.equal(process.platform,'win32');const url=testCollection(process.env.PA_CALENDAR_TEST_URL),mode=process.env.PA_CALENDAR_TEST_MODE??'restricted';
  assert.ok(['restricted','full-access'].includes(mode));
  const saved=process.env.PA_CALENDAR_SAVED_CONFIG_DIR;assert.ok(path.isAbsolute(saved??''));
  const executable=regular(process.env.PA_CALENDAR_ELECTRON??path.join(root,'node_modules/electron/dist/electron.exe'));
  const cache=path.join(root,'.cache');fs.mkdirSync(cache,{recursive:true});const output=fs.mkdtempSync(path.join(cache,'desktop-calendar-update-live-'));
  const userData=path.join(output,'user-data');fs.mkdirSync(userData);
  for(const file of ['agentarts-config.json','Local State'])fs.copyFileSync(regular(path.join(saved,file)),path.join(userData,file));
  assert.deepEqual(fs.readdirSync(userData).sort(),['Local State','agentarts-config.json']);
  const uid='pa-public-'+randomUUID(),start=Math.ceil((Date.now()+86400_000)/60_000)*60_000;
  const before={uid,summary:'Public calendar original '+uid,startUtc:new Date(start).toISOString(),endUtc:new Date(start+3600_000).toISOString()};
  const expected={uid,summary:'Public calendar updated '+uid,startUtc:new Date(start+7200_000).toISOString(),endUtc:new Date(start+10800_000).toISOString()};
  const updateArgs=calendarUpdateArgs(expected);
  const resource=new URL(encodeURIComponent(uid)+'.ics',url).href,database=path.join(userData,'runtime.sqlite'),receipt=path.join(output,'receipt.json');
  const report={kind:'real_radicale_desktop_agentarts_calendar_update',profile:'huawei_ict_agentarts',status:'in_progress',stage:'prepare_real_collection',
    startedAt:new Date().toISOString(),mode,publicFixture:{uid,before,expected},turns:[],questions:[],fakeRuntime:false,fakeProvider:false,fakeModel:false,
    server:{implementation:'operator_started_real_radicale',loopbackOnly:true,collectionDigest:hash(url)},
    privacy:{historyCopied:false,userCalendarConfigured:false,configurationCopy:'encrypted_agentarts_only',publicDedicatedCalendarOnly:true},
    source:{mainSha256:hash(fs.readFileSync(path.join(root,'apps/desktop/electron/main.js'))),runnerSha256:hash(fs.readFileSync(__filename))},
    physicalHumanClick:false,realUserCalendarAcceptance:'not_run'};
  const persist=()=>fs.writeFileSync(receipt,JSON.stringify(report,null,2)+'\n');let session;persist();
  console.log(JSON.stringify({status:'started',mode,output}));
  try{
    const created=await http('MKCALENDAR',url,{body:'<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav"/>',headers:{'Content-Type':'application/xml'}});
    assert.equal(created.status,201,'existing collections are never reused or overwritten');
    const seeded=await http('PUT',resource,{body:publicIcs(before),headers:{'Content-Type':'text/calendar; charset=utf-8','If-None-Match':'*'}});
    assert.equal(seeded.status,201);const original=await verifyCalendarGet(await http('GET',resource),before);report.before={...original,etagDigest:hash(original.etag)};delete report.before.etag;
    report.stage='launch_original_desktop';persist();session=await launch(executable,userData,report);session.report=report;
    report.sandbox=await selectMode(session,mode);await configureCalendar(session,url);
    await session.panel.evaluate(()=>{
      const ids=new Set(),remember=node=>{
        if(node.nodeType!==1)return;
        if(node.matches('[data-question-id]'))ids.add(node.dataset.questionId);
        for(const card of node.querySelectorAll('[data-question-id]'))ids.add(card.dataset.questionId);
      };
      remember(document.body);
      const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)remember(node);});
      observer.observe(document.body,{childList:true,subtree:true});
      globalThis.__paCalendarCardObservation={ids,observer};
    });
    report.stage='original_conversation_calendar_update';persist();
    const parent=await submit(session,database,'公开专用真实日历验收。请实际调用当前目录 calendar.update 修改唯一事件，精确完整参数为'+JSON.stringify(updateArgs)
      +'。此UID只属于公开测试集合；不要创建、取消、修改其他事件，不要伪造工具回执。实际执行完成后简短确认。',
      mode==='full-access'?[]:['subagent.dispatch','calendar.update'],
      {purpose:'public_real_calendar_update',toolName:'calendar.update',arguments:updateArgs},report,persist);
    for(const question of report.questions)await session.panel.locator(`[data-question-id="${question.questionId}"]`).waitFor({state:'detached'});
    const observed=await session.panel.evaluate(()=>{
      const tracker=globalThis.__paCalendarCardObservation;tracker.observer.disconnect();delete globalThis.__paCalendarCardObservation;
      return{ids:[...tracker.ids],remaining:document.querySelectorAll('[data-question-id]').length};
    });
    report.stage='verify_authorization_cards';report.cardObservation=observed;persist();
    const state=await snapshot(session.panel);verifyCards(mode,report.questions,state.authorizationQuestions??[],observed);
    report.cards={count:report.questions.length,pending:0,decidedCardsRemoved:true,allowedSnapshotHistory:true};
    report.cardObservation=observed;
    report.persistence=readback(database,parent,expected);report.stage='independent_http_get_after_update';persist();
    const changed=await verifyCalendarGet(await http('GET',resource),expected,original);
    report.after={...changed,etagDigest:hash(changed.etag)};delete report.after.etag;
    await close(session.app);session=undefined;report.closedReadback=readback(database,parent,expected);
    const closed=await verifyCalendarGet(await http('GET',resource),expected);assert.equal(closed.etag,changed.etag);
    report.independentGet={verified:true,strongEtagChanged:true,sequenceDelta:changed.sequence-original.sequence,stableAfterDesktopClose:true};
    report.status='passed_real_public_radicale_calendar_update';report.stage='complete';
  }catch(error){report.status='failed';report.failure=failureDiagnostic(error,report.stage);process.exitCode=1;
  }finally{if(session)await close(session.app);report.finishedAt=new Date().toISOString();persist();
    console.log(JSON.stringify({status:report.status,stage:report.stage,receipt,publicUid:uid}));}
}
module.exports={testCollection,publicIcs,strongEtag,verifyCalendarGet,verifyCards,readback,calendarUpdateArgs,failureDiagnostic};
if(require.main===module)main().catch(()=>{console.error('Real public CalDAV acceptance prerequisites unavailable; no credentials or private contents printed.');process.exitCode=1;});
