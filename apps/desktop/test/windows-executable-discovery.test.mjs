import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import childProcess from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {findWindowsExecutable} from '../electron/windows-executable-discovery.js';
import {createWorkspaceConfigHost} from '../electron/workspace-config-host.js';

function windowsFixture() {
  const files=new Map(),lookups=[];
  const key=value=>path.win32.normalize(value).toLowerCase();
  const add=(value,type='file',canonical=value)=>{
    files.set(key(value),{type,canonical});
    let parent=path.win32.dirname(value);
    while(!files.has(key(parent))) {
      files.set(key(parent),{type:'directory',canonical:parent});
      const next=path.win32.dirname(parent);if(next===parent) break;parent=next;
    }
  };
  add('C:\\working','directory');
  const filesystem={lstatSync:value=>{
    lookups.push(value);const stat=files.get(key(value));
    if(!stat) throw Object.assign(Error('synthetic missing file'),{code:'ENOENT'});
    return {isFile:()=>stat.type==='file',isDirectory:()=>stat.type==='directory',isSymbolicLink:()=>stat.type==='link'};
  },realpathSync:{native:value=>{
    const stat=files.get(key(value));if(!stat) throw Object.assign(Error('synthetic missing file'),{code:'ENOENT'});
    return stat.canonical;
  }}};
  const find=(search,extra={})=>findWindowsExecutable('pwsh.exe',{platform:'win32',
    environment:{PATH:search},filesystem,...extra});
  return {add,find,filesystem,lookups};
}

test('fixed GBK where bytes lose the existing Unicode candidate under the old UTF8 decoding',()=>{
  const bytes=Buffer.concat([Buffer.from('C:\\'),Buffer.from('b9a4bedf','hex'),Buffer.from('\\PowerShell\\pwsh.exe\r\n')]);
  const unicode=new TextDecoder('gbk').decode(bytes).trim();
  assert.equal(unicode,'C:\\工具\\PowerShell\\pwsh.exe');
  const fixture=windowsFixture();fixture.add(unicode);
  const oldDecoded=bytes.toString('utf8').trim().split(/\r?\n/)[0];
  assert.match(oldDecoded,/\ufffd/);
  assert.throws(()=>fixture.filesystem.realpathSync.native(oldDecoded),{code:'ENOENT'});
  assert.equal(fixture.find('C:\\工具\\PowerShell'),unicode);
  // This verifies path discovery, not trusted binary provenance or execution permission.
});

test('Unicode PATH preserves order and quoted directories without guessing code pages',()=>{
  const fixture=windowsFixture();fixture.add('C:\\工具 目录\\pwsh.exe');fixture.add('C:\\later\\pwsh.exe');
  assert.equal(fixture.find('C:\\missing;"C:\\工具 目录";C:\\later'),'C:\\工具 目录\\pwsh.exe');
  assert.equal(fixture.lookups.some(value=>value.startsWith('C:\\later')),false);
  fixture.add('C:\\工具 目录\\git.exe');
  assert.equal(fixture.find('',{environment:{Path:'C:\\工具 目录'}}),'C:\\工具 目录\\pwsh.exe');
  assert.equal(findWindowsExecutable('git.exe',{platform:'win32',environment:{PATH:'C:\\工具 目录'},
    filesystem:fixture.filesystem}),'C:\\工具 目录\\git.exe');
});

test('only fixed names and absolute local Unicode PATH entries are searched',()=>{
  const fixture=windowsFixture();fixture.add('C:\\safe\\pwsh.exe');
  const invalid=['','relative','C:relative','\\root-relative','\\\\server\\share','\\\\?\\C:\\device',
    'C:\\stream:alternate','"C:\\unbalanced'];
  assert.equal(fixture.find([...invalid,'C:\\safe'].join(';')),'C:\\safe\\pwsh.exe');
  assert.deepEqual(fixture.lookups,['C:\\safe\\pwsh.exe','C:\\safe\\pwsh.exe']);
  assert.equal(fixture.find('C:\\safe',{platform:'linux'}),undefined);
  assert.equal(findWindowsExecutable('node.exe',{platform:'win32',environment:{PATH:'C:\\safe'},
    filesystem:fixture.filesystem}),undefined);
});

test('explicit PATH locations and installation aliases retain native canonical lookup',async t=>{
  for(const type of ['explicit-cwd','installation-link','ancestor-link','short-path']) {
    await t.test(type,()=>{
      const fixture=windowsFixture();
      const directory=type==='explicit-cwd'?'C:\\working':type==='short-path'?'C:\\PROGRA~1\\PowerShell':'C:\\install-link';
      const candidate=path.win32.join(directory,'pwsh.exe');
      const canonical=type==='explicit-cwd'?candidate:'C:\\Program Files\\PowerShell\\pwsh.exe';
      fixture.add(canonical);
      fixture.add(candidate,type==='installation-link'?'link':'file',canonical);
      if(type==='ancestor-link') fixture.add(directory,'link','C:\\Program Files\\PowerShell');
      assert.equal(fixture.find(directory),canonical);
    });
  }
});

test('the first existing unsafe candidate never falls back to a later program',async t=>{
  for(const type of ['directory','canonical-UNC','canonical-ADS','canonical-name','canonical-not-file','broken-link','workspace','recovery','access-denied']) {
    await t.test(type,()=>{
      const fixture=windowsFixture();let directory='C:\\first';
      const candidate=path.win32.join(directory,'pwsh.exe');
      const canonical=type==='canonical-UNC'?'\\\\server\\share\\pwsh.exe':type==='canonical-ADS'?'C:\\stream:alternate\\pwsh.exe'
        :type==='canonical-name'?'C:\\other\\unrelated.exe'
        :['canonical-not-file','broken-link'].includes(type)?'C:\\other\\pwsh.exe':candidate;
      fixture.add(candidate,type==='broken-link'?'link':type==='directory'?'directory':'file',canonical);
      if(type==='canonical-not-file') fixture.add(canonical,'directory');
      if(type==='canonical-name') fixture.add(canonical);
      if(type==='access-denied') {
        const original=fixture.filesystem.lstatSync;
        fixture.filesystem.lstatSync=value=>{
          if(value===candidate) throw Object.assign(Error('synthetic permission failure'),{code:'EACCES'});
          return original(value);
        };
      }
      fixture.add('C:\\later\\pwsh.exe');
      const excludedDirectories=['workspace','recovery'].includes(type)?[directory]:[];
      assert.equal(fixture.find(`${directory};C:\\later`,{excludedDirectories}),undefined);
      assert.equal(fixture.lookups.some(value=>value.startsWith('C:\\later')),false);
    });
  }
});

test('candidate and excluded-directory aliases cannot bypass workspace or recovery isolation',async t=>{
  for(const type of ['installation-link','ancestor-link','short-path','excluded-root-alias','unreadable-root']) {
    await t.test(type,()=>{
      const fixture=windowsFixture(),canonical='C:\\private\\recovery\\pwsh.exe';
      const directory=type==='short-path'?'C:\\PRIVAT~1\\RECOVE~1':'C:\\install';
      const candidate=path.win32.join(directory,'pwsh.exe');fixture.add(canonical);
      fixture.add(candidate,type==='installation-link'?'link':'file',canonical);
      if(type==='ancestor-link') fixture.add('C:\\install','link','C:\\private\\recovery');
      const root=type==='excluded-root-alias'?'C:\\data-alias\\recovery':'C:\\private\\recovery';
      if(type==='excluded-root-alias') fixture.add(root,'link','C:\\private\\recovery');
      if(type==='unreadable-root') {
        const original=fixture.filesystem.realpathSync.native;
        fixture.filesystem.realpathSync.native=value=>{
          if(value===root) throw Object.assign(Error('synthetic permission failure'),{code:'EACCES'});
          return original(value);
        };
      }
      fixture.add('C:\\later\\pwsh.exe');
      assert.equal(fixture.find(`${directory};C:\\later`,{excludedDirectories:[root]}),undefined);
      assert.equal(fixture.lookups.some(value=>value.startsWith('C:\\later')),false);
    });
  }
  const fixture=windowsFixture();fixture.add('C:\\install\\pwsh.exe');
  assert.equal(fixture.find('C:\\install',{excludedDirectories:['C:\\not-created\\recovery']}),'C:\\install\\pwsh.exe');
});

test('trailing separator in excluded directories isolates the repository root without prefix overreach',()=>{
  // fileURLToPath reports the Windows repository root with a trailing separator.
  const fixture=windowsFixture();fixture.add('C:\\repo\\bin\\pwsh.exe');fixture.add('C:\\later\\pwsh.exe');
  assert.equal(fixture.find('C:\\repo\\bin;C:\\later',{excludedDirectories:['C:\\repo\\']}),undefined);
  assert.equal(fixture.lookups.some(value=>value.startsWith('C:\\later')),false);
  const sibling=windowsFixture();sibling.add('C:\\repo','directory');sibling.add('C:\\repo-tools\\pwsh.exe');
  assert.equal(sibling.find('C:\\repo-tools',{excludedDirectories:['C:\\repo\\']}),'C:\\repo-tools\\pwsh.exe');
});

test('real Windows Unicode file discovery performs no executable invocation',{skip:process.platform!=='win32'},t=>{
  const base=mkdtempSync(path.join(os.tmpdir(),'desktop-unicode-discovery-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const directory=path.join(base,'工具 目录');mkdirSync(directory);
  const file=path.join(directory,'pwsh.exe');writeFileSync(file,'synthetic metadata only, never execute');
  assert.equal(findWindowsExecutable('pwsh.exe',{environment:{PATH:`"${directory}"`},
    filesystem:{lstatSync,realpathSync}}),realpathSync.native(file));
});

test('Windows startup rejects workspace or recovery candidates before ACL execution without PATH fallback',
  {skip:process.platform!=='win32'},async t=>{
    for(const location of ['workspace','recovery']) {
      await t.test(location,t=>{
        const base=mkdtempSync(path.join(os.tmpdir(),'desktop-discovery-startup-'));
        const root=path.join(base,'workspace'),userData=path.join(base,'data'),later=path.join(base,'later');
        for(const directory of [root,userData,later]) mkdirSync(directory);
        const recovery=path.join(userData,'coding-recovery',createHash('sha256').update(realpathSync.native(root)).digest('hex'));
        if(location==='recovery') mkdirSync(recovery,{recursive:true});
        const directory=location==='workspace'?root:recovery;
        for(const target of [directory,later]) writeFileSync(path.join(target,'pwsh.exe'),'synthetic, never execute');
        const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
        writeFileSync(path.join(userData,'coding-workspace.json'),JSON.stringify({version:1,
          encrypted:Buffer.from(root).toString('base64')}));
        const previousPath=process.env.PATH;process.env.PATH=`${directory};${later}`;
        let calls=0;
        const invocation=t.mock.method(childProcess,'execFileSync',()=>{calls++;throw Error('Synthetic unexpected execution');});
        syncBuiltinESMExports();
        let host;
        t.after(()=>{
          host?.close();invocation.mock.restore();syncBuiltinESMExports();
          if(previousPath===undefined) delete process.env.PATH;else process.env.PATH=previousPath;
          rmSync(base,{recursive:true,force:true});
        });
        host=createWorkspaceConfigHost({userData,safeStorage});
        assert.equal(calls,0,'unsafe first candidates must never reach PowerShell ACL execution');
        assert.equal(host.tools.some(tool=>tool.descriptor.name==='workspace.apply_text_patch'),false);
        assert.equal(host.snapshot().writeAvailable,false);
        assert.equal(host.snapshot().cloudExportAllowed,false);
        assert.match(host.snapshot().reason,/PowerShell 7/);
        if(location==='workspace') assert.equal(existsSync(recovery),false,'refusal precedes recovery directory creation');
        assert.equal(existsSync(path.join(later,'pwsh.exe')),true,'later candidate exists but cannot bypass the refusal');
      });
    }
  });
