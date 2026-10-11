import assert from 'node:assert/strict';
import test from 'node:test';
import {chmod,cp,mkdir,mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile),root=fileURLToPath(new URL('../../../',import.meta.url));
const workspaces=['packages/contracts','packages/coordination','packages/models','packages/agentarts','apps/agentarts-runtime'];
test('actual image-context script isolates fixed-clock concurrent builds and preserves old contexts',async t=>{
  // Local production artifacts only: no account, network, Docker or model call.
  const fixture=await mkdtemp(path.join(os.tmpdir(),'owned-image-context-'));
  t.after(()=>rm(fixture,{recursive:true,force:true}));
  await cp(path.join(root,'package-lock.json'),path.join(fixture,'package-lock.json'));
  for(const relative of workspaces){
    const dest=path.join(fixture,relative);await mkdir(dest,{recursive:true});
    await cp(path.join(root,relative,'package.json'),path.join(dest,'package.json'));
    const artifacts=relative.startsWith('apps/')?'src':'dist';
    await cp(path.join(root,relative,artifacts),path.join(dest,artifacts),{recursive:true});
    if(relative==='packages/contracts')await cp(path.join(root,relative,'schema'),path.join(dest,'schema'),{recursive:true});
  }
  const app=path.join(fixture,'apps/agentarts-runtime');await mkdir(path.join(app,'scripts'));
  await cp(path.join(root,'apps/agentarts-runtime/scripts/image-context.mjs'),path.join(app,'scripts/image-context.mjs'));
  await cp(path.join(root,'apps/agentarts-runtime/Dockerfile'),path.join(app,'Dockerfile'));
  const stale=path.join(fixture,'.cache/agentarts-image/context-8675309');await mkdir(stale,{recursive:true});
  const canary='synthetic stale private export\n';await writeFile(path.join(stale,'stale-canary.json'),canary);
  const invoke=async()=>JSON.parse((await run(process.execPath,['--import','data:text/javascript,Date.now=()=>8675309',
    path.join(app,'scripts/image-context.mjs')])).stdout);
  const results=await Promise.all([invoke(),invoke()]);results.push(await invoke());
  assert.equal(new Set(results.map(r=>r.context)).size,3);
  assert.equal(await readFile(path.join(stale,'stale-canary.json'),'utf8'),canary);
  for(const result of results){
    assert.notEqual(result.context,stale);assert.deepEqual(result.workspaces,workspaces);
    const manifest=JSON.parse(await readFile(path.join(result.context,'context-manifest.json'),'utf8'));
    assert.deepEqual(manifest.workspacePaths,workspaces);assert.equal(result.files,manifest.files.length);
    assert.ok(!manifest.files.some(f=>/stale-canary|node_modules|\.env/.test(f)));
    assert.ok(manifest.files.includes('Dockerfile'));assert.ok(manifest.files.includes('packages/contracts/dist/index.js'));
    assert.ok(manifest.files.some(f=>f.startsWith('packages/contracts/schema/')));
    assert.ok(manifest.files.includes('apps/agentarts-runtime/src/server.mjs'));
    assert.equal(await readFile(path.join(result.context,'Dockerfile'),'utf8'),await readFile(path.join(app,'Dockerfile'),'utf8'));
    const packageJson=JSON.parse(await readFile(path.join(result.context,'package.json'),'utf8'));
    assert.deepEqual(packageJson.workspaces,workspaces);
    const lock=JSON.parse(await readFile(path.join(result.context,'package-lock.json'),'utf8'));
    assert.deepEqual(lock.packages[''].workspaces,workspaces);
    for(const relative of workspaces){
      const p=JSON.parse(await readFile(path.join(result.context,relative,'package.json'),'utf8'));
      assert.equal(p.scripts,undefined);assert.equal(p.devDependencies,undefined);assert.ok(lock.packages[relative]);
    }
    assert.deepEqual((await readdir(path.join(result.context,'apps'))).sort(),['agentarts-runtime']);
  }
});

test('actual allowlist context is readable by the image USER under restrictive and ordinary umasks',
  {skip:process.platform==='win32'?'POSIX permission bits and umask require a POSIX filesystem; Windows context isolation remains covered':false},async t=>{
  // Only synthetic fixture modes change; source repository and old contexts stay untouched.
  const fixture=await mkdtemp(path.join(os.tmpdir(),'owned-context-modes-'));
  t.after(()=>rm(fixture,{recursive:true,force:true}));
  await cp(path.join(root,'package-lock.json'),path.join(fixture,'package-lock.json'));
  for(const relative of workspaces){
    const dest=path.join(fixture,relative);await mkdir(dest,{recursive:true});
    await cp(path.join(root,relative,'package.json'),path.join(dest,'package.json'));
    const artifacts=relative.startsWith('apps/')?'src':'dist';
    await cp(path.join(root,relative,artifacts),path.join(dest,artifacts),{recursive:true});
    if(relative==='packages/contracts')await cp(path.join(root,relative,'schema'),path.join(dest,'schema'),{recursive:true});
  }
  const app=path.join(fixture,'apps/agentarts-runtime');await mkdir(path.join(app,'scripts'));
  await cp(path.join(root,'apps/agentarts-runtime/scripts/image-context.mjs'),path.join(app,'scripts/image-context.mjs'));
  await cp(path.join(root,'apps/agentarts-runtime/Dockerfile'),path.join(app,'Dockerfile'));
  const sourceModes=new Map();
  async function restrict(directory){
    await chmod(directory,0o700);sourceModes.set(directory,0o700);
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const name=path.join(directory,entry.name);
      if(entry.isDirectory())await restrict(name);
      else {await chmod(name,0o600);sourceModes.set(name,0o600);}
    }
  }
  await restrict(fixture);
  const old=path.join(fixture,'.cache/agentarts-image/context-old');await mkdir(old,{recursive:true,mode:0o700});
  await chmod(old,0o700);const secret=path.join(old,'private-canary');await writeFile(secret,'Synthetic old private bytes',{mode:0o600});
  await chmod(secret,0o600);
  for(const sourceMask of ['0o077','0o022'])for(const mask of ['0o077','0o022'])await t.test(`source ${sourceMask}, export ${mask}`,async()=>{
    for(const [name] of sourceModes){
      const mode=(await stat(name)).isDirectory()?(sourceMask==='0o077'?0o700:0o755):(sourceMask==='0o077'?0o600:0o644);
      await chmod(name,mode);sourceModes.set(name,mode);
    }
    const result=JSON.parse((await run(process.execPath,['--import',`data:text/javascript,process.umask(${mask})`,
      path.join(app,'scripts/image-context.mjs')])).stdout);
    async function verify(directory){
      assert.equal((await stat(directory)).mode&0o777,0o755,`new context directory under ${mask}`);
      for(const entry of await readdir(directory,{withFileTypes:true})){
        const name=path.join(directory,entry.name);
        if(entry.isDirectory())await verify(name);
        else assert.equal((await stat(name)).mode&0o777,0o644,`new allowlist file under ${mask}`);
      }
    }
    await verify(result.context);
    assert.equal(await readFile(path.join(result.context,'apps/agentarts-runtime/src/main.mjs'),'utf8'),
      await readFile(path.join(app,'src/main.mjs'),'utf8'));
    for(const [name,mode] of sourceModes)assert.equal((await stat(name)).mode&0o777,mode,'source mode unchanged');
    assert.equal((await stat(old)).mode&0o777,0o700);assert.equal((await stat(secret)).mode&0o777,0o600);
    assert.equal(await readFile(secret,'utf8'),'Synthetic old private bytes');
  });
});
