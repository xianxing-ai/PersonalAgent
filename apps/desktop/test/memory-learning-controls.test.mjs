import assert from 'node:assert/strict';
import test from 'node:test';
import {memoryLearningControlsHtml, mountMemoryLearningControls} from '../src/features/admin/memory-learning-controls.js';

function fixture(invoke) {
  let click;
  const fields={workflow:'reference-review',revision:'1',path:'reference.md',summary:'Synthetic workflow'};
  const root={innerHTML:'',contains:()=>true,
    querySelector:selector=>({value:fields[selector.match(/ml-(\w+)/)[1]]}),
    addEventListener:(_name,handler)=>{click=handler;}};
  const controls=mountMemoryLearningControls(root,{status:{learningAvailable:true},invoke});
  return {root,fields,controls,async action(action) {
    await click({target:{closest:()=>({dataset:{mlAction:action},disabled:false})}});
  }};
}

const version={workflowId:'reference-review',revision:1,validation:'passed',hasEvidence:true};

test('a cancellation request preserves the exact task handle until Runtime reports a terminal state',async()=>{
  const calls=[];
  let stopped=false;
  const f=fixture(async(name,payload)=>{
    calls.push([name,payload]);
    if(name==='learning.read') return {version,active:version};
    if(name==='learning.run') return {taskId:'original-task',state:'running'};
    if(name==='learning.stop') return {taskId:'original-task',state:stopped?'cancelled':'running',cancelRequested:true};
  });
  await f.action('read');
  await f.action('run');
  await f.action('stop');
  assert.match(f.root.innerHTML,/可停止任务：original-task/);
  assert.match(f.root.innerHTML,/尚未确认停止/);
  assert.doesNotMatch(f.root.innerHTML,/data-ml-action="stop" disabled/);
  f.fields.workflow='unrelated-draft';f.fields.revision='2';
  stopped=true;
  await f.action('stop');
  assert.deepEqual(calls.filter(([name])=>name==='learning.stop').map(([,payload])=>payload),[
    {workflowId:'reference-review',revision:1,taskId:'original-task'},
    {workflowId:'reference-review',revision:1,taskId:'original-task'},
  ]);
  assert.doesNotMatch(f.root.innerHTML,/可停止任务：/);
  assert.match(f.root.innerHTML,/任务当前为已取消/);
  assert.match(f.root.innerHTML,/data-ml-action="stop" disabled/);
  f.controls.dispose();
});

test('a missing version read clears the stale version and its activation controls',async()=>{
  let missing=false;
  const f=fixture(async()=>missing?{version:null,active:null}:{version,active:version});
  await f.action('read');
  assert.doesNotMatch(f.root.innerHTML,/data-ml-action="activate" disabled/);
  missing=true;f.fields.revision='99';
  await f.action('read');
  assert.match(f.root.innerHTML,/尚未选择流程版本/);
  assert.match(f.root.innerHTML,/所选版本不存在/);
  for(const action of ['activate','run','erase'])assert.match(f.root.innerHTML,new RegExp(`data-ml-action="${action}" disabled`));
  f.controls.dispose();
});

test('a failed version read clears stale actions without claiming the lookup succeeded',async()=>{
  let failure=false;
  const f=fixture(async()=>{
    if(failure)throw Error('Learning operation failed: NOT_FOUND');
    return {version,active:version};
  });
  await f.action('read');
  failure=true;f.fields.revision='99';
  await f.action('read');
  assert.match(f.root.innerHTML,/尚未选择流程版本/);
  assert.match(f.root.innerHTML,/版本未读回，已清除旧选择/);
  assert.doesNotMatch(f.root.innerHTML,/状态已读回/);
  for(const action of ['activate','run','erase'])assert.match(f.root.innerHTML,new RegExp(`data-ml-action="${action}" disabled`));
  failure=false;f.fields.revision='1';
  await f.action('read');
  assert.match(f.root.innerHTML,/当前启用：v1/);
  assert.doesNotMatch(f.root.innerHTML,/data-ml-action="activate" disabled/);
  f.controls.dispose();
});

test('declined activation and deletion retain the selected and active version',async()=>{
  const f=fixture(async name=>name==='learning.read'?{version,active:version}:{state:'declined'});
  await f.action('read');
  for(const action of ['activate','erase']) {
    await f.action(action);
    assert.match(f.root.innerHTML,/当前启用：v1/);
    assert.doesNotMatch(f.root.innerHTML,/data-ml-action="erase" disabled/);
    assert.match(f.root.innerHTML,/已取消确认，未更改/);
  }
  f.controls.dispose();
});

test('validation labels distinguish a candidate, a passed version and a failed version',()=>{
  for(const [validation,label] of [['candidate','待验证'],['passed','验证通过'],['failed','验证失败']]) {
    const html=memoryLearningControlsHtml({version:{...version,validation}});
    assert.match(html,new RegExp(`版本 v1 · ${label}`));
    assert.equal(html.includes('data-ml-action="activate" disabled'),validation!=='passed');
  }
});
