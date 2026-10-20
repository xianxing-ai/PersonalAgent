import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {packSource,restoreSource} from './source-transfer.mjs';

test('same-run source transfer restores exact tracked source without untracked data or a network fetch',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'pa-source-test-'));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo');await mkdir(root);
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('config','user.name','CI fixture');git('config','user.email','ci@example.invalid');
  git('remote','add','origin','https://github.com/owner/repo');
  await writeFile(path.join(root,'.node-version'),'24.15.0\n');
  await writeFile(path.join(root,'source.txt'),'exact source\n');
  git('add','.');git('commit','-m','synthetic source fixture');
  const sha=git('rev-parse','HEAD');
  await writeFile(path.join(root,'.env'),'untracked synthetic private data');
  const packed=await packSource(root,temp,sha);
  const before=await readdir(temp);
  await assert.rejects(restoreSource(packed.directory,temp,sha,'0'.repeat(64)),/digest mismatch/);
  assert.deepEqual(await readdir(temp),before);
  const restored=await restoreSource(packed.directory,temp,sha,packed.sha256);
  assert.equal(await readFile(path.join(restored,'source.txt'),'utf8'),'exact source\n');
  assert.equal(await readFile(path.join(restored,'.node-version'),'utf8'),'24.15.0\n');
  await assert.rejects(readFile(path.join(restored,'.env')),/ENOENT/);
  assert.equal(execFileSync('git',['-C',restored,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),sha);
  await assert.rejects(packSource(root,temp,'a'.repeat(40)),/exact ordinary checkout/);
  const output=path.join(temp,'github-output');
  execFileSync(process.execPath,[path.join(packed.directory,'source-transfer.mjs'),'restore'],{cwd:root,windowsHide:true,env:{...process.env,RUNNER_TEMP:temp,GITHUB_SHA:sha,CI_SOURCE_SHA256:packed.sha256,GITHUB_OUTPUT:output}});
  const restoredPath=(await readFile(output,'utf8')).match(/^directory=(.+)$/m)?.[1];
  assert.ok(restoredPath);
  assert.equal(await readFile(path.join(restoredPath,'source.txt'),'utf8'),'exact source\n');
  if(process.platform!=='win32'&&execFileSync('tar',['--version'],{encoding:'utf8'}).includes('GNU tar')) {
    // Linux can model the exact GNU tar remote-host parsing of a Windows
    // drive-prefixed archive without claiming a Windows host execution.
    const colonDirectory=path.join(temp,'C:transfer');await rename(packed.directory,colonDirectory);
    assert.throws(()=>execFileSync('tar',['-xzf','C:transfer/source.tgz','-C',temp],{cwd:temp,stdio:'pipe'}),error=>
      error.status!==0&&/Cannot connect to C:/.test(error.stderr.toString()));
    const moduleUrl=new URL('./source-transfer.mjs',import.meta.url).href;
    const code=`import {restoreSource} from ${JSON.stringify(moduleUrl)};console.log(await restoreSource('C:transfer',${JSON.stringify(temp)},${JSON.stringify(sha)},${JSON.stringify(packed.sha256)}));`;
    const colonRestored=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:temp,encoding:'utf8'}).trim();
    assert.equal(await readFile(path.join(colonRestored,'source.txt'),'utf8'),'exact source\n');
    t.diagnostic('GNU tar colon-path regression: old archive argument rejected with Cannot connect to C:; relative source.tgz + transfer cwd restored exact source. Linux simulation only.');
  }
  git('config','http.https://github.com/.extraheader','synthetic-header');
  await assert.rejects(packSource(root,temp,sha),/authentication/);
});
