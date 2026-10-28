/* Manual acceptance of the production Desktop conversation and coding tools.
 * No FakeCoordination, synthetic tool, scripted model answer, private mailbox,
 * deployment, or dedicated F15 runner is used. Native selectors/consent are
 * automated only for this newly created public fixture; Policy stays original.
 */
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {DatabaseSync} = require('node:sqlite');
const os=require('node:os');

const root = path.resolve(__dirname, '../../..');
const desktop = path.join(root, 'apps/desktop');
const sha = value => createHash('sha256').update(value).digest('hex');
const fileSha = file => sha(fs.readFileSync(file));
const terminal = state => ['succeeded', 'failed', 'cancelled'].includes(state);
const fixtureName = 'pelican.svg';
const checkName = 'pelican.test.cjs';
const workflowMode=process.argv.includes('--workflow');
const neutralize = text => text.replace(/<animateTransform\b[^>]*>/g,
  tag => tag.replace(/\sbegin="[^"]*"/, ''));
const ownedDesktops=new WeakMap();
async function bounded(operation,milliseconds,label){
  let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error(label)),milliseconds);
  })]);}finally{clearTimeout(timer);}
}
const evaluateBounded=(target,fn,argument,milliseconds=10_000)=>bounded(()=>target.evaluate(fn,argument),milliseconds,
  'Owned Desktop evaluation did not finish before its deadline');

function windowsOwnedProcess(binding,terminate=false,run=spawnSync){
  assert.ok(Number.isSafeInteger(binding.pid)&&binding.pid>0&&binding.pid<=0xffffffff,'valid owned PID required');
  const encoded=Buffer.from(JSON.stringify(binding),'utf8').toString('base64');
  const script=`$ErrorActionPreference='Stop'
$binding=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$owned=$null
try {
  try { $owned=[Diagnostics.Process]::GetProcessById([int]$binding.pid); $null=$owned.Handle }
  catch [ArgumentException] { Write-Output '{"state":"exited"}'; exit 0 }
  $ticks=$owned.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
  $image=$owned.MainModule.FileName
  ${terminate?`if($ticks -ne $binding.startTicks -or -not [string]::Equals($image,$binding.executablePath,[StringComparison]::OrdinalIgnoreCase)) {
    Write-Output '{"state":"identity-mismatch"}'; exit 0
  }
  # Keep the original process handle open through taskkill, preventing PID reuse.
  & 'C:\\Windows\\System32\\taskkill.exe' /PID $binding.pid /T /F 1>$null 2>$null
  if(-not $owned.WaitForExit(3000)) { throw 'Owned process did not stop' }
  Write-Output '{"state":"terminated"}'`:`$metadata=Get-CimInstance Win32_Process -Filter ('ProcessId='+$binding.pid)
  @{state='alive';pid=$owned.Id;parentPid=[int]$metadata.ParentProcessId;startTicks=$ticks;executablePath=$image} | ConvertTo-Json -Compress`}
} finally { if($owned) { $owned.Dispose() } }`;
  const result=run('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {encoding:'utf8',windowsHide:true,shell:false,timeout:15_000,maxBuffer:8192,
      env:{SystemRoot:'C:\\Windows',windir:'C:\\Windows',TEMP:os.tmpdir(),TMP:os.tmpdir()}});
  assert.ok(!result.error&&result.status===0&&!result.signal,'owned process identity/control query failed');
  let value;try{value=JSON.parse(result.stdout);}catch{throw Error('Invalid owned process identity receipt');}
  assert.ok(value&&['alive','exited','terminated','identity-mismatch'].includes(value.state),'Invalid owned process identity receipt');
  if(value.state==='alive')assert.ok(value.pid===binding.pid&&/^\d{17,19}$/u.test(value.startTicks)
    &&typeof value.executablePath==='string'&&path.isAbsolute(value.executablePath),'Invalid owned process identity receipt');
  return value;
}
function trackOwnedDesktop(app,{executablePath,mainProcessId},attempt,started=Date.now(),{inspect=windowsOwnedProcess,terminate=binding=>windowsOwnedProcess(binding,true)}={}){
  const child=app.process();assert.ok(child&&Number.isSafeInteger(child.pid)&&typeof child.kill==='function','original runner ChildProcess required');
  const pid=mainProcessId??child.pid;
  assert.ok(Number.isSafeInteger(pid)&&pid>0,'valid owned Electron main PID required');
  const record={child,pid,attempt,inspect,terminate,identity:undefined};ownedDesktops.set(app,record);
  attempt.processIdentity={pid,launcherPid:child.pid,state:'unconfirmed'};
  const identity=inspect({pid});
  assert.equal(identity.state,'alive','owned Desktop must still be alive when tracked');
  assert.equal(identity.pid,pid,'owned main process PID mismatch');
  if(pid!==child.pid)assert.equal(identity.parentPid,child.pid,'owned Electron must descend from its original launcher');
  assert.equal(path.resolve(identity.executablePath).toLowerCase(),path.resolve(executablePath).toLowerCase(),'owned executable identity mismatch');
  const createdMs=Number((BigInt(identity.startTicks)-621355968000000000n)/10000n);
  assert.ok(createdMs>=started-2000&&createdMs<=Date.now()+2000,'owned process start identity mismatch');
  record.identity=identity;
  attempt.processIdentity={pid,launcherPid:child.pid,state:'verified',createdAt:new Date(createdMs).toISOString(),
    executablePathDigest:sha(path.resolve(identity.executablePath).toLowerCase())};
  return record;
}
async function waitOwnedExit(child,milliseconds){
  if(child.exitCode!==null&&child.exitCode!==undefined||child.signalCode)return true;
  let listener;try{return await bounded(()=>new Promise(resolve=>{listener=()=>resolve(true);child.once('exit',listener);}),
    milliseconds,'Owned Desktop process exit did not finish');}catch{return false;}finally{if(listener)child.off('exit',listener);}
}

function regularFile(file, label) {
  assert.ok(typeof file === 'string' && path.isAbsolute(file), label + ' needs an absolute path');
  assert.ok(!fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isFile(), label + ' must be a regular file');
  return fs.realpathSync.native(file);
}

function fixtureFileSet(workspace) {
  return fs.readdirSync(workspace).map(name=>{
    const info=fs.lstatSync(path.join(workspace,name));
    assert.ok(info.isFile()&&!info.isSymbolicLink(),
      'the public fixture workspace may contain only its original regular source/test/config files');
    return name;
  }).sort();
}

function publicChecker(geometryDigest) {
  return `const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
test('original public Pelican geometry and three active animations',()=>{
  const text=fs.readFileSync(${JSON.stringify(fixtureName)},'utf8');
  const tags=[...text.matchAll(/<animateTransform\\b[^>]*>/g)].map(match=>match[0]);
  assert.equal(tags.length,3);
  assert.deepEqual(tags.map(tag=>/\\bid="([^"]+)"/.exec(tag)?.[1]).sort(),['back-spin','front-spin','pedal-spin']);
  const begins=tags.map(tag=>/\\bbegin="([^"]*)"/.exec(tag)?.[1]??'0s');
  assert.ok(begins.every(value=>['0','0s','0ms'].includes(value)),'pelican_animation_not_started');
  const neutral=text.replace(/<animateTransform\\b[^>]*>/g,tag=>tag.replace(/\\sbegin="[^"]*"/,''));
  assert.equal(createHash('sha256').update(neutral).digest('hex'),${JSON.stringify(geometryDigest)},'geometry or unrelated bytes changed');
  console.log('pelican-verification:'+JSON.stringify({geometryPreserved:true,animationCount:3,begins}));
});
`;
}

async function waitUntil(check, deadline, label) {
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error(label + ' did not reach the required state before its deadline');
}

async function pageFor(app, mode, timeoutMs=30_000) {
  return waitUntil(() => app.windows().find(page => page.url().includes('mode=' + mode)),
    Date.now() + timeoutMs, 'Desktop ' + mode);
}
const waitForStartupWindow=(app,mode)=>pageFor(app,mode,120_000);
function startupOutputMetadata(line){
  const match=/^PersonalAgent startup (\{.*\})$/u.exec(line);if(!match)return;
  let value;try{value=JSON.parse(match[1]);}catch{return;}
  if(!value||Array.isArray(value))return;
  const runtime=['idle','starting','ready','failed','configuration_required'].includes(value.runtime)?value.runtime:'unknown';
  const safe={runtime};
  for(const key of ['agentArtsConfigured','liveConfigured','liveReady','liveShortcutRegistered','sisConfigured','sisReady'])
    if(typeof value[key]==='boolean')safe[key]=value[key];
  return safe;
}

async function snapshot(page) {
  let timer;
  const response = await Promise.race([page.evaluate(() => window.desktop.invoke('snapshot')),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Original Desktop renderer snapshot did not respond')),10_000);})])
    .finally(()=>clearTimeout(timer));
  assert.equal(response.ok, true, 'production Desktop snapshot must succeed');
  return response.value;
}

async function closeDesktop(app) {
  const owned=ownedDesktops.get(app);assert.ok(owned,'refusing cleanup of an unowned Desktop');
  if(owned.closing)return owned.closing;
  owned.closing=(async()=>{
    const started=Date.now(),cleanup=owned.attempt.cleanup={state:'closing',phases:[]};
    const phase=name=>cleanup.phases.push({phase:name,elapsedMs:Date.now()-started});
    try {
      phase('graceful-close');await bounded(()=>app.close(),10_000,'Owned Desktop normal quit timed out').catch(()=>{});
      const launcherExited=await waitOwnedExit(owned.child,500);
      // On Windows Playwright owns cmd.exe; its exit alone cannot prove that the
      // connected Electron and its renderers stopped.
      const mainExited=owned.identity&&owned.pid!==owned.child.pid
        ?owned.inspect(owned.identity).state==='exited':launcherExited;
      if(launcherExited&&mainExited){cleanup.method='graceful';cleanup.mainProcessExited=true;return;}
      phase('verified-owned-tree-termination');
      if(owned.identity){const result=owned.terminate(owned.identity);
        assert.ok(['terminated','exited'].includes(result.state),'owned process identity changed; foreign process tree was not touched');
        cleanup.method='verified-owned-tree';
      }else{owned.child.kill('SIGKILL');cleanup.method='original-owned-child';}
      assert.equal(await waitOwnedExit(owned.child,3000),true,'Owned Desktop process did not exit after bounded cleanup');
      assert.ok(owned.identity,'owned child stopped; descendant identity remains unconfirmed');
      if(owned.pid!==owned.child.pid)assert.equal(owned.inspect(owned.identity).state,'exited','Owned Electron did not exit after bounded cleanup');
      cleanup.mainProcessExited=true;
    }finally{cleanup.elapsedMs=Date.now()-started;cleanup.processExited=owned.child.exitCode!==null&&owned.child.exitCode!==undefined||Boolean(owned.child.signalCode);
      cleanup.state=cleanup.processExited&&cleanup.mainProcessExited&&cleanup.method?'closed':'unconfirmed';}
  })();
  return owned.closing;
}

async function openSettings(session, section) {
  assert.ok(['environment','connections','models','memory'].includes(section),'only the declared settings pages may be opened');
  const entry={requested:section,state:'pending'};
  if(session.report)(session.report.settingsNavigation??=[]).push(entry);
  let admin;
  try {
    const response = await evaluateBounded(session.panel,page => window.desktop.invoke('admin.open', {page}), section);
    assert.equal(response.ok, true, 'production settings must open');
    admin = await pageFor(session.app, 'admin');
    const host=(await snapshot(admin)).adminNavigation;
    assert.ok(Number.isSafeInteger(host?.revision)&&host.revision>=0,'original host navigation revision must be available');
    entry.host={page:host.page,revision:host.revision};
    // IPC acceptance and the old sidebar highlight are not render completion.
    // First consume the host revision, then use the ordinary sidebar if needed.
    await admin.waitForFunction(revision=>Number(document.querySelector('.main')?.dataset.navigationRevision)>=revision
      &&document.querySelector('.main')?.getAttribute('aria-busy')==='false',host.revision);
    const navigation=admin.locator(`.side [data-page="${section}"]`);
    await navigation.waitFor({state:'visible'});
    if(await navigation.getAttribute('aria-current')!=='page')await navigation.click();
    await admin.waitForFunction(({page,revision})=>{
      const main=document.querySelector('.main');
      return main?.dataset.section===page&&main.getAttribute('aria-busy')==='false'
        &&Number(main.dataset.navigationRevision)>=revision&&document.querySelector('#content')?.dataset.section===page
        &&document.querySelector(`.side [data-page="${page}"]`)?.getAttribute('aria-current')==='page';
    },{page:section,revision:host.revision});
    const control=section==='environment'?'[data-workspace="select"]'
      :['connections','memory'].includes(section)?'[data-laya="start"]':'#content .model-page';
    await admin.locator(control).waitFor({state:'visible'});
    entry.observed=await settingsNavigationState(admin);
    assert.equal(entry.observed.section,section,'the completed settings body must match the requested page');
    assert.equal(entry.observed.contentSection,section,'the settings content must match the requested page');
    entry.state='ready';
    return admin;
  } catch(error) {
    entry.state='failed';
    if(admin)entry.observed=await settingsNavigationState(admin).catch(()=>({state:'unavailable'}));
    throw error;
  }
}

async function settingsNavigationState(admin) {
  return evaluateBounded(admin,()=>{
    const pages=['settings','import','profile','appearance','voice','notifications','configuration','personalization','pets',
      'shortcuts','usage','analytics','account','computer','capabilities','browser','hooks','connections','git','environment',
      'worktrees','tasks','authorizations','models','memory','archive','overview'];
    const page=value=>pages.includes(value)?value:'unknown';
    const main=document.querySelector('.main'),content=document.querySelector('#content');
    const control=selector=>{
      const element=document.querySelector(selector);
      if(!element)return{attached:false,visible:false};
      const bounds=element.getBoundingClientRect(),style=getComputedStyle(element);
      return{attached:element.isConnected,visible:element.checkVisibility(),enabled:!element.disabled,
        hiddenAncestor:Boolean(element.closest('[hidden]')),display:style.display,visibility:style.visibility,
        width:Math.round(bounds.width),height:Math.round(bounds.height)};
    };
    const revision=Number(main?.dataset.navigationRevision);
    return{section:page(main?.dataset.section),contentSection:page(content?.dataset.section),
      navigationRevision:Number.isSafeInteger(revision)&&revision>=0?revision:null,
      selected:page(document.querySelector('.side [data-page][aria-current="page"]')?.dataset.page),
      busy:main?.getAttribute('aria-busy')??'unknown',layaStart:control('[data-laya="start"]'),
      workspaceSelect:control('[data-workspace="select"]')};
  });
}

async function originalQuestionBinding(database,sourceTaskId,question,{publicReadPaths=[fixtureName,checkName,'package.json'],
  publicWritePaths=[fixtureName]}={}) {
  const {toolArgumentsDigest}=await import('@personal-agent/tool-gateway');
  const db=new DatabaseSync(database,{readOnly:true});
  try {
    const load=(id,key)=>{const row=db.prepare('SELECT value_json FROM task_checkpoints WHERE task_id=? AND checkpoint_key=?').get(id,key);
      return row?JSON.parse(row.value_json):undefined;};
    let ancestor=question.taskId;const seen=new Set();
    while(ancestor!==sourceTaskId&&seen.size<32&&!seen.has(ancestor)) {
      seen.add(ancestor);ancestor=load(ancestor,'coding-repair:parent')?.taskId??load(ancestor,'subtask-parent')?.parentTaskId;
      if(!ancestor)break;
    }
    assert.equal(ancestor,sourceTaskId,'only descendants of this new original main turn may receive an automated decision');
    const original=load(question.taskId,'application-tool-invocation:'+question.sourceApprovalId);
    assert.ok(original&&original.toolName===question.toolName,'the question must name its original pending tool invocation');
    assert.equal(original.argumentsDigest,toolArgumentsDigest(original.arguments),'the original exact arguments must remain bound');
    assert.ok(Date.parse(question.expiresAt)<=Date.parse(original.deadline),'a question cannot extend the original operation deadline');
    if(['workspace.read_text','coding.repair.read'].includes(question.toolName))assert.ok(
      publicReadPaths.includes(original.arguments.path),
      'source export is restricted to the declared original public fixture files');
    if(['workspace.preview_text_patch','workspace.stage_text_patch','workspace.apply_text_patch'].includes(question.toolName))
      assert.ok(publicWritePaths.includes(original.arguments.path),'patches are restricted to the original public fixture source files');
    if(question.toolName==='workspace.list_entries')assert.equal(original.arguments.path,'.',
      'directory metadata export is restricted to the new public fixture root');
    if(question.toolName==='subagent.team.dispatch') {
      const coordinator=load(question.taskId,'subtask-parent');
      assert.ok(coordinator?.parentTaskId===sourceTaskId&&coordinator.subtaskId==='user-work',
        'only this original default worker may dispatch the fixture team');
      assert.ok(Array.isArray(original.arguments.subtasks)&&original.arguments.subtasks.length===1
        &&original.arguments.subtasks[0].role==='coder','the fixture team may contain only its one coding member');
    }
    return {argumentsDigest:original.argumentsDigest,deadline:original.deadline};
  } finally {db.close();}
}

async function readAllowedOriginalQuestion(database,sourceTaskId,pending,observed,binding,boundary) {
  assert.deepEqual(await originalQuestionBinding(database,sourceTaskId,observed,boundary),binding,'the original invocation binding must remain unchanged');
  const db=new DatabaseSync(database,{readOnly:true});
  try {
    db.exec('PRAGMA query_only=ON');
    const fields=['questionId','taskId','runId','conversationId','toolName','revision','state','decision','receiptRef',
      'argumentsDigest','deadline','expiresAt','baseSandboxRef','sandbox','requirements'];
    const rows=db.prepare('SELECT '+fields.map(key=>`json_extract(q.value,'$.${key}') AS ${key}`).join(',')
      +",json_extract(h.value_json,'$.revision') AS selectedRevision,json_extract(h.value_json,'$.selectedRef') AS selectedRef"
      +" FROM trusted_host_state h,json_each(h.value_json,'$.questions') q WHERE h.namespace LIKE 'desktop-authorization:%'"
      +" AND h.state_key='state' AND json_extract(q.value,'$.questionId')=?").all(pending.questionId);
    assert.equal(rows.length,1,'one exact original persisted question must exist');const saved=rows[0];
    for(const key of ['questionId','taskId','conversationId','toolName','expiresAt'])assert.equal(saved[key],pending[key],'persisted question binding changed');
    assert.equal(saved.runId,pending.sourceApprovalId,'persisted original run changed');
    assert.equal(saved.state,'allowed','only a real allowed host decision may continue');
    assert.ok(Number.isSafeInteger(saved.revision)&&saved.revision>pending.revision&&saved.revision===observed.revision,'allowed question revision must advance');
    assert.ok(['allow_once','allow_task','allow_always'].includes(saved.decision)&&typeof saved.receiptRef==='string'&&saved.receiptRef,
      'a persisted exact allowed receipt is required');
    assert.equal(saved.argumentsDigest,binding.argumentsDigest,'persisted original arguments changed');
    assert.equal(saved.deadline,binding.deadline,'persisted original deadline changed');
    assert.ok(Date.parse(saved.deadline)>Date.now()&&Date.parse(saved.expiresAt)>Date.now(),'original question deadline expired');
    const sandbox=JSON.parse(saved.sandbox);assert.equal(saved.selectedRevision,sandbox.revision,'selected sandbox revision changed');
    assert.equal(saved.selectedRef,saved.baseSandboxRef??sandbox.ref,'selected sandbox changed');
    assert.equal(sandbox.revision,pending.sandbox.revision,'original question sandbox revision changed');
    assert.deepEqual(JSON.parse(saved.requirements).map(({requirementId,kind,summary,scopes})=>({requirementId,kind,summary,scopes})),
      pending.requirements,'persisted original requirements changed');
    return saved.decision;
  } finally {db.close();}
}

async function approveOriginalQuestion(panel,pending,{verifyAllowed,onObservation=()=>{}}={}) {
  await panel.bringToFront();
  const decision=pending.canReuseTask===true&&pending.suggestedDecision==='allow_task'?'allow_task':'allow_once';
  const deadline=Math.min(Date.now()+30_000,Date.parse(pending.expiresAt));let runnerClicked=false;
  while(Date.now()<deadline){
    // Fresh host state and the exact DOM are checked together on every poll.
    const observed=await evaluateBounded(panel,async({expected,decision,activate,deadline})=>{
    let timer;
    const response=await Promise.race([window.desktop.invoke('snapshot'),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('Original question snapshot did not respond before its deadline')),
        Math.max(1,Math.min(10_000,deadline-Date.now())));
    })]).finally(()=>clearTimeout(timer));
    const current=response.ok&&response.value.authorizationQuestions?.find(item=>item.questionId===expected.questionId);
    if(!current||Date.parse(current.expiresAt)<=Date.now()
      ||['questionId','taskId','sourceApprovalId','conversationId','toolName','expiresAt'].some(key=>current[key]!==expected[key])
      ||current.canReuseTask!==expected.canReuseTask||current.suggestedDecision!==expected.suggestedDecision
      ||JSON.stringify(current.requirements)!==JSON.stringify(expected.requirements)
      ||JSON.stringify(current.sandbox)!==JSON.stringify(expected.sandbox))throw Error('Original question binding changed before activation');
    const activeConversationId=response.value.conversationState?.activeId;
    const domConversationId=document.querySelector('[data-session-list]')?.value??null;
    if(activeConversationId!==expected.conversationId||domConversationId!==null&&domConversationId!==expected.conversationId)
      throw Error('Original question is not in the active panel conversation');
    const metadata={activeConversationId,domConversationId,state:current.state,revision:current.revision};
    if(current.state==='allowed'){
      if(!Number.isSafeInteger(current.revision)||current.revision<=expected.revision)throw Error('Allowed question revision did not advance');
      return{...metadata,current,activated:false};
    }
    if(current.state!=='pending')throw Error('Original question ended without allowance');
    if(current.revision!==expected.revision)throw Error('Original question binding changed before activation');
    const card=[...document.querySelectorAll('[data-question-id]')].find(node=>node.dataset.questionId===expected.questionId);
    if(decision==='allow_task'&&(current.canReuseTask!==true||current.suggestedDecision!=='allow_task'))throw Error('Original task consent is unavailable');
    const element=card?.querySelector(`[data-authorization-decision="${decision}"]`);
    if(!element||!activate)return{...metadata,activated:false};
    element.scrollIntoView?.({block:'center'});
    const bounds=element.getBoundingClientRect(),style=getComputedStyle(element);
    if(!element.isConnected||element.disabled||bounds.width<=0||bounds.height<=0
      ||bounds.bottom<=0||bounds.top>=innerHeight||bounds.right<=0||bounds.left>=innerWidth
      ||style.display==='none'||style.visibility!=='visible'
      ||element.dataset.authorizationDecision!==decision)return{...metadata,activated:false};
    element.click();
    return{...metadata,activated:true};
    },{expected:pending,decision,activate:!runnerClicked,deadline});
    onObservation({activeConversationId:observed.activeConversationId,domConversationId:observed.domConversationId,
      state:observed.state,revision:observed.revision,runnerClicked:runnerClicked||observed.activated});
    runnerClicked||=observed.activated;
    if(observed.state==='allowed'){
      assert.equal(typeof verifyAllowed,'function','original persisted allowed receipt verification is required');
      const actual=await verifyAllowed(observed.current);
      assert.ok(['allow_once','allow_task','allow_always'].includes(actual),'actual persisted allowed decision is required');
      return{decision:actual,observedRevision:observed.revision,decisionSource:runnerClicked?'runner_ui_activation':'observed_existing',
        runnerClicked,physicalHumanClick:runnerClicked?false:'unknown'};
    }
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw Error('Original question did not become actionable or allowed before its deadline');
}

async function installPublicDialogAutomation(app, inputs) {
  await evaluateBounded(app,({dialog}, values) => {
    const originalOpen = dialog.showOpenDialog.bind(dialog);
    const originalMessage = dialog.showMessageBox.bind(dialog);
    const selections = new Map([
      ['选择允许 PersonalAgent 使用的编程工作区', values.workspace],
      ['选择可信安装目录中的 Node 可执行文件', values.node],
      ['选择可信 Node 安装目录中的 npm-cli.js', values.npm],
      ['选择此工作区内需要语法检查的文件', values.check],
    ]);
    globalThis.__pelicanNativeActions = [];
    dialog.showOpenDialog = async (...args) => {
      const options = args.at(-1);
      const selected = selections.get(options?.title);
      if (!selected) return originalOpen(...args);
      globalThis.__pelicanNativeActions.push({kind:'public_fixture_selection', title:options.title});
      return {canceled:false, filePaths:[selected]};
    };
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1);
      // Unexpected requests receive no extra authorization and remain observable.
      if (options?.type === 'question') {
        globalThis.__pelicanNativeActions.push({kind:'unrecognized_question',allowed:false});
        return {response:options.cancelId ?? 0,checkboxChecked:false};
      }
      return originalMessage(...args);
    };
  }, inputs);
}

function electronLaunchOptions({executablePath,userData},inheritedEnvironment=process.env) {
  const loader=regularFile(path.join(path.dirname(require.resolve('playwright-core/package.json')),
    'lib/server/electron/loader.js'),'Pinned Playwright Electron readiness loader');
  const environment = {...Object.fromEntries(Object.entries(inheritedEnvironment).filter(([key])=>!/^PA_/i.test(key))),ELECTRON_RUN_AS_NODE:undefined,
    PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_USER_DATA_DIR:undefined,
    PA_DESKTOP_TEST_USER_DATA:userData,PA_DESKTOP_MODEL_MODE:undefined,
    PA_DESKTOP_EPHEMERAL_MODEL:undefined,PA_DESKTOP_SYNTHETIC_MVP:undefined,
    PA_DESKTOP_SYNTHETIC_FACT_SOURCE:undefined,PA_DEVELOPER_CONFIG_FILE:undefined,
    PA_AGENTARTS_INVOKE_MODE:'published',PA_AGENTARTS_RESPONSE_MODE:'tool-proposal-json'};
  // Playwright adds this gate automatically only when executablePath is absent.
  // The explicit trusted Electron must pause app.ready until both CDP channels
  // and the original Electron application handle have attached.
  return {executablePath,args:['-r',loader,desktop,
    '--pa-public-pelican-acceptance='+path.basename(path.dirname(userData))],env:environment};
}

async function launch({executablePath,userData,workspace,node,npm}, report) {
  const {_electron} = require('playwright');
  const started=Date.now(),attempt={sequence:(report.launchAttempts?.length??0)+1,state:'starting',phase:'electron-launch',
    readinessGate:'pinned-playwright-electron-loader',uiStartupTimeoutMs:120_000,phases:[],startupOutput:[]};
  const mark=phase=>{attempt.phase=phase;attempt.phases.push({phase,elapsedMs:Date.now()-started});};
  mark('electron-launch');
  (report.launchAttempts??=[]).push(attempt);let app,stdout,onOutput,buffer='';
  try {
    app=await _electron.launch(electronLaunchOptions({executablePath,userData}));
    mark('electron-connected');
    const mainProcessId=await evaluateBounded(app,()=>process.pid);
    trackOwnedDesktop(app,{executablePath,mainProcessId},attempt,started);
    stdout=app.process()?.stdout;
    onOutput=chunk=>{
      buffer+=chunk.toString('utf8');
      const lines=buffer.split(/\r?\n/u);buffer=lines.pop().slice(-8192);
      for(const line of lines){const metadata=startupOutputMetadata(line);
        if(metadata&&attempt.startupOutput.length<3)attempt.startupOutput.push({...metadata,elapsedMs:Date.now()-started});}
    };
    stdout?.on('data',onOutput);
    assert.equal(await evaluateBounded(app,()=>typeof globalThis.__playwright_run==='function'),true,
      'the pinned Playwright ready gate must be installed before production Desktop startup');
    await installPublicDialogAutomation(app,{workspace,node,npm,check:path.join(workspace,checkName)});
    mark('orb-wait');
    const orb = await waitForStartupWindow(app,'orb');
    mark('orb-ready');
    const opened = await evaluateBounded(orb,() => window.desktop.invoke('orb.open'));
    assert.equal(opened.ok,true,'production main conversation must open');
    mark('panel-wait');
    const panel = await waitForStartupWindow(app,'panel');
    mark('panel-window-ready');
    await panel.waitForSelector('#send',{timeout:120_000});
    mark('panel-renderer-ready');
    const value = await snapshot(panel);
    assert.equal(value.fake,false,'Fake Runtime is forbidden');
    assert.equal(value.fakeModel,false,'Fake model is forbidden');
    report.target={configured:value.agentArts?.configured===true,
      deploymentVersion:value.agentArts?.deploymentVersion??'',transport:value.agentArts?.effectiveTransport??'unknown',
      urlEndpoint:(()=>{try{return new URL(value.agentArts?.websocketUrl).searchParams.get('endpoint')??'';}catch{return '';}})(),
      platformVersionReadback:'not_run'};
    report.launches = (report.launches ?? 0) + 1;
    attempt.state='ready';mark('panel-ready');attempt.elapsedMs=Date.now()-started;
    return {app,panel,orb,report};
  } catch(error) {
    attempt.state='failed';attempt.elapsedMs=Date.now()-started;
    attempt.failure={message:String(error?.message??'Owned Desktop startup failed').replace(/[A-Z]:[\\/][^\n]+/gi,'[local path]')};
    if(app)try{await closeDesktop(app);}catch(cleanupError){attempt.cleanupFailure={message:String(cleanupError?.message??'Owned Desktop cleanup unconfirmed')};}
    throw error;
  } finally {stdout?.off('data',onOutput);}
}

function readDeadline(database, taskId) {
  const db = new DatabaseSync(database,{readOnly:true});
  try {
    const row = db.prepare('SELECT value_json FROM task_checkpoints WHERE task_id=? AND checkpoint_key=?')
      .get(taskId,'application-deadline');
    const deadline = row && Date.parse(JSON.parse(row.value_json));
    assert.ok(Number.isFinite(deadline),'the original UI task deadline must exist');
    return deadline;
  } finally {db.close();}
}

async function readback(database, sourceTaskId, requireComplete, {workflow=false}={}) {
  const {createRuntimeApplication} = await import('@personal-agent/runtime/application');
  const {toolArgumentsDigest}=await import('@personal-agent/tool-gateway');
  const application = createRuntimeApplication({path:database,profile:'huawei_ict_agentarts'});
  try {
    const runtime = application.runtime;
    const parent = runtime.getTask(sourceTaskId);
    const descendants = application.readSubagentTasks(sourceTaskId);
    const directTasks = [parent,...descendants.map(child=>runtime.getTask(child.taskId))];
    const graphs=directTasks.map(task=>({taskId:task.taskId,state:runtime.loadCheckpoint(task.taskId,'coding-repair:graph')}))
      .filter(graph=>graph.state);
    const originalHosts=graphs.flatMap(graph=>runtime.listCheckpointKeys(graph.taskId)
      .filter(key=>key.startsWith('coding-repair:host:'))
      .map(key=>({ownerTaskId:graph.taskId,...runtime.loadCheckpoint(graph.taskId,key)})));
    const hostIds=[...new Set(originalHosts.map(host=>host.localTaskId))];
    const tasks=[...directTasks,...hostIds.filter(id=>!directTasks.some(task=>task.taskId===id)).map(id=>runtime.getTask(id))];
    const rows = tasks.flatMap(task=>runtime.readToolExecutions(task.taskId));
    const evidence = tasks.flatMap(task=>runtime.readEvidence(task.taskId).map(item=>({taskId:task.taskId,...item})));
    const catalogs=tasks.map(task=>{
      const entries=runtime.loadCheckpoint(task.taskId,'competition-tool-catalog')?.entries??[];
      return {taskId:task.taskId,count:entries.length,tools:entries.map(entry=>entry.name)};
    });
    const executionCapacities=tasks.flatMap(task=>{
      const state=runtime.loadCheckpoint(task.taskId,'competition-execution-capacity:v1');
      return state?[{taskId:task.taskId,mode:state.mode,initialWindowSteps:state.initialWindowSteps,
        windowSteps:state.windowSteps,windowEndStep:state.windowEndStep,extensions:state.extensions,
        ...(state.maxSteps===undefined?{}:{maxSteps:state.maxSteps}),deadline:state.deadline}]:[];
    });
    const discoveryPools=tasks.flatMap(task=>{
      const pool=runtime.loadCheckpoint(task.taskId,'competition-tool-discovery-pool:v1');
      return pool?[{taskId:task.taskId,count:pool.entries.length,digest:pool.digest,
        confirmedSearches:rows.filter(row=>row.taskId===task.taskId&&row.toolName==='capability.search'
          &&row.state==='confirmed'&&row.policyDecision==='allow'&&row.executionStarted).length}]:[];
    });
    const continuationWindows=tasks.flatMap(task=>{
      const window=runtime.loadCheckpoint(task.taskId,'competition-sent-continuation-window:v1');
      return window?[{taskId:task.taskId,priorCount:window.priorCount,queryBytes:window.queryBytes}]:[];
    });
    const clouds = tasks.flatMap(task=>{
      const identity=runtime.loadCheckpoint(task.taskId,'competition-cloud-request-identity');
      return (identity?.requests??[]).map(request=>({taskId:task.taskId,...request}));
    });
    const dispatchContexts=tasks.flatMap(task=>{
      const context=runtime.loadCheckpoint(task.taskId,'competition-cloud-dispatch-context');
      if(!context)return [];
      const catalog=runtime.loadCheckpoint(task.taskId,'competition-tool-catalog');
      if(context.catalog)assert.equal(context.catalog.entriesDigest,sha(JSON.stringify(catalog?.entries)),
        'the original cloud dispatch must bind the persisted exact tool catalog');
      return [{taskId:task.taskId,requestId:context.invocation.requestId,payloadDigest:context.invocation.payloadDigest,
        phase:context.request.phase,revision:context.request.revision,step:context.loop.step,maxSteps:context.loop.maxSteps,
        catalog:context.catalog?{entriesDigest:context.catalog.entriesDigest,count:catalog.entries.length}:null}];
    });
    const records = rows.map(row=>({taskId:row.taskId,toolName:row.toolName,toolVersion:row.toolVersion,
      state:row.state,policyDecision:row.policyDecision,executionStarted:row.executionStarted,
      evidenceId:row.evidenceId}));
    const authorizationDiagnostics=tasks.flatMap(task=>runtime.listCheckpointKeys(task.taskId)
      .filter(key=>key.startsWith('coding-repair:start-failure:v1:')||key.startsWith('coding-repair:authorization-diagnostic:v1:'))
      .map(key=>{
        const saved=runtime.loadCheckpoint(task.taskId,key);
        const invocation=runtime.loadCheckpoint(task.taskId,'application-tool-invocation:'+saved.runId);
        assert.equal(saved.version,1);assert.equal(saved.authority,'diagnostic_no_tool_grant');assert.equal(saved.taskId,task.taskId);
        assert.ok(invocation,'a diagnostic must retain its original invocation');
        assert.equal(saved.toolName,invocation.toolName);assert.equal(saved.toolVersion,invocation.toolVersion);
        assert.equal(saved.argumentsDigest,toolArgumentsDigest(invocation.arguments));assert.equal(saved.deadline,invocation.deadline);
        assert.match(saved.reason,/^[a-z_]{1,64}$/);assert.ok(['isolation-start','workspace-current'].includes(saved.stage));
        return {taskId:task.taskId,runId:saved.runId,toolName:saved.toolName,toolVersion:saved.toolVersion,
          argumentsDigest:saved.argumentsDigest,deadline:saved.deadline,stage:saved.stage,reason:saved.reason,
          ...(saved.code?{code:saved.code}:{}),...(saved.resourceDigest?{resourceDigest:saved.resourceDigest}:{})};
      }));
    const localDecisions=originalHosts.filter(host=>host.request.toolName==='decision.choose_candidate').map(host=>{
      const runId='host-tool-'+host.localTaskId,args=host.request.arguments;
      const saved=runtime.loadCheckpoint(host.localTaskId,'coding-repair:local-decision:v1:'+runId);
      if(!saved){assert.ok(!requireComplete,'every original local coding decision must retain its typed diagnostic');
        return {taskId:host.localTaskId,diagnostic:'not_captured'};}
      assert.equal(saved.version,1);assert.equal(saved.taskId,host.localTaskId);assert.equal(saved.runId,runId);
      assert.equal(saved.requestId,args.requestId);assert.equal(saved.argumentsDigest,toolArgumentsDigest(args));
      assert.equal(saved.contextDigest,sha(args.context));assert.equal(saved.candidateDigest,toolArgumentsDigest(args.candidates));
      assert.equal(saved.deadline,host.request.deadline);assert.equal(saved.authority,'diagnostic_no_tool_grant');
      assert.equal(saved.selection.receipt.contextDigest,saved.contextDigest);
      const candidates=args.candidates.map(candidate=>({id:candidate.id,revision:1,kind:'noop',description:candidate.description,
        sources:[],scopeRef:args.requestId,expiresAt:host.request.deadline,risk:'low',argumentsDigest:toolArgumentsDigest({})}));
      assert.equal(saved.selection.receipt.id,toolArgumentsDigest({context:args.context,candidates}));
      assert.deepEqual(saved.selection.receipt.candidates.map(item=>({candidate:item.candidate,digest:item.digest})),
        candidates.map(candidate=>({candidate:{id:candidate.id,revision:1},digest:toolArgumentsDigest(candidate)})));
      const read=application.readHostToolTask(host.localTaskId);
      if(read.confirmed)assert.equal(saved.selectedId,read.confirmed.result.selectedId,'diagnostics cannot replace the original confirmed choice');
      const lease=runtime.loadCheckpoint(host.localTaskId,'authorization-question-export:'+runId+':workspace-metadata-export');
      if(requireComplete) {
        assert.ok(lease?.leaseRef&&lease.questionId,'the original unified decision card must produce its exact metadata export lease');
        assert.equal(lease.resultDigest,sha(JSON.stringify(read.confirmed.result)));
        assert.equal(lease.stage,'workspace-metadata-export');
      }
      return {...saved,toolExecutionState:rows.find(row=>row.taskId===host.localTaskId&&row.toolName==='decision.choose_candidate')?.state??'not_recorded',
        exportReceipt:lease?{questionId:lease.questionId,revision:lease.revision,resultDigest:lease.resultDigest,
          schemaDigest:lease.schemaDigest,policyVersion:lease.policyVersion,stage:lease.stage}:{state:'not_captured'}};
    });
    if(requireComplete) {
      assert.equal(parent.state,'succeeded','original main conversation task must succeed');
      assert.ok(descendants.length>0,'default production delegation must create an original child task');
      assert.ok(descendants.every(child=>child.state==='succeeded'),'every original child must succeed');
      const dispatch=rows.find(row=>row.taskId===sourceTaskId&&row.toolName==='subagent.dispatch');
      assert.ok(dispatch?.state==='confirmed'&&dispatch.policyDecision==='allow','original delegation must execute');
      const required=workflow?['coding.repair.start','coding.repair.read','decision.choose_candidate',
        'workflow.host.f15_n04','workflow.host.f15_n05','workflow.host.f15_n06']
        :['workspace.read_text','workspace.preview_text_patch','workspace.apply_text_patch','workspace.npm_test'];
      for(const name of required) {
        const confirmed=rows.filter(row=>row.toolName===name&&row.state==='confirmed'&&row.policyDecision==='allow'&&row.executionStarted);
        assert.ok(confirmed.length>0,'original production '+name+' must execute with Policy allow');
        for(const row of confirmed) {
          assert.ok(row.taskId!==sourceTaskId,'workspace work belongs to the delegated child');
          assert.ok(evidence.some(item=>item.taskId===row.taskId&&item.evidenceId===row.evidenceId), 'original child Evidence must persist');
          assert.ok(parent.evidenceRefs.includes(row.evidenceId),'parent must retain original child Evidence');
        }
      }
      if(workflow) {
        assert.ok(graphs.length>0,'the default UI aggregate must create its original F15 graph checkpoint');
        for(const graph of graphs) {
          const value=graph.state;
          assert.equal(value.result?.workflowId,'F15','original F15 graph identity must persist');
          assert.equal(value.result?.state,'settled','every original graph must settle');
          assert.ok(!value.pendingSend&&!value.waiting,'no unresolved F15 send or operation may pass');
          for(const id of ['01','02','03','04','05','06'])assert.equal(value.result.nodes?.['F15_N'+id]?.state,'completed',
            'every original F15 node must complete');
          assert.equal(value.result.proposals?.length,0,'settled F15 cannot retain proposals');
          const checked=value.confirmedHost?.['workflow.host.f15_n05'];
          const delivered=value.confirmedHost?.['workflow.host.f15_n06'];
          assert.ok(checked&&delivered,'original verification and native CAS publish must both persist');
          for(const entry of [checked,delivered]) {
            const read=application.readHostToolTask(entry.localTaskId);
            assert.equal(read.task.state,'succeeded','the original F15 host operation must succeed');
            assert.equal(read.commandId,entry.operationId,'the original host command identity must match');
            assert.deepEqual(read.confirmed?.result,entry.result,'original cache and graph result must match');
          }
          assert.ok(checked.result.verification?.some(receipt=>receipt.recipeId==='npm-test'
            &&receipt.status==='VALID'&&receipt.exitCode===0),'original F15 project test must actually pass');
          assert.equal(delivered.result.state,'published','original native publication must be confirmed');
          assert.ok(delivered.result.files?.some(file=>file.path===fixtureName&&file.beforeSha256!==file.afterSha256),
            'original CAS receipt must change the actual Pelican file');
        }
        for(const host of originalHosts) {
          const binding=runtime.loadCheckpoint(host.localTaskId,'coding-repair:parent');
          assert.equal(binding?.taskId,host.ownerTaskId,'every host task must retain its original F15 owner');
          const record=rows.find(row=>row.taskId===host.localTaskId&&row.toolName===host.request.toolName);
          assert.ok(record?.state==='confirmed'&&record.policyDecision==='allow','every original F15 host tool must confirm');
          assert.ok(runtime.matchesToolExecutionInput(record,{arguments:host.request.arguments,scopeRef:record.evidenceId}),
            'original host arguments must match the original ToolGateway input binding');
        }
      } else {
        const testRun=rows.find(row=>row.toolName==='workspace.npm_test'&&row.state==='confirmed'
          &&runtime.loadCheckpoint(row.taskId,'tool-result-'+row.evidenceId)?.result?.exitCode===0);
        assert.ok(testRun,'original production project test must return zero');
        const actual=runtime.loadCheckpoint(testRun.taskId,'tool-result-'+testRun.evidenceId).result;
        assert.match(actual.stdout,/pelican-verification:.*"geometryPreserved":true/,'original test output must contain its checker proof');
      }
      assert.ok(clouds.length>0,'actual default Competition cloud request identities must persist');
      assert.ok(catalogs.every(catalog=>catalog.count<=64),'production published tool catalogs must retain their public size limit');
      assert.ok(!tasks.some(task=>runtime.loadCheckpoint(task.taskId,'competition-cloud-unknown')),'no unresolved cloud result may pass');
    }
    return {parentState:parent.state,children:descendants.map(child=>({taskId:child.taskId,state:child.state})),catalogs,
      ...(workflow?{f15:graphs.map(graph=>({taskId:graph.taskId,state:graph.state.result?.state,
        nodes:Object.fromEntries(Object.entries(graph.state.result?.nodes??{}).map(([id,value])=>[id,value.state])),
        advanceCount:graph.state.sequence,hostTaskIds:originalHosts.filter(host=>host.ownerTaskId===graph.taskId).map(host=>host.localTaskId),
        verification:graph.state.confirmedHost?.['workflow.host.f15_n05']?.result?.verification,
        publication:graph.state.confirmedHost?.['workflow.host.f15_n06']?.result}))}:{}),
      executionCapacities,discoveryPools,continuationWindows,dispatchContexts,
      records,localDecisions,authorizationDiagnostics,evidenceRefs:[...new Set(evidence.map(item=>item.evidenceId))],cloudRequests:clouds};
  } finally {application.close();}
}

async function observePlayback(session, fixture, output) {
  const opened=session.app.waitForEvent('window',{timeout:10_000});void opened.catch(()=>{});
  await evaluateBounded(session.app,async ({BrowserWindow}, url)=>{
    const viewer=new BrowserWindow({show:true,width:820,height:650,
      webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    await viewer.loadURL(url);
  },pathToFileURL(fixture).href);
  const page=await opened;
  await page.waitForSelector('#wheel-back');
  const frame=()=>evaluateBounded(page,()=>({at:document.documentElement.getCurrentTime(),
    matrices:['wheel-back','wheel-front','pedal'].map(id=>{
      const matrix=document.getElementById(id).getCTM();
      return {id,a:matrix.a,b:matrix.b,c:matrix.c,d:matrix.d,e:matrix.e,f:matrix.f};
    })}));
  const first=await frame();await page.screenshot({path:path.join(output,'pelican-frame-1.png')});
  await page.waitForTimeout(200);
  const second=await frame();await page.screenshot({path:path.join(output,'pelican-frame-2.png')});
  assert.ok(second.at>first.at,'actual SVG playback clock must advance');
  assert.ok(first.matrices.every((value,index)=>Math.abs(value.a-second.matrices[index].a)
    +Math.abs(value.b-second.matrices[index].b)>0.0001),'both wheels and pedal must move in real rendered frames');
  await page.close();return {surface:'Electron Chromium SVG artifact viewer',first,second,allThreeMoved:true};
}

async function captureMode(app,mode,file) {
  let timer;
  const bytes=await Promise.race([app.evaluate(async({BrowserWindow},selected)=>{
    const window=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes('mode='+selected));
    if(!window)throw Error('Original renderer capture window is unavailable');
    const capture=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
    return capture.toPNG().toString('base64');
  },mode),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Original renderer capture did not respond')),10_000);})])
    .finally(()=>clearTimeout(timer));
  fs.writeFileSync(file,Buffer.from(bytes,'base64'));
}

async function main() {
  assert.equal(process.env.PA_MANUAL_DEFAULT_PELICAN_LIVE,'1','explicit real cloud public-fixture opt-in is required');
  assert.equal(process.platform,'win32','production native patch acceptance requires Windows');
  const executablePath=regularFile(process.env.PA_PELICAN_ELECTRON??path.join(root,'node_modules/electron/dist/electron.exe'),'Electron');
  const node=regularFile(process.env.PA_PELICAN_NODE??process.execPath,'Node');
  const npm=regularFile(process.env.PA_PELICAN_NPM_CLI,'npm CLI');
  const helper=regularFile(process.env.PA_PELICAN_JOB_HOST,'Windows Job helper');
  assert.equal(path.basename(helper).toLowerCase(),'windowsjobprocesshost.exe','original Windows Job helper is required');
  // Read-only native entrypoint check, followed by the product's own pinned host checks at execution.
  const nativeProbe=spawnSync(helper,['--query-process-start-time',String(process.pid)],
    {windowsHide:true,shell:false,encoding:'utf8'});
  assert.equal(nativeProbe.status,0,'native process identity query must execute');
  assert.match(nativeProbe.stdout.trim(),/^\d+$/,'native identity query must return original process start ticks');
  const configDirectory=process.env.PA_PELICAN_SAVED_CONFIG_DIR;
  assert.ok(configDirectory&&path.isAbsolute(configDirectory),'explicit authorized saved AgentArts configuration directory is required');
  const cache=path.join(root,'.cache');fs.mkdirSync(cache,{recursive:true});
  const output=fs.mkdtempSync(path.join(cache,'desktop-pelican-default-'));
  const workspace=path.join(output,'workspace'),userData=path.join(output,'user-data');
  fs.mkdirSync(workspace);fs.mkdirSync(userData);
  for(const name of ['agentarts-config.json','Local State'])
    fs.copyFileSync(regularFile(path.join(configDirectory,name),'approved encrypted cloud configuration'),path.join(userData,name));
  const helperDirectory=path.join(userData,'native-tools/workspace-command');fs.mkdirSync(helperDirectory,{recursive:true});
  for(const suffix of ['.exe','.dll','.deps.json','.runtimeconfig.json']) {
    const name='WindowsJobProcessHost'+suffix;
    fs.copyFileSync(regularFile(path.join(path.dirname(helper),name),'native helper artifact'),path.join(helperDirectory,name));
  }
  const baseline=fs.readFileSync(path.join(__dirname,'fixtures/pelican-animation-bug.svg'),'utf8');
  const fixture=path.join(workspace,fixtureName),checker=publicChecker(sha(neutralize(baseline)));
  fs.writeFileSync(fixture,baseline,{flag:'wx'});
  fs.writeFileSync(path.join(workspace,checkName),checker,{flag:'wx'});
  fs.writeFileSync(path.join(workspace,'package.json'),JSON.stringify({name:'public-desktop-pelican-acceptance',
    version:'1.0.0',private:true,scripts:{test:'node --test'}},null,2)+'\n',{flag:'wx'});
  const fixedFiles=Object.fromEntries([checkName,'package.json'].map(name=>[name,fileSha(path.join(workspace,name))]));
  const originalFiles=fixtureFileSet(workspace);
  assert.deepEqual(originalFiles,[fixtureName,checkName,'package.json'].sort(),'the new fixture must begin with exactly three files');
  const initial=spawnSync(node,['--test'],{cwd:workspace,encoding:'utf8',windowsHide:true,shell:false});
  assert.equal(initial.status,1,'the original public defect must reproduce before model execution');
  assert.match(initial.stdout,/pelican_animation_not_started/,'baseline failure must be the intended animation defect');
  const report={schemaVersion:1,kind:'production_desktop_default_conversation_pelican',
    profile:'huawei_ict_agentarts',startedAt:new Date().toISOString(),status:'in_progress',stage:'launch',
    acceptanceMode:process.env.PA_AGENTARTS_CONTINUATION_CONTEXT==='goal'
      ? 'explicit_goal_configuration_compatibility_probe' : 'default_desktop_configuration',
    route:workflowMode?'default_ui_coding_repair_workflow':'default_ui_individual_workspace_tools',
    fixture:{dataClass:'public',baselineSha256:sha(baseline),geometrySha256:sha(neutralize(baseline))},
    artifactBoundary:{sourceWorkspace:'workspace/',internalRuntimeArtifacts:'user-data/',
      internalArtifactsExcludedFromSourceInventory:true},
    source:{desktopMainSha256:fileSha(path.join(desktop,'electron/main.js')),
      toolSurfaceSha256:fileSha(path.join(desktop,'electron/conversation-tool-surface.js')),
      workspaceConfigHostSha256:fileSha(path.join(desktop,'electron/workspace-config-host.js')),
      codingDecisionSourceSha256:fileSha(path.join(root,'apps/runtime/src/application/coding-decision-tool.ts')),
      codingDecisionBuildSha256:fileSha(path.join(root,'apps/runtime/dist/application/coding-decision-tool.js')),
      coordinationBuildSha256:fileSha(path.join(root,'apps/runtime/dist/application/coordination.js')),
      runtimeApplicationBuildSha256:fileSha(path.join(root,'apps/runtime/dist/application/runtime-application.js')),
      runnerSha256:fileSha(__filename)},
    nativeHelper:{sha256:fileSha(helper),processIdentityQuery:'passed',sourceBuildProvenance:'not_reestablished'},
    wiringSurface:workflowMode?'apps/desktop production main panel → original delegated child → published coding.repair.workflow/F15'
      :'apps/desktop production main panel → original delegated child → original workspace tools',
    automation:{nativeSelectors:'new public fixture and explicitly supplied host executables only',
      exactPublicExport:'original unified question requirement plus confirmed source digest and export lease',
      approvalActivation:'visible enabled original unified question card and production UI handler; suggested task consent when available, otherwise allow_once',
      physicalHumanClick:'not_run',fakeModel:false,fakeTools:false},
    limitations:[...(!workflowMode?['not F15 workflow-advance graph acceptance']:[]),'not a platform trace/API readback',
      'not a physical user approval interaction','not general autonomous coding acceptance'],approvals:[]};
  const launchInputs={executablePath,userData,workspace,node,npm,fixture};let session;
  const receipt=path.join(output,'receipt.json');
  const persist=()=>fs.writeFileSync(receipt,JSON.stringify(report,null,2)+'\n');
  persist();console.log(JSON.stringify({status:'started',output}));
  try {
    session=await launch(launchInputs,report);
    let admin=await openSettings(session,'environment');
    report.stage='select-production-workspace';persist();
    for(const selector of ['select','select-node','select-npm','select-file']) {
      await admin.locator(`[data-workspace="${selector}"]`).click();
      await admin.waitForFunction(()=>document.querySelector('.coding-workspace')?.getAttribute('aria-busy')==='false');
    }
    const selected=await snapshot(admin);assert.equal(selected.coding.configured,true,'fixture selection must persist');
    report.selectionDialogs=await evaluateBounded(session.app,()=>globalThis.__pelicanNativeActions);
    await closeDesktop(session.app);session=undefined;
    report.stage='restart-original-tool-assembly';persist();
    session=await launch(launchInputs,report);admin=await openSettings(session,'environment');
    const ready=(await snapshot(admin)).coding;
    assert.equal(ready.authorizationAvailable,true,'original production workspace assembly must be ready');
    assert.equal(ready.projectScriptsAvailable,true,'original bounded project test host must be available');
    report.workspaceAuthorization='configuration only; each original operation requires its unified question';
    if(workflowMode) {
      report.stage='start-original-local-laya';persist();
      admin=await openSettings(session,'connections');
      const before=os.freemem(),started=Date.now();
      report.laya={state:'startup_requested',activation:'production settings UI',
        systemFreeBytesBefore:before,systemTotalBytes:os.totalmem()};persist();
      const existing=(await snapshot(admin)).laya;
      if(existing?.ready!==true) {
        assert.ok(before>=2*1024**3,'original 2 GiB free-memory admission must hold before Laya startup');
        await admin.locator('[data-laya="start"]').click();
      }
      const laya=await waitUntil(async()=>{
        const value=(await snapshot(admin)).laya;
        if(['unavailable','memory_insufficient','error','stop_unconfirmed','identity_changed'].includes(value?.state)) {
          report.laya={...report.laya,state:value.state,ready:value.ready===true,
            elapsedMs:Date.now()-started,systemFreeBytesAfter:os.freemem()};persist();
          throw Error('Original local Laya did not become ready: '+value.state);
        }
        return value?.ready===true?value:undefined;
      },started+95_000,'original local Laya startup');
      report.laya={state:laya.state,ready:laya.ready,calibrated:laya.calibrated,
        activation:'production settings UI',elapsedMs:Date.now()-started,
        systemFreeBytesBefore:before,systemFreeBytesAfter:os.freemem(),systemTotalBytes:os.totalmem()};
      persist();
    }
    const goal=workflowMode?'请使用当前目录中真实公布的 coding.repair.workflow 修复公开工作区 pelican.svg。按它的Schema设置 codingRepair.mode=main、allowedPaths=["pelican.svg"]，仅安排一个 role=coder 的子任务。'
      +'修复目标：保留鹈鹕和自行车全部图形、布局与其他字节，仅让三个 animateTransform 动画自动开始；实际完成修改并运行此工作区现有测试。pelican.test.cjs 和 package.json 必须原样保留。'
      +'现在就提交符合该工具Schema的合法请求，由本机执行与核实；无需再询问是否采用这一工具。不要提交Git、发布云部署、访问其他目录或私人数据，收到实际结果后据实汇报。'
      :'请修复当前已授权公开工作区中的 pelican.svg。保持原鹈鹕和自行车全部图形、布局及其他字节，只修复三个 animateTransform 动画不启动的问题。'
      +'请由默认子智能体在本地实际读取文件、预览文本补丁、应用补丁，并运行 workspace.npm_test 的原固定测试，测试文件 pelican.test.cjs 与 package.json 必须原样保留。'
      +'使用 workspace.read_text、workspace.preview_text_patch、workspace.apply_text_patch 与 workspace.npm_test 的实际返回结果，不要使用 coding.repair 或 developer.harness 专用入口。'
      +'不要创建或发布部署、不要提交 Git、不要访问其他目录或私人数据；所有操作完成后再汇报。';
    report.stage='submit-default-main-panel';persist();
    await session.panel.locator('textarea[aria-label="任务内容"]').fill(goal);
    await session.panel.locator('#send').click();
    const source=await waitUntil(async()=>{
      const value=await snapshot(session.panel);
      return value.tasks.find(task=>task.userMessage===goal||task.goal===goal);
    },Date.now()+30_000,'original main conversation submission');
    report.sourceTaskId=source.taskId;report.stage='wait-original-model-and-tools';persist();
    const database=path.join(userData,'runtime.sqlite');
    const deadline=readDeadline(database,source.taskId);report.originalDeadline=new Date(deadline).toISOString();
    await waitUntil(async()=>{
      const value=await snapshot(admin);
      const task=value.tasks.find(item=>item.taskId===source.taskId);
      report.lastState=task?.state;
      if(task?.state==='waiting_reconciliation')throw Error('original result requires reconciliation; no resubmission is allowed');
      if(terminal(task?.state)) {
        report.parentState=task.state;report.parentErrorCode=task.error?.code;
        assert.equal(task.state,'succeeded','original default conversation task must succeed');
        return task;
      }
      assert.ok(!(value.approvals??[]).some(item=>item.state==='pending'
        &&!(value.authorizationQuestions??[]).some(question=>question.sourceApprovalId===item.approvalId)),
        'legacy approval controls cannot replace the original unified question');
      for(const pending of value.authorizationQuestions??[]) {
        if(pending.state!=='pending'||report.approvals.some(item=>item.questionId===pending.questionId&&item.revision===pending.revision))continue;
        // This fresh userData has one original main turn; deny any unrelated tool.
        assert.ok(['workspace.list_entries','workspace.read_text','workspace.preview_text_patch','workspace.stage_text_patch',
          'workspace.apply_text_patch','workspace.node_check','workspace.npm_test','workspace.git_diff_check',
          'subagent.dispatch','subagent.team.dispatch',...(workflowMode?['coding.repair.start','coding.repair.read','decision.choose_candidate',
            'workflow.host.f15_n04','workflow.host.f15_n05','workflow.host.f15_n06']:[])].includes(pending.toolName),
          'only original fixture coding questions may be automated');
        assert.ok(pending.requirements.every(item=>['tool','connector_session','export'].includes(item.kind)),
          'only the declared original operation, workspace and export requirements may be approved');
        const binding=await originalQuestionBinding(database,source.taskId,pending);
        if(pending.sandbox?.native?.required===true)assert.ok(pending.sandbox.native.available===true&&pending.sandbox.native.enforced===true,
          'a missing native process boundary cannot be approved as available');
        assert.ok(!workflowMode||report.approvals.length<3,'one original F15 repair must use at most three core question cards');
        const observation=await approveOriginalQuestion(session.panel,pending,{
          verifyAllowed:current=>readAllowedOriginalQuestion(database,source.taskId,pending,current,binding),
          onObservation:value=>{const current={questionId:pending.questionId,...value};
            if(JSON.stringify(current)!==JSON.stringify(report.lastQuestionObservation)){report.lastQuestionObservation=current;persist();}}});
        if(observation.decisionSource==='observed_existing')report.physicalHumanClick='unknown';
        report.approvals.push({questionId:pending.questionId,approvalId:pending.sourceApprovalId,taskId:pending.taskId,
          revision:pending.revision,toolName:pending.toolName,...binding,...observation,
          requirements:pending.requirements.map(({requirementId,kind,scopes})=>({requirementId,kind,scopes}))});persist();
      }
      return undefined;
    },deadline+15_000,'production task terminal readback');
    report.stage='capture-production-result';persist();
    await captureMode(session.app,'panel',path.join(output,'desktop-result.png'));
    report.nativeActions=await evaluateBounded(session.app,()=>globalThis.__pelicanNativeActions);
    await closeDesktop(session.app);session=undefined;
    report.stage='reopen-original-runtime-evidence';persist();
    report.persistence=await readback(database,source.taskId,true,{workflow:workflowMode});
    assert.ok(report.persistence.executionCapacities.some(state=>state.taskId!==source.taskId&&state.mode==='progressive'),
      'the default delegated task must persist its original progressive execution policy');
    assert.ok(report.persistence.continuationWindows.some(window=>window.taskId!==source.taskId),
      'the original default child must record an actual bounded cloud continuation');
    assert.ok(report.persistence.continuationWindows.every(window=>window.priorCount<=32&&window.queryBytes<=1_100_000),
      'every recorded default cloud continuation must respect the published transport bounds');
    assert.deepEqual(fixtureFileSet(workspace),originalFiles,'no additional source-workspace files or directories may be created');
    for(const [name,digest]of Object.entries(fixedFiles))assert.equal(fileSha(path.join(workspace,name)),digest,'checker and package bytes must stay original');
    const after=fs.readFileSync(fixture,'utf8');
    assert.equal(neutralize(after),neutralize(baseline),'only existing animation begin bytes may change');
    const verified=spawnSync(node,['--test'],{cwd:workspace,encoding:'utf8',windowsHide:true,shell:false});
    assert.equal(verified.status,0,'independent final Node verifier must pass');
    report.fixture.currentSha256=sha(after);report.fixture.geometryPreserved=true;
    report.fixture.sourceFiles=originalFiles;report.fixture.sourceFileSetPreserved=true;
    if(workflowMode)for(const graph of report.persistence.f15) {
      const published=graph.publication.files.find(file=>file.path===fixtureName);
      assert.equal(published.beforeSha256,sha(baseline),'original CAS must bind the current fixture baseline');
      assert.equal(published.afterSha256,sha(after),'original CAS must match the actual user-workspace artifact');
    }
    report.independentNodeVerification='passed';
    report.stage='render-production-output';persist();
    session=await launch(launchInputs,report);
    assert.equal((await snapshot(session.panel)).tasks.find(task=>task.taskId===source.taskId)?.state,'succeeded',
      'the same original conversation must remain complete after Desktop restart');
    report.playback=await observePlayback(session,fixture,output);
    await closeDesktop(session.app);session=undefined;
    report.status=report.acceptanceMode==='default_desktop_configuration'
      ? 'passed_real_default_desktop' : 'passed_real_configured_desktop';report.stage='complete';
  } catch(error) {
    report.status='failed';report.failure={stage:report.stage,
      code:['ERR_ASSERTION','ENOENT','EPERM','EACCES'].includes(error?.code)?error.code:'ACCEPTANCE_FAILED',
      message:String(error?.message??'Acceptance failed').replace(/\u001b\[[0-9;]*m/g,'')
        .replace(/[A-Z]:[\\/][^\n]+/gi,'[local path]')};
    if(session) {
      try{report.nativeActions=await evaluateBounded(session.app,()=>globalThis.__pelicanNativeActions);}catch{}
      try{await captureMode(session.app,'panel',path.join(output,'desktop-failed.png'));}catch{}
      try{const admin=session.app.windows().find(page=>page.url().includes('mode=admin'));
        if(admin){report.settingsFailure=await bounded(()=>settingsNavigationState(admin),10_000,'Owned settings diagnostic timed out');
          await captureMode(session.app,'admin',path.join(output,'settings-failed.png'));}}catch{}
      await closeDesktop(session.app);session=undefined;
    }
    if(report.sourceTaskId) {
      try{report.persistence=await readback(path.join(userData,'runtime.sqlite'),report.sourceTaskId,false,{workflow:workflowMode});}catch{}
    }
    process.exitCode=1;
  } finally {
    report.finishedAt=new Date().toISOString();persist();
    console.log(JSON.stringify({status:report.status,stage:report.stage,sourceTaskId:report.sourceTaskId,receipt}));
  }
}

module.exports={readback,neutralize,publicChecker,observePlayback,launch,captureMode,snapshot,originalQuestionBinding,
  approveOriginalQuestion,readAllowedOriginalQuestion,openSettings,settingsNavigationState,electronLaunchOptions,waitForStartupWindow,startupOutputMetadata,
  closeDesktop,trackOwnedDesktop,windowsOwnedProcess,evaluateBounded};
if(require.main===module)main().catch(error=>{
  console.error(JSON.stringify({status:'preflight_failed',code:error?.code??'PRECONDITION_FAILED',
    message:String(error?.message??'Acceptance prerequisites are unavailable').replace(/[A-Z]:[\\/][^\n]+/gi,'[local path]').slice(0,300)}));
  process.exitCode=1;
});
