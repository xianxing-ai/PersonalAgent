const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {_electron}=require('playwright');

(async()=>{
 const project=path.resolve(__dirname,'..'),cache=path.join(project,'.cache/pr376-regressions');
 fs.mkdirSync(cache,{recursive:true});const directory=fs.mkdtempSync(path.join(cache,'run-'));
 const moduleUrl=name=>pathToFileURL(path.join(project,'electron',name)).href;
 const entry=path.join(directory,'main.cjs');
 fs.writeFileSync(entry,`
 const {app,BrowserWindow,ipcMain}=require('electron');
 const path=require('node:path');
 app.setPath('userData',${JSON.stringify(directory)});
 const windows=new Map();let journal,configuration,draftQuitPreflight;
 const revision='a'.repeat(64),policy=(scope,revision,mode)=>({available:true,policy:{scope,revision,effective:{mode,windowMinutes:17,maxInterruptions:3,silentUntilUtc:null,preferredChannel:'banner',allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null}},feed:{items:[]}});
 const globalPolicy=policy({kind:'global'},5,'normal'),leafPolicy=policy({kind:'connector',connectorId:'mail'},2,'silent');
 globalThis.calls=[];globalThis.rendererErrors=[];let extra={};
 const snapshot=mode=>({tasks:[],messages:[],approvals:[],notifications:[],capabilities:[],health:[],connection:'Isolated product renderer',fakeModel:true,model:{status:'ready',configured:true,label:'Fixture'},thinking:{depth:1,fast:false},voice:{status:'unavailable'},live:{configured:false,status:'idle'},adminNavigation:{revision:1,page:'notifications'},notificationCenter:globalPolicy,agentArts:configuration.snapshot(),agentArtsModels:{available:true,catalog:{revision,defaultModelId:'fixture',models:[{id:'fixture',displayName:'Fixture',type:'text',availability:'unverified',reasoningEfforts:[]}]},preferences:null},conversationState:mode==='admin'?undefined:journal.snapshot(mode),...extra});
 const publish=()=>{for(const [mode,win]of windows)if(!win.isDestroyed())win.webContents.send('desktop:update',snapshot(mode));};
 globalThis.setFixture=value=>{extra=value;publish();};
 globalThis.openMode=async mode=>{const win=new BrowserWindow({show:false,width:600,height:720,useContentSize:true,frame:false,webPreferences:{preload:${JSON.stringify(path.join(project,'electron/preload.cjs'))},contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});windows.set(mode,win);win.on('closed',()=>windows.delete(mode));await win.loadFile(${JSON.stringify(path.join(project,'src/app/index.html'))},{query:{mode}});return win.webContents.id;};
 app.whenReady().then(async()=>{
  const {Conversations}=await import(${JSON.stringify(moduleUrl('conversations.js'))});
  const {flushConversationDrafts}=await import(${JSON.stringify(moduleUrl('conversation-draft-close.js'))});
  const {createDraftQuitPreflight}=await import(${JSON.stringify(moduleUrl('draft-quit-preflight.js'))});
  const {createAgentArtsConfig}=await import(${JSON.stringify(moduleUrl('agentarts-config.js'))});
  journal=new Conversations(path.join(app.getPath('userData'),'conversations.json'));
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
  configuration=createAgentArtsConfig({userData:app.getPath('userData'),safeStorage,environment:{}});
  configuration.configure({gatewayUrl:'https://fixture.huaweicloud-agentarts.com',runtimeName:'fixture',authorization:'Bearer public-offline-fixture-not-a-real-credential'});
  globalThis.journal=journal;globalThis.configuration=configuration;
  globalThis.cleanupCount=0;globalThis.quitError='';
  draftQuitPreflight=createDraftQuitPreflight({windows:()=>[windows.get('panel'),windows.get('workspace')],retry:()=>app.quit(),onFailure:error=>{globalThis.quitError=error.message;}});
  app.on('before-quit',event=>{if(!draftQuitPreflight.allow()){event.preventDefault();return;}if(!draftQuitPreflight.commit()){event.preventDefault();draftQuitPreflight.allow();return;}globalThis.cleanupCount++;});
  ipcMain.handle('desktop-local',(_event,name)=>{if(name==='renderer-error')globalThis.rendererErrors.push('renderer-error');return {locale:'zh-CN',settings:{language:'zh-CN'}};});
  ipcMain.on('desktop:draft-close',(event,entries)=>{try{if(globalThis.denyDraftClose)throw Error('fixture write failure');flushConversationDrafts(event,entries,{panel:windows.get('panel'),workspace:windows.get('workspace'),conversations:journal});event.returnValue={ok:true};}catch{event.returnValue={ok:false,error:'fixture final save denied'};}});
  ipcMain.handle('desktop:action',async(event,name,payload)=>{
   const mode=[...windows].find(([,win])=>win.webContents===event.sender)?.[0];globalThis.calls.push({name,payload});
   try{
    let value={};
    if(name==='snapshot')value=snapshot(mode);
    if(name==='conversation.draft'){journal.setDraft(mode,payload.conversationId,payload.text);value={saved:true};}
    if(name==='agentarts.configure')value=configuration.configure(payload);
    if(name==='agentartsModels.state')value=snapshot(mode).agentArtsModels;
    if(name==='notifications.get')value=leafPolicy;
    if(name==='notifications.configure')value={state:'confirmed',taskId:'fixture',notificationCenter:leafPolicy};
    return {ok:true,value};
   }catch(error){return {ok:false,error:error.message};}
  });
  await globalThis.openMode('panel');
 });
 app.on('window-all-closed',()=>{});
 `);
 const executablePath=fs.existsSync(path.join(project,'../../node_modules/electron/dist/electron.exe'))?path.join(project,'../../node_modules/electron/dist/electron.exe'):require('electron');
 const app=await _electron.launch({executablePath,args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
 const receipts={profile:'huawei_ict_agentarts',data:'explicit offline fixtures',layouts:[]};
 try{
  const panel=await app.firstWindow();await panel.waitForSelector('.conversation-sessions',{state:'attached'});
  assert.equal(await panel.locator('.conversation-sessions').isVisible(),false,'panel keeps a single main conversation while draft hooks remain mounted');
  receipts.singleMainDraftHooks=true;
  await app.evaluate(()=>globalThis.setFixture({agentArtsModels:{catalog:null,preferences:null}}));
  await panel.waitForFunction(()=>document.querySelector('.model-thinking-menu input[type=range][aria-label="思考强度"]')?.disabled===true);
  assert.equal(await panel.getByRole('button',{name:'模型与思考',exact:true}).getAttribute('aria-expanded'),'false');
  assert.equal(await panel.locator('.model-thinking-menu input[type=range][aria-label="思考强度"]').isDisabled(),true,'thinking slider stays disabled without a catalog');
  await app.evaluate(()=>globalThis.setFixture({}));
  await panel.waitForFunction(()=>document.querySelector('.model-thinking-menu input[type=range][aria-label="思考强度"]')?.disabled===false);
  for(const size of [[420,720],[600,720],[420,600]])for(const zoom of [1,1.25,1.5]){
   await app.evaluate(({BrowserWindow},{size,zoom})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(...size);win.webContents.setZoomFactor(zoom);win.show();},{size,zoom});
   await panel.evaluate(zoom=>document.documentElement.dataset.theme=zoom===1.25?'dark':'light',zoom);
   const result=await panel.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect(),thread=rect('.thread'),composer=rect('.composer');return {width:innerWidth,height:innerHeight,composerBottom:composer.bottom,threadBottom:thread.bottom,composerTop:composer.top};});
   assert.ok(result.composerBottom<=result.height+2,JSON.stringify(result));assert.ok(result.threadBottom<=result.composerTop+2,JSON.stringify(result));
   receipts.layouts.push({size,zoom,...result});
   const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
   fs.writeFileSync(path.join(directory,'panel-'+size.join('x')+'-'+zoom+'.png'),Buffer.from(png,'base64'));
   const trigger=panel.getByRole('button',{name:'模型与思考',exact:true});
   await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'true');
   const slider=panel.getByRole('slider',{name:'思考强度',exact:true});
   await slider.scrollIntoViewIfNeeded();assert.equal(await slider.isEnabled(),true,'catalog restores the thinking slider');
   const menu=await panel.evaluate(()=>{const slider=document.querySelector('.model-thinking-menu input[type=range][aria-label="思考强度"]'),r=slider.getBoundingClientRect(),menu=document.querySelector('.model-thinking-menu').getBoundingClientRect();return {left:menu.left,right:menu.right,top:menu.top,bottom:menu.bottom,reachable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===slider};});
   assert.ok(menu.left>=0&&menu.right<=result.width+2&&menu.top>=0&&menu.bottom<=result.height+2&&menu.reachable,JSON.stringify({size,zoom,menu}));
   await panel.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
   assert.equal(await panel.locator('.model-thinking-menu').isVisible(),false);
  }
  // Later close checks use the authoritative fixture journal, with no synthetic session overlay.
  await app.evaluate(()=>globalThis.setFixture({}));
  await app.evaluate(()=>globalThis.openMode('admin'));
  const admin=app.windows().find(page=>page.url().includes('mode=admin'));await admin.waitForSelector('.notification-settings');
  await admin.selectOption('[name=scope]','connector');await admin.fill('[name=connector]','mail');await admin.click('[data-notifications=load]');
  await admin.waitForFunction(()=>document.querySelector('[name=mode]').value==='silent');
  await app.evaluate(()=>globalThis.setFixture({}));
  assert.equal(await admin.locator('[name=mode]').inputValue(),'silent');
  await admin.locator('[name=maximum]').fill('2');await app.evaluate(()=>globalThis.setFixture({}));
  await admin.locator('form[data-notifications=form]').evaluate(form=>form.requestSubmit());
  const notification=await app.evaluate(()=>globalThis.calls.findLast(call=>call.name==='notifications.configure').payload);
  assert.equal(notification.expectedRevision,2);assert.equal(notification.patch.mode,'silent');assert.equal(notification.patch.maxInterruptions,2);receipts.notificationScope=notification;
  // Exercise the actual configuration component and real host through the production bridge.
  await app.evaluate(()=>globalThis.setFixture({adminNavigation:{revision:2,page:'models'},model:{provider:'agentarts',configured:true,status:'configured'}}));
  await admin.waitForSelector('[name=transport]');
  await admin.selectOption('[name=transport]','wss');await admin.waitForSelector('input[name=appToken]');await admin.fill('[name=appToken]','public-fixture-inner-not-a-real-credential-123456789');await admin.fill('[name=deploymentVersion]','fixture-v5');await admin.fill('[name=websocketUrl]','wss://fixture.huaweicloud-agentarts.com/runtimes/fixture/ws?endpoint=fixture-v5');
  await admin.locator('form:has([name=gatewayUrl])').evaluate(form=>form.requestSubmit());
  await admin.waitForFunction(()=>document.querySelector('form:has([name=gatewayUrl])').getAttribute('aria-busy')==='false');
  const saved=await app.evaluate(()=>globalThis.configuration.snapshot());assert.equal(saved.transport,'wss');assert.equal(saved.appTokenConfigured,true);assert.equal(saved.deploymentVersion,'fixture-v5');assert.equal(await admin.locator('[name=appToken]').inputValue(),'');receipts.wss={transport:saved.transport,version:saved.deploymentVersion,secretCleared:true};
  await app.evaluate(()=>globalThis.setFixture({}));await app.evaluate(()=>globalThis.openMode('workspace'));
  const workspace=app.windows().find(page=>page.url().includes('mode=workspace'));await workspace.waitForSelector('.conversation-sessions');
  assert.equal(await workspace.locator('.workspace-composer textarea').count(),0,'workspace intentionally has no task composer');
  // Exercise the visible production composer on the panel; workspace session drafts still join app.quit preflight.
  panel.on('dialog',dialog=>{void dialog.dismiss().catch(()=>{});});
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('mode=panel'));win.setContentSize(600,720);win.webContents.setZoomFactor(1);win.show();win.focus();});
  await panel.locator('.composer textarea').fill('latest draft before native close');
  await app.evaluate(()=>{globalThis.denyDraftClose=true;});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('mode=panel')).close());
  await panel.waitForFunction(()=>document.querySelector('#error').textContent.includes('fixture final save denied'));
  assert.equal(panel.isClosed(),false);assert.equal(await panel.locator('.composer textarea').inputValue(),'latest draft before native close');receipts.failedCloseKeptDraft=true;
  await app.evaluate(({app})=>{app.quit();});
  await app.evaluate(()=>new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const poll=()=>{if(globalThis.quitError)return resolve();if(Date.now()>=deadline)return reject(Error('quit failure receipt timed out'));setTimeout(poll,10);};poll();}));
  const quitFailure=await app.evaluate(()=>({error:globalThis.quitError,cleanup:globalThis.cleanupCount}));
  assert.match(quitFailure.error,/关闭前草稿保存未确认/);assert.equal(quitFailure.cleanup,0);
  await panel.waitForFunction(()=>!document.documentElement.inert&&!document.querySelector('.composer textarea').readOnly);
  assert.equal(workspace.isClosed(),false);assert.equal(panel.isClosed(),false);receipts.failedQuitKeptHosts=true;
  await panel.locator('.composer textarea').fill('retry draft after failed app quit');
  await app.evaluate(()=>{globalThis.denyDraftClose=false;});
  assert.deepEqual(await app.evaluate(()=>globalThis.rendererErrors),[]);
  const exited=app.waitForEvent('close');
  await app.evaluate(({app})=>{app.quit();}).catch(()=>{});await exited;
  const {Conversations}=await import(moduleUrl('conversations.js'));
  const storedConversations=new Conversations(path.join(directory,'conversations.json'));
  let stored;
  try{stored=storedConversations.session('desktop-panel').draft;}
  finally{storedConversations.close();}
  assert.equal(stored,'retry draft after failed app quit');receipts.finalDraft=stored;
  fs.writeFileSync(path.join(directory,'receipts.json'),JSON.stringify(receipts,null,2));console.log(JSON.stringify({state:'passed',cases:receipts.layouts.length+5,receipt:path.join(directory,'receipts.json')}));
 }finally{await app.evaluate(()=>{globalThis.denyDraftClose=false;}).catch(()=>{});await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
