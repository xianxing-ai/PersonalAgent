const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'.cache/inline-subagent-qa');fs.mkdirSync(out,{recursive:true});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PA_')));
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(__dirname,'inline-subagents-fixture.mjs'),'--fake-runtime'],env:{...env,ELECTRON_RUN_AS_NODE:undefined,PA_RUNTIME_PROFILE:'local',PA_DESKTOP_EPHEMERAL_MODEL:'1',PA_USER_DATA_DIR:fs.mkdtempSync(path.join(out,'profile-'))}});
 const errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
 try{
  await app.firstWindow();const orb=app.windows().find(p=>p.url().includes('mode=orb'));await orb.waitForSelector('.orb-button');await orb.evaluate(()=>window.desktop.invoke('orb.open'));
  const panel=app.windows().find(p=>p.url().includes('mode=panel'));await panel.waitForSelector('#panel-expand');const opened=app.waitForEvent('window');await panel.locator('#panel-expand').click();const page=await opened;await page.waitForSelector('[data-child-task="a"]');
  assert.equal(await page.locator('.cc-rail [data-child-task]').count(),3);assert.equal(await page.locator('.cc-context [data-child-task]').count(),0);
  assert.match(await page.locator('.cc-agent-group').first().innerText(),/进行中.*1/s);assert.match(await page.locator('.cc-agent-group').last().innerText(),/已结束.*2/s);
  assert.equal(await page.locator('.cc-context .connector-board').isVisible(),true);
  const main=page.getByRole('textbox',{name:'工作区任务内容',exact:true});await main.fill('主对话草稿');assert.equal(await page.locator('.cc-inline-host').isVisible(),false);
  const childInput=()=>page.locator('.cc-child-pane:not([hidden]) textarea');
  await page.locator('[data-child-task="a"]').click();await page.getByRole('heading',{name:'梳理界面参考 · 演示',exact:true}).waitFor();assert.match(await page.locator('.cc-child-pane:not([hidden]) .subagent-conversation-origin-turn').innerText(),/已保存回答 a/);await childInput().fill('A 的草稿');
  await page.locator('[data-child-task="b"]').click();await page.getByRole('heading',{name:'核对改动结果 · 演示',exact:true}).waitFor();await childInput().fill('B 的草稿');
  await page.getByRole('button',{name:'切换到主对话',exact:true}).click();assert.equal(await main.inputValue(),'主对话草稿');
  await page.locator('[data-child-task="a"]').click();assert.equal(await childInput().inputValue(),'A 的草稿');await page.locator('.cc-child-pane:not([hidden])').getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.cc-child-pane:not([hidden]) textarea').value);
  const headerStop=page.locator('.cc-child-pane:not([hidden])').getByRole('button',{name:'停止子智能体',exact:true});assert.equal(await headerStop.isVisible(),true);assert.equal(await headerStop.isEnabled(),true);await headerStop.click();await page.waitForFunction(()=>document.querySelector('.cc-child-pane:not([hidden]) .subagent-conversation-stop').getAttribute('aria-busy')==='false');
  const calls=await app.evaluate(()=>globalThis.inlineSubagentFixture.calls);assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.binding),[{parentTaskId:'synthetic-parent',taskId:'a'},{parentTaskId:'synthetic-parent',taskId:'a'}]);assert.equal(calls[1].executionTaskId,'execution-a');
  await page.locator('[data-stop-child="c"]').click();await page.waitForFunction(()=>!document.querySelector('[data-stop-child="c"]')?.disabled);const stopped=await app.evaluate(()=>globalThis.inlineSubagentFixture.calls);assert.equal(stopped.length,3);assert.deepEqual(stopped[2],{operation:'cancel',binding:{taskId:'c',parentTaskId:'synthetic-parent'},executionTaskId:'c'});assert.equal(await childInput().inputValue(),'');assert.equal(await page.locator('.workspace-composer textarea').inputValue(),'主对话草稿');
  await app.evaluate(()=>{globalThis.inlineSubagentFixture.holdA=true;});await page.locator('.cc-child-pane:not([hidden])').getByRole('button',{name:'刷新子对话',exact:true}).click();await page.locator('[data-child-task="b"]').click();assert.equal(await childInput().inputValue(),'B 的草稿');
  await app.evaluate(()=>{globalThis.inlineSubagentFixture.holdA=false;globalThis.inlineSubagentFixture.release();});await page.waitForTimeout(100);assert.equal(await childInput().inputValue(),'B 的草稿');assert.equal(await page.locator('.cc-child-pane:not([hidden]) h1').innerText(),'核对改动结果 · 演示');
  const blocked=await panel.evaluate(()=>window.desktop.invoke('workspace.subagent.snapshot',{binding:{parentTaskId:'synthetic-parent',taskId:'a'}}));assert.equal(blocked.ok,false);const foreign=await page.evaluate(()=>window.desktop.invoke('workspace.subagent.snapshot',{binding:{parentTaskId:'synthetic-parent',taskId:'foreign'}}));assert.equal(foreign.ok,false);
  await childInput().fill('');await page.locator('[data-child-task="a"]').click();await childInput().fill('');await page.getByRole('button',{name:'切换到主对话',exact:true}).click();await main.fill('');
  for(const theme of ['dark','light']){await page.evaluate(async theme=>(await import('../ui/preferences.js')).saveTheme(theme),theme);await page.waitForTimeout(120);const color=await page.locator('#workspace-orb canvas').evaluate(el=>{const s=getComputedStyle(el);return {particle:s.getPropertyValue('--orb-particle').trim(),core:s.getPropertyValue('--orb-core-1').trim(),filter:s.filter};});assert.equal(color.particle,'#fff');assert.equal(color.core,'#050505');assert.equal(color.filter.includes('invert(1)'),theme==='light','invert the entire canvas once, including the core');await page.screenshot({path:path.join(out,theme+'.png')});}
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({profile:'explicit_synthetic_child_ports',realRuntimeChildExecution:false,threadDraftIsolation:true,lateReadIsolation:true,bindingRefusal:true,themeInversion:true,pageErrors:errors},null,2));console.log('PASS: inline main/child switch, per-thread drafts, original binding submit/stop, late read isolation, rejected foreign sender/child, black/white particles; explicit synthetic child ports');
 }catch(error){console.error('Inline smoke assertion:',error);throw error;}
 finally{
  // Only this isolated fixture: clear retained test drafts so beforeunload cannot mask an assertion.
  for(const fixturePage of app.windows())await fixturePage.evaluate(()=>{for(const input of document.querySelectorAll('textarea')){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}}).catch(()=>{});
  await app.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
