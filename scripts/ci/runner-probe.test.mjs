import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
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
test('strict PSEC acceptance selects exactly one explicit hosted Windows slot',()=>{
  assert.deepEqual(probeMatrix('psec-strict'),{include:[{name:'Strict real Windows PSEC acceptance',runner:['windows-2025'],psecStrict:true}]});
});
test('native ARM64 PSEC acceptance selects one standard Windows 11 VS2026 slot',()=>{
  assert.deepEqual(probeMatrix('psec-strict-arm64'),{include:[{name:'Strict native ARM64 Windows PSEC acceptance',
    runner:['windows-11-vs2026-arm'],psecStrict:true,psecArchitecture:'arm64'}]});
});
test('strict candidates require explicit dispatch and keep all native acceptance gates',()=>{
  for(const target of ['psec-strict','psec-strict-arm64']){
    const rejected=spawnSync(process.execPath,['scripts/ci/runner-probe.mjs'],{
      encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'push',GITHUB_REF:`refs/heads/codex/ci-probe/${target}/fixture`}});
    assert.notEqual(rejected.status,0);
    assert.match(rejected.stderr,/requires explicit workflow_dispatch/u);
  }
  // This short routing probe runs before npm ci; keep its config checks dependency-free.
  const workflow=readFileSync(new URL('../../.github/workflows/runner-probe.yml',import.meta.url),'utf8');
  assert.match(workflow,/options: \[[^\]\r\n]*psec-strict-arm64\]/u);
  const node=workflow.split('- uses: actions/setup-node@v4')[1].split('- name:')[0];
  assert.match(node,/node-version-file: \.node-version/u);
  assert.ok(node.includes("architecture: ${{ matrix.psecArchitecture || 'x64' }}"));
  const prepare=workflow.split('- name: Prepare exact strict PSEC acceptance inputs')[1].split('- name:')[0];
  assert.match(prepare,/host-architecture\.mjs/u);
  assert.match(prepare,/windows-standard-token\/smoke\.ps1/u);
  assert.ok(prepare.includes("if: matrix.psecStrict == true && github.event_name == 'workflow_dispatch'"));
  const execute=workflow.split('- name: Require both real ordinary-user PSEC scenarios without skips')[1].split('- uses:')[0];
  assert.match(execute,/--run-psec-acceptance/u);
  assert.doesNotMatch(execute,/continue-on-error|skip/u);
});
