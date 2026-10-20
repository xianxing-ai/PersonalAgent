import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtocolError} from '@personal-agent/contracts';
import {FakeMailProvider} from '@personal-agent/mail';
import {FakeCalendarProvider} from '@personal-agent/calendar';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {Client} from '@personal-agent/client';
import {createConnectorConversationTools} from '../electron/connector-conversation-tools.js';

function fixture(t,overrides={}) {
  let mail={user:'synthetic@qq.com',authCode:'synthetic-private-code',revision:1},calendar={calendarUrl:'https://calendar.example.invalid/collection/',calendarName:'Synthetic',revision:1};
  const calls=[],consents=[],provider=new FakeMailProvider();
  provider.saveDraft=async(_account,input)=>{calls.push('draft');return {actionId:'draft:'+input.idempotencyKey,state:'confirmed',evidenceRefs:['synthetic:draft']};};
  provider.assertSendIdentity=(_account,messageId,key)=>{if(messageId!=='<known@example.invalid>'||key!=='known')throw new ProtocolError('UNAUTHORIZED','Unknown original send');};
  provider.reconcileSend=async()=>{calls.push('reconcile');return {state:'confirmed',messageId:'<known@example.invalid>'};};
  const originalMark=provider.markSeen.bind(provider);provider.markSeen=(...args)=>{calls.push('mark');return originalMark(...args);};
  const cp=new FakeCalendarProvider(),originalFetch=cp.fetchWindow.bind(cp);cp.fetchWindow=(...args)=>{calls.push('calendar');return originalFetch(...args);};
  const host=createConnectorConversationTools({mail:{current:()=>mail},calendar:{binding:()=>calendar,readAuthorization:()=> 'Basic c3ludGhldGljOnBhc3N3b3Jk'},
    getApplication:()=>({runtime:{getTask:()=>({state:'running',cancelRequested:false})}}),resolveConversation:()=> 'synthetic-conversation',
    createMailProvider:()=>{calls.push('mail-provider');return provider;},createCalendarProvider:()=>cp,
    confirmExport:async request=>{consents.push(request.kind);return true;},...overrides});
  t.after(()=>host.close());
  return {host,calls,consents,provider,cp,revokeMail:()=>{mail=undefined;},rotateCalendar:()=>{calendar={...calendar,revision:2};}};
}
function scope(tool,args={},id=crypto.randomUUID(),controller=new AbortController()) {
  return {taskId:'original',deadline:new Date(Date.now()+30000).toISOString(),signal:controller.signal,
    authorizationRef:'original-runtime-grant',scopes:tool.descriptor.requiredScopes,runId:id,
    proposal:{proposalId:id,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:args}};
}
async function prepare(host,name,args={}) {
  const tool=host.tools.find(t=>t.descriptor.name===name),s=scope(tool,args);
  await host.prepareExport({...s,phase:'preflight'});
  return {tool,s,policy:host.competitionToolExports.find(p=>p.toolName===name)};
}
async function project(policy,s,result){return policy.project({taskId:s.taskId,proposalId:s.proposal.proposalId,result,signal:s.signal});}

test('registers only existing supplemental tools; missing configuration and absent native consent stay closed',async t=>{
  const f=fixture(t,{mail:{current:()=>undefined},calendar:{binding:()=>undefined}});
  assert.deepEqual(f.host.tools.map(t=>t.descriptor.name),['mail.inbox','mail.accounts','mail.mark_seen','mail.save_draft','mail.reconcile_send','calendar.events']);
  for(const tool of f.host.tools){const s=scope(tool);assert.equal(await f.host.competitionToolAvailability.find(x=>x.toolName===tool.descriptor.name).available(s),false);
    await assert.rejects(f.host.prepareExport({...s,phase:'preflight'}),{code:'UNAUTHORIZED'});}
  assert.deepEqual(f.calls,[]);
  const denied=fixture(t,{confirmExport:async()=>false});await assert.rejects(prepare(denied.host,'mail.accounts'),{code:'UNAUTHORIZED'});assert.deepEqual(denied.calls,[]);
});

test('public mail account, draft, mark-seen, reconciliation and calendar implementations execute under exact permits',async t=>{
  const f=fixture(t);
  for(const [name,args]of [['mail.inbox',{limit:2}],['mail.accounts',{}],['mail.mark_seen',{folder:'INBOX',uid:2}],
    ['mail.save_draft',{to:'synthetic@example.invalid',subject:'Synthetic draft',text:'Synthetic body'}],
    ['mail.reconcile_send',{messageId:'<known@example.invalid>',idempotencyKey:'known'}],
    ['calendar.events',{fromUtc:'2026-09-06T00:00:00.000Z',toUtc:'2026-09-08T00:00:00.000Z'}]]){
    const {tool,s,policy}=await prepare(f.host,name,args);const result=await tool.execute(args,s);
    assert.deepEqual(await project(policy,s,result),result);
    assert.equal(policy.accepts({taskId:s.taskId,proposalId:s.proposal.proposalId,arguments:args,phase:'final',projection:result}),true);
    assert.equal(policy.accepts({taskId:s.taskId,proposalId:s.proposal.proposalId,arguments:{...args,injected:true}}),false);
  }
  assert.ok(f.calls.includes('draft'));assert.ok(f.calls.includes('mark'));assert.ok(f.calls.includes('calendar'));
  assert.equal(f.calls.filter(x=>x==='mail-provider').length,5);
});

test('cross-account requests, missing Runtime grant and unknown sends never reach a provider write or Sent read',async t=>{
  const f=fixture(t),a=await prepare(f.host,'mail.mark_seen',{account:'other',folder:'INBOX',uid:2});
  await assert.rejects(a.tool.execute(a.s.proposal.arguments,a.s),{code:'UNAUTHORIZED'});assert.deepEqual(f.calls,[]);
  const b=await prepare(f.host,'mail.save_draft',{to:'synthetic@example.invalid',subject:'s',text:'t'});
  await assert.rejects(b.tool.execute(b.s.proposal.arguments,{...b.s,authorizationRef:undefined}),{code:'UNAUTHORIZED'});
  const c=await prepare(f.host,'mail.reconcile_send',{messageId:'<unknown@example.invalid>',idempotencyKey:'unknown'});
  await assert.rejects(c.tool.execute(c.s.proposal.arguments,c.s),{code:'UNAUTHORIZED'});assert.equal(f.calls.includes('reconcile'),false);
});

test('configuration revocation and rotation invalidate original result exports and stop reused permits',async t=>{
  const f=fixture(t),{tool,s,policy}=await prepare(f.host,'mail.accounts'),result=await tool.execute({},s);
  await project(policy,s,result);f.revokeMail();assert.equal(policy.accepts({taskId:s.taskId,proposalId:s.proposal.proposalId,arguments:{},phase:'final',projection:result}),false);
  await assert.rejects(tool.execute({},s),{code:'UNAUTHORIZED'});
  const c=await prepare(f.host,'calendar.events');f.rotateCalendar();await assert.rejects(c.tool.execute({},c.s),{code:'UNAUTHORIZED'});
});

test('revoking mail preserves an independently approved calendar operation and result export',async t=>{
  const f=fixture(t),mail=await prepare(f.host,'mail.accounts'),calendar=await prepare(f.host,'calendar.events');
  const result=await calendar.tool.execute({},calendar.s);await project(calendar.policy,calendar.s,result);
  await f.host.invalidate('mail');await assert.rejects(mail.tool.execute({},mail.s),{code:'UNAUTHORIZED'});
  assert.equal(calendar.policy.accepts({taskId:calendar.s.taskId,proposalId:calendar.s.proposal.proposalId,arguments:{},phase:'final',projection:result}),true);
  assert.deepEqual(await calendar.tool.execute({},calendar.s),result);
});

test('denied result export and host credentials cannot be sent to the model',async t=>{
  const f=fixture(t,{confirmExport:async request=>request.kind!=='connector_tool_result'}),{tool,s,policy}=await prepare(f.host,'mail.accounts'),result=await tool.execute({},s);
  await assert.rejects(project(policy,s,result),{code:'UNAUTHORIZED'});
  const g=fixture(t);await assert.rejects(prepare(g.host,'mail.save_draft',{to:'synthetic@example.invalid',subject:'s',text:'synthetic-private-code'}),{code:'UNAUTHORIZED'});
  assert.deepEqual(g.calls,[]);
});

test('cancelled native confirmation and explicit invalidation do not create usable leases',async t=>{
  let started;const startedPromise=new Promise(r=>{started=r;});
  const f=fixture(t,{confirmExport:async()=>{started();return new Promise(()=>{});}}),tool=f.host.tools[0],controller=new AbortController(),s=scope(tool,{},'cancelled',controller);
  const pending=f.host.prepareExport({...s,phase:'preflight'});await startedPromise;controller.abort();await assert.rejects(pending,{code:'UNAUTHORIZED'});assert.deepEqual(f.calls,[]);
  const g=fixture(t),a=await prepare(g.host,'mail.accounts');await g.host.invalidate();await assert.rejects(a.tool.execute({},a.s),{code:'UNAUTHORIZED'});
});

test('original local inbox batch keeps its original session guard without gaining a cloud permit',async t=>{
  let local=0;const f=fixture(t,{resolveConversation:()=>undefined,localInbox:{execute:async(_input,context)=>{
    if(context.taskId!=='local-batch')throw new ProtocolError('UNAUTHORIZED','Original session only');local++;return {local:true};}}});
  const tool=f.host.tools.find(t=>t.descriptor.name==='mail.inbox'),s=scope(tool);
  assert.deepEqual(await tool.execute({}, {...s,taskId:'local-batch'}),{local:true});
  await assert.rejects(tool.execute({},s),{code:'UNAUTHORIZED'});assert.equal(local,1);assert.deepEqual(f.calls,[]);
  assert.equal(f.host.competitionToolExports.find(p=>p.toolName==='mail.inbox').accepts({taskId:'local-batch',proposalId:'not-a-cloud-permit',arguments:{}}),false);
});

test('a hanging provider respects cancellation and deadline without retrying the original write',async t=>{
  for(const timeout of [false,true])await t.test(timeout?'deadline':'cancel',async t=>{
    let started,calls=0,disposals=0;const invoked=new Promise(r=>{started=r;});const provider=new FakeMailProvider();
    provider.saveDraft=async()=>{calls++;started();return new Promise(()=>{});};provider.dispose=async()=>{disposals++;};
    const f=fixture(t,{createMailProvider:()=>provider}),tool=f.host.tools.find(t=>t.descriptor.name==='mail.save_draft'),controller=new AbortController();
    const args={to:'synthetic@example.invalid',subject:'Synthetic',text:'t'},s=scope(tool,args,'original-write',controller);
    if(timeout)s.deadline=new Date(Date.now()+500).toISOString();await f.host.prepareExport({...s,phase:'preflight'});
    const pending=tool.execute(args,s);await invoked;if(!timeout)controller.abort();
    await assert.rejects(pending,{code:timeout?'TIMEOUT':'CANCELLED'});assert.equal(calls,1);assert.equal(disposals,1);
  });
});

test('hanging asynchronous disposal cannot delay cancellation or timeout',async t=>{
  for(const timeout of [false,true])await t.test(timeout?'timeout':'cancel',{timeout:3000},async t=>{
    let started,release,calls=0,disposals=0;const invoked=new Promise(r=>{started=r;});
    const cleanup=new Promise(r=>{release=r;});t.after(()=>release());
    const provider=new FakeMailProvider();provider.saveDraft=()=>{calls++;started();return new Promise(()=>{});};
    provider.dispose=()=>{disposals++;return cleanup;};
    const f=fixture(t,{createMailProvider:()=>provider}),tool=f.host.tools.find(t=>t.descriptor.name==='mail.save_draft');
    const controller=new AbortController(),args={to:'synthetic@example.invalid',subject:'s',text:'t'},s=scope(tool,args,'hanging-dispose',controller);
    if(timeout)s.deadline=new Date(Date.now()+100).toISOString();
    await f.host.prepareExport({...s,phase:'preflight'});
    const pending=tool.execute(args,s);await invoked;if(!timeout)controller.abort();
    let timer;const bound=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('execute waited for disposal')),1000);});
    try {await assert.rejects(Promise.race([pending,bound]),{code:timeout?'TIMEOUT':'CANCELLED'});}
    finally {clearTimeout(timer);release();}
    assert.equal(disposals,1);assert.equal(calls,1);
  });
});

test('asynchronous credential reads stop on cancellation and cannot create a provider after configuration rotation',async t=>{
  let release,started,creations=0;const called=new Promise(r=>{started=r;});let revision=1;
  const f=fixture(t,{calendar:{binding:()=>({calendarUrl:'https://calendar.example.invalid/',revision}),readAuthorization:()=>{
    started();return new Promise(r=>{release=r;});}},createCalendarProvider:()=>{creations++;return new FakeCalendarProvider();}});
  const {tool,s}=await prepare(f.host,'calendar.events');const controller=new AbortController(),pending=tool.execute({}, {...s,signal:controller.signal});
  await called;controller.abort();await assert.rejects(pending,{code:'CANCELLED'});revision=2;release('Basic c3ludGhldGljOnBhc3N3b3Jk');
  await new Promise(r=>setTimeout(r,0));assert.equal(creations,0);
});

test('late credentials after cancellation, timeout or family revoke never create a provider',async t=>{
  for(const mode of ['cancel','timeout','revoke'])await t.test(mode,async t=>{
    let release,started,creations=0;const called=new Promise(r=>{started=r;});
    const f=fixture(t,{calendar:{binding:()=>({calendarUrl:'https://calendar.example.invalid/',revision:1}),
      readAuthorization:()=>{started();return new Promise(r=>{release=r;});}},
      createCalendarProvider:()=>{creations++;return new FakeCalendarProvider();}});
    const tool=f.host.tools.find(t=>t.descriptor.name==='calendar.events'),controller=new AbortController(),s=scope(tool,{},mode,controller);
    if(mode==='timeout')s.deadline=new Date(Date.now()+500).toISOString();
    await f.host.prepareExport({...s,phase:'preflight'});const pending=tool.execute({},s);
    await called;const rejected=assert.rejects(pending,{code:mode==='timeout'?'TIMEOUT':'CANCELLED'});
    if(mode==='cancel')controller.abort();if(mode==='revoke')await f.host.invalidate('calendar');
    await rejected;release('Basic c3ludGhldGljOnBhc3N3b3Jk');await new Promise(r=>setImmediate(r));assert.equal(creations,0);
  });
});

test('same-account concurrent tasks own independent providers; cancelling A preserves B',async t=>{
  const providers=[];
  const f=fixture(t,{createMailProvider:()=>{
    const p=new FakeMailProvider();p.disposals=0;
    p.saveDraft=()=>new Promise((resolve,reject)=>{p.resolve=()=>resolve({state:'confirmed',actionId:'draft',evidenceRefs:[]});p.reject=reject;});
    p.dispose=()=>{p.disposals++;p.reject?.(new Error('connection closed'));};providers.push(p);return p;
  }});
  const tool=f.host.tools.find(t=>t.descriptor.name==='mail.save_draft'),args={to:'synthetic@example.invalid',subject:'s',text:'t'};
  const a=new AbortController(),b=new AbortController();
  const sa={...scope(tool,args,'a',a),taskId:'task-a'},sb={...scope(tool,args,'b',b),taskId:'task-b'};
  for(const s of [sa,sb])await f.host.prepareExport({...s,phase:'preflight'});
  const pa=tool.execute(args,sa),pb=tool.execute(args,sb);a.abort();
  await assert.rejects(pa,{code:'CANCELLED'});assert.equal(providers.length,2);
  assert.equal(providers[0].disposals,1);assert.equal(providers[1].disposals,0);
  providers[1].resolve();assert.equal((await pb).state,'confirmed');assert.equal(b.signal.aborted,false);
  assert.equal(providers[1].disposals,1);
});

test('family revoke stops every in-flight provider once',async t=>{
  const providers=[];const f=fixture(t,{createMailProvider:()=>{
    const p=new FakeMailProvider();p.disposals=0;p.saveDraft=()=>new Promise(()=>{});
    p.dispose=()=>{p.disposals++;};providers.push(p);return p;
  }});
  const tool=f.host.tools.find(t=>t.descriptor.name==='mail.save_draft'),args={to:'synthetic@example.invalid',subject:'s',text:'t'};
  const pending=[];
  for(const id of ['task-a','task-b']){const s={...scope(tool,args,id),taskId:id};
    await f.host.prepareExport({...s,phase:'preflight'});pending.push(tool.execute(args,s));}
  const rejected=Promise.all(pending.map(p=>assert.rejects(p,{code:'CANCELLED'})));
  await f.host.invalidate('mail');await rejected;
  assert.equal(providers.length,2);assert.deepEqual(providers.map(p=>p.disposals),[1,1]);
});

test('actual Runtime asks for approval before a supplemental write and then confirms the original tool result',async t=>{
  let application,sends=0,writes=0;const provider=new FakeMailProvider(),original=provider.markSeen.bind(provider);
  provider.markSeen=(...args)=>{writes++;return original(...args);};
  const host=createConnectorConversationTools({mail:{current:()=>({user:'synthetic@qq.com',authCode:'synthetic-password',revision:1})},
    getApplication:()=>application,resolveConversation:id=>application.runtime.getTask(id).conversationId,
    createMailProvider:()=>provider,confirmExport:async()=>true});t.after(()=>host.close());
  application=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.invalid',runtimeName:'supplemental-tools',
    initialRequestMode:'goal-with-tools-json',responseMode:'tool-proposal-json',continuationContext:'goal',
    tools:host.tools,competitionToolAvailability:host.competitionToolAvailability,competitionToolExports:host.competitionToolExports,
    prepareCompetitionToolExport:scope=>host.prepareExport(scope),authorizationProvider:{read:async()=> 'Bearer synthetic'},
    fetchImpl:async()=>{sends++;return new Response(JSON.stringify({event:'message',data:{index:0,text:JSON.stringify(sends===1
      ?{kind:'tool_proposal',proposalId:'mark',toolName:'mail.mark_seen',toolVersion:'0.1.0-alpha.1',arguments:{folder:'INBOX',uid:2}}
      :{kind:'text',text:'已标记为已读。'})}}),{headers:{'content-type':'application/json'}});}});t.after(()=>application.close());
  const client=new Client(application);await client.connect();const {taskId}=await client.call('task.submit',{goal:'标记合成邮件为已读',conversationId:'synthetic'},{idempotencyKey:'mark',timeoutMs:10000});
  const wait=async predicate=>{const end=Date.now()+10000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error(JSON.stringify(application.runtime.getTask(taskId)));};
  await wait(()=>application.runtime.getTask(taskId).state==='waiting_approval');assert.equal(writes,0);
  const approval=application.runtime.listApprovals({taskId,state:'pending'}).items[0];
  await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  await wait(()=>['succeeded','failed','waiting_reconciliation'].includes(application.runtime.getTask(taskId).state));
  assert.equal(application.runtime.getTask(taskId).state,'succeeded');assert.equal(writes,1);assert.equal(sends,2);
  assert.equal(application.runtime.readToolExecutions(taskId)[0].state,'confirmed');
});
