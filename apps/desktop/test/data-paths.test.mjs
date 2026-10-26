import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {mkdtempSync, mkdirSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {desktopDataPaths} from '../electron/data-paths.js';
import {Conversations} from '../electron/conversations.js';

const electronDir = path.resolve('synthetic-install', 'resources', 'app.asar', 'electron');
const userData = path.resolve('synthetic-user-data');
const options = {electronDir, userData};

test('packaged persistent data stays outside application resources', () => {
  assert.deepEqual(desktopDataPaths({...options, packaged: true}), {
    runtime: path.join(userData, 'runtime.sqlite'),
    privateMemory: path.join(userData, 'private-memory.sqlite'),
    conversations: path.join(userData, 'conversations.json'),
  });
});

test('development retains original database and conversation paths without migration', () => {
  assert.deepEqual(desktopDataPaths(options), {
    runtime: path.resolve(electronDir, '../.cache/runtime.sqlite'),
    privateMemory: path.resolve(electronDir, '../.cache/private-memory.sqlite'),
    conversations: path.resolve(electronDir, '../.cache/conversations.json'),
  });
});

test('explicit test and ephemeral data paths remain isolated', () => {
  assert.deepEqual(desktopDataPaths({...options, testUserData: true}), {
    runtime: path.join(userData, 'runtime.sqlite'), privateMemory: path.join(userData, 'private-memory.sqlite'),
    conversations: path.join(userData, 'conversations.json'),
  });
  assert.deepEqual(desktopDataPaths({...options, ephemeral: true}), {
    runtime: path.join(userData, 'runtime.sqlite'), privateMemory: path.join(userData, 'private-memory.sqlite'),
    conversations: null,
  });
});

test('packaged Fake uses isolated userData and never persists conversations', () => {
  assert.deepEqual(desktopDataPaths({...options, packaged: true, fakeRuntime: true}), {
    runtime: path.join(userData, 'fake-runtime-application.sqlite'),
    privateMemory: path.join(userData, 'private-memory.sqlite'), conversations: null,
  });
  assert.equal(desktopDataPaths({...options, fakeModel: true}).conversations, null);
});

test('packaged path selection preserves synthetic database and conversation on reopen', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'personal-agent-packaged-paths-'));
  let writer,reader;
  t.after(() => {reader?.close();writer?.close();rmSync(root, {recursive: true, force: true});});
  const installDir = path.join(root, 'resources', 'app.asar', 'electron');
  const dataDir = path.join(root, 'user-data');
  mkdirSync(installDir, {recursive: true});
  mkdirSync(dataDir);
  const selected = desktopDataPaths({electronDir: installDir, userData: dataDir, packaged: true});
  assert.equal(selected.runtime, path.join(dataDir, 'runtime.sqlite'));
  assert.equal(selected.conversations, path.join(dataDir, 'conversations.json'));
  let db = new DatabaseSync(selected.runtime);
  try {
    db.exec('CREATE TABLE fixture (value TEXT NOT NULL)');
    db.prepare('INSERT INTO fixture VALUES (?)').run('synthetic');
  } finally { db.close(); }
  writer=new Conversations(selected.conversations);
  writer.add('synthetic-task', 'workspace', 'synthetic goal');
  db = new DatabaseSync(selected.runtime);
  try { assert.equal(db.prepare('SELECT value FROM fixture').get().value, 'synthetic'); }
  finally { db.close(); }
  reader=new Conversations(selected.conversations);
  assert.equal(reader.goal('synthetic-task'), 'synthetic goal');
  assert.equal(existsSync(path.resolve(installDir, '../.cache')), false);
  assert.equal(existsSync(path.join(installDir, 'runtime.sqlite')), false);
});
