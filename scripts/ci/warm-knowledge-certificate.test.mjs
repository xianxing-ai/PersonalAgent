import test from 'node:test';
import assert from 'node:assert/strict';
import {warmKnowledgeCertificateBackend} from './warm-knowledge-certificate.mjs';

test('CI warmup uses fixed system PowerShell and bounded in-memory primitives without exporting output',async()=>{
  const records=[];let calls=0;
  await warmKnowledgeCertificateBackend({platform:'win32',systemRoot:'C:\\Windows',log:v=>records.push(JSON.parse(v)),
    execute(executable,args,options,done){calls++;
      assert.equal(executable,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.deepEqual(args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand']);
      assert.equal(options.timeout,30_000);assert.equal(options.maxBuffer,1024);
      const script=Buffer.from(args[4],'base64').toString('utf16le');
      assert.match(script,/RSACng.*2048/);assert.match(script,/CertificateRequest/);assert.match(script,/CreateSelfSigned/);
      assert.match(script,/\$cert.Dispose\(\)/);assert.match(script,/\$rsa.Dispose\(\)/);
      assert.doesNotMatch(script,/WriteLine|Write-Output|Cert:|New-SelfSignedCertificate|Invoke-WebRequest/i);
      done(null,'SYNTHETIC-PRIVATE-KEY','SYNTHETIC-PRIVATE-STDERR');
    }});
  assert.equal(calls,1);assert.equal(records[0].coldStartValidated,false);assert.equal(records[0].state,'ready');
  assert.doesNotMatch(JSON.stringify(records),/SYNTHETIC/);
});

test('CI warmup rejects invalid hosts and reports process failures without retry or private diagnostics',async()=>{
  let calls=0;const records=[];
  const execute=error=>(_exe,_args,_options,done)=>{calls++;done(Object.assign(Error('SYNTHETIC-PRIVATE'),
    {stderr:'SYNTHETIC-PRIVATE',stdout:'SYNTHETIC-KEY',cmd:'SYNTHETIC-COMMAND',...error}));};
  await assert.rejects(warmKnowledgeCertificateBackend({platform:'linux',systemRoot:'C:\\Windows',execute}));
  assert.equal(calls,0);
  for(const error of [{code:7},{code:'ENOENT'},{code:'SYNTHETIC-CODE',signal:'SIGTERM',killed:true}]){
    await assert.rejects(warmKnowledgeCertificateBackend({platform:'win32',systemRoot:'C:\\Windows',execute:execute(error),
      log:value=>records.push(JSON.parse(value))}),value=>value.message.includes('preparation failed')&&!value.message.includes('SYNTHETIC'));
  }
  assert.equal(calls,3);assert.deepEqual(records.map(r=>r.code),[7,'ENOENT','other']);
  assert.equal(records[2].signal,'SIGTERM');assert.equal(records[2].killed,true);
  for(const record of records){assert.equal(record.state,'failed');assert.equal(record.timeoutMs,30_000);assert.ok(record.elapsedMs>=0);}
  assert.doesNotMatch(JSON.stringify(records),/SYNTHETIC|stdout|stderr|cmd|args|env/);
});
