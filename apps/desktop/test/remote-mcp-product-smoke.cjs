const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {_electron}=require('playwright');
(async()=>{
  const {fixture,descriptor,directory}=await import('../../../packages/mcp/test/remote-http-fixture.mjs');
  const {remoteMcpDirectoryDigest}=await import('@personal-agent/mcp');
  const cache=path.resolve(__dirname,'../../../.cache/remote-mcp-product');fs.mkdirSync(cache,{recursive:true});
  const folder=fs.mkdtempSync(path.join(cache,'case-')),userData=path.join(folder,'user-data'),definitionFile=path.join(folder,'service.json');
  const environment=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PATH','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  function certificate(name,san){
    const key=path.join(folder,name+'-key.pem'),cert=path.join(folder,name+'-cert.pem');
    execFileSync(process.env.PA_TEST_OPENSSL??'openssl',['req','-x509','-newkey','rsa:2048','-noenc','-days','1',
      '-subj','/CN=PersonalAgent Synthetic Desktop TLS','-addext','basicConstraints=critical,CA:TRUE',
      '-addext','subjectAltName='+san,'-keyout',key,'-out',cert],{env:environment,stdio:'ignore',windowsHide:true,timeout:30000});
    return {options:{key:fs.readFileSync(key),cert:fs.readFileSync(cert)},file:cert};
  }
  const trusted=certificate('trusted','IP:127.0.0.1'),wrongHost=certificate('wrong-host','DNS:wrong.invalid');
  const token='synthetic-product-token-only';
  const f=await fixture({tls:trusted.options,requiredAuthorization:`Bearer ${token}`,result:{structuredContent:{text:'<img src=x onerror="window.injected=true"> synthetic result'},content:[{type:'text',text:'synthetic result'}]}});
  const definition={endpoint:f.secureEndpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor:{...descriptor,version:'2.0.0'}},directoryDigest:remoteMcpDirectoryDigest(directory())};
  fs.writeFileSync(definitionFile,JSON.stringify(definition));
  Object.assign(environment,{PA_RUNTIME_PROFILE:'huawei_ict_agentarts',PA_USER_DATA_DIR:userData,
    PA_AGENTARTS_GATEWAY_URL:'https://synthetic.huaweicloud-agentarts.com',PA_AGENTARTS_RUNTIME_NAME:'synthetic-no-cloud-call',
    PA_MCP_SMOKE_ENDPOINT:f.secureEndpoint,NODE_EXTRA_CA_CERTS:trusted.file});
  const executablePath=process.env.PA_MCP_SMOKE_ELECTRON || path.resolve(__dirname,'../../../node_modules/electron/dist/electron.exe');
  let instance;let unexpectedRequests=0,mcpRequests=0;
  const negativeCases=[];
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
  async function close(){const counts=await instance.app.evaluate(()=>globalThis.remoteMcpSmoke);unexpectedRequests+=counts.unexpectedRequests;mcpRequests+=counts.mcpRequests;await instance.app.close();instance=undefined;}
  async function save(page){
    await page.locator('#import').click();await page.waitForFunction(()=>document.getElementById('definition').textContent.includes('synthetic-reference'));
    await page.locator('#token').fill(token);await page.locator('#expires').fill(new Date(Date.now()+3600000).toISOString());
    await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('重启'));
    assert.equal(await page.locator('#token').inputValue(),'');
  }
  try{
    instance=await open(false);let {app,admin,page}=instance;
    assert.equal(await page.locator('#submit').isDisabled(),true);assert.match(await page.locator('#status').textContent(),/Runtime 未初始化/);
    const orb=app.windows().find(page=>page.url().includes('mode=orb'));
    assert.equal((await orb.evaluate(()=>window.desktop.invoke('remoteMcp.open'))).ok,false);
    assert.equal((await admin.evaluate(()=>window.desktop.invoke('remoteMcp.open',{unexpected:true}))).ok,false);
    assert.equal(await admin.evaluate(()=>typeof window.remoteMcp),'undefined');
    await save(page);assert.equal(f.requests.length,0);
    assert.equal(await page.locator('#connect').isDisabled(),true);
    const ciphertext=fs.readFileSync(path.join(userData,'remote-mcp-config.json'),'utf8');assert.equal(ciphertext.includes(token),false);assert.equal(ciphertext.includes(definition.endpoint),false);
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
    assert.equal(f.calls().length,0);
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
    await page.locator('#approve').click();await page.waitForFunction(()=>!document.getElementById('approve').disabled);
    assert.match(await page.locator('#task-result').textContent(),/waiting_approval/);assert.equal(f.calls().length,0);
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
    await page.locator('#approve').click();
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('succeeded'));assert.equal(f.calls().length,1);
    assert.equal(await page.locator('#task-result img').count(),0);assert.equal(await page.evaluate(()=>window.injected===true),false);
    const result=await page.locator('#task-result').textContent();assert.equal(result.includes(token),false);assert.match(result,/evidenceRefs/);
    await page.locator('#disconnect').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('默认断开'));
    assert.equal(await page.locator('#submit').isDisabled(),true);assert.equal(f.calls().length,1);
    await page.locator('#connect').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已连接'));
    await page.locator('#submit').click();await page.waitForFunction(id=>document.getElementById('task-id').value!==id,first);
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('waiting_approval'));
    const denied=await page.locator('#task-id').inputValue();await page.locator('#deny').click();
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('cancelled'));assert.equal(f.calls().length,1);
    await page.locator('#submit').click();await page.waitForFunction(id=>document.getElementById('task-id').value!==id,first);
    await page.waitForFunction(id=>document.getElementById('task-id').value!==id,denied);
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
    await close();
    const destinationRequests=f.requests.length;
    for(const mode of ['untrusted-ca','hostname-mismatch','directory-mismatch','redirect']){
      const tls=mode==='hostname-mismatch'?wrongHost:trusted;
      const service=await fixture({tls:tls.options,requiredAuthorization:'Bearer '+token,
        ...(mode==='redirect'?{status:307,location:f.secureEndpoint}:{})});
      try{
        environment.PA_USER_DATA_DIR=path.join(folder,mode);environment.PA_MCP_SMOKE_ENDPOINT=service.secureEndpoint;
        if(mode==='untrusted-ca')delete environment.NODE_EXTRA_CA_CERTS;else environment.NODE_EXTRA_CA_CERTS=tls.file;
        fs.writeFileSync(definitionFile,JSON.stringify({...definition,endpoint:service.secureEndpoint,
          directoryDigest:mode==='directory-mismatch'?'0'.repeat(64):definition.directoryDigest}));
        instance=await open(false);await save(instance.page);assert.equal(service.requests.length,0);await close();
        instance=await open();const negativePage=instance.page;
        await negativePage.locator('#connect').click();await negativePage.waitForFunction(()=>document.getElementById('error').textContent.length>0);
        const error=await negativePage.locator('#error').textContent();assert.equal(error.includes(token),false);
        const errorCode=mode==='directory-mismatch'?'REVISION_CONFLICT':'EXTERNAL_FAILURE';assert.ok(error.includes(errorCode),mode+' must fail at the expected transport/directory boundary');
        assert.equal(await negativePage.locator('#submit').isDisabled(),true);assert.equal(service.calls().length,0);
        if(['untrusted-ca','hostname-mismatch'].includes(mode))assert.equal(service.requests.length,0,'TLS rejects before HTTP headers');
        assert.equal(f.requests.length,destinationRequests,'a redirect cannot forward any request or credential to the destination');
        assert.equal(f.calls().length,1);await negativePage.locator('#revoke').click();
        await negativePage.waitForFunction(()=>document.getElementById('status').textContent.includes('未配置'));
        assert.equal(fs.existsSync(path.join(environment.PA_USER_DATA_DIR,'remote-mcp-config.json')),false);await close();
        negativeCases.push({mode,errorCode,toolCalls:service.calls().length,httpRequests:service.requests.length});
      }finally{await instance?.app.close();instance=undefined;await service.close();}
    }
    assert.equal(unexpectedRequests,0,'no non-MCP request attempted');assert.ok(mcpRequests>0,'default fetch requests must be observed');
    assert.ok(f.requests.filter(request=>request.method==='POST').every(request=>request.headers.authorization==='Bearer '+token));
    const receipt={status:'passed',profile:'huawei_ict_agentarts',main:'actual product',renderer:'actual isolated management',safeStorage:'actual Electron',
      nativeDialogs:'explicit synthetic responses',remoteTransport:'actual loopback HTTPS/TLS, default fetch',successRestarts:2,negativeCases,
      approvalBeforeCall:true,mcpToolCalls:f.calls().length,approvalCancelled:true,taskDenied:true,disconnect:true,
      oldApprovalRejected:true,ciphertextRemoved:true,unexpectedRequests,systemTrustChanged:false,tlsVerificationDisabled:false,modelCalls:0,agentArtsCalls:0};
    fs.writeFileSync(path.join(folder,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }finally{await instance?.app.close();await f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
