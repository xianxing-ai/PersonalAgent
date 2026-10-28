import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {parseRequest,parseResponse,parseEvent,encodeFrame,FrameDecoder,MAX_FRAME_BYTES,validateContract,validateToolValue} from '../dist/index.js';
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/requests.json',import.meta.url),'utf8'));
test('tool validation names only declared public fields and fixed schema keywords, never extra keys or values',()=>{
  const schema={type:'object',required:['title'],additionalProperties:false,properties:{title:{type:'string',minLength:3}}};
  assert.throws(()=>validateToolValue(schema,{}),error=>error.code==='INVALID_ARGUMENT'&&error.message==='Tool value violates schema [keyword=required; field=title]');
  assert.throws(()=>validateToolValue(schema,{title:7}),error=>error.message==='Tool value violates schema [keyword=type; field=title]');
  assert.throws(()=>validateToolValue(schema,{title:'ok!',private_mail_body:'synthetic-secret'}),error=>error.message==='Tool value violates schema [keyword=additionalProperties]');
  assert.throws(()=>validateToolValue({type:'object',required:['/private/token=synthetic-secret'],properties:{}},{}),error=>!error.message.includes('synthetic-secret'));
  assert.doesNotThrow(()=>validateToolValue(schema,{title:'valid'}));
});
test('all 17 operations accept portable fixtures and reject malformed/forged requests', () => {
  assert.equal(fixtures.valid.length,17);
  for (const request of fixtures.valid) assert.deepEqual(parseRequest(request),request);
  for (const request of fixtures.invalid) assert.throws(() => parseRequest(request));
  assert.throws(() => parseRequest({...fixtures.valid[0],protocolVersion:'2.0.0'}),{code:'PROTOCOL_MISMATCH'});
});
test('response validates result by operation, discriminant and correlation', () => {
  const response = {kind:'response',protocolVersion:'1.0.0',requestId:'r',outcome:'ok',data:{taskId:'t',state:'created',revision:1},evidenceRefs:[]};
  assert.deepEqual(parseResponse(response,'task.submit','r'),response);
  assert.throws(() => parseResponse({...response,error:{code:'TIMEOUT',message:'x',retryable:false}},'task.submit','r'));
  assert.throws(() => parseResponse({...response,data:{accepted:true}},'task.submit','r'));
  assert.throws(() => parseResponse(response,'task.submit','other'));
});
test('JSONL handles split UTF-8, escaped newlines, batches, size limit and incomplete frames', () => {
  const request = {...fixtures.valid[1],payload:{...fixtures.valid[1].payload,goal:'中文\n下一行'}};
  const bytes = encodeFrame(request);
  const decoder = new FrameDecoder();
  const received = [];
  for (const byte of bytes) received.push(...decoder.push(Uint8Array.of(byte)));
  decoder.finish();
  assert.deepEqual(received,[request]);
  assert.equal(new FrameDecoder().push(new Uint8Array([...bytes,...bytes])).length,2);
  assert.throws(() => new FrameDecoder().push(new Uint8Array(MAX_FRAME_BYTES + 1)));
  assert.throws(() => encodeFrame({...request,payload:{...request.payload,goal:'中'.repeat(MAX_FRAME_BYTES)}}));
  const partial = new FrameDecoder(); partial.push(bytes.subarray(0,4));
  assert.throws(() => partial.finish());
  assert.throws(() => new FrameDecoder().push(Uint8Array.of(255,10)));
});
test('event payload and evidence verification must be explicit', () => {
  const event = {kind:'event',protocolVersion:'1.0.0',eventId:'e',streamId:'tasks',sequence:1,type:'task.progress',occurredAt:'2026-09-05T12:00:00Z',payload:{stepId:'s',label:'working'}};
  parseEvent(event);
  assert.throws(() => parseEvent({...event,payload:{percent:50}}));
  assert.throws(() => validateContract('evidence',{evidenceId:'e',verification:'done'}));
});

test('repeated fixed-reference checks validate current values and still reject unknown contracts', () => {
  const snapshot = {taskId:'t',state:'running',revision:1,updatedAt:'2026-10-20T00:00:00Z',steps:[],evidenceRefs:[]};
  for (let i = 0; i < 100; i++) {
    validateContract('snapshot',snapshot);
    assert.throws(() => validateContract('snapshot',{...snapshot,state:'invented'}),{code:'INVALID_ARGUMENT'});
    assert.throws(() => validateContract('snapshot',{...snapshot,unexpected:true}),{code:'INVALID_ARGUMENT'});
  }
  snapshot.revision = -1;
  assert.throws(() => validateContract('snapshot',snapshot),{code:'INVALID_ARGUMENT'});
  assert.throws(() => validateContract('unregistered',snapshot));
  snapshot.revision = 2;
  validateContract('snapshot',snapshot);
});
