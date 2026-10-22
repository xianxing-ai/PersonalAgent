// Isolated real Chromium DOM and CSS; host responses are explicit Synthetic fixtures.
// No Runtime, account, provider, tool or permission grant is started by this runner.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {_electron}=require('playwright');
(async()=>{
  const repo=path.resolve(process.env.PA_TEST_REPOSITORY||path.join(__dirname,'../../..'));
  const output=path.join(repo,'.cache/authorization-card-dom');fs.mkdirSync(output,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(output,'case-')),html=path.join(fixture,'index.html'),bootstrap=path.join(fixture,'bootstrap.cjs');
  const card=pathToFileURL(path.join(repo,'apps/desktop/src/features/conversation/authorization-question-card.js')).href;
  const legacy=pathToFileURL(path.join(repo,'apps/desktop/src/features/conversation/approval-card.js')).href;
  fs.writeFileSync(html,`<!doctype html><meta charset="utf-8"><title>Synthetic authorization card DOM</title>
  <style>body{margin:30px;font:14px system-ui;color:#242424;background:#fafafa}main{max-width:560px}</style><main id="questions"></main><main id="legacy"></main>
  <script type="module">
    import {mountAuthorizationQuestionCards} from ${JSON.stringify(card)};
    import {approvalCards,approvalResponse} from ${JSON.stringify(legacy)};
    const now=Date.parse('2030-10-21T02:00:00Z');
    const question={questionId:'synthetic-question',conversationId:'main',revision:2,state:'pending',
      title:'允许读取这份记录吗？',description:'Synthetic 读取记录，并将必要结果用于本次云端对话',toolName:'workspace.read_text',
      expiresAt:new Date(now+60000).toISOString(),canAlways:true,
      requirements:[{kind:'tool',summary:'读取 meeting.txt',scopes:['workspace:read']},
        {kind:'connector_session',summary:'访问本次选定的记录',scopes:['record:read']},
        {kind:'export',summary:'将记录摘要发送到 AgentArts',scopes:['cloud:context']}],
      sandbox:{label:'Synthetic 应用内受限权限',native:{required:false}}};
    window.calls=[];window.current=question;
    window.controls=mountAuthorizationQuestionCards(document.querySelector('#questions'),{now:()=>now,
      invoke:async(name,body)=>{window.calls.push({name,body});return {accepted:true,questionId:body.questionId,revision:window.current.revision+1,state:body.decision==='deny'?'denied':'allowed'};}});
    window.show=extra=>{window.current={...question,...extra};window.controls.update([window.current],{conversationId:'main'});};
    window.show({});
    const task={taskId:'legacy-task',state:'waiting_approval'},approval={approvalId:'legacy-approval',taskId:task.taskId,
      state:'pending',revision:5,action:'workspace.read_text',scopes:['workspace:read'],expiresAt:question.expiresAt};
    const legacyRoot=document.querySelector('#legacy');legacyRoot.innerHTML=approvalCards(task,[approval],now);
    legacyRoot.addEventListener('click',event=>{const button=event.target.closest('[data-approval-decision]');if(!button||button.disabled)return;
      window.calls.push({name:'authorization.respond',body:approvalResponse(button.dataset.approvalId,button.dataset.approvalDecision,[task],[approval],now)});
      for(const action of legacyRoot.querySelectorAll('button'))action.disabled=true;});
    window.ready=true;
  </script>`);
  fs.writeFileSync(bootstrap,`const {app,BrowserWindow,session}=require('electron');app.whenReady().then(()=>{
    session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,callback)=>callback({cancel:true}));
    const window=new BrowserWindow({width:720,height:850,show:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    window.loadFile(${JSON.stringify(html)});});app.on('window-all-closed',()=>app.quit());`);
  const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PATH','COMSPEC']
    .filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  const app=await _electron.launch({executablePath:process.env.PA_TEST_ELECTRON_EXE||path.join(repo,'node_modules/electron/dist/electron.exe'),
    args:['-r',path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/server/electron/loader.js'),bootstrap],env});
  const receipt={kind:'Synthetic real DOM only',models:0,accounts:0,tools:0,phases:[]};
  try {
    const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.name));await page.waitForFunction(()=>window.ready);
    const question=page.locator('#questions [data-question-id]').first(),details=question.locator('details');
    assert.deepEqual(await question.locator('button').allTextContents(),['同意','拒绝']);
    assert.equal(await question.locator('input,textarea,select').count(),0);assert.equal(await details.evaluate(node=>node.open),false);
    assert.equal(await question.getByText('workspace:read',{exact:true}).isVisible(),false);
    assert.equal(await question.getByText('Synthetic 读取记录，并将必要结果用于本次云端对话',{exact:true}).first().isVisible(),true);
    assert.equal(await question.getByText('将记录摘要发送到 AgentArts',{exact:true}).first().isVisible(),false);
    await page.screenshot({path:path.join(fixture,'01-compact.png')});
    await details.locator('summary').focus();await details.locator('summary').press('Enter');
    assert.equal(await details.evaluate(node=>node.open),true);
    assert.equal(await question.getByText('将记录摘要发送到 AgentArts',{exact:true}).first().isVisible(),true);
    await page.evaluate(()=>window.controls.update([window.current,{...window.current,questionId:'other'}]));
    assert.equal(await details.evaluate(node=>node.open),true);assert.equal(await details.locator('summary').evaluate(node=>node===document.activeElement),true);
    await page.evaluate(()=>window.show({}));
    const decidedButton=await question.locator('.authorization-question-primary').elementHandle();
    await question.locator('.authorization-question-primary').click();
    assert.deepEqual(await page.evaluate(()=>window.calls),[{name:'authorization.question.respond',body:{questionId:'synthetic-question',expectedRevision:2,decision:'allow_once'}}]);
    await page.locator('#questions [data-question-id="synthetic-question"]').waitFor({state:'detached'});
    await decidedButton.evaluate(node=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    assert.equal(await page.evaluate(()=>window.calls.length),1,'a late detached-button event cannot resubmit');
    await page.evaluate(()=>window.controls.update([window.current],{conversationId:'main'}));
    assert.equal(await page.locator('#questions [data-question-id]').count(),0,'an old pending snapshot cannot restore a decided card');
    receipt.phases.push('compact-two-buttons','details-keyboard-and-progress-focus','one-click-once-and-duplicate-suppression');
    await page.evaluate(()=>window.show({questionId:'task-reuse',revision:4,canReuseTask:true,suggestedDecision:'allow_task'}));
    await question.locator('.authorization-question-primary').focus();await question.locator('.authorization-question-primary').press('Enter');
    assert.deepEqual(await page.evaluate(()=>window.calls.at(-1).body),{questionId:'task-reuse',expectedRevision:4,decision:'allow_task'});
    await page.locator('#questions [data-question-id="task-reuse"]').waitFor({state:'detached'});
    await page.evaluate(()=>window.show({questionId:'deny-reuse',revision:6,canReuseTask:true,suggestedDecision:'allow_task'}));
    await question.locator('[data-authorization-decision="deny"]').click();
    assert.deepEqual(await page.evaluate(()=>window.calls.at(-1).body),{questionId:'deny-reuse',expectedRevision:6,decision:'deny'});
    await page.locator('#questions [data-question-id="deny-reuse"]').waitFor({state:'detached'});
    await page.evaluate(()=>window.show({questionId:'fallback',canReuseTask:false,suggestedDecision:'allow_task'}));
    assert.equal(await question.locator('.authorization-question-primary').getAttribute('data-authorization-decision'),'allow_once');
    receipt.phases.push('trusted-task-default','one-click-deny','untrusted-task-default-falls-back');
    assert.deepEqual(await page.locator('#legacy button').allTextContents(),['同意','拒绝']);
    assert.equal(await page.locator('#legacy details').evaluate(node=>node.open),false);
    await page.locator('#legacy [data-approval-decision="allow_once"]').click();
    assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{name:'authorization.respond',body:{approvalId:'legacy-approval',decision:'allow_once',expectedRevision:5,taskId:'legacy-task'}});
    receipt.phases.push('legacy-exact-binding');
    assert.deepEqual(errors,[]);receipt.state='passed';receipt.consoleErrors=errors;
    await page.screenshot({path:path.join(fixture,'02-decisions.png')});
    fs.writeFileSync(path.join(fixture,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({...receipt,evidenceDirectory:fixture}));
  } finally {await app.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
