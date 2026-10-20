import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {packElectronCache,prepareElectronTransfer,restoreElectronCache} from './electron-cache.mjs';

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
  const archive=path.join(result.directory,'electron-cache.tgz');
  const packed=await readFile(archive);
  assert.equal(result.size,packed.length);
  const first=await prepareElectronTransfer(temp),second=await prepareElectronTransfer(temp);
  assert.notEqual(first,second);
  await writeFile(path.join(first,'electron-cache.tgz'),'leftover partial download');
  await assert.rejects(restoreElectronCache(root,second,temp,result.sha256,result.size),/archive missing/);
  await writeFile(archive,packed.subarray(0,Math.floor(packed.length/2)));
  await assert.rejects(restoreElectronCache(root,result.directory,temp,result.sha256,result.size),error=>{
    assert.match(error.message,/digest mismatch/);
    const diagnostic=JSON.parse(error.message.slice(error.message.indexOf('{')));
    assert.equal(diagnostic.size,Math.floor(packed.length/2));
    assert.equal(diagnostic.expectedSize,result.size);
    assert.equal(diagnostic.expectedSha256,result.sha256);
    assert.equal(diagnostic.actualSha256,createHash('sha256').update(packed.subarray(0,Math.floor(packed.length/2))).digest('hex'));
    assert.ok(!error.message.includes(temp));
    return true;
  });
  await writeFile(archive,packed);
  if(process.platform!=='win32'&&execFileSync('tar',['--version'],{encoding:'utf8'}).includes('GNU tar')) {
    const transfer=path.join(temp,'C:','transfer');
    await mkdir(transfer,{recursive:true});
    await writeFile(path.join(transfer,'electron-cache.tgz'),packed);
    // A literal drive-style relative path reaches GNU tar unchanged on Linux,
    // reproducing its remote-host interpretation without a Windows host.
    const rejected=path.join(temp,'old-extract');await mkdir(rejected);
    assert.throws(()=>execFileSync('tar',['-xzf','C:/transfer/electron-cache.tgz','-C',rejected],{cwd:temp,stdio:'pipe'}),error=>{
      assert.match(error.stderr.toString(),/Cannot connect to C:/);return true;
    });
    const script=`import {restoreElectronCache} from ${JSON.stringify(new URL('./electron-cache.mjs',import.meta.url).href)};await restoreElectronCache(${JSON.stringify(root)},'C:/transfer',${JSON.stringify(temp)},${JSON.stringify(result.sha256)},${result.size});`;
    execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:temp,stdio:'pipe'});
  }
  await assert.rejects(restoreElectronCache(root,result.directory,temp,result.sha256,result.size+1),/digest mismatch/);
  await assert.rejects(restoreElectronCache(root,result.directory,temp,'0'.repeat(64)),/digest mismatch/);
  const restored=await restoreElectronCache(root,result.directory,temp,result.sha256,result.size);
  assert.equal(await readFile(path.join(restored,'a'.repeat(64),filename),'utf8'),bytes);
  await writeFile(path.join(root,'package-lock.json'),JSON.stringify({packages:{'node_modules/electron':{version}},changed:true}));
  await assert.rejects(restoreElectronCache(root,result.directory,temp,result.sha256),/does not match/);
  await writeFile(path.join(pkg,'package.json'),JSON.stringify({version:'44.2.1'}));
  await assert.rejects(packElectronCache(root,temp,download),/differs/);
});
