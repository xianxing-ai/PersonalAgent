import assert from 'node:assert/strict';
import test from 'node:test';
import {RuntimeCompetitionToolCatalog} from '../dist/application/tool-catalog.js';
import {MAX_AVAILABLE_TOOLS_JSON_BYTES, parseCoordinationAvailableTools} from '@personal-agent/coordination';

function fixture(count, fields, description) {
  const deadline=new Date(Date.now()+60000).toISOString(), checkpoints=new Map([
    ['application-profile','huawei_ict_agentarts'],['application-deadline',deadline]]);
  const descriptors=Array.from({length:count},(_,i)=>({name:`fixture.tool${i}`,version:'1.0.0',
    inputSchema:{type:'object',properties:Object.fromEntries(Array.from({length:fields},(_,j)=>[
      j===0?'description':`field${j}`,{type:'string',description,minLength:1,maxLength:64}])),
      required:['description'],additionalProperties:false},sideEffect:'read'}));
  const runtime={getTask:()=>({state:'running',revision:1}),loadCheckpoint:(_id,key)=>checkpoints.get(key),
    saveCheckpoint:(_id,key,value)=>checkpoints.set(key,value)};
  const catalog=new RuntimeCompetitionToolCatalog(runtime,{list:()=>descriptors},
    descriptors.map(d=>({toolName:d.name,toolVersion:d.version})),
    descriptors.map(d=>({toolName:d.name,toolVersion:d.version,available:()=>true})));
  return {catalog,descriptors,input:{taskId:'fixture',revision:1,deadline,signal:new AbortController().signal}};
}

test('parameter metadata is bounded data and structure survives projection',async()=>{
  const f=fixture(1,1,'relative\u0000path\u202e '+ 'x'.repeat(300));
  const selected=await f.catalog.prepare(f.input), schema=selected[0].inputSchema;
  assert.equal(schema.properties.description.description.length,160);
  assert.doesNotMatch(schema.properties.description.description,/[\u0000\u202e]/);
  assert.deepEqual(schema.required,['description']);
  assert.equal(schema.properties.description.maxLength,64);
  parseCoordinationAvailableTools(selected);
  await f.catalog.assertSelectionCurrent({...f.input,availableTools:selected});
});

test('40-tool directory drops only metadata to fit 24KiB and remains executable',async()=>{
  const f=fixture(40,4,'参数说明'.repeat(100));
  const selected=await f.catalog.prepare(f.input);
  assert.equal(selected.length,40);
  assert.ok(Buffer.byteLength(JSON.stringify(selected))<=MAX_AVAILABLE_TOOLS_JSON_BYTES);
  assert.equal(selected[0].inputSchema.properties.description.description,undefined);
  assert.deepEqual(selected[0].inputSchema.required,['description']);
  assert.equal(selected[0].inputSchema.properties.description.maxLength,64);
  parseCoordinationAvailableTools(selected);
  await f.catalog.assertSelectionCurrent({...f.input,availableTools:selected});
  await f.catalog.assertProposal({...f.input,toolName:selected[0].name,toolVersion:'1.0.0',
    arguments:{description:'actual input'},firstCloudRequest:true});
  f.descriptors[0].inputSchema.properties.description.maxLength=1;
  await assert.rejects(f.catalog.assertSelectionCurrent({...f.input,availableTools:selected}),{code:'UNAUTHORIZED'});
});

test('structural overflow fails explicitly instead of deleting fields or tools',async()=>{
  const f=fixture(40,40,'help');
  await assert.rejects(f.catalog.prepare(f.input),{code:'INVALID_ARGUMENT',message:'Competition tool catalog structure exceeds its limit'});
});
