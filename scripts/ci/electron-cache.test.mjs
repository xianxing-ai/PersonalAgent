import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {packElectronCache,restoreElectronCache} from './electron-cache.mjs';

test('synthetic cache transfer binds exact lock, version and bytes without changing install scripts',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'pa-electron-test-'));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const root=path.join(temp,'repo'),pkg=path.join(root,'node_modules/electron');await mkdir(pkg,{recursive:true});
  const version='44.2.0',filename=`electron-v${version}-win32-x64.zip`,bytes='synthetic archive fixture';
  const checksum=createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(root,'package-lock.json'),JSON.stringify({packages:{'node_modules/electron':{version}}}));
  await writeFile(path.join(pkg,'package.json'),JSON.stringify({version}));
  await writeFile(path.join(pkg,'checksums.json'),JSON.stringify({[filename]:checksum}));
  const download=async args=>{
    assert.equal(args.platform,'win32');assert.equal(args.arch,'x64');assert.equal(args.checksums[filename],checksum);
    const directory=path.join(args.cacheRoot,'a'.repeat(64));await mkdir(directory);
    const file=path.join(directory,filename);await writeFile(file,bytes);return file;
  };
  const result=await packElectronCache(root,temp,download);
  await assert.rejects(restoreElectronCache(root,result.directory,temp,'0'.repeat(64)),/digest mismatch/);
  const restored=await restoreElectronCache(root,result.directory,temp,result.sha256);
  assert.equal(await readFile(path.join(restored,'a'.repeat(64),filename),'utf8'),bytes);
  await writeFile(path.join(root,'package-lock.json'),JSON.stringify({packages:{'node_modules/electron':{version}},changed:true}));
  await assert.rejects(restoreElectronCache(root,result.directory,temp,result.sha256),/does not match/);
  await writeFile(path.join(pkg,'package.json'),JSON.stringify({version:'44.2.1'}));
  await assert.rejects(packElectronCache(root,temp,download),/differs/);
});
