import assert from 'node:assert/strict';
import test from 'node:test';
import {mountNotificationSettings} from '../src/features/admin/notification-settings.js';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Browser plugin not available. Headless installed Edge loads the actual Desktop
// renderer/admin module. IPC, OS, audio and accounts are explicit offline fixtures.
test('notification page submits current scope/revision, preserves draft and separates return from read',{
  skip:process.env.PA_NOTIFICATION_UI_TEST!=='1',timeout:60000,
},async t=>{
  const {chromium}=await import('playwright'),source=resolve(fileURLToPath(new URL('../src',import.meta.url)));
  const shared=resolve(fileURLToPath(new URL('../shared',import.meta.url)));
  const fixture={tasks:[],messages:[],approvals:[],notifications:[],capabilities:[],health:[],connection:'隔离通知页面',
    model:{provider:'agentarts',configured:true,status:'configured'},modelChoices:[],thinking:{depth:1,fast:false},
    adminNavigation:{revision:1,page:'notifications'},notificationCenter:{available:true,policy:{state:'unconfigured',revision:0,scope:{kind:'global'},effective:null},
      status:{interruptionQuotaSafety:'atomic'},feed:{items:[{id:'fixture-notice',source:'fixture',contentRef:'仅本机测试',validity:'active',unread:true}]}}};
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PersonalAgent 通知设置夹具</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/ui/tokens.css"><link rel="stylesheet" href="/app/style.css"><link rel="stylesheet" href="/app/surfaces.css"></head><body><main id="root"></main><script>
  window.fixture=${JSON.stringify(fixture)};window.calls=[];window.desktop={subscribe(fn){window.update=fn;return()=>{}},openSettings:async()=>{},invoke:async(name,payload)=>{
    window.calls.push({name,payload});const f=window.fixture;
    if(name==='snapshot')return{ok:true,value:structuredClone(f)};
    if(name==='notifications.configure'){f.notificationCenter.policy={state:'configured',revision:1,scope:payload.scope,effective:payload.patch};window.update(structuredClone(f));return{ok:true,value:{state:'confirmed',taskId:'fixture-settings-task',notificationCenter:structuredClone(f.notificationCenter)}};}
    if(name==='notifications.get'){f.notificationCenter.policy.revision=0;f.notificationCenter.policy.scope=payload.scope;return{ok:true,value:structuredClone(f.notificationCenter)};}
    if(name==='notifications.confirmation.prepare'){f.voiceQuestion={questionId:'fixture-current',revision:2,kind:'settings',summary:'是否确认当前通知参数？',state:'pending'};return{ok:true,value:structuredClone(f.voiceQuestion)};}
    if(name==='notifications.digest')return{ok:true,value:{items:structuredClone(f.notificationCenter.feed.items),interruptionCount:0}};
    if(name==='notifications.read'){f.notificationCenter.feed.items[0].unread=false;window.update(structuredClone(f));return{ok:true,value:{state:'read'}};}
    return{ok:true,value:{}};
  }};</script><script type="module" src="/app/renderer.js"></script></body></html>`;
  const server=createServer(async(req,res)=>{try{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;}
    const base=pathname.startsWith('/shared/')?shared:source;
    const file=resolve(base,'.'+decodeURIComponent(base===shared?pathname.slice('/shared'.length):pathname));
    if(!file.startsWith(base+'/')&&!file.startsWith(base+'\\')){res.writeHead(403).end();return;}
    res.setHeader('content-type',extname(file)==='.css'?'text/css':'text/javascript');res.end(await readFile(file));
  }catch{res.writeHead(404).end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true,executablePath:process.env.PA_NOTIFICATION_UI_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['warning','error'].includes(message.type()))errors.push(message.text());});
  const url='http://127.0.0.1:'+server.address().port+'/?mode=admin';await page.goto(url);
  const controls=page.locator('.notification-settings');await controls.waitFor();assert.equal(await page.title(),'PersonalAgent 通知设置夹具');assert.equal(page.url(),url);
  assert.match(await controls.textContent(),/静默仍接收变化/);assert.equal(await controls.locator('input[type=password]').count(),0);
  assert.equal(await controls.locator('[name=window]').inputValue(),'');assert.equal(await controls.locator('[name=maximum]').inputValue(),'');
  await controls.locator('[name=mode]').selectOption('normal');await controls.locator('[name=window]').fill('17');await controls.locator('[name=maximum]').fill('3');
  await controls.locator('[name=channel]').selectOption('banner');await controls.locator('[name=digest]').selectOption('on_return');
  await controls.getByRole('button',{name:'保存当前参数',exact:true}).click();
  await page.waitForFunction(()=>window.calls.some(c=>c.name==='notifications.configure'));
  const saved=await page.evaluate(()=>window.calls.find(c=>c.name==='notifications.configure').payload);
  assert.equal(saved.expectedRevision,0);assert.equal(saved.patch.maxInterruptions,3);assert.deepEqual(saved.scope,{kind:'global'});
  await controls.locator('[name=scope]').selectOption('connector');await controls.locator('[name=connector]').fill('mail');
  await controls.getByRole('button',{name:'读取当前范围',exact:true}).click();await page.waitForFunction(()=>window.calls.some(c=>c.name==='notifications.get'));
  await controls.locator('[name=mode]').selectOption('silent');
  await page.evaluate(()=>window.update(structuredClone(window.fixture)));assert.equal(await controls.locator('[name=mode]').inputValue(),'silent');
  assert.equal(await controls.locator('[data-notifications=voice]').count(),0,'approval only happens in the original card');
  assert.match(await controls.locator('[data-notifications=question]').textContent(),/授权卡/);
  await controls.getByRole('button',{name:'查看归来摘要',exact:true}).click();
  await page.waitForFunction(()=>window.calls.some(c=>c.name==='notifications.digest'));
  assert.equal((await page.evaluate(()=>window.calls)).some(c=>c.name==='notifications.read'),false);
  await controls.getByRole('button',{name:'标为已读',exact:true}).click();await page.waitForFunction(()=>window.calls.some(c=>c.name==='notifications.read'));
  assert.equal((await page.evaluate(()=>window.calls)).some(c=>/^voice\.(start|record)|^live\.toggle/u.test(c.name)),false);
  const output=process.env.PA_NOTIFICATION_UI_OUTPUT;
  await page.locator('.admin .main').evaluate(element=>{element.scrollTop=0;});
  if(output){await mkdir(output,{recursive:true});await page.screenshot({path:join(output,'notification-settings-desktop.png')});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:600,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(output)await page.screenshot({path:join(output,'notification-settings-narrow.png')});
  assert.deepEqual(errors,[]);
});

const globalScope = {kind:'global'};
const mailScope = {kind:'connector',connectorId:'mail'};
const basePolicy = {mode:'normal',windowMinutes:17,maxInterruptions:3,silentUntilUtc:null,
  preferredChannel:'banner',allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null};
const mailPolicy = {...basePolicy,mode:'silent',windowMinutes:20,preferredChannel:'voice'};
const center = (scope,revision,effective=basePolicy) => ({
  available:true,policy:{state:effective?'configured':'unconfigured',scope,revision,effective},feed:{items:[]}
});

function scopeFixture(t) {
  const names=['scope','connector','responsibility','mode','window','maximum','unlimited','until',
    'channel','urgent','digest','quietStart','quietEnd','timezone'];
  const inputs=Object.fromEntries(names.map(name=>[name,{name,value:'',checked:false,disabled:false}]));
  inputs.scope.value='global';
  const node=()=>({textContent:'',disabled:false,append(){},replaceChildren(){}});
  const fields=Object.fromEntries(['form','load','voice','status','question','cancel','reconcile',
    'digest','return','digest-result','approvals','feed'].map(name=>[name,node()]));
  fields.form={...node(),elements:{namedItem:name=>inputs[name]},reportValidity:()=>true};
  const section={...node(),
    querySelector:selector=>fields[selector.split('"')[1]],
    querySelectorAll:()=>[...Object.values(inputs),...Object.values(fields)]};
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,
    value:{createElement:tag=>tag==='section'?section:node()}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);
    else delete globalThis.document;});
  const calls=[];
  let reply={};
  const view=mountNotificationSettings({append(){}},(action,payload)=>{
    calls.push({action,payload:structuredClone(payload)});return structuredClone(reply);
  });
  return {calls,inputs,fields,render:view.render,reply:value=>{reply=value;},
    input(name,value){inputs[name].value=value;fields.form.oninput({target:inputs[name]});},
    async act(name){if(name==='submit')fields.form.onsubmit({preventDefault(){}});
      else fields[name].onclick();await new Promise(resolve=>setImmediate(resolve));}};
}
async function loadMail(h) {
  h.render(center(globalScope,0,null));
  h.input('scope','connector');h.input('connector','mail');
  h.reply(center(mailScope,2,mailPolicy));await h.act('load');
  assert.deepEqual(h.calls[0].payload,{scope:mailScope});h.calls.length=0;
}

test('notification settings preserve selected scope and revision',{concurrency:false},async t=>{
  await t.test('unconfigured global revision zero can save',async t=>{
    const h=scopeFixture(t);h.render(center(globalScope,0,null));
    for(const [name,value] of Object.entries({mode:'normal',window:'17',maximum:'3',
      channel:'banner',digest:'on_return'}))h.input(name,value);
    h.reply({state:'confirmed',taskId:'fixture',notificationCenter:center(globalScope,1)});
    await h.act('submit');
    assert.deepEqual(h.calls.map(call=>call.action),['notifications.configure']);
    assert.equal(h.calls[0].payload.expectedRevision,0);
    assert.deepEqual(h.calls[0].payload.scope,globalScope);
    assert.deepEqual(h.calls[0].payload.patch,basePolicy);
  });
  await t.test('global broadcasts cannot replace clean or dirty connector policy',async t=>{
    const h=scopeFixture(t);await loadMail(h);
    h.render(center(globalScope,5));
    assert.equal(h.inputs.mode.value,'silent');assert.equal(h.inputs.window.value,'20');
    h.input('window','23');
    h.render(center(globalScope,6));h.render(center(mailScope,9,basePolicy));
    assert.equal(h.inputs.window.value,'23');
    h.reply({state:'confirmed',taskId:'fixture',notificationCenter:center(mailScope,3)});
    await h.act('submit');
    assert.equal(h.calls[0].action,'notifications.configure');
    assert.equal(h.calls[0].payload.expectedRevision,2);
    assert.deepEqual(h.calls[0].payload.scope,mailScope);
    assert.deepEqual(h.calls[0].payload.patch,{...mailPolicy,windowMinutes:23});
  });
  await t.test('a changed scope or mismatched readback cannot submit',async t=>{
    const h=scopeFixture(t);await loadMail(h);
    h.input('connector','calendar');await h.act('submit');
    assert.deepEqual(h.calls,[]);
    h.reply(center(globalScope,5));await h.act('load');
    await h.act('submit');
    assert.deepEqual(h.calls.map(call=>call.action),['notifications.get']);
  });
});
