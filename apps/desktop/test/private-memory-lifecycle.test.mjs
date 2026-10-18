import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPrivateMemoryController} from '../electron/private-memory.js';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-private-lifecycle-'));
  const root = join(base, 'vault');
  const database = join(base, 'private.sqlite');
  await mkdir(root);
  await writeFile(join(root, 'note.md'), 'Synthetic lifecycle citation.\n');
  const controller = createPrivateMemoryController(database, async () => false);
  t.after(async () => {controller.close(); await rm(base, {recursive: true, force: true});});
  return {controller, root, database};
}

test('closed private controller clears Vault selection and rejects further source reads', async t => {
  const {controller, root, database} = await fixture(t);
  await controller.selectVault(root);
  assert.equal((await controller.search('Synthetic')).hits.length, 1);
  controller.close();
  await assert.rejects(async () => controller.search('Synthetic'), /控制器已关闭/);
  assert.equal(controller.selected, false);
  assert.equal(existsSync(database), false);
});

test('closing during Vault selection cannot install the pending source', async t => {
  const {controller, root, database} = await fixture(t);
  const revision = controller.configurationRevision;
  const selection = controller.selectVault(root);
  controller.close();
  await assert.rejects(selection, /控制器已关闭/);
  assert.equal(controller.selected, false);
  assert.equal(controller.configurationRevision, revision);
  assert.equal(existsSync(database), false);
});

test('closing during a private search rejects the in-flight result', async t => {
  const {controller, root, database} = await fixture(t);
  await controller.selectVault(root);
  const result = controller.search('Synthetic');
  controller.close();
  await assert.rejects(result, /控制器已关闭/);
  assert.equal(controller.selected, false);
  assert.equal(existsSync(database), false);
});
