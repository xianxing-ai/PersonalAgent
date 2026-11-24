import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateMemoryBackupHost} from '../electron/private-memory-backups.js';

test('legacy private backup filtering cannot claim coverage before the independent mail source guard succeeds',async()=>{
  const scope={deadline:new Date(Date.now()+1000).toISOString(),signal:new AbortController().signal};let checks=0;
  const host=createPrivateMemoryBackupHost({userData:process.cwd(),privateMemory:{filterRestoredHost(){assert.fail('no filtering after incomplete coverage');}},
    async assertCoverage(actual){checks++;assert.equal(actual,scope);throw Error('mail source erasure coverage incomplete');}});
  await assert.rejects(host.reconcile(scope),/mail source erasure coverage incomplete/);assert.equal(checks,1);
});
