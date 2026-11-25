import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {acquireCloudRuntimeDirectory} from './cloud-runtime-service.mjs';
test('exclusive cloud directory does not steal live or unknown owners',()=>{
  mkdirSync('.cache',{recursive:true});const directory=resolve(mkdtempSync(join('.cache','cloud-owner-')));
  const first=acquireCloudRuntimeDirectory(directory);assert.throws(()=>acquireCloudRuntimeDirectory(directory),{code:'REVISION_CONFLICT'});
  first.release();const second=acquireCloudRuntimeDirectory(directory);
  writeFileSync(join(directory,'.runtime-owner.lock'),'foreign owner');
  assert.throws(()=>second.assertCurrent(),{code:'REVISION_CONFLICT'});
  assert.throws(()=>second.release(),{code:'REVISION_CONFLICT'});
  assert.throws(()=>acquireCloudRuntimeDirectory(directory),{code:'REVISION_CONFLICT'});
});
