// Local-only audit of original confirmed tool receipts and encrypted derived records.
// No mailbox API, model API, sender, storage writes or raw content projection.
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {labels,validateManifest}=require('./mail-header-batch-fixture.cjs');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=code=>{const error=Error(code);error.code=code;throw error;};
const checkpoint=(db,task,key)=>{const row=db.prepare('SELECT value_json FROM task_checkpoints WHERE task_id=? AND checkpoint_key=?')
  .get(task,key);return row?JSON.parse(row.value_json):undefined;};
function authorizationMode(env){
  const mode=env.PA_CHANGE_MAIL_AUTHORIZATION_MODE??(env.PA_CHANGE_PUBLIC_MAILBOX_ONLY==='1'?'public_only_inbox':undefined);
  if(mode==='public_only_inbox'&&env.PA_CHANGE_PUBLIC_MAILBOX_ONLY==='1')return mode;
  if(mode==='approved_local_header_batch'&&env.PA_CHANGE_APPROVED_LOCAL_HEADER_BATCH==='1')return mode;
  return fail('MAIL_HEADER_AUTHORIZATION_REQUIRED');
}
function caseIndexForItem(manifest,item){
  if(typeof item?.contentRef!=='string')return undefined;
  const subject=item.contentRef.slice(item.contentRef.lastIndexOf('｜')+1).replace(/（无 Date 头，取抓取时刻）$/u,'');
  return manifest.cases.find(sample=>sample.subject===subject)?.caseIndex;
}
function cohortCaseForEvent(db,event,manifest){
  const result=checkpoint(db,event.origin.taskId,'tool-result-'+event.origin.runId)?.result;
  if(result?.account!=='desktop-qq-inbox'||result.folder!=='INBOX'||!Array.isArray(result.items))return undefined;
  const item=result.items.find(item=>hash(item.dedupeKey)===event.entity&&hash([item.dedupeKey,item.occurredAt])===event.revision);
  return caseIndexForItem(manifest,item);
}
function readCohortBindings(db,{manifest,watchId,baselineReadyAt}){
  validateManifest(manifest);assert.ok(typeof watchId==='string'&&watchId);
  const baseline=Date.parse(baselineReadyAt);assert.ok(Number.isFinite(baseline));
  const found=new Map(),pages=new Set();
  for(const row of db.prepare('SELECT record_json FROM tool_execution_records').all()){
    const record=JSON.parse(row.record_json);
    if(record.toolName!=='mail.inbox'||checkpoint(db,record.taskId,'desktop-connector-watch-origin')?.watchId!==watchId)continue;
    const task=db.prepare('SELECT state FROM tasks WHERE task_id=?').get(record.taskId);
    if(task?.state==='waiting_reconciliation'||record.state==='unknown')fail('MAIL_RESULT_UNKNOWN');
    if(checkpoint(db,record.taskId,'private-copy-erasure')!==undefined
      ||checkpoint(db,record.taskId,'private-copy-erasure-binding')!==undefined)fail('MAIL_PRIVATE_COPY_ERASED');
    if(record.state!=='confirmed'||record.policyDecision!=='allow'||record.executionStarted!==true)continue;
    const finished=Date.parse(record.finishedAt);if(!Number.isFinite(finished)||finished<baseline)continue;
    const result=checkpoint(db,record.taskId,'tool-result-'+record.evidenceId)?.result;
    if(result?.account!=='desktop-qq-inbox'||result.folder!=='INBOX'||!Array.isArray(result.items)||result.items.length>100)
      fail('MAIL_CONFIRMED_SCOPE_MISMATCH');
    for(const item of result.items){
      // MailService.messageToItem appends the subject after the final full-width separator.
      // Discard both address fields locally; never return the original contentRef.
      const caseIndex=caseIndexForItem(manifest,item);if(caseIndex===undefined)continue;
      if(item.source!=='mail'||item.sensitivity!=='private'||item.accountRef!==result.account
        ||typeof item.externalId!=='string'||!item.externalId.startsWith('INBOX:')||typeof item.dedupeKey!=='string'
        ||!Number.isFinite(Date.parse(item.fetchedAt))||!Number.isFinite(Date.parse(item.occurredAt)))fail('MAIL_COHORT_ITEM_INVALID');
      const messageId=hash([result.account,result.folder,item.externalId,item.dedupeKey]);
      const sourceRevision=hash([item.dedupeKey,item.contentRef,item.occurredAt===item.fetchedAt?null:item.occurredAt]);
      const prior=found.get(caseIndex);
      if(prior&&prior.messageId!==messageId)fail('MAIL_COHORT_DUPLICATE_DELIVERY');
      if(!prior||finished>=prior.finished)found.set(caseIndex,{caseIndex,messageId,sourceRevision,finished});
      pages.add(record.evidenceId);
    }
  }
  return {bindings:[...found.values()].map(({finished,...value})=>value),confirmedPages:pages.size};
}
function projectCohort(manifest,observed,states,{baselineReadyAt,now=Date.now()}={}){
  validateManifest(manifest);const bindings=new Map(observed.bindings.map(item=>[item.caseIndex,item]));
  const matrix=Object.fromEntries(labels.map(label=>[label,Object.fromEntries([...labels,'unlabeled','pending'].map(actual=>[actual,0]))]));
  const rows=manifest.cases.map(sample=>{
    const binding=bindings.get(sample.caseIndex),matches=[];
    if(binding)for(const state of states){
      if(state?.version!==2)continue;
      const key=hash([binding.messageId,binding.sourceRevision]),row=state.records?.[key];
      if(!row||state.latest?.[binding.messageId]!==key||state.heads?.[binding.messageId]?.sourceRevision!==binding.sourceRevision)continue;
      if(row.messageId!==binding.messageId||row.sourceRevision!==binding.sourceRevision
        ||row.mailboxId!==hash(['desktop-qq-inbox','INBOX'])||row.sensitivity!=='private'||row.headersOnly!==true
        ||!sha(row.receiptId)||!sha(row.classifierFingerprint)||state.observed?.[key]!==true
        ||row.label!==null&&!labels.includes(row.label)||!['group','review','main_agent'].includes(row.route))fail('MAIL_DERIVED_RECEIPT_INVALID');
      matches.push({actualLabel:row.label,route:row.route,receiptId:row.receiptId});
    }
    if(matches.length>1)fail('MAIL_DERIVED_NAMESPACE_AMBIGUOUS');
    const value=matches[0]??{actualLabel:null,route:null,receiptId:null};
    matrix[sample.expectedLabel][value.receiptId?(value.actualLabel??'unlabeled'):'pending']++;
    return {caseIndex:sample.caseIndex,expectedLabel:sample.expectedLabel,...value};
  });
  const classified=rows.filter(row=>row.receiptId!==null),received=bindings.size;
  const reviewCount=classified.filter(row=>row.route==='review'||row.actualLabel===null).length;
  const labelAgreementCount=classified.filter(row=>row.actualLabel===row.expectedLabel).length;
  const elapsedMs=Math.max(0,now-Date.parse(baselineReadyAt));
  return {cohortId:manifest.cohortId,rows,summary:{expectedCount:120,receivedCount:received,classifiedCount:classified.length,
    confirmedPages:observed.confirmedPages,pageBoundaryCovered:received>100&&observed.confirmedPages>=2,
    allReceived:received===120,allClassified:classified.length===120,reviewCount,labelAgreementCount,
    mismatchCount:classified.length-labelAgreementCount,labelAgreementRate:labelAgreementCount/120,confusionMatrix:matrix,
    throughput:{scope:'observed_mail_receipt_and_local_classification_wall_time',elapsedMs,
      receivedPerSecond:elapsedMs>0?received*1000/elapsedMs:null,classifiedPerSecond:elapsedMs>0?classified.length*1000/elapsedMs:null}}};
}
function canFinishCohort(audit,delivered){return audit.summary.allReceived&&audit.summary.allClassified
  &&audit.summary.pageBoundaryCovered&&delivered!==undefined;}
module.exports={authorizationMode,readCohortBindings,projectCohort,canFinishCohort,cohortCaseForEvent,hash};
