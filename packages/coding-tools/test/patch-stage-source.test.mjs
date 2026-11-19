import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, link, readFile, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {WORKSPACE_PATCH_STAGE_SCOPE, WORKSPACE_READ_SCOPE, createWorkspacePatchStageTool} from '../dist/index.js';
import {checkedSource} from '../dist/patch-stage.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const context = (overrides = {}) => ({
  taskId: 'task-synthetic',
  runId: 'run-synthetic',
  authorizationRef: 'authorization-synthetic',
  scopes: [WORKSPACE_READ_SCOPE, WORKSPACE_PATCH_STAGE_SCOPE],
  signal: new AbortController().signal,
  deadline: new Date(Date.now() + 60_000).toISOString(),
  ...overrides,
});

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-patch-stage-source-'));
  const root = join(base, 'workspace');
  await mkdir(join(root, 'src'), {recursive: true});
  await writeFile(join(root, 'src', 'note.txt'), 'before\n');
  await writeFile(join(root, 'plain.txt'), 'plain\n');
  t.after(() => rm(base, {recursive: true, force: true}));
  return {root: await realpath(root)};
}

test('staging refuses a multi-link source and leaves no candidate behind', async t => {
  const {root} = await fixture(t);
  const alias = join(root, 'src', 'alias.txt');
  try {
    await link(join(root, 'src', 'note.txt'), alias);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) throw error;
    return;
  }
  const tool = createWorkspacePatchStageTool({rootPath: root});
  const input = path => ({
    path,
    expectedSha256: hash('before\n'),
    edits: [{oldText: 'before', newText: 'after'}],
  });
  await assert.rejects(tool.execute(input('src/note.txt'), context()), {code: 'SCOPE_DENIED'},
    'a second hard link disqualifies the original source');
  await assert.rejects(tool.execute(input('src/alias.txt'), context()), {code: 'SCOPE_DENIED'},
    'the alias is equally disqualified');
  assert.equal(await readFile(join(root, 'src', 'note.txt'), 'utf8'), 'before\n');
  assert.deepEqual((await readdir(join(root, 'src'))).sort(), ['alias.txt', 'note.txt'],
    'no staged candidate may remain after a refused staging');
});

test('checkedSource binds the canonical root and only accepts ordinary single-link parents', async t => {
  const {root} = await fixture(t);
  const info = await checkedSource(root, 'src/note.txt');
  assert.equal(info.isFile(), true);
  await assert.rejects(checkedSource(root, 'src'), {code: 'SCOPE_DENIED'},
    'a directory is not a single-link regular file');
  await assert.rejects(checkedSource(root, ''), {code: 'SCOPE_DENIED'},
    'an empty relative path never addresses a source');
  await assert.rejects(checkedSource(root, 'plain.txt/nested.txt'), {code: 'SCOPE_DENIED'},
    'a file used as a parent segment is rejected before traversal');
  const linkedRoot = join(root, 'linked-root');
  try {
    await symlink(root, linkedRoot, 'dir');
    await assert.rejects(checkedSource(linkedRoot, 'src/note.txt'), {code: 'SCOPE_DENIED'},
      'a non-canonical root path is rejected even for an existing file');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) throw error;
  }
});
