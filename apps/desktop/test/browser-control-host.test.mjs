import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer as createHttpServer,request as httpRequest} from 'node:http';
import {createServer as createTcpServer,connect as netConnect} from 'node:net';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolNotStartedError} from '@personal-agent/contracts';
import {createBrowserControlHost,createBrowserEgressProxy,isPublicBrowserAddress,assertPublicBrowserUrl} from '../electron/browser-control-host.js';

const publicDns=async()=>[{address:'93.184.216.34'}];
const notStarted=code=>error=>error instanceof ToolNotStartedError&&error.code===code;
async function fixture(options={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'pa-browser-test-')),calls=[],checkpoints=new Map(),records=new Map();
  let routeHandler,url='about:blank',value='',count=0,terminated=false,afterGoto,clickOperation,protectedFocus=false,downloadPath,frameDriver;
  const pageEvents=new EventEmitter(),downloadEvents=new EventEmitter(),guid='11111111-1111-4111-8111-111111111111';
  downloadEvents.send=async(command,args)=>{calls.push(['cdp',command,args]);
    if(command==='Browser.setDownloadBehavior'&&args.behavior==='deny'&&downloadPath&&options.failDownloadDeny)throw Object.assign(Error('download permission reset denied'),{code:'EACCES'});
    if(command==='Browser.setDownloadBehavior'&&args.downloadPath)downloadPath=args.downloadPath;};
  downloadEvents.detach=async()=>{};
  const controls=()=>[{ref:'r1',tag:'input',role:'textbox',name:'Note',inputType:'text',disabled:false,value},
    {ref:'r2',tag:'button',role:'button',name:'Add',inputType:'',disabled:false},
    {ref:'r3',tag:'select',role:'combobox',name:'Choice',inputType:'',disabled:false,options:[{value:'a',label:'A'}]},
    {ref:'r4',tag:'a',role:'link',name:'Fixture download',inputType:'',disabled:false,downloadUrl:options.downloadUrl??'https://example.com/download'}];
  const browserPage={
    isClosed:()=>terminated,url:()=>url,mainFrame:()=>browserPage,on:(...args)=>pageEvents.on(...args),
    async goto(next){calls.push(['goto',next]);await request(next,true);url=next;if(afterGoto)await afterGoto();},
    async goBack(){calls.push(['back']);url='https://example.com/';},
    async evaluate(_fn,args){if(args?.attribute)return {title:'Synthetic page',text:`Count ${count}`,controls:controls(),truncated:false};return protectedFocus;},
    locator(selector){
      const id=/="(r\d+)"/.exec(selector)?.[1],entry=controls().find(c=>c.ref===id);
      return {count:async()=>entry?1:0,evaluate:async()=>({tag:entry.tag,type:entry.inputType,name:entry.name,editable:false,disabled:false,href:entry.downloadUrl}),
        async click(){calls.push(['click',id]);if(id==='r4'){
          if(options.downloadOperation)return options.downloadOperation({driver:downloadEvents,frameDriver,directory:downloadPath,guid,url:entry.downloadUrl});
          downloadEvents.emit('Browser.downloadWillBegin',{guid,url:entry.downloadUrl,frameId:'frame-main',suggestedFilename:'../../fixture.txt'});
          const bytes=Buffer.from('synthetic attachment');await writeFile(path.join(downloadPath,guid),bytes);
          downloadEvents.emit('Browser.downloadProgress',{guid,receivedBytes:bytes.length,totalBytes:bytes.length,state:'completed'});return;
        }if(clickOperation)return clickOperation();count++;},
        async fill(text){calls.push(['fill',id]);value=text;},async pressSequentially(text){calls.push(['type',id]);value+=text;},
        async selectOption(values){calls.push(['select',values]);}};
    },
    keyboard:{press:async key=>{calls.push(['press',key]);}},mouse:{wheel:async(_x,y)=>{calls.push(['scroll',y]);}},
    screenshot:async()=>Buffer.from('synthetic-png'),close:async()=>{},
  };
  async function request(next,navigation=false) {
    let aborted=false;await routeHandler({request:()=>({url:()=>next,isNavigationRequest:()=>navigation,frame:()=>browserPage}),
      continue:async()=>{calls.push(['continued',next]);},abort:async()=>{aborted=true;calls.push(['aborted',next]);}});
    if(aborted&&navigation)throw Error('navigation blocked');
  }
  const browserContext={pages:()=>[browserPage],newPage:async()=>browserPage,route:async(_pattern,handler)=>{routeHandler=handler;},
    browser:()=>options.noDownloadDriver?{}:{newBrowserCDPSession:async()=>downloadEvents},
    newCDPSession:async()=>{frameDriver=Object.assign(new EventEmitter(),{send:async(command,args)=>{calls.push(['frame-cdp',command,args]);return {frameTree:{frame:{id:'frame-main'}}};},detach:async()=>{}});return frameDriver;},
    routeWebSocket:async()=>{},on(){},async close(){calls.push(['close']);if(options.closeError)throw options.closeError;if(options.failClose)throw Error('synthetic close failure');terminated=true;}};
  const playwright={chromium:{async launchPersistentContext(profile,config){calls.push(['launch',profile,config]);if(options.launchError)throw options.launchError;terminated=false;return browserContext;}}};
  const runtime={listTasks:()=>({items:[]}),getTask:()=>({state:'running'}),
    readToolExecutions:taskId=>[...records.values()].filter(record=>record.taskId===taskId),
    loadCheckpoint:(_task,key)=>key==='application-deadline'?deadline:undefined,
    matchesToolExecutionInput:(record,input)=>record.digest===toolArgumentsDigest(input.arguments)&&input.scopeRef===record.authorizationRef,
    saveCheckpointOnce(taskId,key,value){const id=taskId+':'+key;if(checkpoints.has(id))return false;checkpoints.set(id,value);return true;}};
  const deadline=new Date(Date.now()+60_000).toISOString();
  options.setupRuntime?.(runtime);
  const host=createBrowserControlHost({userDataPath:directory,playwright,dnsLookup:publicDns,
    authorizePresence:async()=>true,...options});host.bind({runtime});
  let run=0;
  async function invoke(name,args={},overrides={}) {
    const runId=overrides.runId??'run-'+(++run),scope={taskId:'task-1',runId,deadline,signal:new AbortController().signal,
      authorizationRef:'grant-'+runId,argumentsDigest:toolArgumentsDigest(args),scopes:['browser:control'],...overrides};
    records.set(runId,{taskId:scope.taskId,evidenceId:runId,toolName:'browser.'+name,toolVersion:'1.0.0',policyDecision:'allow',
      executionStarted:true,state:'started',digest:toolArgumentsDigest(args),authorizationRef:scope.authorizationRef});
    return host.tools.find(t=>t.descriptor.name==='browser.'+name).execute(args,scope);
  }
  return {host,invoke,calls,checkpoints,runtime,records,request,deadline,directory,downloadEvents,pageEvents,
    set afterGoto(fn){afterGoto=fn;},set clickOperation(fn){clickOperation=fn;},set protectedFocus(v){protectedFocus=v;},
    async close(){await host.close();await rm(directory,{recursive:true,force:true});}};
}

test('public address admission rejects special ranges, mapped IPv6, private DNS answers and credentials',async()=>{
  for(const value of ['127.0.0.1','0.0.0.0','10.1.2.3','172.20.1.1','192.168.0.1','169.254.169.254','100.64.1.1','198.18.0.1',
    '192.0.2.2','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','::ffff:7f00:1','2001:db8::1','2001::1','2002:7f00::1'])assert.equal(isPublicBrowserAddress(value),false,value);
  assert.equal(isPublicBrowserAddress('8.8.8.8'),true);assert.equal(isPublicBrowserAddress('2606:4700:4700::1111'),true);
  for(const value of ['file:///C:/private','http://localhost/','https://metadata.google.internal','http://127.1/','https://u:p@example.com'])
    await assert.rejects(assertPublicBrowserUrl(value,{dnsLookup:publicDns}),{code:'UNAUTHORIZED'});
  await assert.rejects(assertPublicBrowserUrl('https://example.com',{dnsLookup:async()=>[{address:'8.8.8.8'},{address:'192.168.1.1'}]}),{code:'UNAUTHORIZED'});
});

test('stable tools expose bounded public schemas, own visible profile and open/observe/type/click readback',async()=>{
  const f=await fixture();try {
    const stable=f.host.tools;assert.equal(stable.length,12);assert.equal(f.host.tools,stable);
    assert.equal(stable.find(t=>t.descriptor.name==='browser.click').descriptor.sideEffect,'external_write');
    const opened=await f.invoke('open',{url:'https://example.com/?private=not-exported#fragment'});
    assert.equal(opened.url,'https://example.com/');assert.equal(opened.goalVerified,false);
    assert.equal(f.calls.find(c=>c[0]==='launch')[2].headless,false);
    const typed=await f.invoke('type',{targetRef:opened.targetRef,ref:'r1',text:'hello'});
    assert.equal(typed.controls.find(c=>c.ref==='r1').value,'hello');assert.notEqual(typed.targetRef,opened.targetRef);
    const clicked=await f.invoke('click',{targetRef:typed.targetRef,ref:'r2'});assert.equal(clicked.text,'Count 1');
    assert.equal(clicked.state,'action_observed');assert.equal(f.checkpoints.size,3);
    assert.equal(JSON.stringify(f.host.snapshot()).includes('example.com'),false);
    assert.equal(JSON.stringify(f.host.snapshot()).includes(f.directory),false);
    assert.equal((await f.invoke('close')).state,'closed');assert.equal(f.host.snapshot().connected,false);
  }finally{await f.close();}
});

test('target refs are single-use, task-bound and require the original Runtime argument digest',async()=>{
  const f=await fixture();try {
    const first=await f.invoke('open',{url:'https://example.com'});
    await assert.rejects(f.invoke('click',{targetRef:first.targetRef,ref:'r2'},{taskId:'other'}),notStarted('UNAUTHORIZED'));
    const next=await f.invoke('click',{targetRef:first.targetRef,ref:'r2'});
    await assert.rejects(f.invoke('click',{targetRef:first.targetRef,ref:'r2'}),notStarted('UNAUTHORIZED'));
    await assert.rejects(f.invoke('click',{targetRef:next.targetRef,ref:'r2'},{argumentsDigest:'wrong'}),notStarted('UNAUTHORIZED'));
    assert.equal(f.calls.filter(c=>c[0]==='click').length,1);
  }finally{await f.close();}
});

test('a recorded action identity never replays and blocks instead of pretending zero dispatch',async()=>{
  const f=await fixture();try {
    const opened=await f.invoke('open',{url:'https://example.com'},{runId:'same'});
    await assert.rejects(f.invoke('click',{targetRef:opened.targetRef,ref:'r2'},{runId:'same'}),{code:'RESULT_UNKNOWN'});
    assert.equal(f.calls.filter(c=>c[0]==='click').length,0);assert.equal(f.host.snapshot().state,'blocked');
  }finally{await f.close();}
});

test('origin permission and missing Runtime grant fail before browser dispatch',async()=>{
  const f=await fixture({authorizePresence:async request=>request.origin==='https://example.com'});try {
    await assert.rejects(f.invoke('open',{url:'https://denied.example'}),notStarted('UNAUTHORIZED'));assert.equal(f.calls.length,0);
    await assert.rejects(f.invoke('open',{url:'https://example.com'},{scopes:[]}),notStarted('UNAUTHORIZED'));assert.equal(f.calls.length,0);
  }finally{await f.close();}
});

test('real Gateway preserves trusted browser zero-dispatch refusal and its safe specific reason',async()=>{
  const f=await fixture({authorizePresence:async()=>false});try {
    const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});
    const tool=f.host.tools.find(tool=>tool.descriptor.name==='browser.open');gateway.register(tool);
    const args={url:'https://example.com'},authorizationRef='gateway-grant',runId='gateway-run';
    f.records.set(runId,{taskId:'task-1',evidenceId:runId,toolName:'browser.open',toolVersion:'1.0.0',policyDecision:'allow',
      executionStarted:true,state:'started',digest:toolArgumentsDigest(args),authorizationRef});
    policy.grant({authorizationRef,taskId:'task-1',toolName:'browser.open',scopes:['browser:control'],
      argumentsDigest:toolArgumentsDigest(args),expiresAt:f.deadline,maxUses:1});
    await assert.rejects(gateway.invoke({taskId:'task-1',runId,toolName:'browser.open',toolVersion:'1.0.0',arguments:args,
      authorizationRef,signal:new AbortController().signal,deadline:f.deadline}),error=>notStarted('UNAUTHORIZED')(error)
        &&error.message==='当前任务没有此浏览器来源或观察出口的许可');
    assert.equal(f.checkpoints.size,0);assert.equal(f.calls.length,0);assert.equal(f.host.snapshot().state,'stopped');
  }finally{await f.close();}
});

test('launch failure preserves OS code, safe availability detail and an explicit open retry path',async()=>{
  const privateText='C:\\private-browser-profile Bearer synthetic-private-value';
  const options={launchError:Object.assign(Error(privateText),{code:'ENOENT'})},f=await fixture(options);try {
    await assert.rejects(f.invoke('open',{url:'https://example.com'}),error=>notStarted('ENOENT')(error)&&!error.message.includes(privateText));
    const status=f.host.snapshot();assert.equal(status.state,'unavailable');assert.equal(status.available,false);
    assert.equal(status.failure.code,'ENOENT');assert.equal(status.failure.stage,'start');assert.ok(status.reason.includes('[ENOENT]'));
    assert.equal(JSON.stringify(status).includes(privateText),false);assert.equal(f.checkpoints.size,0);assert.equal(f.calls.some(call=>call[0]==='goto'),false);
    const scope={signal:new AbortController().signal,deadline:f.deadline};
    assert.equal(f.host.competitionToolAvailability.find(item=>item.toolName==='browser.click').available(scope),false);
    assert.equal(f.host.competitionToolAvailability.find(item=>item.toolName==='browser.open').available(scope),true);
    options.launchError=undefined;assert.equal((await f.invoke('open',{url:'https://example.com'})).state,'action_observed');
    assert.equal(f.host.snapshot().failure,undefined);assert.equal(f.host.snapshot().available,true);
  }finally{await f.close();}
});

test('missing Playwright browser install has an actionable safe reason, not its private launch path',async()=>{
  const f=await fixture({launchError:Error("browserType.launchPersistentContext: Executable doesn't exist at C:\\private-profile\\browser.exe")});try {
    await assert.rejects(f.invoke('open',{url:'https://example.com'}),error=>notStarted('UNSUPPORTED_CAPABILITY')(error)
      &&error.message.includes('安装 Edge')&&!error.message.includes('private-profile'));
    assert.equal(f.host.snapshot().failure.code,'UNSUPPORTED_CAPABILITY');assert.equal(f.checkpoints.size,0);
  }finally{await f.close();}
});

test('redirects and subresources cannot reach loopback, and uncertain dispatched navigation blocks',async()=>{
  for(const navigation of [true,false]) {
    const f=await fixture();try {
      f.afterGoto=()=>f.request('http://127.0.0.1/metadata',navigation);
      await assert.rejects(f.invoke('open',{url:'https://example.com'}),{code:'RESULT_UNKNOWN'});
      assert.ok(f.calls.some(c=>c[0]==='aborted'));assert.equal(f.calls.some(c=>c[0]==='continued'&&c[1].includes('127.0.0.1')),false);
      assert.equal(f.host.snapshot().state,'blocked');
    }finally{await f.close();}
  }
});

test('explicit test-only local origins require injected driver and do not open other private origins',async()=>{
  assert.throws(()=>createBrowserControlHost({userDataPath:path.resolve('.'),authorizePresence:async()=>true,testOnlyAllowedOrigins:['http://127.0.0.1:1234']}),{code:'INVALID_ARGUMENT'});
  assert.equal((await assertPublicBrowserUrl('http://127.0.0.1:1234/page',{testOnlyAllowedOrigins:['http://127.0.0.1:1234']})).port,'1234');
  await assert.rejects(assertPublicBrowserUrl('http://127.0.0.1:1235/page',{testOnlyAllowedOrigins:['http://127.0.0.1:1234']}),{code:'UNAUTHORIZED'});
});

test('protected focus, unsupported refs and arbitrary script/key input cannot dispatch',async()=>{
  const f=await fixture();try {
    const opened=await f.invoke('open',{url:'https://example.com'});f.protectedFocus=true;
    await assert.rejects(f.invoke('press',{targetRef:opened.targetRef,key:'Enter'}),notStarted('UNAUTHORIZED'));
    await assert.rejects(f.invoke('click',{targetRef:opened.targetRef,ref:'r99'}),notStarted('INVALID_ARGUMENT'));
    await assert.rejects(f.invoke('press',{targetRef:opened.targetRef,key:'Control+L'}),notStarted('INVALID_ARGUMENT'));
    await assert.rejects(f.invoke('observe',{evaluate:'process.exit()'}),{code:'INVALID_ARGUMENT'});
    assert.equal(f.calls.some(c=>c[0]==='press'),false);
  }finally{await f.close();}
});

test('screenshot is local metadata; exact task/export consent is required to read bytes',async()=>{
  let exportAllowed=true;
  const f=await fixture({authorizePresence:async request=>request.phase==='export'?exportAllowed:true});try {
    const opened=await f.invoke('open',{url:'https://example.com'});
    const shot=await f.invoke('screenshot',{targetRef:opened.targetRef});
    assert.equal(shot.artifact.imageDeliveredToModel,false);assert.equal(JSON.stringify(shot).includes('base64'),false);
    const input={artifactId:shot.artifact.artifactId,taskId:'task-1',signal:new AbortController().signal,deadline:f.deadline};
    assert.equal((await f.host.readScreenshotArtifact(input)).bytes.toString(),'synthetic-png');
    await assert.rejects(f.host.readScreenshotArtifact({...input,taskId:'wrong'}),{code:'UNAUTHORIZED'});
    const policy=f.host.competitionToolExports.find(p=>p.toolName==='browser.screenshot');
    assert.deepEqual(await policy.project({taskId:'task-1',result:shot,signal:input.signal}),shot);
    await assert.rejects(policy.project({taskId:'task-1',result:{...shot,title:'changed'},signal:input.signal}),{code:'UNAUTHORIZED'});
    exportAllowed=false;await assert.rejects(f.host.readScreenshotArtifact(input),{code:'UNAUTHORIZED'});
    await assert.rejects(policy.project({taskId:'task-1',result:shot,signal:input.signal}),{code:'UNAUTHORIZED'});
  }finally{await f.close();}
});

test('cancel after write dispatch closes only the owned browser, blocks and never retries',async()=>{
  const f=await fixture();try {
    const opened=await f.invoke('open',{url:'https://example.com'}),controller=new AbortController();
    f.clickOperation=()=>new Promise(()=>{});
    const pending=f.invoke('click',{targetRef:opened.targetRef,ref:'r2'},{signal:controller.signal});
    while(!f.calls.some(c=>c[0]==='click'))await new Promise(resolve=>setImmediate(resolve));
    controller.abort();await assert.rejects(pending,{code:'RESULT_UNKNOWN'});
    assert.equal(f.host.snapshot().state,'blocked');assert.equal(f.calls.filter(c=>c[0]==='click').length,1);
    assert.ok(f.calls.some(c=>c[0]==='close'));
  }finally{await f.close();}
});

test('concurrent rejected reads do not release the active browser input lock',async()=>{
  const f=await fixture();try {
    const opened=await f.invoke('open',{url:'https://example.com'});let finish;
    f.clickOperation=()=>new Promise(resolve=>{finish=resolve;});
    const pending=f.invoke('click',{targetRef:opened.targetRef,ref:'r2'});
    while(!finish)await new Promise(resolve=>setImmediate(resolve));
    await assert.rejects(f.invoke('observe'),{code:'REVISION_CONFLICT'});assert.equal(f.host.snapshot().busy,true);
    finish();assert.equal((await pending).state,'action_observed');
  }finally{await f.close();}
});

test('restart sees original unknown writes and preserves the block',async()=>{
  const f=await fixture({setupRuntime(runtime){runtime.listTasks=()=>({items:[{taskId:'old'}]});
    runtime.readToolExecutions=()=>[{toolName:'browser.click',policyDecision:'allow',executionStarted:true,state:'unknown'}];}});
  try {
    assert.equal(f.host.snapshot().state,'blocked');await assert.rejects(f.invoke('open',{url:'https://example.com'}),{code:'RESULT_UNKNOWN'});
    assert.equal(f.calls.length,0);
  }finally{await f.close();}
});

test('a checkpoint remains unknown when the optional attempt sink fails before dispatch',async()=>{
  const f=await fixture({attempts:{record:async()=>{throw Error('receipt failure');}}});try {
    await assert.rejects(f.invoke('open',{url:'https://example.com'}),{code:'RESULT_UNKNOWN'});
    assert.equal(f.checkpoints.size,1);assert.equal(f.calls.some(c=>c[0]==='goto'),false);
    assert.equal(f.host.snapshot().state,'blocked');
  }finally{await f.close();}
});

test('failed owned-browser release stays unconfirmed and blocks with the context retained',async()=>{
  const options={failClose:true},f=await fixture(options);try {
    await f.invoke('open',{url:'https://example.com'});
    await assert.rejects(f.host.stop(),{code:'EXTERNAL_FAILURE'});
    assert.equal(f.host.snapshot().releaseState,'unconfirmed');assert.equal(f.host.snapshot().connected,true);
    assert.equal(f.host.snapshot().state,'blocked');
  }finally{options.failClose=false;await f.close();}
});

test('stop failure retains safe specific OS diagnostics without exposing driver message',async()=>{
  const privateText='C:\\private-browser-profile Bearer synthetic-private-value';
  const options={closeError:Object.assign(Error(privateText),{code:'EACCES'})},f=await fixture(options);try {
    await f.invoke('open',{url:'https://example.com'});
    await assert.rejects(f.host.stop(),error=>error.code==='EACCES'&&!error.message.includes(privateText));
    const status=f.host.snapshot();assert.equal(status.failure.code,'EACCES');assert.equal(status.failure.stage,'stop');
    assert.equal(status.state,'blocked');assert.equal(status.releaseState,'unconfirmed');assert.equal(status.available,false);
    assert.ok(status.reason.includes('[EACCES]'));assert.equal(JSON.stringify(status).includes(privateText),false);
  }finally{options.closeError=undefined;await f.close();}
});

test('cancelling a rejected concurrent call does not close another run browser',async()=>{
  const f=await fixture();try {
    const opened=await f.invoke('open',{url:'https://example.com'});let finish;
    f.clickOperation=()=>new Promise(resolve=>{finish=resolve;});
    const pending=f.invoke('click',{targetRef:opened.targetRef,ref:'r2'});
    while(!finish)await new Promise(resolve=>setImmediate(resolve));
    const controller=new AbortController();controller.abort();
    await assert.rejects(f.invoke('observe',{}, {signal:controller.signal}),{code:'CANCELLED'});
    assert.equal(f.calls.some(c=>c[0]==='close'),false);assert.equal(f.host.snapshot().busy,true);
    finish();assert.equal((await pending).state,'action_observed');
  }finally{await f.close();}
});

test('screenshots retain original immutable export scope after a later observation',async()=>{
  const exports=[];const f=await fixture({authorizePresence:async request=>{if(request.phase==='export')exports.push(request);return true;}});try {
    const opened=await f.invoke('open',{url:'https://example.com'});
    const shot=await f.invoke('screenshot',{targetRef:opened.targetRef},{runId:'screenshot-run'});
    await f.invoke('observe');
    await f.host.readScreenshotArtifact({artifactId:shot.artifact.artifactId,taskId:'task-1',signal:new AbortController().signal,deadline:f.deadline});
    assert.equal(exports.at(-1).runId,'screenshot-run');assert.equal(exports.at(-1).toolName,'browser.screenshot');
    assert.deepEqual(exports.at(-1).arguments,{targetRef:opened.targetRef});
  }finally{await f.close();}
});

test('download uses one observed same-origin link and original attempt, returns metadata only and never executes content',async()=>{
  const f=await fixture();try{
    const opened=await f.invoke('open',{url:'https://example.com/'});
    assert.equal(opened.controls.find(control=>control.ref==='r4').downloadable,true);
    assert.equal(JSON.stringify(opened).includes('downloadUrl'),false);
    const result=await f.invoke('download',{targetRef:opened.targetRef,ref:'r4'});
    assert.equal(result.state,'downloaded');assert.deepEqual(Object.keys(result.artifact).sort(),['artifactId','byteLength','name','sha256']);
    assert.equal(result.artifact.name,'fixture.txt');assert.equal(result.artifact.byteLength,20);
    assert.equal(JSON.stringify(result).includes(f.directory),false);assert.equal(JSON.stringify(result).includes('synthetic attachment'),false);
    const files=await readdir(path.join(f.directory,'downloads'));assert.equal(files.length,1);
    assert.equal(await readFile(path.join(f.directory,'downloads',files[0]),'utf8'),'synthetic attachment');
    assert.equal(f.checkpoints.size,2);await assert.rejects(f.invoke('download',{targetRef:opened.targetRef,ref:'r4'}),notStarted('UNAUTHORIZED'));
    assert.equal(f.calls.filter(call=>call[0]==='click'&&call[1]==='r4').length,1);
    assert.equal(f.calls.find(call=>call[0]==='launch')[2].acceptDownloads,false);
    const policy=f.host.competitionToolExports.find(item=>item.toolName==='browser.download');
    assert.deepEqual(await policy.project({taskId:'task-1',result,signal:new AbortController().signal}),result);
  }finally{await f.close();}
});

test('download rejects non-links, arbitrary paths, private/file/cross-origin URLs and missing CDP before dispatch',async()=>{
  for(const downloadUrl of ['file:///C:/private.txt','http://127.0.0.1/metadata','https://different.example/file']){
    const f=await fixture({downloadUrl});try{
      const opened=await f.invoke('open',{url:'https://example.com/'});
      await assert.rejects(f.invoke('download',{targetRef:opened.targetRef,ref:'r4'}),notStarted('UNAUTHORIZED'));
      assert.equal(f.checkpoints.size,1);assert.equal(f.calls.some(call=>call[0]==='click'),false);
    }finally{await f.close();}
  }
  const f=await fixture({noDownloadDriver:true});try{
    const opened=await f.invoke('open',{url:'https://example.com/'});
    await assert.rejects(f.invoke('download',{targetRef:opened.targetRef,ref:'r2'}),notStarted('INVALID_ARGUMENT'));
    await assert.rejects(f.invoke('download',{targetRef:opened.targetRef,ref:'r4',path:'C:/outside'}),notStarted('INVALID_ARGUMENT'));
    await assert.rejects(f.invoke('download',{targetRef:opened.targetRef,ref:'r4'}),notStarted('UNSUPPORTED_CAPABILITY'));
    assert.equal(f.checkpoints.size,1);
  }finally{await f.close();}
});

test('unsolicited downloads cancel, and oversized CDP progress blocks without replay or retained partials',async()=>{
  const f=await fixture({maxDownloadBytes:32,downloadOperation:async({driver,guid,url})=>{
    driver.emit('Browser.downloadWillBegin',{guid,url,frameId:'frame-main',suggestedFilename:'large.bin'});
    driver.emit('Browser.downloadProgress',{guid,totalBytes:33,receivedBytes:0,state:'inProgress'});
  }});try{
    const opened=await f.invoke('open',{url:'https://example.com/'});let cancelled=0;
    f.pageEvents.emit('download',{cancel:async()=>{cancelled++;}});await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);
    await assert.rejects(f.invoke('download',{targetRef:opened.targetRef,ref:'r4'}),{code:'RESULT_UNKNOWN'});
    assert.equal(f.host.snapshot().state,'blocked');assert.equal(f.calls.filter(call=>call[0]==='click').length,1);
    assert.ok(f.calls.some(call=>call[0]==='cdp'&&call[1]==='Browser.cancelDownload'));
    assert.deepEqual(await readdir(path.join(f.directory,'downloads')),[]);
  }finally{await f.close();}
});

test('download cancellation closes owned browser, cancels GUID and removes its private partial directory',async()=>{
  let started;const f=await fixture({downloadOperation:async({driver,guid,url,directory})=>{
    driver.emit('Browser.downloadWillBegin',{guid,url,frameId:'frame-main',suggestedFilename:'partial.bin'});
    await writeFile(path.join(directory,guid),'partial');started=true;
  }});try{
    const opened=await f.invoke('open',{url:'https://example.com/'}),controller=new AbortController();
    const pending=f.invoke('download',{targetRef:opened.targetRef,ref:'r4'},{signal:controller.signal});
    while(!started)await new Promise(resolve=>setImmediate(resolve));controller.abort();
    await assert.rejects(pending,{code:'RESULT_UNKNOWN'});assert.equal(f.host.snapshot().state,'blocked');
    assert.ok(f.calls.some(call=>call[0]==='cdp'&&call[1]==='Browser.cancelDownload'));
    assert.deepEqual(await readdir(path.join(f.directory,'downloads')),[]);
  }finally{await f.close();}
});

test('redirected cross-origin download event is cancelled and never creates an artifact',async()=>{
  const f=await fixture({downloadOperation:async({driver,guid})=>{
    driver.emit('Browser.downloadWillBegin',{guid,url:'https://different.example/file',frameId:'frame-main',suggestedFilename:'file.bin'});
  }});try{
    const opened=await f.invoke('open',{url:'https://example.com/'});
    await assert.rejects(f.invoke('download',{targetRef:opened.targetRef,ref:'r4'}),{code:'RESULT_UNKNOWN'});
    assert.deepEqual(await readdir(path.join(f.directory,'downloads')),[]);
  }finally{await f.close();}
});

test('failure to restore download deny is fail-closed rather than leaving permissive behavior active',async()=>{
  const f=await fixture({failDownloadDeny:true});try{
    const opened=await f.invoke('open',{url:'https://example.com/'});
    await assert.rejects(f.invoke('download',{targetRef:opened.targetRef,ref:'r4'}),{code:'RESULT_UNKNOWN'});
    assert.equal(f.host.snapshot().state,'blocked');assert.equal(f.host.snapshot().connected,false);
    assert.deepEqual(await readdir(path.join(f.directory,'downloads')),[]);
  }finally{await f.close();}
});

test('response-stage header gate rejects compression before body continuation, closing the expansion loophole',async()=>{
  const f=await fixture({downloadOperation:async({frameDriver})=>{
    frameDriver.emit('Fetch.requestPaused',{requestId:'gzip-fixture',request:{url:'https://example.com/download'},responseStatusCode:200,
      responseHeaders:[{name:'Content-Encoding',value:'identity'},{name:'Content-Encoding',value:'gzip'},{name:'Content-Length',value:'128'}]});
  }});try{
    const opened=await f.invoke('open',{url:'https://example.com/'});
    await assert.rejects(f.invoke('download',{targetRef:opened.targetRef,ref:'r4'}),{code:'RESULT_UNKNOWN'});
    assert.ok(f.calls.some(call=>call[0]==='frame-cdp'&&call[1]==='Fetch.failRequest'&&call[2].requestId==='gzip-fixture'));
    assert.equal(f.calls.some(call=>call[0]==='frame-cdp'&&call[1]==='Fetch.continueResponse'),false);
    assert.match(f.host.snapshot().failure.message,/响应编码/);assert.deepEqual(await readdir(path.join(f.directory,'downloads')),[]);
  }finally{await f.close();}
});

test('download request-stage gate refuses an expanded origin before continuing network traffic',async()=>{
  const f=await fixture({downloadOperation:async({frameDriver})=>{
    frameDriver.emit('Fetch.requestPaused',{requestId:'expanded-origin',request:{url:'https://different.example/attachment'}});
  }});try{
    const opened=await f.invoke('open',{url:'https://example.com/'});
    await assert.rejects(f.invoke('download',{targetRef:opened.targetRef,ref:'r4'}),{code:'RESULT_UNKNOWN'});
    assert.ok(f.calls.some(call=>call[0]==='frame-cdp'&&call[1]==='Fetch.failRequest'&&call[2].requestId==='expanded-origin'));
    assert.equal(f.calls.some(call=>call[0]==='frame-cdp'&&call[1]==='Fetch.continueRequest'),false);
  }finally{await f.close();}
});

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const stopServer=server=>new Promise(resolve=>server.close(resolve));
const proxyAuthorization=proxy=>'Basic '+Buffer.from(proxy.username+':'+proxy.password).toString('base64');
function proxyRequest(proxy,url,headers={}) {
  return new Promise((resolve,reject)=>{const request=httpRequest(proxy.server,{path:url,headers},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('aborted',()=>reject(Error('synthetic proxy response aborted')));response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString()}));
  });request.on('error',reject);request.end();});
}
test('loopback proxy authenticates, pins approved IP to actual dial and strips hop/proxy credentials',async()=>{
  const target=createHttpServer((request,response)=>{response.end(JSON.stringify(request.headers));});await listen(target);
  const dials=[];const proxy=await createBrowserEgressProxy({dnsLookup:publicDns,connect:options=>{
    dials.push(options);return netConnect({host:'127.0.0.1',port:target.address().port});}});
  try {
    assert.equal((await proxyRequest(proxy,'http://example.com/')).status,407);assert.equal(dials.length,0);
    const reply=await proxyRequest(proxy,'http://example.com/path',{'proxy-authorization':proxyAuthorization(proxy),
      connection:'x-private-hop','x-private-hop':'not-forwarded','proxy-connection':'keep-alive'});
    assert.equal(reply.status,200);assert.deepEqual(dials,[{host:'93.184.216.34',port:80}]);
    const headers=JSON.parse(reply.body);assert.equal(headers.host,'example.com');assert.equal(headers['proxy-authorization'],undefined);
    assert.equal(headers['x-private-hop'],undefined);assert.equal(headers['proxy-connection'],undefined);
    assert.equal((await proxyRequest(proxy,'http://u:p@example.com/',{'proxy-authorization':proxyAuthorization(proxy)})).status,403);
    assert.equal((await proxyRequest(proxy,'http://example.com:8080/',{'proxy-authorization':proxyAuthorization(proxy)})).status,403);
  }finally{await proxy.close();await stopServer(target);}
});

test('proxy DNS rebinding or mixed private answers cannot dial; IPv6 dials use the exact approved address',async()=>{
  for(const answers of [[[{address:'8.8.8.8'}],[{address:'127.0.0.1'}]],[[{address:'8.8.8.8'},{address:'10.1.2.3'}]]]) {
    let resolution=0,dials=0;
    const proxy=await createBrowserEgressProxy({dnsLookup:async()=>answers[Math.min(resolution++,answers.length-1)],connect:()=>{dials++;throw Error('must not dial');}});
    try{assert.equal((await proxyRequest(proxy,'http://rebind.example/',{'proxy-authorization':proxyAuthorization(proxy)})).status,403);assert.equal(dials,0);}
    finally{await proxy.close();}
  }
  const target=createHttpServer((_request,response)=>response.end('ipv6 pin fixture'));await listen(target);
  const dials=[],proxy=await createBrowserEgressProxy({connect:options=>{dials.push(options);return netConnect({host:'127.0.0.1',port:target.address().port});}});
  try{assert.equal((await proxyRequest(proxy,'http://[2606:4700:4700::1111]/',{'proxy-authorization':proxyAuthorization(proxy)})).status,200);
    assert.deepEqual(dials,[{host:'2606:4700:4700::1111',port:80}]);}
  finally{await proxy.close();await stopServer(target);}
});

test('CONNECT is an authenticated pinned TCP tunnel and proxy close destroys its own sockets',async()=>{
  const target=createTcpServer(socket=>socket.pipe(socket));await listen(target);
  const dials=[],proxy=await createBrowserEgressProxy({dnsLookup:publicDns,connect:options=>{dials.push(options);return netConnect({host:'127.0.0.1',port:target.address().port});}});
  let socket;
  try {
    socket=netConnect(new URL(proxy.server).port,'127.0.0.1');
    const response=await new Promise((resolve,reject)=>{let text='';socket.setTimeout(3000,()=>reject(Error('CONNECT fixture timed out')));
      socket.on('error',reject);socket.on('data',chunk=>{text+=chunk.toString();if(text.includes('fixture-ping'))resolve(text);});
      socket.on('connect',()=>socket.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: '+proxyAuthorization(proxy)+'\r\n\r\nfixture-ping'));});
    assert.ok(response.startsWith('HTTP/1.1 200 Connection Established'));assert.deepEqual(dials,[{host:'93.184.216.34',port:443}]);
    const disconnected=new Promise(resolve=>socket.once('close',resolve));await proxy.close();await disconnected;
  }finally{socket?.destroy();await proxy.close();await stopServer(target);}
});

test('proxy response guards stop HTTP body and CONNECT ciphertext before an oversized chunk can pass',async()=>{
  const httpTarget=createHttpServer((_request,response)=>response.end(Buffer.alloc(64,65)));await listen(httpTarget);
  let counted=0,passed=0;
  const proxy=await createBrowserEgressProxy({dnsLookup:publicDns,connect:()=>netConnect({host:'127.0.0.1',port:httpTarget.address().port}),
    onResponseBytes(_url,size){counted+=size;if(counted>16)throw Error('synthetic download byte budget');}});
  try{
    await new Promise(resolve=>{const request=httpRequest(proxy.server,{path:'http://example.com/file',headers:{'proxy-authorization':proxyAuthorization(proxy)}},response=>{
      response.on('data',chunk=>{passed+=chunk.length;});response.on('aborted',resolve);response.on('end',resolve);
    });request.on('error',resolve);request.end();});
    assert.ok(counted>16);assert.ok(passed<=16);
  }finally{await proxy.close();await stopServer(httpTarget);}
  const tcpTarget=createTcpServer(socket=>socket.end(Buffer.alloc(64,66)));await listen(tcpTarget);let socket;
  counted=0;
  const tunnel=await createBrowserEgressProxy({dnsLookup:publicDns,connect:()=>netConnect({host:'127.0.0.1',port:tcpTarget.address().port}),
    onResponseBytes(_url,size){counted+=size;if(counted>16)throw Error('synthetic encrypted download byte budget');}});
  try{
    const chunks=[];socket=netConnect(new URL(tunnel.server).port,'127.0.0.1');
    await new Promise(resolve=>{socket.on('error',()=>{});socket.on('data',chunk=>chunks.push(chunk));socket.on('close',resolve);
      socket.on('connect',()=>socket.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: '+proxyAuthorization(tunnel)+'\r\n\r\n'));});
    const bytes=Buffer.concat(chunks),end=bytes.indexOf('\r\n\r\n');assert.ok(counted>16);assert.ok(end>=0);assert.ok(bytes.length-end-4<=16);
  }finally{socket?.destroy();await tunnel.close();await stopServer(tcpTarget);}
});
