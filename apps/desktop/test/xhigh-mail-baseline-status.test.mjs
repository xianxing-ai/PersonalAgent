import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {Client} from '@personal-agent/client';
import {createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {FakeMailProvider,register as registerMail} from '@personal-agent/mail';
import {createDesktopConnectorChangeHost} from '../electron/connector-change-host.js';
import {createSnapshotPublisher} from '../electron/snapshot-publisher.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';
import {mountMailControls} from '../src/app/mail-controls.js';
import {createSnapshotReceiver} from '../src/shared/snapshot-receiver.js';

const until=async predicate=>{for(let n=0;n<300;n++){
  if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));
}throw Error('Explicit Fake mail read did not settle');};

test('confirmed watch pages project first read, incomplete baseline, ready and changed epoch without exposing mail data',async t=>{
  let time=Date.now(),epoch=17,configurationRef='synthetic-mail-configuration';
  const namespace='synthetic-mail-baseline-status',watchId='synthetic-approved-watch',conversationId='desktop:mail-owner';
  const watchExpiresAt=new Date(time+60_000).toISOString();let watchCurrent=true,wrongOrigin=false;
  const inbox=[1,2].map(uid=>({uid,folder:'INBOX',from:'sender@example.invalid',to:'fixture@example.invalid',
    subject:'PRIVATE SUBJECT '+uid,sentAt:new Date(time).toISOString(),messageId:`<fixture-${uid}@example.invalid>`,seen:false}));
  const provider=new FakeMailProvider({inbox:[],sent:[]});
  provider.fetchPage=async(account,input)=>new FakeMailProvider({inbox,sent:[]},{inboxUidValidity:epoch,pageSize:100}).fetchPage(account,input);
  const tools=[];registerMail({register(tool){tools.push(tool);return()=>{};}},{provider,accountRef:'fixture-mail',now:()=>time});
  const application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:namespace,
    now:()=>new Date(time),tools,automaticTools:tools.filter(tool=>tool.descriptor.name==='mail.inbox')
      .map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version}))});
  const client=new Client(application,()=>time);await client.connect();
  const readWatchOrigin=id=>{const saved=application.runtime.loadCheckpoint(id,'desktop-connector-watch-origin');
    return watchCurrent&&saved?.watchId===watchId
      ?wrongOrigin?{...saved,watchId:'foreign-watch'}:saved:undefined;};
  const changes=createDesktopConnectorChangeHost({application,namespace,now:()=>time,
    readSourceAuthorization:()=>({available:true,configurationRef}),
    resolveUserConversation:()=>conversationId,
    // Explicit Fake trusted watch-origin reader. Production validates the original
    // watch approval, lease and per-read origin before supplying this binding.
    readWatchOrigin,
    chooser:{snapshot:()=>({ready:false})}});
  t.after(async()=>{await changes.close();application.close();});
  const stage=()=>changes.snapshot({mailWatchId:watchId}).mailWatchBaselines?.[0]?.state;
  assert.equal(stage(),undefined,'a watch with no confirmed read has no host baseline claim');
  let sequence=0;
  async function read(args={},observer=changes) {
    time+=1000;
    const commandId='synthetic-baseline-page-'+(++sequence),deadline=new Date(time+60_000).toISOString();
    const tool=tools[0],prepared=application.prepareHostToolTask({commandId,toolName:tool.descriptor.name,
      toolVersion:tool.descriptor.version,deadline});
    application.runtime.saveCheckpointOnce(prepared.taskId,'desktop-connector-watch-origin',
      {watchId,conversationId,configurationRef,source:'mail',taskId:'approved-watch-start',
        runId:'approved-watch-run',expiresAt:watchExpiresAt});
    application.finalizeHostToolTask({taskId:prepared.taskId,commandId,expectedTaskRevision:prepared.revision,
      arguments:{account:'fixture-mail',folder:'INBOX',...args}});
    await until(()=>['succeeded','failed','waiting_reconciliation'].includes(application.runtime.getTask(prepared.taskId).state));
    const readback=application.readHostToolTask(prepared.taskId);
    assert.equal(readback.task.state,'succeeded',JSON.stringify(readback.task.error));
    assert.ok(readback.confirmed);
    observer.observeTask(prepared.taskId);
    return readback;
  }
  await read({limit:1});assert.equal(stage(),'establishing_baseline',JSON.stringify(changes.snapshot({mailWatchId:watchId})));
  await read({cursor:'17:1',limit:10});assert.equal(stage(),'ready');
  assert.deepEqual(Object.keys(changes.snapshot({mailWatchId:watchId}).mailWatchBaselines[0]).sort(),['state','watchId']);
  assert.deepEqual(changes.snapshot().mailWatchBaselines,[],'unscoped snapshots do not revalidate or expose old watches');
  assert.equal(JSON.stringify(changes.snapshot({mailWatchId:watchId})).includes('PRIVATE SUBJECT'),false);
  epoch=18;await read({limit:1});assert.equal(stage(),'epoch_pending');
  await read({cursor:'18:1',limit:10});assert.equal(stage(),'ready');
  watchCurrent=false;assert.equal(stage(),'unknown','revoked or stopped watch cannot show ready');watchCurrent=true;
  wrongOrigin=true;assert.equal(stage(),'unknown','another watch cannot borrow the baseline');wrongOrigin=false;
  const beforeExpiry=time;time=Date.parse(watchExpiresAt)+1;
  assert.equal(stage(),'unknown','an expired watch cannot show ready');time=beforeExpiry;
  configurationRef='replacement-configuration';assert.equal(stage(),'unknown','old source configuration cannot project readiness');

  // Prior persisted host state lacks the new per-watch mapping and provenance.
  // A fresh confirmed read in the same epoch must not promote its old
  // initialized flag into a verified UI claim.
  configurationRef='synthetic-mail-configuration';
  const store=createRuntimeAtomicStatePort(application.runtime,'desktop-connector-changes');
  const key=createHash('sha256').update(JSON.stringify(namespace)).digest('hex'),saved=store.read(key);
  const old=structuredClone(saved.value);delete old.mailWatchDomains;
  for(const source of Object.values(old.sources))if(source.kind==='mail')delete source.baselineProjectionVersion;
  assert.equal(store.compareAndSet(key,saved.revision,old),true);
  const reopened=createDesktopConnectorChangeHost({application,namespace,now:()=>time,
    readSourceAuthorization:()=>({available:true,configurationRef}),resolveUserConversation:()=>conversationId,
    readWatchOrigin,chooser:{snapshot:()=>({ready:false})}});
  t.after(()=>reopened.close());
  assert.deepEqual(reopened.snapshot({mailWatchId:watchId}).mailWatchBaselines,[]);
  await read({cursor:'18:2'},reopened);
  assert.equal(reopened.snapshot({mailWatchId:watchId}).mailWatchBaselines[0].state,'unknown');
});

test('mail controls distinguish baseline stages and treat absent or old projection as unverified',t=>{
  const dom=authorizationDom(),prior=globalThis.document;globalThis.document=dom.document;
  t.after(()=>{if(prior===undefined)delete globalThis.document;else globalThis.document=prior;});
  const controls=mountMailControls(dom.root,async()=>{});t.after(()=>controls.close());
  const display=baselineState=>{controls.render({configured:true,status:'ready',localModelReady:true,
    monitoring:{enabled:true,state:'monitoring',...(baselineState?{baselineState}:{})}});
    return dom.root.querySelector('[data-mail="monitorStatus"]').textContent;};
  assert.match(display(),/基线状态未核实/);
  assert.doesNotMatch(display(),/^监测中/);
  assert.match(display('waiting_first_read'),/等待首次读取/);
  assert.match(display('establishing_baseline'),/建立首读基线/);
  assert.match(display('ready'),/首读基线已建立/);
  assert.match(display('epoch_pending'),/重新确认首读基线/);
  assert.match(display('unknown'),/基线状态未核实/);
});

test('admin snapshot delivery rerenders mail baseline when only its stage changes',async t=>{
  const dom=authorizationDom(),globals=['document','window','matchMedia'];
  const previous=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const key of globals){const descriptor=previous.get(key);
    if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  globalThis.document=dom.document;
  globalThis.window={addEventListener(){},removeEventListener(){}};
  globalThis.matchMedia=()=>({matches:false,addEventListener(){}});
  const {mountAdmin}=await import('../src/features/admin/view.js');
  const element=()=>({dataset:{},textContent:'',innerHTML:'',hidden:false,
    addEventListener(){},setAttribute(){},insertBefore(){},after(){}});
  const nodes=new Map(['.admin-bar','#admin-close','nav','#admin-search','.advanced-nav','#page-title',
    '#connection','#content','#error'].map(key=>[key,element()]));
  nodes.get('#admin-search').value='';nodes.get('.advanced-nav').open=false;
  nodes.set('.main',dom.root);
  const root={innerHTML:'',querySelector:key=>nodes.get(key)??null,querySelectorAll:()=>[]};
  const admin=mountAdmin(root,async()=>{},value=>String(value??''));
  let baselineState='establishing_baseline';
  const win=Object.assign(new EventEmitter(),{isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,
    webContents:Object.assign(new EventEmitter(),{send(_channel,value){receiver.receive(value);}})});
  const publisher=createSnapshotPublisher({project:()=>({tasks:[],approvals:[],capabilities:[],health:[],
    connection:'fixture',adminNavigation:{page:'connections',revision:1},
    mail:{configured:true,status:'ready',localModelReady:true,monitoring:{enabled:true,state:'monitoring',baselineState}}}),
    schedule:()=>0});
  const receiver=createSnapshotReceiver({render:admin,ack:token=>publisher.ack(win,token)});
  t.after(()=>publisher.close());
  const status=()=>dom.root.querySelector('[data-mail="monitorStatus"]')?.textContent;
  publisher.attach(win,undefined);publisher.flush();assert.match(status(),/建立首读基线/);
  baselineState='ready';publisher.mark();publisher.flush();assert.match(status(),/首读基线已建立/);
  baselineState='epoch_pending';publisher.mark();publisher.flush();assert.match(status(),/重新确认首读基线/);
  assert.doesNotMatch(status(),/首读基线已建立/);
});
