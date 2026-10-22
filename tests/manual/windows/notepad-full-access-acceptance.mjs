// Opt-in real native write. Only a newly opened target can pass the original
// Host baseline; no old window/body is selected by this runner.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {AuthorizationQuestions,createRuntimeApplication,createWindowsHostBridgeTransport,
  createWindowsHostNotepadAdapter,createRuntimeWindowsHostAttemptStore} from '@personal-agent/runtime/application';
import {createDesktopNotepadHost} from '../../../apps/desktop/electron/notepad-host.js';
import {createDesktopAuthorizationQuestionHost} from '../../../apps/desktop/electron/authorization-question-host.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
let application,host,question,directory,taskId;
const receipt={profile:'huawei_ict_agentarts',state:'failed',nodeVersion:process.version,
  platform:process.platform,modelCalled:false,formalDesktopTouched:false,stage:'preflight'};
const counts={nativeShortcutRegistrations:0,manualApprovalResponses:0,openedNotepad:0,hello:0,bind:0,
  observe:0,observed:0,targetReady:0,execute:0,verified:0};
async function settle(check,timeout=45000){const until=Date.now()+timeout;for(;;){if(await check())return;
  if(Date.now()>=until)throw Object.assign(Error('Native acceptance timed out'),{code:'TIMEOUT'});
  await new Promise(resolve=>setTimeout(resolve,20));}}
try{
  assert.equal(process.platform,'win32');assert.deepEqual(process.argv.slice(2),['--run-public-notepad']);
  const token=spawnSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoProfile','-NonInteractive','-Command',
    '$i=[Security.Principal.WindowsIdentity]::GetCurrent(); $p=[Security.Principal.WindowsPrincipal]::new($i); if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 2}'],
  {windowsHide:true,stdio:'ignore'});assert.equal(token.status,0,'Ordinary user token required');
  receipt.ordinaryToken=true;
  await mkdir(path.join(root,'.cache'),{recursive:true});
  directory=await mkdtemp(path.join(root,'.cache','native-notepad-'));
  const userData=path.join(directory,'userData'),journalDirectory=path.join(userData,'windows-host');
  await mkdir(journalDirectory,{recursive:true});await mkdir(path.join(directory,'workspace'));
  const hostFile='apps/windows-host/host/bin/Release/net8.0-windows/WindowsHost.Host.exe';
  const bridgeFile='apps/windows-host/host/bridge/bin/Release/net8.0-windows/WindowsHost.PipeBridge.exe';
  receipt.sourceHead=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim();
  receipt.sourceHashes={};receipt.artifactHashes={};
  for(const file of ['apps/desktop/electron/notepad-host.js','apps/desktop/electron/authorization-question-host.js',
    'apps/runtime/src/application/windows-host-adapter.ts','apps/windows-host/host/Program.cs',
    'apps/windows-host/host/HostSecurity.cs','apps/windows-host/host/LocalJournalDirectory.cs',
    'apps/windows-host/host/HostService.cs','apps/windows-host/host/NotepadTargets.cs','apps/windows-host/host/bridge/Program.cs'])
    receipt.sourceHashes[file]=sha(await readFile(path.join(root,file)));
  for(const file of [hostFile,bridgeFile,hostFile.replace(/exe$/u,'dll'),bridgeFile.replace(/exe$/u,'dll'),
    'apps/runtime/dist/application/runtime-application.js','apps/runtime/dist/application/authorization-question.js',
    'apps/runtime/dist/application/windows-host-adapter.js'])receipt.artifactHashes[file]=sha(await readFile(path.join(root,file)));
  const namespace='public-native-'+randomUUID(),text='PersonalAgent public native acceptance '+randomUUID()+'.';
  receipt.publicTextDigest=sha(text);receipt.isolatedJournal=true;
  const realTransport=createWindowsHostBridgeTransport({hostPath:path.join(root,hostFile),bridgePath:path.join(root,bridgeFile),journalDirectory});
  const transport={close:()=>realTransport.close(),async openVerifiedConnection(){const connection=await realTransport.openVerifiedConnection();return {
    close:()=>connection.close(),async send(frame){if(frame.kind==='bind')counts.bind++;return connection.send(frame);},
    async exchange(frame){if(frame.kind==='hello')counts.hello++;if(frame.kind==='observe')counts.observe++;
      if(frame.kind==='target_ready')counts.targetReady++;if(frame.kind==='execute')counts.execute++;
      const reply=await connection.exchange(frame);if(reply?.kind==='observed')counts.observed++;
      if(reply?.kind==='result'&&reply.state==='verified')counts.verified++;return reply;}};}};
  question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),
    getApplication:()=>application,namespace,resolveConversation:id=>application.runtime.getTask(id).conversationId,
    available:()=>false,profiles:[{ref:'manual-full',label:'Explicit public native acceptance',mode:'full-access',revision:1,
      available:true,kind:'application_policy'}],defaultProfileRef:'manual-full'});
  host=createDesktopNotepadHost({createAdapter:createWindowsHostNotepadAdapter,createAttempts:createRuntimeWindowsHostAttemptStore,
    transport,isFullAccess:()=>question.automaticallyApproves(),readPolicyBinding:()=>{const selected=question.sandboxSnapshot().selected;
      return JSON.stringify([selected.mode,selected.revision]);},
    registerConfirmation:()=>{counts.nativeShortcutRegistrations++;throw Error('F9 is forbidden in this acceptance');},
    respond:()=>{counts.manualApprovalResponses++;throw Error('Only original Runtime question callback may approve');},
    cancelTask:id=>client.call('task.cancel',{taskId:id,reason:'Public native acceptance stopped'}),
    openNotepad:({signal})=>new Promise((resolve,reject)=>{if(signal.aborted){reject(Error('Cancelled'));return;}
      counts.openedNotepad++;const child=spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32','notepad.exe'),[],
        {windowsHide:false,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});})});
  application=createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:namespace,tools:host.tools,requiresToolAuthorization:()=>true,
    requestToolAuthorization:scope=>question.requestToolAuthorization(scope)});
  host.bind(application);const client=new Client(application);await client.connect();
  receipt.stage='native-target-and-write';taskId=host.start({text}).taskId;
  await settle(async()=>{await host.refresh();return !host.snapshot().busy&&application.activeTaskCount===0;});
  const local=host.snapshot();receipt.taskId=taskId;receipt.taskState=application.runtime.getTask(taskId).state;
  if(local.state!=='succeeded')throw Object.assign(Error('Native target or execution was not confirmed'),{code:local.failureCode??'EXTERNAL_FAILURE'});
  const read=application.readHostToolTask(taskId),records=application.runtime.readToolExecutions(taskId);
  receipt.taskId=taskId;receipt.taskState=read.task.state;receipt.failureCode=host.snapshot().failureCode??read.task.error?.code??null;
  assert.equal(read.task.state,'succeeded');assert.equal(read.confirmed.result.state,'verified');
  assert.equal(records.length,1);assert.equal(records[0].policyDecision,'allow');assert.equal(records[0].state,'confirmed');
  assert.equal(records[0].executionStarted,true);assert.equal(application.runtime.policy.get(read.confirmed.runId).usesRemaining,0);
  const state=application.runtime.bindTrustedHostState('desktop-authorization:'+sha(namespace)).get('state');
  const decisions=state.questions.filter(item=>item.taskId===taskId);
  assert.equal(decisions.length,1);assert.equal(decisions[0].automatic,'full-access');assert.equal(decisions[0].decision,'allow_once');
  assert.equal(decisions[0].consumed.tool,read.confirmed.runId+':tool');
  assert.equal(question.snapshot().length,0);assert.equal(counts.nativeShortcutRegistrations,0);assert.equal(counts.manualApprovalResponses,0);
  assert.equal(counts.openedNotepad,1);assert.equal(counts.execute,1);assert.equal(counts.verified,1);assert.equal(counts.targetReady,1);
  const journal=(await readFile(path.join(journalDirectory,'runs.jsonl'),'utf8')).trim().split(/\r?\n/u).map(line=>JSON.parse(line));
  assert.equal(journal.length,2);assert.ok(journal.every(row=>row.Identity.TaskId===taskId&&row.Identity.RunId===read.confirmed.runId));
  assert.equal(journal.at(-1).Terminal,true);assert.equal(journal.at(-1).State,'verified');
  assert.equal(journal.at(-1).EvidenceRef,read.confirmed.result.hostEvidenceRef);receipt.isolatedJournalReadback=true;
  receipt.state='passed';receipt.stage='complete';receipt.runId=read.confirmed.runId;receipt.nativeReadbackVerified=true;
  receipt.exactGrantConsumed=true;receipt.automaticDecision='full-access';receipt.evidenceRefs=read.confirmed.evidenceRefs;
  receipt.evidence=application.runtime.readEvidence(taskId).map(item=>({evidenceId:item.evidenceId,verification:item.verification}));
  receipt.publicWindowLeftOpen=true;receipt.fileSaved=false;receipt.formalMainCompositionVerified=false;
}catch(error){receipt.failureCode=['UNAUTHORIZED','NOT_FOUND','CANCELLED','TIMEOUT','PROTOCOL_MISMATCH','EXTERNAL_FAILURE','RESULT_UNKNOWN'].includes(error?.code)
  ?error.code:receipt.failureCode??'ASSERTION_OR_HOST_FAILURE';process.exitCode=1;
  receipt.failureOrigin=String(error?.stack??'').split('\n').slice(1,5).map(line=>{
    const match=line.match(/(?:file:\/\/\/)?([A-Za-z]:[^()]+\.(?:mjs|js)):(\d+):(\d+)/u);
    return match?{file:path.relative(root,fileURLToPath(new URL('file:///'+match[1].replaceAll('\\','/')))),line:Number(match[2])}:null;
  }).filter(Boolean);
  try{const snapshot=host?.snapshot();if(snapshot?.taskId){receipt.taskId=snapshot.taskId;receipt.taskState=application.runtime.getTask(snapshot.taskId).state;}}
  catch{/* Only the isolated task's safe status is eligible. */}
}finally{
  if(host){try{await host.cancel();await settle(()=>application.activeTaskCount===0,10000);await host.close();}catch{receipt.cleanupConfirmed=false;process.exitCode=1;}}
  question?.close();application?.close();receipt.counts=counts;
  if(directory){try{const allowed=new Set(['BaselineUnqueryable','ProcessUnqueryable','ProcessExited','UntrustedImage',
      'NoFreshWindow','MultipleFreshWindows','IdentityChanged','MetadataRejected','Observed']);
    receipt.observationStages=(await readFile(path.join(directory,'userData','windows-host','observation-diagnostic.jsonl'),'utf8'))
      .trim().split(/\r?\n/u).map(line=>JSON.parse(line)?.stage).filter(value=>allowed.has(value)).slice(-20);
  }catch{/* A pre-native refusal has no native diagnostic. */}}
  if(directory){await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});}
  console.log(JSON.stringify({...receipt,receiptDirectory:directory?path.relative(root,directory):null}));
}
