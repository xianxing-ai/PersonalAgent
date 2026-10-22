import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createKnowledgeSourceConfig} from '../electron/knowledge-source-config.js';
import {findWindowsExecutable} from '../electron/windows-executable-discovery.js';

// Encryption fake is explicit; no real credentials or private Vault are used.
const safeStorage = {isEncryptionAvailable: () => true, encryptString: value => Buffer.from('synthetic:' + value),
  decryptString: value => value.toString().replace(/^synthetic:/, '')};
async function fixture(t) {
  const parent = fileURLToPath(new URL('../../../data/test-tmp/', import.meta.url));
  await mkdir(parent, {recursive: true});
  const base = await mkdtemp(join(parent, "knowledge-source-中文 ' 👋-"));
  const userData = join(base, 'host'), first = join(base, 'first'), second = join(base, 'second');
  await mkdir(userData); await mkdir(first); await mkdir(second);
  await writeFile(join(first, 'one.md'), '公开合成 first\n'); await writeFile(join(second, 'two.md'), '公开合成 second\n');
  t.after(() => rm(base, {recursive: true, force: true}));
  let selected = first;
  const options = {userData, safeStorage, namespace: 'synthetic-admin', hostIdentity: randomUUID(),
    selectDirectory: async () => selected, selectNoteFiles: async root => [join(root, root === first ? 'one.md' : 'two.md')],
    confirmPermissions: async () => true};
  const host = await createKnowledgeSourceConfig(options);
  t.after(() => host.close());
  return {userData, first, second, options, host, select: value => {selected = value;}};
}
const binding = host => ({sourceId: host.snapshot().sourceId, configRevision: host.snapshot().configRevision});

test('real Windows knowledge recovery ACL accepts Unicode paths and keeps write consent explicit',
  {skip: process.platform !== 'win32'}, async t => {
    const f = await fixture(t), powerShellPath = findWindowsExecutable('pwsh.exe');
    assert.ok(powerShellPath, 'PowerShell 7 is required for Windows recovery tests');
    const host = await createKnowledgeSourceConfig({...f.options, powerShellPath}); t.after(() => host.close());
    await host.select(); await host.selectNotes(binding(host));
    assert.equal(host.snapshot().writeAvailable, false);
    await host.configure({...binding(host), enabled: true, dataLevel: 'private', writeAllowed: true,
      cloudExportAllowed: false, publicQueries: []});
    assert.equal(host.snapshot().writeAvailable, true, host.snapshot().reason);
    assert.match(host.pairingIdentity(), /^[a-f0-9]{64}$/);
    await host.revoke(); assert.equal(host.pairingIdentity(), undefined);
  });

test('replacing the bound native process identity helper disables only the writer',
  {skip: process.platform !== 'win32'}, async t => {
    const f = await fixture(t), powerShellPath = findWindowsExecutable('pwsh.exe');
    assert.ok(powerShellPath, 'PowerShell 7 is required for Windows recovery tests');
    const processIdentityHelperPath = join(f.userData, 'WindowsJobProcessHost.exe');
    await writeFile(processIdentityHelperPath, 'synthetic helper v1');
    const question={currentRequirement:()=>{}}; // Explicit Fake current-card port; never a product grant.
    const host = await createKnowledgeSourceConfig({...f.options, powerShellPath, processIdentityHelperPath,question});
    t.after(() => host.close());
    await host.select(); await host.selectNotes(binding(host));
    await host.configure({...binding(host), enabled: true, dataLevel: 'private', writeAllowed: true,
      cloudExportAllowed: false, publicQueries: []});
    assert.equal(host.snapshot().writeAvailable, true, host.snapshot().reason);
    const signal=new AbortController().signal;
    assert.equal(host.acquire(binding(host),signal).write,undefined);
    // Windows recovery ACL inspection is synchronous and may outlast a short
    // fixture lease. Start the execution lease after that independent inspection.
    const context={taskId:'synthetic-task',runId:'synthetic-run',toolName:'knowledge.apply_note_patch',deadline:new Date(Date.now()+120000).toISOString(),signal};
    const before = host.withAuthorization(context,()=>host.acquire(binding(host), context.signal));
    assert.ok(before.write);
    await writeFile(processIdentityHelperPath, 'synthetic helper replacement with a different identity');
    assert.equal(host.snapshot().available, true);
    assert.equal(host.snapshot().writeAvailable, false);
    const after = host.acquire(binding(host), new AbortController().signal);
    assert.equal(after.write, undefined);
    assert.equal(after.reconcileWrite, undefined);
    before.release(); after.release();
  });

test('missing config is unavailable; native selection persists a host-bound root without snapshot paths', async t => {
  const {host, userData, first, options} = await fixture(t);
  assert.equal(host.snapshot().available, false);
  assert.throws(() => host.acquire({sourceId: '', configRevision: 0}, new AbortController().signal));
  await host.select();
  const current = host.snapshot();
  assert.equal(current.available, true); assert.equal(current.dataLevel, 'private');
  assert.equal(current.cloudExportAllowed, false); assert.equal(current.writeAvailable, false);
  assert.equal(JSON.stringify(current).includes(first), false);
  const stored = JSON.parse(await readFile(join(userData, 'knowledge-source-config.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored).sort(), ['encrypted', 'version']);
  const restarted = await createKnowledgeSourceConfig(options); t.after(() => restarted.close());
  assert.equal(restarted.snapshot().sourceId, current.sourceId);
  assert.equal(restarted.snapshot().configRevision, current.configRevision);
  assert.equal(restarted.snapshot().available, true);
});

test('PUBLIC directory uses the existing configuration choice while tool access still needs its card',async t=>{
  const f=await fixture(t);let requirement,allowed=false,catalogCalls=0;
  const question={prepare(_scope,options){requirement=options;},currentRequirement(){if(!allowed)throw Error('Synthetic original card not consumed');}};
  const host=await createKnowledgeSourceConfig({...f.options,question,confirmCatalog:async request=>{catalogCalls++;return request.isCurrent();}});t.after(()=>host.close());
  await host.select();const controller=new AbortController(),scope={taskId:'task',runId:'run',toolName:'knowledge.search',
    deadline:new Date(Date.now()+30000).toISOString(),signal:controller.signal};
  host.prepareAuthorization(scope);assert.equal(requirement.requirements[0].requirementId,'knowledge-source');
  assert.throws(()=>host.withAuthorization(scope,()=>{}),/not consumed/);
  assert.equal(await host.authorizeCatalog(scope),false);assert.equal(catalogCalls,0);
  allowed=true;const lease=host.withAuthorization(scope,()=>host.acquire(binding(host),scope.signal));
  lease.assertCurrent();allowed=false;assert.throws(()=>lease.assertCurrent(),/not consumed/);lease.release();
  await host.configure({...binding(host),enabled:true,dataLevel:'public',writeAllowed:false,cloudExportAllowed:true,publicQueries:['公开合成']});
  assert.equal(await host.authorizeCatalog(scope),true);assert.equal(catalogCalls,0,'no separate directory approval before the actual tool card');
  controller.abort();assert.equal(await host.authorizeCatalog(scope),false);
});

test('switch and revoke abort old leases; old source/version never silently binds the next Vault', async t => {
  const {host, second, select} = await fixture(t);
  await host.select();
  const old = binding(host), lease = host.acquire(old, new AbortController().signal);
  select(second); await host.select();
  assert.equal(lease.signal.aborted, true); assert.throws(() => lease.assertCurrent());
  lease.release(); assert.throws(() => host.acquire(old, new AbortController().signal));
  const current = binding(host), secondLease = host.acquire(current, new AbortController().signal);
  const result = await secondLease.read.search({query: 'second', limit: 1,
    deadline: new Date(Date.now() + 30000).toISOString(), signal: secondLease.signal});
  assert.equal(result.hits[0].source.path, 'two.md');
  await host.revoke(); assert.equal(secondLease.signal.aborted, true); secondLease.release();
  assert.equal(host.snapshot().available, false); assert.throws(() => host.acquire(current, new AbortController().signal));
});

test('only native-selected note is readable locally; config changes invalidate its baseline view', async t => {
  const {host} = await fixture(t); await host.select();
  await assert.rejects(host.readSelectedNote({...binding(host), path: 'one.md'}));
  await host.selectNotes(binding(host));
  const old = binding(host);
  const result = await host.readSelectedNote({...old, path: 'one.md'});
  assert.match(result.revision, /^[a-f0-9]{64}$/); assert.equal(result.content, '公开合成 first\n');
  await host.configure({...old, enabled: true, dataLevel: 'private', writeAllowed: false,
    cloudExportAllowed: false, publicQueries: []});
  await assert.rejects(host.readSelectedNote({...old, path: 'one.md'}));
  await assert.rejects(host.readSelectedNote({...binding(host), path: '../one.md'}));
});

test('public export requires exact native-confirmed consent and expires on restart; private cannot export', async t => {
  const {host, options} = await fixture(t); await host.select();
  await assert.rejects(host.configure({...binding(host), enabled: true, dataLevel: 'private', writeAllowed: false,
    cloudExportAllowed: true, publicQueries: ['公开合成']}));
  await host.configure({...binding(host), enabled: true, dataLevel: 'public', writeAllowed: false,
    cloudExportAllowed: true, publicQueries: ['公开合成']});
  assert.equal(host.snapshot().cloudExportAllowed, true);
  const restarted = await createKnowledgeSourceConfig(options); t.after(() => restarted.close());
  assert.equal(restarted.snapshot().available, true); assert.equal(restarted.snapshot().cloudExportAllowed, false);
  const declined = await createKnowledgeSourceConfig({...options, confirmPermissions: async () => false});
  t.after(() => declined.close());
  const before = declined.snapshot().configRevision;
  await declined.configure({...binding(declined), enabled: true, dataLevel: 'public', writeAllowed: false,
    cloudExportAllowed: true, publicQueries: ['公开合成']});
  assert.equal(declined.snapshot().cloudExportAllowed, false); assert.equal(declined.snapshot().configRevision, before);
});

test('corrupt storage, mismatched host identity and replaced root remain unavailable without fallback', async t => {
  const {host, options, userData, first} = await fixture(t); await host.select();
  const other = await createKnowledgeSourceConfig({...options, hostIdentity: 'other-host'}); t.after(() => other.close());
  assert.equal(other.snapshot().available, false);
  await rm(first, {recursive: true}); await mkdir(first);
  assert.equal(host.snapshot().available, false);
  await writeFile(join(userData, 'knowledge-source-config.json'), '{broken');
  const corrupt = await createKnowledgeSourceConfig(options); t.after(() => corrupt.close());
  assert.equal(corrupt.snapshot().configured, false); assert.equal(corrupt.snapshot().available, false);
});

test('revocation persists a data-free tombstone if encryption becomes unavailable', async t => {
  const {host, options, userData} = await fixture(t); await host.select();
  let encrypting = true;
  const changing = await createKnowledgeSourceConfig({...options,
    safeStorage: {...safeStorage, isEncryptionAvailable: () => encrypting}});
  t.after(() => changing.close());
  encrypting = false; await changing.revoke();
  assert.deepEqual(JSON.parse(await readFile(join(userData, 'knowledge-source-config.json'), 'utf8')), {version: 1, revoked: true});
  const restarted = await createKnowledgeSourceConfig(options); t.after(() => restarted.close());
  assert.equal(restarted.snapshot().configured, false); assert.equal(restarted.snapshot().available, false);
});

test('revoke replaces an old enabled encrypted file even when startup could not decrypt it', async t => {
  const {host, options, userData} = await fixture(t); await host.select();
  const unreadable = await createKnowledgeSourceConfig({...options,
    safeStorage: {...safeStorage, isEncryptionAvailable: () => false}});
  t.after(() => unreadable.close());
  assert.equal(unreadable.snapshot().configured, false);
  await unreadable.revoke(); await unreadable.revoke();
  assert.deepEqual(JSON.parse(await readFile(join(userData, 'knowledge-source-config.json'), 'utf8')), {version: 1, revoked: true});
  const restoredStorage = await createKnowledgeSourceConfig(options); t.after(() => restoredStorage.close());
  assert.equal(restoredStorage.snapshot().available, false);
  assert.equal(restoredStorage.snapshot().configured, false);
});
