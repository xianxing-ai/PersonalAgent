import assert from 'node:assert/strict';
import test from 'node:test';
import {bridgeProcessDetails} from './bridge-process-diagnostics.mjs';

test('process diagnostics omit synthetic key material and unrecognized external error fields',()=>{
  const error={code:'SYNTHETIC-PRIVATE-CODE',message:'SYNTHETIC-PRIVATE-MESSAGE',
    cmd:'SYNTHETIC-PRIVATE-COMMAND',stdout:'SYNTHETIC-PFX',stderr:'SYNTHETIC-PAIRING-SECRET',
    signal:'SYNTHETIC-PRIVATE-SIGNAL',killed:true};
  const record=bridgeProcessDetails(error,10_100,5,10_000);
  assert.equal(record.code,'other');
  assert.equal(record.killed,true);
  assert.equal(record.timeoutMs,10_000);
  assert.doesNotMatch(JSON.stringify(record),/SYNTHETIC|message|cmd|stdout|stderr/);
});

test('process diagnostics retain known spawn, cancellation, termination and exit categories',()=>{
  for(const code of ['ENOENT','EACCES','EPERM','ABORT_ERR','ERR_CHILD_PROCESS_STDIO_MAXBUFFER',1]) {
    assert.equal(bridgeProcessDetails({code},1,0,10_000).code,code);
  }
  const stopped=bridgeProcessDetails({killed:true,signal:'SIGTERM'},10_100,5,10_000);
  assert.equal(stopped.signal,'SIGTERM');
  assert.equal(stopped.killed,true);
  assert.equal(bridgeProcessDetails(undefined,1,0,10_000).code,'ok');
});
