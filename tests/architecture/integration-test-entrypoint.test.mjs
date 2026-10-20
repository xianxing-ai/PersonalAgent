import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const {scripts} = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('the standard check gates root integration tests after workspace build and tests', () => {
  const steps = scripts.check.split(/\s*&&\s*/u);
  const integration = steps.indexOf('npm run test:integration');
  assert.ok(integration >= 0, 'npm run check must execute the root integration suite');
  assert.ok(steps.indexOf('npm run typecheck') >= 0 && steps.indexOf('npm run typecheck') < integration);
  assert.ok(steps.indexOf('npm run test --workspaces') >= 0 && steps.indexOf('npm run test --workspaces') < integration);
});

test('the integration runner serially discovers every root integration test without filtering failures', () => {
  assert.equal(scripts['test:integration'], 'node --test --test-concurrency=1 --test-reporter=spec --test-reporter=./apps/desktop/test-support/node-test-failure-reporter.mjs --test-reporter-destination=stdout --test-reporter-destination=stderr tests/integration/*.test.mjs');
});
