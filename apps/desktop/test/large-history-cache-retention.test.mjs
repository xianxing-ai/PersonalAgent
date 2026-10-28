import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function collect(mode){
  const module=new URL('../electron/task-projection-cache.js',import.meta.url).href;
  const source=`
    import {TaskProjectionCache} from ${JSON.stringify(module)};
    const cache=new TaskProjectionCache({terminalLimit:2});
    const task=(id,revision=1,state='running',createdAt='2026-01-01')=>({taskId:id,revision,state,createdAt,resultSummary:'Synthetic public body '+id});
    cache.set('unknown',task('unknown',1,'waiting_reconciliation'));
    cache.set('approval',task('approval',1,'waiting_approval'));
    for(let index=0;index<300;index++)cache.set('task-'+index,task('task-'+index));
    cache.ordered(value=>value.createdAt);
    let retired;
    if(${JSON.stringify(mode)}==='prune'){
      cache.set('task-0',task('task-0',2,'succeeded'));
      retired=new WeakRef(cache.get('task-0'));
      for(let index=1;index<300;index++)cache.set('task-'+index,task('task-'+index,2,'succeeded'));
    }else if(${JSON.stringify(mode)}==='delete'){
      retired=new WeakRef(cache.get('task-0'));cache.delete('task-0');
    }else{
      retired=new WeakRef(cache.get('task-0'));cache.set('task-0',task('task-0',2,'running','2026-01-02'));
    }
    for(let index=0;index<5;index++){await new Promise(setImmediate);globalThis.gc();}
    await new Promise(setImmediate);
    console.log(JSON.stringify({retained:retired.deref()!==undefined,size:cache.size,
      unknown:cache.get('unknown').state,approval:cache.get('approval').state}));
  `;
  const result=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',source],
    {encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout.trim());
}

test('hidden-window terminal eviction releases the obsolete ordered payload without another snapshot',()=>{
  const result=collect('prune');
  assert.equal(result.size,4);assert.equal(result.unknown,'waiting_reconciliation');assert.equal(result.approval,'waiting_approval');
  assert.equal(result.retained,false,'an evicted terminal body must not remain strongly referenced by the display-order cache');
});

test('explicit display-cache deletion releases its old ordered payload immediately',()=>{
  const result=collect('delete');
  assert.equal(result.size,301);assert.equal(result.retained,false);
});

test('changing a display sort key releases the replaced payload while the window stays hidden',()=>{
  const result=collect('replace');
  assert.equal(result.size,302);assert.equal(result.retained,false);
});
