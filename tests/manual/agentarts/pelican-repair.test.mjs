import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const python=process.env.PA_TEST_PYTHON;
const checker=fileURLToPath(new URL('./check-pelican.py',import.meta.url));
const baseline=fileURLToPath(new URL('./fixtures/pelican-animation-bug.svg',import.meta.url));
test('pelican oracle fails the actual initial animation bug, accepts its narrow fix and rejects geometry replacement',
  {skip:!python?'Set explicit PA_TEST_PYTHON to run the real stdlib XML checker':false},async()=>{
    const directory=await mkdtemp(fileURLToPath(new URL('../../../.cache/pelican-oracle-',import.meta.url)));
    const source=await readFile(baseline,'utf8'),candidate=join(directory,'candidate.svg');
    const check=()=>{const result=spawnSync(python,[checker,candidate,baseline],{windowsHide:true,encoding:'utf8'});
      assert.ok([0,1].includes(result.status));return JSON.parse(result.stdout);};
    await writeFile(candidate,source);assert.equal(check().failure,'pelican_animation_not_started');
    const fixed=source.replaceAll('begin="indefinite"','begin="0s"');await writeFile(candidate,fixed);
    assert.equal(check().passed,true);assert.equal(check().activeAnimations.length,3);
    await writeFile(candidate,fixed.replace('r="78"','r="12"'));assert.equal(check().passed,false);
});
