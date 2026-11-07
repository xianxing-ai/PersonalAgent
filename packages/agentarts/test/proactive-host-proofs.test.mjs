import assert from 'node:assert/strict';
import test from 'node:test';
import {createProactiveHostProofs} from '../dist/proactive-host-proofs.js';

const secret='synthetic-public-host-proof-secret-32-characters';
const binding=()=>({taskId:'proof-task',sessionId:'proof-session',controlRevision:3,taskDeadline:new Date(Date.now()+60000).toISOString()});
const proofs=createProactiveHostProofs(secret);
const tamperProof=proof=>{const b=Buffer.from(proof,'base64url');b[0]^=1;return b.toString('base64url');};

test('signed host proofs are deterministic over kind, binding and value body, and verify only against them',()=>{
  const value={eventId:'e1',payload:{answer:'confirmed'}},b=binding(),signed=proofs.sign('event',value,b);
  assert.match(signed.proof,/^[A-Za-z0-9_-]+$/);
  assert.deepEqual(proofs.sign('event',value,b),signed);
  assert.notEqual(proofs.sign('receipt',value,b).proof,signed.proof);
  assert.ok(proofs.verify('event',signed,b));
  assert.equal(proofs.verify('receipt',signed,b),false);
  assert.equal(createProactiveHostProofs(secret+'rotated').verify('event',signed,b),false);
  // Tamper must flip a significant bit: decode-flip-reencode (tamperProof) guarantees decoded byte modification without base64url padding collision flaking.
  for(const changed of [{...signed,payload:{answer:'tampered'}},{...signed,proof:tamperProof(signed.proof)},
    {...signed,proof:Buffer.from('wrong').toString('base64url')}]) assert.equal(proofs.verify('event',changed,b),false);
  for(const [field,other] of [['taskId','other-task'],['sessionId','other-session'],['controlRevision',b.controlRevision+1],
    ['taskDeadline',new Date(Date.now()+120000).toISOString()]]) assert.equal(proofs.verify('event',signed,{...b,[field]:other}),false,field+' is bound');
});

test('proof tampering flips decoded bytes deterministically even for adversarial trailing base64url padding bits',()=>{
  const b=binding(),signed=proofs.sign('event',{eventId:'e-pad'},b);
  const tamperedProof=tamperProof(signed.proof);
  assert.notDeepEqual(Buffer.from(tamperedProof,'base64url'),Buffer.from(signed.proof,'base64url'));
  assert.equal(proofs.verify('event',{...signed,proof:tamperedProof},b),false);
  const raw=Buffer.alloc(32,0x5a);raw[31]=raw[31]&0xf0;
  const trailingA=raw.toString('base64url');
  assert.ok(trailingA.endsWith('A'));
  assert.deepEqual(Buffer.from(trailingA.slice(0,-1)+'B','base64url'),raw,'legacy end-character swap collides on padding bits');
  assert.notDeepEqual(Buffer.from(tamperProof(trailingA),'base64url'),raw,'decode-flip-reencode changes significant bytes');
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
