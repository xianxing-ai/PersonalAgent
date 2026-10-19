import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {catalog,validatePartition} from './partition.mjs';
const config=JSON.parse(await readFile(new URL('./partition.json',import.meta.url),'utf8'));
test('reviewed partitions cover every real workspace and integration file once',async()=>{
  assert.equal(validatePartition(config,await catalog()),config);
});
for(const change of ['missing','duplicate','unassigned-new-workspace','unassigned-new-integration','unknown']) {
  test(`partition refuses ${change}`,async()=>{
    const copy=structuredClone(config),inventory=await catalog();
    if(change==='missing')copy.linux.pop();
    if(change==='duplicate')copy.windows.push(copy.linux[0]);
    if(change==='unassigned-new-workspace')inventory.workspaces.push('@personal-agent/new');
    if(change==='unassigned-new-integration')inventory.integrationFiles.push('new.test.mjs');
    if(change==='unknown')copy.version=2;
    assert.throws(()=>validatePartition(copy,inventory));
  });
}
