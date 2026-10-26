const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {performance}=require('node:perf_hooks');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {_electron}=require('playwright');
const {closeDesktop}=require('./close-desktop.cjs');

// Opt-in isolated acceptance: real Electron/SQLite, synthetic history and explicit Fake Model.
// No user profile, credentials, models, network fixture or production telemetry is required.
(async()=>{
  const root=path.resolve(__dirname,'../../..'),desktop=path.join(root,'apps/desktop');
  const output=path.resolve(root,process.argv[2]??'.cache/performance/electron');
  const sizes=process.argv[3]?process.argv[3].split(',').map(Number):[100,1000,10000];
  fs.mkdirSync(output,{recursive:true});
  const {seedPerformanceDatabase}=await import(pathToFileURL(path.join(__dirname,'performance-database.mjs')));
  const executablePath=path.join(root,'node_modules/electron/dist/electron.exe');
  const results=[];
  const sourceHashes=Object.fromEntries(['apps/desktop/electron/main.js','apps/desktop/src/app/renderer.js',
    'apps/runtime/dist/index.js','apps/runtime/dist/application/runtime-application.js',
    'apps/desktop/test-support/performance-electron.cjs'].map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));
  const summary=values=>{const v=[...values].sort((a,b)=>a-b);return {count:v.length,p50:v[Math.ceil(v.length*.5)-1]??0,p95:v[Math.ceil(v.length*.95)-1]??0,max:v.at(-1)??0};};
  for(const size of sizes){
    const profile=fs.mkdtempSync(path.join(output,`profile-${size}-`));
    const fixture=await seedPerformanceDatabase(path.join(profile,'runtime.sqlite'),size);
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PA_|^ELECTRON_RUN_AS_NODE$/i.test(key)));
    Object.assign(env,{PA_USER_DATA_DIR:profile,PA_RUNTIME_PROFILE:'local',PA_DESKTOP_EPHEMERAL_MODEL:'1'});
    const started=performance.now(),application=await _electron.launch({executablePath,args:[desktop,'--fake-model'],env});
    const waitWindow=async mode=>{
      for(let attempt=0;attempt<100;attempt++){
        const page=application.windows().find(candidate=>candidate.url().includes(`mode=${mode}`));
        if(page){await page.waitForLoadState('domcontentloaded');return page;}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw Error(`Window did not load: ${mode}`);
    };
    const errors=[],record={size,fixture,checks:{},closed:false};results.push(record);
    const save=()=>fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({mode:'real-electron-real-sqlite-synthetic-data-fake-model',
      node:process.version,sourceHashes,results,limitations:['No real cloud/model/OS low-memory injection','Thermal critical is an injected Electron event; recovery hysteresis has separate deterministic tests',
        'Process memory is sampled; not a hardware-wide guarantee','IPC blocked-delivery case is injected in the test process','OS IME not exercised; composition events are synthetic','No pre-change full Electron launch comparison']},null,2)+'\n');
    try {
      await application.firstWindow();
      const orb=await waitWindow('orb');
      await orb.evaluate(()=>window.desktop.invoke('orb.open'));
      const panel=await waitWindow('panel');
      for(const page of application.windows())page.on('pageerror',error=>errors.push(error.message));
      await panel.waitForFunction(()=>document.querySelectorAll('#tasks [data-turn]').length>0,{timeout:30000});
      record.startupToHistoryMs=performance.now()-started;
      const initial=await panel.evaluate(()=>window.desktop.invoke('snapshot'));assert.equal(initial.ok,true);
      assert.equal(initial.value.fake,false);assert.equal(initial.value.fakeModel,true);
      assert.ok(initial.value.tasks.length<=48);assert.equal(initial.value.historyPage.hasOlder,true);
      record.checks.realRuntimeBoundedHistory=true;record.initialVisibleTasks=initial.value.tasks.length;
      record.resourceBudget=initial.value.resourceBudget;
      await application.evaluate(async({app,BrowserWindow,ipcMain})=>{
        const {monitorEventLoopDelay,performance}=process.getBuiltinModule('node:perf_hooks');
        const delay=monitorEventLoopDelay({resolution:5});delay.enable();
        globalThis.__performanceFixture={delay,performance,utilization:performance.eventLoopUtilization(),windows:{},dropPanel:false};
        const track=win=>{
          const data={sends:0,bytes:0,maxBytes:0,maxTasks:0,acks:0};
          const mode=()=>{const value=new URL(win.webContents.getURL()||'about:blank').searchParams.get('mode');
            if(value)globalThis.__performanceFixture.windows[value]=data;return value;};
          const send=win.webContents.send.bind(win.webContents);
          win.webContents.send=(channel,value,...rest)=>{
            const surface=mode();
            if(channel==='desktop:update'){
              const bytes=Buffer.byteLength(JSON.stringify(value));data.sends++;data.bytes+=bytes;data.maxBytes=Math.max(data.maxBytes,bytes);data.maxTasks=Math.max(data.maxTasks,value.tasks?.length??0);
              if(surface==='panel'&&globalThis.__performanceFixture.dropPanel)return;
            }
            return send(channel,value,...rest);
          };
          mode();
          ipcMain.on('desktop:snapshot-ack',event=>{if(event.sender===win.webContents)data.acks++;});
        };
        for(const win of BrowserWindow.getAllWindows())track(win);
        app.on('browser-window-created',(_event,win)=>track(win));
      });
      await panel.evaluate(()=>{
        globalThis.__performanceFixture={longTasks:[],updates:0};
        new PerformanceObserver(list=>{for(const entry of list.getEntries())globalThis.__performanceFixture.longTasks.push(entry.duration);}).observe({type:'longtask',buffered:true});
        window.desktop.subscribe(()=>globalThis.__performanceFixture.updates++);
      });
      const readTimes=[];for(let i=0;i<12;i++){
        const before=performance.now();await panel.evaluate(()=>window.desktop.invoke('snapshot'));readTimes.push(performance.now()-before);
      }
      record.snapshotRoundTripMs=summary(readTimes);record.rawSnapshotRoundTripMs=readTimes;
      const firstIds=initial.value.tasks.map(task=>task.taskId);
      await panel.getByRole('button',{name:'更早记录',exact:true}).click();
      await panel.waitForFunction(()=>document.querySelector('.history-navigation [role=status]')?.textContent.startsWith('历史记录'));
      const older=(await panel.evaluate(()=>window.desktop.invoke('snapshot'))).value;
      assert.ok(older.tasks.length<=48);assert.ok(older.tasks.some(task=>!firstIds.includes(task.taskId)));
      const draft=panel.locator('textarea[aria-label="任务内容"]');await draft.fill('性能验证中文草稿');await draft.focus();
      const composition=await draft.evaluate(async input=>{
        input.dispatchEvent(new CompositionEvent('compositionstart',{data:'中',bubbles:true}));
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
        await window.desktop.invoke('snapshot.resync');
        await new Promise(resolve=>setTimeout(resolve,120));
        input.dispatchEvent(new CompositionEvent('compositionend',{data:'中文',bubbles:true}));
        return {value:input.value,focused:document.activeElement===input};
      });
      assert.deepEqual(composition,{value:'性能验证中文草稿',focused:true});record.checks.compositionAndDraftPreserved=true;
      await panel.getByRole('button',{name:'回到最新',exact:true}).click();
      await panel.waitForFunction(()=>document.querySelector('.history-navigation [role=status]')?.textContent.startsWith('最近记录'));
      assert.equal(await draft.inputValue(),'性能验证中文草稿');record.checks.historyNavigation=true;
      const submitStarted=performance.now();await draft.press('Enter');
      await panel.waitForFunction(()=>document.querySelector('#tasks')?.innerText.includes('Fake Model 回答：性能验证中文草稿'));
      record.submitToVisibleFakeAnswerMs=performance.now()-submitStarted;record.checks.newTaskAfterLongHistory=true;
      await draft.fill('翻页后仍保存的草稿');
      const dom=await panel.evaluate(async()=>{
        const {updateConversationTurns}=await import('../features/conversation/turn-view.js');
        const container=document.createElement('div');document.body.append(container);
        const first='<article data-turn="held"><p>first</p><div><button data-cancel="held">停止</button></div></article>';
        container.innerHTML=first;const button=container.querySelector('button');button.focus();
        button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));let clicked=0;button.addEventListener('click',()=>clicked++);
        updateConversationTurns(container,first.replace('first','progress')+'<article data-turn="new"><p>new</p></article>',
          {tasks:[{taskId:'held',state:'running'}],pendingCancelIds:new Set(),cancelSelector:'[data-cancel]',cancelAttribute:'cancel'});
        button.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));button.click();
        const result={sameButton:container.querySelector('button')===button,connected:button.isConnected,focused:document.activeElement===button,clicked};container.remove();return result;
      });
      assert.deepEqual(dom,{sameButton:true,connected:true,focused:true,clicked:1});record.checks.heldActionSurvivesInsertion=true;
      await panel.evaluate(()=>window.desktop.invoke('snapshot.resync'));await panel.waitForTimeout(150);
      const blockedStart=await application.evaluate(()=>{globalThis.__performanceFixture.dropPanel=true;return globalThis.__performanceFixture.windows.panel.sends;});
      await panel.evaluate(async()=>{for(let i=0;i<30;i++){await window.desktop.invoke('panel.pin',Boolean(i%2));await new Promise(resolve=>setTimeout(resolve,10));}});
      const blockedEnd=await application.evaluate(()=>globalThis.__performanceFixture.windows.panel.sends);
      assert.equal(blockedEnd-blockedStart,1,'only one projection waits for the blocked ACK');
      await application.evaluate(()=>{globalThis.__performanceFixture.dropPanel=false;});
      await panel.evaluate(()=>window.desktop.invoke('snapshot.resync'));await panel.waitForTimeout(150);
      record.checks.blockedDeliveryOneOutstanding=true;
      const hiddenStart=await application.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=panel')).hide();return globalThis.__performanceFixture.windows.panel.sends;});
      await panel.evaluate(async()=>{for(let i=0;i<12;i++){await window.desktop.invoke('panel.pin',Boolean(i%2));await new Promise(resolve=>setTimeout(resolve,15));}});
      assert.equal(await application.evaluate(()=>globalThis.__performanceFixture.windows.panel.sends),hiddenStart);
      await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=panel')).show());
      await panel.waitForTimeout(150);record.checks.hiddenNoSnapshots=true;
      assert.ok(await panel.locator('#tasks [data-turn]').count()<=48);record.checks.restoreFullSnapshot=true;
      await application.evaluate(({powerMonitor})=>powerMonitor.emit('thermal-state-change',{state:'critical'}));
      await panel.waitForFunction(()=>document.documentElement.dataset.resourceMode==='critical');
      await orb.evaluate(()=>{globalThis.__paintCount=0;const original=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){globalThis.__paintCount++;return original.apply(this,args);};});
      await orb.waitForTimeout(1100);
      record.criticalOrb=await orb.evaluate(()=>({paintCount:globalThis.__paintCount,canvasWidth:document.querySelector('canvas').width,cssWidth:document.querySelector('canvas').getBoundingClientRect().width,dpr:devicePixelRatio}));
      assert.ok(record.criticalOrb.paintCount<=15);record.checks.criticalCadence=true;
      await panel.evaluate(()=>window.desktop.invoke('workspace.open'));
      const workspace=await waitWindow('workspace');
      await workspace.waitForFunction(()=>document.querySelectorAll('#workspace-conversation [data-turn]').length>0);
      const workspaceRead=(await workspace.evaluate(()=>window.desktop.invoke('snapshot'))).value;
      assert.ok(workspaceRead.tasks.length<=48);record.checks.workspaceBounded=true;
      assert.equal(await workspace.locator('.cc-hero-field').evaluate(node=>getComputedStyle(node).animationName),'none');
      record.checks.criticalOptionalAnimationStopped=true;
      await panel.evaluate(()=>window.desktop.invoke('admin.open',{page:'tasks'}));
      const admin=await waitWindow('admin');
      await admin.waitForSelector('.history-navigation');
      record.adminVisibleTasks=(await admin.evaluate(()=>window.desktop.invoke('snapshot'))).value.tasks.length;
      assert.ok(record.adminVisibleTasks<=48);record.checks.adminBounded=true;
      await application.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=panel'));win.show();win.focus();});
      await panel.waitForFunction(()=>!document.hidden);
      await panel.screenshot({path:path.join(output,`panel-${size}.png`)});
      await application.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=workspace'));win.show();win.focus();});
      await workspace.waitForFunction(()=>!document.hidden);
      await workspace.screenshot({path:path.join(output,`workspace-${size}.png`)});
      record.renderer=await panel.evaluate(()=>({domNodes:document.querySelectorAll('*').length,turns:document.querySelectorAll('#tasks [data-turn]').length,
        longTasks:globalThis.__performanceFixture.longTasks,updates:globalThis.__performanceFixture.updates,
        heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null}));
      record.renderers=[];
      for(const page of application.windows()){
        const renderer=await page.evaluate(()=>({mode:new URL(location.href).searchParams.get('mode'),domNodes:document.querySelectorAll('*').length}));
        const session=await page.context().newCDPSession(page);
        renderer.heap=await session.send('Runtime.getHeapUsage');await session.detach();record.renderers.push(renderer);
      }
      record.main=await application.evaluate(({app,screen,BrowserWindow})=>{
        const fixture=globalThis.__performanceFixture;fixture.delay.disable();return {processMemory:process.memoryUsage(),
          processes:app.getAppMetrics().map(item=>({type:item.type,pid:item.pid,memory:item.memory,cpu:item.cpu})),
          rendererProcesses:BrowserWindow.getAllWindows().map(win=>({mode:new URL(win.webContents.getURL()).searchParams.get('mode'),pid:win.webContents.getOSProcessId()})),
          displays:screen.getAllDisplays().map(display=>({scaleFactor:display.scaleFactor,refreshRate:display.displayFrequency,width:display.size.width,height:display.size.height})),
          ipc:fixture.windows,eventLoopUtilization:fixture.performance.eventLoopUtilization(fixture.utilization),
          eventLoopDelayMs:{p50:fixture.delay.percentile(50)/1e6,p95:fixture.delay.percentile(95)/1e6,max:fixture.delay.max/1e6}};
      });
      assert.deepEqual(errors,[]);record.checks.noRendererErrors=true;record.status='passed';
      console.log(JSON.stringify({size,status:record.status,startupMs:record.startupToHistoryMs,snapshotRoundTripMs:record.snapshotRoundTripMs,turns:record.renderer.turns,domNodes:record.renderer.domNodes}));
    } catch(error){record.status='failed';record.error=error.stack;save();throw error;}
    finally {
      try {
        await closeDesktop(application);record.closed=true;
        const db=new DatabaseSync(path.join(profile,'runtime.sqlite'),{readOnly:true});
        try {record.persistedTasks=db.prepare('SELECT count(*) AS count FROM tasks').get().count;
          record.persistedSyntheticHistory=db.prepare("SELECT count(*) AS count FROM tasks WHERE goal='Synthetic public performance input'").get().count;
          if(record.status==='passed'){assert.equal(record.persistedSyntheticHistory,size);assert.equal(record.persistedTasks,size+1);}
        } finally {db.close();}
      }
      catch(error){
        record.status='failed';record.closeError=error.message;
        // A failed test may catch a freshly created window before its draft preflight exists.
        // Finish loading only these owned fixture windows, then retry the normal product quit.
        for(const page of application.windows())await page.waitForLoadState('domcontentloaded').catch(()=>{});
        try {await closeDesktop(application);record.closed=true;} catch(second){record.closeRetryError=second.message;application.process().kill();}
        throw error;
      } finally {record.errors=errors;save();}
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
