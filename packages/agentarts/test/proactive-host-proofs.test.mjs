import assert from 'node:assert/strict';
import test from 'node:test';
import {createProactiveHostProofs} from '../dist/proactive-host-proofs.js';

const secret='synthetic-public-host-proof-secret-32-characters';
const binding=()=>({taskId:'proof-task',sessionId:'proof-session',controlRevision:3,taskDeadline:new Date(Date.now()+60000).toISOString()});
const proofs=createProactiveHostProofs(secret);

test('signed host proofs are deterministic over kind, binding and value body, and verify only against them',()=>{
  const value={eventId:'e1',payload:{answer:'confirmed'}},b=binding(),signed=proofs.sign('event',value,b);
  assert.match(signed.proof,/^[A-Za-z0-9_-]+$/);
  assert.deepEqual(proofs.sign('event',value,b),signed);
  assert.notEqual(proofs.sign('receipt',value,b).proof,signed.proof);
  assert.ok(proofs.verify('event',signed,b));
  assert.equal(proofs.verify('receipt',signed,b),false);
  assert.equal(createProactiveHostProofs(secret+'rotated').verify('event',signed,b),false);
  // Tamper must flip a significant bit: the last base64url char carries only 4 significant bits (+2 padding),
  // so flipping it keeps the decoded bytes identical whenever the original last char is in {A,B,C,D} (1/16 of proofs). Change the first char instead.
  for(const changed of [{...signed,payload:{answer:'tampered'}},{...signed,proof:(signed.proof.startsWith('A')?'B':'A')+signed.proof.slice(1)},
    {...signed,proof:Buffer.from('wrong').toString('base64url')}]) assert.equal(proofs.verify('event',changed,b),false);
  for(const [field,other] of [['taskId','other-task'],['sessionId','other-session'],['controlRevision',b.controlRevision+1],
    ['taskDeadline',new Date(Date.now()+120000).toISOString()]]) assert.equal(proofs.verify('event',signed,{...b,[field]:other}),false,field+' is bound');
});

test('proof digest covers the value body only, so signing a signed value is stable and stale proof fields are ignored',()=>{
  const b=binding(),signed=proofs.sign('advance_result',{eventId:'e2',items:['a','b']},b);
  assert.equal(proofs.sign('advance_result',signed,b).proof,signed.proof);
  assert.ok(proofs.verify('advance_result',signed,b));
});

test('verify never throws on malformed input; only a genuine plain value with a string proof is checkable',()=>{
  const b=binding(),signed=proofs.sign('event',{eventId:'e3'},b);
  for(const bad of [null,undefined,'proof',42,[],{},{...signed,proof:123}]) assert.equal(proofs.verify('event',bad,b),false);
  assert.equal(proofs.verify('event',signed,{taskId:'x'}),false);
});

test('host proof configuration and bindings are validated instead of silently trusted',()=>{
  const b=binding();
  assert.throws(()=>createProactiveHostProofs('short'),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>createProactiveHostProofs(42),{code:'INVALID_ARGUMENT'});
  assert.ok(createProactiveHostProofs('a'.repeat(32)).verify('event',proofs.sign('event',{eventId:'e4'},b),b)===false);
  for(const bad of [null,[1,2],'text']) assert.throws(()=>proofs.sign('event',bad,b),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>proofs.sign('event',{eventId:'e5',at:undefined},b),{code:'INVALID_ARGUMENT'});
  for(const broken of [{...b,taskId:''},{...b,sessionId:''},{...b,controlRevision:-1},{...b,controlRevision:1.5},
    {...b,controlRevision:'3'},{...b,taskDeadline:'not-a-date'}]) assert.throws(()=>proofs.sign('event',{},broken),{code:'INVALID_ARGUMENT'});
});
