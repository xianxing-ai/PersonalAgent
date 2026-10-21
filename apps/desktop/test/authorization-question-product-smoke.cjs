// Actual Main/Runtime/preload/renderer; only a private Synthetic Skill fixture.
// Browser plugin not available: reuse the repository's Electron/Playwright path.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{spawnSync}=require('node:child_process');
const {_electron}=require('playwright');
(async()=>{
  const repo=path.resolve(process.env.PA_TEST_REPOSITORY||path.join(__dirname,'../../..'));
  const renderOnly=process.env.PA_AUTH_RENDER_ONLY==='1';
  const output=path.join(repo,'.cache/authorization-question-product');fs.mkdirSync(output,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(output,'case-')),skill=path.join(fixture,'synthetic-authorization-fixture'),userData=path.join(fixture,'user-data');
  fs.mkdirSync(skill);fs.writeFileSync(path.join(skill,'SKILL.md'),'---\nname: synthetic-authorization-fixture\ndescription: Synthetic local authorization UI fixture, never run\n---\nDo not run tools. This fixture is installed only for local card interaction.\n');
  const bootstrap=path.join(fixture,'bootstrap.mjs');
  fs.writeFileSync(bootstrap,`import {dialog} from 'electron';
globalThis.__authorizationSmoke={fetchCalls:0,messageBoxes:0};
globalThis.fetch=async()=>{globalThis.__authorizationSmoke.fetchCalls++;throw Error('Synthetic smoke forbids network');};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(skill)}]});
dialog.showMessageBox=async()=>{globalThis.__authorizationSmoke.messageBoxes++;throw Error('No second approval modal permitted');};
await import(${JSON.stringify(pathToFileURL(path.join(repo,'apps/desktop/electron/main.js')).href)});\n`);
  const environment=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PATH','COMSPEC']
    .filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  Object.assign(environment,{PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_USER_DATA_DIR:userData});
  const app=await _electron.launch({executablePath:process.env.PA_TEST_ELECTRON_EXE||path.join(repo,'node_modules/electron/dist/electron.exe'),
    args:[bootstrap],env:environment});
  let phase='launch',panel,admin;const errors=[];
  const receipt={kind:'Synthetic local Skill + actual product authorization',profile:'huawei_ict_agentarts',
    sourceHead:spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).stdout.trim(),
    main:'actual',runtime:'actual TaskRuntime/Policy',preload:'actual',renderer:'actual',business:'isolated Synthetic Skill only',
    models:0,accounts:0,microphones:0,phases:[]};
  const observe=page=>{page.on('pageerror',error=>errors.push({surface:new URL(page.url()).searchParams.get('mode'),name:error.name}));};
  app.on('window',observe);for(const page of app.windows())observe(page);
  async function surface(mode){for(let i=0;i<200;i++){const page=app.windows().find(p=>new URL(p.url()).searchParams.get('mode')===mode);if(page)return page;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Product surface not available: '+mode);}
  const invoke=(page,name,body)=>page.evaluate(async({name,body})=>{const response=await window.desktop.invoke(name,body);
    if(response?.ok!==true)throw Error('Product IPC rejected: '+name);return response.value;},{name,body});
  const snapshot=page=>invoke(page,'snapshot');
  async function until(check){for(let i=0;i<240;i++){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Acceptance state not reached: '+phase);}
  const skills=async()=> (await snapshot(admin)).installedSkills.items;
  const enabled=async value=>until(async()=>{const item=(await skills())[0];return item?.enabled===value&&item;});
  const pending=async()=> (await snapshot(panel)).authorizationQuestions.filter(q=>q.state==='pending');
  async function question(){panel??=await surface('panel');const value=await until(async()=>{const all=await pending();return all.length===1&&all[0];});
    await panel.locator(`[data-question-id="${value.questionId}"] [data-authorization-decision="allow_once"]`).waitFor({state:'visible'});
    assert.ok(value.sourceApprovalId,'real original Runtime approval identity');
    assert.equal(await panel.locator(`[data-approval-id="${value.sourceApprovalId}"]`).count(),0,'no second original approval action');
    assert.equal(value.sandbox.native.required,false);assert.match(await panel.locator(`[data-question-id="${value.questionId}"]`).textContent(),/不启动外部进程/);
    return value;
  }
  async function choose(value,decision,key='Enter'){
    const button=panel.locator(`[data-question-id="${value.questionId}"] [data-authorization-decision="${decision}"]`);
    await button.focus();await button.press(key);
    await until(async()=> !(await pending()).some(q=>q.questionId===value.questionId));
    assert.equal(await button.isDisabled(),true,'resolved card cannot resubmit');
  }
  const skillButton=action=>admin.locator(`[data-skill="${action}"][data-name="synthetic-authorization-fixture"]`);
  try {
    await app.firstWindow();assert.equal(await app.evaluate(()=>process.versions.electron),'44.2.0');
    admin=await surface('admin');await admin.locator('[data-page="capabilities"]').click();
    await admin.locator('[data-skill="install"]').waitFor({state:'visible'});
    assert.equal((await invoke(admin,'authorization.sandbox.read')).rules.filter(r=>r.active).length,0);
    phase='allow-once';await admin.locator('[data-skill="install"]').click();let current=await question();
    await panel.waitForFunction(id=>{const title=[...document.querySelectorAll('[data-question-id]')].find(n=>n.dataset.questionId===id)?.querySelector('h3'),
      thread=document.querySelector('.thread');if(!title||!thread)return false;const a=title.getBoundingClientRect(),b=thread.getBoundingClientRect();
      return a.top>=b.top&&a.bottom<=b.bottom;},current.questionId);
    await panel.screenshot({path:path.join(fixture,'01-once-question.png')});
    if(renderOnly){await panel.locator(`[data-question-id="${current.questionId}"] [data-authorization-decision="allow_once"]`).focus();
      await panel.screenshot({path:path.join(fixture,'02-question-keyboard-actions.png')});}
    await choose(current,'allow_once');
    await enabled(false);assert.equal((await invoke(admin,'authorization.sandbox.read')).rules.filter(r=>r.active).length,0,'once never creates a permanent rule');
    receipt.phases.push({phase,state:'verified',secondModal:false});
    if(!renderOnly){
    phase='allow-always';await skillButton('enable').click();current=await question();assert.equal(current.canAlways,true);
    await panel.screenshot({path:path.join(fixture,'02-permanent-question.png')});await choose(current,'allow_always');await enabled(true);
    const rules=(await invoke(admin,'authorization.sandbox.read')).rules.filter(r=>r.active);assert.ok(rules.length>0);
    await skillButton('enable').click();await enabled(false);await skillButton('enable').click();await enabled(true);
    assert.equal((await pending()).length,0,'same scoped rule is reused without another question');
    receipt.phases.push({phase,state:'verified',activeRules:rules.length,sameScopeReuse:true});
    phase='settings-revoke';await admin.locator('[data-page="authorizations"]').click();
    await admin.locator('[data-authorization-profile]').waitFor({state:'visible'});
    assert.equal(await admin.locator('[data-todo="enable"],[data-feeds="enable"],[data-coding="authorize"]').count(),0);
    await admin.screenshot({path:path.join(fixture,'03-sandbox-rules.png')});
    for(const rule of rules){await admin.locator(`[data-authorization-rule="${rule.ruleId}"]`).click();
      await until(async()=>!(await invoke(admin,'authorization.sandbox.read')).rules.some(r=>r.ruleId===rule.ruleId&&r.active));}
    await admin.locator('[data-page="capabilities"]').click();await skillButton('enable').click();await enabled(false);
    phase='deny-after-revoke';await skillButton('enable').click();current=await question();await choose(current,'deny','Space');
    await enabled(false);receipt.phases.push({phase,state:'verified',newQuestion:true});
    phase='profile-invalidates-pending';await skillButton('enable').click();current=await question();
    await admin.locator('[data-page="authorizations"]').click();await admin.locator('[data-authorization-profile]').selectOption('workspace-write');
    await until(async()=> (await snapshot(panel)).authorizationQuestions.find(q=>q.questionId===current.questionId)?.state==='stale');
    assert.equal(await panel.locator(`[data-question-id="${current.questionId}"] [data-authorization-decision="allow_once"]`).isDisabled(),true);
    await enabled(false);receipt.phases.push({phase,state:'verified'});
    phase='new-profile-asks-again';await admin.locator('[data-page="capabilities"]').click();await skillButton('enable').click();current=await question();
    const stale=await panel.evaluate(async body=>{try{return await window.desktop.invoke('authorization.question.respond',body);}catch{return {ok:false};}},
      {questionId:current.questionId,expectedRevision:current.revision-1,decision:'allow_once'});
    assert.ok(stale.ok!==true||stale.value?.accepted!==true);assert.equal((await pending()).length,1);
    await choose(current,'allow_once');await enabled(true);receipt.phases.push({phase,state:'verified',staleRevisionRejected:true});
    }else {await admin.locator('[data-page="authorizations"]').click();await admin.locator('[data-authorization-profile]').waitFor({state:'visible'});
      await admin.screenshot({path:path.join(fixture,'03-sandbox-rules.png')});receipt.phases.push({phase:'first-pending-visible',state:'verified',keyboardFocus:true,settingsRulesOnly:true});}
    assert.deepEqual(errors,[]);receipt.consoleErrors=errors;receipt.network=await app.evaluate(()=>globalThis.__authorizationSmoke);
    assert.deepEqual(receipt.network,{fetchCalls:0,messageBoxes:0});receipt.state='passed';
    fs.writeFileSync(path.join(fixture,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({...receipt,evidenceDirectory:fixture}));
  } catch(error){receipt.state='failed';receipt.failedPhase=phase;receipt.failureName=error.name;receipt.consoleErrors=errors;
    if(admin)try{receipt.skillStatus=await admin.locator('[data-skill-status]').textContent();await admin.screenshot({path:path.join(fixture,'failed-admin.png')});}catch{}
    if(panel){try{const data=await snapshot(panel);receipt.pending=data.authorizationQuestions.map(q=>({state:q.state,toolName:q.toolName,sourceApprovalIdPresent:Boolean(q.sourceApprovalId)}));
      await panel.screenshot({path:path.join(fixture,'failed-panel.png')});}catch{}}
    fs.writeFileSync(path.join(fixture,'receipt.json'),JSON.stringify(receipt,null,2));console.error(JSON.stringify({...receipt,evidenceDirectory:fixture}));throw error;
  } finally {if(panel)try{for(const q of await pending())await invoke(panel,'task.cancel',{taskId:q.taskId});}catch{}await app.close();}
})().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
