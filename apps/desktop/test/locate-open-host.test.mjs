import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocateOpenHost} from '../electron/locate-open-host.js';

test('locate open stays inside the workspace and prefers editor URI', async () => {
  const root = mkdtempSync(join(tmpdir(), 'locate-open-'));
  writeFileSync(join(root, 'broken.mjs'), 'function broken( {\n');
  const opened = [];
  const host = createLocateOpenHost({
    getRoot: () => root,
    openExternal: async uri => { opened.push({kind: 'external', uri}); },
    openPath: async file => { opened.push({kind: 'path', file}); },
    spawnImpl: () => { throw new Error('spawn should not run when openExternal works'); },
  });
  try {
    const result = await host.open({file: 'broken.mjs', line: 1, column: 16});
    assert.equal(result.opened, true);
    assert.equal(result.method, 'cursor');
    assert.match(opened[0].uri, /^cursor:\/\/file\//);
    assert.match(opened[0].uri, /broken\.mjs:1:16/);
    await assert.rejects(host.open({file: '../outside.mjs', line: 1}), /越界|无效/);
    await assert.rejects(host.open({file: 'C:/Windows/notepad.exe', line: 1}), /越界|无效/);
    await assert.rejects(host.open({file: 'broken.mjs', line: 1, evil: true}), /额外字段/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('locate open falls back to shell.openPath when editors are unavailable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'locate-open-shell-'));
  writeFileSync(join(root, 'note.txt'), 'hello\n');
  const opened = [];
  const host = createLocateOpenHost({
    getRoot: () => root,
    openExternal: async () => { throw new Error('no uri handler'); },
    openPath: async file => { opened.push(file); },
    spawnImpl: () => { const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err; },
  });
  try {
    const result = await host.open({file: 'note.txt'});
    assert.equal(result.opened, true);
    assert.equal(result.method, 'shell');
    assert.equal(opened.length, 1);
    assert.match(opened[0], /note\.txt$/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
