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

async function pageFor(app, mode) {
  return waitUntil(() => app.windows().find(page => page.url().includes('mode=' + mode)),
    Date.now() + 30_000, 'Desktop ' + mode);
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
  let timer;
  try {
    await Promise.race([app.close(),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('Isolated Desktop did not close')),10_000);
    })]);
  } catch {
    // Only this runner-created application, never an existing user instance.
    await app.evaluate(({app})=>app.exit(1)).catch(()=>{});
  } finally {clearTimeout(timer);}
}

async function openSettings(session, section) {
  const response = await session.panel.evaluate(page => window.desktop.invoke('admin.open', {page}), section);
  assert.equal(response.ok, true, 'production settings must open');
  const admin = await pageFor(session.app, 'admin');
  const navigation=admin.locator(`.side [data-page="${section}"]`);
  await navigation.waitFor();
  if(await navigation.getAttribute('aria-current')!=='page')await navigation.click();
  await admin.waitForFunction(page => document.querySelector(`[data-page="${page}"]`)
    ?.getAttribute('aria-current') === 'page', section);
  return admin;
}

async function approveOriginalButton(admin,pending) {
  const selector=`[data-approval="allow_once"][data-id="${pending.approvalId}"]`;
  const button=admin.locator(selector);
  await button.waitFor({state:'visible'});
  assert.equal(await button.isEnabled(),true,'the original approval button must be enabled');
  // The settings view replaces this table on each status update. Activate its
  // exact live DOM button once, through the original UI handler, without a
  // pointer-stability wait across replacement nodes. This is not a human click.
  await button.evaluate((element,expected)=>{
    const bounds=element.getBoundingClientRect(),style=getComputedStyle(element);
    if(!element.isConnected||element.disabled||bounds.width<=0||bounds.height<=0
      ||style.display==='none'||style.visibility!=='visible'
      ||element.dataset.id!==expected.approvalId||element.dataset.task!==expected.taskId
      ||Number(element.dataset.revision)!==expected.revision||element.dataset.approval!=='allow_once')
      throw Error('Original approval UI binding changed before activation');
    element.click();
  },{approvalId:pending.approvalId,taskId:pending.taskId,revision:pending.revision});
}

async function installPublicDialogAutomation(app, inputs) {
  await app.evaluate(({dialog}, values) => {
    const fs = process.getBuiltinModule('node:fs');
    const {createHash} = process.getBuiltinModule('node:crypto');
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
      if (options?.title === '本任务公开资料许可') {
        const detail = String(options.detail ?? '');
        const current = fs.readFileSync(values.fixture);
        const digest = createHash('sha256').update(current).digest('hex');
        const exactFile = detail.split('\n').includes('资料：' + values.fixtureName);
        const taskBound = /^原任务：[0-9a-f-]{36}$/m.test(detail);
        const phase = options.message?.startsWith('允许读取') ? 'preflight'
          : options.message?.startsWith('允许向 AgentArts 发送') ? 'confirmed' : 'unknown';
        const exactBytes = phase !== 'confirmed' || detail.includes('SHA256：' + digest)
          && detail.includes('实际大小：' + current.length + ' 字节');
        const allowed = exactFile && taskBound && exactBytes && phase !== 'unknown'
          && options.buttons?.[1] === '确认仅本任务使用此公开资料';
        globalThis.__pelicanNativeActions.push({kind:'public_fixture_export',phase,allowed,
          ...(phase === 'confirmed' ? {sha256:digest,byteLength:current.length} : {})});
        return {response:allowed ? 1 : 0, checkboxChecked:false};
      }
      // Unexpected requests receive no extra authorization and remain observable.
      if (options?.type === 'question') {
        globalThis.__pelicanNativeActions.push({kind:'unrecognized_question',allowed:false});
        return {response:options.cancelId ?? 0,checkboxChecked:false};
      }
      return originalMessage(...args);
    };
  }, inputs);
}

async function launch({executablePath,userData,workspace,node,npm,fixture}, report) {
  const {_electron} = require('playwright');
  const environment = {...process.env,ELECTRON_RUN_AS_NODE:undefined,
    PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_USER_DATA_DIR:undefined,
    PA_DESKTOP_TEST_USER_DATA:userData,PA_DESKTOP_MODEL_MODE:undefined,
    PA_DESKTOP_EPHEMERAL_MODEL:undefined,PA_DESKTOP_SYNTHETIC_MVP:undefined,
    PA_DESKTOP_SYNTHETIC_FACT_SOURCE:undefined,PA_DEVELOPER_CONFIG_FILE:undefined,
    PA_AGENTARTS_INVOKE_MODE:'published',PA_AGENTARTS_RESPONSE_MODE:'tool-proposal-json'};
  const app = await _electron.launch({executablePath,args:[desktop,
    '--pa-public-pelican-acceptance='+path.basename(path.dirname(userData))],env:environment});
  try {
    await app.firstWindow();
    await installPublicDialogAutomation(app,{workspace,node,npm,check:path.join(workspace,checkName),fixture,fixtureName});
    const orb = await pageFor(app,'orb');
    const opened = await orb.evaluate(() => window.desktop.invoke('orb.open'));
    assert.equal(opened.ok,true,'production main conversation must open');
    const panel = await pageFor(app,'panel');
    await panel.waitForSelector('#send');
    const value = await snapshot(panel);
    assert.equal(value.fake,false,'Fake Runtime is forbidden');
    assert.equal(value.fakeModel,false,'Fake model is forbidden');
    report.target={configured:value.agentArts?.configured===true,
      deploymentVersion:value.agentArts?.deploymentVersion??'',transport:value.agentArts?.effectiveTransport??'unknown',
      urlEndpoint:(()=>{try{return new URL(value.agentArts?.websocketUrl).searchParams.get('endpoint')??'';}catch{return '';}})(),
      platformVersionReadback:'not_run'};
    report.launches = (report.launches ?? 0) + 1;
    return {app,panel,orb};
  } catch(error) {
    await closeDesktop(app);
    throw error;
  }
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
    const clouds = tasks.flatMap(task=>{
      const identity=runtime.loadCheckpoint(task.taskId,'competition-cloud-request-identity');
      return (identity?.requests??[]).map(request=>({taskId:task.taskId,...request}));
    });
    const records = rows.map(row=>({taskId:row.taskId,toolName:row.toolName,toolVersion:row.toolVersion,
      state:row.state,policyDecision:row.policyDecision,executionStarted:row.executionStarted,
      evidenceId:row.evidenceId}));
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
      records,evidenceRefs:[...new Set(evidence.map(item=>item.evidenceId))],cloudRequests:clouds};
  } finally {application.close();}
}

async function observePlayback(session, fixture, output) {
  const opened=session.app.waitForEvent('window');
  await session.app.evaluate(async ({BrowserWindow}, url)=>{
    const viewer=new BrowserWindow({show:true,width:820,height:650,
      webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    await viewer.loadURL(url);
  },pathToFileURL(fixture).href);
  const page=await opened;
  await page.waitForSelector('#wheel-back');
  const frame=()=>page.evaluate(()=>({at:document.documentElement.getCurrentTime(),
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
      runnerSha256:fileSha(__filename)},
    nativeHelper:{sha256:fileSha(helper),processIdentityQuery:'passed',sourceBuildProvenance:'not_reestablished'},
    wiringSurface:workflowMode?'apps/desktop production main panel → original delegated child → published coding.repair.workflow/F15'
      :'apps/desktop production main panel → original delegated child → original workspace tools',
    automation:{nativeSelectors:'new public fixture and explicitly supplied host executables only',
      exactPublicExport:'current fixture bytes and original task only',
      approvalActivation:'visible enabled original DOM button and production UI handler',
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
    report.selectionDialogs=await session.app.evaluate(()=>globalThis.__pelicanNativeActions);
    await closeDesktop(session.app);session=undefined;
    report.stage='restart-original-tool-assembly';persist();
    session=await launch(launchInputs,report);admin=await openSettings(session,'environment');
    const ready=(await snapshot(admin)).coding;
    assert.equal(ready.authorizationAvailable,true,'original production workspace assembly must be ready');
    assert.equal(ready.projectScriptsAvailable,true,'original bounded project test host must be available');
    for(const selector of ['cloud','write','command','project-code'])await admin.locator(`[data-workspace="${selector}"]`).check();
    await admin.locator('[data-workspace="authorize"]').click();
    await waitUntil(async()=>{
      const value=(await snapshot(admin)).coding;
      return value.cloudExportAllowed&&value.writeAllowed&&value.commandAllowed&&value.projectCodeAllowed;
    },Date.now()+30_000,'current fixture workspace authorization');
    report.workspaceAuthorization='production settings UI confirmed';
    if(workflowMode) {
      report.stage='start-original-local-laya';persist();
      admin=await openSettings(session,'connections');
      const before=os.freemem(),started=Date.now();
      report.laya={state:'startup_requested',activation:'production settings UI',
        systemFreeBytesBefore:before,systemTotalBytes:os.totalmem()};persist();
      const existing=(await snapshot(admin)).laya;
      if(existing?.ready!==true)await admin.locator('[data-laya="start"]').click();
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
      for(const pending of value.approvals??[]) {
        if(pending.state!=='pending'||report.approvals.some(item=>item.approvalId===pending.approvalId))continue;
        // This fresh userData has one original main turn; deny any unrelated tool.
        assert.ok(['workspace.read_text','workspace.preview_text_patch','workspace.stage_text_patch',
          'workspace.apply_text_patch','workspace.node_check','workspace.npm_test','workspace.git_diff_check',
          'subagent.dispatch',...(workflowMode?['coding.repair.start','coding.repair.read','decision.choose_candidate',
            'workflow.host.f15_n04','workflow.host.f15_n05','workflow.host.f15_n06']:[])].includes(pending.action),
          'only original fixture coding approvals may be automated');
        await openSettings(session,'authorizations');
        await approveOriginalButton(admin,pending);
        report.approvals.push({approvalId:pending.approvalId,taskId:pending.taskId,revision:pending.revision,
          toolName:pending.action,argumentsDigest:pending.argumentsDigest});persist();
      }
      return undefined;
    },deadline+15_000,'production task terminal readback');
    report.stage='capture-production-result';persist();
    await captureMode(session.app,'panel',path.join(output,'desktop-result.png'));
    report.nativeActions=await session.app.evaluate(()=>globalThis.__pelicanNativeActions);
    await closeDesktop(session.app);session=undefined;
    report.stage='reopen-original-runtime-evidence';persist();
    report.persistence=await readback(database,source.taskId,true,{workflow:workflowMode});
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
      try{report.nativeActions=await session.app.evaluate(()=>globalThis.__pelicanNativeActions);}catch{}
      try{await captureMode(session.app,'panel',path.join(output,'desktop-failed.png'));}catch{}
      try{const admin=session.app.windows().find(page=>page.url().includes('mode=admin'));
        if(admin)await captureMode(session.app,'admin',path.join(output,'settings-failed.png'));}catch{}
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

module.exports={readback,neutralize,publicChecker,observePlayback,launch,captureMode,snapshot};
if(require.main===module)main().catch(error=>{
  console.error(JSON.stringify({status:'preflight_failed',code:error?.code??'PRECONDITION_FAILED',
    message:String(error?.message??'Acceptance prerequisites are unavailable').replace(/[A-Z]:[\\/][^\n]+/gi,'[local path]').slice(0,300)}));
  process.exitCode=1;
});
