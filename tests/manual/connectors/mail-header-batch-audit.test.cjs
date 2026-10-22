const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createManifest,validateManifest,labels}=require('./mail-header-batch-fixture.cjs');
const {authorizationMode,readCohortBindings,projectCohort,canFinishCohort,cohortCaseForEvent,hash}=require('./mail-header-batch-audit.cjs');
const {readCohortAudit}=require('./desktop-change-notification-live.cjs');
const manifest=require('./mail-header-batch-20261022.manifest.json');
const baselineReadyAt='2026-10-22T05:00:00.000Z',finishedAt='2026-10-22T05:00:05.000Z';
const privateText='SYNTHETIC_PRIVATE_MAIL_HEADER_NOT_FOR_EXPORT';
function fixture(t){
  const directory=path.resolve(__dirname,'../../../.cache');fs.mkdirSync(directory,{recursive:true});
  const userData=fs.mkdtempSync(path.join(directory,'mail-header-audit-fixture-')),database=path.join(userData,'runtime.sqlite');
  const db=new DatabaseSync(database);t.after(()=>db.close());
  db.exec('CREATE TABLE tasks(task_id TEXT,state TEXT,goal TEXT); CREATE TABLE tool_execution_records(record_json TEXT);'
    +'CREATE TABLE task_checkpoints(task_id TEXT,checkpoint_key TEXT,value_json TEXT)');
  const checkpoint=(task,key,value)=>db.prepare('INSERT INTO task_checkpoints VALUES(?,?,?)').run(task,key,JSON.stringify(value));
  const items=manifest.cases.map(sample=>({source:'mail',accountRef:'desktop-qq-inbox',externalId:'INBOX:'+sample.caseIndex,
    dedupeKey:'synthetic-dedupe-'+sample.caseIndex,sensitivity:'private',occurredAt:finishedAt,fetchedAt:finishedAt,
    contentRef:`${privateText}@example.invalid → private-recipient@example.invalid｜未读｜${sample.subject}`}));
  const unrelated={...items[0],externalId:'INBOX:999',dedupeKey:'private-only',contentRef:privateText,
    body:manifest.cases[0].subject,analyses:{projection:{text:privateText}}};
  for(const [index,page] of [[0,[...items.slice(0,99),unrelated]],[1,items.slice(99)]]){
    const task='source-'+index,run='source-run-'+index;
    db.prepare('INSERT INTO tasks VALUES(?,?,?)').run(task,'succeeded',privateText);
    db.prepare('INSERT INTO tool_execution_records VALUES(?)').run(JSON.stringify({taskId:task,evidenceId:run,toolName:'mail.inbox',
      state:'confirmed',policyDecision:'allow',executionStarted:true,finishedAt,privateText}));
    checkpoint(task,'desktop-connector-watch-origin',{watchId:'original-watch'});
    checkpoint(task,'tool-result-'+run,{result:{account:'desktop-qq-inbox',folder:'INBOX',items:page,hasMore:index===0,privateText}});
  }
  const observed=readCohortBindings(db,{manifest,watchId:'original-watch',baselineReadyAt});
  const state={version:2,records:{},latest:{},heads:{},observed:{},analyses:{private:{projection:{text:privateText}}},cursors:{}};
  for(const binding of observed.bindings){
    const sample=manifest.cases[binding.caseIndex-1],key=hash([binding.messageId,binding.sourceRevision]);
    state.records[key]={messageId:binding.messageId,sourceRevision:binding.sourceRevision,mailboxId:hash(['desktop-qq-inbox','INBOX']),
      sensitivity:'private',headersOnly:true,label:sample.expectedLabel==='other'?null:sample.expectedLabel,
      route:sample.expectedLabel==='other'?'review':sample.expectedLabel==='meeting'?'main_agent':'group',
      receiptId:hash(['receipt',sample.caseIndex]),classifierFingerprint:hash('classifier'),privateText};
    state.latest[binding.messageId]=key;state.observed[key]=true;
    state.heads[binding.messageId]={sourceRevision:binding.sourceRevision,fetchedAt:finishedAt};
  }
  return {db,userData,database,checkpoint,items,state,observed};
}
test('canonical public fixture contains 120 unique cases, six classes and no recipients or tool instructions',()=>{
  validateManifest(manifest);assert.deepEqual(manifest,createManifest(manifest.cohortId));
  assert.equal(new Set(manifest.cases.map(item=>item.subject)).size,120);
  for(const label of labels)assert.equal(manifest.cases.filter(item=>item.expectedLabel===label).length,20);
  assert.doesNotMatch(JSON.stringify(manifest),/@|https?:|mail\.send|connector\.watch|ignore (?:all|previous) instructions/iu);
  assert.throws(()=>validateManifest({...manifest,total:100}));
  assert.throws(()=>validateManifest({...manifest,cases:[{...manifest.cases[0],body:privateText},...manifest.cases.slice(1)]}));
});
test('existing public mode remains explicit; approved local header mode does not claim a public-only inbox',()=>{
  assert.equal(authorizationMode({PA_CHANGE_PUBLIC_MAILBOX_ONLY:'1'}),'public_only_inbox');
  assert.equal(authorizationMode({PA_CHANGE_MAIL_AUTHORIZATION_MODE:'approved_local_header_batch',PA_CHANGE_APPROVED_LOCAL_HEADER_BATCH:'1'}),
    'approved_local_header_batch');
  for(const env of [{},{PA_CHANGE_APPROVED_LOCAL_HEADER_BATCH:'1'},{PA_CHANGE_MAIL_AUTHORIZATION_MODE:'approved_local_header_batch'},
    {PA_CHANGE_MAIL_AUTHORIZATION_MODE:'allow_everything',PA_CHANGE_PUBLIC_MAILBOX_ONLY:'1'}])
    assert.throws(()=>authorizationMode(env),{code:'MAIL_HEADER_AUTHORIZATION_REQUIRED'});
});
test('all 120 confirmed headers exceed the 100-item page bound and keep null/review labels honest',t=>{
  const f=fixture(t);assert.equal(f.observed.bindings.length,120);assert.equal(f.observed.confirmedPages,2);
  const projected=projectCohort(manifest,f.observed,[f.state],{baselineReadyAt,now:Date.parse(baselineReadyAt)+10_000});
  assert.equal(projected.summary.allReceived,true);assert.equal(projected.summary.allClassified,true);
  assert.equal(projected.summary.pageBoundaryCovered,true);assert.equal(projected.summary.reviewCount,20);
  assert.equal(projected.summary.labelAgreementCount,100);assert.equal(projected.summary.confusionMatrix.other.unlabeled,20);
  assert.equal(projected.summary.throughput.classifiedPerSecond,12);
  assert.ok(projected.rows.every(row=>Object.keys(row).sort().join(',')==='actualLabel,caseIndex,expectedLabel,receiptId,route'));
  assert.doesNotMatch(JSON.stringify(projected),new RegExp(privateText+'|example.invalid|contentRef|dedupeKey|messageId|sourceRevision|analyses|accountRef|namespace'));
  assert.equal(canFinishCohort({...projected,summary:{...projected.summary,allReceived:false}},{}),false);
  assert.equal(canFinishCohort({...projected,summary:{...projected.summary,allClassified:false}},{}),false);
  assert.equal(canFinishCohort(projected,undefined),false);assert.equal(canFinishCohort(projected,{}),true);
});
test('pending or stale derived receipts never become fabricated classifications; namespace ambiguity fails',t=>{
  const f=fixture(t),first=f.observed.bindings[0];delete f.state.latest[first.messageId];
  const audit=projectCohort(manifest,f.observed,[f.state],{baselineReadyAt,now:Date.parse(finishedAt)});
  assert.equal(audit.summary.classifiedCount,119);assert.equal(audit.rows[0].receiptId,null);
  assert.equal(audit.summary.allClassified,false);
  assert.throws(()=>projectCohort(manifest,f.observed,[f.state,f.state],{baselineReadyAt}),{code:'MAIL_DERIVED_NAMESPACE_AMBIGUOUS'});
});
test('unknown source results and duplicate real deliveries stop the cohort without replay',t=>{
  const f=fixture(t);f.db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('waiting_reconciliation','source-0');
  assert.throws(()=>readCohortBindings(f.db,{manifest,watchId:'original-watch',baselineReadyAt}),{code:'MAIL_RESULT_UNKNOWN'});
  f.db.prepare('UPDATE tasks SET state=? WHERE task_id=?').run('succeeded','source-0');
  const row=f.db.prepare('SELECT value_json FROM task_checkpoints WHERE task_id=? AND checkpoint_key=?').get('source-1','tool-result-source-run-1');
  const value=JSON.parse(row.value_json);value.result.items.push({...f.items[0],externalId:'INBOX:9999'});
  f.db.prepare('UPDATE task_checkpoints SET value_json=? WHERE task_id=? AND checkpoint_key=?')
    .run(JSON.stringify(value),'source-1','tool-result-source-run-1');
  assert.throws(()=>readCohortBindings(f.db,{manifest,watchId:'original-watch',baselineReadyAt}),{code:'MAIL_COHORT_DUPLICATE_DELIVERY'});
});
test('notification matching binds the exact public cohort item in its original confirmed page',t=>{
  const f=fixture(t),item=f.items[0],event={origin:{taskId:'source-0',runId:'source-run-0'},entity:hash(item.dedupeKey),
    revision:hash([item.dedupeKey,item.occurredAt])};
  assert.equal(cohortCaseForEvent(f.db,event,manifest),1);
  assert.equal(cohortCaseForEvent(f.db,{...event,entity:hash('private-only')},manifest),undefined);
});
test('original encrypted module storage is read locally with no writes or private projection',async t=>{
  const f=fixture(t),namespace='fixture-host:qq-inbox:synthetic-private@example.invalid';
  // The key formula is taken from Runtime inbox-triage; no actual account/config is read.
  const key='inbox-triage:v1:'+hash([namespace,{fixture:'Fixture only'},['meeting']]);
  const plaintext=JSON.stringify({[key]:f.state,unrelated:{analyses:{text:privateText}}});
  const metadata=path.join(f.userData,'mail-classification.json');
  fs.writeFileSync(metadata,JSON.stringify({version:1,encrypted:Buffer.from(plaintext).toString('base64')}));
  const before=fs.readFileSync(metadata),databaseBefore=fs.readFileSync(f.database);let decryptCalls=0;
  const fakeSafeStorage={isEncryptionAvailable:()=>true,decryptString(bytes){decryptCalls++;return bytes.toString();},
    encryptString(){assert.fail('read-only audit cannot encrypt/save');}};
  const app={evaluate:(callback,input)=>callback({safeStorage:fakeSafeStorage},input)};
  const audit=await readCohortAudit(app,{database:f.database,userData:f.userData,manifest,watchId:'original-watch',baselineReadyAt});
  assert.equal(audit.summary.classifiedCount,120);assert.equal(decryptCalls,1);
  assert.deepEqual(fs.readFileSync(metadata),before);assert.deepEqual(fs.readFileSync(f.database),databaseBefore);
  assert.doesNotMatch(JSON.stringify(audit),new RegExp(privateText+'|example.invalid|namespace|analyses'));
});
