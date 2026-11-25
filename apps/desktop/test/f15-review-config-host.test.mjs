import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopF15ReviewConfigHost} from '../electron/f15-review-config-host.js';
import {codingRepairReviewBytes,codingRepairReviewOperationId,createRuntimeCodingRepairSignedReview} from '../../runtime/dist/application/coding-repair-signed-review.js';

// The signer and safeStorage below are synthetic test fixtures, never production review evidence.
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'personal-agent-f15-test-')),userData=join(root,'user'),directory=join(root,'reviews');
  mkdirSync(userData);mkdirSync(directory);const keyPath=join(root,'reviewer.pem'),keys=generateKeyPairSync('ed25519');
  writeFileSync(keyPath,keys.publicKey.export({type:'spki',format:'pem'}));let allowed=true,confirmed=true,independent=true,selectedKey=keyPath,author='original-author';
  const key={taskId:'task-1',sessionId:'session-1',snapshotId:'snapshot-1',patchDigest:'a'.repeat(64)};
  const operationId=codingRepairReviewOperationId(key),args={sessionId:key.sessionId,snapshotId:key.snapshotId,patchDigest:key.patchDigest};
  const intent={taskId:key.taskId,sessionId:key.sessionId,workflowId:'F15',proposal:{nodeId:'F15_N04',toolName:'workflow.host.f15_independent_review',
    operationId,arguments:args}};
  const runtime={loadCheckpoint(task,name){
    if(task==='host-1'&&name==='coding-repair:parent')return {taskId:key.taskId,operationId};
    if(task===key.taskId&&name==='coding-repair:review-preflight:'+operationId)return key;
    if(task===key.taskId&&name==='owned-workflow:intent:'+operationId)return intent;
    if(task===key.taskId&&name==='coding-repair:host:'+operationId)return {localTaskId:'host-1'};
  }};
  const options={userData,safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},
    selectPublicKey:async()=>selectedKey,selectReviewDirectory:async()=>directory,confirmConfiguration:async()=>confirmed,
    confirmIndependence:async()=>independent,readAuthorIdentity:()=>author,
    assertOriginalOwner:()=>allowed,getApplication:()=>({runtime}),createSignedReview:createRuntimeCodingRepairSignedReview};
  const host=createDesktopF15ReviewConfigHost(options),input={reviewerId:'independent-reviewer',authorId:'original-author',policyId:'policy-v1'};
  function envelope(changes={}){const review={version:1,...key,...input,decision:'approved',reviewedAt:new Date(Date.now()-1000).toISOString(),
    expiresAt:new Date(Date.now()+60000).toISOString(),...changes};return {review,signature:sign(null,codingRepairReviewBytes(review),keys.privateKey).toString('base64')};}
  const record=()=>join(directory,operationId+'.json'),context={taskId:'host-1',runId:'host-tool-host-1',signal:new AbortController().signal,
    deadline:new Date(Date.now()+10000).toISOString(),authorizationRef:'original',scopes:['workspace:read']};
  return {host,options,key,args,context,envelope,record,operationId,setAllowed:value=>{allowed=value;},setConfirmed:value=>{confirmed=value;},
    setIndependent:value=>{independent=value;},setAuthor:value=>{author=value;},
    setSelectedKey:value=>{selectedKey=value;},cleanup(){host.close();rmSync(root,{recursive:true,force:true});}};
}
test('independent reviewer requires native selection, distinct identity and confirmation',async()=>{
  const f=fixture();try{
    assert.equal(f.host.snapshot().available,false);
    await assert.rejects(f.host.configure({reviewerId:'same',authorId:'same',policyId:'policy-v1'}));
    f.setConfirmed(false);await f.host.configure({reviewerId:'reviewer',authorId:'original-author',policyId:'policy-v1'});
    assert.equal(f.host.snapshot().available,false);
    f.setConfirmed(true);f.setIndependent(false);await f.host.configure({reviewerId:'reviewer',authorId:'original-author',policyId:'policy-v1'});
    assert.equal(f.host.snapshot().available,false);f.setIndependent(true);
    f.setConfirmed(true);const state=await f.host.configure({reviewerId:'independent-reviewer',authorId:'original-author',policyId:'policy-v1'});
    assert.equal(state.available,true);assert.equal(JSON.stringify(state).includes('.pem'),false);
    const restored=createDesktopF15ReviewConfigHost(f.options);try{assert.equal(restored.snapshot().available,true);}finally{restored.close();}
    f.host.revoke();assert.equal(f.host.snapshot().available,false);
    const revoked=createDesktopF15ReviewConfigHost(f.options);try{assert.equal(revoked.snapshot().available,false);}finally{revoked.close();}
  }finally{f.cleanup();}
});
test('real signature appears after pending original request and remains bound to current owner',async()=>{
  const f=fixture();try{
    await f.host.configure({reviewerId:'independent-reviewer',authorId:'original-author',policyId:'policy-v1'});
    const binding=f.host.createBinding(),result=binding.tool.execute(f.args,f.context);
    assert.equal(f.host.pending().length,1);assert.equal(f.host.pending()[0].recordFileName,f.operationId+'.json');
    writeFileSync(f.record(),JSON.stringify(f.envelope()));const verified=await result;
    assert.equal(verified.decision,'approved');assert.equal(verified.patchDigest,f.key.patchDigest);assert.equal(f.host.pending().length,0);
    binding.port.assertCurrent({...f.key,deadline:f.context.deadline,signal:f.context.signal,localTaskId:'host-1',operationId:f.operationId,
      reviewerId:verified.reviewerId,reviewedAt:verified.reviewedAt,expiresAt:verified.expiresAt});
    f.setAuthor('replaced-author');assert.equal(f.host.snapshot().available,false);
    assert.throws(()=>binding.port.assertCurrent({...f.key,deadline:f.context.deadline,signal:f.context.signal,localTaskId:'host-1',operationId:f.operationId,
      reviewerId:verified.reviewerId,reviewedAt:verified.reviewedAt,expiresAt:verified.expiresAt}),{code:'UNAUTHORIZED'});
    f.setAuthor('original-author');
    f.setAllowed(false);
    assert.throws(()=>binding.port.assertCurrent({...f.key,deadline:f.context.deadline,signal:f.context.signal,localTaskId:'host-1',operationId:f.operationId,
      reviewerId:verified.reviewerId,reviewedAt:verified.reviewedAt,expiresAt:verified.expiresAt}),{code:'UNAUTHORIZED'});
  }finally{f.cleanup();}
});
test('tampered signed record, expiry, revocation and changed public key fail closed',async()=>{
  const f=fixture();try{
    await f.host.configure({reviewerId:'independent-reviewer',authorId:'original-author',policyId:'policy-v1'});
    const binding=f.host.createBinding(),value=f.envelope();value.review.patchDigest='b'.repeat(64);writeFileSync(f.record(),JSON.stringify(value));
    await assert.rejects(binding.tool.execute(f.args,f.context),{code:'UNAUTHORIZED'});
    writeFileSync(f.record(),JSON.stringify(f.envelope({expiresAt:new Date(Date.now()-1).toISOString()})));
    await assert.rejects(binding.tool.execute(f.args,f.context),{code:'UNAUTHORIZED'});
    f.host.revoke();await assert.rejects(binding.tool.execute(f.args,f.context));
    const foreign=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});writeFileSync(f.options.userData+'-changed.pem',foreign);
    f.setSelectedKey(f.options.userData+'-changed.pem');f.setConfirmed(false);
    await f.host.configure({reviewerId:'independent-reviewer',authorId:'original-author',policyId:'policy-v1'});
    assert.equal(f.host.snapshot().available,false);
  }finally{f.cleanup();}
});
