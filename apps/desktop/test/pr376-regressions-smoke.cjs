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
 const windows=new Map();let journal,configuration;
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
  const {createAgentArtsConfig}=await import(${JSON.stringify(moduleUrl('agentarts-config.js'))});
  journal=new Conversations(path.join(app.getPath('userData'),'conversations.json'));
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
  configuration=createAgentArtsConfig({userData:app.getPath('userData'),safeStorage,environment:{}});
  configuration.configure({gatewayUrl:'https://fixture.huaweicloud-agentarts.com',runtimeName:'fixture',authorization:'Bearer public-offline-fixture-not-a-real-credential'});
  globalThis.journal=journal;globalThis.configuration=configuration;
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
  const panel=await app.firstWindow();await panel.waitForSelector('.conversation-sessions');
  const base=await app.evaluate(()=>globalThis.journal.snapshot('panel'));
  await app.evaluate(()=>globalThis.setFixture({agentArtsModels:{catalog:null,preferences:null}}));
  await panel.waitForFunction(()=>document.querySelector('.native-reasoning-control select').disabled);
  await app.evaluate((_,base)=>globalThis.setFixture({conversationState:{...base,sessions:[...base.sessions,...Array.from({length:20},(_,i)=>({id:'archived-'+i,title:'较长归档对话名称：检查布局、恢复和滚动 '+i,archived:true}))]}}),base);
  await panel.locator('.conversation-sessions summary').click();
  for(const size of [[420,720],[600,720],[420,600]])for(const zoom of [1,1.25,1.5]){
   await app.evaluate(({BrowserWindow},{size,zoom})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(...size);win.webContents.setZoomFactor(zoom);win.show();},{size,zoom});
   await panel.evaluate(zoom=>document.documentElement.dataset.theme=zoom===1.25?'dark':'light',zoom);
   await panel.locator('[data-restore-conversation="archived-19"]').scrollIntoViewIfNeeded();
   const result=await panel.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect(),thread=rect('.thread'),composer=rect('.composer'),last=rect('[data-restore-conversation="archived-19"]');return {width:innerWidth,height:innerHeight,lastBottom:last.bottom,composerBottom:composer.bottom,threadBottom:thread.bottom,composerTop:composer.top};});
   assert.ok(result.lastBottom<=result.height+2,JSON.stringify(result));assert.ok(result.composerBottom<=result.height+2,JSON.stringify(result));assert.ok(result.threadBottom<=result.composerTop+2,JSON.stringify(result));
   receipts.layouts.push({size,zoom,...result});
   const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
   fs.writeFileSync(path.join(directory,'panel-'+size.join('x')+'-'+zoom+'.png'),Buffer.from(png,'base64'));
   await panel.locator('#model').click();await panel.locator('#mm-slider').scrollIntoViewIfNeeded();
   const menu=await panel.evaluate(()=>{const slider=document.querySelector('#mm-slider'),r=slider.getBoundingClientRect(),menu=document.querySelector('#model-menu').getBoundingClientRect();return {top:menu.top,bottom:menu.bottom,reachable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===slider};});
   assert.ok(menu.top>=0&&menu.bottom<=result.height+2&&menu.reachable,JSON.stringify({size,zoom,menu}));await panel.locator('#model').click();
  }
  // Reset the synthetic archived metadata before the final close boundary validates it.
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
  const workspace=app.windows().find(page=>page.url().includes('mode=workspace'));await workspace.waitForSelector('.workspace-composer textarea');
  workspace.on('dialog',dialog=>{void dialog.dismiss().catch(()=>{});});
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('mode=workspace'));win.show();win.focus();});
  await workspace.locator('textarea').fill('latest draft before native close');
  await app.evaluate(()=>{globalThis.denyDraftClose=true;});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('mode=workspace')).close());
  await workspace.waitForFunction(()=>document.querySelector('#workspace-error').textContent.includes('fixture final save denied'));
  assert.equal(workspace.isClosed(),false);assert.equal(await workspace.locator('textarea').inputValue(),'latest draft before native close');receipts.failedCloseKeptDraft=true;
  await app.evaluate(()=>{globalThis.denyDraftClose=false;});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('mode=workspace')).close());
  if(!workspace.isClosed())await workspace.waitForEvent('close');
  const stored=JSON.parse(fs.readFileSync(path.join(directory,'conversations.json'),'utf8')).sessions.find(session=>session.id==='desktop-workspace').draft;
  assert.equal(stored,'latest draft before native close');receipts.finalDraft=stored;
  assert.deepEqual(await app.evaluate(()=>globalThis.rendererErrors),[]);
  fs.writeFileSync(path.join(directory,'receipts.json'),JSON.stringify(receipts,null,2));console.log(JSON.stringify({state:'passed',cases:receipts.layouts.length+4,receipt:path.join(directory,'receipts.json')}));
 }finally{await app.evaluate(()=>{globalThis.denyDraftClose=false;}).catch(()=>{});await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
