import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {delimiter, join, resolve} from 'node:path';
import test from 'node:test';
import {openReadOnlyVault} from '@personal-agent/knowledge/filesystem';
import {createWikiPort} from '@personal-agent/knowledge/wiki';
import {openControlledVaultWriter} from '@personal-agent/knowledge/write';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {createRuntimeApplication, createTrustedKnowledgeTools} from '@personal-agent/runtime/application';
import {createPrivateMemoryController} from '../../apps/desktop/electron/private-memory.js';

const powerShellPath=(process.env.PATH??'').split(delimiter).map(path=>join(path,'pwsh.exe')).find(existsSync);
const windows=process.platform==='win32' && Boolean(powerShellPath);
const scope=()=>({deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
const hash=value=>createHash('sha256').update(value).digest('hex');
const original='---\nowner: synthetic\n---\n# public fixture\nhello original [[source]] [link](two.md)\n';
async function idle(app){for(let i=0;i<500 && app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(app.activeTaskCount,0);}
async function fixture(t){
  const parent=resolve('.cache/wiki-write-recovery');await mkdir(parent,{recursive:true});
  const base=await mkdtemp(join(parent,'case-')),root=join(base,'vault'),recovery=join(base,'recovery');
  await mkdir(root);await mkdir(recovery);await writeFile(join(root,'one.md'),original);
  await writeFile(join(root,'two.md'),'hello unrelated\n');
  const binding={sourceId:'synthetic-source',namespace:'synthetic',configRevision:1,available:true,
    writeAvailable:true,dataLevel:'public',cloudExportAllowed:false,publicQueries:[],allowedNotePaths:['one.md']};
  const reader=await openReadOnlyVault({vaultId:binding.sourceId,rootPath:root});
  let writes=0,failProjection=true,crash=false,controller,app,factory;
  const writer=openControlledVaultWriter({rootPath:root,recoveryRootPath:recovery,powerShellPath,
    sourceId:binding.sourceId,configRevision:1,allowedNotePaths:binding.allowedNotePaths,bindingCurrent:()=>binding.available});
  const host={snapshot:()=>({...binding}),acquire(expected,signal){
    assert.equal(expected.sourceId,binding.sourceId);assert.equal(expected.configRevision,binding.configRevision);
    if(!binding.available)throw Error('revoked');
    return {binding:{...binding},read:reader,signal,assertCurrent(){if(!binding.available)throw Error('revoked');},release(){},
      write:{...writer,apply:async(input,context)=>{writes++;const result=await writer.apply(input,context);
        if(crash)throw Error('synthetic crash after body write');return result;}},
      reconcileWrite:writer.reconcile,finalizeWrite:writer.finalize};
  },acquireWiki(expected,context){
    const lease=this.acquire(expected,context.signal);
    return {...lease,wiki:createWikiPort({...binding,reader,vaultId:binding.sourceId,validUntil:context.deadline,
      isCurrent:()=>binding.available})};
  }};
  const memoryPath=join(base,'memory.sqlite'),runtimePath=join(base,'runtime.sqlite');
  const open=()=>{
    // Native decisions are explicit Fakes; only public synthetic files are used.
    controller=createPrivateMemoryController(memoryPath,async()=>true,async()=>true,{knowledgeSource:()=>host});
    factory=createTrustedKnowledgeTools(host,{revalidate:async(input,context)=>{
      if(failProjection)throw Error('synthetic SQLite projection failure');
      await controller.revalidateSource(input,context);
    }});
    app=createRuntimeApplication({path:runtimePath,profile:'huawei_ict_agentarts',hostUserNamespace:binding.namespace,
      tools:factory.tools,automaticTools:factory.tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version})),
      knowledgeWriteReconciliation:{reconcile:(input,context)=>factory.reconcileWrite({...input,
        sourceId:binding.sourceId,configRevision:binding.configRevision},context),
      finalize:(acceptedOriginal,context)=>factory.finalizeWrite({sourceId:binding.sourceId,configRevision:binding.configRevision,
        acceptedOriginal},context)}});
    factory.bindApplication(app);
  };
  open();t.after(async()=>{controller.close();app.close();await rm(base,{recursive:true,force:true});});
  const source=(await controller.search('original')).hits[0].source;
  await controller.save(source,'Synthetic confirmed original');
  const unrelated=(await controller.search('unrelated')).hits[0].source;
  await controller.save(unrelated,'Synthetic confirmed unrelated');
  const memory=openSqliteMemoryHost(memoryPath);
  const facts=(await memory.listUserFactHeads('desktop-private',{at:new Date().toISOString(),limit:20,...scope()})).facts;
  const first=facts.find(fact=>fact.summary==='Synthetic confirmed original').ref;
  const other=facts.find(fact=>fact.summary==='Synthetic confirmed unrelated').ref;memory.close();
  const args={sourceId:binding.sourceId,configRevision:1,path:'one.md',expectedSha256:hash(original),
    edits:[{oldText:'hello original',newText:'hello organized'}]};
  return {root,recovery,first,other,args,get app(){return app;},get factory(){return factory;},get controller(){return controller;},
    counts:()=>writes,fail:value=>{failProjection=value;},crash:value=>{crash=value;},
    heads(){const store=openSqliteMemoryHost(memoryPath);try{return [store.readUserFactHead('desktop-private',first.id),
      store.readUserFactHead('desktop-private',other.id)];}finally{store.close();}},
    async restart(){controller.close();app.close();open();},
    async submit(input=args){const result=app.submitHostToolTask({commandId:'synthetic-'+writes,toolName:'knowledge.apply_note_patch',
      toolVersion:'1.0.0',arguments:input,deadline:scope().deadline});await idle(app);return result.task.taskId;}};
}

test('real write/readback survives projection failure and restart; recovery changes no body and preserves unrelated facts', {skip:!windows},async t=>{
  const f=await fixture(t),taskId=await f.submit();
  assert.equal(f.app.runtime.getTask(taskId).state,'succeeded');assert.equal(f.counts(),1);
  const body=await readFile(join(f.root,'one.md'),'utf8');assert.equal(body,original.replace('hello original','hello organized'));
  assert.equal(f.heads()[0].state,'active');
  assert.deepEqual(await f.factory.recoverProjection(taskId,scope()),{pending:1,unknown:0});
  await f.restart();f.fail(false);
  assert.deepEqual(await f.factory.recoverProjection(taskId,scope()),{pending:0,unknown:0});
  const [changed,unrelated]=f.heads();assert.equal(changed.state,'withdrawn');assert.equal(changed.ref.revision,2);
  assert.equal(changed.confirmation,'external_observation');assert.deepEqual(unrelated.ref,f.other);assert.equal(unrelated.state,'active');
  await f.factory.recoverProjection(taskId,scope());await f.controller.revalidateSource(f.args,scope());
  assert.equal(f.heads()[0].ref.revision,2);assert.equal(f.counts(),1);assert.equal(await readFile(join(f.root,'one.md'),'utf8'),body);
  assert.equal(await readFile(join(f.root,'two.md'),'utf8'),'hello unrelated\n');
  assert.equal(f.app.runtime.getTask(taskId).state,'succeeded');
});

test('interrupted real write stays unknown until trusted Runtime readback/finalization; recovery never replays the write', {skip:!windows},async t=>{
  const f=await fixture(t);f.crash(true);f.fail(false);const taskId=await f.submit();
  assert.equal(f.app.runtime.getTask(taskId).state,'waiting_reconciliation');assert.equal(f.counts(),1);
  await f.restart();const body=await readFile(join(f.root,'one.md'),'utf8');
  assert.deepEqual(await f.factory.recoverProjection(taskId,scope()),{pending:0,unknown:1});assert.equal(f.heads()[0].state,'active');
  await f.app.reconcileKnowledgeWriteTask(taskId,scope());
  assert.equal(f.app.runtime.getTask(taskId).state,'succeeded');assert.equal(f.heads()[0].state,'withdrawn');
  assert.deepEqual(await f.factory.recoverProjection(taskId,scope()),{pending:0,unknown:0});
  assert.equal(f.counts(),1);assert.equal(await readFile(join(f.root,'one.md'),'utf8'),body);
  assert.deepEqual(f.heads()[1].ref,f.other);
});
