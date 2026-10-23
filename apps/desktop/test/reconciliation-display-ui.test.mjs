import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readReconciliationStatus} from '../electron/reconciliation-status.js';
import {errorDisplay} from '../src/shared/error-display.js';

test('actual panel and workspace show safe execution errors and only honest original-receipt actions',
  {skip:process.env.PA_RECONCILIATION_UI_TEST!=='1',timeout:30000},async t=>{
  const baseTask={taskId:'synthetic-original-task',state:'waiting_reconciliation',revision:4,userMessage:'Synthetic tool exception — offline UI validation',steps:[],evidenceRefs:[],
    error:errorDisplay({code:'RESULT_UNKNOWN',message:'工具失败 [stage=execute; cause=EACCES]：固定安全原因'},'task')};
  const record={executionStarted:true,policyDecision:'allow',state:'confirmed',toolName:'subagent.dispatch'};
  const statuses=[
    readReconciliationStatus({runtime:{loadCheckpoint:()=>undefined,readToolExecutions:()=>[]}},baseTask),
    readReconciliationStatus({runtime:{loadCheckpoint:(_taskId,key)=>key==='competition-export-withheld'?{}:undefined,readToolExecutions:()=>[record]}},baseTask),
    readReconciliationStatus({runtime:{loadCheckpoint:()=>undefined},readHarnessCandidateRecoveryAvailable:()=>true},baseTask),
  ];
  const states=statuses.map(reconciliationStatus=>({connection:'Synthetic offline bridge',tasks:[{...baseTask,reconciliationStatus}],messages:[],approvals:[],authorizationQuestions:[],subagentTasks:[],notifications:[],capabilities:[],health:[],
    model:{status:'ready',configured:true,model:'Synthetic offline fixture'},modelChoices:[],thinking:{depth:1,fast:false},
    conversationState:{activeId:'synthetic',draft:'',sessions:[{id:'synthetic',title:'Synthetic offline validation'}]}}));
  const source=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const path=resolve(source,'.'+pathname);if(!path.startsWith(source+sep)){res.writeHead(403);res.end();return;}
    try{res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));}
    catch{res.writeHead(404);res.end();}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  // Browser runtime is not callable here; use the task's explicitly authorized offline Chromium harness.
  const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});t.after(()=>browser.close());
  for(const mode of ['panel','workspace']){
    const page=await browser.newPage({viewport:mode==='panel'?{width:520,height:900}:{width:1280,height:900}});const errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.addInitScript(({states})=>{
      let state=states[0];const listeners=[];window.calls=[];
      window.desktop={invoke:async(name,payload)=>{window.calls.push({name,payload});return {ok:true,value:name==='snapshot'?structuredClone(state):{}};},subscribe:callback=>{listeners.push(callback);return()=>{};}};
      window.selectSyntheticCase=index=>{state=states[index];for(const callback of listeners)callback(structuredClone(state));};
    },{states});
    const url=`http://127.0.0.1:${server.address().port}/src/app/index.html?mode=${mode}`;await page.goto(url);
    const turn=page.locator('[data-turn="synthetic-original-task"]');await turn.waitFor();
    const failure=turn.locator(mode==='panel'?'.assistant-error':'.assistant-message');await failure.waitFor({state:'visible'});
    assert.match(await failure.innerText(),/cause=EACCES/);assert.match(await failure.innerText(),/资源访问被拒绝/);
    assert.equal(await turn.locator('.thinking-line').count(),0);
    assert.equal(await turn.getByRole('button',{name:/已有回执|原编码操作|核实并结束/}).count(),0);
    assert.match(await turn.innerText(),/没有该操作的自动核查入口/);assert.doesNotMatch(await turn.innerText(),/结果待核实|结果未知/);
    assert.equal(await page.title(),'PersonalAgent');assert.equal(page.url(),url);
    if(process.env.PA_RECONCILIATION_SCREENSHOT_DIR){await failure.scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.PA_RECONCILIATION_SCREENSHOT_DIR}/reconciliation-${mode}-synthetic.png`});}
    assert.equal((await page.evaluate(()=>window.calls)).some(call=>call.name==='task.reconcile.finish'),false,'rendering never performs readback or retries');
    for(const [index,label]of [[1,'按已有回执尝试结束'],[2,'核对原编码操作']]){
      await page.evaluate(index=>window.selectSyntheticCase(index),index);
      await turn.getByRole('button',{name:label,exact:true}).waitFor({state:'visible'});
      assert.match(await failure.innerText(),/cause=EACCES/);
      if(process.env.PA_RECONCILIATION_SCREENSHOT_DIR){await failure.scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.PA_RECONCILIATION_SCREENSHOT_DIR}/reconciliation-${mode}-${index===1?'receipt':'harness'}-synthetic.png`});}
      await turn.getByRole('button',{name:label,exact:true}).click();
    }
    const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls.filter(call=>call.name==='task.reconcile.finish').map(call=>call.payload),[baseTask.taskId,baseTask.taskId]);
    assert.equal(calls.some(call=>['tool.invoke','task.submit'].includes(call.name)),false);
    assert.deepEqual(errors,[]);await page.close();
  }
});
