const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {_electron}=require('playwright');

// Production windows/Renderer/IPC, explicit Fake Runtime and isolated preferences.
// Display scale can be selected independently of the in-app 100%/130% zoom matrix.
(async()=>{
 const root=path.resolve(__dirname,'../../..'),output=path.join(__dirname,'../.cache/frontend-layout');
 fs.mkdirSync(output,{recursive:true});
 const scale=process.env.PA_FRONTEND_TEST_SCALE;
 if(scale!==undefined)assert.ok(Number.isFinite(Number(scale))&&Number(scale)>0);
 const profile=fs.mkdtempSync(path.join(output,'profile-'));
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),
  args:[path.join(root,'apps/desktop'),'--fake-runtime',...(scale?[`--force-device-scale-factor=${scale}`]:[])],
  env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,PA_RUNTIME_PROFILE:'local',PA_USER_DATA_DIR:profile,PA_DESKTOP_EPHEMERAL_MODEL:'1'}});
 const errors=[],cases=[];
 app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function until(check,message){for(let i=0;i<60;i++){if(await check())return;await delay(50);}assert.fail(message);}
 const native=(mode,field)=>app.evaluate(({BrowserWindow},{mode,field})=>{
  const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`mode=${mode}`));
  return field==='minimized'?win.isMinimized():win.isMaximized();
 },{mode,field});
 const resize=(mode,width,height,zoom)=>app.evaluate(({BrowserWindow},v)=>{
  const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`mode=${v.mode}`));
  if(win.isMaximized())win.unmaximize();win.setSize(v.width,v.height);win.webContents.setZoomFactor(v.zoom);
 },{mode,width,height,zoom});
 async function capture(page,file){
  const png=await app.evaluate(async({BrowserWindow},url)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url).webContents.capturePage().then(i=>i.toPNG().toString('base64')),page.url());
  fs.writeFileSync(path.join(output,file),Buffer.from(png,'base64'));
 }
 async function windowControls(page,mode){
  await app.evaluate(({BrowserWindow},mode)=>{
   const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`mode=${mode}`));
   if(win.isMaximized())win.unmaximize();
  },mode);
  await until(async()=>await page.locator('[data-window="maximize"]').getAttribute('data-maximized')==='false','initial restore state did not reach the controls');
  const english=await page.evaluate(()=>document.documentElement.lang.startsWith('en'));
  const buttons=page.locator('.window-controls [data-window]');assert.equal(await buttons.count(),3);
  assert.equal(await page.locator('.window-controls').evaluate(node=>getComputedStyle(node).webkitAppRegion),'no-drag');
  await page.locator('[data-window="minimize"]').click();
  await until(()=>native(mode,'minimized'),`${mode} did not minimize`);
  await app.evaluate(({BrowserWindow},mode)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`mode=${mode}`));w.restore();w.show();w.focus();},mode);
  await page.locator('[data-window="maximize"]').focus();await page.keyboard.press('Space');
  await until(()=>native(mode,'maximized'),`${mode} did not maximize`);
  await until(async()=>await page.locator('[data-window="maximize"]').getAttribute('data-maximized')==='true','restore icon did not follow native state');
  assert.equal(await page.locator('[data-window="maximize"]').getAttribute('aria-label'),english?'Restore':'还原');
  await page.locator('[data-window="maximize"]').focus();await page.keyboard.press('Enter');
  await until(async()=>!(await native(mode,'maximized')),`${mode} did not restore`);
  await app.evaluate(({BrowserWindow},mode)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`mode=${mode}`)).maximize(),mode);
  await until(async()=>await page.locator('[data-window="maximize"]').getAttribute('data-maximized')==='true','OS maximize event was not reflected');
  await app.evaluate(({BrowserWindow},mode)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`mode=${mode}`)).unmaximize(),mode);
  await until(async()=>await page.locator('[data-window="maximize"]').getAttribute('data-maximized')==='false','OS restore event was not reflected');
 }
 async function layout(page,label){
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await page.evaluate(()=>{
   const issues=[];
   for(const element of document.querySelectorAll('button,input,select,textarea')){
    const r=element.getBoundingClientRect(),style=getComputedStyle(element);
    if(r.width<1||r.height<1||style.visibility==='hidden'||element.closest('[hidden]')||element.closest('.table-scroll'))continue;
    if(r.top<0||r.bottom>innerHeight)continue; // Vertical content remains reachable by scrolling.
    if(r.left< -2||r.right>innerWidth+2)issues.push(`${element.id||element.getAttribute('aria-label')||element.textContent.trim()}: horizontal clipping`);
   }
   const main=document.querySelector('.admin>.main'),nav=document.querySelector('.admin .side nav');
   if(main&&main.scrollWidth>main.clientWidth+2)issues.push('settings content overflows horizontally');
   if(nav&&nav.scrollWidth>nav.clientWidth+2)issues.push('settings navigation overflows horizontally');
   const controls=[...document.querySelectorAll('.window-controls button')].map(button=>{
    const r=button.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,label:button.getAttribute('aria-label')};
   });
   for(let i=0;i<controls.length;i++){
    const b=controls[i];if(b.x<0||b.y<0||b.right>innerWidth+1||b.width<32||b.height<32)issues.push('window control clipped or too small');
    if(i&&b.x<controls[i-1].right-1)issues.push('window controls overlap');
   }
   return {width:innerWidth,height:innerHeight,issues,controls};
  });
  assert.deepEqual(result.issues,[],`${label}: ${JSON.stringify(result)}`);cases.push({label,...result});
 }
 try{
  await app.firstWindow();let orb;
  await until(async()=>{orb=app.windows().find(p=>p.url().includes('mode=orb'));return Boolean(orb);},'orb did not load');
  await orb.waitForSelector('.orb-button');await orb.evaluate(()=>window.desktop.invoke('admin.open',{page:'settings'}));
  let admin;await until(async()=>{admin=app.windows().find(p=>p.url().includes('mode=admin'));return Boolean(admin);},'settings did not load');
  await admin.waitForSelector('#desktop-local-settings');
  assert.equal(await admin.locator('.admin-bar #desktop-local-settings').count(),0);
  await windowControls(admin,'admin');
  const rejected=await orb.evaluate(()=>window.desktop.invoke('admin.minimize'));
  assert.equal(rejected.ok,false);assert.equal(await native('admin','minimized'),false);
  assert.equal(await orb.evaluate(()=>window.desktop.windowState().then(()=>false,()=>true)),true);

  // The relocated desktop preferences entry must open a real settings window.
  const opening=app.waitForEvent('window');await admin.locator('#desktop-local-settings').click();
  const local=await opening;await local.waitForSelector('#settings');
  await local.locator('[name="language"]').selectOption('en');await local.locator('button[type="submit"]').click();
  await until(async()=>await admin.locator('#desktop-local-settings').innerText()==='Desktop preferences','preferences language did not update');
  assert.equal(await admin.locator('[data-window="maximize"]').getAttribute('aria-label'),'Maximize');
  await windowControls(admin,'admin');
  await local.locator('[name="language"]').selectOption('zh-CN');await local.locator('button[type="submit"]').click();
  await until(async()=>await admin.locator('[data-window="maximize"]').getAttribute('aria-label')==='最大化','window control language did not restore');
  await local.close();

  const pages=await admin.locator('.side [data-page]').evaluateAll(items=>items.map(b=>b.dataset.page));
  for(const [width,height,zoom,theme] of [[1120,760,1,'light'],[1120,760,1.3,'dark'],[800,600,1,'dark'],[800,600,1.3,'light'],[600,400,1.3,'light']]){
   await resize('admin',width,height,zoom);await admin.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
   for(const section of pages){
    const advanced=admin.locator('.advanced-nav');
    const isAdvanced=await admin.locator(`[data-page="${section}"]`).evaluate(node=>Boolean(node.closest('details')));
    if(isAdvanced && !await advanced.evaluate(node=>node.open))await advanced.locator('summary').click();
    await admin.locator(`[data-page="${section}"]`).click();
    await layout(admin,`admin/${section}/${width}x${height}/${zoom}/${theme}`);
    if(section==='models'){
     await admin.locator('#model-add').click();await layout(admin,`admin/model-editor/${width}/${zoom}`);
    }
    if(width===600&&['settings','models','memory','profile'].includes(section))await capture(admin,`${scale||'system'}-${section}-compact.png`);
   }
  }
  await resize('admin',1120,760,1);await admin.locator('[data-page="settings"]').click();
  await capture(admin,`${scale||'system'}-settings.png`);
  await admin.locator('[data-window="close"]').click();await until(()=>Promise.resolve(admin.isClosed()),'settings close did not close its window');
  assert.equal((await orb.evaluate(()=>window.desktop.invoke('snapshot'))).ok,true,'closing settings must retain the desktop Runtime');
  await orb.evaluate(()=>window.desktop.invoke('orb.open'));const panel=app.windows().find(p=>p.url().includes('mode=panel'));
  await panel.waitForSelector('#panel-expand');await panel.locator('#panel-expand').click();
  let workspace;await until(async()=>{workspace=app.windows().find(p=>p.url().includes('mode=workspace'));return Boolean(workspace);},'workspace did not load');
  await workspace.waitForSelector('#workspace-stage');await windowControls(workspace,'workspace');
  for(const [width,height,zoom] of [[1100,760,1],[760,540,1.3]]){
   await resize('workspace',width,height,zoom);await layout(workspace,`workspace/${width}/${zoom}`);
   await capture(workspace,`${scale||'system'}-workspace-${width}.png`);
  }
  await workspace.locator('[data-window="close"]').click();
  await until(()=>Promise.resolve(workspace.isClosed()),'workspace close did not close its window');
  assert.equal((await orb.evaluate(()=>window.desktop.invoke('snapshot'))).ok,true);
  assert.deepEqual(errors,[]);
  const report={profile:'explicit_fake_runtime',commit:process.env.PA_TEST_COMMIT||null,scale:scale||'system',pages:pages.length,cases,windowControls:true,desktopPreferences:true,pageErrors:errors};
  fs.writeFileSync(path.join(output,`receipt-${scale||'system'}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pages:pages.length,cases:cases.length,scale:scale||'system',windowControls:true,desktopPreferences:true,pageErrors:errors}));
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
