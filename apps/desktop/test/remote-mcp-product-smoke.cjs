const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {_electron}=require('playwright');
const {closeDesktop,trackOwnedDesktop,evaluateBounded}=require('../../../tests/manual/agentarts/desktop-pelican-default-live.cjs');
async function waitFor(read,reason){const deadline=Date.now()+15000;
  while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}
  throw Error('Timed out: '+reason);}
async function snapshot(page){const response=await page.evaluate(()=>window.desktop.invoke('snapshot'));assert.equal(response.ok,true,response.error);return response.value;}
(async()=>{
  const {fixture,descriptor,directory}=await import('../../../packages/mcp/test/remote-http-fixture.mjs');
  const {remoteMcpDirectoryDigest}=await import('@personal-agent/mcp');
  const {authorizationQuestionDefaultDecision}=await import('../src/features/conversation/authorization-question-card.js');
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
  const negativeCases=[],attempts=[],questionDecisions=[],pageErrors=[];
  async function open(runtimeReady=true){
    const selectedEnvironment={...environment};if(!runtimeReady){delete selectedEnvironment.PA_AGENTARTS_GATEWAY_URL;delete selectedEnvironment.PA_AGENTARTS_RUNTIME_NAME;}
    const started=Date.now(),attempt={runtimeReady};attempts.push(attempt);
    const app=await _electron.launch({executablePath,args:[path.resolve(__dirname,'remote-mcp-product-fixture.mjs')],env:selectedEnvironment});
    try{
      trackOwnedDesktop(app,{executablePath,mainProcessId:await evaluateBounded(app,()=>process.pid)},attempt,started);
      app.context().setDefaultTimeout(15000);app.on('window',page=>page.on('pageerror',error=>pageErrors.push(error.message)));
      await app.firstWindow();await app.evaluate(({dialog},selected)=>{
        dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});
        dialog.showMessageBox=async(_window,options)=>{globalThis.lastMcpDialog=options;return {response:1};};
      },definitionFile);
      let admin;for(let i=0;i<200;i++){admin=app.windows().find(page=>page.url().includes('mode=admin'));if(admin)break;await new Promise(r=>setTimeout(r,50));}
      assert.ok(admin,'actual Competition admin is reachable without cloud credentials');
      await admin.locator('#remote-mcp-manage').click();let page;
      for(let i=0;i<100;i++){page=app.windows().find(page=>page.url().includes('/remote-mcp/index.html'));if(page)break;await new Promise(r=>setTimeout(r,50));}
      assert.ok(page);await page.waitForSelector('#status',{state:'attached'});
      await waitFor(async()=>{if(pageErrors.length)throw Error('Observed renderer failure: '+pageErrors.join(' | '));
        return page.locator('#status').textContent().then(value=>value.length>0);},'management status initialization');
      assert.equal(await page.locator('#approve,#deny').count(),0,'management must not offer a second authorization path');
      return {app,admin,page,attempt};
    }catch(error){console.error('Primary launch failure:',error);await closeDesktop(app).catch(cleanup=>console.error('Owned cleanup failure:',cleanup));throw error;}
  }
  async function close({allowPendingTermination=false}={}){const counts=await instance.app.evaluate(()=>globalThis.remoteMcpSmoke);
    unexpectedRequests+=counts.unexpectedRequests;mcpRequests+=counts.mcpRequests;const closing=instance;await closeDesktop(closing.app);instance=undefined;
    if(allowPendingTermination)assert.ok(['graceful','verified-owned-tree'].includes(closing.attempt.cleanup.method));
    else assert.equal(closing.attempt.cleanup.method,'graceful');}
  async function choose(decision,{taskId}={}){
    const panel=await waitFor(()=>instance.app.windows().find(page=>page.url().includes('mode=panel')),'original question conversation');
    const question=await waitFor(async()=>(await snapshot(panel)).authorizationQuestions.find(item=>item.state==='pending'
      &&(!taskId||item.taskId===taskId)&&!questionDecisions.some(saved=>saved.questionId===item.questionId)),'original pending question');
    if(!taskId)assert.equal(question.toolName,'desktop.authorization.intent');
    assert.equal(JSON.stringify(question).includes(token),false);assert.ok(Date.parse(question.expiresAt)>Date.now());
    const card=panel.locator(`[data-question-id="${question.questionId}"]`);await card.waitFor({state:'visible'});
    assert.equal((await card.innerText()).includes(token),false);
    const selectedDecision=decision==='deny'?'deny':authorizationQuestionDefaultDecision(question);
    assert.ok(['allow_once','allow_task','deny'].includes(selectedDecision),'the test must not select persistent automatic permission');
    await card.locator(`[data-authorization-decision="${selectedDecision}"]`).click();
    await waitFor(async()=>!(await snapshot(panel)).authorizationQuestions.some(item=>item.questionId===question.questionId&&item.state==='pending'),'original question settlement');
    questionDecisions.push({questionId:question.questionId,taskId:question.taskId,toolName:question.toolName,decision:selectedDecision});
    return {panel,question};
  }
  async function connect(decision='allow_once'){await instance.page.locator('#connect').click();return choose(decision);}
  async function revoke(){await instance.page.locator('#revoke').click();await choose('allow_once');}
  async function save(page){
    await page.locator('#import').click();await page.waitForFunction(()=>document.getElementById('definition').textContent.includes('synthetic-reference'));
    await page.locator('#token').fill(token);await page.locator('#expires').fill(new Date(Date.now()+3600000).toISOString());
    await page.locator('#save').click();await choose('allow_once');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('重启'));
    assert.equal(await page.locator('#token').inputValue(),'');
  }
  let primaryFailure;
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
    await connect('deny');await page.waitForFunction(()=>document.getElementById('error').textContent.length>0);assert.equal(f.requests.length,before);
    await connect();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已连接'));assert.equal(f.calls().length,0);
    await page.locator('#arguments').fill(JSON.stringify({key:'public'}));
    try{await page.locator('#submit').click();}
    catch(error){
      const runtime=await admin.evaluate(async()=>{const response=await window.desktop.invoke('snapshot'),value=response.value??response;return {connection:value.connection,error:value.connectionError};});
      throw new Error('MCP Runtime unavailable: '+JSON.stringify(runtime),{cause:error});
    }
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('waiting_approval'));const first=await page.locator('#task-id').inputValue();
    assert.equal(f.calls().length,0);
    await page.locator('#review-question').click();
    assert.match(await page.locator('#task-result').textContent(),/waiting_approval/);assert.equal(f.calls().length,0,'opening the card cannot grant a call');
    await choose('allow_once',{taskId:first});
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('succeeded'));assert.equal(f.calls().length,1);
    assert.equal(await page.locator('#task-result img').count(),0);assert.equal(await page.evaluate(()=>window.injected===true),false);
    const result=await page.locator('#task-result').textContent();assert.equal(result.includes(token),false);assert.match(result,/evidenceRefs/);
    await page.locator('#disconnect').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('默认断开'));
    assert.equal(await page.locator('#submit').isDisabled(),true);assert.equal(f.calls().length,1);
    await connect();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已连接'));
    await page.locator('#submit').click();await page.waitForFunction(id=>document.getElementById('task-id').value!==id,first);
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('waiting_approval'));
    const denied=await page.locator('#task-id').inputValue();await page.locator('#review-question').click();await choose('deny',{taskId:denied});
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('cancelled'));assert.equal(f.calls().length,1);
    const deniedDatabase=new DatabaseSync(path.join(userData,'runtime.sqlite'),{readOnly:true});let deniedRecord;
    try{
      assert.equal(deniedDatabase.prepare('SELECT state FROM tasks WHERE task_id=?').get(denied).state,'cancelled');
      const records=deniedDatabase.prepare('SELECT record_json FROM tool_execution_records WHERE task_id=?').all(denied).map(row=>JSON.parse(row.record_json));
      assert.equal(records.length,1);assert.equal(records[0].executionStarted,false);assert.equal(records[0].policyDecision,'deny');
      deniedRecord={taskId:denied,state:'cancelled',executionStarted:false,errorCode:records[0].errorCode};
    }finally{deniedDatabase.close();}
    await page.locator('#submit').click();await page.waitForFunction(id=>document.getElementById('task-id').value!==id,first);
    await page.waitForFunction(id=>document.getElementById('task-id').value!==id,denied);
    await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('waiting_approval'));const pending=await page.locator('#task-id').inputValue();
    const originalPanel=app.windows().find(candidate=>candidate.url().includes('mode=panel'));
    const pendingQuestion=await waitFor(async()=>(await snapshot(originalPanel)).authorizationQuestions.find(item=>item.taskId===pending&&item.state==='pending'),'pending question before controlled restart');
    const pendingExpiresAt=pendingQuestion.expiresAt;
    await page.screenshot({path:path.join(folder,'management.png'),fullPage:true});await close({allowPendingTermination:true});
    const baseline=f.requests.length;instance=await open();({app,page}=instance);assert.equal(f.requests.length,baseline);
    await page.locator('#task-id').fill(first);await page.locator('#read-task').click();await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('succeeded'));assert.equal(f.calls().length,1);
    await connect();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已连接'));
    await page.locator('#task-id').fill(pending);await page.locator('#read-task').click();await page.waitForFunction(()=>document.getElementById('task-result').textContent.includes('failed'));
    assert.ok(Date.parse(pendingExpiresAt)>Date.now(),'the old session must be rejected before its original approval expires');
    assert.equal(await page.locator('#review-question').isDisabled(),true);assert.equal(f.calls().length,1,'old session question cannot call MCP');
    const resumedDatabase=new DatabaseSync(path.join(userData,'runtime.sqlite'),{readOnly:true});let pendingRestart;
    try{
      const original=resumedDatabase.prepare('SELECT state,error_json FROM tasks WHERE task_id=?').get(pending);
      assert.equal(original.state,'failed');assert.equal(JSON.parse(original.error_json).code,'REVISION_CONFLICT');
      const records=resumedDatabase.prepare('SELECT record_json FROM tool_execution_records WHERE task_id=?').all(pending).map(row=>JSON.parse(row.record_json));
      assert.equal(records.length,1);assert.equal(records[0].executionStarted,false);assert.equal(records[0].errorCode,'REVISION_CONFLICT');
      pendingRestart={taskId:pending,beforeState:'waiting_approval',afterState:original.state,errorCode:'REVISION_CONFLICT',
        executionStarted:false,originalExpiresAt:pendingExpiresAt,cleanupMethod:attempts[1].cleanup.method};
    }finally{resumedDatabase.close();}
    await revoke();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('未配置'));
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
        await connect();await negativePage.waitForFunction(()=>document.getElementById('error').textContent.length>0);
        const error=await negativePage.locator('#error').textContent();assert.equal(error.includes(token),false);
        const errorCode=mode==='directory-mismatch'?'REVISION_CONFLICT':'EXTERNAL_FAILURE';assert.ok(error.includes(errorCode),mode+' must fail at the expected transport/directory boundary');
        assert.equal(await negativePage.locator('#submit').isDisabled(),true);assert.equal(service.calls().length,0);
        if(['untrusted-ca','hostname-mismatch'].includes(mode))assert.equal(service.requests.length,0,'TLS rejects before HTTP headers');
        assert.equal(f.requests.length,destinationRequests,'a redirect cannot forward any request or credential to the destination');
        assert.equal(f.calls().length,1);await revoke();
        await negativePage.waitForFunction(()=>document.getElementById('status').textContent.includes('未配置'));
        assert.equal(fs.existsSync(path.join(environment.PA_USER_DATA_DIR,'remote-mcp-config.json')),false);await close();
        negativeCases.push({mode,errorCode,toolCalls:service.calls().length,httpRequests:service.requests.length});
      }finally{if(instance)await close().catch(error=>console.error('Owned negative-case cleanup failure:',error));await service.close();}
    }
    assert.equal(unexpectedRequests,0,'no non-MCP request attempted');assert.ok(mcpRequests>0,'default fetch requests must be observed');
    assert.ok(f.requests.filter(request=>request.method==='POST').every(request=>request.headers.authorization==='Bearer '+token));
    assert.deepEqual(pageErrors,[]);
    const receipt={status:'passed',profile:'huawei_ict_agentarts',main:'actual product',renderer:'actual isolated management and conversation cards',safeStorage:'actual Electron',
      nativeDialogs:'explicit synthetic directory and message dialogs; actual conversation decisions',remoteTransport:'actual loopback HTTPS/TLS, default fetch',reopens:2,negativeCases,
      approvalBeforeCall:true,mcpToolCalls:f.calls().length,connectionDeniedBeforeNetwork:true,taskDenied:true,disconnect:true,
      oldApprovalRejected:true,oldApprovalRejectedBeforeExpiry:true,pendingRestart,deniedRecord,ciphertextRemoved:true,questionDecisions,attempts,pageErrors,unexpectedRequests,systemTrustChanged:false,tlsVerificationDisabled:false,modelCalls:0,agentArtsCalls:0};
    fs.writeFileSync(path.join(folder,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }catch(error){primaryFailure=error;console.error('Primary acceptance failure:',error);throw error;}
  finally{if(instance)await close({allowPendingTermination:Boolean(primaryFailure)}).catch(error=>console.error('Owned cleanup failure:',error));await f.close();
    if(primaryFailure)fs.writeFileSync(path.join(folder,'failure.json'),JSON.stringify({stage:'product_acceptance',error:String(primaryFailure.stack??primaryFailure),pageErrors,attempts},null,2)+'\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
