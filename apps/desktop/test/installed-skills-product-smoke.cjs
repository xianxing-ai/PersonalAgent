// Actual product main/preload/admin; explicit synthetic native dialogs, no cloud configuration.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
  const cache=path.resolve(__dirname,'../../../.cache/installed-skills-product');fs.mkdirSync(cache,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(cache,'case-')),userData=path.join(fixture,'user-data');
  const example=path.resolve(__dirname,'../../../examples/skills/meeting-outline');
  const original=fs.readFileSync(path.join(example,'SKILL.md'),'utf8'),source=path.join(fixture,'meeting-outline');
  fs.mkdirSync(path.join(source,'references'),{recursive:true});fs.writeFileSync(path.join(source,'SKILL.md'),original);
  fs.writeFileSync(path.join(source,'references/guide.md'),'<img src=x onerror="window.resourceExecuted=true">\n公开指南');
  const environment=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PATH','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  Object.assign(environment,{PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_USER_DATA_DIR:userData});
  const executablePath=process.env.PA_SKILL_SMOKE_ELECTRON || path.resolve(__dirname,'../../../node_modules/electron/dist/electron.exe');
  async function launch() {
    const app=await _electron.launch({executablePath,args:[path.resolve(__dirname,'..')],env:environment});
    try {
    await app.firstWindow();
    await app.evaluate(({dialog},selected)=>{
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});
      dialog.showMessageBox=async()=>({response:1});
    },source);
    let admin;
    for(let i=0;i<100;i++){admin=app.windows().find(page=>page.url().includes('mode=admin'));if(admin)break;await new Promise(r=>setTimeout(r,50));}
    assert.ok(admin,'unconfigured Competition app opens admin');
    await admin.waitForSelector('[data-page="capabilities"]');await admin.locator('[data-page="capabilities"]').click();
    await admin.waitForSelector('[data-skill="install"]');return {app,admin};
    } catch(error) {await app.close();throw error;}
  }
  let instance=await launch();
  try {
    const {admin}=instance;
    assert.equal(await admin.locator('[data-skill="install"]').isDisabled(),false,'offline installation must not require cloud credentials');
    const orb=instance.app.windows().find(page=>page.url().includes('mode=orb'));
    const denied=await orb.evaluate(()=>window.desktop.invoke('skill.install'));
    assert.equal(denied.ok,false,'orb cannot invoke the admin installation API');
    await admin.locator('[data-skill="install"]').click();await admin.waitForSelector('[data-skill="preview"]');
    await admin.locator('[data-skill="preview"]').click();
    await admin.waitForFunction(()=>document.querySelector('[data-skill-preview]').textContent.includes('会议目标'));
    assert.ok(await admin.locator('[data-skill-goal]').evaluate(element=>element.getBoundingClientRect().width>300),'actual task field is usable');
    await admin.locator('[data-skill="resource"]').click();
    await admin.waitForFunction(()=>document.querySelector('[data-skill-preview]').textContent.includes('公开指南'));
    assert.equal(await admin.locator('[data-skill-preview] img').count(),0);
    assert.equal(await admin.evaluate(()=>window.resourceExecuted===true),false);
    await admin.locator('[data-skill="enable"]').click();
    await admin.waitForFunction(()=>document.querySelector('[data-skill="enable"]').textContent==='停用');
    assert.equal(await admin.locator('[data-skill="run"]').isDisabled(),true);
    const saved=JSON.parse(fs.readFileSync(path.join(userData,'installed-skills.json'),'utf8'));
    assert.equal(saved.entries.length,1);assert.equal(saved.entries[0].enabled,true);
    const deniedResource=await orb.evaluate(selected=>window.desktop.invoke('skill.resource',{...selected,path:'references/guide.md'}),
      {name:saved.entries[0].name,digest:saved.entries[0].digest});assert.equal(deniedResource.ok,false);
    const rejected=await admin.evaluate(selected=>window.desktop.invoke('skill.run',{...selected,goal:'Public offline probe'}),
      {name:saved.entries[0].name,digest:saved.entries[0].digest});
    assert.equal(rejected.ok,false,'unconfigured Runtime cannot dispatch a Skill');
    await instance.app.close();instance=undefined;
    instance=await launch();
    await instance.admin.waitForSelector('[data-skill="preview"]');
    assert.equal(await instance.admin.locator('[data-skill="enable"]').textContent(),'停用');
    assert.equal(await instance.admin.locator('[data-skill="run"]').isDisabled(),true);
    await instance.admin.locator('[data-skill="uninstall"]').click();
    await instance.admin.waitForFunction(()=>document.querySelector('[data-skill-list]').textContent.includes('尚未安装'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userData,'installed-skills.json'),'utf8')).entries,[]);
    assert.equal(fs.readFileSync(path.join(source,'SKILL.md'),'utf8'),original);
    assert.equal(fs.readFileSync(path.join(example,'SKILL.md'),'utf8'),original);
    console.log(JSON.stringify({state:'passed',main:'actual product',preload:'actual IPC',renderer:'actual admin',
      nativeDialogs:'explicit synthetic',runtimeConfigured:false,cloudCalls:0,sourceUnchanged:true,restart:true}));
  } finally {await instance?.app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
