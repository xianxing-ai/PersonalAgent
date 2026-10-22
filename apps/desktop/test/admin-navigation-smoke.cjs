// Browser plugin not available: use repository Playwright against the actual
// isolated Competition Main/preload/renderer. No configuration, task or model
// start is submitted. Only the delayed IPC snapshot is a synthetic ordering case.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const {_electron}=require('playwright');
const {openSettings,settingsNavigationState,snapshot,captureMode}=require('../../../tests/manual/agentarts/desktop-pelican-default-live.cjs');

(async()=>{
  const root=path.resolve(__dirname,'../../..');
  const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'pa-admin-navigation-'));
  const bootstrap=path.join(fixture,'bootstrap.cjs');
  fs.writeFileSync(bootstrap,`require(${JSON.stringify(path.join(__dirname,'laya-settings-bootstrap.cjs'))})
    .runLayaSmokeBootstrap(()=>import(${JSON.stringify(pathToFileURL(path.join(root,'apps/desktop/electron/main.js')).href)}))
    .catch(()=>{console.error('Isolated navigation Main bootstrap failed');process.exit(1);});\n`);
  const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH',
    'APPDATA','LOCALAPPDATA','PATH','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  Object.assign(env,{PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_DESKTOP_TEST_USER_DATA:path.join(fixture,'user-data'),
    PA_USER_DATA_DIR:path.join(fixture,'user-data')});
  const executablePath=process.env.PA_ADMIN_NAVIGATION_ELECTRON??path.join(root,'node_modules/electron/dist/electron.exe');
  const app=await _electron.launch({executablePath,args:[bootstrap],env});
  const errors=[],report={kind:'isolated_production_admin_navigation',state:'running',
    profile:'huawei_ict_agentarts',main:'actual',preload:'actual',renderer:'actual',
    configuration:'new_empty_user_data',modelsStarted:false,tasksSubmitted:false,
    delayedSnapshot:'synthetic IPC ordering using the original public empty-config snapshot'};
  const persist=()=>fs.writeFileSync(path.join(fixture,'receipt.json'),JSON.stringify(report,null,2)+'\n');
  let admin;
  try{
    app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
    await app.firstWindow();
    const orb=app.windows().find(page=>page.url().includes('mode=orb'));
    assert.ok(orb);assert.equal((await orb.evaluate(()=>window.desktop.invoke('orb.open'))).ok,true);
    const panel=app.windows().find(page=>page.url().includes('mode=panel'));assert.ok(panel);
    await panel.waitForSelector('#send');
    const session={app,panel,report};
    admin=await openSettings(session,'models');
    admin.on('pageerror',error=>errors.push(error.message));
    assert.match(await admin.title(),/PersonalAgent/);
    assert.match(await admin.locator('#content h2').first().textContent(),/AgentArts/);
    const older=await snapshot(admin);
    assert.equal(older.agentArts.configured,false);
    assert.equal(older.tasks.length,0);assert.equal(older.laya.state,'stopped');
    let orderingCase=0;
    await admin.evaluate(()=>{
      window.adminNavigationOrderingReceipts=[];
      window.desktop.subscribe(data=>{if(data.adminNavigationOrderingCase)
        window.adminNavigationOrderingReceipts.push(data.adminNavigationOrderingCase);});
    });
    const deliver=async value=>{
      const id=++orderingCase;
      await app.evaluate(({BrowserWindow},data)=>{
        const window=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes('mode=admin'));
        window.webContents.send('desktop:update',data);
      },{...value,adminNavigationOrderingCase:id});
      // The test subscriber runs after the real renderer's subscriber. Wait for
      // that exact packet, rather than assuming IPC completed with the send call.
      await admin.waitForFunction(id=>window.adminNavigationOrderingReceipts.includes(id),id);
    };
    const screenshot=async name=>{
      await admin.bringToFront();
      await admin.screenshot({path:path.join(fixture,name)});
    };
    admin=await openSettings(session,'connections');
    const connected=await settingsNavigationState(admin);
    assert.ok(connected.navigationRevision>older.adminNavigation.revision);
    await deliver(older);
    assert.deepEqual(await settingsNavigationState(admin),connected,'late older IPC cannot return to the mounted model page');
    assert.equal(await admin.locator('[data-laya="start"]').isVisible(),true);
    assert.equal(await admin.locator('[data-model-settings-section="connection"]').isVisible(),false);
    await screenshot('connections.png');
    admin=await openSettings(session,'models');
    const newest=await snapshot(admin);
    assert.ok(newest.adminNavigation.revision>connected.navigationRevision,'new original IPC navigation is still consumed');
    await admin.locator('.side [data-page="environment"]').click();
    await admin.locator('[data-workspace="select"]').waitFor({state:'visible'});
    const environment=await settingsNavigationState(admin);
    assert.equal(environment.section,'environment');assert.equal(environment.contentSection,'environment');
    await deliver(older);await deliver(newest);
    assert.deepEqual(await settingsNavigationState(admin),environment,'older and same-revision host snapshots preserve a local sidebar choice');
    await screenshot('environment.png');
    admin=await openSettings(session,'environment');
    report.environmentHostNavigation=report.settingsNavigation.at(-1).host;
    if(process.argv.includes('--require-environment-ipc')){
      assert.equal(report.environmentHostNavigation.page,'environment','the integrated Main must honor environment through original IPC');
      assert.ok(report.environmentHostNavigation.revision>newest.adminNavigation.revision);
    }
    admin=await openSettings(session,'connections');
    const final=await snapshot(admin),network=await app.evaluate(()=>globalThis.layaSmokeNetwork);
    assert.equal(final.laya.state,'stopped');assert.equal(final.tasks.length,0);
    assert.equal(network.health,0);assert.equal(network.blocked,0);
    assert.deepEqual(errors,[]);
    report.state='passed';report.network=network;report.rendererErrors=0;
    report.finalNavigation=await settingsNavigationState(admin);
    report.screenshots=['connections.png','environment.png'];
  }catch(error){
    report.state='failed';report.reason=error.name;report.rendererErrors=errors.length;
    if(admin){report.finalNavigation=await settingsNavigationState(admin).catch(()=>({state:'unavailable'}));
      await captureMode(app,'admin',path.join(fixture,'failed.png')).catch(()=>{});}
    throw error;
  }finally{persist();await app.close();console.log(JSON.stringify({state:report.state,fixture,receipt:path.join(fixture,'receipt.json')}));}
})().catch(error=>{console.error(error);process.exitCode=1;});
