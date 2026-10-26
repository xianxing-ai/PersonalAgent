'use strict';

// Explicit, paid real-cloud acceptance on a newly generated public-only workspace.
// The production Desktop owns task execution, authorization and every tool call.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {launch,openSettings,snapshot,captureMode,closeDesktop,originalQuestionBinding,
  readAllowedOriginalQuestion,approveOriginalQuestion}=require('./desktop-pelican-default-live.cjs');

const root=path.resolve(__dirname,'../../..');
const names=Array.from({length:14},(_,index)=>`metric-${String(index+1).padStart(2,'0')}.cjs`);
const checkerName='project.test.cjs';
const boundary={publicReadPaths:[...names,checkerName,'package.json'],publicWritePaths:[...names]};
const allowedTools=new Set(['subagent.dispatch','workspace.list_entries','workspace.read_text',
  'workspace.preview_text_patch','workspace.apply_text_patch','workspace.npm_test']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const fileHash=file=>hash(fs.readFileSync(file));
const baseline=(index)=>`'use strict';\nmodule.exports = value => value - ${index+1};\n`;
const expected=(index)=>baseline(index).replace('value - ','value + ');
const terminal=state=>['succeeded','failed','cancelled'].includes(state);

// Progress sampling may race the real native writer's exclusive Windows file lock.
// A busy sample observes nothing; final readback still runs after the app closes.
function countCorrectedModules(workspace,{readText=file=>fs.readFileSync(file,'utf8')}={}) {
  let correctedModules=0;
  for(const [index,name]of names.entries()) {
    let content;
    try{content=readText(path.join(workspace,name));}
    catch(error){if(error?.code==='EBUSY')return {available:false,code:'EBUSY',relativePath:name};throw error;}
    if(content===expected(index))correctedModules++;
  }
  return {available:true,correctedModules};
}

// Each request is already checked against its own original Runtime input above.
// Different edit spans are valid only when they bind the same source and exact result.
function assertVerifiedPatchPair({name,sourceText,expectedText,previewArguments,applyArguments,previewResult,applyResult}) {
  const before=hash(sourceText),after=hash(expectedText);
  for(const input of [previewArguments,applyArguments]) {
    assert.equal(input.path,name);
    if(input.expectedSha256!==undefined)assert.equal(input.expectedSha256,before);
  }
  for(const result of [previewResult,applyResult]) {
    assert.equal(result.path,name);assert.equal(result.beforeSha256,before);assert.equal(result.afterSha256,after);
  }
  assert.equal(previewResult.changed,true);assert.equal(previewResult.previewText,expectedText);
  assert.equal(applyResult.applied,true);
}

function trustedFile(file,label) {
  assert.ok(file&&path.isAbsolute(file),`${label} must be an explicitly selected absolute path`);
  const resolved=fs.realpathSync.native(file);
  assert.ok(fs.statSync(resolved).isFile(),`${label} must be a regular file`);
  return resolved;
}
function sourceInventory(workspace) {
  return fs.readdirSync(workspace,{withFileTypes:true}).map(entry=>{
    assert.equal(entry.isFile(),true,'Only the original public source files may exist');return entry.name;
  }).sort();
}
function load(database,taskId,key) {
  const db=new DatabaseSync(database,{readOnly:true});
  try {const row=db.prepare('SELECT value_json FROM task_checkpoints WHERE task_id=? AND checkpoint_key=?').get(taskId,key);
    return row?JSON.parse(row.value_json):undefined;}finally{db.close();}
}
async function waitFor(check,deadline,label) {
  while(Date.now()<deadline){const value=await check();if(value!==undefined&&value!==false)return value;
    await new Promise(resolve=>setTimeout(resolve,350));}
  throw Error(`${label} exceeded the original task deadline`);
}
function publicChecker() {
  return "'use strict';\nconst assert=require('node:assert/strict');\nconst {test,after}=require('node:test');\nlet passed=0;\n"
    +names.map((name,index)=>`test('${name} adds ${index+1}',()=>{const add=require('./${name}');`
      +`for(const input of [-3,0,7])assert.equal(add(input),input+${index+1});passed++;});`).join('\n')
    +`\nafter(()=>{if(passed===${names.length})console.log('progressive-development-verification:'+JSON.stringify({modules:passed,verified:true}));});\n`;
}

/** Read the real Runtime originals after the owned app exits; no dispatcher is created. */
async function readOriginalExecution(database,parentTaskId,{complete=false}={}) {
  const {TaskRuntime}=await import('@personal-agent/runtime');
  const runtime=new TaskRuntime(database);
  try {
    const parent=runtime.getTask(parentTaskId),tasks=runtime.listTasks({limit:100}).items;
    const workers=tasks.filter(task=>runtime.loadCheckpoint(task.taskId,'subtask-parent')?.parentTaskId===parentTaskId);
    const execution=workers.find(task=>runtime.loadCheckpoint(task.taskId,'subtask-parent')?.subtaskId==='user-work');
    assert.ok(execution,'The original default user-work task must exist');
    assert.equal(workers.length,1,'The fixture must use one original default worker');
    const unrelated=tasks.filter(task=>![parentTaskId,execution.taskId].includes(task.taskId));
    for(const task of unrelated)assert.ok(task.state==='created'&&/^knowledge-watch:desktop-user-v1:[a-f0-9-]+$/.test(task.conversationId)
      &&runtime.readToolExecutions(task.taskId).length===0&&runtime.readEvidence(task.taskId).length===0
      &&runtime.listCheckpointKeys(task.taskId).every(key=>key==='runtime-startup-recovery:v1'),
      'Only the inert production Knowledge Watch bookkeeping root may be outside the original execution family');
    const loop=runtime.loadCheckpoint(execution.taskId,'competition-loop');
    const receipts=loop?.receipts??[],records=runtime.readToolExecutions(execution.taskId);
    const evidence=runtime.readEvidence(execution.taskId);
    const capacity=runtime.loadCheckpoint(execution.taskId,'competition-execution-capacity:v1');
    const context=runtime.loadCheckpoint(execution.taskId,'competition-cloud-dispatch-context');
    const catalog=runtime.loadCheckpoint(execution.taskId,'competition-tool-catalog');
    const requests=runtime.loadCheckpoint(execution.taskId,'competition-cloud-request-identity')?.requests??[];
    const window=runtime.loadCheckpoint(execution.taskId,'competition-sent-continuation-window:v1');
    const confirmed=records.filter(record=>record.state==='confirmed'&&record.policyDecision==='allow'&&record.executionStarted);
    assert.equal(new Set(receipts.map(receipt=>receipt.runId)).size,receipts.length,'An original run may appear only once');
    assert.equal(new Set(records.map(record=>record.evidenceId)).size,records.length);
    for(const receipt of receipts) {
      assert.ok(allowedTools.has(receipt.proposal.toolName),'All actual loop calls must remain in the fixture tool set');
      const args=receipt.proposal.arguments;
      if(receipt.proposal.toolName==='workspace.list_entries')assert.equal(args.path,'.');
      if(receipt.proposal.toolName==='workspace.read_text')assert.ok(boundary.publicReadPaths.includes(args.path));
      if(['workspace.preview_text_patch','workspace.apply_text_patch'].includes(receipt.proposal.toolName))
        assert.ok(names.includes(args.path),'No fixed test, package, private path or unrelated source can be patched');
      const original=records.find(record=>record.evidenceId===receipt.runId);
      assert.ok(original&&original.toolName===receipt.proposal.toolName&&original.toolVersion===receipt.proposal.toolVersion
        &&runtime.matchesToolExecutionInput(original,{arguments:args,scopeRef:receipt.runId}),
        'Every actual proposal must retain its exact original ToolGateway input binding');
    }
    if(complete) {
      assert.equal(parent.state,'succeeded');assert.equal(execution.state,'succeeded',JSON.stringify(execution.error));
      assert.equal(capacity?.initialWindowSteps,32,'This run must prove the unmodified default 32-step admission');
      assert.ok(capacity.extensions>0&&capacity.windowEndStep>32);
      assert.equal(capacity.maxSteps,undefined);assert.equal(runtime.loadCheckpoint(execution.taskId,'competition-max-steps'),32);
      assert.equal(capacity.deadline,runtime.loadCheckpoint(execution.taskId,'application-deadline'));
      assert.ok(loop.step>32&&context.loop.step===loop.step&&context.loop.step<=capacity.windowEndStep);
      assert.equal(context.loop.maxSteps,32);assert.equal(context.request.phase,'continuation');
      assert.equal(context.catalog.entriesDigest,hash(JSON.stringify(catalog.entries)));
      assert.ok(requests.some(request=>request.requestId===context.invocation.requestId
        &&request.payloadDigest===context.invocation.payloadDigest),'The post-32 send must have its actual cloud request identity');
      assert.ok(window.queryBytes<=1_100_000&&window.priorCount<=32);
      assert.equal(confirmed.length,records.length);assert.equal(records.length,receipts.length);
      assert.ok(records.every(record=>evidence.some(item=>item.evidenceId===record.evidenceId)));
      for(const task of [parent,execution]) {
        assert.ok(!runtime.loadCheckpoint(task.taskId,'competition-cloud-unknown'));
        assert.equal(runtime.loadCheckpoint(task.taskId,'competition-loop')?.pending,undefined);
        assert.equal(runtime.listApprovals({taskId:task.taskId,state:'pending',limit:100}).items.length,0);
        assert.ok(runtime.readToolExecutions(task.taskId).every(record=>record.state==='confirmed'),
          'No unfinished or unknown effect may pass this acceptance');
      }
      for(const [index,name]of names.entries()) {
        const reads=receipts.flatMap((receipt,position)=>receipt.proposal.toolName==='workspace.read_text'
          &&receipt.proposal.arguments.path===name?[position]:[]);
        const preview=receipts.findIndex(receipt=>receipt.proposal.toolName==='workspace.preview_text_patch'
          &&receipt.proposal.arguments.path===name);
        const apply=receipts.findIndex(receipt=>receipt.proposal.toolName==='workspace.apply_text_patch'
          &&receipt.proposal.arguments.path===name);
        assert.ok(reads.some(position=>position<preview)&&preview<apply,`Original read → preview → apply required for ${name}`);
        const originalRead=runtime.loadCheckpoint(execution.taskId,'tool-result-'+receipts[reads.find(position=>position<preview)].runId)?.result;
        assert.equal(originalRead?.path,name);assert.equal(originalRead.content,baseline(index));
        assert.equal(originalRead.byteLength,Buffer.byteLength(baseline(index)));assert.equal(originalRead.sha256,hash(baseline(index)));
        const originalPreview=runtime.loadCheckpoint(execution.taskId,'tool-result-'+receipts[preview].runId)?.result;
        assert.equal(originalPreview?.path,name);assert.equal(originalPreview.changed,true);
        assert.equal(originalPreview.beforeSha256,hash(baseline(index)));assert.equal(originalPreview.afterSha256,hash(expected(index)));
        assert.equal(originalPreview.previewText,expected(index));
        const applied=runtime.loadCheckpoint(execution.taskId,'tool-result-'+receipts[apply].runId)?.result;
        assert.equal(applied?.applied,true);assert.equal(applied.path,name);
        assert.equal(applied.beforeSha256,hash(baseline(index)));assert.equal(applied.afterSha256,hash(expected(index)));
        assertVerifiedPatchPair({name,sourceText:originalRead.content,expectedText:expected(index),
          previewArguments:receipts[preview].proposal.arguments,applyArguments:receipts[apply].proposal.arguments,
          previewResult:originalPreview,applyResult:applied});
      }
      const test=receipts.find(receipt=>receipt.proposal.toolName==='workspace.npm_test'
        &&runtime.loadCheckpoint(execution.taskId,'tool-result-'+receipt.runId)?.result?.exitCode===0);
      assert.ok(test,'The original fixed project test must actually return zero');
      assert.match(runtime.loadCheckpoint(execution.taskId,'tool-result-'+test.runId).result.stdout,
        /progressive-development-verification:.*"modules":14,"verified":true/);
      const dispatch=runtime.readToolExecutions(parentTaskId).find(record=>record.toolName==='subagent.dispatch');
      assert.ok(dispatch?.state==='confirmed'&&dispatch.policyDecision==='allow'&&dispatch.executionStarted);
    }
    return {parentState:parent.state,executionTaskId:execution.taskId,executionState:execution.state,
      ...(execution.error?{executionErrorCode:execution.error.code}:{}),inertBookkeepingRoots:unrelated.length,
      step:loop?.step,confirmedCalls:confirmed.length,originalReceiptCount:receipts.length,
      toolCounts:Object.fromEntries([...new Set(records.map(record=>record.toolName))]
        .map(name=>[name,records.filter(record=>record.toolName===name).length])),
      capacity,continuationWindow:window?{priorCount:window.priorCount,queryBytes:window.queryBytes}:null,
      postWindowCloudContext:context?{requestId:context.invocation.requestId,payloadDigest:context.invocation.payloadDigest,
        step:context.loop.step,initialMaxSteps:context.loop.maxSteps,catalogDigest:context.catalog?.entriesDigest,
        catalogCount:catalog?.entries.length}:null,
      records:records.map(record=>({toolName:record.toolName,state:record.state,policyDecision:record.policyDecision,
        executionStarted:record.executionStarted,evidenceId:record.evidenceId})),
      evidenceCount:evidence.length,cloudRequestCount:requests.length};
  }finally{runtime.close();}
}

async function main() {
  assert.equal(process.env.PA_MANUAL_PROGRESSIVE_DESKTOP_LIVE,'1','Explicit real-cloud public-project opt-in is required');
  assert.equal(process.platform,'win32');
  const executablePath=trustedFile(process.env.PA_PELICAN_ELECTRON??path.join(root,'node_modules/electron/dist/electron.exe'),'Electron');
  const node=trustedFile(process.env.PA_PELICAN_NODE,'Node'),npm=trustedFile(process.env.PA_PELICAN_NPM_CLI,'npm CLI');
  const helper=trustedFile(process.env.PA_PELICAN_JOB_HOST,'Windows Job helper');
  assert.equal(path.basename(helper).toLowerCase(),'windowsjobprocesshost.exe');
  const config=process.env.PA_PELICAN_SAVED_CONFIG_DIR;
  assert.ok(config&&path.isAbsolute(config),'An explicitly authorized saved cloud configuration is required');
  const cache=path.join(root,'.cache');fs.mkdirSync(cache,{recursive:true});
  const output=fs.mkdtempSync(path.join(cache,'desktop-progressive-development-'));
  const workspace=path.join(output,'workspace'),userData=path.join(output,'user-data');
  fs.mkdirSync(workspace);fs.mkdirSync(userData);
  for(const name of ['agentarts-config.json','Local State'])
    fs.copyFileSync(trustedFile(path.join(config,name),'Encrypted host configuration'),path.join(userData,name));
  const helperDirectory=path.join(userData,'native-tools/workspace-command');fs.mkdirSync(helperDirectory,{recursive:true});
  for(const suffix of ['.exe','.dll','.deps.json','.runtimeconfig.json']) {
    const name='WindowsJobProcessHost'+suffix;
    fs.copyFileSync(trustedFile(path.join(path.dirname(helper),name),'Trusted native component'),path.join(helperDirectory,name));
  }
  names.forEach((name,index)=>fs.writeFileSync(path.join(workspace,name),baseline(index),{flag:'wx'}));
  fs.writeFileSync(path.join(workspace,checkerName),publicChecker(),{flag:'wx'});
  fs.writeFileSync(path.join(workspace,'package.json'),JSON.stringify({name:'public-progressive-development-acceptance',
    private:true,scripts:{test:'node --test'}},null,2)+'\n',{flag:'wx'});
  const fixed=Object.fromEntries([checkerName,'package.json'].map(name=>[name,fileHash(path.join(workspace,name))]));
  const inventory=sourceInventory(workspace);assert.deepEqual(inventory,[...names,checkerName,'package.json'].sort());
  const initial=spawnSync(node,['--test'],{cwd:workspace,encoding:'utf8',windowsHide:true,shell:false});
  assert.equal(initial.status,1);assert.match(initial.stdout,/fail 14\b/,'All fourteen known defects must reproduce');
  const report={schemaVersion:1,kind:'production_desktop_progressive_development',profile:'huawei_ict_agentarts',
    startedAt:new Date().toISOString(),status:'in_progress',stage:'launch',fixture:{dataClass:'public',modules:14,sourceFiles:inventory},
    acceptanceMode:'default_desktop_configuration',automation:{fakeModel:false,fakeTools:false,physicalHumanClick:'not_run',
      approvalActivation:'visible original unified question; exact persisted invocation and receipt checked'},
    source:Object.fromEntries(['apps/desktop/electron/main.js','apps/desktop/electron/native-execution-host.js',
      'apps/desktop/electron/workspace-command-recipes.js','apps/runtime/src/application/execution-capacity.ts',
      'apps/desktop/electron/workspace-config-host.js',
      'apps/runtime/src/index.ts','apps/runtime/src/application/runtime-application.ts',
      'apps/runtime/src/application/capability-context.ts','apps/runtime/src/application/coordination.ts',
      'apps/runtime/src/application/user-task-delegation.ts',
      'apps/runtime/src/application/agentarts.ts','packages/coordination/src/agentarts.ts',
      'packages/coordination/src/agentarts-websocket.ts',
      'apps/runtime/src/application/competition-cloud-status.ts','apps/runtime/dist/application/runtime-application.js',
      'apps/runtime/dist/application/competition-cloud-status.js','tests/manual/agentarts/desktop-progressive-development-live.cjs']
      .map(name=>[name,fileHash(path.join(root,name))])),approvals:[],limitations:['not an arbitrary large-project acceptance',
        'not a platform deployment/version/trace readback','not a physical human approval interaction']};
  const receipt=path.join(output,'receipt.json'),persist=()=>fs.writeFileSync(receipt,JSON.stringify(report,null,2)+'\n');
  persist();console.log(JSON.stringify({status:'started',output}));
  let session;
  try {
    const inputs={executablePath,userData,workspace,node,npm};session=await launch(inputs,report);
    let admin=await openSettings(session,'environment');
    for(const select of ['select','select-node','select-npm']) {
      await admin.locator(`[data-workspace="${select}"]`).click();
      await admin.waitForFunction(()=>document.querySelector('.coding-workspace')?.getAttribute('aria-busy')==='false');
    }
    assert.equal((await snapshot(admin)).coding.configured,true);
    await closeDesktop(session.app);session=undefined;
    session=await launch(inputs,report);admin=await openSettings(session,'environment');
    const ready=(await snapshot(admin)).coding;
    assert.equal(ready.authorizationAvailable,true);assert.equal(ready.projectScriptsAvailable,true);
    const goal='请实际修复当前公开工作区的 14 个 metric-01.cjs 至 metric-14.cjs 模块。每个模块应把整数输入加上文件编号，现有实现错误地做减法，只将这 14 个源文件里的减号改成加号，保留其它字节。'
      +'由默认的同一个 user-work 子智能体直接完成，不再分派团队或其它子任务；对每个模块依次调用 workspace.read_text、workspace.preview_text_patch、workspace.apply_text_patch，不能跳过预览或合并成脚本写入。'
      +'可用 workspace.list_entries 读取当前根目录。project.test.cjs 与 package.json 只读且必须保持原样，最终调用 workspace.npm_test 运行全部 14 项固定测试并据实汇报。'
      +'不要使用 coding.repair、developer.harness、Shell 写文件、Git、部署或发布，不访问其他目录或私人数据。所有文件读取和补丁操作都仅限这个新建公开夹具。';
    await session.panel.locator('textarea[aria-label="任务内容"]').fill(goal);await session.panel.locator('#send').click();
    const source=await waitFor(async()=>{const value=await snapshot(session.panel);
      return value.tasks.find(task=>task.userMessage===goal||task.goal===goal);},Date.now()+30_000,'Original panel task submission');
    report.sourceTaskId=source.taskId;report.stage='real-cloud-development';persist();
    const database=path.join(userData,'runtime.sqlite'),deadline=Date.parse(load(database,source.taskId,'application-deadline'));
    assert.ok(Number.isFinite(deadline));report.originalDeadline=new Date(deadline).toISOString();
    let lastProgress=-1;
    await waitFor(async()=>{
      const value=await snapshot(admin),task=value.tasks.find(item=>item.taskId===source.taskId);
      report.lastState=task?.state;
      if(task?.state==='waiting_reconciliation')throw Error('Original cloud result is unknown; no retry or resubmission is allowed');
      if(terminal(task?.state)){assert.equal(task.state,'succeeded',task.error?.code??'Original task must succeed');return task;}
      assert.ok(!(value.approvals??[]).some(approval=>approval.state==='pending'
        &&!(value.authorizationQuestions??[]).some(question=>question.sourceApprovalId===approval.approvalId)),
        'Legacy controls cannot replace original unified questions');
      for(const pending of value.authorizationQuestions??[]) {
        if(pending.state!=='pending'||report.approvals.some(item=>item.questionId===pending.questionId&&item.revision===pending.revision))continue;
        assert.ok(allowedTools.has(pending.toolName),'Only original default-worker and bounded workspace questions are allowed');
        assert.ok(pending.requirements.every(item=>['tool','connector_session','export'].includes(item.kind)));
        const binding=await originalQuestionBinding(database,source.taskId,pending,boundary);
        if(pending.sandbox?.native?.required)assert.ok(pending.sandbox.native.available&&pending.sandbox.native.enforced);
        const observation=await approveOriginalQuestion(session.panel,pending,{verifyAllowed:current=>
          readAllowedOriginalQuestion(database,source.taskId,pending,current,binding,boundary)});
        report.approvals.push({questionId:pending.questionId,toolName:pending.toolName,taskId:pending.taskId,
          revision:pending.revision,...binding,...observation});persist();
      }
      const observation=countCorrectedModules(workspace);
      if(!observation.available){report.busyProgressSamples=(report.busyProgressSamples??0)+1;
        report.lastBusyProgressSample={code:observation.code,relativePath:observation.relativePath};persist();}
      else if(observation.correctedModules!==lastProgress){lastProgress=observation.correctedModules;
        report.correctedModules=observation.correctedModules;persist();
        console.log(JSON.stringify({status:'progress',correctedModules:observation.correctedModules,totalModules:14}));}
      return undefined;
    },deadline+15_000,'Original production development');
    report.stage='independent-readback';persist();await captureMode(session.app,'panel',path.join(output,'desktop-result.png'));
    await closeDesktop(session.app);session=undefined;
    report.persistence=await readOriginalExecution(database,source.taskId,{complete:true});
    assert.deepEqual(sourceInventory(workspace),inventory);
    for(const [name,digest]of Object.entries(fixed))assert.equal(fileHash(path.join(workspace,name)),digest);
    names.forEach((name,index)=>assert.equal(fs.readFileSync(path.join(workspace,name),'utf8'),expected(index)));
    const final=spawnSync(node,['--test'],{cwd:workspace,encoding:'utf8',windowsHide:true,shell:false});
    assert.equal(final.status,0);assert.match(final.stdout,/pass 14\b/);
    assert.match(final.stdout,/progressive-development-verification:.*"modules":14,"verified":true/);
    report.fixture={...report.fixture,sourceFileSetPreserved:true,fixedFilesUnchanged:true,allExpectedEdits:true,
      hashes:Object.fromEntries(inventory.map(name=>[name,fileHash(path.join(workspace,name))]))};
    report.independentNodeVerification='passed';
    session=await launch(inputs,report);
    assert.equal((await snapshot(session.panel)).tasks.find(task=>task.taskId===source.taskId)?.state,'succeeded');
    await closeDesktop(session.app);session=undefined;
    report.status='passed_real_default_desktop_beyond_32';report.stage='complete';
  }catch(error){
    report.status='failed';report.failure={code:error?.code??'ACCEPTANCE_FAILED',
      message:String(error?.message??'Acceptance failed').replace(/[A-Z]:[\\/][^\n]+/gi,'[local path]').slice(0,500)};
    if(session)try{await closeDesktop(session.app);session=undefined;}catch(cleanupError){report.cleanupFailure={message:String(cleanupError.message)};}
    if(report.sourceTaskId)try{report.persistence=await readOriginalExecution(path.join(userData,'runtime.sqlite'),report.sourceTaskId);}catch{}
    throw error;
  }finally{report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({status:report.status,stage:report.stage,receipt}));}
}

module.exports={publicChecker,readOriginalExecution,names,boundary,countCorrectedModules,assertVerifiedPatchPair};
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({status:'failed',code:error?.code??'ACCEPTANCE_FAILED',
  message:String(error?.message??'Acceptance failed').replace(/[A-Z]:[\\/][^\n]+/gi,'[local path]').slice(0,500)}));process.exitCode=1;});
