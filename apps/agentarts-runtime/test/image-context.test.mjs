import assert from 'node:assert/strict';
import test from 'node:test';
import {chmod,cp,mkdir,mkdtemp,readFile,readdir,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile),root=fileURLToPath(new URL('../../../',import.meta.url));
const workspaces=['packages/contracts','packages/coordination','packages/models','packages/agentarts','apps/agentarts-runtime'];
async function layaFixture(fixture,app) {
  await cp(path.join(root,'apps/agentarts-runtime/scripts/laya-assets.mjs'),path.join(app,'scripts/laya-assets.mjs'));
  await mkdir(path.join(fixture,'scripts/laya'),{recursive:true});
  for(const file of ['batch-server.py','requirements-image.txt']) await cp(path.join(root,'scripts/laya',file),path.join(fixture,'scripts/laya',file));
  const source=path.join(fixture,'synthetic-model');
  for(const file of ['model.safetensors','rl_agent_config.json','encoder/config.json','tokenizer/tokenizer_config.json','tokenizer/tokenizer.json']) {
    const destination=path.join(source,file);await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,file==='model.safetensors'?'synthetic untrained fixture':'{}');
  }
  const env={...process.env,PA_LAYA_MODEL_SOURCE:source,PA_LAYA_ASSET_ROOT:source,PA_LAYA_MODEL_REVISION:'a'.repeat(40),
    PA_IMAGE_NPM_REGISTRY:'https://repo.huaweicloud.com/repository/npm/'};
  env.PA_LAYA_WHEELHOUSE=path.join(fixture,'synthetic-cpu-wheels');await mkdir(env.PA_LAYA_WHEELHOUSE);
  await writeFile(path.join(env.PA_LAYA_WHEELHOUSE,'torch-2.14.0+cpu-cp311-cp311-manylinux_2_28_aarch64.whl'),'synthetic export fixture; never installed');
  return env;
}
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
  const env=await layaFixture(fixture,app);
  const stale=path.join(fixture,'.cache/agentarts-image/context-8675309');await mkdir(stale,{recursive:true});
  const canary='synthetic stale private export\n';await writeFile(path.join(stale,'stale-canary.json'),canary);
  const invoke=async()=>JSON.parse((await run(process.execPath,['--import','data:text/javascript,Date.now=()=>8675309',
    path.join(app,'scripts/image-context.mjs')],{env})).stdout);
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
    assert.ok(manifest.files.includes('assets/laya/multilingual/model.safetensors'));
    assert.equal(manifest.laya.revision,'a'.repeat(40));assert.equal(manifest.laya.files.length,5);
    assert.equal(await readFile(path.join(result.context,'Dockerfile'),'utf8'),await readFile(path.join(app,'Dockerfile'),'utf8'));
    const packageJson=JSON.parse(await readFile(path.join(result.context,'package.json'),'utf8'));
    assert.deepEqual(packageJson.workspaces,workspaces);
    const lock=JSON.parse(await readFile(path.join(result.context,'package-lock.json'),'utf8'));
    const sourceLock=JSON.parse(await readFile(path.join(fixture,'package-lock.json'),'utf8'));
    for(const [name,entry] of Object.entries(lock.packages)) {
      assert.equal(typeof entry.resolved==='string'&&entry.resolved.startsWith('https://registry.npmjs.org/'),false);
      if(name&&entry.integrity)assert.equal(entry.integrity,sourceLock.packages[name].integrity);
      if(name&&entry.version)assert.equal(entry.version,sourceLock.packages[name].version);
    }
    const registry=JSON.parse(await readFile(path.join(result.context,'npm-registry.json'),'utf8'));
    assert.equal(registry.registry,env.PA_IMAGE_NPM_REGISTRY);assert.ok(registry.rewrittenTarballs>0);
    assert.deepEqual(lock.packages[''].workspaces,workspaces);
    for(const relative of workspaces){
      const p=JSON.parse(await readFile(path.join(result.context,relative,'package.json'),'utf8'));
      assert.equal(p.scripts,undefined);assert.equal(p.devDependencies,undefined);assert.ok(lock.packages[relative]);
    }
    assert.deepEqual((await readdir(path.join(result.context,'apps'))).sort(),['agentarts-runtime']);
  }
  const customLock=JSON.parse(await readFile(path.join(fixture,'package-lock.json'),'utf8'));
  customLock.packages['node_modules/ajv'].resolved='https://synthetic-private-registry.invalid/ajv.tgz';
  await writeFile(path.join(fixture,'package-lock.json'),JSON.stringify(customLock));
  env.PA_IMAGE_NPM_REGISTRY='https://synthetic-explicit-registry.invalid/npm/';
  const configured=await invoke(), configuredLock=JSON.parse(await readFile(path.join(configured.context,'package-lock.json'),'utf8'));
  assert.equal(configuredLock.packages['node_modules/ajv'].resolved,customLock.packages['node_modules/ajv'].resolved);
  assert.equal(configuredLock.packages['node_modules/ajv'].integrity,customLock.packages['node_modules/ajv'].integrity);
  assert.ok(Object.values(configuredLock.packages).some(entry=>entry.resolved?.startsWith(env.PA_IMAGE_NPM_REGISTRY)));
  if (process.platform !== 'win32') {
    // A source symlink must not make the exporter chmod a file outside its fresh context.
    const privateCanary=path.join(fixture,'private-mode-canary');
    await writeFile(privateCanary,'synthetic private bytes',{mode:0o600});
    await chmod(privateCanary,0o600);
    await symlink(privateCanary,path.join(app,'src','private-mode-link'));
    await assert.rejects(invoke(),error=>{
      assert.match(error.stderr,/Non-regular owned image source/);
      return true;
    });
    assert.equal((await stat(privateCanary)).mode&0o777,0o600);
    assert.equal(await readFile(privateCanary,'utf8'),'synthetic private bytes');
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
  const env=await layaFixture(fixture,app);
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
      path.join(app,'scripts/image-context.mjs')],{env})).stdout);
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
