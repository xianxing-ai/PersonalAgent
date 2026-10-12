import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {openLocalSkillStore,readLocalSkillDirectory} from '@personal-agent/skills';
import {createAgentArtsRuntimeApplication,compileCoordinationGoal} from '../../runtime/dist/application.js';
import {createInstalledSkillsHost} from '../electron/installed-skills-host.js';
import {submitConversationTask} from '../electron/runtime.js';
import {installedSkillRowsHtml} from '../src/app/installed-skills-controls.js';

function fixture(instructions='Use three bullet points.',hooks={}) {
  const cache=path.resolve('.cache/installed-skill-host');mkdirSync(cache,{recursive:true});
  const root=mkdtempSync(path.join(cache,'case-')),source=path.join(root,'meeting-outline');mkdirSync(source);
  writeFileSync(path.join(source,'SKILL.md'),'---\nname: meeting-outline\ndescription: Public fixture outline\n---\n'+instructions+'\n');
  mkdirSync(path.join(source,'scripts'));writeFileSync(path.join(source,'scripts','never-run.js'),'throw Error("MUST NOT RUN");');
  mkdirSync(path.join(source,'references'));writeFileSync(path.join(source,'references','guide.md'),'<img src=x onerror=alert(1)>\nPublic UTF-8 指南');
  writeFileSync(path.join(source,'binary.bin'),Buffer.from([0xff,0x00]));writeFileSync(path.join(source,'control.txt'),'\u0000text');writeFileSync(path.join(source,'large.txt'),'x'.repeat(65537));
  const store=openLocalSkillStore(path.join(root,'installed.json')),candidate=readLocalSkillDirectory(source);
  const confirmations=[],requests=[];let host,confirmAllowed=true,confirmHook=()=>{},credentialRead=()=>{},fetchReply,historyMessages=[];
  const app=createAgentArtsRuntimeApplication({path:path.join(root,'runtime.sqlite'),
    gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic-installed-skill',hostUserNamespace:'synthetic-skill',
    authorizationProvider:{read:async()=>{await credentialRead();return 'Bearer synthetic';}},
    coordinationInput:{prepareCoordinationGoal:async scope=>{host.prepareTask(scope);return hooks.prepare?.(scope)??scope.publicGoal;},
      readConversationContext:async scope=>host.filterContext(app.readConversationContext({...scope,historyMessages})),
      releaseTask:taskId=>hooks.release?.(taskId),
      beforeCoordinationSend:request=>host.assertTask(request.taskId)},
    fetchImpl:async(_url,init)=>{requests.push(JSON.parse(init.body));
      if(fetchReply)return fetchReply(init);
      return new Response(JSON.stringify({event:'message',data:{text:'Synthetic outline reply',index:0}}),{headers:{'content-type':'application/json'}});
    }});
  const make=()=>createInstalledSkillsHost({store,runtime:app.runtime,selectDirectory:async()=>source,
    validateRunInput:async publicGoal=>compileCoordinationGoal(publicGoal,publicGoal,host.filterContext(app.readConversationContext({
      conversationId:'desktop-workspace',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal,historyMessages}))),
    readParentTaskId:taskId=>app.runtime.loadCheckpoint(taskId,'subtask-parent')?.parentTaskId,
    confirm:async input=>{confirmations.push(input);await confirmHook(input);return confirmAllowed;}});
  host=make();
  return {root,source,store,candidate,app,confirmations,requests,make,
    get host(){return host;},set host(value){host=value;},
    confirm(value){confirmAllowed=value;},onConfirm(callback){confirmHook=callback;},history(messages){historyMessages=messages;},credential(callback){credentialRead=callback;},reply(callback){fetchReply=callback;}};
}
async function settle(app,taskId) {
  for(let i=0;i<400;i++) {const task=app.runtime.getTask(taskId);if(['succeeded','failed','cancelled'].includes(task.state))return task;await new Promise(r=>setTimeout(r,5));}
  throw Error('Synthetic task did not terminate');
}
async function run(f) {
  const prepared=await f.host.prepareRun({name:f.candidate.name,digest:f.candidate.digest,goal:'Organize this public fixture'});
  const client=new Client(f.app,Date.now);await client.connect();
  const submitted=await submitConversationTask(client,{goal:prepared.publicGoal,conversationId:'desktop-workspace'},{competition:true});
  return submitted.taskId;
}
test('install, preview, enable and use reach original SQLite Runtime/HTTP adapter with explicit synthetic confirmation and HTTP',async t=>{
  const f=fixture();t.after(()=>{f.host.close();f.app.close();});
  f.confirm(false);assert.deepEqual(await f.host.install(),{cancelled:true});assert.equal(f.store.list().length,0);
  f.confirm(true);await f.host.install();const selected={name:f.candidate.name,digest:f.candidate.digest};
  assert.equal(f.host.snapshot().items[0].enabled,false);
  await assert.rejects(f.host.prepareRun({...selected,goal:'public'}));assert.equal(f.requests.length,0);
  assert.match(f.host.preview(selected).instructions,/three bullet points/);assert.equal(f.requests.length,0);
  assert.match(f.host.previewResource({...selected,path:'scripts/never-run.js'}).text,/MUST NOT RUN/);
  const resource=f.host.previewResource({...selected,path:'references/guide.md'});
  assert.match(resource.text,/Public UTF-8 指南/);assert.match(resource.digest,/^[a-f0-9]{64}$/);
  writeFileSync(path.join(f.source,'references','guide.md'),'changed original');
  assert.equal(f.host.previewResource({...selected,path:resource.path}).text,resource.text);
  for(const path of ['../SKILL.md',f.source,'binary.bin','control.txt','large.txt']) assert.throws(()=>f.host.previewResource({...selected,path}));
  assert.throws(()=>f.host.previewResource({...selected,path:resource.path,extra:true}));assert.equal(f.requests.length,0);
  await f.host.setEnabled({...selected,enabled:true});f.confirm(false);
  assert.deepEqual(await f.host.prepareRun({...selected,goal:'public'}),{cancelled:true});assert.equal(f.requests.length,0);
  f.confirm(true);const taskId=await run(f),task=await settle(f.app,taskId);
  assert.equal(task.state,'succeeded');assert.match(task.resultSummary,/Synthetic outline reply/);
  assert.equal(f.requests.length,1);const transmitted=f.requests[0].query;
  assert.match(transmitted,/Use three bullet points/);assert.equal(transmitted.includes(f.source),false);
  assert.equal(transmitted.includes('MUST NOT RUN'),false);assert.equal(f.app.runtime.readToolExecutions(taskId).length,0);
  assert.equal(transmitted.includes('Public UTF-8 指南'),false);
  assert.equal(f.app.runtime.loadCheckpoint(taskId,'desktop-installed-skill-v1').digest,f.candidate.digest);
  const historyProbe=f.app.runtime.submitTask({goal:'Next public goal',conversationId:'desktop-workspace',idempotencyKey:'history-probe'});
  const context=f.app.readConversationContext({taskId:historyProbe.taskId,conversationId:'desktop-workspace',
    deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
  assert.ok(context.some(message=>message.taskId===taskId));
  assert.equal(f.host.filterContext(context).some(message=>message.taskId===taskId),false);
  const child=f.app.runtime.submitTask({goal:'Unauthorized copied Skill',conversationId:'desktop-subtask:'+taskId,idempotencyKey:'child-probe'});
  f.app.runtime.saveCheckpointOnce(child.taskId,'subtask-parent',{parentTaskId:taskId});
  assert.throws(()=>f.host.assertTask(child.taskId),/子任务/);
  const runConsent=f.confirmations.find(item=>item.action==='run');assert.match(runConsent.detail,/Use three bullet points/);
  const reopened=f.make();assert.throws(()=>reopened.assertTask(taskId));reopened.close();
  await f.host.uninstall(selected);assert.deepEqual(f.store.list(),[]);assert.equal(f.requests.length,1);
  assert.throws(()=>f.host.previewResource({...selected,path:resource.path}));
});
test('an 8000-character Skill with successful conversation history reaches the real Runtime adapter without duplicate instructions',async t=>{
  const instructions='合成中文参考'.repeat(1000)+'x'.repeat(2000);
  const f=fixture(instructions);t.after(()=>{f.host.close();f.app.close();});
  const client=new Client(f.app,Date.now);await client.connect();
  const previous=await submitConversationTask(client,{goal:'Earlier public question',conversationId:'desktop-workspace'},{competition:true});
  assert.equal((await settle(f.app,previous.taskId)).state,'succeeded');
  await f.host.install();await f.host.setEnabled({name:f.candidate.name,digest:f.candidate.digest,enabled:true});
  const taskId=await run(f),task=await settle(f.app,taskId);
  assert.equal(task.state,'succeeded');assert.equal(f.requests.length,2);
  const transmitted=f.requests[1].query;
  assert.ok(transmitted.length<=16000);assert.match(transmitted,/Earlier public question/);
  assert.equal(transmitted.split(instructions).length-1,1);
});

for(const phase of ['before confirmation','during confirmation'])test(`final input overflow ${phase} rejects before task acceptance, credentials and HTTP`,async t=>{
  const f=fixture('合成"\\参考'.repeat(1000));t.after(()=>{f.host.close();f.app.close();});
  await f.host.install();await f.host.setEnabled({name:f.candidate.name,digest:f.candidate.digest,enabled:true});
  const seed=()=>{
    const task=f.app.runtime.submitTask({goal:'Earlier public question',conversationId:'desktop-workspace',idempotencyKey:'budget-history'});
    f.app.runtime.transitionTask(task.taskId,'planning');
    f.app.runtime.transitionTask(task.taskId,'running');
    f.app.runtime.transitionTask(task.taskId,'verifying');
    f.app.runtime.transitionTask(task.taskId,'succeeded',{resultSummary:'Synthetic history '.repeat(600)});
  };
  if(phase==='before confirmation')seed();
  else f.onConfirm(input=>{if(input.action==='run')seed();});
  let credentialReads=0;f.credential(()=>{credentialReads++;});
  await assert.rejects(run(f),/16000/);
  assert.equal(f.confirmations.filter(item=>item.action==='run').length,phase==='before confirmation'?0:1);
  assert.equal(f.app.runtime.listTasks({conversationId:'desktop-workspace'}).items.length,1);
  assert.equal(f.requests.length,0);assert.equal(credentialReads,0);
});

test('Desktop history overlay without task IDs participates in the final budget before confirmation',async t=>{
  const f=fixture('x'.repeat(8000));t.after(()=>{f.host.close();f.app.close();});
  await f.host.install();await f.host.setEnabled({name:f.candidate.name,digest:f.candidate.digest,enabled:true});
  f.history([{id:'desktop-history',role:'assistant',content:'Public synthetic history '.repeat(400)}]);
  let credentialReads=0;f.credential(()=>{credentialReads++;});
  await assert.rejects(run(f),/16000/);
  assert.equal(f.confirmations.filter(item=>item.action==='run').length,0);
  assert.equal(f.app.runtime.listTasks({}).items.length,0);assert.equal(f.requests.length,0);assert.equal(credentialReads,0);
});

test('overflow after trusted private preparation releases the input lease and stops before credentials or HTTP',async t=>{
  const released=[];
  const f=fixture('Public fixture',{prepare:scope=>scope.publicGoal+'x'.repeat(16000),release:taskId=>released.push(taskId)});
  t.after(()=>{f.host.close();f.app.close();});
  await f.host.install();await f.host.setEnabled({name:f.candidate.name,digest:f.candidate.digest,enabled:true});
  let credentialReads=0;f.credential(()=>{credentialReads++;});
  const taskId=await run(f),task=await settle(f.app,taskId);
  assert.equal(task.state,'failed');assert.equal(task.error.code,'EXTERNAL_FAILURE');
  assert.deepEqual(released,[taskId]);assert.equal(f.requests.length,0);assert.equal(credentialReads,0);
});

test('successful turns without summaries do not hide older usable history from the pre-acceptance budget',async t=>{
  const f=fixture('x'.repeat(8000));t.after(()=>{f.host.close();f.app.close();});
  await f.host.install();await f.host.setEnabled({name:f.candidate.name,digest:f.candidate.digest,enabled:true});
  for(let i=0;i<=20;i++) {
    const task=f.app.runtime.submitTask({goal:'Public synthetic history',conversationId:'desktop-workspace',idempotencyKey:'empty-summary-'+i});
    for(const state of ['planning','running','verifying'])f.app.runtime.transitionTask(task.taskId,state);
    f.app.runtime.transitionTask(task.taskId,'succeeded',i===0?{resultSummary:'Public fixture '.repeat(650)}:{});
  }
  let credentialReads=0;f.credential(()=>{credentialReads++;});
  await assert.rejects(run(f),/16000/);
  assert.equal(f.confirmations.filter(item=>item.action==='run').length,0);
  assert.equal(f.app.runtime.listTasks({limit:100}).items.length,21);
  assert.equal(f.requests.length,0);assert.equal(credentialReads,0);
});

test('an oversized serialized Skill goal is rejected before run confirmation',async t=>{
  const confirmations=[];
  const header='---\nname: meeting-outline\ndescription: Public fixture outline\n---\n';
  const content=Buffer.from(header+'"'.repeat(16_000-header.length));
  const fileDigest=createHash('sha256').update(content).digest('hex');
  const files=[{path:'SKILL.md',content:content.toString('base64'),digest:fileDigest}];
  const digest=createHash('sha256').update(JSON.stringify(files.map(file=>[file.path,file.digest]))).digest('hex');
  const entry={name:'meeting-outline',version:'fixture',digest,files,enabled:true,generation:1,installationId:'fixture'};
  const host=createInstalledSkillsHost({store:{read:()=>entry},runtime:{},confirm:async input=>{confirmations.push(input);return true;}});
  t.after(()=>host.close());

  await assert.rejects(host.prepareRun({name:entry.name,digest,goal:'abcdefghijklmnopq'}),/16000/);

  assert.equal(confirmations.some(item=>item.action==='run'),false);
});
for(const action of ['disable','uninstall']) test(`${action} during asynchronous credential lookup prevents adapter dispatch and invalidates old task after reinstall/re-enable`,async t=>{
  const f=fixture();t.after(()=>{f.host.close();f.app.close();});await f.host.install();
  const selected={name:f.candidate.name,digest:f.candidate.digest};await f.host.setEnabled({...selected,enabled:true});
  let release,entered;const gate=new Promise(r=>{entered=r;});
  f.credential(()=>{entered();return new Promise(r=>{release=r;});});
  const taskId=await run(f);await gate;
  if(action==='disable') await f.host.setEnabled({...selected,enabled:false});
  else await f.host.uninstall(selected);
  release();
  const task=await settle(f.app,taskId);assert.equal(task.state,'cancelled');assert.equal(f.requests.length,0);
  if(action==='uninstall')await f.host.install();
  await f.host.setEnabled({...selected,enabled:true});assert.throws(()=>f.host.assertTask(taskId));
});
test('confirmation does not accept a source changed during import, and metadata never renders active markup',async t=>{
  const f=fixture();t.after(()=>{f.host.close();f.app.close();});
  const host=createInstalledSkillsHost({store:f.store,runtime:f.app.runtime,selectDirectory:async()=>f.source,
    confirm:async()=>{writeFileSync(path.join(f.source,'SKILL.md'),'changed');return true;}});
  await assert.rejects(host.install());assert.equal(f.store.list().length,0);host.close();
  const html=installedSkillRowsHtml([{name:'a',version:'<v>',description:'<img src=x onerror=alert(1)>',digest:'a'.repeat(64),enabled:false,fileCount:1}],true);
  assert.equal(html.includes('<img'),false);assert.match(html,/&lt;img/);assert.match(html,/data-skill="run"[^>]*disabled/);
});
