import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {matrixFor,resolveRoute} from './pr-route.mjs';
import {probeMatrix} from './runner-probe.mjs';

const hosted=new Set(['ubuntu-latest','ubuntu-24.04','windows-latest','windows-2025','windows-11-vs2026-arm']);
function assertHosted(matrix) {
  for(const job of matrix.include) {
    assert.equal(job.runner.length,1);
    assert.ok(hosted.has(job.runner[0]),JSON.stringify(job));
  }
}
test('all legacy selectors, PR digits and platform selections remain hosted-only',()=>{
  for(const mode of ['windows','image','both']) for(const number of [undefined,500,501,502,503,504,505,506,507,508,509]) {
    for(const fork of [false,true]) for(const imageRunner of ['auto','github','ecs']) for(const windowsRunner of ['auto','github','ecs']) {
      assertHosted(matrixFor(mode,{number,fork,imageRunner,windowsRunner,windowsOverrides:'{"507":"ecs","508":"github"}'}));
    }
  }
});
test('manual validation retains both hosted platforms despite old repository settings',async()=>{
  const result=await resolveRoute({event:{},eventName:'workflow_dispatch',repository:'owner/repo',token:'fixture',
    imageRunner:'ecs',windowsRunner:'ecs',windowsOverrides:'{"507":"ecs"}'});
  assert.deepEqual(result.matrix.include.map(job=>job.kind),['windows','image']);
  assertHosted(result.matrix);
});
test('every workflow runner is standard hosted or one of the tested matrix producers',()=>{
  const root=new URL('../../.github/workflows/',import.meta.url);
  for(const file of readdirSync(root).filter(name=>/\.ya?ml$/.test(name))) {
    const source=readFileSync(new URL(file,root),'utf8');
    const runners=[...source.matchAll(/^\s+runs-on:\s*(.+)$/gm)];
    assert.ok(runners.length,`${file} has a runner`);
    for(const [,runner] of runners) {
      if(runner==='${{ matrix.runner }}') {
        assert.ok(['ci.yml','runner-probe.yml'].includes(file),`Unverified dynamic runner in ${file}`);
      } else assert.ok(hosted.has(runner),`Nonstandard runner in ${file}: ${runner}`);
    }
  }
  const foundation=readFileSync(new URL('ci.yml',root),'utf8');
  assert.doesNotMatch(foundation,/vars\.PA_(?:WINDOWS|IMAGE)_RUNNER/);
  assert.equal((foundation.match(/options: \[github\]/g)||[]).length,2);
  for(const target of ['windows-github','psec-strict','psec-strict-arm64']) assertHosted(probeMatrix(target));
  const probe=readFileSync(new URL('runner-probe.yml',root),'utf8');
  assert.match(probe,/options: \[windows-github, psec-strict, psec-strict-arm64\]/);
});
