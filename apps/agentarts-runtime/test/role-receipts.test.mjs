import assert from 'node:assert/strict';
import test from 'node:test';
import {createRoleReceiptWriter} from '../src/role-receipts.mjs';

const receipt = {role:'world',status:'completed',requestId:'request-1',promptVersion:'owned-1.0',
  spanId:'a35bb06c-bc63-4795-a735-dc11a3a66232',startedAt:'2026-10-13T01:00:00.000Z',
  endedAt:'2026-10-13T01:00:00.011Z',durationMs:10.25,totalTokens:23};

test('host receipt allows only correlation/timing/usage and explicit deployment metadata',()=>{
  const lines=[],write=createRoleReceiptWriter({deploymentVersion:'arm64-194799c6',write:line=>lines.push(line)});
  write({...receipt,query:'private-user-input',response:'private-model-output',error:'private-error',
    endpoint:'https://private-endpoint/',apiKey:'private-key',deploymentVersion:'Latest',traceId:'forged-platform-trace'});
  assert.equal(lines.length,1);
  assert.equal(JSON.stringify(lines).includes('private-'),false);
  assert.equal(lines[0].includes('forged'),false);
  assert.deepEqual(JSON.parse(lines[0]),{event:'owned_role',receiptVersion:'1.0',scope:'model_call',...receipt,
    deploymentVersion:'arm64-194799c6',deploymentVersionSource:'host_configuration'});
});

test('missing host metadata stays unknown; invalid configuration fails without echoing its value',()=>{
  const lines=[];
  createRoleReceiptWriter({write:line=>lines.push(line)})({...receipt,deploymentVersion:'invented-model-version'});
  assert.equal(JSON.parse(lines[0]).deploymentVersion,'unknown');
  assert.equal(JSON.parse(lines[0]).deploymentVersionSource,'unknown');
  for(const deploymentVersion of ['',null,42,'Latest','LATEST','default','stable','current','unknown','v1-latest',
    'https://private-endpoint/','x\nprivate-secret','x'.repeat(129)]) {
    assert.throws(()=>createRoleReceiptWriter({deploymentVersion}),{message:'Invalid trusted deployment version configuration'});
  }
});

test('malformed telemetry is redacted and legacy receipts remain supported',()=>{
  const lines=[],write=createRoleReceiptWriter({write:line=>lines.push(line)});
  write({...receipt,requestId:'https://private-endpoint/',promptVersion:'private\nsecret',spanId:'private-span',
    startedAt:'private-time',endedAt:'private-time',durationMs:Infinity,totalTokens:-1});
  const result=JSON.parse(lines[0]);
  assert.equal(result.requestId,'unknown'); assert.equal(result.promptVersion,'unknown');
  assert.equal(lines[0].includes('private'),false);
  for(const key of ['spanId','startedAt','endedAt','durationMs','totalTokens'])assert.equal(Object.hasOwn(result,key),false);
  write({role:'fast',status:'started',requestId:'legacy-request',promptVersion:'owned-1.0'});
  assert.equal(JSON.parse(lines[1]).requestId,'legacy-request');
  write({...receipt,role:'private-role'}); assert.equal(lines.length,2);
});

test('started records omit terminal metrics and failed records omit usage',()=>{
  const lines=[],write=createRoleReceiptWriter({write:line=>lines.push(line)});
  write({...receipt,status:'started'}); write({...receipt,status:'failed'});
  const [started,failed]=lines.map(line=>JSON.parse(line));
  for(const key of ['endedAt','durationMs','totalTokens'])assert.equal(Object.hasOwn(started,key),false);
  assert.equal(failed.endedAt,receipt.endedAt); assert.equal(failed.totalTokens,undefined);
});

test('sync and async sink failures are isolated',async()=>{
  for(const write of [()=>{throw Error('sink');},async()=>{throw Error('sink');}]) {
    assert.doesNotThrow(()=>createRoleReceiptWriter({write})(receipt));
  }
  await new Promise(resolve=>setImmediate(resolve));
});
