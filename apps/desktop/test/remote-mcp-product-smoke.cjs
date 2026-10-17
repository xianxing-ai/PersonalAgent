const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
  const {fixture,endpoint,descriptor,directory}=await import('../../../packages/mcp/test/remote-http-fixture.mjs');
  const {remoteMcpDirectoryDigest}=await import('@personal-agent/mcp');
  const cache=path.resolve(__dirname,'../../../.cache/remote-mcp-product');fs.mkdirSync(cache,{recursive:true});
  const folder=fs.mkdtempSync(path.join(cache,'case-')),userData=path.join(folder,'user-data'),definitionFile=path.join(folder,'service.json');
  const definition={endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor:{...descriptor,version:'2.0.0'}},directoryDigest:remoteMcpDirectoryDigest(directory())};
  fs.writeFileSync(definitionFile,JSON.stringify(definition));const token='synthetic-product-token-only';
  const f=await fixture({requiredAuthorization:`Bearer ${token}`,result:{structuredContent:{text:'<img src=x onerror="window.injected=true"> synthetic result'},content:[{type:'text',text:'synthetic result'}]}});
  const environment=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PATH','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  Object.assign(environment,{PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_USER_DATA_DIR:userData,
    PA_AGENTARTS_GATEWAY_URL:'https://synthetic.huaweicloud-agentarts.com',PA_AGENTARTS_RUNTIME_NAME:'synthetic-no-cloud-call',PA_MCP_SMOKE_LOOPBACK:f.loopbackEndpoint});
  const executablePath=process.env.PA_MCP_SMOKE_ELECTRON || path.resolve(__dirname,'../../../node_modules/electron/dist/electron.exe');
  let instance;let totalBlocked=0;
  async function open(runtimeReady=true){
    const selectedEnvironment={...environment};if(!runtimeReady){delete selectedEnvironment.PA_AGENTARTS_GATEWAY_URL;delete selectedEnvironment.PA_AGENTARTS_RUNTIME_NAME;}
    const app=await _electron.launch({executablePath,args:[path.resolve(__dirname,'remote-mcp-product-fixture.mjs')],env:selectedEnvironment});
    try{
      await app.firstWindow();await app.evaluate(({dialog},selected)=>{
        dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});
        dialog.showMessageBox=async(_window,options)=>{globalThis.lastMcpDialog=options;return {response:1};};
      },definitionFile);
      let admin;for(let i=0;i<200;i++){admin=app.windows().find(page=>page.url().includes('mode=admin'));if(admin)break;await new Promise(r=>setTimeout(r,50));}
      assert.ok(admin,'actual Competition admin is reachable without cloud credentials');
      await admin.locator('#remote-mcp-manage').click();let page;
      for(let i=0;i<100;i++){page=app.windows().find(page=>page.url().includes('/remote-mcp/index.html'));if(page)break;await new Promise(r=>setTimeout(r,50));}
      assert.ok(page);await page.waitForSelector('#status');await page.waitForFunction(()=>document.getElementById('status').textContent.length>0);
      return {app,admin,page};
    }catch(error){await app.close();throw error;}
  }
  async function close(){const counts=await instance.app.evaluate(()=>globalThis.remoteMcpSmoke);totalBlocked+=counts.blockedOtherRequests;await instance.app.close();instance=undefined;}
  try{
    instance=await open(false);let {app,admin,page}=instance;
    assert.equal(await page.locator('#submit').isDisabled(),true);assert.match(await page.locator('#status').textContent(),/Runtime 未初始化/);
    const orb=app.windows().find(page=>page.url().includes('mode=orb'));
    assert.equal((await orb.evaluate(()=>window.desktop.invoke('remoteMcp.open'))).ok,false);
    assert.equal((await admin.evaluate(()=>window.desktop.invoke('remoteMcp.open',{unexpected:true}))).ok,false);
    assert.equal(await admin.evaluate(()=>typeof window.remoteMcp),'undefined');
    await page.locator('#import').click();await page.waitForFunction(()=>document.getElementById('definition').textContent.includes('synthetic-reference'));
    await page.locator('#token').fill(token);await page.locator('#expires').fill(new Date(Date.now()+3600000).toISOString());
    await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('重启'));
    assert.equal(await page.locator('#token').inputValue(),'');assert.equal(f.requests.length,0);
    assert.equal(await page.locator('#connect').isDisabled(),true);
    const ciphertext=fs.readFileSync(path.join(userData,'remote-mcp-config.json'),'utf8');assert.equal(ciphertext.includes(token),false);assert.equal(ciphertext.includes(endpoint),false);
    const general=await admin.evaluate(()=>window.desktop.invoke('snapshot'));assert.equal(JSON.stringify(general).includes(token),false);
    await close();instance=await open();({app,admin,page}=instance);
    const before=f.requests.length;await page.waitForFunction(()=>document.getElementById('status').textContent.includes('默认断开'));assert.equal(f.requests.length,before);
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
    await page.locator('#connect').click();await page.waitForFunction(()=>document.getElementById('error').textContent.length>0);assert.equal(f.requests.length,before);
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async(_window,options)=>{globalThis.lastMcpDialog=options;return {response:1};};});
    await page.locator('#connect').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已连接'));assert.equal(f.calls().length,0);
    assert.equal((await app.evaluate(()=>globalThis.lastMcpDialog.detail)).includes(token),false);
    await page.locator('#arguments').fill(JSON.stringify({key:'public'}));await page.locator('#submit').click();
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('waiting_approval'));const first=await page.locator('#task-id').inputValue();
    assert.equal(f.calls().length,0);await page.locator('#approve').click();
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('succeeded'));assert.equal(f.calls().length,1);
    assert.equal(await page.locator('#task-result img').count(),0);assert.equal(await page.evaluate(()=>window.injected===true),false);
    await page.locator('#submit').click();await page.waitForFunction(id=>document.getElementById('task-id').value!==id,first);
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('waiting_approval'));const pending=await page.locator('#task-id').inputValue();
    await page.screenshot({path:path.join(folder,'management.png'),fullPage:true});await close();
    const baseline=f.requests.length;instance=await open();({app,page}=instance);assert.equal(f.requests.length,baseline);
    await page.locator('#task-id').fill(first);await page.locator('#read-task').click();await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('succeeded'));assert.equal(f.calls().length,1);
    await page.locator('#connect').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已连接'));
    await page.locator('#task-id').fill(pending);await page.locator('#read-task').click();await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('waiting_approval'));
    await page.locator('#approve').click();await page.waitForFunction(()=>document.getElementById('error').textContent.length>0);assert.equal(f.calls().length,1,'old session approval cannot call MCP');
    await page.locator('#deny').click();await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('cancelled'));
    await page.locator('#revoke').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('未配置'));
    assert.equal(fs.existsSync(path.join(userData,'remote-mcp-config.json')),false);assert.equal(await page.locator('#submit').isDisabled(),true);
    await close();assert.equal(totalBlocked,0,'no non-MCP request even attempted');
    console.log(JSON.stringify({status:'passed',profile:'huawei_ict_agentarts',main:'actual product',renderer:'actual isolated management',safeStorage:'actual Electron',
      nativeDialogs:'explicit synthetic responses',remoteTransport:'synthetic loopback HTTP',restarts:2,approvalBeforeCall:true,mcpToolCalls:f.calls().length,
      oldApprovalRejected:true,ciphertextRemoved:true,modelCalls:0,agentArtsCalls:0}));
  }finally{await instance?.app.close();await f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
