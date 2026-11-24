import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPublicationContentHost} from '../electron/publication-content-host.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope=()=>({taskId:'publication-child',runId:'original-run',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
function fixture(){
  const input={baseHeadSha:'a'.repeat(40),expectedHeadSha:'a'.repeat(40),paths:['source.txt'],stage:'commit'};
  const binding={proof:{runId:'original-run'},input,operation:{toolName:'workspace.git.commit',arguments:{message:'original message'}}};
  const diff='diff --git a/source.txt b/source.txt\n-old full line\n+new full line\n';
  const preview={baseHeadSha:input.baseHeadSha,headSha:input.expectedHeadSha,treeSha:'b'.repeat(40),fingerprint:'c'.repeat(64),paths:input.paths,diff,diffDigest:hash(diff)};
  let state=binding,value=preview,prepared,requirements=0;
  const question={prepare(_scope,options){prepared=options;},currentRequirement(_scope,id){assert.equal(id,'tool');requirements++;}};
  const host=createPublicationContentHost({readBinding:()=>state,readPreview:async()=>value});
  return {host,binding,preview,question,get prepared(){return prepared;},get requirements(){return requirements;},changeSource(){state={...binding,proof:{runId:'changed'}};},changePreview(){value={...preview,treeSha:'d'.repeat(40)};}};
}

test('publication content keeps full diff and original operation while rechecking the exact confirmed tree',async()=>{
  const f=fixture(),ctx=scope();await f.host.prepare(ctx,f.question);
  assert.ok(f.prepared.contentConfirmation.text.endsWith(f.preview.diff));
  assert.ok(f.prepared.contentConfirmation.text.includes('original message'));
  assert.equal(f.prepared.contentConfirmation.digest,hash(f.prepared.contentConfirmation.text));
  const metadata={baseHeadSha:f.preview.baseHeadSha,headSha:f.preview.headSha,treeSha:f.preview.treeSha,fingerprint:f.preview.fingerprint};
  f.host.assertContent(ctx,metadata);assert.equal(f.requirements,1);
  assert.throws(()=>f.host.assertContent(ctx,{...metadata,treeSha:'e'.repeat(40)}),error=>error.code==='UNAUTHORIZED');
  f.changePreview();await assert.rejects(f.host.recheck(ctx),error=>error.code==='UNAUTHORIZED');
});

test('publication confirmation is unavailable without the original reader and becomes stale with its source',async()=>{
  const f=fixture(),ctx=scope();
  await assert.rejects(createPublicationContentHost({readBinding:()=>f.binding}).prepare(ctx,f.question),error=>error.code==='UNSUPPORTED_CAPABILITY');
  await f.host.prepare(ctx,f.question);f.changeSource();assert.equal(f.prepared.assertCurrent(),false);
  await assert.rejects(f.host.recheck(ctx),error=>error.code==='UNAUTHORIZED');
});
