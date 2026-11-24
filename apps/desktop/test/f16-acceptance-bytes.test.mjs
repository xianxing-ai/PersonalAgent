import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,symlink,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readF16AcceptanceBytes,assertF16PreservedBytes} from '../electron/f16-acceptance-bytes.js';
import {selectF16RepairedRun,selectF16RepairedJob} from '../electron/f16-ci-identity-recipe.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
  const base=resolve('.cache/f16-f17');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'bytes-'));
  t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'src'));await mkdir(join(root,'.github/workflows'),{recursive:true});
  const before='export const value=1;\n',after='export const value=2;\n';
  await writeFile(join(root,'src/value.mjs'),before);await writeFile(join(root,'package.json'),'{}');
  await writeFile(join(root,'value.test.mjs'),'assert.equal(value,2);');await writeFile(join(root,'.github/workflows/ci.yml'),'name: CI\non: push\n');
  const patch={path:'src/value.mjs',expectedSha256:sha(before)},result={applied:true,path:patch.path,beforeSha256:sha(before),afterSha256:sha(after)};
  let active=true;const read=()=>readF16AcceptanceBytes({root,patch,assertCurrent:()=>{if(!active)throw Error('original lease ended');}});
  return {root,patch,result,read,after,revoke:()=>{active=false;}};
}

test('bounded F16 policy preserves all acceptance/build/dependency bytes and the full file set except one exact source patch',async t=>{
  const f=await fixture(t),before=await f.read();await writeFile(join(f.root,f.patch.path),f.after);
  assertF16PreservedBytes(before,await f.read(),f.patch,f.result);
  for(const file of ['value.test.mjs','package.json','.github/workflows/ci.yml']){
    const content=file==='value.test.mjs'?'assert.equal(value,2);':file==='package.json'?'{}':'name: CI\non: push\n';
    await writeFile(join(f.root,file),content+'\n');
    const changed=await f.read();assert.throws(()=>assertF16PreservedBytes(before,changed,f.patch,f.result));
    await writeFile(join(f.root,file),content);
  }
  await writeFile(join(f.root,'ignored-test-config'),'disable-tests');
  assert.throws(()=>assertF16PreservedBytes(before,{...before,files:[...before.files,{path:'foreign',sha256:'x'}]},f.patch,f.result));
  const added=await f.read();assert.throws(()=>assertF16PreservedBytes(before,added,f.patch,f.result));
  await rm(join(f.root,'ignored-test-config'));
  await mkdir(join(f.root,'empty-skip-marker'));const directory=await f.read();
  assert.throws(()=>assertF16PreservedBytes(before,directory,f.patch,f.result));await rm(join(f.root,'empty-skip-marker'),{recursive:true});
  if(process.platform!=='win32'){
    await chmod(join(f.root,f.patch.path),0o755);const mode=await f.read();assert.throws(()=>assertF16PreservedBytes(before,mode,f.patch,f.result));
  }
  f.revoke();await assert.rejects(f.read(),/original lease ended/);
});

test('F16 byte policy refuses test edits, linked dependencies and ambiguous/dynamic workflow identity',async t=>{
  const f=await fixture(t);
  for(const path of ['value.test.mjs','src/test.mjs','src/config.js','../src/value.mjs','.github/workflows/ci.yml'])
    await assert.rejects(readF16AcceptanceBytes({root:f.root,patch:{...f.patch,path},assertCurrent:()=>{}}));
  await writeFile(join(f.root,'.github/workflows/other.yml'),'name: Other\n');await assert.rejects(f.read(),/exactly one/);
  await rm(join(f.root,'.github/workflows/other.yml'));await writeFile(join(f.root,'.github/workflows/ci.yml'),'name: CI\nrun-name: dynamic\n');
  await assert.rejects(f.read(),/literal named/);await writeFile(join(f.root,'.github/workflows/ci.yml'),'name: CI\n');
  await symlink(join(f.root,'src'),join(f.root,'dependencies-link'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(f.read(),/links/);
});

test('CI recipe requires a fresh repaired commit and exact original workflow/job; local stdout cannot supply an identity',()=>{
  const input={repository:'xianxing-ai/PersonalAgent',headSha:'a'.repeat(40),runId:1,jobId:2,recipeId:'npm-test'};
  const record={state:'confirmed',policyDecision:'allow',executionStarted:true};
  const originalRun={id:1,name:'CI',status:'completed',conclusion:'failure',headSha:input.headSha};
  const newRun={id:3,name:'CI',status:'completed',conclusion:'success',headSha:'b'.repeat(40),createdAt:'2026-10-31T10:00:02Z'};
  const args={input,baseline:{policy:'unchanged-acceptance-bytes-v1',workflowName:'CI'},originalRun,
    head:{result:{headSha:newRun.headSha,workspaceClean:true}},command:{record,result:{recipeId:'npm-test',exitCode:0,stdout:'{"runId":999,"jobId":999}'}},
    patchRecord:{state:'confirmed',finishedAt:'2026-10-31T10:00:01Z'},runs:{result:{items:[newRun]}}};
  const run=selectF16RepairedRun(args);assert.equal(run.runId,3);
  for(const change of [{head:{result:{headSha:input.headSha,workspaceClean:true}}},{head:{result:{headSha:newRun.headSha,workspaceClean:false}}},
    {runs:{result:{items:[{...newRun,createdAt:'2026-10-31T10:00:00Z'}]}}},{runs:{result:{items:[{...newRun,name:'Different'}]}}},
    {runs:{result:{items:[newRun,{...newRun,id:4}]}}},{command:{...args.command,record:{...record,state:'unknown'}}},
    {command:{...args.command,result:{...args.command.result,recipeId:'replacement'}}}])assert.throws(()=>selectF16RepairedRun({...args,...change}));
  const originalJob={id:2,runId:1,name:'test',status:'completed',conclusion:'failure'},job={id:4,runId:3,name:'test',status:'completed',conclusion:'success'};
  assert.equal(selectF16RepairedJob({input,run,originalJob,jobs:{result:{items:[job]}}}).jobId,4);
  for(const changed of [{...job,runId:99},{...job,name:'other'},{...job,conclusion:'failure'}])
    assert.throws(()=>selectF16RepairedJob({input,run,originalJob,jobs:{result:{items:[changed]}}}));
});
