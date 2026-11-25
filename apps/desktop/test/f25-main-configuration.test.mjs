import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {ProtocolError} from '@personal-agent/contracts';

test('F25 Main permits only current admin staging while idle and preserves the native revision check',async()=>{
  const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8'),start=source.indexOf("if(name==='workflow.dataScope.configure')"),end=source.indexOf("if(name==='workflow.traceReplay.configure')",start);
  assert.ok(start>=0&&end>start);const admin={},calls=[],payload={expectedRevision:2,dataLevel:'private',cloudExportAllowed:false,publicQueries:[]};
  const context={name:'workflow.dataScope.configure',admin,sender:{},competitionMode:true,syntheticMvp:false,f25Workflow:{},payload,ProtocolError,
    runtimeApplication:{activeTaskCount:0},f25Configuration:{configure(input){if(input.expectedRevision!==2)throw new ProtocolError('REVISION_CONFLICT','changed');calls.push(input);}},
    publish(){},agentArtsSnapshot:()=>({dataScope:{stage:'selected'}})};
  const run=()=>runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
  await assert.rejects(run(),{code:'UNSUPPORTED_CAPABILITY'});context.sender=admin;context.runtimeApplication.activeTaskCount=1;
  await assert.rejects(run(),{code:'REVISION_CONFLICT'});context.runtimeApplication.activeTaskCount=0;payload.expectedRevision=1;
  await assert.rejects(run(),{code:'REVISION_CONFLICT'});assert.equal(calls.length,0);
  payload.expectedRevision=2;assert.equal((await run()).dataScope.stage,'selected');assert.equal(calls[0],payload);
});
