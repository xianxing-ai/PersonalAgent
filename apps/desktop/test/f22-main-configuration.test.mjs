import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {ProtocolError} from '@personal-agent/contracts';

test('Main enables trace replay only after the original admin confirmation and unchanged revision',async()=>{
  const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8'),start=main.indexOf("if(name==='workflow.traceReplay.configure')"),
    end=main.indexOf("if(name==='coding.f19.select')",start);
  assert.ok(start>=0&&end>start);
  const admin={isDestroyed:()=>false},calls=[];let revision=1,allowed=false,changeDuringApproval=false;
  const context={name:'workflow.traceReplay.configure',sender:admin,admin,competitionMode:true,syntheticMvp:false,
    payload:{enabled:true,expectedRevision:1},f22Workflow:{},runtimeApplication:{activeTaskCount:0},ProtocolError,
    f22Configuration:{snapshot:()=>({enabled:false,revision}),configure:value=>{calls.push({...value});revision++;}},
    confirmApplicationAuthorization:async(action,payload,options)=>{
      assert.equal(action,'workflow.enable');assert.equal(payload.mode,'trace_replay');assert.equal(options.isCurrent(),true);
      if(changeDuringApproval)revision++;return allowed;},publish(){},agentArtsSnapshot:()=>({traceReplay:{revision}})};
  const run=()=>runInNewContext('(async()=>{'+main.slice(start,end)+'})()',context);
  await assert.rejects(run(),{code:'UNAUTHORIZED'});assert.equal(calls.length,0);
  allowed=true;changeDuringApproval=true;await assert.rejects(run(),{code:'REVISION_CONFLICT'});assert.equal(calls.length,0);
  changeDuringApproval=false;context.payload.expectedRevision=revision;await run();assert.equal(calls.length,1);
  context.sender={};await assert.rejects(run(),{code:'UNSUPPORTED_CAPABILITY'});assert.equal(calls.length,1);
});
