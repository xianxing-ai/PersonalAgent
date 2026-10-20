import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSqliteLearningHost,createDeveloperExperienceApplication} from '../dist/index.js';

const context=()=>({deadline:'2099-01-01T00:00:00.000Z',signal:new AbortController().signal});
const sourceRef=`developer-experience:v1:dGFzaw:${'a'.repeat(64)}`;
const scope={workspaceId:'workspace',workspaceDigest:'b'.repeat(64),configurationDigest:'c'.repeat(64),
  workflowVersion:'F15@1',runtimeVersion:'runtime@1',recipeFingerprint:'d'.repeat(64)};
const at='2026-10-20T00:00:00.000Z';
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'developer-experience-'));
  const learning=openSqliteLearningHost(join(directory,'learning.sqlite'));
  t.after(()=>{learning.close();rmSync(directory,{recursive:true,force:true});});
  let source={sourceRef,scope:structuredClone(scope),requiredRecipeIds:['typecheck'],evidenceRefs:['trial','compare','adopt','publish']};
  let confirm=async()=>true;
  const app=createDeveloperExperienceApplication({namespace:'developer',learning,ports:{
    readConfirmedSource:()=>source&&structuredClone(source),confirmActivation:(...args)=>confirm(...args),
  }});
  const propose=()=>app.propose({...context(),workflowId:'experience',expectedRevision:null,operationId:'propose',sourceRef,createdAt:at});
  const activate=(operationId='activate')=>app.activate({...context(),workflowId:'experience',revision:1,expectedActiveRevision:null,operationId,activatedAt:at});
  return {app,learning,propose,activate,setSource:value=>{source=value;},source:()=>structuredClone(source),setConfirm:value=>{confirm=value;}};
}
test('candidate -> validation -> separately confirmed activation -> descriptive read-only policy',async t=>{
  const f=fixture(t);
  assert.equal(f.propose().validation,'candidate');
  assert.equal(f.app.readApplicable('experience',scope,context()),null);
  await assert.rejects(f.activate(),{code:'NOT_VALIDATED'});
  await f.app.validate('experience',1,context());
  await f.activate();
  const lease=f.app.readApplicable('experience',scope,context());
  assert.deepEqual(f.app.assertApplicable(lease,scope,context()),{version:1,requiredRecipeIds:['typecheck']});
  assert.deepEqual(Object.keys(f.app.assertApplicable(lease,scope,context())).sort(),['requiredRecipeIds','version']);
});
test('stop/reactivation of the same revision invalidates its old lease',async t=>{
  const f=fixture(t);f.propose();await f.app.validate('experience',1,context());await f.activate();
  const old=f.app.readApplicable('experience',scope,context());
  f.app.stop({...context(),workflowId:'experience',expectedActiveRevision:1,operationId:'stop',stoppedAt:at});
  assert.equal(f.app.readApplicable('experience',scope,context()),null);
  await f.activate('reactivate');
  assert.throws(()=>f.app.assertApplicable(old,scope,context()),{code:'REVISION_CONFLICT'});
  assert.ok(f.app.readApplicable('experience',scope,context()).activationSequence>old.activationSequence);
});
test('source withdrawal, configuration/workspace drift and changed policy refuse further consumption',async t=>{
  const f=fixture(t);f.propose();await f.app.validate('experience',1,context());await f.activate();
  const lease=f.app.readApplicable('experience',scope,context());
  for(const key of Object.keys(scope)) {
    const changed=f.source();changed.scope[key]=key.endsWith('Digest')||key==='recipeFingerprint'?'e'.repeat(64):'changed';
    f.setSource(changed);
    assert.throws(()=>f.app.assertApplicable(lease,scope,context()),{code:'REVISION_CONFLICT'});
    f.setSource(lease.source);
  }
  f.setSource(undefined);
  assert.throws(()=>f.app.assertApplicable(lease,scope,context()),{code:'NOT_VALIDATED'});
});
test('late approval cannot enable a changed source or a cancelled request',async t=>{
  const f=fixture(t);f.propose();await f.app.validate('experience',1,context());
  f.setConfirm(async()=>{const changed=f.source();changed.scope.configurationDigest='e'.repeat(64);f.setSource(changed);return true;});
  await assert.rejects(f.activate(),{code:'REVISION_CONFLICT'});
  assert.equal(f.learning.readActive('developer','experience'),null);
  const controller=new AbortController();controller.abort();
  assert.throws(()=>f.app.readApplicable('experience',scope,{...context(),signal:controller.signal}),{code:'CANCELLED'});
});
