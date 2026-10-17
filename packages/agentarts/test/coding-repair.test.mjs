import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {OwnedAgentOrchestrator,getOwnedWorkflowTemplate} from '../dist/index.js';
import {FakeModelProvider} from '@personal-agent/models';
import {analyzeCodingPatches,parseCodingPatchCandidate,affectedCodingPackages,codingVerificationCurrent,
  createCodingRepairFrontier,acceptCodingChecks,requiredCodingVerification,codingSnapshotFingerprint,codingFailureFingerprint,codingPatchFingerprint,codingPatchRepeated,codingPackageGraphDigest,codingPatchCost,rankCodingRepairCandidates} from '../dist/coding-repair.js';
const sha=text=>createHash('sha256').update(text).digest('hex');
const packages=[{id:'a',path:'a',dependencies:[]},{id:'b',path:'b',dependencies:['a']},{id:'c',path:'c',dependencies:[]}];
const snapshot=(value='1',config='1')=>({snapshotId:'snapshot-'+value+config,packages,files:[
  ...['a','b','c'].map(packageId=>({path:packageId+'/main.ts',packageId,kind:'source',sha256:sha(packageId==='a'?value:'same'),content:packageId==='a'?value:'same'})),
  {path:'package-lock.json',packageId:'a',kind:'lock',sha256:sha(config)}]});
const configuration={version:1,session:{version:1,sessionId:'session',taskId:'task',workspaceId:'workspace',mode:'main',baselineSnapshotId:snapshot().snapshotId},initialSnapshot:snapshot(),
  recipes:[{recipeId:'test-b',packageIds:['b'],required:true}]};
const receipt=(s,extra={})=>({version:1,sessionId:'session',runId:'run',recipeId:'test-b',packageIds:['b'],inputSnapshotId:s.snapshotId,files:s.files,packageGraphDigest:codingPackageGraphDigest(s),exitCode:0,status:'VALID',evidenceRefs:['evidence'],diagnostics:[],...extra});
test('package DAG invalidation propagates downstream and global dependency lock changes invalidate all',()=>{
  assert.deepEqual(affectedCodingPackages(snapshot(),snapshot('2')),['a','b']);
  assert.deepEqual(affectedCodingPackages(snapshot(),snapshot('1','2')),['a','b','c']);
  const before=snapshot(),other=structuredClone(before);other.files.find(f=>f.packageId==='c').sha256=sha('new c');
  assert.equal(codingVerificationCurrent(receipt(before),other,'session'),true,'unrelated package changes preserve applicable evidence');
  assert.equal(codingVerificationCurrent(receipt(before),snapshot('2'),'session'),false);
  assert.equal(codingVerificationCurrent(receipt(before),snapshot('1','2'),'session'),false);
});
test('only current mandatory successful verification permits delivery; known failure and unknown stay distinct',()=>{
  const frontier=createCodingRepairFrontier(configuration);assert.equal(requiredCodingVerification(frontier),false);
  assert.equal(acceptCodingChecks(frontier,{version:1,sessionId:'session',snapshot:snapshot(),verification:[receipt(snapshot(),{status:'FAILED',exitCode:1,diagnostics:[{source:'node:test',message:'expected 3'}]})]}),'failed');
  assert.equal(requiredCodingVerification(frontier),false);
  assert.equal(acceptCodingChecks(frontier,{version:1,sessionId:'session',snapshot:snapshot('2'),verification:[receipt(snapshot('2'),{status:'UNKNOWN',exitCode:null})]}),'unknown');
  assert.equal(acceptCodingChecks(frontier,{version:1,sessionId:'session',snapshot:snapshot('3'),verification:[receipt(snapshot('3'))]}),'passed');
  assert.equal(requiredCodingVerification(frontier),true);
});
test('independent recipe failure remains current across another package repair (synthetic host readbacks)',()=>{
  const before=snapshot(),after=snapshot('2');
  const config={...configuration,recipes:[{recipeId:'test-a',packageIds:['a'],required:true},{recipeId:'test-c',packageIds:['c'],required:true}]};
  const failed=(s,id)=>receipt(s,{recipeId:'test-'+id,packageIds:[id],status:'FAILED',exitCode:1,diagnostics:[{source:'fake-host',path:id+'/main.ts',message:'expected repair'}]});
  const a=failed(before,'a'),c=failed(before,'c'),original=structuredClone(c),frontier=createCodingRepairFrontier(config);
  const read=(s,verification)=>({version:1,sessionId:'session',snapshot:s,verification});
  assert.equal(acceptCodingChecks(frontier,read(before,[a,c])),'failed');
  const aPass=receipt(after,{recipeId:'test-a',packageIds:['a'],runId:'a-round-2'});
  assert.equal(acceptCodingChecks(frontier,read(after,[aPass,c])),'failed');
  assert.equal(requiredCodingVerification(frontier),false);
  assert.deepEqual(c,original,'the original host failure and its Evidence are unchanged');
  assert.equal(acceptCodingChecks(frontier,read(after,[aPass,{...c,status:'UNKNOWN',exitCode:null}])),'unknown');
  assert.equal(acceptCodingChecks(frontier,read(after,[aPass,receipt(after,{recipeId:'test-c',packageIds:['c']})])),'passed');
  for(const change of [
    s=>{s.files.find(f=>f.packageId==='c').sha256=sha('changed c');},
    s=>{s.files.find(f=>f.kind==='lock').sha256=sha('changed lock');},
    s=>{s.packages.find(p=>p.id==='c').dependencies=['a'];},
    s=>{s.packages.find(p=>p.id==='a').path='';s.files.push({path:'tsconfig.json',packageId:'a',kind:'config',sha256:sha('changed config')});},
  ]){
    const changed=structuredClone(after);change(changed);
    assert.throws(()=>acceptCodingChecks(createCodingRepairFrontier(config),read(changed,[c])),{code:'REVISION_CONFLICT'});
  }
  assert.throws(()=>acceptCodingChecks(createCodingRepairFrontier(config),read(after,[{...c,sessionId:'other'}])),{code:'INVALID_ARGUMENT'});
  for(const forged of [{...c,packageIds:['a']},{...c,packageGraphDigest:'0'.repeat(64)}])
    assert.throws(()=>acceptCodingChecks(createCodingRepairFrontier(config),read(after,[forged])),{code:'REVISION_CONFLICT'});
  const legacy={...c};delete legacy.packageGraphDigest;
  assert.throws(()=>acceptCodingChecks(createCodingRepairFrontier(config),read(after,[legacy])),{code:'REVISION_CONFLICT'});
});

test('jsdiff and TypeScript analyze actual exact patches and declaration ranges without fuzzy application',()=>{
  const before='export function answer() { return 1; }\n',after='export function answer() { return 2; }\n';
  const s={snapshotId:'code',packages:[{id:'a',path:'',dependencies:[]}],files:[{path:'main.ts',packageId:'a',kind:'source',sha256:sha(before),content:before}]};
  const candidate=parseCodingPatchCandidate({diagnosis:'actual failing expectation',patches:[{path:'main.ts',expectedSha256:sha(before),edits:[{oldText:'return 1;',newText:'return 2;'}]}]});
  const [analysis]=analyzeCodingPatches(candidate,s);assert.equal(analysis.afterSha256,sha(after));assert.equal(analysis.hunks.length,1);
  assert.equal(analysis.syntax.supported,true);assert.equal(analysis.syntax.diagnostics.length,0);assert.equal(analysis.syntax.declarations[0].name,'answer');
  assert.throws(()=>analyzeCodingPatches({...candidate,patches:[{...candidate.patches[0],expectedSha256:'a'.repeat(64)}]},s),{code:'REVISION_CONFLICT'});
  assert.throws(()=>analyzeCodingPatches({...candidate,patches:[{...candidate.patches[0],edits:[{oldText:'not present',newText:'x'}]}]},s),{code:'INVALID_ARGUMENT'});
  const created=analyzeCodingPatches({diagnosis:'new file',patches:[{path:'hello.py',expectedSha256:null,edits:[],createText:'print(1)\n'}]},s)[0];
  assert.equal(created.syntax.supported,false,'other languages require actual published validators');
});
test('same source, actual failure and semantic patch is rejected as no progress without a fixed round limit',()=>{
  const frontier=createCodingRepairFrontier(configuration),patches=[{path:'a/main.ts',expectedSha256:sha('1'),edits:[{oldText:'1',newText:'2'}]}];
  frontier.verification=[receipt(snapshot(),{status:'FAILED',exitCode:1,diagnostics:[{source:'node:test',message:'still failed'}]})];
  assert.equal(codingPatchRepeated(frontier,patches),false);
  frontier.history.push({round:0,sourceFingerprint:codingSnapshotFingerprint(frontier.snapshot),failureFingerprint:codingFailureFingerprint(frontier),patchDigest:codingPatchFingerprint(patches),snapshotId:frontier.snapshot.snapshotId,operationIds:['original-operation'],evidenceRefs:['original-evidence']});
  assert.equal(codingPatchRepeated(frontier,patches),true);frontier.snapshot=snapshot('2');assert.equal(codingPatchRepeated(frontier,patches),false);
});
test('local cost ranks feasible candidates and excludes unrelated packages using actual failure evidence',()=>{
  const frontier=createCodingRepairFrontier(configuration),s=snapshot();frontier.scopePaths=['a/main.ts','c/main.ts'];
  frontier.diagnostics=[{path:'a/main.ts',line:1,source:'actual-test',message:'failure in a'}];
  const candidate=(id,path,oldText,newText)=>({id,description:id,value:{diagnosis:'actual failure',patches:[{path,expectedSha256:s.files.find(f=>f.path===path).sha256,edits:[{oldText,newText}]}]}});
  const small=candidate('small','a/main.ts','1','2'),large=candidate('large','a/main.ts','1','2\n3\n4'),unrelated=candidate('unrelated','c/main.ts','same','other');
  const ranked=rankCodingRepairCandidates(frontier,s,[large,unrelated,small]);assert.deepEqual(ranked.map(r=>r.id),['small','large']);
  assert.match(ranked[0].description,/unproven_until_actual_current_verification/);
  assert.throws(()=>codingPatchCost(frontier,parseCodingPatchCandidate(unrelated.value),s),{code:'UNSUPPORTED_CAPABILITY'});
});
test('obvious assertion removal or new skip cannot masquerade as a minimum repair',()=>{
  const before='test("existing", () => assert.equal(answer(), 3));\n',s={snapshotId:'test-source',packages:[{id:'a',path:'',dependencies:[]}],files:[{path:'main.test.js',sha256:sha(before),packageId:'a',kind:'test',content:before}]};
  const frontier=createCodingRepairFrontier(configuration);frontier.scopePaths=['main.test.js'];
  for(const newText of ['// removed verification\n','test.skip("existing", () => assert.equal(answer(), 3));\n'])
    assert.throws(()=>codingPatchCost(frontier,parseCodingPatchCandidate({diagnosis:'shortcut',patches:[{path:'main.test.js',expectedSha256:sha(before),edits:[{oldText:before,newText}]}]}),s),{code:'UNSUPPORTED_CAPABILITY'});
});
test('F15 candidate generation uses the original execution catalog selection and native effort without default-role fallback',async()=>{
  const selected={catalogRevision:'a'.repeat(64),modelId:'selected-code-model',reasoningEffort:'high'};
  const roles=Object.fromEntries(['fast','world','plan','review'].map(role=>[role,new FakeModelProvider([])]));
  const model=new FakeModelProvider([()=>({kind:'final',text:JSON.stringify({candidates:[{id:'scope',description:'scoped actual source',value:{scope:['main.ts']}}]})})]);
  const orchestrator=new OwnedAgentOrchestrator(roles,2048,undefined,undefined,undefined,{executionModels:{
    catalog(){throw Error('No directory lookup needed');},resolve(value){assert.deepEqual(value,selected);return model;}}});
  const template=getOwnedWorkflowTemplate('F15'),context={template,node:template.nodes.find(n=>n.id==='F15_N02'),input:{executionModel:selected},
    predecessorOutputs:{},predecessorStates:{},availableTools:[],deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal,
    requestId:'selected-request',mode:'main',namespace:'selected-session'};
  const result=await orchestrator.prepareOwnedWorkflowCandidates(context);assert.equal(result[0].id,'scope');
  assert.equal(model.requests.length,1);assert.equal(model.requests[0].reasoningEffort,'high');
  assert.ok(Object.values(roles).every(provider=>provider.requests.length===0));
  await assert.rejects(new OwnedAgentOrchestrator(roles,2048).prepareOwnedWorkflowCandidates(context),{code:'UNSUPPORTED_CAPABILITY'});
  assert.ok(Object.values(roles).every(provider=>provider.requests.length===0));
});
