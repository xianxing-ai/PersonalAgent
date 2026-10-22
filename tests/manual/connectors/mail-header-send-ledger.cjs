// Durable receipts around the separately authorized Gmail connector calls.
// This module has no sender/API/credentials and never reads mailbox content.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {validateManifest}=require('./mail-header-batch-fixture.cjs');
const {completeBaselineReady}=require('./desktop-change-notification-live.cjs');
const cache=path.resolve(__dirname,'../../../.cache');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{const error=Error(code);error.code=code;throw error;};
function read(file){const info=fs.lstatSync(file);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.size<=1024*1024);
  return JSON.parse(fs.readFileSync(file,'utf8'));}
function entry(directory,index){
  const resolved=path.resolve(directory),relative=path.relative(cache,resolved);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'ledger must stay inside this project cache');
  const info=fs.lstatSync(resolved);assert.ok(info.isDirectory()&&!info.isSymbolicLink());
  assert.ok(Number.isSafeInteger(index)&&index>=1&&index<=120);
  return path.join(resolved,String(index).padStart(3,'0')+'.json');
}
function begin({directory,manifestPath,receiptPath,caseIndex,recipientDigest}){
  const manifest=validateManifest(read(manifestPath)),receipt=read(receiptPath);
  if(receipt.source!=='mail'||receipt.status!=='in_progress'||receipt.stage!=='wait-real-source-change'
    ||receipt.checks?.real_source_baseline!=='passed'||!Number.isFinite(Date.parse(receipt.baselineReadyAt))
    ||receipt.mailCohortId!==manifest.cohortId||receipt.privacy?.mailBodyRead!==false||receipt.privacy?.mailWrite!==false
    ||!completeBaselineReady(receipt.persistence,'mail',receipt.watchId))fail('MAIL_SEND_BASELINE_NOT_READY');
  assert.match(recipientDigest,/^[a-f0-9]{64}$/);
  const sample=manifest.cases.find(item=>item.caseIndex===caseIndex);assert.ok(sample);
  const file=entry(directory,caseIndex),value={version:1,cohortId:manifest.cohortId,watchId:receipt.watchId,caseIndex,
    status:'attempting',attemptedAt:new Date().toISOString(),recipientDigest,
    subjectDigest:hash(sample.subject),bodyDigest:hash(sample.body)};
  try{fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}catch(error){if(error.code==='EEXIST')fail('MAIL_SEND_ALREADY_ATTEMPTED');throw error;}
  return{caseIndex,status:value.status,cohortId:manifest.cohortId};
}
function settle({directory,caseIndex,status,messageId,threadId}){
  const file=entry(directory,caseIndex),value=read(file);
  if(value.caseIndex!==caseIndex||value.status!=='attempting')fail('MAIL_SEND_RESULT_IMMUTABLE');
  assert.ok(['sent','unknown'].includes(status));
  if(status==='sent'&&(typeof messageId!=='string'||!messageId||messageId.length>256||/[\r\n\0]/.test(messageId)))fail('MAIL_SEND_RECEIPT_INVALID');
  if(threadId!==undefined)assert.ok(typeof threadId==='string'&&threadId.length<=256&&!/[\r\n\0]/.test(threadId));
  const next={...value,status,finishedAt:new Date().toISOString(),...(status==='sent'?{messageId,...(threadId?{threadId}:{})}:{})};
  const temporary=file+'.tmp-'+randomUUID();fs.writeFileSync(temporary,JSON.stringify(next,null,2)+'\n',{flag:'wx'});fs.renameSync(temporary,file);
  return{caseIndex,status,...(status==='sent'?{messageId}:{}),retryAllowed:false};
}
function summary(directory){
  entry(directory,1);const rows=fs.readdirSync(directory).filter(name=>/^\d{3}\.json$/.test(name)).map(name=>read(path.join(directory,name)));
  return{attempted:rows.length,sent:rows.filter(row=>row.status==='sent').length,
    unknown:rows.filter(row=>row.status==='unknown'||row.status==='attempting').length,
    unattempted:120-rows.length,rows:rows.map(({caseIndex,status,messageId,threadId})=>({caseIndex,status,...(messageId?{messageId}:{}),...(threadId?{threadId}:{})}))};
}
module.exports={begin,settle,summary};
if(require.main===module){try{
  const [operation,directory,...args]=process.argv.slice(2);
  const result=operation==='begin'?begin({directory,manifestPath:args[0],receiptPath:args[1],caseIndex:Number(args[2]),recipientDigest:args[3]}):
    operation==='settle'?settle({directory,caseIndex:Number(args[0]),status:args[1],...(args[2]?{messageId:args[2]}:{}),...(args[3]?{threadId:args[3]}:{})}):
    operation==='summary'?summary(directory):fail('MAIL_SEND_OPERATION_INVALID');
  console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({code:error.code??'MAIL_SEND_LEDGER_FAILED'}));process.exitCode=1;}}
