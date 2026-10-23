// Actual Electron renderer; explicit synthetic bridge/metadata, no native picker or cloud.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {_electron}=require('playwright');

(async()=>{
  const cache=path.resolve(__dirname,'../../../.cache/installed-skills-ui');fs.mkdirSync(cache,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(cache,'case-'));
  const moduleUrl=pathToFileURL(path.resolve(__dirname,'../src/app/installed-skills-controls.js')).href;
  fs.writeFileSync(path.join(fixture,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Skill renderer fixture</title>
    <style>body{font:16px system-ui;margin:24px}button{margin:4px;padding:8px}article{border:1px solid #aaa;padding:12px}textarea{display:block;width:80%;height:80px}pre{white-space:pre-wrap}</style><main></main>
    <script type="module">
    import {mountInstalledSkillsControls} from ${JSON.stringify(moduleUrl)};
    window.calls=[];window.xssExecuted=false;window.value={available:true,items:[]};window.rejectRun='';
    const item={name:'meeting-outline',version:'1.0.0',description:'Public renderer fixture',digest:'a'.repeat(64),fileCount:2,enabled:false};
    const controls=mountInstalledSkillsControls(document.querySelector('main'),async(action,input)=>{
      window.calls.push({action,input});
      if(action==='skill.install'){window.value.items=[{...item}];controls.render(window.value,[],true);return {installed:true,enabled:false};}
      if(action==='skill.enable'){window.value.items[0].enabled=input.enabled;controls.render(window.value,[],true);return {enabled:input.enabled};}
      if(action==='skill.preview')return {instructions:'<img src=x onerror="window.xssExecuted=true">',resources:['SKILL.md','scripts/never-run.js']};
      if(action==='skill.resource')return {path:input.path,digest:'b'.repeat(64),text:'\\x3cscript>window.xssExecuted=true\\x3c/script>'};
      if(action==='skill.run'){if(window.rejectRun){const error=window.rejectRun;window.rejectRun='';throw Error(error);}return new Promise(resolve=>{window.resolveRun=()=>resolve({taskId:'synthetic-renderer-task'});});}
      if(action==='skill.uninstall'){window.value.items=[];controls.render(window.value,[],true);return {uninstalled:true};}
      throw Error('Unknown fixture action');
    });
    controls.render(window.value,[],false);window.rerender=()=>controls.render(window.value,[],true);
    </script></html>`);
  fs.writeFileSync(path.join(fixture,'main.cjs'),`const {app,BrowserWindow}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(fixture,'user-data'))});
    app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});window.loadFile(${JSON.stringify(path.join(fixture,'index.html'))});});`);
  const executablePath=process.env.PA_SKILL_SMOKE_ELECTRON || path.resolve(__dirname,'../../../node_modules/electron/dist/electron.exe');
  const environment=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PATH','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  const app=await _electron.launch({executablePath,args:[path.join(fixture,'main.cjs')],env:environment});
  const errors=[];
  try {
    const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
    await page.waitForSelector('[data-skill="install"]');
    assert.equal(await page.evaluate(()=>typeof require),'undefined');
    await page.locator('[data-skill-goal]').fill('Public renderer goal');
    await page.locator('[data-skill="install"]').click();
    await page.waitForFunction(()=>window.value.items.length===1);
    assert.equal(await page.locator('[data-skill-goal]').inputValue(),'Public renderer goal');
    assert.equal(await page.locator('[data-skill="run"]').isDisabled(),true);
    await page.locator('[data-skill="preview"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-skill-preview]').textContent.includes('<img'));
    assert.equal(await page.locator('[data-skill-preview] img').count(),0);assert.equal(await page.evaluate(()=>window.xssExecuted),false);
    await page.locator('[data-skill="resource"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-skill-preview]').textContent.includes('<script>'));
    assert.equal(await page.locator('[data-skill-preview] script').count(),0);assert.equal(await page.evaluate(()=>window.xssExecuted),false);
    await page.locator('[data-skill="enable"]').click();
    await page.waitForFunction(()=>window.value.items[0].enabled===true);
    for(const errorMessage of ['Skill 与任务合并后超过 128000 字符限制，请缩短内容','任务、Skill 与对话上下文合并后超过 128000 字符限制，请缩短内容或减少对话历史']){await page.evaluate(message=>{window.rejectRun=message;},errorMessage);await page.locator('[data-skill="run"]').click();await page.waitForFunction(()=>document.querySelector('[data-skill-status]').textContent.includes('128000'));assert.match(await page.locator('[data-skill-status]').textContent(),/缩短内容或减少对话历史/);assert.equal(await page.evaluate(()=>typeof window.resolveRun),'undefined');} await page.evaluate(()=>{window.rejectRun='synthetic secret error';});await page.locator('[data-skill="run"]').click();await page.waitForFunction(()=>document.querySelector('[data-skill-status]').textContent.includes('操作未完成'));assert.equal((await page.locator('[data-skill-status]').textContent()).includes('synthetic secret error'),false);
    const beforeRun=await page.evaluate(()=>window.calls.filter(call=>call.action==='skill.run').length);
    await page.locator('[data-skill="run"]').click();await page.waitForFunction(()=>!!window.resolveRun);
    await page.evaluate(()=>window.rerender());assert.equal(await page.locator('[data-skill="run"]').isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.action==='skill.run').length),beforeRun+1);
    await page.evaluate(()=>window.resolveRun());await page.waitForFunction(()=>document.querySelector('[data-skill-status]').textContent.includes('synthetic-renderer-task'));
    assert.equal(await page.locator('[data-skill-goal]').inputValue(),'Public renderer goal');
    await page.locator('[data-skill="uninstall"]').click();await page.waitForFunction(()=>window.value.items.length===0);
    assert.equal(await page.locator('[data-skill-preview]').textContent(),'');assert.deepEqual(errors,[]);
    assert.equal(await page.locator('[data-skill-resources]').isVisible(),false);
    console.log(JSON.stringify({state:'passed',renderer:'actual Electron DOM',bridge:'explicit synthetic',nativePicker:false,cloudCallsMeasured:false}));
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
