const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const {_electron}=require('playwright');
const {openSettings}=require('../../../tests/manual/agentarts/desktop-pelican-default-live.cjs');

(async()=>{
  const root=path.resolve(__dirname,'../../..'),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'pa-wiki-desktop-'));
  const bootstrap=path.join(fixture,'bootstrap.cjs');
  fs.writeFileSync(bootstrap,`require(${JSON.stringify(path.join(__dirname,'laya-settings-bootstrap.cjs'))})
    .runLayaSmokeBootstrap(()=>import(${JSON.stringify(pathToFileURL(path.join(root,'apps/desktop/electron/main.js')).href)}))
    .catch(()=>{console.error('Isolated Wiki Main bootstrap failed');process.exit(1);});\n`);
  const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH',
    'APPDATA','LOCALAPPDATA','PATH','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  Object.assign(env,{PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_DESKTOP_TEST_USER_DATA:path.join(fixture,'user-data'),
    PA_USER_DATA_DIR:path.join(fixture,'user-data')});
  const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[bootstrap],env});
  const errors=[];
  try{
    app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
    await app.firstWindow();const orb=app.windows().find(page=>page.url().includes('mode=orb'));
    assert.ok(orb);assert.equal((await orb.evaluate(()=>window.desktop.invoke('orb.open'))).ok,true);
    const panel=app.windows().find(page=>page.url().includes('mode=panel'));assert.ok(panel);await panel.waitForSelector('#send');
    const admin=await openSettings({app,panel},'memory');
    await admin.getByRole('heading',{name:'LLM Wiki',exact:true}).waitFor({timeout:10000});
    assert.match(await admin.locator('[data-wiki="availability"]').textContent(),/配置 AgentArts/);
    assert.equal(await admin.getByRole('button',{name:'选择文件',exact:true}).isDisabled(),true);
    assert.equal(await admin.getByRole('button',{name:'授权并生成 Wiki'}).isDisabled(),true);
    assert.equal(await app.evaluate(()=>globalThis.layaSmokeNetwork.blocked),0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'passed',profile:'huawei_ict_agentarts',configuration:'isolated empty',
      main:'actual',preload:'actual',renderer:'actual',modelsStarted:false,networkRequests:false,fixture}));
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
