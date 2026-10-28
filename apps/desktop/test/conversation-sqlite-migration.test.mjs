import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,existsSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Conversations} from '../electron/conversations.js';
import {prepareConversationSqliteStore} from '../electron/conversation-sqlite-store.js';

const root=path.resolve(import.meta.dirname,'../.cache/conversation-sqlite-migration');
mkdirSync(root,{recursive:true});
const fixture=source=>{
  const directory=mkdtempSync(path.join(root,'case-')),file=path.join(directory,'conversations.json');
  const bytes=typeof source==='string'?source:JSON.stringify(source);
  if(source!==null)writeFileSync(file,bytes);
  return {directory,file,bytes};
};
const v4=()=>{
  const defaults=new Conversations(null).stateSnapshot();
  return {version:4,...defaults};
};
const marker=file=>JSON.parse(readFileSync(file,'utf8'));
const backup=f=>path.join(f.directory,readdirSync(f.directory).find(name=>name.includes('.pre-sqlite-')&&name.endsWith('.bak')));
const message=(id,text='original body',createdAt='2026-01-01T00:00:00.000Z')=>({
  id,sessionId:'synthetic-session',role:'user',text,createdAt,surface:'panel',conversationId:'desktop-panel',
});

test('v1-v4 read only construction stays on old bytes; first mutation migrates exactly once with backup and reopen',()=>{
  const turn={taskId:'old-task',surface:'panel',goal:'old goal',createdAt:'2026-01-01T00:00:00.000Z'};
  const legacy=[
    {version:1,turns:[turn]},
    {version:2,turns:[turn],messages:[message('old-message')]},
    {version:3,turns:[turn],messages:[message('old-message','original body','2026-01-01T00:00:00Z')],
      preferences:[['desktop-panel',{depth:2,fast:false,modelId:'old-model'}]]},
    {...v4(),turns:[turn],messages:[message('old-message')],
      preferences:[['desktop-panel',{depth:2,fast:false,modelId:'old-model'}]]},
  ];
  for(const source of legacy){
    const f=fixture(source),original=readFileSync(f.file),first=new Conversations(f.file);
    assert.equal(first.goal('old-task'),'old goal');
    assert.deepEqual(readFileSync(f.file),original);
    assert.equal(existsSync(f.file+'.sqlite'),false);
    assert.equal(readdirSync(f.directory).filter(name=>name.endsWith('.bak')).length,0);
    first.setDraft('panel','desktop-panel','new confirmed draft');
    assert.equal(marker(f.file).version,5);
    assert.deepEqual(readFileSync(backup(f)),original);
    const imported=new DatabaseSync(f.file+'.sqlite',{readOnly:true});
    const count=name=>Number(imported.prepare('SELECT value FROM metadata WHERE key=?').get('importCount:'+name).value);
    assert.deepEqual([count('sessions'),count('turns'),count('messages'),count('preferences'),count('active')],
      [2,source.turns.length,source.messages?.length??0,source.preferences?.length??0,2]);
    imported.close();
    const second=new Conversations(f.file);
    assert.equal(second.goal('old-task'),'old goal');
    assert.equal(second.session('desktop-panel').draft,'new confirmed draft');
    assert.equal(second.messagesFor('panel').length,source.messages?.length??0);
    assert.equal(second.preference('desktop-panel').modelId,source.preferences?.[0][1].modelId);
    second.close();first.close();
  }
});

test('fresh profile installs the old-loader rejecting marker before its first business write and recovers after marker-only interruption',()=>{
  const f=fixture(null),first=new Conversations(f.file);
  assert.equal(existsSync(f.file),false);
  first.setDraft('panel','desktop-panel','saved from fresh');
  assert.equal(marker(f.file).version,5);assert.equal(marker(f.file).fresh,true);
  assert.equal(marker(f.file).phase,'ready');
  first.close();
  const reopened=new Conversations(f.file);
  assert.equal(reopened.session('desktop-panel').draft,'saved from fresh');reopened.close();
  const interrupted=fixture(null),defaults=new Conversations(null).stateSnapshot();
  assert.throws(()=>prepareConversationSqliteStore(interrupted.file,defaults,undefined,{fault:'fresh_after_marker'}),/fresh marker/);
  assert.equal(marker(interrupted.file).version,5);
  assert.equal(marker(interrupted.file).phase,'initializing');
  assert.equal(existsSync(interrupted.file+'.sqlite'),false);
  const recovered=new Conversations(interrupted.file);
  recovered.setDraft('panel','desktop-panel','recovered');recovered.close();
  assert.equal(marker(interrupted.file).phase,'ready');
  const finalRead=new Conversations(interrupted.file);
  assert.equal(finalRead.session('desktop-panel').draft,'recovered');finalRead.close();
});

test('fresh initial DB committed before ready marker is independently verified on reopen without applying a business write',()=>{
  const f=fixture(null),defaults=new Conversations(null).stateSnapshot();
  assert.throws(()=>prepareConversationSqliteStore(f.file,defaults,undefined,{fault:'after_import_commit'}),/post-COMMIT/);
  assert.equal(marker(f.file).phase,'initializing');
  assert.equal(existsSync(f.file+'.sqlite'),true);
  const reader=new Conversations(f.file);
  assert.equal(marker(f.file).phase,'ready');
  assert.equal(reader.session('desktop-panel').draft,'');
  assert.equal(reader.store.stateRevision,0);
  reader.close();
});

test('ready fresh marker with a missing database refuses startup and preserves the marker',()=>{
  const f=fixture(null),journal=new Conversations(f.file);
  const created=journal.create('panel','kept conversation');
  journal.setDraft('panel',created.id,'kept draft');journal.close();
  assert.equal(marker(f.file).phase,'ready');
  const database=f.file+'.sqlite',hidden=database+'.synthetic-hidden';
  assert.ok(path.resolve(database).startsWith(path.resolve(root)+path.sep));
  renameSync(database,hidden);
  assert.throws(()=>new Conversations(f.file),/ready conversation marker database missing/);
  assert.equal(marker(f.file).phase,'ready');
  assert.equal(existsSync(database),false);
  renameSync(hidden,database);
  const reopened=new Conversations(f.file);
  assert.equal(reopened.session(created.id).draft,'kept draft');reopened.close();
});

test('raw audit refuses silent turn, message, preference or duplicate-key loss before creating a database',()=>{
  const cases=[];
  {const source=v4();source.turns=[{bad:'skipped by old loader'}];cases.push(source);}
  {const source=v4();const turn={taskId:'same',surface:'panel',goal:'first'};source.turns=[turn,{...turn,goal:'overwritten'}];cases.push(source);}
  {const source=v4();source.messages=[message('trimmed','  private body  ')];cases.push(source);}
  {const source=v4();source.preferences=[['desktop-panel',{depth:1,fast:false,modelId:''}]];cases.push(source);}
  cases.push(JSON.stringify(v4()).replace('"version":4','"version":4,"version":4'));
  for(const source of cases){
    const f=fixture(source),original=readFileSync(f.file),journal=new Conversations(f.file);
    assert.throws(()=>journal.setDraft('panel','desktop-panel','must not migrate'));
    assert.deepEqual(readFileSync(f.file),original);
    assert.equal(existsSync(f.file+'.sqlite'),false);
    assert.equal(readdirSync(f.directory).filter(name=>name.endsWith('.bak')).length,0);
    journal.close();
  }
});

test('interrupted import and marker stages retain original source and recover the same committed generation',()=>{
  for(const fault of ['before_import_commit','after_import_commit','import_readback_unavailable','before_marker','marker_rename']){
    const f=fixture({...v4(),messages:[message('old-message')]}),old=readFileSync(f.file);
    const journal=new Conversations(f.file);
    assert.throws(()=>prepareConversationSqliteStore(f.file,journal.stateSnapshot(),old,{fault}));
    assert.deepEqual(readFileSync(f.file),old,`${fault}: old source must remain`);
    journal.close();
    const recovered=new Conversations(f.file);
    recovered.setDraft('panel','desktop-panel','after '+fault);
    const generation=marker(f.file).generation;
    recovered.close();
    const reopened=new Conversations(f.file);
    assert.equal(marker(f.file).generation,generation);
    assert.equal(reopened.messagesFor('panel')[0].text,'original body');
    assert.equal(reopened.session('desktop-panel').draft,'after '+fault);
    reopened.close();
  }
});

test('an ambiguous marker rename is accepted only after exact marker readback',()=>{
  const f=fixture(v4()),journal=new Conversations(f.file),source=readFileSync(f.file);
  const store=prepareConversationSqliteStore(f.file,journal.stateSnapshot(),source,{fault:'after_marker'});
  assert.equal(marker(f.file).version,5);store.close();journal.close();
  const reopened=new Conversations(f.file);assert.equal(reopened.session('desktop-panel').draft,'');reopened.close();
});

test('confirmed pre-commit failures preserve same-instance explicit retry for migration and a business write',()=>{
  const f=fixture(v4()),old=readFileSync(f.file);
  const sourceSha=createHash('sha256').update(old).digest('hex');
  const backupFile=`${f.file}.pre-sqlite-${sourceSha.slice(0,16)}.bak`;
  writeFileSync(backupFile,'conflicting backup fixture');
  const journal=new Conversations(f.file);
  assert.throws(()=>journal.setDraft('panel','desktop-panel','first'),/backup differs/);
  assert.equal(journal.migrationUncertain,false);
  assert.equal(journal.session('desktop-panel').draft,'');
  assert.deepEqual(readFileSync(f.file),old);
  writeFileSync(backupFile,old);
  journal.setDraft('panel','desktop-panel','original');
  const nativeCommit=journal.store.commit.bind(journal.store);
  journal.store.commit=changes=>nativeCommit(changes,{fault:'before_commit'});
  assert.throws(()=>journal.setDraft('panel','desktop-panel','not committed'),/pre-COMMIT/);
  assert.equal(journal.store.frozen,false);
  assert.equal(journal.session('desktop-panel').draft,'original');
  journal.store.commit=changes=>nativeCommit(changes);
  journal.setDraft('panel','desktop-panel','retried');journal.close();
  const reopened=new Conversations(f.file);
  assert.equal(reopened.session('desktop-panel').draft,'retried');reopened.close();
});

test('separate writer CAS rejects stale revisions and does not publish unsaved memory',()=>{
  const f=fixture(null),first=new Conversations(f.file);
  first.setDraft('panel','desktop-panel','original');
  const stale=new Conversations(f.file),reader=new Conversations(f.file);
  first.setDraft('panel','desktop-panel','new');
  assert.throws(()=>stale.setDraft('panel','desktop-panel','stale'),/reopen required/);
  assert.equal(stale.session('desktop-panel').draft,'original');
  assert.equal(reader.session('desktop-panel').draft,'original','read views stay per instance until reopened');
  stale.close();reader.close();first.close();
  const reopened=new Conversations(f.file);
  assert.equal(reopened.session('desktop-panel').draft,'new');reopened.close();
});

test('a WAL reader loads one coherent state when a second writer commits between table reads',()=>{
  const f=fixture(null),writer=new Conversations(f.file);
  writer.setDraft('panel','desktop-panel','old draft');
  writer.add('task-1','panel','old goal');
  const original=DatabaseSync.prototype.prepare;let injected=0;
  const wrapped=function(sql){
    const statement=original.call(this,sql);
    if(!sql.startsWith('SELECT record_id,value,revision,ordinal FROM records WHERE kind=? ORDER BY ordinal'))
      return statement;
    return new Proxy(statement,{get(target,property){
      if(property==='all')return (...args)=>{
        const rows=target.all(...args);
        if(args[0]==='sessions'&&injected===0){
          injected++;
          DatabaseSync.prototype.prepare=original;
          try{writer.store.commit([
            {kind:'sessions',id:'desktop-panel',value:{...writer.sessions.get('desktop-panel'),draft:'new draft'}},
            {kind:'turns',id:'task-1',value:{...writer.turns.get('task-1'),goal:'new goal'}},
          ]);}finally{DatabaseSync.prototype.prepare=wrapped;}
        }
        return rows;
      };
      const value=Reflect.get(target,property,target);
      return typeof value==='function'?value.bind(target):value;
    }});
  };
  let raced;
  DatabaseSync.prototype.prepare=wrapped;
  try{raced=new Conversations(f.file);}finally{DatabaseSync.prototype.prepare=original;}
  assert.equal(injected,1);
  assert.deepEqual([raced.session('desktop-panel').draft,raced.goal('task-1')],['old draft','old goal']);
  raced.close();writer.close();
  const stable=new Conversations(f.file);
  assert.deepEqual([stable.session('desktop-panel').draft,stable.goal('task-1')],['new draft','new goal']);
  stable.close();
});

test('a changed database generation freezes writes before mutation and leaves memory unchanged',()=>{
  const f=fixture(null),journal=new Conversations(f.file);
  journal.setDraft('panel','desktop-panel','original');
  const outside=new DatabaseSync(f.file+'.sqlite');
  outside.prepare("UPDATE metadata SET value='foreign-generation' WHERE key='generation'").run();outside.close();
  assert.throws(()=>journal.setDraft('panel','desktop-panel','must not commit'),/lineage changed/);
  assert.equal(journal.session('desktop-panel').draft,'original');
  const independent=new DatabaseSync(f.file+'.sqlite',{readOnly:true});
  assert.equal(JSON.parse(independent.prepare("SELECT value FROM records WHERE kind='sessions' AND record_id='desktop-panel'").get().value).draft,'original');
  assert.equal(independent.prepare("SELECT value FROM metadata WHERE key='stateRevision'").get().value,'1');independent.close();
  journal.close();assert.throws(()=>new Conversations(f.file),/generation mismatch/);
});

test('unexecuted COMMIT cannot self-confirm, while committed lost acknowledgement confirms only through independent readback',()=>{
  for(const applied of [false,true]){
    const f=fixture(null),journal=new Conversations(f.file);
    journal.setDraft('panel','desktop-panel','original');
    const actual=journal.store.db.exec.bind(journal.store.db);
    journal.store.db.exec=sql=>{
      if(sql==='COMMIT'){
        if(applied)actual(sql);
        throw Error('injected COMMIT acknowledgement failure');
      }
      if(sql==='ROLLBACK'&&!applied)throw Error('injected ROLLBACK failure');
      return actual(sql);
    };
    if(applied)journal.setDraft('panel','desktop-panel','new');
    else assert.throws(()=>journal.setDraft('panel','desktop-panel','new'),/COMMIT acknowledgement/);
    assert.equal(journal.session('desktop-panel').draft,applied?'new':'original');
    assert.throws(()=>journal.setDraft('panel','desktop-panel','later'),/reopen required/);
    journal.close();
    const reopened=new Conversations(f.file);
    assert.equal(reopened.session('desktop-panel').draft,applied?'new':'original');reopened.close();
  }
});

test('ordinal retains same-time messagesFor order while page keys use createdAt and message ID',()=>{
  const source=v4();source.messages=[message('z'),message('a')];
  const f=fixture(source),journal=new Conversations(f.file);
  journal.setDraft('panel','desktop-panel','migrated');
  assert.deepEqual(journal.messagesFor('panel').map(item=>item.id),['z','a']);
  assert.deepEqual(journal.readMessageDisplayPage({conversationId:'desktop-panel'}).map(item=>item.id),['a','z']);
  journal.addLiveMessage({...source.messages[0],text:'revised body'});journal.close();
  const reopened=new Conversations(f.file);
  assert.deepEqual(reopened.messagesFor('panel').map(item=>item.id),['z','a']);
  assert.equal(reopened.messages.get('z').text,'revised body');reopened.close();
});

test('changed backup and overwritten active marker fail closed without replacing the database',()=>{
  const first=fixture(v4()),journal=new Conversations(first.file);
  journal.setDraft('panel','desktop-panel','saved');journal.close();
  writeFileSync(backup(first),'tampered');
  assert.throws(()=>new Conversations(first.file),/backup missing or changed/);

  const second=fixture(v4()),active=new Conversations(second.file);
  active.setDraft('panel','desktop-panel','saved');
  writeFileSync(second.file,JSON.stringify(v4()));
  assert.throws(()=>active.setDraft('panel','desktop-panel','must not write'),/marker changed/);
  assert.equal(active.session('desktop-panel').draft,'saved');active.close();
  assert.throws(()=>new Conversations(second.file),/pending conversation backup|import lineage mismatch|pending import has unexpected writes/);
});

test('close is synchronous and idempotent; a separate reader close leaves the writer usable',()=>{
  const f=fixture(null),writer=new Conversations(f.file);
  writer.setDraft('panel','desktop-panel','first');
  const reader=new Conversations(f.file);
  assert.equal(reader.session('desktop-panel').draft,'first');reader.close();reader.close();
  writer.setDraft('panel','desktop-panel','second');writer.close();writer.close();
  assert.throws(()=>writer.setDraft('panel','desktop-panel','closed'),/已关闭/);
  const after=new Conversations(f.file);assert.equal(after.session('desktop-panel').draft,'second');after.close();
});
