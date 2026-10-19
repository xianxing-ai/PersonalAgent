const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {_electron}=require('playwright');

// Real sandboxed renderer/preload, explicit offline IPC fixture. No production profile or service.
(async()=>{
 const project=path.resolve(__dirname,'..'),out=path.join(project,'.cache/frontend-interaction');
 fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'run-'));
 const entry=path.join(profile,'fixture.cjs');
 fs.writeFileSync(entry,`
 const {app,BrowserWindow,ipcMain}=require('electron');
 app.setPath('userData',${JSON.stringify(profile)});
 const windows=new Map();globalThis.calls=[];
 const task={taskId:'offline-task',userMessage:'离线交互测试',revision:1,state:'running',steps:[],evidenceRefs:[]};
 let data={connection:'显式离线交互夹具',fake:true,fakeModel:true,tasks:[task],capabilities:[],health:[],approvals:[],notifications:[],thinking:{depth:1,fast:false},model:{provider:'fake',enabled:true,configured:true,status:'ready'},voice:{status:'unavailable'},live:{active:false},adminNavigation:{page:'tasks',revision:1}};
 globalThis.publish=patch=>{data={...data,...patch};for(const win of windows.values())win.webContents.send('desktop:update',data);};
 globalThis.openMode=async mode=>{const win=new BrowserWindow({show:false,width:1100,height:800,frame:false,webPreferences:{preload:${JSON.stringify(path.join(project,'electron/preload.cjs'))},contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});windows.set(mode,win);await win.loadFile(${JSON.stringify(path.join(project,'src/app/index.html'))},{query:{mode}});};
 ipcMain.handle('desktop:action',async(_event,name,payload)=>{globalThis.calls.push({name,payload});if(name==='snapshot')return {ok:true,value:data};if(name==='model.toggle')return {ok:false,error:'Offline toggle rejected'};if(name==='thinking.update'||name==='model.test')return {ok:true,value:{}};return {ok:false,error:'Unavailable in offline fixture'};});
 ipcMain.handle('desktop-local',()=>({locale:'zh-CN',settings:{language:'zh-CN'}}));
 app.whenReady().then(()=>globalThis.openMode('admin'));
 `);
 const app=await _electron.launch({executablePath:path.resolve(project,'../../node_modules/electron/dist/electron.exe'),args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
 const errors=[],cases=[];app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
 const tick=()=>new Promise(resolve=>setTimeout(resolve,80));
 async function publish(value){await app.evaluate((_electron,value)=>globalThis.publish(value),value);await tick();}
 async function check(name,run){await run();cases.push(name);console.log('PASS '+name);}
 async function capture(page,name){
  const png=await app.evaluate(async({BrowserWindow},url)=>{
   const win=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL()===url);
   win.setTitle('PersonalAgent · 离线前端回归');win.showInactive();
   await new Promise(resolve=>setTimeout(resolve,120));
   const png=(await win.webContents.capturePage()).toPNG().toString('base64');win.hide();return png;
  },page.url());
  fs.writeFileSync(path.join(out,name),Buffer.from(png,'base64'));
 }
 try{
  const admin=await app.firstWindow();admin.on('pageerror',error=>errors.push(error.message));await admin.waitForSelector('[data-task-details]');
  await check('unchanged snapshots retain task DOM, expanded state and keyboard focus',async()=>{
   await admin.locator('[data-task-details] summary').click();await admin.locator('[data-task-details] summary').focus();
   await admin.evaluate(()=>{window.savedContent=document.querySelector('#content').firstElementChild;});
   for(let i=0;i<10;i++)await publish({audioLevel:i/10});
   assert.deepEqual(await admin.evaluate(()=>({same:window.savedContent===document.querySelector('#content').firstElementChild,open:document.querySelector('[data-task-details]').open,focused:document.activeElement.tagName})),{same:true,open:true,focused:'SUMMARY'});
   await publish({tasks:[{taskId:'offline-task',userMessage:'离线交互测试',revision:2,state:'succeeded',resultSummary:'离线结果已更新',steps:[],evidenceRefs:[]}]});
   assert.equal(await admin.locator('[data-task-details]').evaluate(node=>node.open),true);
   assert.equal(await admin.evaluate(()=>document.activeElement.tagName),'SUMMARY');
   assert.match(await admin.locator('#content').innerText(),/离线结果已更新/);
   assert.equal(await admin.locator('.task-record-title').innerText(),'离线交互测试');
   await capture(admin,'tasks.png');
   await admin.locator('[data-task-details] summary').click();await tick();
   await publish({tasks:[{taskId:'offline-task',revision:3,state:'succeeded',steps:[{label:'新步骤',state:'succeeded'}],evidenceRefs:[]}]});
   assert.equal(await admin.locator('[data-task-details]').evaluate(node=>node.open),false);
  });
  await check('settings aliases, empty result feedback and keyboard recovery',async()=>{
   const input=admin.locator('#admin-search');await input.fill('API');assert.equal(await admin.locator('nav [data-page="models"]').isVisible(),true);
   await input.press('ArrowDown');assert.equal(await admin.evaluate(()=>document.activeElement.dataset.page),'models');
   await input.fill('zz-no-such-setting');assert.match(await admin.locator('#admin-search-status').innerText(),/没有匹配/);
   assert.equal(await admin.locator('nav button:visible').count(),0);await input.press('Escape');assert.equal(await admin.locator('nav button:visible').count(),22);
   await input.fill('API');await capture(admin,'settings-search.png');await input.press('Escape');
  });
  await check('retained model settings bind one action and restore rejected checkbox',async()=>{
   await admin.locator('[data-page="models"]').click();await admin.locator('#model-add').click();
   for(let i=0;i<10;i++)await publish({audioLevel:i/10});
   const before=await app.evaluate(()=>globalThis.calls.filter(call=>call.name==='model.test').length);
   await admin.locator('#model-test').click();await tick();assert.equal(await app.evaluate(()=>globalThis.calls.filter(call=>call.name==='model.test').length),before+1);
   const toggle=admin.locator('#model-enabled'),previous=await toggle.isChecked();await toggle.click();await tick();
   assert.equal(await toggle.isChecked(),previous);assert.match(await admin.locator('#error').innerText(),/Offline toggle rejected/);
  });
  await app.evaluate(()=>globalThis.openMode('workspace'));const workspace=app.windows().find(page=>page.url().includes('mode=workspace'));await workspace.waitForSelector('[data-view]');
  await check('inspector and connectors consistently share a sidebar',async()=>{
   const toggle=workspace.locator('#connectors-toggle'),board=workspace.locator('.connector-board'),inspector=workspace.locator('#conversation-inspector');
   await workspace.locator('[data-view]').click();assert.equal(await inspector.isVisible(),true);assert.equal(await board.isVisible(),false);assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   await toggle.click();assert.equal(await board.isVisible(),true);assert.equal(await inspector.isVisible(),false);assert.equal(await toggle.getAttribute('aria-expanded'),'true');
   await toggle.click();await workspace.locator('[data-view]').click();await workspace.locator('#inspector-close').click();assert.equal(await board.isVisible(),false);assert.equal(await workspace.evaluate(()=>document.activeElement.dataset.view),'offline-task');
   await toggle.click();await workspace.locator('[data-view]').click();await publish({tasks:[]});assert.equal(await inspector.isVisible(),false);assert.equal(await board.isVisible(),true);
   await capture(workspace,'workspace.png');
  });
  await check('session switch closes inspector and focuses a stable control',async()=>{
   const sessions=[{id:'old-session',title:'旧对话',archived:false},{id:'new-session',title:'新对话',archived:false}];
   const oldTask={taskId:'old-session-task',userMessage:'旧对话任务',revision:1,state:'succeeded',steps:[],evidenceRefs:[]};
   const newTask={...oldTask,taskId:'new-session-task',userMessage:'新对话任务'};
   await publish({conversationState:{activeId:'old-session',sessions,draft:''},tasks:[oldTask]});
   await workspace.locator('[data-view="old-session-task"]').click();
   await workspace.locator('#inspector-close').focus();
   await publish({conversationState:{activeId:'new-session',sessions,draft:''},tasks:[newTask]});
   assert.equal(await workspace.locator('#conversation-inspector').isVisible(),false);
   assert.equal(await workspace.evaluate(()=>document.activeElement.id),'connectors-toggle');
   assert.equal(await workspace.locator('[data-view="old-session-task"]').count(),0);
   await workspace.locator('[data-view="new-session-task"]').click();
   assert.equal(await workspace.locator('#conversation-inspector').isVisible(),true);
  });
  await check('search and window controls stay inside the viewport at narrow sizes and zoom',async()=>{
   for(const [width,zoom]of [[520,1],[820,1.3],[1280,1]]){
    await app.evaluate(({BrowserWindow},{width,zoom})=>{const win=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('mode=admin'));win.setSize(width,800);win.webContents.setZoomFactor(zoom);},{width,zoom});await tick();
    const issues=await admin.evaluate(()=>[...document.querySelectorAll('#admin-search,.window-controls button')].filter(node=>{const r=node.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||r.width<24||r.height<24;}).map(node=>node.id||node.dataset.window));assert.deepEqual(issues,[]);
   }
  });
  await check('task progress reflects Runtime waits and preserves unchanged conversation turns',async()=>{
   const active={taskId:'active-turn',state:'running',userMessage:'正在执行的任务',revision:1,steps:[{state:'running',label:'检查测试结果'}],evidenceRefs:[]};
   const finished={taskId:'stable-turn',state:'succeeded',userMessage:'已经完成的对话',revision:1,steps:[],evidenceRefs:[]};
   await publish({tasks:[active,finished]});assert.match(await workspace.locator('.task-progress').innerText(),/检查测试结果/);
   await workspace.evaluate(()=>{window.stableTurn=document.querySelector('[data-turn="stable-turn"]');window.stableTurn.querySelector('[data-view]').focus();});
   await publish({tasks:[{...active,revision:2,resultSummary:'新的进展'},finished]});
   assert.equal(await workspace.evaluate(()=>window.stableTurn===document.querySelector('[data-turn="stable-turn"]')),true);
   assert.equal(await workspace.evaluate(()=>document.activeElement.dataset.view),'stable-turn');
   await workspace.evaluate(()=>{window.activeView=document.querySelector('[data-view="active-turn"]');window.activeView.focus();});
   await publish({tasks:[{...active,revision:2,resultSummary:'新的进展'},{...finished,revision:2,resultSummary:'已补充结果'}]});
   assert.equal(await workspace.evaluate(()=>window.activeView===document.querySelector('[data-view="active-turn"]')),true);
   assert.equal(await workspace.evaluate(()=>document.activeElement.dataset.view),'active-turn');
   for(const state of ['waiting_approval','waiting_external','waiting_reconciliation','cancelling']){
    await publish({tasks:[{...active,state},finished]});assert.equal(await workspace.locator('.task-progress').getAttribute('data-state'),state);
   }
   assert.match(await workspace.locator('.task-progress').innerText(),/等待执行结束/);
   assert.match(await workspace.locator('[data-turn="active-turn"] [data-cancel]').innerText(),/正在停止/);assert.equal(await workspace.locator('[data-turn="active-turn"] [data-cancel]').isDisabled(),true);
   assert.equal(await workspace.locator('.response-actions .turn-action').evaluate(node=>getComputedStyle(node).whiteSpace==='nowrap'&&node.getBoundingClientRect().height>=32),true);
   assert.equal(await workspace.locator('.task-progress').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
   await capture(workspace,'workspace-progress.png');
   await publish({tasks:[]});assert.equal(await workspace.locator('.task-progress').isVisible(),false);
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({fixture:'explicit-offline',cases,rendererErrors:errors},null,2));
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
