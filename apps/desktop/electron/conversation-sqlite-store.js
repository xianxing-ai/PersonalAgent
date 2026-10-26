import {createHash,randomUUID} from 'node:crypto';
import {constants,closeSync,copyFileSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';

// Private Desktop metadata. The Runtime database remains the only task authority.
const kind='desktop-conversations-sqlite-v1';
const tables=['metadata','records','operations'];
const collections=['sessions','turns','messages','preferences'];
const sourceKeys={
  1:['version','turns'],
  2:['version','turns','messages'],
  3:['version','turns','messages','preferences'],
  4:['version','sessions','activeSessions','turns','messages','preferences'],
};
const schema=`
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
  CREATE TABLE records (kind TEXT NOT NULL, record_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
    value TEXT NOT NULL, revision INTEGER NOT NULL,
    PRIMARY KEY(kind,record_id), UNIQUE(kind,ordinal)) STRICT;
  CREATE TABLE operations (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE,
    changes_sha TEXT NOT NULL) STRICT;
`;
const sha=value=>createHash('sha256').update(value).digest('hex');
const dbPath=file=>`${file}.sqlite`;
const backupPath=(file,sourceSha)=>`${file}.pre-sqlite-${sourceSha.slice(0,16)}.bak`;
const exactKeys=(value,keys)=>isDeepStrictEqual(Object.keys(value).sort(),[...keys].sort());
const snapshotValue=state=>({version:4,sessions:state.sessions,activeSessions:state.activeSessions,
  turns:state.turns,messages:state.messages,preferences:state.preferences});
const semantic=state=>sha(JSON.stringify(snapshotValue(state)));
const meta=(db,key)=>db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
const setMeta=(db,key,value)=>db.prepare('INSERT INTO metadata (key,value) VALUES (?,?)').run(key,String(value));
const readBytes=file=>readFileSync(file);

// JSON.parse keeps only the final value of a duplicated object key. Reject those
// spellings before using either the old loader or its Maps as migration evidence.
export function assertUniqueJsonObjectKeys(text) {
  JSON.parse(text);
  let at=0;
  const ws=()=>{while(/\s/.test(text[at]??''))at++;};
  const string=()=>{
    const start=at++;
    while(at<text.length){
      if(text[at]==='\\'){at+=2;continue;}
      if(text[at++]==='"')return JSON.parse(text.slice(start,at));
    }
    throw Error('truncated JSON string');
  };
  const value=()=>{
    ws();
    if(text[at]==='"'){string();return;}
    if(text[at]==='['){
      at++;ws();if(text[at]===']'){at++;return;}
      for(;;){value();ws();if(text[at]===']'){at++;return;}at++;}
    }
    if(text[at]==='{'){
      at++;ws();const names=new Set();if(text[at]==='}'){at++;return;}
      for(;;){
        ws();const name=string();
        if(names.has(name))throw Error('duplicate JSON object key; original source retained');
        names.add(name);ws();at++;value();ws();
        if(text[at]==='}'){at++;return;}at++;
      }
    }
    while(at<text.length&&!',[}] \t\r\n'.includes(text[at]))at++;
  };
  value();ws();
  if(at!==text.length)throw Error('trailing JSON source');
}

function assertSource(sourceBytes,state) {
  const text=sourceBytes.toString('utf8');assertUniqueJsonObjectKeys(text);
  const raw=JSON.parse(text),version=raw?.version;
  if(!sourceKeys[version]||!exactKeys(raw,sourceKeys[version])||!Array.isArray(raw.turns)
    ||version>=2&&!Array.isArray(raw.messages)||version>=3&&!Array.isArray(raw.preferences)
    ||version===4&&(!Array.isArray(raw.sessions)||!raw.activeSessions||typeof raw.activeSessions!=='object'
      ||Array.isArray(raw.activeSessions)||!exactKeys(raw.activeSessions,['panel','workspace']))) {
    throw Error('legacy source shape cannot migrate without loss');
  }
  const unique=(rows,key,label)=>{
    const ids=new Set();
    for(const row of rows){
      const id=key(row);
      if(typeof id!=='string'||!id||ids.has(id))throw Error(`${label} identity cannot migrate without loss`);
      ids.add(id);
    }
  };
  unique(raw.turns,row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.taskId,'turn');
  unique(raw.messages??[],row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.id,'message');
  unique(raw.preferences??[],row=>Array.isArray(row)&&row.length===2&&row[0],'preference');
  if(version===4)unique(raw.sessions,row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.id,'session');
  const pairs=[['turns',raw.turns,state.turns,'taskId'],['messages',raw.messages??[],state.messages,'id'],
    ['preferences',raw.preferences??[],state.preferences,0]];
  if(version===4)pairs.push(['sessions',raw.sessions,state.sessions,'id']);
  for(const [label,rows,loaded,key] of pairs){
    if(rows.length!==loaded.length)throw Error(`${label} count changed by legacy loader`);
    for(let i=0;i<rows.length;i++)if(rows[i][key]!==loaded[i][key])
      throw Error(`${label} order changed by legacy loader`);
  }
  // Turns are copied by the legacy loader; malformed turns are silently skipped.
  for(let i=0;i<raw.turns.length;i++){
    const row=raw.turns[i];
    if(!['panel','workspace'].includes(row.surface)||typeof row.goal!=='string'
      ||!isDeepStrictEqual(row,state.turns[i]))throw Error('turn changed by legacy loader');
  }
  for(let i=0;i<(raw.messages??[]).length;i++){
    const row=raw.messages[i],loaded=state.messages[i];
    if(row.text!==loaded.text||row.id!==loaded.id||row.sessionId!==loaded.sessionId
      ||row.role!==loaded.role||(row.conversationId??'desktop-panel')!==loaded.conversationId
      ||(row.surface??'panel')!==loaded.surface
      ||new Date(row.createdAt).getTime()!==new Date(loaded.createdAt).getTime())
      throw Error('message value changed by legacy loader');
  }
  for(let i=0;i<(raw.preferences??[]).length;i++){
    if(!isDeepStrictEqual(raw.preferences[i][1],state.preferences[i][1]))
      throw Error('preference value changed by legacy loader');
  }
  if(version===4){
    if(!isDeepStrictEqual(raw.sessions,state.sessions)
      ||!isDeepStrictEqual(raw.activeSessions,state.activeSessions))throw Error('session changed by legacy loader');
  }
  return {sourceVersion:String(version),sourceSha:sha(sourceBytes),semanticSha:semantic(state),sourceBytes};
}

function assertMarker(marker) {
  const keys=['version','kind','generation','sourceVersion','sourceSha','backupSha','semanticSha'];
  if(!marker||typeof marker!=='object'||Array.isArray(marker)||marker.version!==5||marker.kind!==kind
    ||!exactKeys(marker,marker.fresh===true?[...keys,'fresh','phase']:keys)
    ||![marker.generation,marker.sourceVersion,marker.sourceSha,marker.backupSha,marker.semanticSha]
      .every(value=>typeof value==='string'&&value.length>0))throw Error('conversation migration marker invalid');
  if(marker.fresh===true&&!(marker.sourceVersion==='fresh'&&marker.sourceSha==='fresh'
    &&marker.backupSha==='none'&&['initializing','ready'].includes(marker.phase)))
    throw Error('fresh conversation marker invalid');
  if(marker.fresh!==true&&(!['1','2','3','4'].includes(marker.sourceVersion)
    ||marker.sourceSha!==marker.backupSha
    ||![marker.sourceSha,marker.backupSha,marker.semanticSha].every(value=>/^[a-f0-9]{64}$/.test(value))))
    throw Error('legacy conversation marker invalid');
  return marker;
}

function configure(db){
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
}
function withReadOnly(file,read){
  const db=new DatabaseSync(dbPath(file),{readOnly:true});
  let began=false;
  try{
    db.exec('BEGIN');began=true;
    const result=read(db);
    db.exec('COMMIT');began=false;
    return result;
  }catch(error){if(began)try{db.exec('ROLLBACK');}catch{}throw error;}
  finally{db.close();}
}
function readState(db){
  const rows=kind=>db.prepare('SELECT record_id,value,revision,ordinal FROM records WHERE kind=? ORDER BY ordinal').all(kind);
  const records=Object.fromEntries([...collections,'active'].map(name=>[name,rows(name)]));
  const total=db.prepare('SELECT count(*) AS n FROM records').get().n;
  if(total!==Object.values(records).reduce((n,items)=>n+items.length,0))
    throw Error('conversation database contains unknown record kind');
  for(const [name,items] of Object.entries(records))items.forEach((row,i)=>{
    if(row.ordinal!==i||!Number.isSafeInteger(row.revision)||row.revision<0)
      throw Error('conversation record order or revision invalid');
    const value=JSON.parse(row.value),identity=name==='turns'?value.taskId
      :name==='preferences'||name==='active'?row.record_id:value.id;
    if(identity!==row.record_id)throw Error('conversation record identity differs');
  });
  if(records.active.length!==2||records.active[0].record_id!=='panel'
    ||records.active[1].record_id!=='workspace'
    ||records.active.some(row=>typeof JSON.parse(row.value)!=='string'))
    throw Error('conversation active record shape invalid');
  const state={sessions:records.sessions.map(row=>JSON.parse(row.value)),
    turns:records.turns.map(row=>JSON.parse(row.value)),
    messages:records.messages.map(row=>JSON.parse(row.value)),
    preferences:records.preferences.map(row=>[row.record_id,JSON.parse(row.value)]),
    activeSessions:Object.fromEntries(records.active.map(row=>[row.record_id,JSON.parse(row.value)]))};
  return {state,records};
}
function importReceipt(db){
  return {generation:meta(db,'generation'),sourceVersion:meta(db,'sourceVersion'),
    sourceSha:meta(db,'sourceSha'),backupSha:meta(db,'backupSha'),semanticSha:meta(db,'semanticSha')};
}
const sourceCounts=state=>({sessions:state.sessions.length,turns:state.turns.length,
  messages:state.messages.length,preferences:state.preferences.length,active:2});
function recordedCounts(db){
  return Object.fromEntries([...collections,'active'].map(name=>[name,Number(meta(db,`importCount:${name}`))]));
}
function databaseShape(file){
  if(!existsSync(dbPath(file)))return 'absent';
  return withReadOnly(file,db=>{
    const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row=>row.name);
    if(!names.length)return 'empty';
    if(!isDeepStrictEqual(names.sort(),[...tables].sort()))throw Error('unknown conversation database shape');
    if(meta(db,'generation'))return 'committed';
    if(db.prepare('SELECT count(*) AS n FROM records').get().n
      ||db.prepare('SELECT count(*) AS n FROM operations').get().n
      ||db.prepare('SELECT count(*) AS n FROM metadata').get().n)throw Error('unmarked conversation database rows');
    return 'empty';
  });
}
function importState(file,state,marker,{fault}={}){
  if(databaseShape(file)==='committed')return;
  const db=new DatabaseSync(dbPath(file));let attempted=false,commitError;
  try{
    configure(db);db.exec('BEGIN IMMEDIATE');
    try{
      const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if(!names.length)db.exec(schema);
      if(meta(db,'generation'))throw Error('concurrent conversation import detected');
      const insert=db.prepare('INSERT INTO records(kind,record_id,ordinal,value,revision) VALUES (?,?,?,?,0)');
      for(const [name,values,key] of [
        ['sessions',state.sessions,'id'],['turns',state.turns,'taskId'],['messages',state.messages,'id']])
        values.forEach((value,i)=>insert.run(name,value[key],i,JSON.stringify(value)));
      state.preferences.forEach(([id,value],i)=>insert.run('preferences',id,i,JSON.stringify(value)));
      for(const [i,surface] of ['panel','workspace'].entries())
        insert.run('active',surface,i,JSON.stringify(state.activeSessions[surface]));
      for(const [key,value] of Object.entries({...marker,stateRevision:'0',schemaVersion:'1',
        ...Object.fromEntries(Object.entries(sourceCounts(state)).map(([name,count])=>[`importCount:${name}`,count]))}))
        if(!['version','kind','fresh','phase'].includes(key))setMeta(db,key,value);
      if(fault==='before_import_commit')throw Error('injected pre-COMMIT import failure');
      attempted=true;db.exec('COMMIT');
    }catch(error){
      commitError=error;
      if(!attempted)try{db.exec('ROLLBACK');}catch{}
    }
  }finally{try{db.close();}catch{}}
  if(fault==='after_import_commit')throw Error('injected post-COMMIT import uncertainty');
  if(commitError){
    if(!attempted)throw commitError;
    // A thrown COMMIT is not proof of failure. Only a separate connection may
    // recognize a durable import; otherwise keep the source and refuse marker.
    try{verifyImported(file,state,marker);}catch{throw commitError;}
  }
}
function verifyImported(file,state,marker){
  return withReadOnly(file,db=>{
    if(!isDeepStrictEqual(importReceipt(db),{
      generation:marker.generation,sourceVersion:marker.sourceVersion,sourceSha:marker.sourceSha,
      backupSha:marker.backupSha,semanticSha:marker.semanticSha}))throw Error('import lineage mismatch');
    if(meta(db,'stateRevision')!=='0'||meta(db,'schemaVersion')!=='1'
      ||!isDeepStrictEqual(recordedCounts(db),sourceCounts(state))
      ||db.prepare('SELECT count(*) AS n FROM operations').get().n!==0)
      throw Error('pending import has unexpected writes');
    const imported=readState(db).state;
    if(!isDeepStrictEqual(imported,state)||semantic(imported)!==marker.semanticSha)
      throw Error('import semantic digest differs');
    return imported;
  });
}
function exactBackup(file,source){
  const backup=backupPath(file,source.sourceSha);
  if(!existsSync(backup))copyFileSync(file,backup,constants.COPYFILE_EXCL);
  if(!readBytes(backup).equals(source.sourceBytes))throw Error('conversation source backup differs');
  const handle=openSync(backup,'r+');
  try{fsyncSync(handle);}finally{closeSync(handle);}
  return backup;
}
function writeFreshMarker(file,marker){
  const bytes=Buffer.from(JSON.stringify(marker)),handle=openSync(file,'wx',0o600);
  try{writeFileSync(handle,bytes);fsyncSync(handle);}finally{closeSync(handle);}
  if(!readBytes(file).equals(bytes))throw Error('fresh marker readback mismatch');
  return bytes;
}
function replaceMarker(file,source,marker,{fault}={}){
  if(!readBytes(file).equals(source.sourceBytes))throw Error('conversation source changed before marker');
  const bytes=Buffer.from(JSON.stringify(marker)),temporary=`${file}.marker-${randomUUID()}.tmp`;
  const handle=openSync(temporary,'wx',0o600);
  try{writeFileSync(handle,bytes);fsyncSync(handle);}finally{closeSync(handle);}
  if(fault==='before_marker')throw Error('injected pre-marker failure');
  try{
    if(fault==='marker_rename')throw Error('injected marker rename failure');
    renameSync(temporary,file);
    if(fault==='after_marker')throw Error('injected marker result uncertainty');
  }catch(error){
    try{if(readBytes(file).equals(bytes))return bytes;}catch{}
    throw error;
  }
  if(!readBytes(file).equals(bytes))throw Error('conversation marker readback mismatch');
  return bytes;
}
function freshMarker(state){return {version:5,kind,fresh:true,phase:'initializing',generation:randomUUID(),sourceVersion:'fresh',
  sourceSha:'fresh',backupSha:'none',semanticSha:semantic(state)};}
function promoteFreshMarker(file,initialBytes,marker){
  if(marker.phase!=='initializing')throw Error('fresh marker is not initializing');
  return replaceMarker(file,{sourceBytes:initialBytes},{...marker,phase:'ready'});
}
function legacyMarker(state,source,backup){return {version:5,kind,generation:randomUUID(),
  sourceVersion:source.sourceVersion,sourceSha:source.sourceSha,backupSha:sha(readBytes(backup)),
  semanticSha:semantic(state)};}

export function readConversationMarker(bytes){
  const text=bytes.toString('utf8');assertUniqueJsonObjectKeys(text);
  const value=JSON.parse(text);
  return value?.version===5?assertMarker(value):null;
}

export function openConversationSqliteStore(file,markerBytes,initialState){
  let marker=readConversationMarker(markerBytes);
  if(!marker)throw Error('conversation marker missing');
  if(marker.fresh===true){
    if(marker.phase==='initializing'){
      if(!initialState||semantic(initialState)!==marker.semanticSha)throw Error('fresh marker needs exact default state');
      if(databaseShape(file)!=='committed')importState(file,initialState,marker);
      verifyImported(file,initialState,marker);
      markerBytes=promoteFreshMarker(file,markerBytes,marker);
      marker=readConversationMarker(markerBytes);
    }else if(databaseShape(file)!=='committed'){
      throw Error('ready conversation marker database missing; recovery required');
    }
  }else{
    const backup=backupPath(file,marker.sourceSha);
    if(!existsSync(backup)||sha(readBytes(backup))!==marker.backupSha)
      throw Error('conversation migration backup missing or changed');
    if(databaseShape(file)!=='committed')throw Error('conversation marker database missing');
  }
  if(databaseShape(file)!=='committed')throw Error('conversation database incomplete');
  const db=new DatabaseSync(dbPath(file));
  let reading=false;
  try{
    configure(db);
    db.exec('BEGIN');reading=true;
    if(meta(db,'schemaVersion')!=='1'||Object.values(recordedCounts(db)).some(n=>!Number.isSafeInteger(n)||n<0)
      ||!isDeepStrictEqual(importReceipt(db),{
      generation:marker.generation,sourceVersion:marker.sourceVersion,sourceSha:marker.sourceSha,
      backupSha:marker.backupSha,semanticSha:marker.semanticSha}))throw Error('conversation marker/database generation mismatch');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('conversation database integrity check failed');
    const {state,records}=readState(db),revision=Number(meta(db,'stateRevision'));
    if(!Number.isSafeInteger(revision)||revision<0)throw Error('conversation database revision invalid');
    db.exec('COMMIT');reading=false;
    return {store:new ConversationSqliteStore(file,markerBytes,db,revision,records),state};
  }catch(error){if(reading)try{db.exec('ROLLBACK');}catch{}db.close();throw error;}
}

export function prepareConversationSqliteStore(file,state,legacyBytes,{fault}={}){
  mkdirSync(path.dirname(file),{recursive:true});
  let marker,bytes;
  if(legacyBytes){
    if(!readBytes(file).equals(legacyBytes))throw Error('conversation source changed before lazy migration');
    const source=assertSource(legacyBytes,state),backup=exactBackup(file,source);
    marker=legacyMarker(state,source,backup);
    if(databaseShape(file)==='committed'){
      const receipt=withReadOnly(file,importReceipt);
      marker.generation=receipt.generation;
      if(!marker.generation)throw Error('conversation import receipt missing');
    }else importState(file,state,marker,{fault});
    if(fault==='import_readback_unavailable')throw Error('injected import readback unavailable');
    verifyImported(file,state,marker);
    bytes=replaceMarker(file,source,marker,{fault});
  }else{
    if(existsSync(file)||existsSync(dbPath(file)))throw Error('new conversation profile changed before first write');
    marker=freshMarker(state);bytes=writeFreshMarker(file,marker);
    if(fault==='fresh_after_marker')throw Error('injected fresh marker before DB');
    importState(file,state,marker,{fault});verifyImported(file,state,marker);
  }
  const opened=openConversationSqliteStore(file,bytes,state);
  if(!isDeepStrictEqual(opened.state,state)){
    opened.store.close();throw Error('conversation migration state differs after open');
  }
  return opened.store;
}

export function inspectPendingConversationMigration(file,state,legacyBytes){
  if(databaseShape(file)!=='committed')return;
  const source=assertSource(legacyBytes,state),backup=backupPath(file,source.sourceSha);
  if(!existsSync(backup)||!readBytes(backup).equals(legacyBytes))
    throw Error('pending conversation backup missing or changed');
  const receipt=withReadOnly(file,importReceipt);
  const marker={version:5,kind,generation:receipt.generation,sourceVersion:source.sourceVersion,
    sourceSha:source.sourceSha,backupSha:sha(readBytes(backup)),semanticSha:source.semanticSha};
  verifyImported(file,state,marker);
}

export function canRetryConversationMigration(file,state,legacyBytes){
  try{
    if(legacyBytes){
      if(!readBytes(file).equals(legacyBytes))return false;
      inspectPendingConversationMigration(file,state,legacyBytes);
      return true;
    }
    // A fresh marker may already protect the path, and a first business write
    // has not run yet. Reopening is required to validate its phase and DB.
    return !existsSync(file)&&!existsSync(dbPath(file));
  }catch{return false;}
}

export class ConversationSqliteStore {
  constructor(file,markerBytes,db,revision,records){
    this.file=file;this.markerBytes=markerBytes;this.marker=readConversationMarker(markerBytes);
    this.db=db;this.stateRevision=revision;this.frozen=false;
    this.rowHashes=new Map(Object.entries(records).flatMap(([name,items])=>items.map(row=>
      [name+'\0'+row.record_id,sha(row.value)])));
  }
  assertWritable(){
    if(this.frozen||!this.db)throw Error('conversation write outcome uncertain; reopen required');
    let found;
    try{found=readBytes(this.file);}catch{this.frozen=true;throw Error('conversation marker unreadable; writes frozen');}
    if(!found.equals(this.markerBytes)){this.frozen=true;throw Error('conversation marker changed; writes frozen');}
  }
  commit(changes,{fault}={}){
    this.assertWritable();
    if(!Array.isArray(changes)||!changes.length)throw Error('conversation write changes missing');
    const seen=new Set();
    for(const change of changes){
      if(![...collections,'active'].includes(change.kind)||typeof change.id!=='string'||!change.id
        ||seen.has(change.kind+'\0'+change.id))throw Error('conversation write changes invalid');
      seen.add(change.kind+'\0'+change.id);
    }
    const operationId=randomUUID(),sequence=this.stateRevision+1,receipt=[];
    let began=false,commitAttempted=false,committed=false;
    try{
      this.db.exec('BEGIN IMMEDIATE');began=true;
      if(meta(this.db,'schemaVersion')!=='1'||!isDeepStrictEqual(importReceipt(this.db),{
        generation:this.marker.generation,sourceVersion:this.marker.sourceVersion,
        sourceSha:this.marker.sourceSha,backupSha:this.marker.backupSha,
        semanticSha:this.marker.semanticSha})){
        this.frozen=true;throw Error('conversation database lineage changed; reopen required');
      }
      if(meta(this.db,'stateRevision')!==String(this.stateRevision)){
        this.frozen=true;throw Error('stale conversation writer; reopen required');
      }
      for(const change of changes){
        const row=this.db.prepare('SELECT value,revision FROM records WHERE kind=? AND record_id=?')
          .get(change.kind,change.id),encoded=JSON.stringify(change.value),revision=(row?.revision??-1)+1;
        const priorHash=this.rowHashes.get(change.kind+'\0'+change.id);
        if((row&&sha(row.value)!==priorHash)||(!row&&priorHash!==undefined)){
          this.frozen=true;throw Error('conversation row changed outside this writer; reopen required');
        }
        if(row){
          const updated=this.db.prepare('UPDATE records SET value=?,revision=? WHERE kind=? AND record_id=? AND revision=?')
            .run(encoded,revision,change.kind,change.id,row.revision);
          if(updated.changes!==1)throw Error('conversation row CAS failed');
        }else{
          const ordinal=this.db.prepare('SELECT coalesce(max(ordinal),-1)+1 AS next FROM records WHERE kind=?').get(change.kind).next;
          this.db.prepare('INSERT INTO records(kind,record_id,ordinal,value,revision) VALUES (?,?,?,?,0)')
            .run(change.kind,change.id,ordinal,encoded);
        }
        receipt.push({kind:change.kind,id:change.id,revision,sha:sha(encoded)});
      }
      const changed=this.db.prepare("UPDATE metadata SET value=? WHERE key='stateRevision' AND value=?")
        .run(String(sequence),String(this.stateRevision));
      if(changed.changes!==1)throw Error('conversation state CAS failed');
      this.db.prepare('INSERT INTO operations(id,sequence,changes_sha) VALUES (?,?,?)')
        .run(operationId,sequence,sha(JSON.stringify(receipt)));
      if(fault==='before_commit')throw Error('injected pre-COMMIT conversation write failure');
      this.assertWritable();
      commitAttempted=true;this.db.exec('COMMIT');committed=true;
      if(fault==='after_commit'||fault==='readback_unavailable')throw Error('injected post-COMMIT uncertainty');
      for(const change of receipt)this.rowHashes.set(change.kind+'\0'+change.id,change.sha);
      this.stateRevision=sequence;return;
    }catch(error){
      if(!commitAttempted){
        if(began)try{this.db.exec('ROLLBACK');}catch{this.frozen=true;try{this.close();}catch{}}
        throw error;
      }
      // A thrown COMMIT can leave uncommitted rows visible on this writer.
      // Close/isolate it first; a separate read-only connection is the witness.
      if(!committed){this.frozen=true;try{this.close();}catch{}}
      if(fault==='readback_unavailable'){this.frozen=true;throw error;}
      try{
        const confirmed=withReadOnly(this.file,reader=>{
          const op=reader.prepare('SELECT sequence,changes_sha FROM operations WHERE id=?').get(operationId);
          if(!op||op.sequence!==sequence||op.changes_sha!==sha(JSON.stringify(receipt))
            ||meta(reader,'stateRevision')!==String(sequence))return false;
          return receipt.every(change=>{
            const row=reader.prepare('SELECT value,revision FROM records WHERE kind=? AND record_id=?')
              .get(change.kind,change.id);
            return row?.revision===change.revision&&sha(row.value)===change.sha;
          });
        });
        if(confirmed&&readBytes(this.file).equals(this.markerBytes)){
          for(const change of receipt)this.rowHashes.set(change.kind+'\0'+change.id,change.sha);
          this.stateRevision=sequence;return;
        }
      }catch{}
      this.frozen=true;throw error;
    }
  }
  close(){if(this.db){this.db.close();this.db=undefined;}}
}
