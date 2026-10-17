import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtocolError} from '@personal-agent/contracts';
import {createStageTimeline} from '../src/stage-timeline.mjs';
test('stage spans retain actual start/end and monotonic duration while excluding secret metadata',async()=>{
 const records=[];let elapsed=10,now=0;
 const timeline=createStageTimeline({onRecord:value=>records.push(value),clock:()=>new Date(now),monotonic:()=>elapsed,traceId:'public-trace'});
 const result=await timeline.run('tools.verify',async()=>{elapsed=37;now=100;return 42;},{taskId:'public-task',apiKey:'must-not-enter-record',arguments:'private'});
 assert.equal(result,42);assert.equal(records.length,2);assert.equal(records[1].wallMs,27);
 assert.equal(records[1].startedAtUtc,'1970-01-01T00:00:00.000Z');assert.equal(records[1].finishedAtUtc,'1970-01-01T00:00:00.100Z');
 assert.equal(JSON.stringify(records).includes('must-not-enter-record'),false);
 const finish=timeline.start('another');finish();finish();assert.equal(records.length,4);
});
test('timing captures failure code without private error text and never masks original failures',async()=>{
 const records=[],error=new ProtocolError('CANCELLED','private-sensitive-body'),timeline=createStageTimeline({onRecord:value=>records.push(value)});
 await assert.rejects(timeline.run('branch.execution',async()=>{throw error;}),value=>value===error);
 assert.equal(records[1].errorCode,'CANCELLED');assert.equal(JSON.stringify(records).includes('private-sensitive-body'),false);
 assert.equal(await createStageTimeline({onRecord:()=>{throw Error('sink unavailable');}}).run('still.execute',async()=>1),1);
});
