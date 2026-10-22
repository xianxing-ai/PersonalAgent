const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createManifest}=require('./mail-header-batch-fixture.cjs'),{begin,settle,summary}=require('./mail-header-send-ledger.cjs');
function fixture(){
  const cache=path.resolve(__dirname,'../../../.cache');fs.mkdirSync(cache,{recursive:true});
  const directory=fs.mkdtempSync(path.join(cache,'mail-send-synthetic-')),manifest=createManifest(),manifestPath=path.join(directory,'manifest.json'),receiptPath=path.join(directory,'receipt.json');
  const receipt={source:'mail',status:'in_progress',stage:'wait-real-source-change',watchId:'synthetic-watch',mailCohortId:manifest.cohortId,
    baselineReadyAt:'2026-10-22T10:00:00Z',checks:{real_source_baseline:'passed'},privacy:{mailBodyRead:false,mailWrite:false},
    persistence:{baseline:[{kind:'mail',initialized:true}],watches:[{watchId:'synthetic-watch',source:'mail',enabled:true,sequence:1}],
      completeBaselineReads:[{watchId:'synthetic-watch',source:'mail',sequence:0,finishedAt:'2026-10-22T09:59:59Z'}]}};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));const save=()=>fs.writeFileSync(receiptPath,JSON.stringify(receipt));save();
  return{directory,manifestPath,receiptPath,receipt,save,caseIndex:1,recipientDigest:'a'.repeat(64)};
}
test('no send attempt is recorded until exact cohort/watch has completed final baseline classification',()=>{
  const f=fixture();f.receipt.persistence.watches[0].sequence=0;f.save();assert.throws(()=>begin(f),{code:'MAIL_SEND_BASELINE_NOT_READY'});
  f.receipt.persistence.watches[0].sequence=1;f.receipt.mailCohortId=createManifest().cohortId;f.save();assert.throws(()=>begin(f),{code:'MAIL_SEND_BASELINE_NOT_READY'});
  assert.equal(summary(f.directory).attempted,0);
});
test('attempt is durable before sending; sent or unknown results never authorize another call',()=>{
  const f=fixture();assert.equal(begin(f).status,'attempting');assert.equal(summary(f.directory).unknown,1);
  assert.throws(()=>begin(f),{code:'MAIL_SEND_ALREADY_ATTEMPTED'});
  assert.equal(settle({...f,status:'unknown'}).retryAllowed,false);
  assert.throws(()=>begin(f),{code:'MAIL_SEND_ALREADY_ATTEMPTED'});
  assert.throws(()=>settle({...f,status:'sent',messageId:'synthetic-late-result'}),{code:'MAIL_SEND_RESULT_IMMUTABLE'});
  begin({...f,caseIndex:2});settle({...f,caseIndex:2,status:'sent',messageId:'synthetic-message-id',threadId:'synthetic-thread-id'});
  assert.deepEqual({...summary(f.directory),rows:undefined},{attempted:2,sent:1,unknown:1,unattempted:118,rows:undefined});
  assert.throws(()=>settle({...f,caseIndex:2,status:'sent',messageId:'duplicate'}),{code:'MAIL_SEND_RESULT_IMMUTABLE'});
});
test('a success needs an explicit connector message id and public metadata exposes no recipient or fixture body',()=>{
  const f=fixture();begin(f);assert.throws(()=>settle({...f,status:'sent'}),{code:'MAIL_SEND_RECEIPT_INVALID'});
  settle({...f,status:'sent',messageId:'synthetic-id'});assert.doesNotMatch(JSON.stringify(summary(f.directory)),/subject|body|recipient|@/);
});
