// Actual product main/preload/admin; explicit synthetic native dialogs, no cloud configuration.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {_electron}=require('playwright');
const {closeDesktop,trackOwnedDesktop,evaluateBounded}=require('../../../tests/manual/agentarts/desktop-pelican-default-live.cjs');
async function waitFor(read,reason){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}
  throw Error('Timed out: '+reason);
}
async function snapshot(page){const response=await page.evaluate(()=>window.desktop.invoke('snapshot'));
  assert.equal(response.ok,true,response.error);return response.value;}
(async()=>{
  const cache=path.resolve(__dirname,'../../../.cache/installed-skills-product');fs.mkdirSync(cache,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(cache,'case-')),userData=path.join(fixture,'user-data');
  const example=path.resolve(__dirname,'../../../examples/skills/meeting-outline');
  const original=fs.readFileSync(path.join(example,'SKILL.md'),'utf8'),source=path.join(fixture,'meeting-outline');
  fs.mkdirSync(path.join(source,'references'),{recursive:true});fs.writeFileSync(path.join(source,'SKILL.md'),original);
  fs.writeFileSync(path.join(source,'references/guide.md'),'<img src=x onerror="window.resourceExecuted=true">\n公开指南');
  const environment=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PATH','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  Object.assign(environment,{PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_USER_DATA_DIR:userData});
  const executablePath=process.env.PA_SKILL_SMOKE_ELECTRON || path.resolve(__dirname,'../../../node_modules/electron/dist/electron.exe');
  const diagnostics=[],approvalTasks=[],attempts=[];
  async function launch() {
    const started=Date.now(),attempt={};attempts.push(attempt);
    const app=await _electron.launch({executablePath,args:[path.resolve(__dirname,'..')],env:environment});
    try {
    trackOwnedDesktop(app,{executablePath,mainProcessId:await evaluateBounded(app,()=>process.pid)},attempt,started);
    app.context().setDefaultTimeout(15000);
    app.on('window',page=>page.on('pageerror',error=>diagnostics.push(error.message)));
    await app.firstWindow();
    await app.evaluate(({dialog},selected)=>{
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});
      dialog.showMessageBox=async()=>({response:1});
    },source);
    const admin=await waitFor(()=>app.windows().find(page=>page.url().includes('mode=admin')),'unconfigured Competition admin');
    await admin.waitForSelector('[data-page="capabilities"]');await admin.locator('[data-page="capabilities"]').click();
    await admin.waitForSelector('[data-skill="install"]');
    const initial=await snapshot(admin);
    assert.equal(initial.capabilityDirectory.state,'loaded','the local authorization directory loads without clicking Refresh');
    assert.deepEqual(initial.capabilities.map(manifest=>manifest.name),['desktop.authorization.intent']);
    return {app,admin,attempt};
    } catch(error) {console.error('Primary launch failure:',error);await closeDesktop(app).catch(cleanup=>console.error('Owned cleanup failure:',cleanup));throw error;}
  }
  async function questionFor(instance){
    const panel=await waitFor(()=>instance.app.windows().find(page=>page.url().includes('mode=panel')),'authorization conversation');
    const question=await waitFor(async()=>(await snapshot(panel)).authorizationQuestions.find(item=>item.state==='pending'),'current authorization question');
    await panel.locator(`[data-question-id="${question.questionId}"]`).waitFor({state:'visible'});
    assert.equal(question.toolName,'desktop.authorization.intent');
    assert.ok(!approvalTasks.includes(question.taskId),'each new operation retains its own Runtime decision task');
    approvalTasks.push(question.taskId);return {panel,question};
  }
  async function allow({panel,question}){
    await panel.locator(`[data-question-id="${question.questionId}"] [data-authorization-decision]:not([data-authorization-decision="deny"])`).click();
    await waitFor(async()=>!(await snapshot(panel)).authorizationQuestions.some(item=>item.questionId===question.questionId&&item.state==='pending'),'original authorization settlement');
  }
  let instance=await launch();
  let receipt,primaryFailure;
  try {
    const {admin}=instance;
    const initialError=(await snapshot(admin)).connectionError;
    assert.equal(await admin.locator('[data-skill="install"]').isDisabled(),false,'offline installation must not require cloud credentials');
    const orb=instance.app.windows().find(page=>page.url().includes('mode=orb'));
    const denied=await orb.evaluate(()=>window.desktop.invoke('skill.install'));
    assert.equal(denied.ok,false,'orb cannot invoke the admin installation API');
    await admin.locator('[data-skill="install"]').click();
    const cancelled=await questionFor(instance);
    await waitFor(async()=>(await snapshot(admin)).tasks.some(task=>task.taskId===cancelled.question.taskId),'the original authorization task in admin projection');
    const stopped=await admin.evaluate(taskId=>window.desktop.invoke('task.cancel',taskId),cancelled.question.taskId);
    assert.equal(stopped.ok,true,stopped.error);
    await admin.waitForFunction(()=>document.querySelector('[data-skill-status]').textContent.includes('已取消'));
    assert.match((await snapshot(admin)).connectionError,/code=(?:CANCELLED|UNAUTHORIZED)/);
    const cancellationDatabase=new DatabaseSync(path.join(userData,'runtime.sqlite'),{readOnly:true});
    try{
      assert.equal(cancellationDatabase.prepare('SELECT state FROM tasks WHERE task_id=?').get(cancelled.question.taskId).state,'cancelled');
      const records=cancellationDatabase.prepare('SELECT record_json FROM tool_execution_records WHERE task_id=?').all(cancelled.question.taskId)
        .map(row=>JSON.parse(row.record_json));
      assert.equal(records.length,1);assert.equal(records[0].executionStarted,false);assert.equal(records[0].errorCode,'CANCELLED');
    }finally{cancellationDatabase.close();}
    assert.equal(fs.existsSync(path.join(userData,'installed-skills.json')),false,'a cancelled authorization must not install the Skill');
    await admin.locator('[data-skill="install"]').click();
    const installQuestion=await questionFor(instance);
    assert.equal((await snapshot(admin)).connectionError,initialError,'the new request restores the original configuration error');
    await admin.waitForFunction(()=>!/code=(?:CANCELLED|UNAUTHORIZED)/.test(document.querySelector('#connection').textContent));
    await allow(installQuestion);
    await admin.waitForSelector('[data-skill="preview"]');
    assert.equal((await snapshot(admin)).connectionError,initialError,'successful installation cannot revive the old cancellation');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData,'installed-skills.json'),'utf8')).entries[0].enabled,false);
    await admin.locator('[data-skill="preview"]').click();
    await admin.waitForFunction(()=>document.querySelector('[data-skill-preview]').textContent.includes('会议目标'));
    assert.ok(await admin.locator('[data-skill-goal]').evaluate(element=>element.getBoundingClientRect().width>300),'actual task field is usable');
    await admin.locator('[data-skill="resource"]').click();
    await admin.waitForFunction(()=>document.querySelector('[data-skill-preview]').textContent.includes('公开指南'));
    assert.equal(await admin.locator('[data-skill-preview] img').count(),0);
    assert.equal(await admin.evaluate(()=>window.resourceExecuted===true),false);
    await admin.locator('[data-skill="enable"]').click();
    await allow(await questionFor(instance));
    await admin.waitForFunction(()=>document.querySelector('[data-skill="enable"]').textContent==='停用');
    assert.equal(await admin.locator('[data-skill="run"]').isDisabled(),true);
    const saved=JSON.parse(fs.readFileSync(path.join(userData,'installed-skills.json'),'utf8'));
    assert.equal(saved.entries.length,1);assert.equal(saved.entries[0].enabled,true);
    const deniedResource=await orb.evaluate(selected=>window.desktop.invoke('skill.resource',{...selected,path:'references/guide.md'}),
      {name:saved.entries[0].name,digest:saved.entries[0].digest});assert.equal(deniedResource.ok,false);
    const rejected=await admin.evaluate(selected=>window.desktop.invoke('skill.run',{...selected,goal:'Public offline probe'}),
      {name:saved.entries[0].name,digest:saved.entries[0].digest});
    assert.equal(rejected.ok,false,'unconfigured Runtime cannot dispatch a Skill');
    await closeDesktop(instance.app);assert.equal(instance.attempt.cleanup.method,'graceful');instance=undefined;
    instance=await launch();
    await instance.admin.waitForSelector('[data-skill="preview"]');
    assert.equal(await instance.admin.locator('[data-skill="enable"]').textContent(),'停用');
    assert.equal(await instance.admin.locator('[data-skill="run"]').isDisabled(),true);
    await instance.admin.locator('[data-skill="uninstall"]').click();
    await allow(await questionFor(instance));
    await instance.admin.waitForFunction(()=>document.querySelector('[data-skill-list]').textContent.includes('尚未安装'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userData,'installed-skills.json'),'utf8')).entries,[]);
    assert.equal(fs.readFileSync(path.join(source,'SKILL.md'),'utf8'),original);
    assert.equal(fs.readFileSync(path.join(example,'SKILL.md'),'utf8'),original);
    const database=new DatabaseSync(path.join(userData,'runtime.sqlite'),{readOnly:true});let tasks;
    try{tasks=database.prepare('SELECT task_id,state FROM tasks ORDER BY rowid').all();}finally{database.close();}
    assert.deepEqual(tasks.map(task=>task.task_id),approvalTasks,'restart must not replay a cancelled or successful operation');
    assert.deepEqual(tasks.map(task=>task.state),['cancelled','succeeded','succeeded','succeeded']);
    assert.deepEqual(diagnostics,[]);
    receipt={state:'passed',main:'actual product',preload:'actual IPC',renderer:'actual admin and conversation',
      nativeDialogs:'explicit synthetic',runtime:'actual Competition authorization control plane and SQLite',runtimeConfigured:false,
      capabilityDirectoryAutoLoaded:true,cancelledNoticeRetired:true,authorizationTasks:tasks,skillRunRejected:rejected.ok===false,
      noModelTask:true,sourceUnchanged:true,restart:true,pageErrors:diagnostics};
  } catch(error){primaryFailure=error;console.error('Primary acceptance failure:',error);throw error;}
  finally {
    if(instance)try{await closeDesktop(instance.app);if(!primaryFailure)assert.equal(instance.attempt.cleanup.method,'graceful');}
    catch(error){console.error('Owned cleanup failure:',error);if(!primaryFailure)throw error;}
    if(receipt){receipt.launches=attempts;fs.writeFileSync(path.join(fixture,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');}
  }
  console.log(JSON.stringify({...receipt,fixture}));
})().catch(error=>{console.error(error);process.exitCode=1;});
