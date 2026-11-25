import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, symlink, writeFile,rename,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {openReadOnlyVault} from '../dist/filesystem.js';

const context = overrides => ({
  deadline: new Date(Date.now() + 30_000).toISOString(),
  signal: new AbortController().signal,
  ...overrides
});

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-knowledge-'));
  const root = join(base, 'vault');
  const outside = join(base, 'outside');
  await mkdir(join(root, 'notes'), {recursive: true});
  await mkdir(outside);
  t.after(() => rm(base, {recursive: true, force: true}));
  return {root, outside};
}

test('reads a bounded synthetic Vault and cites the exact file revision and line', async t => {
  const {root} = await fixture(t);
  await writeFile(join(root, 'notes', 'one.md'), '标题\n今天天气晴朗\n', 'utf8');
  await writeFile(join(root, 'notes', 'two.md'), '天气预报\n', 'utf8');
  const vault = await openReadOnlyVault({vaultId: 'synthetic', rootPath: root});
  const result = await vault.search({query: '天气', limit: 1, ...context()});
  assert.equal(result.hits.length, 1);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.hits[0].source.path, 'notes/one.md');
  assert.equal(result.hits[0].source.line, 2);
  assert.match(result.hits[0].source.revision, /^[0-9a-f]{64}$/);
  assert.equal(await vault.readCitation({source: result.hits[0].source, ...context()}), '今天天气晴朗');
  assert.equal(JSON.stringify(result).includes(root), false);
});

test('rescans after changes and refuses stale citations', async t => {
  const {root} = await fixture(t);
  const path = join(root, 'notes', 'one.md');
  await writeFile(path, 'old hello\n', 'utf8');
  const vault = await openReadOnlyVault({vaultId: 'synthetic', rootPath: root});
  const old = (await vault.search({query: 'hello', limit: 5, ...context()})).hits[0].source;
  await writeFile(path, 'new hello\n', 'utf8');
  await assert.rejects(vault.readCitation({source: old, ...context()}), {code: 'SOURCE_CHANGED'});
  const fresh = (await vault.search({query: 'hello', limit: 5, ...context()})).hits[0].source;
  assert.notEqual(fresh.revision, old.revision);
  assert.equal(await vault.readCitation({source: fresh, ...context()}), 'new hello');
});

test('citation cannot escape its bound Vault or use another Vault id', async t => {
  const {root, outside} = await fixture(t);
  await writeFile(join(outside, 'secret.md'), 'synthetic secret\n');
  const vault = await openReadOnlyVault({vaultId: 'synthetic', rootPath: root});
  const source = {vaultId: 'synthetic', path: '../outside/secret.md', line: 1, revision: 'a'.repeat(64)};
  for (const patch of [
    {}, {path: 'C:/secret.md'}, {path: 'notes\\secret.md'}, {path: '/secret.md'},
    {vaultId: 'other'}, {line: 0}
  ]) {
    await assert.rejects(vault.readCitation({source: {...source, ...patch}, ...context()}),
      {code: 'INVALID_ARGUMENT'});
  }
  assert.deepEqual(await vault.search({query: 'secret', limit: 5, ...context()}), {hits: [], truncated: false});
});

test('rejects a symlink or junction to outside the authorized Vault', async t => {
  const {root, outside} = await fixture(t);
  await writeFile(join(outside, 'secret.md'), 'synthetic secret\n');
  try {
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
      t.skip(`platform cannot create synthetic link: ${error.code}`);
      return;
    }
    throw error;
  }
  const vault = await openReadOnlyVault({vaultId: 'synthetic', rootPath: root});
  await assert.rejects(vault.search({query: 'secret', limit: 5, ...context()}), {code: 'SCOPE_DENIED'});
  await assert.rejects(vault.readCitation({
    source: {vaultId: 'synthetic', path: 'linked/secret.md', line: 1, revision: 'a'.repeat(64)},
    ...context()
  }), {code: 'SCOPE_DENIED'});
});

test('rejects oversized and invalid UTF-8 notes without exposing their paths', async t => {
  const {root} = await fixture(t);
  await writeFile(join(root, 'notes', 'large.md'), Buffer.alloc(512 * 1024 + 1, 65));
  const vault = await openReadOnlyVault({vaultId: 'synthetic', rootPath: root});
  await assert.rejects(vault.search({query: 'A', limit: 1, ...context()}),
    error => error.code === 'LIMIT_EXCEEDED' && !error.message.includes(root));
  await rm(join(root, 'notes', 'large.md'));
  await writeFile(join(root, 'notes', 'invalid.md'), Buffer.from([0xff]));
  await assert.rejects(vault.search({query: 'A', limit: 1, ...context()}),
    {code: 'SOURCE_UNAVAILABLE'});
  await writeFile(join(root, 'notes', 'invalid.md'), 'binary\u0000text');
  await assert.rejects(vault.search({query: 'binary', limit: 1, ...context()}),
    {code: 'SOURCE_UNAVAILABLE'});
});

test('search rejects invalid input, cancellation and expired deadline', async t => {
  const {root} = await fixture(t);
  const vault = await openReadOnlyVault({vaultId: 'synthetic', rootPath: root});
  await assert.rejects(vault.search({query: '', limit: 1, ...context()}), {code: 'INVALID_ARGUMENT'});
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(vault.search({query: 'hello', limit: 1, ...context({signal: cancelled.signal})}),
    {code: 'CANCELLED'});
  await assert.rejects(vault.search({
    query: 'hello', limit: 1, ...context({deadline: new Date(Date.now() - 1000).toISOString()})
  }), {code: 'TIMEOUT'});
});

test('synchronous final citation guard checks exact content and refuses stale or foreign sources',async t=>{
  const {root}=await fixture(t),path=join(root,'notes','one.md');await writeFile(path,'original line\n');
  const vault=await openReadOnlyVault({vaultId:'synthetic',rootPath:root});
  const source=(await vault.search({query:'original',limit:1,...context()})).hits[0].source;
  assert.equal(vault.assertCitationCurrent({source,...context()}),undefined);
  assert.throws(()=>vault.assertCitationCurrent({source:{...source,vaultId:'foreign'},...context()}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>vault.assertCitationCurrent({source:{...source,line:99},...context()}),{code:'SOURCE_CHANGED'});
  assert.throws(()=>vault.assertCitationCurrent({source,...context({signal:AbortSignal.abort()})}),{code:'CANCELLED'});
  assert.throws(()=>vault.assertCitationCurrent({source,...context({deadline:new Date(0).toISOString()})}),{code:'TIMEOUT'});
  await writeFile(path,'modified line\n');
  assert.throws(()=>vault.assertCitationCurrent({source,...context()}),{code:'SOURCE_CHANGED'});
  await writeFile(path,Buffer.alloc(512*1024+1,65));
  assert.throws(()=>vault.assertCitationCurrent({source,...context()}),{code:'LIMIT_EXCEEDED'});
});

test('synchronous final citation guard preserves original root, link and regular-file boundary',async t=>{
  for(const replacement of ['root','junction','hardlink','directory']){
    const {root,outside}=await fixture(t),path=join(root,'notes','one.md');await writeFile(path,'original line\n');
    const vault=await openReadOnlyVault({vaultId:'synthetic',rootPath:root});
    const source=(await vault.search({query:'original',limit:1,...context()})).hits[0].source;
    if(replacement==='root'){await rename(root,root+'-original');await mkdir(join(root,'notes'),{recursive:true});await writeFile(path,'original line\n');}
    else if(replacement==='junction'){
      await writeFile(join(outside,'one.md'),'original line\n');await rm(join(root,'notes'),{recursive:true});
      await symlink(outside,join(root,'notes'),process.platform==='win32'?'junction':'dir');
    }else if(replacement==='hardlink')await link(path,join(outside,'copy.md'));
    else{await rm(path);await mkdir(path);}
    assert.throws(()=>vault.assertCitationCurrent({source,...context()}),error=>['SCOPE_DENIED','SOURCE_UNAVAILABLE'].includes(error.code),replacement);
  }
});
