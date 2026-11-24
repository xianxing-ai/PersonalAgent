import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(root, '../electron/main.js'), 'utf8');

test('desktop leaves workers.list / worker.get / create / rename / delete for frontend', () => {
  assert.match(main, /workers:\s*fakeMode\s*\?\s*\[\]\s*:\s*\(runtimeApplication\?\.listWorkers/);
  assert.match(main, /name === 'workers\.list'/);
  assert.match(main, /name === 'worker\.get'/);
  assert.match(main, /name === 'worker\.create'/);
  assert.match(main, /name === 'worker\.rename'/);
  assert.match(main, /name === 'worker\.delete'/);
  assert.match(main, /return runtimeApplication\.listWorkers\(\)/);
  assert.match(main, /return runtimeApplication\.getWorker\(workerId\)/);
  assert.match(main, /runtimeApplication\.createWorker\(/);
});

test('front-desk automaticTools no longer kitchen-sink work tools', () => {
  assert.match(main, /Front-desk auto-approve surface/);
  assert.match(main, /'weather\.forecast'/);
  assert.match(main, /SUBAGENT_DISPATCH_TOOL_NAME/);
  assert.doesNotMatch(main.slice(main.indexOf('Front-desk auto-approve surface'), main.indexOf('Front-desk auto-approve surface') + 1200),
    /workspace\.apply_text_patch/);
});
