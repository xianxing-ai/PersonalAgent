import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {projectCodingRepairResult,codingRepairExportOperation} from '../electron/coding-repair-result-export.js';

const sha='a'.repeat(64),secret='LOCAL-ONLY source stdout credential C:/Users/private',
  file={path:'src/main.js',sha256:sha,packageId:'root',kind:'source',content:secret},
  snapshot={snapshotId:'snapshot-original',files:[file],packages:[{id:'root',path:'',dependencies:[]}]},
  verification={version:1,sessionId:'session-original',runId:'run-original',recipeId:'npm-test',packageIds:['root'],
    inputSnapshotId:snapshot.snapshotId,files:[file],exitCode:0,status:'VALID',evidenceRefs:['run-original'],
    diagnostics:[{message:secret,source:secret,code:secret}]},
  publish={version:1,sessionId:'session-original',state:'published',
    files:[{path:file.path,beforeSha256:sha,afterSha256:sha}],evidenceRefs:['run-original']},
  check={version:1,sessionId:'session-original',snapshot,verification:[verification]},
  patch={path:file.path,beforeSha256:sha,afterSha256:sha,changed:true},
  start={version:1,session:{version:1,sessionId:'session-original',taskId:'task-original',workspaceId:'workspace',mode:'isolated',baselineSnapshotId:snapshot.snapshotId},
    initialSnapshot:snapshot,recipes:[{recipeId:'npm-test',packageIds:['root'],required:true}]};

test('all registered coding repair operations and original aliases export metadata without changing raw receipts',()=>{
  const values={start,snapshot,readback:check,check,verify:verification,publish,
    preview:{sessionId:'session-original',approved:true,previewed:true,patches:[{...patch,previewText:secret}]},
    patch:{...patch,applied:true,recoveryId:secret},read:{path:file.path,encoding:'utf-8',byteLength:Buffer.byteLength(secret),content:secret},
    list:{path:'.',entries:[{name:'src',kind:'directory'}],truncated:false},reconcile:{state:'clear',delivery:publish}};
  const before=structuredClone(values);
  for(const [operation,value]of Object.entries(values)) {
    const result=projectCodingRepairResult('coding.repair.'+operation,value);
    assert.equal(JSON.stringify(result).includes(secret),false,operation);
    assert.equal(JSON.stringify(result).includes('content'),false,operation);
  }
  assert.deepEqual(values,before);
  assert.deepEqual(projectCodingRepairResult('coding.repair.publish',publish),publish);
  assert.equal(projectCodingRepairResult('coding.repair.verify',verification).status,'VALID');
  assert.deepEqual(projectCodingRepairResult('coding.repair.verify',verification).diagnostics,[]);
  for(const [name,operation]of Object.entries({'workspace.coding_snapshot':'snapshot','workflow.host.f15_n04':'preview',
    'workflow.host.f15_n05':'check','workflow.host.f15_n06':'publish'})) {
    assert.equal(codingRepairExportOperation(name),operation);
    assert.deepEqual(projectCodingRepairResult(name,values[operation]),projectCodingRepairResult('coding.repair.'+operation,values[operation]));
  }
});
test('invalid states, absolute paths, false success and unsupported tools never become exportable',()=>{
  for(const [name,value]of [
    ['publish',{...publish,state:'success'}],['publish',{...publish,files:[{...publish.files[0],path:'C:/private/file'}]}],
    ['verify',{...verification,status:'VALID',exitCode:1}],['read',{path:'../private',encoding:'utf-8',byteLength:0,content:''}],
    ['preview',{sessionId:'session-original',approved:true,previewed:true,patches:[{...patch,changed:'true'}]}],
    ['reconcile',{state:'recovered'}],['unknown',{}],
  ])assert.throws(()=>projectCodingRepairResult('coding.repair.'+name,value));
  const unknown=projectCodingRepairResult('coding.repair.publish',{...publish,state:'unknown'});assert.equal(unknown.state,'unknown');
});
test('read projection preserves original raw-byte BOM hash and exports no source',()=>{
  const raw=Buffer.from('\uFEFFfixture'),digest=createHash('sha256').update(raw).digest('hex');
  assert.deepEqual(projectCodingRepairResult('coding.repair.read',{path:'a.js',encoding:'utf-8',byteLength:raw.length,content:'fixture',sha256:digest}),
    {path:'a.js',encoding:'utf-8',byteLength:raw.length,sha256:digest,read:true});
});
