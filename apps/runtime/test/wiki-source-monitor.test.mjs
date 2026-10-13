import assert from 'node:assert/strict';
import test from 'node:test';
import {createWikiSourceMonitor} from '../dist/application/wiki-source-monitor.js';

const scope=()=>({signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
const page=(path='one.md',revision='a',pageId='one')=>({path,revision,pageId});
function fixture(){
  let binding={sourceId:'synthetic',namespace:'synthetic',configRevision:1,dataLevel:'private',available:true};
  let pages=[page()],failScan=false,failProjection=false,scans=0,releases=0,read=async()=>{};
  const projected=[];
  const host=createWikiSourceMonitor({source:{snapshot:()=>({...binding}),acquireWiki(expected,context){
    const revision=binding.configRevision;
    return {signal:context.signal,assertCurrent(){assert.equal(revision,binding.configRevision);assert.equal(binding.available,true);},
      release(){releases++;},wiki:{scanPages:async()=>{scans++;await read();if(failScan)throw Error('private path must not leak');return pages;}}};
  }},revalidate:async(input,context)=>{
    projected.push(structuredClone(input));if(context.signal.aborted)throw Error('cancelled');if(failProjection)throw Error('projection unavailable');
  }});
  return {host,projected,scans:()=>scans,releases:()=>releases,setPages:value=>{pages=value;},
    failScan:value=>{failScan=value;},failProjection:value=>{failProjection=value;},
    change:()=>{binding.configRevision++;},revoke:()=>{binding.available=false;},read:value=>{read=value;}};
}

test('first scan validates existing facts, unchanged scans do nothing, edits/moves/replacement retain old locations',async()=>{
  const f=fixture();await f.host.refresh(scope());assert.deepEqual(f.projected,[{sourceId:'synthetic',configRevision:1}]);
  await f.host.refresh(scope());assert.equal(f.projected.length,1);
  f.setPages([page('moved.md','b'),page('one.md','a','copy')]);await f.host.refresh(scope());
  assert.deepEqual(new Set(f.projected[1].paths),new Set(['one.md','moved.md']));
  assert.equal(f.host.snapshot().pageCount,2);assert.equal(f.host.snapshot().state,'ready');
  f.setPages([]);await f.host.refresh(scope());assert.deepEqual(new Set(f.projected[2].paths),new Set(['one.md','moved.md']));
  assert.equal(f.releases(),4);
});

test('scan and partial projection failure keep old inventory; next read retries the exact change',async()=>{
  const f=fixture();await f.host.refresh(scope());f.setPages([page('one.md','b')]);
  f.failScan(true);await f.host.refresh(scope());assert.equal(f.projected.length,1);
  assert.equal(f.host.snapshot().state,'retry_pending');assert.equal(JSON.stringify(f.host.snapshot()).includes('private path'),false);
  f.failScan(false);f.failProjection(true);await f.host.refresh(scope());
  assert.deepEqual(f.projected[1].paths,['one.md']);assert.equal(f.host.snapshot().state,'retry_pending');
  f.failProjection(false);await f.host.refresh(scope());assert.deepEqual(f.projected[2],f.projected[1]);
  await f.host.refresh(scope());assert.equal(f.projected.length,3);assert.equal(f.host.snapshot().state,'ready');
});

test('tick throttles existing host timer and source replacement immediately rechecks all existing facts',async()=>{
  const f=fixture();assert.equal(await f.host.tick(),true);assert.equal(await f.host.tick(),false);assert.equal(f.scans(),1);
  f.change();assert.equal(await f.host.tick(),true);assert.deepEqual(f.projected[1],{sourceId:'synthetic',configRevision:2});
  f.revoke();assert.equal(await f.host.tick(),true);assert.equal(f.scans(),2);assert.equal(f.host.snapshot().state,'unavailable');
  assert.equal(await f.host.tick(),false);
});

test('in-flight scans are shared; close/revocation/cancel/expiry never dispatch a late projection',async()=>{
  for(const stop of ['close','revoke','cancel','expired']){
    const f=fixture();let release;f.read(()=>new Promise(resolve=>{release=resolve;}));
    const request=scope(),abort=new AbortController();request.signal=abort.signal;
    const first=f.host.refresh(request),second=f.host.refresh(scope());assert.equal(first,second);
    if(stop==='close')f.host.close();if(stop==='revoke')f.revoke();if(stop==='cancel')abort.abort();
    if(stop==='expired')request.deadline='2000-01-01T00:00:00.000Z';
    // Context was snapshotted; use an already expired request separately below.
    if(stop==='expired'){release();await first;const count=f.projected.length;await f.host.refresh(request);assert.equal(f.projected.length,count);}
    else{release();await first;assert.equal(f.projected.length,0);}
    assert.equal(f.releases(),stop==='expired'?2:1);
    if(stop==='close'){assert.equal(f.host.snapshot().state,'closed');assert.equal(await f.host.tick(),false);}
  }
});
