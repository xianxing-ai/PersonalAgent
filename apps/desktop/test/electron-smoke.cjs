const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {_electron}=require('playwright');
(async()=>{
 const output=path.resolve(__dirname,'../.cache/qa');fs.mkdirSync(output,{recursive:true});
 const localElectron=path.resolve(__dirname,'../node_modules/electron/dist/electron.exe');
 const workspaceElectron=path.resolve(__dirname,'../../../node_modules/electron/dist/electron.exe');
 const executablePath=fs.existsSync(localElectron)?localElectron:workspaceElectron;
 const fake=process.env.PA_DESKTOP_FAKE!=='0';
 const args=[path.resolve(__dirname,'..')];if(fake)args.push('--fake-runtime');
 const app=await _electron.launch({executablePath,args,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,PA_DESKTOP_EPHEMERAL_MODEL:'1'}});
 const errors=[];
 try {
   await app.firstWindow();
   let orb;
   for(let attempt=0;attempt<100;attempt++) {
     orb=app.windows().find(page=>page.url().includes('mode=orb'));
     if(orb) break;
     await new Promise(resolve=>setTimeout(resolve,100));
   }
   assert.ok(orb,'orb window loaded');await orb.waitForSelector('canvas');
   for(const page of app.windows())page.on('pageerror',e=>errors.push(e.message));
   assert.equal(await orb.title(),'PersonalAgent');
   assert.equal(await orb.evaluate(()=>typeof require),'undefined');
   assert.equal(await orb.locator('canvas').evaluate(c=>getComputedStyle(c).filter),'none');
   await orb.screenshot({path:path.join(output,'orb.png'),omitBackground:true});
   // Test-only wallpaper makes the approved underlay visible on a light desktop.
   await orb.evaluate(()=>document.body.style.background='linear-gradient(150deg,#e7e4dd,#d5dbdd)');
   await orb.screenshot({path:path.join(output,'orb-light-underlay.png')});
   await orb.evaluate(()=>document.body.style.background='');
   await app.evaluate(({BrowserWindow,screen})=>{
     const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=orb'));
     const p=screen.getCursorScreenPoint();win.setPosition(p.x-56,p.y-56);
   });
   await orb.waitForTimeout(200);
   assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=panel')).isVisible()),true);
   await app.evaluate(({BrowserWindow,screen})=>{
     const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=orb'));
     const p=screen.getCursorScreenPoint();win.setPosition(p.x-56,p.y-56-120);
   });
   await orb.waitForTimeout(200);
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=panel')).hide());
   assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=panel')).isVisible()),false);
   await orb.evaluate(()=>window.desktop.invoke('orb.dragStart'));
   await orb.waitForTimeout(200);
   assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=panel')).isVisible()),false);
   await orb.evaluate(()=>window.desktop.invoke('orb.dragEnd'));
   await orb.evaluate(()=>window.desktop.invoke('orb.open'));
   let panel=app.windows().find(p=>p.url().includes('mode=panel'));
   await panel.waitForSelector('textarea[aria-label="任务内容"]');
   const panelArea=await app.evaluate(({BrowserWindow,screen})=>screen.getDisplayMatching(BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=orb')).getBounds()).workArea);
   assert.equal(await panel.evaluate(()=>innerWidth),Math.min(420,panelArea.width));
   const orbViewportBefore=await orb.evaluate(()=>({width:innerWidth,height:innerHeight}));
   const groupBefore=await app.evaluate(({BrowserWindow})=>Object.fromEntries(BrowserWindow.getAllWindows().filter(w=>/mode=(orb|panel)/.test(w.webContents.getURL())).map(w=>[w.webContents.getURL().includes('mode=orb')?'orb':'panel',w.getBounds()])));
   await panel.locator('header').hover();await panel.mouse.down();await panel.mouse.move(80,80,{steps:5});await panel.mouse.up();await panel.waitForTimeout(150);
   const groupAfter=await app.evaluate(({BrowserWindow})=>Object.fromEntries(BrowserWindow.getAllWindows().filter(w=>/mode=(orb|panel)/.test(w.webContents.getURL())).map(w=>[w.webContents.getURL().includes('mode=orb')?'orb':'panel',w.getBounds()])));
   assert.notDeepEqual(groupAfter.orb,groupBefore.orb);
   const orbViewportAfter=await orb.evaluate(()=>({width:innerWidth,height:innerHeight}));
   assert.ok(orbViewportAfter.width<=128&&orbViewportAfter.height<=128,`orb viewport expanded unexpectedly: ${JSON.stringify({orbViewportBefore,orbViewportAfter})}`);
   const dragArea=await app.evaluate(({screen,BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=orb'));return screen.getDisplayMatching(win.getBounds()).workArea;});
   const dpiSlack=1;
   for(const bounds of [groupAfter.orb,groupAfter.panel]){
     assert.ok(
       bounds.x>=dragArea.x&&bounds.y>=dragArea.y&&bounds.x+bounds.width<=dragArea.x+dragArea.width+dpiSlack&&bounds.y+bounds.height<=dragArea.y+dragArea.height+dpiSlack,
       `window escaped work area: ${JSON.stringify({bounds,dragArea,dpiSlack})}`,
     );
   }
   assert.ok(groupAfter.panel.x+groupAfter.panel.width<=groupAfter.orb.x||groupAfter.orb.x+groupAfter.orb.width<=groupAfter.panel.x);
   assert.match(await panel.locator('#connection').innerText(),fake?/Fake Runtime/:/本地 Runtime/);
   await panel.locator('#model').click();
   assert.equal(await panel.locator('#mm-slider').isDisabled(),false);
   await panel.locator('#mm-slider').fill('3');
   await panel.locator('#mm-slider').dispatchEvent('input');
   await panel.waitForTimeout(100);
   const panelThinking=await panel.evaluate(()=>window.desktop.invoke('snapshot'));
   assert.equal(panelThinking.value.thinking.depth,3);
   assert.equal(await panel.locator('#model').evaluate(button=>{
     const bounds=button.getBoundingClientRect();
     return document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2)?.closest('#model')===button;
   }),true,'expanded model menu must leave its toggle reachable after status text updates');
   await panel.locator('#model').click();
   await panel.locator('textarea[aria-label="任务内容"]').fill('测试原版桌面方案接入');await panel.locator('#send').click();
   await panel.waitForSelector('[data-action="task.cancel"]');
   assert.match(await panel.locator('#tasks').innerText(),/思考中/);
   if(fake){
     await panel.locator('[data-action="test.advance"]').click();
     await panel.waitForFunction(()=>document.querySelector('#state').textContent==='思考中');
     assert.equal(await panel.locator('.thinking-grid').count(),1);
     await panel.waitForFunction(()=>Math.max(...[...document.querySelectorAll('.thinking-grid i')].map(cell=>Number(getComputedStyle(cell,'::after').opacity)))>.6);
   } else {
     await panel.waitForFunction(()=>document.querySelector('#state').textContent==='已创建');
   }
   await panel.screenshot({path:path.join(output,'panel.png')});
   const opened=app.waitForEvent('window');
   await panel.locator('#admin').click();
   const admin=await opened;
   await admin.waitForURL(/mode=admin/);
   await admin.waitForSelector('[data-page="models"]');
   // Task monitoring remains reachable through both its navigation item and Host route.
   await panel.evaluate(()=>window.desktop.invoke('admin.open',{page:'tasks'}));
   await admin.waitForSelector('tbody');
   assert.match(await admin.locator('tbody').innerText(),fake?/思考中/:/已创建/);
   await admin.locator('[data-page="models"]').click();
   await admin.waitForSelector('.model-list');
   assert.equal(await admin.locator('#model-config-form').count(),0);
   await admin.locator('#model-add').click();
   await admin.waitForSelector('#model-config-form');
   assert.equal(await admin.locator('#thinking-depth').count(),1);
   assert.equal(await admin.locator('#model-test').isDisabled(),true);
   await admin.locator('#model-base-url').fill('https://pangu.example.test');
   await admin.locator('#model-name').fill('pangu-nlp-n1-32k');
   await admin.locator('#model-deployment').fill('desktop-test');
   await admin.locator('#model-api-key').fill('test-key-not-used');
   await admin.locator('#model-config-form').evaluate(form=>form.requestSubmit());
   await admin.waitForTimeout(150);
   assert.equal(await admin.locator('#model-test').isDisabled(),false);
   await admin.locator('#thinking-depth').fill('4');
   await admin.locator('#thinking-depth').dispatchEvent('input');
   await admin.waitForTimeout(100);
   const thinkingSnapshot=await admin.evaluate(()=>window.desktop.invoke('snapshot'));
   assert.equal(thinkingSnapshot.value.thinking.depth,4);
   assert.equal(await admin.locator('#model-enabled').isChecked(),true);
   await admin.locator('#model-enabled').uncheck();
   await admin.waitForFunction(async()=>!(await window.desktop.invoke('snapshot')).value.model.enabled);
   assert.match(await admin.locator('.model-state').innerText(),/已停用/);
   await admin.locator('#model-enabled').check();
   await admin.waitForFunction(async()=>(await window.desktop.invoke('snapshot')).value.model.enabled);
   await admin.locator('[data-page="settings"]').click();
   assert.equal(await admin.locator('#model-config-form').count(),0);
   assert.equal(await admin.locator('.settings-single').count(),1);
   assert.deepEqual(await admin.locator('.side [data-page]').evaluateAll(buttons=>buttons.map(button=>button.dataset.page)),[
     'settings','profile','appearance','voice','notifications','configuration','personalization','pets','shortcuts','analytics','models','memory',
     'computer','capabilities','hooks','connections','git','environment','worktrees','authorizations','tasks','archive',
   ]);
   assert.equal(await admin.locator('.nav-icon').count(),22);
   await admin.locator('[data-page="appearance"]').click();
   await admin.locator('#pref-theme').selectOption('light');
   assert.equal(await admin.evaluate(()=>document.documentElement.dataset.theme),'light');
   await admin.locator('#pref-calm').check();
   assert.equal(await admin.evaluate(()=>document.documentElement.dataset.calm),'true');
   await admin.locator('#admin-search').fill('模型');
   assert.equal(await admin.locator('.side [data-page]:visible').count(),1);
   await admin.locator('#admin-search').fill('');
   await panel.evaluate(()=>window.desktop.invoke('admin.open',{page:'tasks'}));
   await admin.waitForSelector('tbody');
   await admin.screenshot({path:path.join(output,'admin.png')});
   await admin.close();
   const preserved=await panel.evaluate(()=>window.desktop.invoke('snapshot'));
   assert.equal(preserved.value.tasks.at(-1).state,fake?'planning':'created');
   // Local Runtime persists earlier tasks. Cancel the newly submitted task, not a stale disabled row.
   const currentCancel=panel.locator('[data-action="task.cancel"]:not(:disabled)').last();
   const currentTaskId=await currentCancel.getAttribute('data-id');
   const currentTaskCancel=panel.locator(`[data-action="task.cancel"][data-id="${currentTaskId}"]`);
   await currentTaskCancel.click();
   await panel.waitForFunction(()=>document.querySelector('#state').textContent==='正在取消');
   if(fake){
     await panel.locator('[data-action="test.advance"]').click();
     await panel.waitForFunction(()=>document.querySelector('#state').textContent==='已取消');
   }
   if(fake)assert.equal(await panel.locator(`[data-action="task.cancel"][data-id="${currentTaskId}"]`).count(),0);
   else assert.equal(await currentTaskCancel.isDisabled(),true);
   assert.equal(await panel.locator('#stop').isDisabled(),true);
   assert.deepEqual(errors,[]);
   console.log(`PASS: ${fake?'Fake':'local'} Runtime Electron windows, native 90px hover/open, explicit collapse, grouped edge-aware drag, isolated preload, ORB-02, tray host, 420px responsive panel, event-driven SDK submit/cancel, independent admin close, no page errors`);
 } finally {await app.close();}
})();
