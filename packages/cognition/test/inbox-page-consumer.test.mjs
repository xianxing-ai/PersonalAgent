import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createInboxPageConsumer, measureTriageClassifier} from '../dist/index.js';

const context=()=>({accountRef:'public-synthetic',folder:'INBOX',deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal});
// Explicit cursor-only fixture. This tests the wrapper; actual cache/receipt recovery
// is tested by the existing injected p5-small-mail-batch production acceptance.
function fixture() {
  let cursor, busy=false;
  const calls=[];
  const pipeline={readCursor:()=>cursor,snapshot:()=>({cursor}),async processPage(page){
    assert.equal(busy,false);busy=true;
    try {calls.push(page);cursor=page.nextCursor;return {classified:page.items.length,reused:0,
      complete:true,cursorAdvanced:true,nextCursor:cursor,hasMore:page.hasMore,summary:{cursor}};}
    finally {busy=false;}
  }};
  return {pipeline,calls,consumer:createInboxPageConsumer({pipeline})};
}
test('single-page submission binds scope, cursors and item membership before asynchronous handoff', async () => {
  const f = fixture(), item = {id: 'one'}, input = {...context(), cursor: '1:0', nextCursor: '1:4',
    hasMore: false, items: [item]};
  const originalScope = {accountRef: input.accountRef, folder: input.folder};
  const pending = f.consumer.processPage(input);
  input.accountRef = 'different-account'; input.folder = 'Trash';
  input.cursor = 'other-before'; input.nextCursor = 'other-after'; input.hasMore = true;
  input.items.push({id: 'added-after-submission'});
  const originalProcess = f.pipeline.processPage; let liveCalls = 0;
  f.pipeline.processPage = page => {liveCalls++; return originalProcess(page);};
  const result = await pending;
  assert.equal(liveCalls, 1);
  assert.equal(result.classified, 1);
  assert.equal(result.nextCursor, '1:4');
  assert.equal(result.hasMore, false);
  assert.equal(f.calls[0].accountRef, originalScope.accountRef);
  assert.equal(f.calls[0].folder, originalScope.folder);
  assert.equal(f.calls[0].cursor, '1:0');
  assert.deepEqual(f.calls[0].items, [item]);
  assert.equal(f.calls[0].items[0], item, 'Generic item values retain their original object identity');
});
test('retained source pages cannot replace acknowledged cursors, skip remaining pages or change item membership', async () => {
  for (const mutation of ['hasMore', 'cursor', 'items']) {
    const f = fixture(), fetched = [], acknowledged = [], item = {id: 'one'};
    const page = {items: [item], nextCursor: '1:4', hasMore: true};
    let entered, release;
    const started = new Promise(resolve => {entered = resolve;});
    const waiting = new Promise(resolve => {release = resolve;});
    const originalProcess = f.pipeline.processPage;
    f.pipeline.processPage = async input => {entered(); await waiting; return originalProcess(input);};
    const pending = f.consumer.processStream({...context(), fetchPage: async ({cursor}) => {
      fetched.push(cursor);
      return cursor === undefined ? page : {items: [{id: 'two'}], nextCursor: '1:8', hasMore: false};
    }, onPageCompleted: input => acknowledged.push(input.cursor)});
    await started;
    if (mutation === 'hasMore') page.hasMore = false;
    else if (mutation === 'cursor') page.nextCursor = 'forged-cursor';
    else page.items.push({id: 'added-after-return'});
    release();
    const result = await pending;
    assert.equal(result.pagesProcessed, 2, mutation);
    assert.equal(result.classified, 2, mutation);
    assert.equal(result.cursor, '1:8', mutation);
    assert.equal(result.stoppedReason, 'completed', mutation);
    assert.deepEqual(fetched, [undefined, '1:4'], mutation);
    assert.deepEqual(acknowledged, ['1:4', '1:8'], mutation);
    assert.equal(f.calls[0].items.length, 1, mutation);
    assert.equal(f.calls[0].items[0], item, 'Generic item values retain their original object identity');
  }
});
test('page backpressure persists cursor before pause and new wrapper resumes that exact source cursor',async()=>{
  const f=fixture(),fetched=[];
  const fetchPage=async({cursor})=>{fetched.push(cursor);return cursor===undefined
    ?{items:['one'],nextCursor:'1:4',hasMore:true}:{items:['two'],nextCursor:'1:8',hasMore:false};};
  const first=await f.consumer.processStream({...context(),fetchPage,onPageCompleted:()=>f.consumer.pause()});
  assert.equal(first.stoppedReason,'paused');assert.equal(first.cursor,'1:4');assert.deepEqual(fetched,[undefined]);
  const reopened=createInboxPageConsumer({pipeline:f.pipeline});
  const second=await reopened.processStream({...context(),fetchPage});
  assert.equal(second.stoppedReason,'completed');assert.equal(second.cursor,'1:8');assert.deepEqual(fetched,[undefined,'1:4']);
});
test('unfinished page never fetches the next page or advances the cursor',async()=>{
  let fetched=0;
  const pipeline={readCursor:()=>undefined,snapshot:()=>({}),processPage:async()=>({classified:0,reused:0,
    complete:false,cursorAdvanced:false,nextCursor:undefined,hasMore:true,summary:{}})};
  const result=await createInboxPageConsumer({pipeline}).processStream({...context(),fetchPage:async()=>{
    fetched++;return {items:['one'],nextCursor:'1:4',hasMore:true};}});
  assert.equal(fetched,1);assert.equal(result.pagesProcessed,0);assert.equal(result.cursor,undefined);
  assert.equal(result.stoppedReason,'classification_unavailable');
});
test('cancelled request does not fetch and an uncooperative source is bounded by deadline',async()=>{
  const f=fixture();let fetched=0;
  const cancelled=new AbortController();cancelled.abort();
  const result=await f.consumer.processStream({...context(),signal:cancelled.signal,fetchPage:async()=>{fetched++;throw Error();}});
  assert.equal(result.stoppedReason,'cancelled');assert.equal(fetched,0);
  await assert.rejects(f.consumer.processStream({...context(),deadline:new Date(Date.now()+30).toISOString(),
    fetchPage:async()=>new Promise(()=>{})}),{code:'TIMEOUT'});
  assert.equal(f.calls.length,0);
});
test('metrics count real classify awaits and completed determinations, with no timing floor',async()=>{
  let time=5;
  const measured=measureTriageClassifier({classify:async()=>{time=9;return [{reason:'uncertain'},{reason:'unavailable'}];}},()=>time);
  await measured.classify({messages:[{text:'public sample'},{text:'another sample'}]});
  assert.deepEqual(measured.snapshot(),{classifyCalls:1,submittedCount:2,inferredCount:1,classifyWallMs:4});
});
test('a running consumer serializes pages and snapshots, and close freezes the lifecycle against resume or streams',async()=>{
  const f=fixture();
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});
  const waiting=new Promise(resolve=>{release=resolve;});
  const originalProcess=f.pipeline.processPage;
  f.pipeline.processPage=async input=>{entered();await waiting;return originalProcess(input);};
  const running=f.consumer.processStream({...context(),
    fetchPage:async()=>({items:['one'],nextCursor:'1:4',hasMore:false})});
  await started;
  assert.equal(f.consumer.snapshot().running,true,'the in-flight stream is visible in the snapshot');
  await assert.rejects(f.consumer.processStream({...context(),
    fetchPage:async()=>({items:[],nextCursor:'x',hasMore:false})}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(f.consumer.processPage({...context(),cursor:'1:0',nextCursor:'1:4',hasMore:false,items:[]}),
    {code:'NOT_APPLICABLE'},'a concurrent page handoff is refused while a stream owns the wrapper');
  release();
  const done=await running;
  assert.equal(done.stoppedReason,'completed');
  assert.deepEqual(f.consumer.snapshot(),{paused:false,closed:false,running:false,inbox:{cursor:'1:4'}});
  f.consumer.close();
  assert.equal(f.consumer.snapshot().closed,true);
  assert.equal(f.consumer.snapshot().paused,true);
  assert.throws(()=>f.consumer.resume(),{code:'INVALID_ARGUMENT'});
  await assert.rejects(f.consumer.processStream({...context(),
    fetchPage:async()=>({items:[],nextCursor:'x',hasMore:false})}),{code:'INVALID_ARGUMENT'});
});
test('malformed page submissions and stream options are rejected before any source or pipeline access',async()=>{
  const f=fixture();
  let fetches=0;
  const fetchPage=async()=>{fetches++;return {items:[],nextCursor:'1:0',hasMore:false};};
  const base=context();
  for(const broken of [{accountRef:'   '},{folder:''},{deadline:'yesterday'},{signal:'abort-me'}]) {
    assert.throws(()=>f.consumer.processPage({...base,...broken,nextCursor:'1:4',hasMore:false,items:[]}),
      {code:'INVALID_ARGUMENT'},JSON.stringify(broken));
    await assert.rejects(f.consumer.processStream({...base,...broken,fetchPage}),{code:'INVALID_ARGUMENT'},JSON.stringify(broken));
  }
  for(const options of [{maxPages:0},{maxPages:1001},{maxPages:1.5},{pageSize:0},{pageSize:101}]) {
    await assert.rejects(f.consumer.processStream({...base,fetchPage,...options}),{code:'INVALID_ARGUMENT'},JSON.stringify(options));
  }
  await assert.rejects(f.consumer.processStream({...base,fetchPage:'nope'}),{code:'INVALID_ARGUMENT'});
  assert.equal(fetches,0);
  assert.equal(f.calls.length,0,'neither the pipeline nor the source may observe rejected input');
});
test('hostile page shapes and stalled cursors never reach the pipeline, and maxPages bounds the run',async()=>{
  for(const [name,page] of [
    ['missing page',null],
    ['non-array items',{items:'one',nextCursor:'1:4',hasMore:false}],
    ['oversized page',{items:[1,2,3,4,5],nextCursor:'1:4',hasMore:false}],
    ['blank cursor',{items:[1],nextCursor:'  ',hasMore:false}],
    ['non-boolean hasMore',{items:[1],nextCursor:'1:4',hasMore:1}],
  ]) {
    const f=fixture();
    await assert.rejects(f.consumer.processStream({...context(),fetchPage:async()=>page}),{code:'INVALID_ARGUMENT'},name);
    assert.equal(f.calls.length,0,name);
  }
  const stalled=fixture();
  await assert.rejects(stalled.consumer.processStream({...context(),fetchPage:async({cursor})=>cursor===undefined
    ?{items:['one'],nextCursor:'1:4',hasMore:true}:{items:['two'],nextCursor:'1:4',hasMore:true}}),{code:'INVALID_ARGUMENT'},
    'a hasMore source repeating its own cursor would loop forever');
  assert.equal(stalled.calls.length,1);
  const reconfirmed=fixture();
  const same=await reconfirmed.consumer.processStream({...context(),fetchPage:async({cursor})=>cursor===undefined
    ?{items:['one'],nextCursor:'1:4',hasMore:true}:{items:['two'],nextCursor:'1:4',hasMore:false}});
  assert.equal(same.stoppedReason,'completed','re-affirming the cursor without hasMore is a normal completion');
  assert.deepEqual(reconfirmed.calls.map(page=>page.items.length),[1,1]);
  const bounded=fixture();
  let pages=0;
  const limited=await bounded.consumer.processStream({...context(),maxPages:2,pageSize:1,
    fetchPage:async()=>{pages++;return {items:[`page-${pages}`],nextCursor:`1:${pages*4}`,hasMore:pages<3};}});
  assert.equal(pages,2,'the third page is never fetched once maxPages is exhausted');
  assert.equal(limited.stoppedReason,'max_pages');
  assert.equal(limited.pagesProcessed,2);
  assert.equal(limited.hasMore,true);
  assert.equal(limited.cursor,'1:8');
  assert.deepEqual(bounded.calls.map(page=>page.items.length),[1,1]);
});
