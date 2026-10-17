import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Browser plugin not available. Opt-in isolated headless Edge fixture: no Electron user session,
// microphone/playback bootstrap, real account, configuration write or secret readback.
test('actual panel renders only runtime voice controls; settings own all voice credentials and original IPC actions',{
 skip:process.env.PA_SETTINGS_UI_TEST!=='1',timeout:60000,
},async t=>{
 const {chromium}=await import('playwright');
 const source=resolve(fileURLToPath(new URL('../src',import.meta.url))),errors=[];
 const fixture={tasks:[],messages:[],approvals:[],notifications:[],capabilities:[],health:[],connection:'显式离线 UI 夹具',
  model:{provider:'agentarts',configured:true,status:'configured',reason:'Fixture; no live inference'},modelChoices:[],thinking:{depth:1,fast:false,applied:false},
  live:{configured:true,active:false,status:'idle',workspaceId:'fixture-space',hotkey:'F8',apiKey:'must-not-read-back',shortcut:{key:'F8'}},
  voice:{experimental:false,status:'unavailable',reason:'fixture voice unavailable',configuration:{configured:true,region:'cn-north-4',projectId:'fixture-project',token:'must-not-read-back',reason:'配置已保存，未验证设备/云端'}},
  wake:{phase:'unavailable'},adminNavigation:{revision:1,page:'voice'}};
 const html=`<!doctype html><html lang="zh-CN"><head><title>PersonalAgent 设置隔离夹具</title><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/ui/tokens.css"><link rel="stylesheet" href="/app/style.css"><link rel="stylesheet" href="/app/surfaces.css"></head><body><main id="root"></main><script>window.fixture=${JSON.stringify(fixture)};window.calls=[];window.desktop={subscribe(fn){window.renderSnapshot=fn;return()=>{}},openSettings:async()=>{},invoke:async(name,payload)=>{
  window.calls.push({name,page:payload?.page,keySupplied:!!payload?.apiKey,tokenSupplied:!!payload?.iamToken,passwordSupplied:!!payload?.password});
  if(name==='snapshot')return{ok:true,value:structuredClone(window.fixture)};
  if(name==='live.toggle'){window.fixture.live.active=!window.fixture.live.active;window.fixture.live.status=window.fixture.live.active?'listening':'idle';window.renderSnapshot(structuredClone(window.fixture));}
  if(name==='voice.configure'||name==='voice.login')return{ok:true,value:{connected:false}};
  if(name==='voice.stop')return{ok:true,value:{stopped:true}};
  return{ok:true,value:{}};}};</script><script type="module" src="/app/renderer.js"></script></body></html>`;
 const server=createServer(async(req,res)=>{
  try{const pathname=new URL(req.url,'http://localhost').pathname;
   if(pathname==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;}
   const path=resolve(source,'.'+decodeURIComponent(pathname));if(!path.startsWith(source+'/')&&!path.startsWith(source+'\\')){res.writeHead(403).end();return;}
   res.setHeader('content-type',extname(path)==='.css'?'text/css':'text/javascript');res.end(await readFile(path));
  }catch{res.writeHead(404).end();}
 });
 server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PA_SETTINGS_UI_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:420,height:760},reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text());});
 const url='http://127.0.0.1:'+server.address().port;
 await page.goto(url+'/?mode=panel');await page.locator('#live-open-settings').waitFor();
 assert.match(await page.title(),/PersonalAgent/);assert.match(page.url(),/mode=panel/);
 assert.equal(await page.locator('input[type=password],#sis-region,#live-workspace,[data-model-api]').count(),0);
 assert.match(await page.locator('#live-runtime-status').textContent(),/配置已保存.*未开启麦克风/);
 assert.match(await page.locator('body').textContent(),/经 AgentArts 暂不可用/);
 await page.locator('#send').click();assert.match(await page.locator('#live-runtime-status').textContent(),/正在聆听/);
 await page.locator('#stop').click();assert.ok((await page.evaluate(()=>window.calls)).some(c=>c.name==='voice.stop'));
 await page.locator('#send').click();assert.match(await page.locator('#live-runtime-status').textContent(),/未开启麦克风/);
 await page.locator('#live-open-settings').click();assert.ok((await page.evaluate(()=>window.calls)).some(c=>c.name==='admin.open'&&c.page==='voice'));
 const output=process.env.PA_SETTINGS_UI_OUTPUT;if(output){await mkdir(output,{recursive:true});await page.screenshot({path:join(output,'panel-voice-controls.png')});}
 await page.setViewportSize({width:1280,height:900});await page.goto(url+'/?mode=admin');await page.locator('#live-key').waitFor({state:'attached'});
 assert.equal(await page.locator('#sis-token').count(),1);assert.equal(await page.locator('#live-key').inputValue(),'');assert.equal(await page.locator('#sis-token').inputValue(),'');
 assert.match(await page.locator('body').textContent(),/经 AgentArts.*当前不可用/);
 if(output)await page.screenshot({path:join(output,'settings-voice.png'),fullPage:true});
 await page.locator('#live-workspace').fill('fixture-next-space');await page.locator('#live-key').fill('explicit-fake-key');await page.locator('#live-save').click();
 assert.equal(await page.locator('#live-key').inputValue(),'');assert.ok((await page.evaluate(()=>window.calls)).some(c=>c.name==='live.configure'&&c.keySupplied));
 await page.getByText('华为 SIS 听写与播报 · 配置已保存',{exact:true}).click();
 await page.getByText('已有 IAM Token：手动配置',{exact:true}).click();await page.locator('#sis-token').fill('explicit-fake-token');await page.locator('#sis-save').click();
 assert.equal(await page.locator('#sis-token').inputValue(),'');assert.match(await page.locator('#sis-result').textContent(),/等待原 Competition Runtime/);
 assert.ok((await page.evaluate(()=>window.calls)).some(c=>c.name==='voice.configure'&&c.tokenSupplied));
 await page.locator('[data-page=settings]').click();assert.equal(await page.locator('#sis-token').isVisible(),false);assert.equal(await page.locator('#live-key').isVisible(),false);
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
});
