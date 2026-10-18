import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {bridgeProcessDetails, certificateDiagnosticArguments, certificatePhaseTracker} from './bridge-process-diagnostics.mjs';

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

test('only the exact certificate command gains stderr markers without changing its original script',()=>{
  const source = readFileSync(new URL('../src/bridge.ts',import.meta.url),'utf8');
  const script = source.match(/const script = `([\s\S]*?)`;/)[1].replace(/\r\n/g,'\n');
  const args = ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];
  const instrumented = certificateDiagnosticArguments(args);
  assert.deepEqual(instrumented.slice(0,4),args.slice(0,4));
  const decoded = Buffer.from(instrumented[4],'base64').toString('utf16le');
  const markers = decoded.match(/\n\[Console\]::Error.WriteLine\('PA_KNOWLEDGE_CERT_PHASE:[a-z_]+'\);\n/g);
  assert.equal(markers.length,5);
  assert.equal(markers.reduce((value,marker)=>value.replace(marker,''),decoded),script);
  assert.equal(Buffer.from(args[4],'base64').toString('utf16le'),script);
  assert.equal(certificateDiagnosticArguments([...args.slice(0,4),Buffer.from(script+';# drift','utf16le').toString('base64')]),undefined);
  assert.equal(certificateDiagnosticArguments([...args,'SYNTHETIC-PRIVATE-ARGUMENT']),undefined);
});

test('certificate phases retain split fixed markers and never expose arbitrary stderr or fields',()=>{
  let milliseconds = 4;
  const phases = certificatePhaseTracker(()=>milliseconds);
  phases.observe(Buffer.from('SYNTHETIC-PRIVATE-PFX\nPA_KNOWLEDGE_CERT_PHASE:script_'));
  assert.deepEqual(phases.details(),{});
  phases.observe(Buffer.from('enter\r\n'));
  assert.deepEqual(phases.details(),{lastPhase:'script_enter',phaseElapsedMs:4});
  milliseconds = 21.4;
  phases.observe(Buffer.from('PA_KNOWLEDGE_CERT_PHASE:rsa_ready\nPA_KNOWLEDGE_CERT_PHASE:SYNTHETIC-PRIVATE-KEY\n'));
  assert.deepEqual(phases.details(),{lastPhase:'rsa_ready',phaseElapsedMs:21});
  assert.doesNotMatch(JSON.stringify(phases.details()),/SYNTHETIC|stderr|PFX|KEY/);
});
