import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyKnownEgressContent,createDesktopEgressHost} from '../electron/egress-host.js';

const request=(extra={})=>({requestId:'request-1',destination:'https://example.test/invoke',payload:'{"query":"summarize public documentation"}',
  deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal,isCurrent:()=>true,...extra});
const denied=error=>error.code==='UNAUTHORIZED';

test('known secrets and personal identifiers are denied before any approval, including nested encoded query',async()=>{
  let called=0;const host=createDesktopEgressHost({classifyLocally:()=>{called++;return 'public';},approvePrivate:()=>{called++;return true;}});
  for(const value of ['Bearer abcdefghijklmnopqrstuvwxyz','person@example.test',{email:'person@example.test'},
    {fullName:'Local Person'},{password:'local-value'},'13800138000','110101199001011234',
    {query:JSON.stringify({input:{apiKey:'local-only-key'}})}]){
    await assert.rejects(host.prepare(request({payload:JSON.stringify(value)})),denied);
  }
  assert.equal(called,0);
});

test('arbitrary names and addresses remain unknown; absence of a pattern never grants public classification',async()=>{
  const payload='Meet Alex at the small house beside the station.';
  assert.equal(classifyKnownEgressContent(payload),'unknown');
  for(const classification of [undefined,'unknown','forbidden',true]){
    await assert.rejects(createDesktopEgressHost({classifyLocally:()=>classification,approvePrivate:()=>true}).prepare(request({payload})),denied);
  }
  await assert.rejects(createDesktopEgressHost().prepare(request({payload})),denied);
});

test('opaque image and audio content cannot be approved by a text classification prompt',async()=>{
  let called=false;const host=createDesktopEgressHost({classifyLocally:()=>{called=true;return 'public';}});
  for(const payload of [JSON.stringify({image_url:{url:'data:image/png;base64,cHVibGlj'}}),JSON.stringify({audio:'cHVibGlj'}),
    JSON.stringify({image_url:'https://example.test/image.png'})])await assert.rejects(host.prepare(request({payload})),error=>error.code==='UNSUPPORTED_CAPABILITY');
  assert.equal(called,false);
});

test('private content requires a separate exact approval while public content does not request it',async()=>{
  let approvals=0;
  const host=createDesktopEgressHost({classifyLocally:()=> 'private',approvePrivate:scope=>{approvals++;assert.equal(scope.payload,request().payload);return true;}});
  const input=request(),lease=await host.prepare(input);lease.assertBeforeSend(input);assert.equal(approvals,1);
  for(const approved of [undefined,false,'yes'])await assert.rejects(createDesktopEgressHost({classifyLocally:()=> 'private',approvePrivate:()=>approved}).prepare(request()),denied);
  const publicHost=createDesktopEgressHost({classifyLocally:()=> 'public',approvePrivate:()=>{throw Error('must not be called');}});
  (await publicHost.prepare(input)).assertBeforeSend(input);
});

test('final send is bound to exact payload, destination, deadline and live source',async()=>{
  let current=true,clock=Date.now();const host=createDesktopEgressHost({classifyLocally:()=> 'public',now:()=>clock});
  const input=request({isCurrent:()=>current}),lease=await host.prepare(input);lease.assertBeforeSend(input);
  assert.throws(()=>lease.assertBeforeSend({...input,payload:'replacement'}),denied);
  assert.throws(()=>lease.assertBeforeSend({...input,destination:'https://other.test/invoke'}),denied);
  current=false;assert.throws(()=>lease.assertBeforeSend(input),denied);current=true;
  clock=Date.parse(input.deadline);assert.throws(()=>lease.assertBeforeSend(input),error=>error.code==='TIMEOUT');
});

test('changed content during local classification cannot reach private approval or a send lease',async()=>{
  const input=request();let approvals=0;
  const host=createDesktopEgressHost({classifyLocally:async()=>{input.payload='changed';return 'private';},approvePrivate:()=>{approvals++;return true;}});
  await assert.rejects(host.prepare(input),denied);assert.equal(approvals,0);
});

test('the same exact request is classified once across nested adapters, rejects another signal and separates destinations',async()=>{
  let classifications=0,approvals=0;
  const host=createDesktopEgressHost({classifyLocally:()=>{classifications++;return 'private';},approvePrivate:()=>{approvals++;return true;}});
  const input=request();(await host.prepare(input)).assertBeforeSend(input);
  (await host.prepare({...input})).assertBeforeSend(input);
  assert.equal(classifications,1);assert.equal(approvals,1);
  await assert.rejects(host.prepare({...input,signal:new AbortController().signal}),denied);
  await host.prepare({...input,destination:'https://other.test/invoke'});
  assert.equal(classifications,2);assert.equal(approvals,2);
});

test('a nested adapter cannot replace the original live source check when reusing classification',async()=>{
  let active=true;const host=createDesktopEgressHost({classifyLocally:()=> 'public'}),input=request({isCurrent:()=>active});
  await host.prepare(input);const lease=await host.prepare({...input,isCurrent:()=>true});active=false;
  assert.throws(()=>lease.assertBeforeSend(input),denied);
});

test('cancellation interrupts unanswered local classification; failures never echo content',async()=>{
  const controller=new AbortController(),host=createDesktopEgressHost({classifyLocally:()=>new Promise(()=>{})});
  const waiting=host.prepare(request({signal:controller.signal}));controller.abort();
  await assert.rejects(waiting,error=>error.code==='CANCELLED');
  await assert.rejects(createDesktopEgressHost({classifyLocally:()=>{throw Error('private-source-must-not-appear');}}).prepare(request()),
    error=>denied(error)&&!error.message.includes('private-source'));
  await assert.rejects(createDesktopEgressHost({classifyLocally:()=> 'public'}).prepare(request({isCurrent:()=>{throw Error('private-source-must-not-appear');}})),
    error=>denied(error)&&!error.message.includes('private-source'));
  const input=request(),closed=createDesktopEgressHost({classifyLocally:()=> 'public'}),lease=await closed.prepare(input);closed.close();
  assert.throws(()=>lease.assertBeforeSend(input),error=>error.code==='CANCELLED');
});
