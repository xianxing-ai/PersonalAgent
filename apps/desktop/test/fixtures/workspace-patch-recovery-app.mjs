import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {app, BrowserWindow, ipcMain} from 'electron';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createWorkspaceReadTool, createWorkspacePatchApplyTool} from '@personal-agent/coding-tools';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createWorkspacePatchRecoveryAction} from '../../electron/workspace-patch-recovery-action.js';

// Dedicated fixture process only: real Runtime/SQLite/files/IPC; explicit Fake cloud and write helper.
const directory = process.env.PA_PATCH_RECOVERY_FIXTURE;
if (!directory || !path.isAbsolute(directory) || app.isPackaged) throw Error('Isolated fixture directory required');
app.setPath('userData', path.join(directory, 'electron-profile'));
const rootPath = path.join(directory, 'workspace'), recoveryRootPath = path.join(directory, 'recovery');
const source = path.join(rootPath, 'demo.mjs'), marker = path.join(recoveryRootPath, 'fixture-marker.json');
const before = '\ufeffexport const value = "before";\r\n', after = before.replace('before', 'after_中文');
const sha = value => createHash('sha256').update(value).digest('hex');
const calls = {write:0, cloud:0, readback:0, acknowledgement:0};
let application, client, admin, cachedTask, runId, taskId, release, hold;
const patchInput = {path:'demo.mjs',expectedSha256:sha(before),edits:[{oldText:'before',newText:'after_中文'}]};
const proposal = (proposalId, toolName, args) => ({kind:'tool_proposal',proposalId,toolName,toolVersion:'1.0.0',arguments:args,verification:'unverified'});
async function until(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {if (await check()) return; await new Promise(r=>setTimeout(r,10));}
  throw Error('Fixture did not reach expected state');
}
function createApplication() {
  const read = createWorkspaceReadTool({rootPath});
  const descriptor = createWorkspacePatchApplyTool({rootPath,recoveryRootPath,
    powerShellPath:process.env.PA_TEST_PWSH ?? 'C:/Program Files/PowerShell/7/pwsh.exe'}).descriptor;
  const tools = [read,{descriptor,async execute(input,context) {
    assert.deepEqual(input,patchInput); assert.equal(sha(await readFile(source)),sha(before));
    calls.write++; runId=context.runId;
    await writeFile(marker,JSON.stringify({runId,argumentsDigest:context.argumentsDigest,beforeSha256:sha(before),afterSha256:sha(after)}));
    await writeFile(source,after);
    throw new ProtocolError('RESULT_UNKNOWN','Explicit Fake helper lost its receipt');
  }}];
  return createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'isolated-ipc-fixture',coordinationBinding:'explicit-fake-cloud-v1',tools,
    competitionToolAvailability:tools.map(({descriptor:d})=>({toolName:d.name,toolVersion:d.version,available:()=>true})),
    competitionToolExports:tools.map(({descriptor:d})=>({toolName:d.name,toolVersion:d.version,
      exportPolicyVersion:'fixture-v1',accepts:()=>true,project:({result})=>result})),
    coordination:{async execute(request) {
      calls.cloud++;
      if(!request.continuation)return proposal('read-1',read.descriptor.name,{path:'demo.mjs'});
      assert.equal(request.continuation.proposalId,'read-1','cancelled recovery must not continue the cloud loop');
      return proposal('patch-2',descriptor.name,patchInput);
    }},
    workspacePatchReconciliation:{bindingId:'d'.repeat(64),async reconcile(input) {
      calls.readback++;
      if(hold)await hold;
      const identity=JSON.parse(await readFile(marker,'utf8')),bytes=await readFile(source);
      const currentSha256=sha(bytes), outcome=currentSha256===identity.afterSha256?'applied':'unknown';
      const result={path:input.relativePath,state:'reconciled',...identity,currentSha256,byteLength:bytes.length,outcome};
      if(!input.retainMarker){calls.acknowledgement++;await unlink(marker);}
      return result;
    }},
  });
}
const snapshot=()=>({connection:'真实 Runtime / SQLite · 显式 Fake Cloud 与写入助手',tasks:[cachedTask],
  health:[],capabilities:[],approvals:[],adminNavigation:{page:'tasks',revision:1}});
const publish=()=>admin.webContents.send('desktop:update',snapshot());
const refresh=async(id,isCurrent=()=>true)=>{
  if(!isCurrent())throw Error('Task refresh session changed');
  const task=await client.call('task.get',{taskId:id});
  if(!isCurrent())throw Error('Task refresh session changed');
  if(cachedTask?.taskId===task.taskId&&cachedTask.revision>task.revision)return cachedTask;
  cachedTask=task;publish();return task;
};
const recover=createWorkspacePatchRecoveryAction({getApplication:()=>application,getAdmin:()=>admin,isEnabled:()=>true,refresh});

await app.whenReady();
await mkdir(rootPath,{recursive:true});await mkdir(recoveryRootPath,{recursive:true});await writeFile(source,before);
application=createApplication();client=new Client(application);await client.connect();
({taskId}=await client.call('task.submit',{goal:'Patch the isolated public fixture',conversationId:'ipc-fixture'},
  {idempotencyKey:'ipc-patch',timeoutMs:60000}));
for(let step=0;step<2;step++) {
  await until(()=>application.activeTaskCount===0 && application.runtime.getTask(taskId).state==='waiting_approval');
  const approval=(await client.call('approval.list',{taskId,state:'pending'})).items[0];
  await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
}
await until(()=>application.activeTaskCount===0 && application.runtime.getTask(taskId).state==='waiting_reconciliation');
await client.call('task.cancel',{taskId});
const original=application.runtime.readToolExecutions(taskId).find(r=>r.evidenceId===runId);
application.close();application=createApplication();client=new Client(application);await client.connect();
cachedTask=await client.call('task.get',{taskId});
const options={show:false,width:1280,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,
  preload:fileURLToPath(new URL('../../electron/preload.cjs',import.meta.url))}};
admin=new BrowserWindow(options);
const other=new BrowserWindow(options);
ipcMain.handle('desktop:action',async(event,name,input)=>{
  try {
    if(name==='snapshot')return {ok:true,value:snapshot()};
    if(name!=='coding.reconcile')throw Error('Unsupported fixture action');
    return {ok:true,value:await recover(event,input)};
  }catch(error){return {ok:false,error:error.message};}
});
globalThis.patchFixture={taskId,runId,initialRevision:cachedTask.revision,
  hold(){hold=new Promise(r=>{release=r;});},release(){release?.();hold=undefined;},
  async inspect(){const record=application.runtime.readToolExecutions(taskId).find(r=>r.evidenceId===runId);
    return {calls,task:application.runtime.getTask(taskId),record,original,usesRemaining:application.runtime.policy.get(runId).usesRemaining,
      bytesMatch:(await readFile(source)).equals(Buffer.from(after)),cachedTask};},
  async restart(){application.close();application=createApplication();client=new Client(application);await client.connect();return refresh(taskId);},
};
app.on('before-quit',()=>application.close());
await other.loadURL('data:text/html,<title>Untrusted fixture window</title>');
await admin.loadFile(fileURLToPath(new URL('./workspace-patch-recovery.html',import.meta.url)));
