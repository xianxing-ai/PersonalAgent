import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDesktopApproval} from '../electron/approval-projection.js';

test('only matching system expiry is projected without changing the public approval state', () => {
  const item={approvalId:'a',taskId:'t',revision:2,state:'denied'};
  const stored={...item,resolution:{actor:'system',reason:'expired',resolvedAt:'2026-10-21T00:00:00Z'}};
  const runtime={getApproval:()=>stored};
  assert.deepEqual(projectDesktopApproval(item,runtime),{...item,systemExpired:true});
  for(const change of [{revision:1},{taskId:'other'},{state:'allowed'},{resolution:undefined}]) {
    assert.deepEqual(projectDesktopApproval(item,{getApproval:()=>({...stored,...change})}),item);
  }
  assert.deepEqual(projectDesktopApproval(item,{getApproval(){throw Error('missing');}}),item);
  assert.deepEqual(projectDesktopApproval(item,{getApproval:()=>({...item,resolution:{actor:'user',reason:'denied'}})}),item);
});

test('live pending cache refreshes from the same original Runtime approval after system expiry',()=>{
  const pending={approvalId:'a',taskId:'t',revision:1,state:'pending'};
  const expired={...pending,revision:2,state:'denied',resolution:{actor:'system',reason:'expired'}};
  assert.deepEqual(projectDesktopApproval(pending,{getApproval:()=>expired}),{...pending,revision:2,state:'denied',systemExpired:true});
  assert.deepEqual(projectDesktopApproval(pending,{getApproval:()=>({...expired,taskId:'other'})}),pending);
  assert.deepEqual(projectDesktopApproval(pending,{getApproval:()=>({...expired,approvalId:'other'})}),pending);
});
