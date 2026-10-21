// Actual Competition Main / preload / renderer. Default: Synthetic memory-policy
// refusal, zero weight loading. --real-local-health additionally requires explicit
// operator authorization and starts only the existing project-owned local service.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {pathToFileURL} = require('node:url');
const os = require('node:os');
const {_electron} = require('playwright');

(async () => {
  const realHealth = process.argv.includes('--real-local-health');
  const cache = path.resolve(__dirname, '../../../.cache/laya-settings-product');
  fs.mkdirSync(cache, {recursive:true});
  const fixture = fs.mkdtempSync(path.join(cache, 'case-'));
  const resources = {freeMemoryBeforeBytes:os.freemem()};
  const env = Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH',
    'APPDATA','LOCALAPPDATA','PATH','COMSPEC'].filter(key => process.env[key]).map(key => [key,process.env[key]]));
  Object.assign(env, {PA_RUNTIME_PROFILE:'huawei_ict_agentarts', PA_USER_DATA_DIR:path.join(fixture,'user-data')});
  if (!realHealth) env.PA_LAYA_MIN_FREE_MEM_BYTES = String(Number.MAX_SAFE_INTEGER);
  const executablePath = path.resolve(__dirname, '../../../node_modules/electron/dist/electron.exe');
  const bootstrap = path.join(fixture, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `require(${JSON.stringify(path.join(__dirname,'laya-settings-bootstrap.cjs'))})
    .runLayaSmokeBootstrap(() => import(${JSON.stringify(pathToFileURL(path.join(__dirname,'../electron/main.js')).href)}))
    .catch(() => {console.error('Laya smoke Main bootstrap failed');process.exit(1);});\n`);
  const app = await _electron.launch({executablePath,args:[bootstrap],env});
  const errors = [];
  let admin, phase = 'open-settings';
  try {
    app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    await app.firstWindow();
    for(let i=0;i<100;i++) {
      admin = app.windows().find(page => page.url().includes('mode=admin'));
      if(admin)break;
      await new Promise(resolve => setTimeout(resolve,50));
    }
    assert.ok(admin, 'unconfigured cloud opens the actual admin');
    admin.on('pageerror', error => errors.push(error.message));
    await admin.waitForSelector('[data-page="connections"]');
    await admin.locator('[data-page="connections"]').click();
    const start = admin.locator('[data-laya="start"]'), stop = admin.locator('[data-laya="stop"]');
    await start.waitFor({state:'visible'});
    const snapshot = () => admin.evaluate(async () => (await window.desktop.invoke('snapshot')).value);
    const before = await snapshot();
    assert.equal(before.laya.state, 'stopped', 'cloud configuration failure must not skip the local service host');
    assert.equal(await start.isDisabled(),false);
    phase = 'click-start';
    await start.click();
    phase = 'wait-host-terminal';
    const expected = realHealth ? 'ready' : 'memory_insufficient';
    await admin.waitForFunction(async () => {
      const value = (await window.desktop.invoke('snapshot')).value?.laya;
      return ['ready','memory_insufficient','error','unavailable','identity_changed','stop_unconfirmed'].includes(value?.state);
    // The original host owns its startup deadline and stop confirmation. Do not
    // preempt it with a separate observer deadline while it still says starting.
    }, undefined, {timeout:realHealth?0:10_000});
    const after = await snapshot();
    if(realHealth && after.laya.state==='memory_insufficient') {
      const screenshot = path.join(fixture,'laya-original-memory-refusal.png');
      await admin.screenshot({path:screenshot});
      const network = await app.evaluate(() => globalThis.layaSmokeNetwork);
      assert.equal(network.health,0); assert.equal(network.blocked,0);
      console.log(JSON.stringify({state:'not_run',reason:'original_memory_gate',trigger:'verified',
        main:'actual Competition without cloud/mail configuration',preload:'actual IPC',renderer:'actual admin',
        hostState:after.laya.state,weightLoading:false,businessInference:false,network,resources,
        screenshot:path.relative(process.cwd(),screenshot)}));
      process.exitCode=2; return;
    }
    assert.equal(after.laya.state,expected);
    assert.equal(await start.isDisabled(),realHealth);
    assert.equal(await stop.isDisabled(),!realHealth);
    const screenshot = path.join(fixture,realHealth?'laya-ready.png':'laya-memory-refusal.png');
    await admin.screenshot({path:screenshot});
    if(realHealth) {
      phase = 'click-stop';
      await stop.click();
      await admin.waitForFunction(() => document.querySelector('[data-laya="status"]').textContent==='本地模型已停止');
      assert.equal((await snapshot()).laya.state,'stopped');
      assert.equal(await start.isDisabled(),false);
    } else {
      await admin.locator('[data-page="memory"]').click();
      await start.waitFor({state:'visible'});
      assert.equal(await start.isDisabled(),false);
      await start.click();
      await admin.waitForFunction(() => document.querySelector('[data-laya="status"]').textContent.includes('可用内存不足'));
      assert.equal((await snapshot()).laya.state,'memory_insufficient');
    }
    const network = await app.evaluate(() => globalThis.layaSmokeNetwork);
    assert.equal(network.blocked,0, 'no cloud, external request or inference attempt');
    if(!realHealth)assert.equal(network.health,0,'memory refusal precedes model process launch and health polling');
    else {
      assert.ok(network.health>0,'original authenticated host health polling ran');
      assert.equal(network.receipts.at(-1)?.warmed,true,'the owned server loaded weights and completed its original startup warmup');
      assert.equal(network.receipts.at(-1)?.inferenceCalls,0,'no business inference was submitted');
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({state:'passed',main:'actual Competition without cloud/mail configuration',
      preload:'actual IPC',renderer:'actual admin',scenario:realHealth?'existing-local-start-health-stop':'Synthetic memory-policy refusal',
      weightLoading:realHealth,publicSyntheticStartupWarmup:realHealth,businessInference:false,network,pageErrors:errors.length,
      resources,
      screenshot:path.relative(process.cwd(),screenshot)}));
  } catch(error) {
    const value = admin ? await admin.evaluate(async () => (await window.desktop.invoke('snapshot')).value?.laya).catch(() => undefined) : undefined;
    const network = await app.evaluate(() => globalThis.layaSmokeNetwork).catch(() => undefined);
    const screenshot = path.join(fixture, 'laya-failed.png');
    const screenshotSaved = admin ? await admin.screenshot({path:screenshot}).then(() => true, () => false) : false;
    const receipt = {state:'failed',reason:error.name==='TimeoutError'?'observer_timeout':'assertion_or_product_failure',
      hostState:value?.state??'unknown',ready:value?.ready===true,pageErrors:errors.length,network,phase,resources,
      ...(screenshotSaved?{screenshot:path.relative(process.cwd(),screenshot)}:{})};
    fs.writeFileSync(path.join(fixture, 'failure.json'), JSON.stringify(receipt,null,2));
    console.error(JSON.stringify(receipt));
    process.exitCode=1;
  } finally {await app.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
