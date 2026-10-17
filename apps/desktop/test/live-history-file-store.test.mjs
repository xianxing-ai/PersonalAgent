import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createLiveHistoryFileStore} from '../electron/live-history-file-store.js';
import {createLiveHistoryQueue} from '../electron/live-history-queue.js';

const source=await readFile(new URL('../electron/live-history-file-store.js',import.meta.url),'utf8');
// The original production FileStore runs with real disk operations. Only the
// named failing operation is replaced, to reproduce transient I/O deterministically.
const executable=source.replace(/^import .*;\r?\n/gm,'').replace('export function ','function ')
  +'\ncreateLiveHistoryFileStore;';
const message={id:'synthetic-history',sessionId:'synthetic-session',role:'assistant',
  text:'Public fixture pending transcript',createdAt:'2026-10-17T00:00:00.000Z'};
function fixture(t,existing=[message]){
  const directory=fs.mkdtempSync(path.join(tmpdir(),'pa-history-store-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'recovery.json');
  if(existing!==undefined)createLiveHistoryFileStore(file).write(existing);
  return {file};
}
function faultyStore(file,{operation='renameSync',readable=true}={}){
  const failure=Object.assign(Error('Synthetic synchronous I/O failure'),{code:'EPERM'});
  let failures=0,readbacks=0,failed=false;
  const io={...fs,path,[operation](){failures++;failed=true;throw failure;},
    readFileSync(...args){
      if(failed){readbacks++;if(!readable)throw Object.assign(Error('Synthetic unavailable readback'),{code:'EACCES'});}
      return fs.readFileSync(...args);
    }};
  const create=vm.runInNewContext(executable,io);
  return {store:create(file),failure,counts:()=>({failures,readbacks})};
}

for(const operation of ['openSync','renameSync'])test(`identical committed history survives ${operation} failure only after exact readback`,t=>{
  const {file}=fixture(t),before=fs.readFileSync(file,'utf8');
  const faulty=faultyStore(file,{operation}),queue=createLiveHistoryQueue({store:faulty.store});
  queue.flush(()=>{throw Error('Synthetic Conversations sink failure');});
  assert.deepEqual(queue.messages(),[message]);
  assert.deepEqual(queue.snapshot(),{pending:1,durable:true,degraded:true,rejected:0});
  assert.deepEqual(faulty.counts(),{failures:2,readbacks:2},'each write is attempted once, never retried');
  assert.equal(fs.readFileSync(file,'utf8'),before);
});

for(const [name,existing,readable] of [
  ['older transcript',[{...message,text:'Older committed revision'}],true],
  ['missing pending item',[],true],
  ['different identity',[{...message,id:'different-message'}],true],
  ['unreadable destination',[message],false],
])test(`failed history write cannot claim durability for ${name}`,t=>{
  const {file}=fixture(t,existing),before=fs.readFileSync(file,'utf8');
  const faulty=faultyStore(file,{readable}),queue=createLiveHistoryQueue({store:faulty.store});
  queue.enqueue(message);
  queue.flush(()=>{throw Error('Synthetic Conversations sink failure');});
  assert.equal(queue.snapshot().durable,false);assert.equal(queue.snapshot().degraded,true);
  assert.ok(queue.messages().some(item=>item.id===message.id&&item.text===message.text));
  assert.equal(fs.readFileSync(file,'utf8'),before);
});

test('missing committed destination cannot be replaced by the uncommitted pending file',t=>{
  const {file}=fixture(t);fs.unlinkSync(file);
  const faulty=faultyStore(file);
  assert.throws(()=>faulty.store.write([message]),error=>error===faulty.failure);
  assert.equal(fs.existsSync(file),false);
  assert.equal(fs.readFileSync(file+'.pending','utf8'),JSON.stringify({version:1,messages:[message]}));
  assert.deepEqual(faulty.counts(),{failures:1,readbacks:1});
});
