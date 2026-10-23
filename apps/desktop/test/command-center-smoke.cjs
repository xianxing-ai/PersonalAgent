const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'.cache/command-center-qa');fs.mkdirSync(out,{recursive:true});
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('PA_'))),profile=fs.mkdtempSync(path.join(out,'profile-'));
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(root,'apps/desktop'),'--fake-runtime'],env:{...env,ELECTRON_RUN_AS_NODE:undefined,PA_RUNTIME_PROFILE:'local',PA_DESKTOP_EPHEMERAL_MODEL:'1',PA_USER_DATA_DIR:profile}});
 const errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
 const keep=process.argv.includes('--keep-open');
 try{
  await app.firstWindow();const orb=app.windows().find(p=>p.url().includes('mode=orb'));await orb.waitForSelector('.orb-button');await orb.evaluate(()=>window.desktop.invoke('orb.open'));
  const panel=app.windows().find(p=>p.url().includes('mode=panel'));await panel.waitForSelector('#panel-expand');const opening=app.waitForEvent('window');await panel.locator('#panel-expand').click();const page=await opening;
  await page.waitForSelector('.command-center');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark','fresh workspace opens in the default dark theme');await page.evaluate(async()=>(await import('../ui/preferences.js')).saveTheme('dark'));
  const resize=async(width,height)=>{await app.evaluate(({BrowserWindow},{width,height})=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=workspace'));win.unmaximize();win.setMinimumSize(360,360);win.setBounds({x:60,y:30,width,height});},{width,height});await page.waitForTimeout(140);};
  const snapshot=()=>page.evaluate(async()=>{const r=await window.desktop.invoke('snapshot');if(!r.ok)throw Error(r.error);return r.value;});
  const input=page.getByRole('textbox',{name:'工作区任务内容',exact:true});
  assert.equal(await page.locator('.cc-hero .connector-card').count(),0);assert.equal(await page.locator('.cc-context .connector-board').isVisible(),true);assert.equal(await page.locator('.cc-child').count(),0);
  assert.equal(await page.locator('[data-cc-nav="team"],[data-cc-nav="link"]').count(),0);
  await page.waitForFunction(()=>document.querySelector('.cc-hero-field').width>0);
  await page.evaluate(async()=>{(await import('../ui/preferences.js')).saveCalm(true);});
  // Shared reduced-motion CSS removes animations entirely; the local hidden policy pauses them.
  assert.equal(await page.locator('.cc-hero-field').evaluate(el=>el.getAnimations().every(animation=>animation.playState==='paused'||animation.playState==='finished')),true);
  await page.evaluate(async()=>{(await import('../ui/preferences.js')).saveCalm(false);});
  assert.match(await page.locator('[data-cc-runtime]').innerText(),/模拟/);
  const cases=[];
  for(const [width,height] of [[1500,940],[1200,800],[900,800],[600,780],[420,780]]){
   await resize(width,height);const layout=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,input:rect('.workspace-composer textarea'),send:rect('[data-send]')};});
   assert.equal(layout.overflow,false,JSON.stringify(layout));for(const name of ['input','send'])assert.ok(layout[name].x>=0&&layout[name].right<=layout.width+1&&layout[name].bottom<=layout.height+1,JSON.stringify({name,layout}));
   assert.ok(await page.locator('.command-center').evaluate(el=>Math.abs(el.getBoundingClientRect().height-innerHeight)<1),'workspace fills the viewport in empty and active states');
   if(width<=760){await page.locator('.cc-sidebar-toggle').click();assert.equal(await page.locator('.cc-rail').isVisible(),true);await page.locator('.cc-sidebar-toggle').click();assert.equal(await page.locator('.cc-rail').isVisible(),false);}
   if(width<=1000){await page.locator('.cc-connectors-toggle').click();assert.equal(await page.locator('.connector-board').isVisible(),true);await page.locator('.cc-connectors-toggle').click();assert.equal(await page.locator('.cc-context').isVisible(),false);}
   await page.locator('.model-thinking-trigger').click();await page.locator('.model-thinking-menu').waitFor({state:'visible'});const menu=await page.locator('.model-thinking-menu').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=layout.width+1,JSON.stringify(menu));await page.keyboard.press('Escape');
   await page.screenshot({path:path.join(out,`empty-${width}.png`)});cases.push({width,height});
  }
  await resize(1500,940);await page.locator('[data-cc-starter]').first().click();assert.match(await input.inputValue(),/今天/);assert.equal((await snapshot()).tasks.length,0);
  const original=(await snapshot()).conversationState.activeId;await input.fill('第一会话草稿');await page.locator('.cc-new-chat').click();await page.waitForFunction(id=>document.querySelector('[data-session-list]').value!==id,original);const second=(await snapshot()).conversationState.activeId;await page.locator('.cc-history-toggle').click();
  await input.fill('第二会话草稿');await page.locator('[data-session-list]').selectOption(original);await page.waitForFunction(()=>document.querySelector('.workspace-composer textarea').value==='第一会话草稿');
  await page.locator('[data-session-title]').fill('新版工作台验证');await page.locator('[data-session-rename]').click();await page.waitForFunction(()=>document.querySelector('.cc-chat-heading [data-cc-session]').textContent==='新版工作台验证');
  await page.getByRole('button',{name:'关闭历史会话',exact:true}).click();assert.equal(await page.locator('.connector-board').isVisible(),true);
  await page.locator('.cc-tools').click();assert.equal(await page.locator('#connectors-refresh').evaluate(el=>el===document.activeElement),true);
  await input.fill('显式模拟：检查新版工作台发送与停止。');await page.locator('[data-send]').click();await page.waitForSelector('.workspace-turn');await page.waitForSelector('.cc-activity-list [data-activity-task]');const task=(await snapshot()).tasks.at(-1);assert.equal(task.conversationId??original,original);
  await page.locator('[data-stop]').click();await page.evaluate(id=>window.desktop.invoke('test.advance',id),task.taskId);await page.waitForFunction(async()=>((await window.desktop.invoke('snapshot')).value.tasks.at(-1).state==='cancelled'));
  await page.locator('[data-activity-task]').first().click();await page.locator('#conversation-inspector').waitFor({state:'visible'});await page.locator('#inspector-close').click();await page.screenshot({path:path.join(out,'active.png')});
  await page.locator('.cc-history-toggle').click();await page.locator('[data-session-list]').selectOption(second);await page.waitForFunction(()=>document.querySelector('.workspace-composer textarea').value==='第二会话草稿');await input.fill('');await page.getByRole('button',{name:'关闭历史会话',exact:true}).click();
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({profile,cases,errors,realServices:false,history:true,modelPicker:true,submitCancel:true,activityInspector:true},null,2));console.log('PASS: command center 5 sizes, model picker, history/drafts/rename, connectors, actual IPC submit/cancel, activity and inspector; pageErrors=0');
  if(keep){await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=workspace'));w.maximize();w.setTitle('PersonalAgent · 新版工作台预览');w.show();w.moveTop();w.focus();});await page.screenshot({path:path.join(out,'preview.png')});console.log('PREVIEW_READY '+profile);await new Promise(resolve=>app.on('close',resolve));}
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
