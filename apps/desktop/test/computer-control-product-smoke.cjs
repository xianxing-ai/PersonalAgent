// Real Main / Preload / IPC / renderer / Runtime, Competition profile only.
// Default is metadata preflight. --run requires the controller's exclusive device slot.
// No task.submit, model call, desktop observation, target screenshot or user-window input.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../../..'),desktop=path.join(repo,'apps/desktop');
const source=path.resolve(process.env.PA_PRODUCT_SMOKE_SOURCE_PROFILE||path.join(process.env.APPDATA
  ||path.join(require('node:os').homedir(),'AppData/Roaming'),'@personal-agent/desktop'));
const executable=process.env.PA_PRODUCT_SMOKE_ELECTRON_EXE||path.join(repo,'node_modules/electron/dist/electron.exe');
const broker=path.join(repo,'apps/windows-host/desktop/bin/Release/net8.0-windows/WindowsHost.Desktop.exe');
const copiedFiles=['Local State','agentarts-config.json'];
const preflight={kind:'real-product-computer-control',profile:'huawei_ict_agentarts',runRequested:process.argv.includes('--run'),
  electronExists:fs.existsSync(executable),nativeBrokerExists:fs.existsSync(broker),
  copiedConfigurationAvailable:copiedFiles.every(name=>fs.existsSync(path.join(source,name))),
  runtimeBuilt:fs.existsSync(path.join(repo,'apps/runtime/dist/index.js')),
  requiredSlot:'exclusive visible Electron/native-component slot',copyAllowlist:copiedFiles};
const allowedActions=new Set(['snapshot','orb.open','admin.open','authorization.sandbox.read','authorization.sandbox.select',
  'authorization.question.respond','computer.control.configure','computer.control.prepare','computer.control.stop','computer.vision.configure']);
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(work,predicate,label,timeout=20000){
  const until=Date.now()+timeout;let value;
  while(Date.now()<until){value=await work();if(predicate(value))return value;await delay(100);}
  throw Error(`Timed out: ${label}`);
}
async function raw(page,action,payload){
  assert.ok(allowedActions.has(action),`Runner action is outside the no-model/no-observation allowlist: ${action}`);
  return page.evaluate(({action,payload})=>window.desktop.invoke(action,payload),{action,payload});
}
async function invoke(page,action,payload){
  const response=await raw(page,action,payload);
  assert.equal(response?.ok,true,`${action} failed (${response?.errorCode||'no code'}): ${response?.error||'no safe diagnostic'}`);
  return response.value;
}
const snapshot=page=>invoke(page,'snapshot');
const pendingQuestion=data=>data.authorizationQuestions?.find(question=>question.state==='pending'
  &&question.requirements?.some(requirement=>requirement.scopes?.includes('computer.observation.configure')));
async function selectPolicy(admin,ref){
  const current=await invoke(admin,'authorization.sandbox.read');
  return invoke(admin,'authorization.sandbox.select',{profileRef:ref,expectedRevision:current.selected.revision});
}
async function pageFor(app,mode){
  return poll(async()=>app.windows().find(page=>page.url().includes(`mode=${mode}`)),Boolean,`${mode} window`);
}

async function checkVisionSettings({app,admin,panel,profile,record,capture}){
  const section=admin.locator('.computer-vision-controls');await section.waitFor({state:'visible'});
  const field=name=>section.locator(`[data-vision="${name}"]`),save=field('save'),feedback=field('feedback');
  const file=path.join(profile,'computer-vision-config.json'),backup=file+'.smoke-encrypted-backup';
  const cloud={source:'agentarts-proxy',baseUrl:'https://computer-vision-smoke.huaweicloud-agentarts.com/inference/v1',model:'deepseek-v4.1-flash'};
  const custom={source:'openai-compatible',baseUrl:'https://computer-vision-smoke.invalid/v1',model:'smoke-vision-model'};
  // Non-functional, per-run placeholders test actual safeStorage, never a model endpoint.
  const keys={cloud:'vision-smoke-cloud-'+randomUUID(),custom:'vision-smoke-custom-'+randomUUID(),draft:'vision-smoke-draft-'+randomUUID(),retry:'vision-smoke-retry-'+randomUUID()};
  const noSecrets=value=>assert.equal(Object.values(keys).some(secret=>JSON.stringify(value).includes(secret)),false,'vision secrets must not appear in public data');
  const read=async()=>{const data=await snapshot(admin);noSecrets(data);return data.computerControl.vision;};
  const idle=()=>poll(()=>section.getAttribute('aria-busy'),value=>value==='false','vision settings readback');
  const submit=async()=>{await save.click();await idle();};
  const visible=async()=>{
    await section.scrollIntoViewIfNeeded();
    noSecrets(await section.textContent());
    noSecrets(await admin.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}})));
  };
  const encrypted=async(expected,key)=>{
    const raw=fs.readFileSync(file,'utf8'),envelope=JSON.parse(raw);noSecrets(raw);
    assert.deepEqual(Object.keys(envelope).sort(),['encrypted','version']);assert.equal(envelope.version,1);
    assert.equal(typeof envelope.encrypted,'string');assert.ok(envelope.encrypted.length>0);
    // Decryption remains in the real Electron Main process. Return booleans, never the key.
    const result=await app.evaluate(({safeStorage},{encrypted,expected,key})=>{
      if(!safeStorage.isEncryptionAvailable())return {encryptionAvailable:false};
      const stored=JSON.parse(safeStorage.decryptString(Buffer.from(encrypted,'base64')));
      return {encryptionAvailable:true,keyMatches:stored.apiKey===key,
        bindingMatches:['revision','source','baseUrl','model','enabled'].every(name=>stored[name]===expected[name]),
        allowedFieldsOnly:Object.keys(stored).every(name=>['version','revision','source','baseUrl','model','enabled','apiKey'].includes(name))};
    },{encrypted:envelope.encrypted,expected,key});
    assert.deepEqual(result,{encryptionAvailable:true,keyMatches:true,bindingMatches:true,allowedFieldsOnly:true});
  };

  const initial=await poll(read,value=>Boolean(value?.revision),'vision default state');
  assert.equal(initial.enabled,false);assert.equal(initial.source,'agentarts-proxy');assert.equal(initial.configured,false);assert.equal(initial.keyConfigured,false);
  assert.equal(initial.baseUrl,'');assert.equal(initial.model,'');assert.equal(fs.existsSync(file),false);
  assert.equal(await field('enabled').isChecked(),false);assert.equal(await field('source').inputValue(),'agentarts-proxy');
  assert.equal(await field('apiKey').getAttribute('type'),'password');assert.equal(await field('apiKey').getAttribute('autocomplete'),'new-password');
  assert.equal(await field('apiKey').inputValue(),'');assert.equal(await save.isEnabled(),true);
  await visible();await capture(admin,'04-vision-default-agentarts-off.png');
  record('real-vision-default-off-agentarts-and-write-only-key');

  await field('enabled').check();await submit();
  assert.match(await feedback.textContent(),/INVALID_ARGUMENT/);assert.match(await feedback.textContent(),/Endpoint.*模型名称/);
  assert.equal((await read()).revision,initial.revision);
  await field('baseUrl').fill(cloud.baseUrl);await field('model').fill(cloud.model);await submit();
  assert.match(await feedback.textContent(),/INVALID_ARGUMENT/);assert.match(await feedback.textContent(),/API Key/);
  assert.equal((await read()).revision,initial.revision);assert.equal(fs.existsSync(file),false);
  record('real-vision-required-destination-and-key-rejected-without-persistence');

  await field('apiKey').fill(keys.cloud);await submit();
  const cloudState=await read();
  for(const name of ['source','baseUrl','model'])assert.equal(cloudState[name],cloud[name]);
  assert.equal(cloudState.enabled,true);assert.equal(cloudState.configured,true);assert.equal(cloudState.keyConfigured,true);
  assert.equal(await field('apiKey').inputValue(),'');assert.match(await feedback.textContent(),/已保存/);
  assert.doesNotMatch(await feedback.textContent(),/识别成功|已经验证/);
  await encrypted(cloudState,keys.cloud);await visible();await capture(admin,'05-vision-agentarts-encrypted-saved.png');
  record('real-vision-agentarts-form-safeStorage-encrypted-with-no-key-readback');

  // A typed old credential cannot silently move to a different destination.
  await field('apiKey').fill(keys.cloud);await field('source').selectOption(custom.source);
  assert.equal(await field('apiKey').inputValue(),'');assert.match(await field('keyHint').textContent(),/旧目的地凭据不会自动转移/);
  assert.match(await field('destinationHint').textContent(),/自定义地址.*HTTPS/);
  await field('baseUrl').fill('http://computer-vision-smoke.invalid/v1');await field('model').fill(custom.model);await submit();
  assert.match(await feedback.textContent(),/INVALID_ARGUMENT/);assert.match(await feedback.textContent(),/HTTPS/);
  await field('baseUrl').fill(custom.baseUrl);await submit();
  assert.match(await feedback.textContent(),/INVALID_ARGUMENT/);assert.match(await feedback.textContent(),/重新填写 API Key/);
  assert.equal((await read()).revision,cloudState.revision);
  await field('apiKey').fill(keys.custom);await submit();
  const customState=await read();
  for(const name of ['source','baseUrl','model'])assert.equal(customState[name],custom[name]);
  assert.equal(await field('apiKey').inputValue(),'');await encrypted(customState,keys.custom);
  const denied=await raw(panel,'computer.vision.configure',{...custom,expectedRevision:customState.revision,enabled:false});
  noSecrets(denied);assert.equal(denied.ok,false);assert.equal(denied.errorCode,'UNAUTHORIZED');
  assert.equal((await read()).revision,customState.revision);
  await visible();await capture(admin,'06-vision-custom-encrypted-saved.png');
  record('real-vision-custom-form-destination-key-rebind-and-admin-only-ipc');

  // The real renderer keeps its old draft while another valid IPC changes Main.
  await field('model').fill('retained-custom-draft');await field('apiKey').fill(keys.draft);
  const update=await invoke(admin,'computer.vision.configure',{...custom,expectedRevision:customState.revision,enabled:false});noSecrets(update);
  const newer=await read();assert.notEqual(newer.revision,customState.revision);assert.equal(newer.enabled,false);
  await submit();assert.match(await feedback.textContent(),/REVISION_CONFLICT/);
  assert.equal(await field('model').inputValue(),'retained-custom-draft');assert.equal(await field('apiKey').inputValue(),keys.draft);
  assert.equal((await read()).revision,newer.revision);assert.equal((await read()).model,custom.model);
  await visible();await capture(admin,'07-vision-CAS-preserves-draft.png');
  await field('reload').click();assert.equal(await field('model').inputValue(),custom.model);assert.equal(await field('apiKey').inputValue(),'');
  assert.equal(await field('enabled').isChecked(),false);
  record('real-vision-CAS-rejects-stale-draft-and-explicit-reload-clears-key');

  // Block the actual atomic rename with a directory at this run's own config path.
  assert.equal(fs.existsSync(backup),false);fs.renameSync(file,backup);fs.mkdirSync(file);
  try{
    await field('enabled').check();await field('apiKey').fill(keys.retry);await submit();
    const failed=await read();
    assert.ok(['EISDIR','EPERM','EACCES','ENOTDIR','EEXIST'].includes(failed.failure?.code),'real filesystem failure must preserve its OS code');
    assert.equal(failed.failure.stage,'computer.vision.configure');assert.equal(failed.revision,newer.revision);assert.equal(failed.enabled,false);
    assert.ok((await feedback.textContent()).includes(`[${failed.failure.code}]`));assert.match(await feedback.textContent(),/computer\.vision\.configure/);
    assert.equal((await feedback.textContent()).includes(profile),false);assert.equal(await field('apiKey').inputValue(),keys.retry);
    await visible();await capture(admin,'08-vision-real-storage-error.png');
    record('real-vision-filesystem-error-code-stage-redaction-and-draft-preservation',{code:failed.failure.code});
  }finally{
    if(fs.existsSync(file)&&fs.statSync(file).isDirectory())fs.rmdirSync(file);
    if(fs.existsSync(backup))fs.renameSync(backup,file);
  }
  await submit();const retried=await read();assert.equal(retried.enabled,true);assert.equal(retried.failure,undefined);
  assert.equal(await field('apiKey').inputValue(),'');await encrypted(retried,keys.retry);
  await field('enabled').uncheck();await submit();
  const final=await read();assert.equal(final.enabled,false);assert.equal(final.keyConfigured,true);await encrypted(final,keys.retry);
  await visible();record('real-vision-storage-retry-and-same-destination-empty-key-preserves-encrypted-secret');
  return {expected:final,noSecrets};
}

async function run(){
  if(!preflight.runRequested){console.log(JSON.stringify({...preflight,state:'prepared_not_run'}));return;}
  assert.equal(process.platform,'win32','This real product smoke requires Windows');
  for(const key of ['electronExists','nativeBrokerExists','copiedConfigurationAvailable','runtimeBuilt'])assert.equal(preflight[key],true,`Missing precondition: ${key}`);
  const output=path.join(repo,'.cache/computer-control-product-smoke');fs.mkdirSync(output,{recursive:true});
  const evidence=fs.mkdtempSync(path.join(output,'run-')),profile=path.join(evidence,'isolated-profile');fs.mkdirSync(profile);
  for(const name of copiedFiles)fs.copyFileSync(path.join(source,name),path.join(profile,name),fs.constants.COPYFILE_EXCL);
  assert.deepEqual(fs.readdirSync(profile).sort(),[...copiedFiles].sort(),'Only the two approved configuration files may be copied');
  const originalConfiguration=Object.fromEntries(copiedFiles.map(name=>[name,digest(path.join(source,name))]));
  const plannerConfiguration=digest(path.join(profile,'agentarts-config.json'));
  const receipt={kind:preflight.kind,profile:preflight.profile,configuration:'isolated copied encrypted configuration; not formal user data',
    copiedFiles,checks:[],screenshots:[],runnerModelTasks:0,runnerDesktopObservations:0,runnerUserWindowInputs:0,
    visionCredentials:'synthetic non-functional placeholders; real Electron safeStorage',visionRequests:'not_invoked_configuration_only',
    visualReview:'manual_review_of_screenshots_required',realCloudAcceptance:'not_run',state:'running'};
  const receiptFile=path.join(evidence,'receipt.json');
  const record=(name,extra={})=>{receipt.checks.push({name,state:'passed',...extra});fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));console.log(`passed: ${name}`);};
  const capture=async(page,name)=>{const file=path.join(evidence,name);await page.screenshot({path:file});receipt.screenshots.push(file);};
  const env={...process.env};
  for(const key of Object.keys(env))if(/^PA_|^PANGU_|^ELECTRON_RUN_AS_NODE$|^NODE_OPTIONS$/i.test(key))delete env[key];
  env.PA_RUNTIME_PROFILE='huawei_ict_agentarts';env.PA_USER_DATA_DIR=profile;
  let app,admin;
  const faultDirectory=path.join(profile,'computer-control.json.next');
  try{
    const {_electron}=require('playwright');
    app=await _electron.launch({executablePath:executable,args:[desktop],env,timeout:30000});
    await app.firstWindow();
    assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
    assert.equal(await app.evaluate(()=>process.env.PA_RUNTIME_PROFILE),'huawei_ict_agentarts');
    const orb=await pageFor(app,'orb');await invoke(orb,'orb.open');
    const panel=await pageFor(app,'panel');await invoke(panel,'admin.open',{page:'computer'});
    admin=await pageFor(app,'admin');admin.setDefaultTimeout(15000);panel.setDefaultTimeout(15000);
    await admin.locator('[data-page="computer"]').click();
    const controls=admin.locator('.computer-controls');await controls.waitFor({state:'visible'});
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(window=>window.isVisible()&&window.webContents.getURL().includes('mode=admin'))),true);
    const initial=await poll(()=>snapshot(admin),data=>data.fake===false&&data.fakeModel===false&&data.privateMemory?.available===true,'real Competition Runtime');
    assert.equal(initial.computerControl.provider?.source,'windows-native');
    record('real-main-preload-ipc-renderer-competition-runtime');
    const enabled=controls.locator('[data-computer="enabled"]'),exports=controls.locator('[data-computer="export"]');
    const prepare=controls.locator('[data-computer-action="prepare"]'),stop=controls.locator('[data-computer-action="stop"]');
    const feedback=controls.locator('[data-computer="feedback"]');
    // Match Main's real prepare deadline (120s), including its confirmed cleanup.
    const idle=()=>poll(()=>controls.getAttribute('aria-busy'),value=>value==='false','control action readback',130000);
    const readControl=async()=> (await snapshot(admin)).computerControl;

    await selectPolicy(admin,'default-read-only');
    if(await exports.isChecked()){await exports.click();await idle();}
    await prepare.click();await idle();
    await poll(readControl,value=>value.providerAvailable===true,'real native broker prepared');
    record('real-prepare-button-native-broker');

    // A stale decision revision must fail, then the still-current real card may be allowed.
    await exports.click();
    let question=pendingQuestion(await poll(()=>snapshot(admin),data=>Boolean(pendingQuestion(data)),'observation authorization card'));
    const old=await raw(panel,'authorization.question.respond',{questionId:question.questionId,expectedRevision:question.revision-1,decision:'allow_once'});
    assert.equal(old.ok,false);assert.equal(old.errorCode,'REVISION_CONFLICT');
    let card=panel.locator(`[data-question-id=${JSON.stringify(question.questionId)}]`);await card.waitFor({state:'visible'});
    await card.locator('.authorization-question-primary').click();await idle();
    assert.equal((await readControl()).observationExportAllowed,true);
    record('real-authorization-old-revision-rejected-and-current-card-allowed');
    await exports.click();await idle();assert.equal((await readControl()).observationExportAllowed,false);
    await exports.click();
    question=pendingQuestion(await poll(()=>snapshot(admin),data=>Boolean(pendingQuestion(data)),'observation denial card'));
    card=panel.locator(`[data-question-id=${JSON.stringify(question.questionId)}]`);await card.locator('[data-authorization-decision="deny"]').click();
    await idle();assert.equal((await readControl()).observationExportAllowed,false);
    assert.match(await feedback.textContent(),/UNAUTHORIZED/);record('real-authorization-denial-preserves-export-deny');

    // Change settings through a second real IPC while the first UI intent awaits its card.
    await exports.click();
    question=pendingQuestion(await poll(()=>snapshot(admin),data=>Boolean(pendingQuestion(data)),'CAS observation authorization card'));
    await invoke(admin,'computer.control.configure',{enabled:false,allowObservationExport:false});
    const stale=await raw(panel,'authorization.question.respond',{questionId:question.questionId,expectedRevision:question.revision,decision:'allow_once'});
    // respond() acknowledges handling a newly stale question without granting it.
    assert.equal(stale.ok,true);assert.equal(stale.value.accepted,false,'an invalidated original intent must not be approved');
    assert.equal(stale.value.state,'stale');assert.equal(stale.value.revision,question.revision+1);
    await idle();assert.equal((await readControl()).enabled,false);assert.equal((await readControl()).observationExportAllowed,false);
    const policy=await invoke(admin,'authorization.sandbox.read');
    await selectPolicy(admin,'full-access');
    const conflict=await raw(admin,'authorization.sandbox.select',{profileRef:'default-read-only',expectedRevision:policy.selected.revision});
    assert.equal(conflict.ok,false);assert.equal(conflict.errorCode,'REVISION_CONFLICT');
    record('real-config-CAS-cannot-resurrect-newer-disable-and-policy-stale-revision-rejected');

    await enabled.click();await idle();assert.equal((await readControl()).enabled,true);
    assert.equal((await readControl()).observationExportAllowed,false,'full access must respect the explicit export deny');
    const before=(await snapshot(admin)).authorizationQuestions?.filter(item=>item.state==='pending').length??0;
    await exports.click();await idle();
    assert.equal((await readControl()).observationExportAllowed,true);
    const after=(await snapshot(admin)).authorizationQuestions?.filter(item=>item.state==='pending').length??0;
    assert.equal(after,before,'full access must not add an approval card');
    record('full-access-respects-explicit-deny-and-allows-with-zero-extra-cards');

    await prepare.click();await idle();await poll(readControl,value=>value.available===true,'native broker ready after stop/start');
    await controls.locator('[data-computer="text"]').fill('本次冒烟只检查控制入口，不提交模型任务。');
    await capture(admin,'01-computer-ready.png');
    await stop.click();await idle();
    await poll(readControl,value=>value.input?.busy===false&&!['blocked','unknown'].includes(value.state)&&value.providerAvailable===false,'confirmed stop');
    assert.equal(await controls.locator('[data-computer="text"]').inputValue(),'本次冒烟只检查控制入口，不提交模型任务。');
    await capture(admin,'02-computer-stopped.png');record('real-stop-button-and-draft-preservation');

    // Real fs failure in this runner-owned profile; no handler or Runtime is stubbed.
    assert.equal(fs.existsSync(faultDirectory),false);fs.mkdirSync(faultDirectory);
    await enabled.click();await idle();
    assert.match(await feedback.textContent(),/EISDIR/,'the actual filesystem error code must be visible');
    assert.match(await feedback.textContent(),/configure|保存设置/);
    assert.equal((await readControl()).enabled,true,'failed persistence must not pretend settings changed');
    assert.equal((await feedback.textContent()).includes(profile),false,'private profile path must be redacted');
    await capture(admin,'03-computer-technical-error.png');record('actual-EISDIR-error-visible-with-code-stage-and-redacted-path');
    fs.rmdirSync(faultDirectory);
    await enabled.click();await idle();assert.equal((await readControl()).enabled,false);

    const vision=await checkVisionSettings({app,admin,panel,profile,record,capture});
    assert.equal(digest(path.join(profile,'agentarts-config.json')),plannerConfiguration,'vision configuration must not replace default AgentArts planning configuration');
    // Restart this isolated product to test the production restore path, not a fixture decoder.
    await require('../test-support/close-desktop.cjs').closeDesktop(app);app=undefined;admin=undefined;
    app=await _electron.launch({executablePath:executable,args:[desktop],env,timeout:30000});
    await app.firstWindow();assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
    const restoredOrb=await pageFor(app,'orb');await invoke(restoredOrb,'orb.open');
    const restoredPanel=await pageFor(app,'panel');await invoke(restoredPanel,'admin.open',{page:'computer'});
    admin=await pageFor(app,'admin');admin.setDefaultTimeout(15000);
    const restored=await poll(()=>snapshot(admin),data=>Boolean(data.computerControl?.vision?.revision),'restored vision configuration');vision.noSecrets(restored);
    for(const name of ['revision','source','baseUrl','model','enabled','keyConfigured','configured'])
      assert.equal(restored.computerControl.vision[name],vision.expected[name],`restored vision ${name}`);
    const restoredVision=admin.locator('.computer-vision-controls');await restoredVision.waitFor({state:'visible'});
    assert.equal(await restoredVision.locator('[data-vision="apiKey"]').inputValue(),'');
    assert.equal(await restoredVision.locator('[data-vision="source"]').inputValue(),'openai-compatible');
    assert.equal(await restoredVision.locator('[data-vision="enabled"]').isChecked(),false);
    await restoredVision.scrollIntoViewIfNeeded();await capture(admin,'09-vision-restored-after-product-restart.png');
    assert.equal(digest(path.join(profile,'agentarts-config.json')),plannerConfiguration);
    for(const name of copiedFiles)assert.equal(digest(path.join(source,name)),originalConfiguration[name],'formal source configuration must remain unchanged');
    record('real-product-restart-restores-encrypted-vision-without-key-readback-or-default-planner-change');
    await app.evaluate(({BrowserWindow})=>{
      const ownAdmin=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('mode=admin'));
      ownAdmin.setSize(600,760);
    });
    await poll(()=>admin.evaluate(()=>innerWidth),width=>width<=640,'narrow admin viewport');
    const narrow=await restoredVision.evaluate(section=>{
      const bounds=section.getBoundingClientRect(),main=section.closest('.main');
      const controls=[...section.querySelectorAll('input:not([type="checkbox"]),select,button')].map(control=>{
        const rect=control.getBoundingClientRect();
        return {field:control.dataset.vision,contained:rect.width>0&&rect.left>=bounds.left&&rect.right<=bounds.right};
      });
      return {width:innerWidth,sectionFits:section.scrollWidth<=section.clientWidth+1,mainFits:main.scrollWidth<=main.clientWidth+1,controls};
    });
    assert.equal(narrow.sectionFits,true);assert.equal(narrow.mainFits,true);assert.ok(narrow.controls.every(control=>control.contained));
    await restoredVision.locator('h2').scrollIntoViewIfNeeded();await capture(admin,'10-vision-narrow-form.png');
    await restoredVision.locator('[data-vision="save"]').scrollIntoViewIfNeeded();await capture(admin,'11-vision-narrow-actions.png');
    record('real-vision-narrow-window-inputs-and-actions-without-horizontal-overflow',{viewportWidth:narrow.width});
    receipt.state='passed';
  }catch(error){
    receipt.state='failed';
    const {computerControlFailure}=await import('../electron/computer-control-errors.js');
    receipt.failure=computerControlFailure(error,'product_smoke');
    if(admin)await capture(admin,'failure-admin.png').catch(()=>{});
    process.exitCode=1;
  }finally{
    if(fs.existsSync(faultDirectory)&&fs.statSync(faultDirectory).isDirectory())fs.rmdirSync(faultDirectory);
    if(app){
      const ownedPid=app.process().pid;
      // Cancel only this isolated run's configuration questions before normal quit.
      if(admin)try{
        const data=await snapshot(admin);
        for(const question of data.authorizationQuestions??[])if(question.state==='pending'
          &&question.requirements?.some(item=>item.scopes?.includes('computer.observation.configure')))
          await raw(admin,'authorization.question.respond',{questionId:question.questionId,expectedRevision:question.revision,decision:'deny'});
      }catch{/* Preserve the original test failure; forced cleanup is scoped to our PID below. */}
      try{await require('../test-support/close-desktop.cjs').closeDesktop(app);receipt.close='own-product-quit';}
      catch{
        // Only our spawned Electron and its descendants; never discover/kill another app.
        const result=spawnSync('C:/Windows/System32/taskkill.exe',['/PID',String(ownedPid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
        receipt.close=result.status===0?'own-tree-forced-after-quit-failed':'own-process-already-exited-or-stop-unconfirmed';
      }
    }
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
    console.log(JSON.stringify({state:receipt.state,checks:receipt.checks.length,evidenceDirectory:evidence,receipt:receiptFile}));
  }
}
run().catch(error=>{console.error(`Product smoke preparation failed: ${error.code||error.name||'ERROR'}`);process.exitCode=1;});
