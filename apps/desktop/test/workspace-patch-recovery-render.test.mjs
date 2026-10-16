import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createWorkspacePatchRecoveryHost} from '../electron/workspace-patch-recovery-host.js';

test('actual admin page renders and clicks original patch recovery',
  {skip:!process.env.PA_PATCH_RECOVERY_BROWSER},async()=>{
  const root=fileURLToPath(new URL('../src/',import.meta.url));
  let calls=0;
  const task={taskId:'public-fixture-task',state:'waiting_reconciliation',revision:4,evidenceRefs:[]};
  // Explicit Fake application, real host projector and real admin page/controllers.
  const host=createWorkspacePatchRecoveryHost({isAuthorized:()=>true,application:{
    runtime:{getTask:()=>({...task})},async reconcileWorkspacePatchTask(taskId){
      calls++;task.state='cancelled';task.revision=5;
      return {taskId,runId:'public-original-run',result:{state:'reconciled',outcome:'applied',path:'PRIVATE_PATH'}};
    }}});
  const html=`<!doctype html><html lang="zh-CN" data-theme="light"><head><title>PersonalAgent · 补丁核实验收</title>
  <link rel="stylesheet" href="/ui/tokens.css"><link rel="stylesheet" href="/app/style.css"><link rel="stylesheet" href="/app/surfaces.css"></head>
  <body><main id="root"></main><script type="module">
  import {mountAdmin} from '/features/admin/view.js';
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const invoke=async(name,input)=>{if(name!=='coding.reconcile')throw Error('Unsupported fixture operation');
    const response=await fetch('/reconcile',{method:'POST',body:JSON.stringify(input)});if(!response.ok)throw Error('Rejected');return response.json();};
  mountAdmin(document.querySelector('#root'),invoke,escape)({connection:'显式 Fake Runtime 验收',tasks:[${JSON.stringify(task)}],capabilities:[],health:[],approvals:[],
    adminNavigation:{page:'tasks',revision:1}});
  </script></body></html>`;
  const server=createServer(async(req,res)=>{
    try {
      if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
      if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
      if(req.url==='/reconcile' && req.method==='POST'){
        let body='';for await(const chunk of req)body+=chunk;
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await host.reconcile(JSON.parse(body))));return;
      }
      const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
      if(!target.startsWith(root))throw Error();
      res.setHeader('Content-Type',target.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(target));
    }catch{res.writeHead(400).end('Rejected');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({executablePath:process.env.PA_PATCH_RECOVERY_BROWSER,headless:true});
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const url=`http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);assert.equal(page.url(),url);assert.match(await page.title(),/补丁核实验收/);
    await page.getByRole('button',{name:'核实补丁结果',exact:true}).click();
    await page.getByText('任务已取消，但此前修改已写入。',{exact:false}).waitFor();
    await page.getByRole('cell',{name:'已取消',exact:true}).waitFor();
    assert.equal(calls,1);assert.deepEqual(errors,[]);
    assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE_PATH|Error overlay/);
    const screenshot=process.env.PA_PATCH_RECOVERY_SCREENSHOT ?? path.join(os.tmpdir(),'workspace-patch-recovery.png');
    await mkdir(path.dirname(screenshot),{recursive:true});await page.screenshot({path:screenshot,fullPage:false});
    console.log('render evidence:',screenshot);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
