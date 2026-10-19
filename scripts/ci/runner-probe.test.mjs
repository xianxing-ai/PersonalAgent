import test from 'node:test';
import assert from 'node:assert/strict';
import {probeMatrix} from './runner-probe.mjs';
test('short probes target only the selected hosted, common or explicitly pinned runner',()=>{
  assert.deepEqual(probeMatrix('windows-github').include[0].runner,['windows-latest']);
  assert.equal(probeMatrix('windows-pool').include[0].runner.at(-1),'personalagent-windows');
  const pair=probeMatrix('windows-pool-pair').include;
  assert.equal(pair.length,2);
  assert.deepEqual(pair[0].runner,pair[1].runner);
  assert.notEqual(pair[0].name,pair[1].name);
  const three=probeMatrix('windows-pool-three').include;
  assert.equal(three.length,3);
  assert.ok(three.every(job=>job.runner.at(-1)==='personalagent-windows'));
  assert.equal(probeMatrix('ecs-17f8').include[0].runner.at(-1),'ecs-17f8');
  assert.throws(()=>probeMatrix('unregistered-node'));
});
