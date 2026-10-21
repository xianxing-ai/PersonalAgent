import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {createMailConfig} from '../electron/mail-config.js';

const cache=new URL('../../../.cache/mail-batch-question/',import.meta.url);mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key=scope=>JSON.stringify([scope.taskId,scope.runId]);
function questions() {
  const entries=new Map(),granted=new Set(),resources=new Map(),derived=[];
  return {entries,derived,prepare(scope,{requirements,assertCurrent}){entries.set(key(scope),{scope,requirements,assertCurrent});},
    currentRequirement(scope,id){const entry=entries.get(key(scope));
      if(!granted.has(key(scope))||scope.signal.aborted||entry?.scope.deadline!==scope.deadline||!entry.requirements.some(item=>item.requirementId===id)
        ||entry.assertCurrent()!==true)throw Error('Synthetic question receipt absent');return true;},
    assertConsumedResult(scope,id){return this.currentRequirement(scope,id);},
    deriveMailBatch(parent,next,options){this.assertConsumedResult(parent,options.requirementId);assert.equal(options.assertCurrent(),true);
      derived.push({parent,next,batchId:options.batchId});granted.add(key(next));},
    allow:scope=>granted.add(key(scope)),
    readResourceGeneration(resource){if(!resources.has(resource))resources.set(resource,randomUUID());return resources.get(resource);},
    rotateResourceGeneration(resource,expected){assert.equal(this.readResourceGeneration(resource),expected);const next=randomUUID();resources.set(resource,next);return next;}};
}

test('Synthetic configured mailbox can request one fixed batch while old consents stay false; next page derives and finish/revoke stop reuse',async()=>{
  const question=questions(),options={userData:mkdtempSync(new URL('run-',cache)),safeStorage,namespace:'Synthetic desktop',question};
  const config=createMailConfig(options);
  await config.configure({user:'synthetic@qq.com',authCode:'SyntheticOnlyAuthCode'});config.markBound(config.current().revision);
  assert.equal(config.snapshot().sessionAllowed,false);assert.equal(config.cloudLease(),undefined);
  assert.throws(()=>config.enableSession({readConsent:true}),/提问卡/);
  assert.throws(()=>config.enableCloudAnalysis({cloudAnalysisConsent:true}),/提问卡/);
  const deadline=new Date(Date.now()+60_000).toISOString(),batch={batchId:randomUUID(),generation:randomUUID(),accountRef:'desktop-qq-inbox',
    folder:'INBOX',limit:100,queryDigest:hash({folder:'INBOX',startCursor:null}),deadline};
  const scope=index=>({taskId:'Synthetic page '+index,runId:'run-'+index,toolName:'mail.inbox',toolVersion:'0.1.0-alpha.1',deadline,signal:new AbortController().signal});
  const port=config.batchAuthorization,first=scope(1),next=scope(2);
  assert.equal(port.canRequest(),true);port.assertCurrent(batch);assert.throws(()=>port.assertPage(first,batch));
  port.preparePage(first,batch);assert.throws(()=>port.assertPage(first,batch));
  const requirement=question.entries.get(key(first)).requirements[0];assert.match(requirement.summary,/每页最多 100 条，总量未知/);
  assert.match(requirement.summary,/不含正文、写信或云端分析/);
  question.allow(first);port.assertPage(first,batch);port.assertConsumed(first,batch);
  port.preparePage(next,batch,first);port.assertPage(next,batch);assert.equal(question.derived.length,1);
  assert.equal(question.derived[0].parent,first);assert.equal(question.derived[0].batchId,batch.batchId);
  assert.equal(config.snapshot().sessionAllowed,false);assert.equal(config.isSessionAllowed(config.current().revision),false);
  assert.throws(()=>port.assertPage({...first,runId:'foreign'},batch));
  assert.throws(()=>port.preparePage(scope(3),{...batch,queryDigest:hash('changed')},first));
  port.finish(batch);assert.throws(()=>port.assertPage(next,batch));assert.throws(()=>port.assertConsumed(first,batch));
  const another={...batch,batchId:randomUUID(),generation:randomUUID()},third=scope(3);
  port.preparePage(third,another);question.allow(third);port.assertPage(third,another);
  await config.revoke();assert.throws(()=>port.assertPage(third,another));
  assert.equal(createMailConfig(options).snapshot().sessionAllowed,false);
});
