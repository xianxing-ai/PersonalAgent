import test from 'node:test';
import assert from 'node:assert/strict';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {assertOpenCliPublicUrl,createOpenCliBrowserHost,OPENCLI_EXTENSION_GUIDE,projectOpenCliPage,checkOpenCliControl,operateOpenCliControl} from '../electron/opencli-browser-host.js';

function fixture({resolve,pageEvaluate,probe}={}) {
  let allowed=true,valid=true,value='',failAfterWrite=false,identity=true,sequence=0,writes=0,opens=0,disposed=0,mode='input';
  let title='Fixture',text='Public test',url='https://example.com/',clickedHref;
  const records=[],saved=new Set(),deadline=new Date(Date.now()+60000).toISOString(),controller=new AbortController();
  const lookups=[];
  const page={newTab:async()=>{opens++;return 'owned-tab';},setActivePage:()=>{},dispose:()=>{disposed++;},evaluate:async(fn,...args)=>{
    if(pageEvaluate)return pageEvaluate(fn,...args);
    if(fn===projectOpenCliPage){
      if(mode==='button')return {url,title,text,controls:[{ref:'c0',...(writes&&identity?{actionRef:'c0'}:{}),tag:'button',type:'',name:'Go'}]};
      if(mode==='link')return {url,title,text,controls:writes?[]:[{ref:'c0',tag:'a',type:'',name:'Next',href:clickedHref??'https://example.com/next'}]};
      return {url,title,text,controls:[{ref:'c0',...(writes&&identity?{actionRef:'c0'}:{}),tag:'input',type:'text',name:'Test',value}]};
    }
    if(fn===checkOpenCliControl)return valid;
    assert.equal(fn,operateOpenCliControl);writes++;
    if(args[4]==='click'){
      if(mode==='link'){url='https://example.com/next';title='Next';text='Moved';}
      if(failAfterWrite)throw Error('lost response');
      return {applied:true};
    }
    value=args[5];if(failAfterWrite)throw Error('lost response');return {applied:true,actual:value};
  }};
  const dns=resolve??(async(host,{all}={})=>{
    lookups.push(host);
    return all?[{address:'93.184.216.34'}]:[{address:'93.184.216.34'}];
  });
  const host=createOpenCliBrowserHost({readTask:()=>({state:'running'}),authorize:async()=>allowed,
    createPage:async()=>page,resolve:dns,probe:probe??(async()=>{})});
  const runtime={listTasks:()=>({items:[]}),readToolExecutions:()=>records,
    loadCheckpoint:()=>deadline,matchesToolExecutionInput:(run,input)=>run.digest===toolArgumentsDigest(input.arguments),
    saveCheckpointOnce:(_task,key)=>{if(saved.has(key))return false;saved.add(key);return true;}};
  host.bind({runtime});
  const run=(kind,args={})=>{
    const runId='run-'+(++sequence),name='browser.connected.'+kind;
    records.push({evidenceId:runId,taskId:'test-task',toolName:name,toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'started',digest:toolArgumentsDigest(args)});
    return host.tools.find(tool=>tool.descriptor.name===name).execute(args,{taskId:'test-task',runId,deadline,signal:controller.signal,
      authorizationRef:'grant',scopes:['computer:browser:connected'],argumentsDigest:toolArgumentsDigest(args)});
  };
  return {host,run,controller,records,runtime,lookups,get opens(){return opens;},get writes(){return writes;},get disposed(){return disposed;},
    deny:()=>{allowed=false;},stale:()=>{valid=false;},loseReply:()=>{failAfterWrite=true;},replaceElement:()=>{identity=false;},
    asButton:()=>{mode='button';},asLink:()=>{mode='link';clickedHref='https://example.com/next';}};
}

test('OpenCLI task opens its own tab, observes, types once and independently reads back',async()=>{
  const f=fixture(),opened=await f.run('open',{url:'https://example.com/'});
  assert.equal(opened.source,'opencli');assert.equal(opened.goalVerified,false);
  f.host.start(); // Repeated preparation must not orphan the existing task page.
  const result=await f.run('type',{targetRef:opened.targetRef,ref:'c0',text:'PersonalAgent'});
  assert.equal(result.fieldVerified,true);assert.equal(result.controls[0].value,'PersonalAgent');
  assert.equal(result.goalVerified,false);assert.equal(f.writes,1);assert.equal(f.opens,1);
  await assert.rejects(f.run('type',{targetRef:opened.targetRef,ref:'c0',text:'duplicate'}),{code:'TARGET_STALE'});
  assert.equal(f.writes,1);await f.host.close();assert.equal(f.disposed,1);
});

test('click independently reads back retained controls or same-origin navigation',async()=>{
  const retained=fixture();retained.asButton();
  const opened=await retained.run('open',{url:'https://example.com/'});
  const clicked=await retained.run('click',{targetRef:opened.targetRef,ref:'c0'});
  assert.equal(clicked.state,'action_observed');assert.equal(clicked.fieldVerified,true);
  assert.equal(retained.writes,1);await retained.host.close();

  const navigated=fixture();navigated.asLink();
  const page=await navigated.run('open',{url:'https://example.com/'});
  const after=await navigated.run('click',{targetRef:page.targetRef,ref:'c0'});
  assert.equal(after.url,'https://example.com/next');assert.equal(after.fieldVerified,true);
  await navigated.host.close();
});

test('open and observe perform dual DNS admission before browser contact',async()=>{
  const f=fixture();
  await f.run('open',{url:'https://example.com/path'});
  assert.ok(f.lookups.length>=2,'expected admission plus independent second lookup');
  const before=f.lookups.length;
  await f.run('observe');
  assert.ok(f.lookups.length>before);await f.host.close();
});

test('DNS rebinding to a private address is refused on the second lookup',async()=>{
  let round=0;
  const f=fixture({resolve:async()=>{
    round++;
    return [{address:round===1?'93.184.216.34':'127.0.0.1'}];
  }});
  await assert.rejects(f.run('open',{url:'https://example.com/'}),{code:'UNAUTHORIZED'});
  assert.equal(f.opens,0);await f.host.close();
});

test('assertOpenCliPublicUrl rejects private answers on either lookup',async()=>{
  await assert.rejects(assertOpenCliPublicUrl('https://example.com/',{dnsLookup:async()=>[{address:'10.0.0.1'}]}),{code:'UNAUTHORIZED'});
  let n=0;
  await assert.rejects(assertOpenCliPublicUrl('https://example.com/',{dnsLookup:async()=>[{address:++n===1?'93.184.216.34':'192.168.1.1'}]}),{code:'UNAUTHORIZED'});
});

test('wait re-observes without writing',async()=>{
  const f=fixture(),opened=await f.run('open',{url:'https://example.com/'});
  const waited=await f.run('wait',{milliseconds:1});
  assert.equal(waited.state,'observed');assert.notEqual(waited.targetRef,opened.targetRef);
  assert.equal(f.writes,0);await f.host.close();
});

test('revoked access and stale DOM prevent input',async()=>{
  for(const reason of ['deny','stale']){const f=fixture(),opened=await f.run('open',{url:'https://example.com/'});f[reason]();
    await assert.rejects(f.run('type',{targetRef:opened.targetRef,ref:'c0',text:'blocked'}),{code:reason==='deny'?'UNAUTHORIZED':'TARGET_STALE'});
    assert.equal(f.writes,0);await f.host.close();}
});

test('matching text in a replacement control is not proof that the original input survived',async()=>{
  const f=fixture(),opened=await f.run('open',{url:'https://example.com/'});f.replaceElement();
  await assert.rejects(f.run('type',{targetRef:opened.targetRef,ref:'c0',text:'PersonalAgent'}),{code:'RESULT_UNKNOWN'});
  assert.equal(f.writes,1);assert.equal(f.host.snapshot().state,'blocked');await f.host.close();
});

test('lost write receipt blocks subsequent commands and cannot be retried',async()=>{
  const f=fixture(),opened=await f.run('open',{url:'https://example.com/'});f.loseReply();
  await assert.rejects(f.run('type',{targetRef:opened.targetRef,ref:'c0',text:'once'}),{code:'RESULT_UNKNOWN'});
  await assert.rejects(f.run('observe'),{code:'RESULT_UNKNOWN'});assert.equal(f.writes,1);assert.equal(f.host.snapshot().state,'blocked');
  await f.host.close();
});

test('private URLs and changed runtime parameters never reach the browser',async()=>{
  const f=fixture();await assert.rejects(f.run('open',{url:'file:///C:/private.txt'}),{code:'UNAUTHORIZED'});
  const tool=f.host.tools[0];await assert.rejects(tool.execute({url:'https://example.com/'},{taskId:'test-task',runId:'forged',deadline:new Date(Date.now()+60000).toISOString(),signal:f.controller.signal}),{code:'UNAUTHORIZED'});
  assert.equal(f.opens,0);await f.host.close();
});

test('restart retains unknown writes from the original Runtime',()=>{
  const f=fixture();f.host.bind({runtime:{...f.runtime,listTasks:()=>({items:[{taskId:'old'}]}),readToolExecutions:()=>[
    {toolName:'browser.connected.type',policyDecision:'allow',executionStarted:true,state:'unknown'}]}});
  assert.equal(f.host.snapshot().state,'blocked');
});

test('result export rejects mismatched and superseded observations',async()=>{
  const f=fixture(),first=await f.run('open',{url:'https://example.com/'});
  const policy=f.host.competitionToolExports[0],scope={taskId:'test-task',runId:'run-1',signal:f.controller.signal};
  await assert.rejects(policy.project({...scope,result:{...first,text:'forged'}}),{code:'UNAUTHORIZED'});
  await f.run('observe');await assert.rejects(policy.project({...scope,result:first}),{code:'UNAUTHORIZED'});
  await f.host.close();
});

test('stopping the host terminates only its worker and rejects subsequent operations',async()=>{
  const f=fixture();await f.run('open',{url:'https://example.com/'});await f.host.stop();assert.equal(f.disposed,1);
  await assert.rejects(f.run('observe'),{code:'CANCELLED'});assert.equal(f.writes,0);
});

test('extension probe reports fixed install guidance without opening a tab',async()=>{
  const ready=fixture();
  const ok=await ready.host.probeExtension();
  assert.equal(ok.connected,true);assert.equal(ready.host.snapshot().extension.state,'ready');
  assert.match(ready.host.snapshot().guide, /Browser Bridge/);
  assert.equal(ready.opens,0);await ready.host.close();

  const missing=fixture({probe:async()=>{throw Object.assign(Error(OPENCLI_EXTENSION_GUIDE),{code:'UNSUPPORTED_CAPABILITY'});}});
  // ProtocolError path via probe that throws ProtocolError-like — use host with failing probe that createOpenCli uses
  const failing=createOpenCliBrowserHost({readTask:()=>({state:'running'}),authorize:async()=>true,
    createPage:async()=>({dispose(){}}),resolve:async()=>[{address:'93.184.216.34'}],
    probe:async()=>{const {ProtocolError}=await import('@personal-agent/contracts');throw new ProtocolError('UNSUPPORTED_CAPABILITY',OPENCLI_EXTENSION_GUIDE);}});
  failing.bind({runtime:{listTasks:()=>({items:[]}),readToolExecutions:()=>[],loadCheckpoint:()=>new Date(Date.now()+60000).toISOString(),
    matchesToolExecutionInput:()=>true,saveCheckpointOnce:()=>true}});
  await assert.rejects(failing.probeExtension(),{code:'UNSUPPORTED_CAPABILITY',message:OPENCLI_EXTENSION_GUIDE});
  assert.equal(failing.snapshot().extension.state,'unavailable');
  assert.equal(failing.snapshot().guide,OPENCLI_EXTENSION_GUIDE);await failing.close();
  await missing.host.close();
});
