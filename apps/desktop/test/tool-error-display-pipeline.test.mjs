import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {TaskRuntime} from '@personal-agent/runtime';
import {ToolGateway} from '@personal-agent/tool-gateway';
import {ProtocolError} from '@personal-agent/contracts';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {errorDisplay,errorDisplayText} from '../src/shared/error-display.js';

const future=()=>new Date(Date.now()+60000).toISOString();
test('every public Error code crosses the actual Gateway and Desktop consumer without cause loss',async()=>{
  const schema=JSON.parse(await readFile(new URL('../../../packages/contracts/schema/protocol.json',import.meta.url),'utf8'));
  const codes=schema.definitions.Error.properties.code.enum;
  for(const sideEffect of ['read','external_write'])for(const code of codes){
    const policy=new InMemoryAuthorizationPolicy();
    policy.grant({authorizationRef:'grant',taskId:'task',toolName:'synthetic.code',scopes:['synthetic:read'],expiresAt:future()});
    const gateway=new ToolGateway({policy});let calls=0;
    gateway.register({descriptor:{name:'synthetic.code',version:'1',inputSchema:{type:'object'},outputSchema:{type:'object'},sideEffect,requiredScopes:['synthetic:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false},execute:async()=>{
      calls++;throw new ProtocolError(code,'Bearer synthetic-secret /private/mail/body.eml private mail body',true,2000);
    }});
    await assert.rejects(gateway.invoke({toolName:'synthetic.code',toolVersion:'1',arguments:{},taskId:'task',runId:'run',authorizationRef:'grant',deadline:future(),signal:new AbortController().signal}),error=>{
      assert.equal(error.code,sideEffect==='read'?code:'RESULT_UNKNOWN',`${sideEffect}/${code}`);
      assert.equal(error.retryable,sideEffect==='read');assert.equal(error.retryAfterMs,sideEffect==='read'?2000:undefined);
      assert.match(error.message,new RegExp(`cause=${code}\\]`));
      const displayed=errorDisplay(error,'task');
      assert.equal(displayed.code,error.code);assert.match(displayed.message,new RegExp(`cause=${code}\\]`));
      assert.doesNotMatch(displayed.message,/synthetic-secret|private mail body|\/private/);
      assert.equal(errorDisplayText(displayed),displayed.message);
      if(code==='RATE_LIMITED')assert.match(displayed.message,/频率或配额受限/);
      if(code==='CURSOR_EXPIRED')assert.match(displayed.message,/分页游标已过期/);
      if(sideEffect==='external_write')assert.match(displayed.message,/请勿重复提交同一操作/);
      return true;
    });assert.equal(calls,1);
  }
});
test('controlled write exception crosses actual Gateway, SQLite Runtime and production workspace UI without replay or private data',
  {skip:process.env.PA_ERROR_DISPLAY_UI_TEST!=='1',timeout:30000},async t=>{
  const cache=fileURLToPath(new URL('../../../.cache/error-display/',import.meta.url));mkdirSync(cache,{recursive:true});
  let calls=0;
  const descriptor={name:'synthetic.write',version:'1',inputSchema:{type:'object'},outputSchema:{type:'object'},sideEffect:'external_write',requiredScopes:['synthetic:write'],idempotencySupport:true,recoverySupport:true,requiresPresence:false};
  const runtime=new TaskRuntime(join(mkdtempSync(join(cache,'case-')),'runtime.sqlite'),{createToolGateway:policy=>{
    const gateway=new ToolGateway({policy});gateway.register({descriptor,execute:async()=>{
      calls++;throw Object.assign(Error('Bearer synthetic-secret /private/mail/body.eml private mail body'),{code:'EACCES'});
    }});return gateway;
  }});t.after(()=>runtime.close());
  const task=runtime.submitTask({goal:'Synthetic write',conversationId:'synthetic',idempotencyKey:'task'});
  runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
  runtime.policy.grant({authorizationRef:'grant',taskId:task.taskId,toolName:descriptor.name,scopes:descriptor.requiredScopes,expiresAt:future(),maxUses:1});
  const request={kind:'request',protocolVersion:'1.0.0',requestId:crypto.randomUUID(),taskId:task.taskId,idempotencyKey:'original-operation',deadline:future(),operation:'tool.invoke',payload:{toolName:descriptor.name,toolVersion:'1',arguments:{},scopeRef:'grant'}};
  await runtime.send(request,new AbortController().signal);
  await runtime.send({...request,requestId:crypto.randomUUID()},new AbortController().signal);
  const original=runtime.getTask(task.taskId);
  assert.equal(original.state,'waiting_reconciliation');assert.equal(calls,1);
  assert.equal(runtime.readToolExecutions(task.taskId)[0].state,'unknown');
  const visible={...original,error:{...original.error,...errorDisplay(original.error,'task')},userMessage:'Synthetic write'};
  assert.match(visible.error.message,/stage=execute; code=RESULT_UNKNOWN; cause=EACCES/);
  assert.match(visible.error.message,/访问被拒绝/);assert.doesNotMatch(JSON.stringify(visible),/synthetic-secret|private mail body|\/private/);
  const source=resolve(fileURLToPath(new URL('../src',import.meta.url)));
  const state={tasks:[visible],subagentTasks:[],modelChoices:[],capabilities:[],health:[],notifications:[],thinking:{depth:1,fast:false},conversationState:{activeId:'synthetic',draft:'',sessions:[{id:'synthetic',title:'Synthetic'}]}};
  const html=`<!doctype html><html data-calm="true"><head><meta charset="utf-8"><title>Tool failure pipeline</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/ui/tokens.css"><link rel="stylesheet" href="/app/style.css"><link rel="stylesheet" href="/app/surfaces.css"><link rel="stylesheet" href="/app/interaction.css"><link rel="stylesheet" href="/app/panel-glass.css"><link rel="stylesheet" href="/app/command-center.css"></head><body><main id="root"></main><script type="module">
    import {mountWorkspace} from '/features/workspace/view.js';
    const state=${JSON.stringify(state)};
    const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    window.update=mountWorkspace(document.querySelector('#root'),async name=>{if(name==='capability.list')throw Object.assign(Error('Bearer synthetic-secret'),{code:'ECONNREFUSED'});return {};},escape);
    window.update(state);window.ready=true;
  </script></body></html>`;
  const server=createServer(async(req,res)=>{const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
    const path=resolve(source,'.'+pathname);if(!path.startsWith(source+sep)){res.writeHead(403);res.end();return;}
    try{res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':'text/css');res.end(await readFile(path));}catch{
      // Existing production modules also import the desktop-wide shared folder.
      if(pathname==='/shared/thinking-selection.js'){res.end(await readFile(new URL('../shared/thinking-selection.js',import.meta.url)));return;}
      res.writeHead(404);res.end();}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  // Browser plugin has no callable runtime in this environment. Explicit offline Chromium fallback.
  const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true,executablePath:process.env.PA_ERROR_DISPLAY_UI_BROWSER||'/usr/bin/chromium'});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  const url=`http://127.0.0.1:${server.address().port}/`;await page.goto(url);await page.waitForFunction(()=>window.ready).catch(error=>{throw Error(`${error.message}; page errors=${JSON.stringify(errors)}`);});
  assert.equal(await page.title(),'Tool failure pipeline');assert.equal(page.url(),url);
  assert.match(await page.locator('#root').innerText(),/cause=EACCES/);assert.match(await page.locator('#root').innerText(),/请勿重复提交同一操作/);
  await page.locator('.assistant-message').waitFor({state:'visible'});
  await page.locator('#connectors-refresh').click();await page.waitForFunction(()=>document.querySelector('#workspace-error').textContent.includes('ECONNREFUSED'));
  assert.match(await page.locator('#workspace-error').innerText(),/服务拒绝连接/);
  assert.doesNotMatch(await page.locator('#root').innerText(),/synthetic-secret|private mail body/);
  assert.equal(await page.locator('nextjs-portal,#vite-error-overlay').count(),0);assert.deepEqual(errors,[]);
  if(process.env.PA_ERROR_DISPLAY_SCREENSHOT){await page.locator('.assistant-message').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.PA_ERROR_DISPLAY_SCREENSHOT});}
  assert.equal(calls,1);assert.equal(runtime.getTask(task.taskId).state,'waiting_reconciliation');
});

test('error display distinguishes cancellation, deadline, denial, validation and configuration without copying raw text',()=>{
  const messages=new Set();
  for(const code of ['CANCELLED','TIMEOUT','UNAUTHORIZED','INVALID_ARGUMENT','RESULT_UNKNOWN']){
    const text=errorDisplayText({code,message:'synthetic-secret /private/path private mail body'},'ipc');messages.add(text);
    assert.match(text,new RegExp(`code=${code}`));assert.doesNotMatch(text,/synthetic-secret|private/);assert.equal(errorDisplayText(text),text);
  }
  assert.equal(messages.size,5);
  const validation=errorDisplayText({code:'INVALID_ARGUMENT',message:'Tool value violates schema [keyword=required; field=title]'},'ipc');
  assert.match(validation,/validation=required; field=title/);assert.equal(errorDisplayText(validation),validation);
  assert.match(errorDisplayText(Error('盘古配置无效 token=synthetic-secret')),/code=CONFIGURATION/);
  assert.equal(errorDisplayText(''),'');
  const expired=errorDisplayText({code:'UNAUTHORIZED',message:'Authorization has expired'},'ipc');
  const bound=errorDisplayText({code:'UNAUTHORIZED',message:'Authorization is not bound to this task and tool'},'ipc');
  assert.notEqual(expired,bound);assert.match(expired,/Authorization has expired/);
  for(const status of [401,429]){
    const text=errorDisplayText({code:'EXTERNAL_FAILURE',message:`Pangu request failed with HTTP ${status}`},'configuration');
    assert.match(text,new RegExp(`status=${status}`));assert.match(text,status===401?/认证失败/:/频率或配额/);
  }
  const cloud=errorDisplayText({code:'RESULT_UNKNOWN',message:'Cloud invocation delivery or result is unknown; reconcile before sending again [cloud: transport=wss phase=wss_invoke close=1011 reason=server_error]'},'task');
  assert.match(cloud,/云端服务异常关闭/);assert.match(cloud,/close=1011/);assert.equal(errorDisplayText(cloud),cloud);
});
