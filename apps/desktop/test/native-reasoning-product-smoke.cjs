// Actual Competition main/preload/admin; synthetic configuration, zero model calls.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
  const cache=path.resolve(__dirname,'../../../.cache/native-reasoning-product');fs.mkdirSync(cache,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(cache,'case-')),userData=path.join(fixture,'user-data');
  const environment=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PATH','COMSPEC']
    .filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  Object.assign(environment,{PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_USER_DATA_DIR:userData});
  const executablePath=path.resolve(__dirname,'../../../node_modules/electron/dist/electron.exe');
  async function launch(){
    const app=await _electron.launch({executablePath,args:[path.resolve(__dirname,'..')],env:environment});
    try {
      await app.firstWindow();
      await app.evaluate(()=>{globalThis.nativeSmokeCalls=0;globalThis.fetch=async()=>{
        globalThis.nativeSmokeCalls++;throw Error('No network allowed by this smoke test');};});
      let admin;
      for(let i=0;i<100;i++){admin=app.windows().find(page=>page.url().includes('mode=admin'));if(admin)break;await new Promise(resolve=>setTimeout(resolve,50));}
      assert.ok(admin,'unconfigured Competition opens admin');
      await admin.waitForSelector('[data-page="models"]');await admin.locator('[data-page="models"]').click();
      await admin.waitForSelector('[data-model-api="saved"]',{state:'attached'});
      await admin.locator('details').filter({has:admin.locator('[data-model-api="saved"]')}).locator('summary').click();
      return {app,admin};
    } catch(error){await app.close();throw error;}
  }
  let instance=await launch();
  const field=(page,name)=>page.locator(`[data-model-api="${name}"]`);
  try {
    let {app,admin}=instance;
    await field(admin,'provider').selectOption('openai-compatible');
    await field(admin,'displayName').fill('Synthetic native model');
    await field(admin,'baseUrl').fill('https://synthetic.invalid/v1');
    await field(admin,'model').fill('synthetic-native');
    await field(admin,'key').fill('synthetic-not-a-real-key');
    await field(admin,'nativeThinking').selectOption('enabled');
    await admin.locator('[data-model-effort="max"]').check();
    await field(admin,'nativeEffort').selectOption('max');
    await field(admin,'outputTokenParameter').selectOption('max_completion_tokens');
    await field(admin,'reasoningConfirmed').check();
    await field(admin,'save').click();
    await admin.waitForFunction(async()=>{const r=await window.desktop.invoke('modelApi.state');return r.value?.models?.length===1;});
    const state=(await admin.evaluate(()=>window.desktop.invoke('modelApi.state'))).value;
    const native={thinking:'enabled',effort:'max',supportedEfforts:['max'],outputTokenParameter:'max_completion_tokens'};
    assert.deepEqual(state.models[0].nativeReasoning,native);
    assert.equal(state.models[0].nativeReasoningVerified,false);
    assert.equal(await field(admin,'key').inputValue(),'');
    assert.doesNotMatch(JSON.stringify(state),/synthetic-not-a-real-key/);
    assert.doesNotMatch(fs.readFileSync(path.join(userData,'model-api-config.json'),'utf8'),/synthetic-not-a-real-key/);
    assert.equal(await app.evaluate(()=>globalThis.nativeSmokeCalls),0);
    await admin.screenshot({path:path.join(fixture,'native-settings.png')});
    await app.close();instance=undefined;
    instance=await launch();({app,admin}=instance);
    await field(admin,'saved').selectOption(state.models[0].id);
    assert.equal(await field(admin,'nativeThinking').inputValue(),'enabled');
    assert.equal(await field(admin,'nativeEffort').inputValue(),'max');
    assert.equal(await field(admin,'outputTokenParameter').inputValue(),'max_completion_tokens');
    await field(admin,'baseUrl').fill('https://changed.invalid/v1');
    assert.equal(await field(admin,'nativeThinking').inputValue(),'');
    assert.equal(await field(admin,'reasoningConfirmed').isChecked(),false);
    await field(admin,'saved').selectOption(state.models[0].id);
    await field(admin,'remove').click();
    await admin.waitForFunction(async()=>{const r=await window.desktop.invoke('modelApi.state');return r.value?.models?.length===0;});
    assert.equal(await app.evaluate(()=>globalThis.nativeSmokeCalls),0);
    console.log(JSON.stringify({state:'passed',profile:'huawei_ict_agentarts',main:'actual product',preload:'actual IPC',
      renderer:'actual admin',configuration:'synthetic',encrypted:true,restart:true,destinationReset:true,removed:true,
      modelCalls:0,screenshot:path.join(fixture,'native-settings.png')}));
  } finally {await instance?.app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
